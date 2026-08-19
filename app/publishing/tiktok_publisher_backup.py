
import json
import re
from pathlib import Path

from .tiktok_upload import (
    initialize_upload,
    upload_video,
)

from .tiktok_status import (
    monitor_status,
)


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
PUBLISHING_DIR = OUTPUT_DIR / "publishing"

PUBLISHING_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# ============================================================
# FIND LATEST PUBLISHING PACKAGE
# ============================================================

def find_latest_package():
    """
    Find the newest *_publish.json publishing package.
    """

    files = list(
        PUBLISHING_DIR.glob("*_publish.json")
    )

    if not files:
        raise FileNotFoundError(
            "No publishing package found."
        )

    return max(
        files,
        key=lambda file: file.stat().st_mtime,
    )


# ============================================================
# LOAD PUBLISHING PACKAGE
# ============================================================

def load_package(package_file):
    """
    Load and validate the publishing JSON.
    """

    try:
        data = json.loads(
            package_file.read_text(
                encoding="utf-8"
            )
        )

    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Invalid publishing JSON:\n{error}"
        ) from error

    return data


# ============================================================
# VALIDATE PACKAGE
# ============================================================

def validate_package(data):
    """
    Validate the publishing package and return
    the absolute video path.
    """

    required_fields = [
        "topic",
        "video",
        "caption",
        "hashtags",
    ]

    missing = [
        field
        for field in required_fields
        if field not in data
    ]

    if missing:
        raise RuntimeError(
            "Publishing package is missing: "
            + ", ".join(missing)
        )

    video_path = Path(
        data["video"]
    )

    if not video_path.is_absolute():
        video_path = PROJECT_ROOT / video_path

    video_path = video_path.resolve()

    if not video_path.exists():
        raise FileNotFoundError(
            f"Video file does not exist:\n{video_path}"
        )

    if not video_path.is_file():
        raise RuntimeError(
            f"Video path is not a file:\n{video_path}"
        )

    if video_path.suffix.lower() != ".mp4":
        raise RuntimeError(
            f"TikTok publisher requires an MP4 video:\n{video_path}"
        )

    return video_path


# ============================================================
# CLEAN CAPTION
# ============================================================

def clean_caption(caption):
    """
    Clean caption whitespace.
    """

    caption = str(caption).strip()

    caption = re.sub(
        r"\s+",
        " ",
        caption,
    )

    return caption


# ============================================================
# CLEAN HASHTAGS
# ============================================================

def clean_hashtags(hashtags):
    """
    Normalize and clean hashtags.
    """

    if isinstance(hashtags, list):
        tags = hashtags
    else:
        tags = str(hashtags).split()

    cleaned = []

    for tag in tags:

        tag = str(tag).strip()

        if not tag:
            continue

        if not tag.startswith("#"):
            tag = "#" + tag

        tag = re.sub(
            r"[^#a-zA-Z0-9_]",
            "",
            tag,
        )

        if not tag:
            continue

        if tag.lower() not in [
            existing.lower()
            for existing in cleaned
        ]:
            cleaned.append(tag)

    return cleaned


# ============================================================
# BUILD POST INFORMATION
# ============================================================

def build_post(data, video_path):
    """
    Prepare the TikTok post information.
    """

    caption = clean_caption(
        data.get(
            "caption",
            "",
        )
    )

    hashtags = clean_hashtags(
        data.get(
            "hashtags",
            [],
        )
    )

    full_caption = caption

    if hashtags:
        full_caption += "\n\n"
        full_caption += " ".join(hashtags)

    return {
        "topic": data["topic"],
        "video": str(video_path),
        "caption": caption,
        "hashtags": hashtags,
        "full_caption": full_caption,
    }


# ============================================================
# SAVE UPDATED PUBLISHING PACKAGE
# ============================================================

def save_package(
    package_file,
    data,
):
    """
    Save the updated publishing package.
    """

    package_file.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


# ============================================================
# UPDATE PACKAGE BEFORE UPLOAD
# ============================================================

def mark_upload_started(
    package_file,
    data,
):
    """
    Record that the TikTok upload has started.
    """

    data["status"] = "UPLOADING_TO_TIKTOK"

    save_package(
        package_file,
        data,
    )


