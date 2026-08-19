import json
import os
import re
import shutil
import subprocess
from pathlib import Path


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
PIPELINE_DIR = OUTPUT_DIR / "pipeline"
VIDEO_DIR = OUTPUT_DIR / "video"
FINAL_DIR = OUTPUT_DIR / "final"
CAPTION_DIR = OUTPUT_DIR / "captions"

FINAL_DIR.mkdir(parents=True, exist_ok=True)
CAPTION_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# HELPERS
# ============================================================

def safe_filename(text):
    return re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        text,
    ).strip("_")


def run_command(command):
    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:
        print()
        print("Command failed:")
        print(" ".join(str(x) for x in command))
        print()
        print(result.stderr)

        raise RuntimeError(
            f"FFmpeg failed with exit code {result.returncode}."
        )

    return result


# ============================================================
# FIND LATEST PIPELINE
# ============================================================

def find_latest_pipeline():
    files = list(
        PIPELINE_DIR.glob("*.json")
    )

    if not files:
        raise RuntimeError(
            "No pipeline JSON files found."
        )

    return max(
        files,
        key=lambda file: file.stat().st_mtime,
    )


# ============================================================
# LOAD PIPELINE
# ============================================================

def load_pipeline(pipeline_file):
    try:
        return json.loads(
            pipeline_file.read_text(
                encoding="utf-8"
            )
        )
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Invalid pipeline JSON:\n{error}"
        ) from error


# ============================================================
# FIND SOURCE VIDEO
# ============================================================

def find_source_video(topic):
    """
    Find the UNCAPTIONED rendered video.

    Priority:
    1. output/video/<topic>.mp4
    2. newest non-captioned MP4 in output/video
    3. existing output/final/<topic>.mp4
    """

    safe_name = safe_filename(topic)

    candidates = [
        VIDEO_DIR / f"{safe_name}.mp4",
        FINAL_DIR / f"{safe_name}.mp4",
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    videos = [
        file
        for file in VIDEO_DIR.glob("*.mp4")
        if "_captioned" not in file.stem.lower()
    ]

    if videos:
        return max(
            videos,
            key=lambda file: file.stat().st_mtime,
        )

    videos = [
        file
        for file in FINAL_DIR.glob("*.mp4")
        if "_captioned" not in file.stem.lower()
    ]

    if videos:
        return max(
            videos,
            key=lambda file: file.stat().st_mtime,
        )

    return None


# ============================================================
# CREATE SRT
# ============================================================

def create_srt(visual_plan, output_file):
    """
    Create subtitle timing from visual-plan narration.

    The renderer uses scene narration and distributes
    timing based on the rendered video's scene structure.
    """

    if not visual_plan:
        raise RuntimeError(
            "Visual plan contains no scenes."
        )

    # Use simple proportional timing.
    total_words = 0

    for scene in visual_plan:
        narration = str(
            scene.get("narration", "")
        ).strip()

        total_words += len(
            narration.split()
        )

    if total_words <= 0:
        raise RuntimeError(
            "Visual plan contains no narration."
        )

    # Read video duration using ffprobe later.
    # Initial SRT uses proportional word timing.
    entries = []

    current_time = 0.0

    # Approximate total duration from narration.
    # The actual FFmpeg video duration is used
    # by the main renderer to keep subtitles valid.
    estimated_duration = max(
        5.0,
        total_words / 2.5,
    )

    for index, scene in enumerate(
        visual_plan,
        start=1,
    ):
        narration = str(
            scene.get("narration", "")
        ).strip()

        if not narration:
            continue

        word_count = len(
            narration.split()
        )

        duration = (
            estimated_duration
            * word_count
            / total_words
        )

        start = current_time
        end = current_time + duration

        entries.append(
            (
                index,
                start,
                end,
                narration,
            )
        )

        current_time = end

    def format_time(seconds):
        milliseconds = int(
            round(
                (seconds - int(seconds))
                * 1000
            )
        )

        total_seconds = int(seconds)

        hours = total_seconds // 3600

        minutes = (
            total_seconds % 3600
        ) // 60

        secs = total_seconds % 60

        return (
            f"{hours:02d}:"
            f"{minutes:02d}:"
            f"{secs:02d},"
            f"{milliseconds:03d}"
        )

    lines = []

    for index, start, end, text in entries:

        lines.append(
            str(index)
        )

        lines.append(
            f"{format_time(start)} --> "
            f"{format_time(end)}"
        )

        lines.append(text)

        lines.append("")

    output_file.write_text(
        "\n".join(lines),
        encoding="utf-8-sig",
    )

    return output_file


# ============================================================
# GET VIDEO DURATION
# ============================================================

def get_duration(video_file):
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_file),
    ]

    result = run_command(command)

    try:
        return float(
            result.stdout.strip()
        )
    except ValueError as error:
        raise RuntimeError(
            f"Could not determine video duration: "
            f"{video_file}"
        ) from error


