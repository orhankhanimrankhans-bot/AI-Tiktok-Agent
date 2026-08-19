
import json
import os
import urllib.error
import urllib.request
from pathlib import Path


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

TOKEN_FILE = PROJECT_ROOT / "data" / "tiktok_tokens.json"
# TikTok Direct Post requires a valid multipart chunk size for files larger
# than its single-upload limit. Ten MiB is safely within TikTok's supported
# range and avoids holding the entire video in memory.
UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024


# ============================================================
# TIKTOK DIRECT POST API
# ============================================================

CREATOR_INFO_URL = (
    "https://open.tiktokapis.com/v2/post/publish/"
    "creator_info/query/"
)

TIKTOK_INIT_URL = (
    "https://open.tiktokapis.com/v2/post/publish/"
    "video/init/"
)


# ============================================================
# LOAD ACCESS TOKEN
# ============================================================

def load_access_token():

    if not TOKEN_FILE.exists():

        raise RuntimeError(
            f"TikTok token file not found:\n"
            f"{TOKEN_FILE}\n\n"
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

    access_token = (
        data.get("access_token", "")
        .strip()
    )

    if not access_token:

        raise RuntimeError(
            "No access_token found in "
            "tiktok_tokens.json."
        )

    scope = data.get(
        "scope",
        "",
    )

    scopes = {
        item.strip()
        for item in scope.split(",")
        if item.strip()
    }

    if "video.publish" not in scopes:

        raise RuntimeError(
            "The current TikTok token does not "
            "contain the video.publish scope.\n\n"
            f"Scopes found: {scope}"
        )

    return access_token


# ============================================================
# QUERY CREATOR INFORMATION
# ============================================================

def query_creator_info():

    access_token = load_access_token()

    request = urllib.request.Request(
        CREATOR_INFO_URL,
        data=b"",
        headers={
            "Authorization":
                f"Bearer {access_token}",
            "Content-Type":
                "application/json; charset=UTF-8",
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
            "TikTok creator info request failed "
            f"(HTTP {error.code}):\n{body}"
        ) from error

    except urllib.error.URLError as error:

        raise RuntimeError(
            "Could not connect to TikTok:\n"
            f"{error}"
        ) from error

    try:

        result = json.loads(body)

    except json.JSONDecodeError as error:

        raise RuntimeError(
            "TikTok returned invalid JSON:\n"
            f"{body}"
        ) from error

    error_data = result.get(
        "error",
        {},
    )

    if error_data.get("code") != "ok":

        raise RuntimeError(
            "TikTok creator info request returned "
            "an error:\n"
            + json.dumps(
                result,
                indent=2,
                ensure_ascii=False,
            )
        )

    creator = result.get(
        "data",
        {},
    )

    privacy_options = creator.get(
        "privacy_level_options",
        [],
    )

    if not privacy_options:

        raise RuntimeError(
            "TikTok did not return any "
            "privacy_level_options."
        )

    print()
    print("TikTok creator:")
    print(
        creator.get(
            "creator_username",
            "Unknown",
        )
    )

    print(
        "Nickname:",
        creator.get(
            "creator_nickname",
            "Unknown",
        ),
    )

    print(
        "Privacy options:",
        ", ".join(privacy_options),
    )

    print(
        "Max video duration:",
        creator.get(
            "max_video_post_duration_sec",
            "Unknown",
        ),
        "seconds",
    )

    return creator


# ============================================================
# CHOOSE PRIVACY LEVEL
# ============================================================

def choose_privacy_level(creator_info):

    options = creator_info.get(
        "privacy_level_options",
        [],
    )

    requested_level = os.environ.get(
        "TIKTOK_PRIVACY_LEVEL",
        "SELF_ONLY",
    )

    if requested_level in options:
        return requested_level

    # Otherwise use a valid option returned by TikTok.
    if "FOLLOWER_OF_CREATOR" in options:
        return "FOLLOWER_OF_CREATOR"

    if "MUTUAL_FOLLOW_FRIENDS" in options:
        return "MUTUAL_FOLLOW_FRIENDS"

    if "SELF_ONLY" in options:
        return "SELF_ONLY"

    raise RuntimeError(
        "No supported TikTok privacy level "
        "was returned."
    )


# ============================================================
# INITIALIZE DIRECT POST
# ============================================================

def initialize_upload(
    video_path,
    title,
):

    access_token = load_access_token()

    # --------------------------------------------------------
    # CREATOR INFO
    # --------------------------------------------------------

    creator_info = query_creator_info()

    privacy_level = choose_privacy_level(
        creator_info
    )

    # --------------------------------------------------------
    # VIDEO LIMIT
    # --------------------------------------------------------

    video_duration_limit = creator_info.get(
        "max_video_post_duration_sec"
    )

    if video_duration_limit:

        print()
        print(
            "TikTok maximum video duration:",
            video_duration_limit,
            "seconds",
        )

    # --------------------------------------------------------
    # FILE
    # --------------------------------------------------------

    video_size = video_path.stat().st_size

    chunk_size = min(UPLOAD_CHUNK_SIZE, video_size)
    # TikTok requires floor(video_size / chunk_size). The final request may be
    # larger than chunk_size and carries all trailing bytes.
    total_chunk_count = max(1, video_size // chunk_size)

    # --------------------------------------------------------
    # POST INFO
    # --------------------------------------------------------

    post_info = {
        "title": title[:2200],
        "privacy_level": privacy_level,
        "disable_duet": False,
        "disable_comment": False,
        "disable_stitch": False,
        "is_aigc": True,
    }

    # --------------------------------------------------------
    # REQUEST
    # --------------------------------------------------------

    payload = {
        "post_info": post_info,
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": video_size,
            "chunk_size": chunk_size,
            "total_chunk_count": total_chunk_count,
        },
    }

    request = urllib.request.Request(
        TIKTOK_INIT_URL,
        data=json.dumps(
            payload
        ).encode("utf-8"),
        headers={
            "Authorization":
                f"Bearer {access_token}",
            "Content-Type":
                "application/json; charset=UTF-8",
        },
        method="POST",
    )

    print()
    print(
        "Initializing TikTok DIRECT POST..."
    )

    print(
        f"Video size: {video_size:,} bytes"
    )

    print(
        f"Privacy level: {privacy_level}"
    )

    print(
        "AI-generated label: ENABLED"
    )

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
            "TikTok Direct Post initialization "
            f"failed (HTTP {error.code}):\n"
            f"{body}"
        ) from error

    except urllib.error.URLError as error:

        raise RuntimeError(
            "Could not connect to TikTok:\n"
            f"{error}"
        ) from error

    try:

        result = json.loads(body)

    except json.JSONDecodeError as error:

        raise RuntimeError(
            "TikTok returned invalid JSON:\n"
            f"{body}"
        ) from error

    error_data = result.get(
        "error",
        {},
    )

    if error_data.get("code") != "ok":

        raise RuntimeError(
            "TikTok Direct Post initialization "
            "returned an error:\n"
            + json.dumps(
                result,
                indent=2,
                ensure_ascii=False,
            )
        )

    data = result.get(
        "data",
        {},
    )

    publish_id = data.get(
        "publish_id"
    )

    upload_url = data.get(
        "upload_url"
    )

    if not publish_id:

        raise RuntimeError(
            "TikTok did not return a publish_id."
        )

    if not upload_url:

        raise RuntimeError(
            "TikTok did not return an upload_url."
        )

    print()
    print(
        "Direct Post initialized successfully."
    )

    print()
    print("Publish ID:")
    print(publish_id)

    print()
    print(
        "Publish type: DIRECT_POST"
    )

    return publish_id, upload_url


# ============================================================
# UPLOAD VIDEO FILE
# ============================================================

def upload_video(
    video_path,
    upload_url,
):

    video_size = video_path.stat().st_size

    print()
    print(
        "Uploading video to TikTok..."
    )

    print(
        f"Bytes: {video_size:,}"
    )

    chunk_count = max(1, video_size // UPLOAD_CHUNK_SIZE)

    with open(video_path, "rb") as video_file:
        for chunk_index in range(chunk_count):
            start_byte = chunk_index * UPLOAD_CHUNK_SIZE
            if chunk_index == chunk_count - 1:
                bytes_to_read = video_size - start_byte
            else:
                bytes_to_read = UPLOAD_CHUNK_SIZE
            video_data = video_file.read(bytes_to_read)
            end_byte = start_byte + len(video_data) - 1

            request = urllib.request.Request(
                upload_url,
                data=video_data,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(len(video_data)),
                    "Content-Range": f"bytes {start_byte}-{end_byte}/{video_size}",
                },
                method="PUT",
            )

            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    response.read()
                    print(f"TikTok uploaded chunk {chunk_index + 1}/{chunk_count} (HTTP {response.status}).")
            except urllib.error.HTTPError as error:
                body = error.read().decode("utf-8", errors="replace")
                raise RuntimeError(
                    "TikTok video upload failed "
                    f"for chunk {chunk_index + 1}/{chunk_count} (HTTP {error.code}):\n{body}"
                ) from error
            except urllib.error.URLError as error:
                raise RuntimeError(f"Video upload connection failed:\n{error}") from error


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print(
        "=========================================="
    )

    print(
        "      AI TIKTOK DIRECT POST UPLOADER"
    )

    print(
        "=========================================="
    )

    print()

    video_path = (
        PROJECT_ROOT
        / "output"
        / "final"
        / "Unseen_forces_of_attraction_in_physics_captioned.mp4"
    )

    print("Video:")
    print(video_path)

    if not video_path.exists():

        raise FileNotFoundError(
            f"Video does not exist:\n"
            f"{video_path}"
        )

    if video_path.suffix.lower() != ".mp4":

        raise RuntimeError(
            "Direct Post uploader expects "
            "an MP4 video."
        )

    title = (
        "Unseen forces of attraction in physics "
        "#physics #science"
    )

    publish_id, upload_url = (
        initialize_upload(
            video_path,
            title,
        )
    )

    print()
    print(
        "Uploading Direct Post video..."
    )

    upload_video(
        video_path,
        upload_url,
    )

    print()
    print(
        "=========================================="
    )

    print(
        "       DIRECT POST UPLOAD COMPLETE"
    )

    print(
        "=========================================="
    )

    print()

    print(
        "Publish ID:"
    )

    print(
        publish_id
    )

    print()

    print(
        "TikTok has received the Direct Post video."
    )

    print(
        "The next step is status monitoring."
    )

    print()


if __name__ == "__main__":
    main()