# ============================================================
# UPDATE PACKAGE AFTER INITIALIZATION
# ============================================================

def mark_upload_initialized(
    package_file,
    data,
    publish_id,
):
    """
    Save the TikTok Publish ID.
    """

    data["status"] = "TIKTOK_UPLOAD_INITIALIZED"

    data["tiktok"] = {
        "publish_id": publish_id,
        "status": "UPLOAD_INITIALIZED",
    }

    save_package(
        package_file,
        data,
    )


# ============================================================
# UPDATE PACKAGE AFTER VIDEO UPLOAD
# ============================================================

def mark_upload_complete(
    package_file,
    data,
    publish_id,
):
    """
    Record that TikTok received the video.
    """

    data["status"] = "TIKTOK_UPLOAD_RECEIVED"

    if "tiktok" not in data:
        data["tiktok"] = {}

    data["tiktok"]["publish_id"] = publish_id
    data["tiktok"]["upload_status"] = "RECEIVED"

    save_package(
        package_file,
        data,
    )


# ============================================================
# UPDATE PACKAGE AFTER STATUS CHECK
# ============================================================

def mark_final_status(
    package_file,
    data,
    publish_id,
    success,
):
    """
    Save the final TikTok status result.

    Important:
    SEND_TO_USER_INBOX means TikTok accepted the
    upload and sent it to the authorized user's
    inbox flow. It does NOT mean publicly posted.
    """

    if "tiktok" not in data:
        data["tiktok"] = {}

    data["tiktok"]["publish_id"] = publish_id

    if success:

        data["status"] = "SEND_TO_USER_INBOX"

        data["tiktok"]["status"] = (
            "SEND_TO_USER_INBOX"
        )

        data["tiktok"]["upload_accepted"] = True

        data["tiktok"]["publicly_posted"] = False

        data["tiktok"]["message"] = (
            "TikTok accepted the video and sent it "
            "to the authorized user's inbox flow."
        )

    else:

        data["status"] = "TIKTOK_PUBLISH_FAILED"

        data["tiktok"]["status"] = "FAILED"

        data["tiktok"]["upload_accepted"] = False

        data["tiktok"]["publicly_posted"] = False

    save_package(
        package_file,
        data,
    )


# ============================================================
# DISPLAY RESULT
# ============================================================

def display_result(
    package_file,
    post,
    publish_id,
    success,
):
    """
    Display the complete publishing result.
    """

    print()
    print("==========================================")
    print("       AI TIKTOK PUBLISHER")
    print("==========================================")
    print()

    print("Topic:")
    print(post["topic"])

    print()
    print("Video:")
    print(post["video"])

    print()
    print("Caption:")
    print(post["caption"])

    print()
    print("Hashtags:")
    print(
        " ".join(post["hashtags"])
    )

    print()
    print("TikTok Publish ID:")
    print(publish_id)

    print()

    if success:

        print("==========================================")
        print("          TIKTOK UPLOAD SUCCESS")
        print("==========================================")
        print()

        print(
            "TikTok accepted the video."
        )

        print()
        print(
            "Status: SEND_TO_USER_INBOX"
        )

        print()
        print(
            "The video has been sent to the"
        )

        print(
            "authorized TikTok user's inbox flow."
        )

        print()
        print(
            "Public posting has NOT been confirmed."
        )

    else:

        print("==========================================")
        print("          TIKTOK PUBLISH FAILED")
        print("==========================================")
        print()

        print(
            "TikTok did not report a successful"
        )

        print(
            "SEND_TO_USER_INBOX status."
        )

    print()
    print("Publishing package:")
    print(package_file)

    print()
    print("==========================================")


# ============================================================
# PUBLISH TO TIKTOK
# ============================================================