# ============================================================
# CREATE ACCURATE SRT
# ============================================================

def create_timed_ass(
    visual_plan,
    video_duration,
    output_file,
):
    """
    Create the presentation-style captions used by the reference videos:
    large centered phrase captions plus a smaller full-scene narration line.
    """

    total_words = 0

    for scene in visual_plan:
        narration = str(
            scene.get("narration", "")
        ).strip()

        total_words += len(
            narration.split()
        )

    if total_words == 0:
        raise RuntimeError(
            "No narration was found in visual plan."
        )

    events = []

    current_time = 0.0

    for index, scene in enumerate(
        visual_plan,
        start=1,
    ):

        narration = str(
            scene.get("narration", "")
        ).strip()

        if not narration:
            continue

        word_count = len(
            narration.split()
        )

        duration = (
            video_duration
            * word_count
            / total_words
        )

        start = current_time
        end = min(
            video_duration,
            current_time + duration,
        )

        # The reference format keeps one large caption in the center of the
        # scene card and wraps it into readable short lines.
        focus_lines = []
        current_line = ""
        for word in narration.split():
            candidate = f"{current_line} {word}".strip()
            if len(candidate) <= 19:
                current_line = candidate
            else:
                focus_lines.append(current_line)
                current_line = word
        if current_line:
            focus_lines.append(current_line)

        events.append((start, end, "Focus", r"\N".join(focus_lines)))

        events.append((start, end, "Narration", narration))

        current_time = end

    def format_time(seconds):
        total_centiseconds = int(round(seconds * 100))
        hours, remainder = divmod(total_centiseconds, 360000)
        minutes, remainder = divmod(remainder, 6000)
        secs, centiseconds = divmod(remainder, 100)
        return f"{hours}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"

    def escape_ass(text):
        return (
            text.replace("{", r"\{")
            .replace("}", r"\}")
            .replace("\n", r"\N")
        )

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        "Style: Focus,Arial,86,&H00FFFFFF,&H00000000,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,6,3,5,50,50,260,1",
        "Style: Narration,Arial,31,&H00FFFFFF,&H00000000,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,3,1,2,80,80,115,1",
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]

    for start, end, style, text in events:
        if style == "Focus":
            text = r"{\an5\pos(540,960)\fs100\bord7\shad3}" + escape_ass(text)
        else:
            text = escape_ass(text)
        lines.append(
            "Dialogue: 0,"
            f"{format_time(start)},{format_time(end)},{style},,0,0,0,,"
            f"{text}"
        )

    output_file.write_text(
        "\n".join(lines),
        encoding="utf-8-sig",
    )

    return output_file


# ============================================================
# ADD CAPTIONS
# ============================================================

def add_captions(
    input_video,
    subtitle_file,
    output_video,
):
    """
    Burn subtitles into the video.

    IMPORTANT:
    FFmpeg cannot use the same file for input
    and output, so a temporary file is used.
    """

    temporary_output = (
        output_video.parent
        / f"{output_video.stem}_TEMP.mp4"
    )

    if temporary_output.exists():
        temporary_output.unlink()

    subtitle_path = str(
        subtitle_file.resolve()
    ).replace("\\", "/")

    # Escape characters required by FFmpeg filter syntax.
    subtitle_path = subtitle_path.replace(
        ":",
        r"\:",
    )

    subtitle_filter = (
        f"subtitles='{subtitle_path}':"
        "force_style="
        "'FontName=Arial,"
        "FontSize=20,"
        "PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,"
        "BorderStyle=1,"
        "Outline=2,"
        "Shadow=1,"
        "Alignment=2,"
        "MarginV=120'"
    )

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_video),
        "-vf",
        subtitle_filter,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(temporary_output),
    ]

    run_command(command)

    if not temporary_output.exists():
        raise RuntimeError(
            "FFmpeg completed but the captioned "
            "video was not created."
        )

    # Replace final output safely.
    if output_video.exists():
        output_video.unlink()

    temporary_output.replace(
        output_video
    )

    return output_video


