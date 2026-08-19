"""Free Pexels footage retrieval for the local video renderer."""

import hashlib
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from observability import get_logger


logger = get_logger("pexels")


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FOOTAGE_DIR = PROJECT_ROOT / "output" / "footage"
PEXELS_SEARCH_URL = "https://api.pexels.com/v1/videos/search"


def get_api_key():
    """Read the key without placing it in source control or output artifacts."""

    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if key:
        return key

    # A dashboard already running when the key was saved will not inherit the
    # new environment. Reading the user value lets it work after a refresh.
    if os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as registry_key:
                return str(winreg.QueryValueEx(registry_key, "PEXELS_API_KEY")[0]).strip()
        except (FileNotFoundError, OSError):
            logger.debug("Pexels user environment key was unavailable", exc_info=True, extra={"event": "pexels.user_key_unavailable"})

    raise RuntimeError(
        "PEXELS_API_KEY is not configured. Set the free Pexels API key in your user environment."
    )


def _request_json(url):
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": get_api_key(),
            "User-Agent": "AI-TikTok-Agent/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise RuntimeError(
                "Pexels refused the API request. Check that the free API key is active "
                "for this Pexels account, then generate a replacement key if needed."
            ) from error
        raise RuntimeError(f"Pexels search failed with HTTP {error.code}.") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach Pexels: {error.reason}") from error


def _best_video_file(video):
    files = video.get("video_files", [])
    if not files:
        return None

    # Portrait footage requires the least crop and is preferred. Within that,
    # select the largest available H.264-compatible file.
    def score(item):
        width = int(item.get("width") or 0)
        height = int(item.get("height") or 0)
        portrait_bonus = 10_000_000 if height >= width else 0
        return portrait_bonus + width * height

    return max(files, key=score)


def _video_relevance_score(video, query):
    """Prefer search results whose public title confirms the requested process."""

    title = str(video.get("url", "")).lower().replace("-", " ")
    ignored_words = {"with", "from", "into", "that", "this", "real", "video"}
    keywords = [
        word
        for word in urllib.parse.unquote_plus(query).lower().split()
        if len(word) >= 4 and word not in ignored_words
    ]
    matches = sum(1 for word in keywords if word in title)
    duration = int(video.get("duration") or 0)
    width = int(video.get("width") or 0)
    height = int(video.get("height") or 0)
    portrait_bonus = 1_000 if height >= width else 0
    return matches * 1_000_000 + portrait_bonus + duration * 100 + width * height // 10_000


def download_footage(query, scene_number, minimum_duration=15):
    """Search Pexels and cache one usable real-world clip for a scene."""

    normalized_query = " ".join(str(query).split())[:160]
    if not normalized_query:
        raise RuntimeError("Cannot search Pexels without a visual description.")

    params = urllib.parse.urlencode(
        {
            "query": normalized_query,
            "orientation": "portrait",
            "size": "medium",
            "min_duration": int(minimum_duration),
            "per_page": 10,
        }
    )
    response = _request_json(f"{PEXELS_SEARCH_URL}?{params}")
    videos = response.get("videos", [])
    if not videos:
        # Longer single-take clips are not available for every niche topic.
        # Fall back to a usable clip; the renderer can extend it cleanly.
        if minimum_duration > 15:
            return download_footage(normalized_query, scene_number, minimum_duration=15)
        raise RuntimeError(f"Pexels found no free footage for: {normalized_query}")

    matching_videos = [video for video in videos if _best_video_file(video)]
    selected_video = max(
        matching_videos,
        key=lambda video: _video_relevance_score(video, normalized_query),
        default=None,
    )
    if not selected_video:
        if minimum_duration > 15:
            return download_footage(normalized_query, scene_number, minimum_duration=15)
        raise RuntimeError(f"Pexels returned no downloadable footage for: {normalized_query}")

    video_file = _best_video_file(selected_video)
    source_url = video_file.get("link")
    if not source_url:
        raise RuntimeError("Pexels returned a clip without a download link.")

    FOOTAGE_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
    output_path = FOOTAGE_DIR / f"scene_{scene_number:02d}_{digest}.mp4"
    if output_path.exists() and output_path.stat().st_size > 100_000:
        return output_path

    request = urllib.request.Request(source_url, headers={"User-Agent": "AI-TikTok-Agent/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, output_path.open("wb") as output_file:
            while chunk := response.read(1024 * 1024):
                output_file.write(chunk)
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(f"Could not download Pexels footage: {error}") from error

    if output_path.stat().st_size <= 100_000:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("Pexels returned an incomplete footage file.")

    return output_path
