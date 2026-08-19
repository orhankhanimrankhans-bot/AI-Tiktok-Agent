import json
import subprocess
from pathlib import Path


# ==========================================
# PROJECT CONFIGURATION
# ==========================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
FINAL_DIR = OUTPUT_DIR / "final"

MIN_FILE_SIZE = 100_000
EXPECTED_WIDTH = 1080
EXPECTED_HEIGHT = 1920
EXPECTED_FPS = 30


# ==========================================
# FFPROBE
# ==========================================

def run_ffprobe(video_path):
    """
    Read technical information from the video using ffprobe.
    """

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,size",
        "-show_entries",
        "stream=index,codec_type,codec_name,width,height,r_frame_rate",
        "-of",
        "json",
        str(video_path),
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
        )

    except FileNotFoundError as error:
        raise RuntimeError(
            "ffprobe was not found. Make sure FFmpeg is installed "
            "and available in your PATH."
        ) from error

    except subprocess.CalledProcessError as error:
        raise RuntimeError(
            f"ffprobe failed:\n{error.stderr}"
        ) from error

    try:
        return json.loads(result.stdout)

    except json.JSONDecodeError as error:
        raise RuntimeError(
            "ffprobe returned invalid JSON."
        ) from error


# ==========================================
# FPS PARSER
# ==========================================

def parse_fps(frame_rate):
    """
    Convert a value such as 30/1 into a floating-point FPS value.
    """

    if not frame_rate:
        return 0.0

    try:
        if "/" in frame_rate:
            numerator, denominator = frame_rate.split("/", 1)

            numerator = float(numerator)
            denominator = float(denominator)

            if denominator == 0:
                return 0.0

            return numerator / denominator

        return float(frame_rate)

    except (ValueError, TypeError):
        return 0.0


# ==========================================
# QUALITY CHECK
# ==========================================

def check_video(video_path):
    """
    Perform technical quality checks on a video.
    """

    video_path = Path(video_path)

    print()
    print("==========================================")
    print("          AI VIDEO QUALITY CHECK")
    print("==========================================")
    print()

    print(f"Video: {video_path}")

    # --------------------------------------
    # CHECK 1: FILE EXISTS
    # --------------------------------------

    if not video_path.exists():
        print()
        print("[FAIL] Video file does not exist.")
        return False

    print("[PASS] Video file exists.")

    # --------------------------------------
    # CHECK 2: FILE SIZE
    # --------------------------------------

    file_size = video_path.stat().st_size

    print(
        f"[INFO] File size: {file_size:,} bytes"
    )

    if file_size < MIN_FILE_SIZE:
        print(
            f"[FAIL] File is smaller than "
            f"{MIN_FILE_SIZE:,} bytes."
        )
        return False

    print("[PASS] File size looks valid.")

    # --------------------------------------
    # FFPROBE
    # --------------------------------------

    try:
        probe = run_ffprobe(video_path)

    except RuntimeError as error:
        print()
        print("[FAIL] Could not inspect video.")
        print(error)
        return False

    streams = probe.get("streams", [])
    format_info = probe.get("format", {})

    # --------------------------------------
    # CHECK 3: DURATION
    # --------------------------------------

    duration_text = format_info.get("duration")

    try:
        duration = float(duration_text)
    except (TypeError, ValueError):
        duration = 0.0

    print(
        f"[INFO] Duration: {duration:.2f} seconds"
    )

    if duration <= 0:
        print("[FAIL] Invalid video duration.")
        return False

    print("[PASS] Duration is valid.")

    # --------------------------------------
    # FIND VIDEO STREAM
    # --------------------------------------

    video_stream = None
    audio_stream = None

    for stream in streams:

        codec_type = stream.get("codec_type")

        if codec_type == "video" and video_stream is None:
            video_stream = stream

        if codec_type == "audio" and audio_stream is None:
            audio_stream = stream

    # --------------------------------------
    # CHECK 4: VIDEO STREAM
    # --------------------------------------

    if video_stream is None:
        print("[FAIL] No video stream found.")
        return False

    print("[PASS] Video stream found.")

    # --------------------------------------
    # CHECK 5: VIDEO CODEC
    # --------------------------------------

    video_codec = video_stream.get("codec_name")

    print(
        f"[INFO] Video codec: {video_codec}"
    )

    if video_codec != "h264":
        print(
            "[WARNING] Video codec is not H.264."
        )
    else:
        print("[PASS] H.264 video detected.")

    # --------------------------------------
    # CHECK 6: RESOLUTION
    # --------------------------------------

    width = video_stream.get("width")
    height = video_stream.get("height")

    print(
        f"[INFO] Resolution: {width}x{height}"
    )

    if width != EXPECTED_WIDTH:
        print(
            f"[FAIL] Width should be "
            f"{EXPECTED_WIDTH}px."
        )
        return False

    if height != EXPECTED_HEIGHT:
        print(
            f"[FAIL] Height should be "
            f"{EXPECTED_HEIGHT}px."
        )
        return False

    print(
        "[PASS] Vertical 1080x1920 resolution confirmed."
    )

    # --------------------------------------
    # CHECK 7: FPS
    # --------------------------------------

    frame_rate_text = video_stream.get(
        "r_frame_rate"
    )

    fps = parse_fps(frame_rate_text)

    print(
        f"[INFO] FPS: {fps:.2f}"
    )

    if abs(fps - EXPECTED_FPS) > 0.1:
        print(
            f"[WARNING] FPS is not exactly "
            f"{EXPECTED_FPS}."
        )
    else:
        print("[PASS] 30 FPS confirmed.")

    # --------------------------------------
    # CHECK 8: AUDIO
    # --------------------------------------

    if audio_stream is None:
        print("[FAIL] No audio stream found.")
        return False

    print("[PASS] Audio stream found.")

    audio_codec = audio_stream.get("codec_name")

    print(
        f"[INFO] Audio codec: {audio_codec}"
    )

    if audio_codec == "aac":
        print("[PASS] AAC audio detected.")
    else:
        print(
            "[WARNING] Audio codec is not AAC."
        )

    # --------------------------------------
    # FINAL RESULT
    # --------------------------------------

    print()
    print("==========================================")

    print("             QUALITY RESULT")

    print("==========================================")

    print()
    print("STATUS: APPROVED")
    print()
    print("The video passed the required technical checks.")
    print()
    print(f"Duration:   {duration:.2f}s")
    print(f"Resolution: {width}x{height}")
    print(f"FPS:        {fps:.2f}")
    print(f"Video:      {video_codec}")
    print(f"Audio:      {audio_codec}")
    print(f"Size:       {file_size:,} bytes")
    print()

    return True


# ==========================================
# FIND LATEST FINAL VIDEO
# ==========================================

def find_latest_final_video():
    """
    Find the newest MP4 file inside output/final.
    """

    if not FINAL_DIR.exists():
        return None

    videos = list(
        FINAL_DIR.glob("*.mp4")
    )

    if not videos:
        return None

    return max(
        videos,
        key=lambda file: file.stat().st_mtime
    )


# ==========================================
# MAIN
# ==========================================

def main():

    video_path = find_latest_final_video()

    if video_path is None:
        print()
        print("No final MP4 video was found.")
        print()
        print(
            f"Expected folder: {FINAL_DIR}"
        )
        print()

        raise SystemExit(1)

    approved = check_video(
        video_path
    )

    if not approved:
        print()
        print("STATUS: REJECTED")
        print()
        raise SystemExit(1)


if __name__ == "__main__":
    main()