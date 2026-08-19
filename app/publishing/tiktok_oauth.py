import base64
import hashlib
import json
import os
import secrets
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
import uvicorn


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

TOKEN_FILE = PROJECT_ROOT / "data" / "tiktok_tokens.json"
TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)


# ============================================================
# TIKTOK CONFIGURATION
# ============================================================

CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "").strip()

REDIRECT_URI = "http://127.0.0.1:8000/tiktok/callback"

SCOPES = "user.info.basic,video.upload,video.publish"

AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="AI TikTok Agent",
    version="1.0.0",
)


# ============================================================
# TEMPORARY OAUTH STATE
# ============================================================

oauth_sessions = {}


# ============================================================
# PKCE
# ============================================================

def create_code_verifier():
    """
    Create a PKCE code verifier.
    """

    return secrets.token_urlsafe(64)[:128]


def create_code_challenge(code_verifier):
    """
    Create TikTok Desktop PKCE S256 code challenge.

    TikTok Desktop requires the SHA-256 digest
    represented as lowercase hexadecimal.
    """

    return hashlib.sha256(
        code_verifier.encode("ascii")
    ).hexdigest()


# ============================================================
# HOME PAGE
# ============================================================

@app.get("/", response_class=HTMLResponse)
def home():

    connected = TOKEN_FILE.exists()

    status = (
        "TikTok Connected"
        if connected
        else "TikTok Not Connected"
    )

    button = ""

    if connected:
        button = """
        <p>
            <strong>✓ TikTok account connected</strong>
        </p>

        <p>
            <a href="/tiktok/logout">
                Disconnect TikTok
            </a>
        </p>
        """

    else:
        button = """
        <a href="/tiktok/login">
            <button
                style="
                    padding:12px 24px;
                    font-size:16px;
                    cursor:pointer;
                "
            >
                Login with TikTok
            </button>
        </a>
        """

    return f"""
    <!DOCTYPE html>

    <html>

    <head>
        <title>AI TikTok Agent</title>
    </head>

    <body
        style="
            font-family:Arial;
            max-width:800px;
            margin:60px auto;
            padding:20px;
        "
    >

        <h1>AI TikTok Agent</h1>

        <p>
            AI-powered TikTok content creation and publishing.
        </p>

        <hr>

        <h2>TikTok Connection</h2>

        <p>
            Status:
            <strong>{status}</strong>
        </p>

        {button}

    </body>

    </html>
    """


# ============================================================
# TIKTOK LOGIN
# ============================================================

@app.get("/tiktok/login")
def tiktok_login():

    if not CLIENT_KEY:
        return HTMLResponse(
            """
            <h2>TikTok configuration missing</h2>

            <p>
            TIKTOK_CLIENT_KEY is not configured.
            </p>

            <p>
            Set your TikTok Client Key as an environment
            variable before starting the server.
            </p>
            """,
            status_code=500,
        )

    state = secrets.token_urlsafe(32)

    code_verifier = create_code_verifier()

    code_challenge = create_code_challenge(
        code_verifier
    )

    oauth_sessions[state] = {
        "code_verifier": code_verifier,
    }

    params = {
        "client_key": CLIENT_KEY,
        "response_type": "code",
        "scope": SCOPES,
        "redirect_uri": REDIRECT_URI,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    authorization_url = (
        AUTH_URL
        + "?"
        + urllib.parse.urlencode(params)
    )

    return RedirectResponse(
        authorization_url,
        status_code=302,
    )


# ============================================================
# TIKTOK CALLBACK
# ============================================================

@app.get("/tiktok/callback")
def tiktok_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):

    if error:
        return HTMLResponse(
            f"""
            <h2>TikTok authorization failed</h2>

            <p>
            Error: {error}
            </p>

            <p>
            {error_description or ""}
            </p>
            """,
            status_code=400,
        )

    if not code:
        return HTMLResponse(
            "<h2>No authorization code received.</h2>",
            status_code=400,
        )

    if not state:
        return HTMLResponse(
            "<h2>Missing OAuth state.</h2>",
            status_code=400,
        )

    session = oauth_sessions.pop(state, None)

    if not session:
        return HTMLResponse(
            """
            <h2>Invalid or expired OAuth session.</h2>

            <p>
            Please start the TikTok login process again.
            </p>
            """,
            status_code=400,
        )

    code_verifier = session["code_verifier"]

    try:

        token_data = exchange_code_for_token(
            code,
            code_verifier,
        )

    except Exception as error:

        return HTMLResponse(
            f"""
            <h2>TikTok token exchange failed</h2>

            <pre>{error}</pre>
            """,
            status_code=500,
        )

    save_tokens(token_data)

    return RedirectResponse(
        "/",
        status_code=303,
    )


# ============================================================
# TOKEN EXCHANGE
# ============================================================

def exchange_code_for_token(
    authorization_code,
    code_verifier,
):

    if not CLIENT_KEY:
        raise RuntimeError(
            "TIKTOK_CLIENT_KEY is not configured."
        )

    data = urllib.parse.urlencode(
        {
            "client_key": CLIENT_KEY,
            "client_secret": os.getenv(
                "TIKTOK_CLIENT_SECRET",
                "",
            ),
            "code": authorization_code,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
            "code_verifier": code_verifier,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={
            "Content-Type":
                "application/x-www-form-urlencoded",
        },
        method="POST",
    )

    try:

        with urllib.request.urlopen(
            request,
            timeout=30,
        ) as response:

            body = response.read().decode(
                "utf-8"
            )

    except urllib.error.HTTPError as error:

        body = error.read().decode(
            "utf-8",
            errors="replace",
        )

        raise RuntimeError(
            f"TikTok token endpoint returned "
            f"HTTP {error.code}: {body}"
        ) from error

    except urllib.error.URLError as error:

        raise RuntimeError(
            f"Could not connect to TikTok: {error}"
        ) from error

    result = json.loads(body)

    if "error" in result:
        raise RuntimeError(
            json.dumps(
                result,
                indent=2,
            )
        )

    return result


# ============================================================
# SAVE TOKENS
# ============================================================

def save_tokens(token_data):

    TOKEN_FILE.write_text(
        json.dumps(
            token_data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


# ============================================================
# LOGOUT
# ============================================================

@app.get("/tiktok/logout")
def tiktok_logout():

    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()

    return RedirectResponse(
        "/",
        status_code=303,
    )


# ============================================================
# RUN SERVER
# ============================================================

if __name__ == "__main__":

    print()
    print("==========================================")
    print("        AI TIKTOK OAUTH SERVER")
    print("==========================================")
    print()

    print("Website:")
    print("http://127.0.0.1:8000/")
    print()

    print("TikTok Login:")
    print("http://127.0.0.1:8000/tiktok/login")
    print()

    print("Callback:")
    print(REDIRECT_URI)
    print()

    if CLIENT_KEY:
        print("TikTok Client Key: CONFIGURED")
    else:
        print("TikTok Client Key: NOT CONFIGURED")

    print()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
    )