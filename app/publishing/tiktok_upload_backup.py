
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

TOKEN_FILE = PROJECT_ROOT / "data" / "tiktok_tokens.json"

TIKTOK_INIT_URL = (
    "https://open.tiktokapis.com/"
    "v2/post/publish/inbox/video/init/"
)


# ============================================================
# VIDEO
# ============================================================

DEFAULT_VIDEO = (
    PROJECT_ROOT
    / "output"
    / "final"
    / "Unveiling_the_science_behind_why_ice_melts_into_water_at_room_temperature_captioned.mp4"
)


# ============================================================
# LOAD TOKEN
# ============================================================

def load_access_token():
    if not TOKEN_FILE.exists():
        raise RuntimeError(
            f"TikTok token file not found:\n{TOKEN_FILE}\n\n"
            "Please connect TikTok first."
        )

    try:
        data = json.loads(
            TOKEN_FILE.read_text(
                encoding="utf-8"
            )
        )
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Invalid TikTok token JSON:\n{error}"
        ) from error

    access_token = data.get("access_token", "").strip()

    if not access_token:
        raise RuntimeError(
            "No access_token found in tiktok_tokens.json."
        )

    scope = data.get("scope", "")

    if "video.upload" not in scope.split(","):
        raise RuntimeError(
            "The current TikTok token does not contain "
            "the video.upload scope.\n\n"
            f"Scopes found: {scope}"
        )

    return access_token


# ============================================================
# INITIALIZE TIKTOK UPLOAD
# ============================================================

def initialize_upload(video_path):
    access_token = load_access_token()

    video_size = video_path.stat().st_size

    # TikTok allows a single chunk when the whole file
    # is uploaded as one chunk.
    chunk_size = video_size
    total_chunk_count = 1

    payload = {
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": video_size,
            "chunk_size": chunk_size,
            "total_chunk_count": total_chunk_count,
        }
    }

    request = urllib.request.Request(
        TIKTOK_INIT_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
        },
        method="POST",
    )

    print()
    print("Initializing TikTok upload...")
    print(f"Video size: {video_size:,} bytes")

    try:
        with urllib.request.urlopen(
            request,
            timeout=60,
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
            f"TikTok initialization failed "
            f"(HTTP {error.code}):\n{body}"
        ) from error

    except urllib.error.URLError as error:

        raise RuntimeError(
            f"Could not connect to TikTok:\n{error}"
        ) from error

    try:
        result = json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"TikTok returned invalid JSON:\n{body}"
        ) from error

    error_data = result.get("error", {})

    if error_data.get("code") != "ok":
        raise RuntimeError(
            "TikTok upload initialization returned an error:\n"
            + json.dumps(
                result,
                indent=2,
            )
        )

    data = result.get("data", {})

    publish_id = data.get("publish_id")
    upload_url = data.get("upload_url")

    if not publish_id:
        raise RuntimeError(
            "TikTok did not return a publish_id."
        )

    if not upload_url:
        raise RuntimeError(
            "TikTok did not return an upload_url."
        )

    return publish_id, upload_url


# ============================================================
# UPLOAD VIDEO FILE
# ============================================================

def upload_video(video_path, upload_url):

    video_size = video_path.stat().st_size

    print()
    print("Uploading video to TikTok...")
    print(f"Bytes: {video_size:,}")

    with open(
        video_path,
        "rb",
    ) as video_file:

        video_data = video_file.read()

    last_byte = video_size - 1

    request = urllib.request.Request(
        upload_url,
        data=video_data,
        headers={
            "Content-Type": "video/mp4",
            "Content-Length": str(video_size),
            "Content-Range": (
                f"bytes 0-{last_byte}/{video_size}"
            ),
        },
        method="PUT",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=180,
        ) as response:

            response_body = response.read().decode(
                "utf-8",
                errors="replace",
            )

            print()
            print(
                f"TikTok upload HTTP status: "
                f"{response.status}"
            )

            if response_body:
                print(
                    "TikTok response:"
                )
                print(response_body)

    except urllib.error.HTTPError as error:

        body = error.read().decode(
            "utf-8",
            errors="replace",
        )

        raise RuntimeError(
            f"TikTok video upload failed "
            f"(HTTP {error.code}):\n{body}"
        ) from error

    except urllib.error.URLError as error:

        raise RuntimeError(
            f"Video upload connection failed:\n{error}"
        ) from error


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("==========================================")
    print("       AI TIKTOK VIDEO UPLOADER")
    print("==========================================")

    video_path = DEFAULT_VIDEO

    if len(sys.argv) > 1:
        video_path = Path(sys.argv[1]).resolve()

    print()
    print("Video:")
    print(video_path)

    if not video_path.exists():
        raise FileNotFoundError(
            f"Video does not exist:\n{video_path}"
        )

    if video_path.suffix.lower() != ".mp4":
        raise RuntimeError(
            "This first uploader test expects an MP4 file."
        )

    print()
    print(
        f"Size: {video_path.stat().st_size:,} bytes"
    )

    publish_id, upload_url = initialize_upload(
        video_path
    )

    print()
    print("TikTok upload initialized.")
    print()
    print("Publish ID:")
    print(publish_id)

    # IMPORTANT:
    # Never print the upload_url because it contains
    # temporary upload credentials.

    upload_video(
        video_path,
        upload_url,
    )

    print()
    print("==========================================")
    print("          UPLOAD COMPLETE")
    print("==========================================")
    print()
    print("Publish ID:")
    print(publish_id)
    print()
    print(
        "TikTok has received the video."
    )
    print()
    print(
        "The next step is to check the publish "
        "status and confirm the video appears "
        "in the TikTok inbox."
    )
    print()


if __name__ == "__main__":
    main()
