import os
import json
import time
import base64
import urllib.request
import urllib.error
from pathlib import Path


def _load_project_env() -> None:
    """Load project-local environment values without exposing or overriding OS secrets."""
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.is_file():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or not key.replace("_", "").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_project_env()

# ============================================================
# LLM PROVIDER SELECTION
# ============================================================

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama")  # ollama, openai, or gemini
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4-turbo-preview")

# Gemini is intentionally configured independently so the local process-video
# pipeline can continue using Ollama unless LLM_PROVIDER is explicitly changed.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
# Flash Lite is available to this key and is reliable for short story writing.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest").strip()
GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image").strip()

# ============================================================
# OLLAMA CONFIGURATION
# ============================================================

OLLAMA_URL = "http://localhost:11434/api/generate"
# phi3 currently crashes in this Windows Ollama runtime while allocating its
# context. tinyllama is installed locally and verified to complete requests.
# Set OLLAMA_MODEL=phi3:latest after the Ollama runtime issue is resolved.
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "tinyllama:latest")

# ============================================================
# LLM REQUEST - OLLAMA
# ============================================================

def ask_ollama(prompt, max_tokens=250, timeout=180):
    """
    Query Ollama local LLM server.
    
    Args:
        prompt (str): Input prompt
        max_tokens (int): Max output tokens
        timeout (int): Request timeout in seconds
    
    Returns:
        str: Plain text response
    """
    data = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.4,
            "num_predict": max_tokens,
        },
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
        text = result.get("response", "").strip()
        if not text:
            raise RuntimeError("Ollama returned an empty response.")
        return text
    except urllib.error.URLError as error:
        raise RuntimeError(f"Ollama connection failed: {error}") from error
    except TimeoutError as error:
        raise RuntimeError(f"Ollama timed out after {timeout} seconds.") from error


# ============================================================
# LLM REQUEST - OPENAI/CHATGPT
# ============================================================

def ask_openai(prompt, max_tokens=250, timeout=180, model=None):
    """
    Query OpenAI ChatGPT API.
    
    Args:
        prompt (str): Input prompt
        max_tokens (int): Max output tokens
        timeout (int): Request timeout in seconds
    
    Returns:
        str: Plain text response
    
    Requires:
        OPENAI_API_KEY environment variable set
    """
    if not OPENAI_API_KEY:
        raise RuntimeError(
            "OPENAI_API_KEY environment variable not set. "
            "Set it or switch to LLM_PROVIDER='ollama'"
        )

    data = {
        "model": model or OPENAI_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.4,
    }

    request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
        
        if "error" in result:
            raise RuntimeError(f"OpenAI API error: {result['error']}")
        
        text = result["choices"][0]["message"]["content"].strip()
        if not text:
            raise RuntimeError("OpenAI returned an empty response.")
        return text
    
    except urllib.error.HTTPError as error:
        try:
            detail = error.read().decode("utf-8")
            message = json.loads(detail).get("error", {}).get("message", detail)
        except (UnicodeDecodeError, json.JSONDecodeError):
            message = error.reason
        raise RuntimeError(f"OpenAI API error ({error.code}): {message}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"OpenAI API connection failed: {error}") from error
    except TimeoutError as error:
        raise RuntimeError(f"OpenAI API timed out after {timeout} seconds.") from error


# ============================================================
# LLM REQUEST - GEMINI
# ============================================================

def ask_gemini(prompt, max_tokens=250, timeout=180, _attempt=0, model=None, tools=None):
    """Query the Gemini generateContent API and return its text response."""
    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY environment variable is not set. "
            "Create a key in Google AI Studio, set it locally, then restart the dashboard."
        )

    data = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_tokens},
    }
    if tools:
        data["tools"] = tools
    selected_model = model or GEMINI_MODEL
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{urllib.parse.quote(selected_model, safe='-._')}:generateContent"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))

        parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        text = "".join(str(part.get("text", "")) for part in parts).strip()
        if not text:
            finish_reason = result.get("candidates", [{}])[0].get("finishReason", "unknown")
            raise RuntimeError(
                "Gemini returned no visible text "
                f"(finish reason: {finish_reason}). Try again or increase the output budget."
            )
        return text
    except urllib.error.HTTPError as error:
        try:
            detail = error.read().decode("utf-8")
            message = json.loads(detail).get("error", {}).get("message", detail)
        except (UnicodeDecodeError, json.JSONDecodeError):
            message = error.reason
        # Capacity and rate-limit responses are normally transient. Retry a
        # small number of times so a dashboard click does not fail instantly.
        if error.code in (429, 500, 503) and _attempt < 2:
            time.sleep(1.5 * (_attempt + 1))
            return ask_gemini(prompt, max_tokens, timeout, _attempt + 1, model, tools)
        raise RuntimeError(f"Gemini API error ({error.code}): {message}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Gemini API connection failed: {error}") from error
    except TimeoutError as error:
        raise RuntimeError(f"Gemini API timed out after {timeout} seconds.") from error


def generate_gemini_image(prompt, timeout=180, _attempt=0):
    """Generate one original 9:16 story image and return its binary data."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set.")
    data = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
        },
    }
    url = "https://generativelanguage.googleapis.com/v1/models/" + f"{urllib.parse.quote(GEMINI_IMAGE_MODEL, safe='-._')}:generateContent"
    request = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
        parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        for part in parts:
            inline_data = part.get("inlineData") or part.get("inline_data")
            if inline_data and inline_data.get("data"):
                return base64.b64decode(inline_data["data"]), inline_data.get("mimeType", "image/png")
        raise RuntimeError("Gemini did not return an image for this story scene.")
    except urllib.error.HTTPError as error:
        try:
            detail = error.read().decode("utf-8")
            message = json.loads(detail).get("error", {}).get("message", detail)
        except (UnicodeDecodeError, json.JSONDecodeError):
            message = error.reason
        if error.code in (429, 500, 503) and _attempt < 2:
            time.sleep(2 * (_attempt + 1))
            return generate_gemini_image(prompt, timeout, _attempt + 1)
        if error.code == 429 and "quota" in message.lower():
            raise RuntimeError(
                "Gemini image generation is unavailable for this key: its free image quota is zero. "
                "No story video was created. Enable image-model billing or use a local GPU renderer."
            ) from error
        raise RuntimeError(f"Gemini image API error ({error.code}): {message}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Gemini image API connection failed: {error}") from error


# ============================================================
# UNIFIED LLM INTERFACE
# ============================================================

def ask_llm(prompt, max_tokens=250, timeout=180):
    """
    Query the configured LLM provider (Ollama, OpenAI, or Gemini).
    
    This is the main interface used throughout the pipeline.
    Switch providers via LLM_PROVIDER environment variable.
    
    Args:
        prompt (str): Input prompt
        max_tokens (int): Max output tokens
        timeout (int): Request timeout in seconds
    
    Returns:
        str: Plain text response
    """
    if LLM_PROVIDER == "openai":
        return ask_openai(prompt, max_tokens, timeout)
    elif LLM_PROVIDER == "gemini":
        return ask_gemini(prompt, max_tokens, timeout)
    elif LLM_PROVIDER == "ollama":
        return ask_ollama(prompt, max_tokens, timeout)
    else:
        raise RuntimeError(
            f"Unknown LLM_PROVIDER: {LLM_PROVIDER}. "
            "Use 'ollama', 'openai', or 'gemini'."
        )