def publish_to_tiktok(
    package_file,
    data,
):
    """
    Upload the video to TikTok and automatically
    check its publish status.
    """

    # --------------------------------------------------------
    # VALIDATE
    # --------------------------------------------------------

    video_path = validate_package(
        data
    )

    post = build_post(
        data,
        video_path,
    )

    print()
    print("==========================================")
    print("       AI TIKTOK PUBLISHER")
    print("==========================================")
    print()

    print("Publishing package:")
    print(package_file)

    print()
    print("Video:")
    print(video_path)

    print()
    print("Topic:")
    print(post["topic"])

    print()
    print("Caption:")
    print(post["caption"])

    print()
    print("Hashtags:")
    print(
        " ".join(post["hashtags"])
    )

    # --------------------------------------------------------
    # START
    # --------------------------------------------------------

    mark_upload_started(
        package_file,
        data,
    )

    # --------------------------------------------------------
    # INITIALIZE TIKTOK UPLOAD
    # --------------------------------------------------------

    print()
    print("==========================================")
    print("       INITIALIZING TIKTOK UPLOAD")
    print("==========================================")

    publish_id, upload_url = (
        initialize_upload(
            video_path
        )
    )

    print()
    print("TikTok upload initialized.")

    print()
    print("Publish ID:")
    print(publish_id)

    # --------------------------------------------------------
    # SAVE PUBLISH ID
    # --------------------------------------------------------

    mark_upload_initialized(
        package_file,
        data,
        publish_id,
    )

    # --------------------------------------------------------
    # UPLOAD VIDEO
    # --------------------------------------------------------

    upload_video(
        video_path,
        upload_url,
    )

    # --------------------------------------------------------
    # MARK UPLOAD RECEIVED
    # --------------------------------------------------------

    mark_upload_complete(
        package_file,
        data,
        publish_id,
    )

    print()
    print("==========================================")
    print("       TIKTOK VIDEO UPLOAD COMPLETE")
    print("==========================================")
    print()

    print(
        "TikTok has received the video."
    )

    print()
    print(
        "Publish ID:"
    )

    print(
        publish_id
    )

    # --------------------------------------------------------
    # CHECK STATUS AUTOMATICALLY
    # --------------------------------------------------------

    print()
    print("==========================================")
    print("       CHECKING TIKTOK STATUS")
    print("==========================================")

    success = monitor_status(
        publish_id,
        max_attempts=12,
        interval=5,
    )

    # --------------------------------------------------------
    # SAVE FINAL RESULT
    # --------------------------------------------------------

    mark_final_status(
        package_file,
        data,
        publish_id,
        success,
    )

    # --------------------------------------------------------
    # DISPLAY
    # --------------------------------------------------------

    display_result(
        package_file,
        post,
        publish_id,
        success,
    )

    return success


# ============================================================
# MAIN
# ============================================================

def main():

    try:

        # ----------------------------------------------------
        # FIND PACKAGE
        # ----------------------------------------------------

        package_file = find_latest_package()

        print()
        print(
            f"Latest publishing package:\n{package_file}"
        )

        # ----------------------------------------------------
        # LOAD PACKAGE
        # ----------------------------------------------------

        data = load_package(
            package_file
        )

        # ----------------------------------------------------
        # PREVENT ACCIDENTAL DUPLICATE UPLOAD
        # ----------------------------------------------------

        current_status = data.get(
            "status",
            "",
        )

        if current_status == "SEND_TO_USER_INBOX":

            print()
            print("==========================================")
            print("        VIDEO ALREADY PROCESSED")
            print("==========================================")
            print()

            print(
                "This publishing package already has"
            )

            print(
                "a successful SEND_TO_USER_INBOX result."
            )

            print()

            tiktok_data = data.get(
                "tiktok",
                {},
            )

            print(
                "Publish ID:"
            )

            print(
                tiktok_data.get(
                    "publish_id",
                    "Unknown",
                )
            )

            print()

            return

        # ----------------------------------------------------
        # PUBLISH
        # ----------------------------------------------------

        success = publish_to_tiktok(
            package_file,
            data,
        )

        # ----------------------------------------------------
        # EXIT CODE
        # ----------------------------------------------------

        if not success:
            raise SystemExit(1)

    except FileNotFoundError as error:

        print()
        print("==========================================")
        print("             FILE ERROR")
        print("==========================================")
        print()
        print(error)
        print()

        raise SystemExit(1)

    except Exception as error:

        print()
        print("==========================================")
        print("        TIKTOK PUBLISHER ERROR")
        print("==========================================")
        print()
        print(error)
        print()

        raise SystemExit(1)


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    main()

