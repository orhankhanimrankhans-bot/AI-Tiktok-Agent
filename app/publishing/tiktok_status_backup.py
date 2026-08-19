import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

TOKEN_FILE = PROJECT_ROOT / "data" / "tiktok_tokens.json"


# ============================================================
# TIKTOK CONFIGURATION
# ============================================================

STATUS_URL = (
    "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
)


# ============================================================
# LOAD ACCESS TOKEN
# ============================================================

def load_access_token():
    if not TOKEN_FILE.exists():
        raise FileNotFoundError(
            f"TikTok token file not found:\n{TOKEN_FILE}"
        )

    try:
        data = json.loads(
            TOKEN_FILE.read_text(
                encoding="utf-8"
            )
        )
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Invalid TikTok token JSON: {error}"
        ) from error

    access_token = data.get("access_token")

    if not access_token:
        raise RuntimeError(
            "TikTok access token is missing."
        )

    return access_token


# ============================================================
# CHECK STATUS
# ============================================================

def check_status(publish_id, access_token):

    payload = json.dumps(
        {
            "publish_id": publish_id
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        STATUS_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
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
            f"TikTok status HTTP {error.code}:\n{body}"
        ) from error

    except urllib.error.URLError as error:

        raise RuntimeError(
            f"Could not connect to TikTok: {error}"
        ) from error

    try:
        result = json.loads(body)

    except json.JSONDecodeError:

        raise RuntimeError(
            f"TikTok returned invalid JSON:\n{body}"
        )

    return result


# ============================================================
# MAIN STATUS MONITOR
# ============================================================

def monitor_status(
    publish_id,
    max_attempts=12,
    interval=5,
):

    access_token = load_access_token()

    print()
    print("==========================================")
    print("       AI TIKTOK STATUS CHECKER")
    print("==========================================")
    print()

    print(
        f"Publish ID:\n{publish_id}"
    )

    print()

    print(
        f"Checking TikTok every {interval} seconds..."
    )

    print()

    # --------------------------------------------------------
    # TERMINAL SUCCESS STATE
    # --------------------------------------------------------

    success_states = {
        "SEND_TO_USER_INBOX",
    }

    # --------------------------------------------------------
    # TERMINAL FAILURE STATES
    # --------------------------------------------------------

    failure_states = {
        "FAILED",
        "ERROR",
    }

    # --------------------------------------------------------
    # POLLING
    # --------------------------------------------------------

    for attempt in range(
        1,
        max_attempts + 1,
    ):

        result = check_status(
            publish_id,
            access_token,
        )

        print(
            f"Attempt {attempt}/{max_attempts}"
        )

        print(
            "TikTok response:"
        )

        print(
            json.dumps(
                result,
                indent=2,
                ensure_ascii=False,
            )
        )

        status = (
            result
            .get("data", {})
            .get("status")
        )

        if not status:
            status = (
                result
                .get("status")
            )

        print()

        print(
            f"TikTok status: {status}"
        )

        # ----------------------------------------------------
        # SUCCESS
        # ----------------------------------------------------

        if status in success_states:

            print()
            print("==========================================")
            print("          TIKTOK UPLOAD SUCCESS")
            print("==========================================")
            print()

            print(
                "TikTok has accepted the video."
            )

            print(
                "Status: SEND_TO_USER_INBOX"
            )

            print()

            print(
                "The video has been sent to the"
            )

            print(
                "authorized TikTok user's inbox."
            )

            print()

            print(
                "The creator can continue the"
            )

            print(
                "TikTok posting flow from there."
            )

            print()

            return True

        # ----------------------------------------------------
        # FAILURE
        # ----------------------------------------------------

        if status in failure_states:

            print()
            print("==========================================")
            print("          TIKTOK UPLOAD FAILED")
            print("==========================================")
            print()

            print(
                json.dumps(
                    result,
                    indent=2,
                    ensure_ascii=False,
                )
            )

            return False

        # ----------------------------------------------------
        # CONTINUE POLLING
        # ----------------------------------------------------

        if attempt < max_attempts:

            print()
            print(
                f"Waiting {interval} seconds..."
            )

            time.sleep(interval)

    # --------------------------------------------------------
    # TIMEOUT
    # --------------------------------------------------------

    print()
    print("==========================================")
    print("       TIKTOK STATUS TIMEOUT")
    print("==========================================")
    print()

    print(
        f"TikTok did not reach a terminal state "
        f"after {max_attempts} attempts."
    )

    return False


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    publish_id = input(
        "Enter TikTok Publish ID: "
    ).strip()

    if not publish_id:

        print()
        print(
            "ERROR: Publish ID cannot be empty."
        )

        raise SystemExit(1)

    try:

        success = monitor_status(
            publish_id
        )

    except Exception as error:

        print()
        print("==========================================")
        print("             STATUS ERROR")
        print("==========================================")
        print()
        print(error)

        raise SystemExit(1)

    if not success:

        raise SystemExit(1)