# ============================================================
# MAIN CAPTION RENDERER
# ============================================================

def render_captions():
    print()
    print("==========================================")
    print("        AI CAPTION RENDERER")
    print("==========================================")

    # ----------------------------------------
    # PIPELINE
    # ----------------------------------------

    pipeline_file = (
        find_latest_pipeline()
    )

    print()
    print(
        f"Pipeline: {pipeline_file}"
    )

    data = load_pipeline(
        pipeline_file
    )

    topic = str(
        data.get(
            "topic",
            "",
        )
    ).strip()

    visual_plan = data.get(
        "visual_plan",
        [],
    )

    if not topic:
        raise RuntimeError(
            "Pipeline does not contain a topic."
        )

    if not visual_plan:
        raise RuntimeError(
            "Pipeline does not contain a visual plan."
        )

    # ----------------------------------------
    # SOURCE VIDEO
    # ----------------------------------------

    input_video = find_source_video(
        topic
    )

    if input_video is None:
        raise RuntimeError(
            "No uncaptioned rendered MP4 video was found.\n\n"
            "Expected the renderer output in:\n"
            f"{VIDEO_DIR}"
        )

    print()
    print(
        f"Input video: {input_video}"
    )

    # ----------------------------------------
    # OUTPUT
    # ----------------------------------------

    safe_name = safe_filename(
        topic
    )

    subtitle_file = (
        CAPTION_DIR
        / f"{safe_name}.ass"
    )

    final_video = (
        FINAL_DIR
        / f"{safe_name}_captioned.mp4"
    )

    # Caption policy:
    # - raw_demo / footage-first videos: captions OFF by default
    # - narrated videos: captions ON by default
    # - VIDEO_CAPTIONS=1 or VIDEO_CAPTIONS=0 explicitly overrides the default
    video_style = os.environ.get("VIDEO_STYLE", "raw_demo").strip().lower()
    captions_override = os.environ.get("VIDEO_CAPTIONS")

    if captions_override is None:
        captions_enabled = video_style != "raw_demo"
    else:
        captions_enabled = captions_override.strip() == "1"

    print()
    print(f"Video style: {video_style}")
    print(
        "Captions: ENABLED"
        if captions_enabled
        else "Captions: DISABLED"
    )

    # ----------------------------------------
    # DURATION
    # ----------------------------------------

    duration = get_duration(
        input_video
    )

    print()
    print(
        f"Video duration: "
        f"{duration:.2f} seconds"
    )

    if not captions_enabled:
        print()
        print("Captions disabled for this video mode.")
        shutil.copy2(input_video, final_video)
        print(f"Final video: {final_video}")
        print("STATUS: VIDEO READY WITHOUT CAPTIONS")
        return

    # ----------------------------------------
    # SRT
    # ----------------------------------------

    print()
    print(
        "Creating subtitle file..."
    )

    create_timed_ass(
        visual_plan=visual_plan,
        video_duration=duration,
        output_file=subtitle_file,
    )

    print(
        f"Subtitle file: {subtitle_file}"
    )

    # ----------------------------------------
    # CAPTIONS
    # ----------------------------------------

    print()
    print(
        "Adding captions to video..."
    )

    add_captions(
        input_video=input_video,
        subtitle_file=subtitle_file,
        output_video=final_video,
    )

    # ----------------------------------------
    # VERIFY
    # ----------------------------------------

    if not final_video.exists():
        raise RuntimeError(
            "Captioned video was not created."
        )

    final_duration = get_duration(
        final_video
    )

    print()
    print("==========================================")
    print("       CAPTION RENDER COMPLETE")
    print("==========================================")
    print()
    print(
        f"Final video: {final_video}"
    )
    print(
        f"Duration: {final_duration:.2f} seconds"
    )
    print(
        f"Subtitles: {subtitle_file}"
    )
    print()
    print(
        "STATUS: CAPTIONED VIDEO READY"
    )
    print()


# ============================================================
# MAIN
# ============================================================

def main():

    try:
        render_captions()

    except Exception as error:

        print()
        print("==========================================")
        print("       CAPTION RENDER FAILED")
        print("==========================================")
        print()
        print(error)
        print()

        raise SystemExit(1)


if __name__ == "__main__":
    main()