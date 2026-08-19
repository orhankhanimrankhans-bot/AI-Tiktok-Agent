import re
import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
FINAL_DIR = OUTPUT_DIR / "final"

FINAL_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


def run_ffmpeg(command):
    """Run FFmpeg and raise an error if it fails."""

    print()
    print("Running FFmpeg...")

    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:
        print(result.stderr)

        raise RuntimeError(
            "FFmpeg failed while burning captions."
        )

    return result


def safe_filename(text):
    """Create a safe Windows filename."""

    return re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        text,
    ).strip("_")


def find_latest_video():
    """Find the newest rendered MP4."""

    video_dir = OUTPUT_DIR / "video"

    videos = list(
        video_dir.glob("*.mp4")
    )

    if not videos:
        raise FileNotFoundError(
            "No rendered MP4 video was found in output\\video."
        )

    return max(
        videos,
        key=lambda file: file.stat().st_mtime,
    )


def find_caption_file():
    """Find the newest ASS caption file."""

    caption_dir = OUTPUT_DIR / "captions"

    files = list(
        caption_dir.glob("*.ass")
    )

    if not files:
        raise FileNotFoundError(
            "No ASS caption file was found in output\\captions."
        )

    return max(
        files,
        key=lambda file: file.stat().st_mtime,
    )


def burn_captions(
    video_path=None,
    caption_path=None,
):
    """Burn ASS captions permanently into the video."""

    if video_path is None:
        video_path = find_latest_video()

    if caption_path is None:
        caption_path = find_caption_file()

    video_path = Path(video_path)
    caption_path = Path(caption_path)

    if not video_path.exists():
        raise FileNotFoundError(
            f"Video not found: {video_path}"
        )

    if not caption_path.exists():
        raise FileNotFoundError(
            f"Caption file not found: {caption_path}"
        )

    output_name = (
        safe_filename(video_path.stem)
        + "_captioned.mp4"
    )

    output_path = FINAL_DIR / output_name

    print()
    print("==========================================")
    print("          AI CAPTION BURNER")
    print("==========================================")
    print()
    print(f"Video:    {video_path}")
    print(f"Captions: {caption_path}")
    print(f"Output:   {output_path}")

    # FFmpeg subtitles filter requires a properly escaped path.
    caption_filter_path = str(
        caption_path
    ).replace("\\", "/")

    # Escape characters important to FFmpeg filter syntax.
    caption_filter_path = (
        caption_filter_path
        .replace(":", "\\:")
        .replace("'", "\\'")
    )

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vf",
        f"ass='{caption_filter_path}'",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]

    run_ffmpeg(command)

    if not output_path.exists():
        raise RuntimeError(
            "FFmpeg completed, but the final video was not created."
        )

    print()
    print("==========================================")
    print("       CAPTION BURN COMPLETE")
    print("==========================================")
    print()
    print(f"Final video: {output_path}")
    print()

    return output_path


def main():
    burn_captions()


if __name__ == "__main__":
    main()