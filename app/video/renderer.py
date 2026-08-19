import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.video.pexels_footage import download_footage


# ==========================================
# PROJECT CONFIGURATION
# ==========================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
PIPELINE_DIR = OUTPUT_DIR / "pipeline"
VIDEO_DIR = OUTPUT_DIR / "video"
SCENE_DIR = VIDEO_DIR / "scenes"

VIDEO_DIR.mkdir(parents=True, exist_ok=True)
SCENE_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
FPS = 30
TARGET_DURATION_SECONDS = float(os.environ.get("VIDEO_DURATION_SECONDS", "45"))
# The reference is a continuous practical demonstration with natural sound.
# Set VIDEO_STYLE=narrated to restore the old voice-over, multi-scene output.
RAW_DEMO_MODE = os.environ.get("VIDEO_STYLE", "raw_demo").strip().lower() == "raw_demo"

VOICE_FILE = OUTPUT_DIR / "ai_tiktok_test.wav"


# ==========================================
# HELPERS
# ==========================================

def run_command(command):
    """Run an FFmpeg/FFprobe command."""

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
            f"Command failed with exit code {result.returncode}."
        )

    return result


def get_duration(file_path):
    """Return media duration in seconds using ffprobe."""

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(file_path),
    ]

    result = run_command(command)

    try:
        return float(result.stdout.strip())
    except ValueError as error:
        raise RuntimeError(
            f"Could not determine duration of: {file_path}"
        ) from error


def safe_filename(text):
    """Create a safe Windows filename."""

    return re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        text,
    ).strip("_")


# ==========================================
# FONT
# ==========================================

def get_font(size=54):
    """Find a usable Windows font."""

    possible_fonts = [
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/calibri.ttf"),
    ]

    for font_path in possible_fonts:
        if font_path.exists():
            return ImageFont.truetype(
                str(font_path),
                size,
            )

    return ImageFont.load_default()


# ==========================================
# CREATE SCENE IMAGE
# ==========================================

def create_scene_image(
    scene_number,
    narration,
    visual_prompt,
):
    """
    Create a simple vertical visual card.

    This version uses PIL so the renderer does not
    require MoviePy or OpenCV.
    """

    image = Image.new(
        "RGB",
        (VIDEO_WIDTH, VIDEO_HEIGHT),
        "black",
    )


def footage_query_for_topic(topic):
    """Convert a channel topic into terms that stock-footage search understands."""

    topic_lower = topic.lower()
    query_map = {
        "trench": "excavator construction site digging trench",
        "tunnel": "tunnel boring machine construction",
        "hydraulic press": "hydraulic press metal factory",
        "concrete pump": "concrete pump construction site",
        "waterjet": "waterjet cutting metal factory",
        "road milling": "road milling machine asphalt construction",
        "recycling": "recycling plant sorting machinery",
        "cnc": "CNC machine cutting metal factory",
        "packaging": "automated packaging machine factory",
        "mobile crane": "mobile crane construction site lifting",
    }
    for marker, query in query_map.items():
        if marker in topic_lower:
            return query
    return topic

    draw = ImageDraw.Draw(image)

    # Background
    draw.rectangle(
        [0, 0, VIDEO_WIDTH, VIDEO_HEIGHT],
        fill=(18, 18, 24),
    )

    # Main visual area
    margin = 70

    draw.rounded_rectangle(
        [
            margin,
            220,
            VIDEO_WIDTH - margin,
            1250,
        ],
        radius=40,
        fill=(35, 35, 45),
        outline=(100, 100, 110),
        width=3,
    )

    # Scene label
    title_font = get_font(58)

    draw.text(
        (80, 90),
        f"SCENE {scene_number}",
        font=title_font,
        fill="white",
    )

    # Visual prompt
    visual_font = get_font(42)

    visual_text = visual_prompt.strip()

    visual_lines = []
    words = visual_text.split()

    current_line = ""

    for word in words:
        test_line = (
            current_line + " " + word
        ).strip()

        bbox = draw.textbbox(
            (0, 0),
            test_line,
            font=visual_font,
        )

        if bbox[2] <= VIDEO_WIDTH - 180:
            current_line = test_line
        else:
            if current_line:
                visual_lines.append(current_line)

            current_line = word

    if current_line:
        visual_lines.append(current_line)

    y = 450

    for line in visual_lines:
        bbox = draw.textbbox(
            (0, 0),
            line,
            font=visual_font,
        )

        text_width = bbox[2] - bbox[0]

        draw.text(
            (
                (VIDEO_WIDTH - text_width) / 2,
                y,
            ),
            line,
            font=visual_font,
            fill="white",
        )

        y += 65

    # Narration section
    narration_font = get_font(38)

    narration_text = narration.strip()

    narration_lines = []
    words = narration_text.split()

    current_line = ""

    for word in words:
        test_line = (
            current_line + " " + word
        ).strip()

        bbox = draw.textbbox(
            (0, 0),
            test_line,
            font=narration_font,
        )

        if bbox[2] <= VIDEO_WIDTH - 180:
            current_line = test_line
        else:
            if current_line:
                narration_lines.append(
                    current_line
                )

            current_line = word

    if current_line:
        narration_lines.append(current_line)

    y = 1380

    for line in narration_lines:
        bbox = draw.textbbox(
            (0, 0),
            line,
            font=narration_font,
        )

        text_width = bbox[2] - bbox[0]

        draw.text(
            (
                (VIDEO_WIDTH - text_width) / 2,
                y,
            ),
            line,
            font=narration_font,
            fill="white",
        )

        y += 55

    image_path = (
        SCENE_DIR /
        f"scene_{scene_number:02d}.png"
    )

    image.save(
        image_path,
        "PNG",
    )

    return image_path


# ==========================================
# CREATE SCENE VIDEO
# ==========================================

def create_scene_video(
    image_path,
    output_path,
    duration,
):
    """Convert a scene image into an MP4."""

    command = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-i",
        str(image_path),
        "-t",
        f"{duration:.3f}",
        "-vf",
        (
            f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:"
            "force_original_aspect_ratio=decrease,"
            f"pad={VIDEO_WIDTH}:{VIDEO_HEIGHT}:"
            "(ow-iw)/2:(oh-ih)/2"
        ),
        "-r",
        str(FPS),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        str(output_path),
    ]

    run_command(command)

    return output_path


def create_footage_scene_video(source_path, output_path, duration):
    """Turn a downloaded real-world clip into a vertical scene with ambience."""

    command = [
        "ffmpeg",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        str(source_path),
        "-t",
        f"{duration:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        (
            f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:"
            "force_original_aspect_ratio=increase,"
            f"crop={VIDEO_WIDTH}:{VIDEO_HEIGHT},"
            "setsar=1,"
            f"fps={FPS}"
        ),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        str(output_path),
    ]

    run_command(command)
    return output_path


# ==========================================
# COMBINE SCENES
# ==========================================

def combine_scenes(
    scene_videos,
    output_video,
):
    """Combine scene MP4 files into one video."""

    concat_file = (
        VIDEO_DIR /
        "scene_concat.txt"
    )

    with open(
        concat_file,
        "w",
        encoding="utf-8",
    ) as file:

        for video in scene_videos:
            file.write(
                "file '"
                + str(video).replace(
                    "\\",
                    "/",
                )
                + "'\n"
            )

    command = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file),
        "-c",
        "copy",
        str(output_video),
    ]

    run_command(command)

    return output_video


# ==========================================
# ADD VOICE
# ==========================================

def add_voice(
    video_path,
    voice_path,
    final_path,
):
    """Add the generated voice to the video."""

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-i",
        str(voice_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        str(final_path),
    ]

    run_command(command)

    return final_path


# ==========================================
# FIND LATEST PIPELINE
# ==========================================

def find_latest_pipeline():
    """Find the newest pipeline JSON file."""

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


# ==========================================
# LOAD PIPELINE
# ==========================================

def load_pipeline(pipeline_file):
    """Load pipeline JSON."""

    with open(
        pipeline_file,
        "r",
        encoding="utf-8",
    ) as file:

        data = json.load(file)

    return data


# ==========================================
# RENDER VIDEO
# ==========================================

def render_video():
    """Main video rendering process."""

    pipeline_file = (
        find_latest_pipeline()
    )

    print(
        f"Using latest pipeline: "
        f"{pipeline_file.name}"
    )

    data = load_pipeline(
        pipeline_file
    )

    topic = data.get(
        "topic",
        "AI TikTok Video",
    )

    visual_plan = data.get(
        "visual_plan",
        [],
    )

    if not visual_plan:
        raise RuntimeError(
            "Pipeline contains no visual scenes."
        )

    print()
    print("==========================================")
    print("          AI VIDEO RENDERER")
    print("==========================================")
    print()
    print(f"Topic: {topic}")
    print(
        f"Scenes: {len(visual_plan)}"
    )

    if RAW_DEMO_MODE:
        print(f"Style: raw real-world demonstration ({TARGET_DURATION_SECONDS:.0f}s)")
        print("Audio: original clip ambience")

        source_path = download_footage(
            query=footage_query_for_topic(topic),
            scene_number=1,
            minimum_duration=TARGET_DURATION_SECONDS,
        )
        raw_demo_video = VIDEO_DIR / "scene_01.mp4"
        create_footage_scene_video(
            source_path=source_path,
            output_path=raw_demo_video,
            duration=TARGET_DURATION_SECONDS,
        )
        scene_videos = [raw_demo_video]
        final_duration_target = TARGET_DURATION_SECONDS
        print(f"Footage: {source_path}")
    else:
        voice_path = VOICE_FILE
        if not voice_path.exists():
            raise RuntimeError(f"Voice file not found: {voice_path}")

        voice_duration = get_duration(voice_path)
        scene_count = len(visual_plan)
        base_duration = voice_duration / scene_count
        final_duration_target = voice_duration
        scene_videos = []

        for index, scene in enumerate(visual_plan, start=1):

            print()
            print(f"Rendering scene {index}...")

            narration = scene.get("narration", "")

            visual_prompt = scene.get(
                "visual_prompt",
                "Realistic visual matching the narration.",
            )

            if index == scene_count:
                duration = voice_duration - (base_duration * (scene_count - 1))
            else:
                duration = base_duration

            video_path = VIDEO_DIR / f"scene_{index:02d}.mp4"

            source_path = download_footage(
                query=visual_prompt or topic,
                scene_number=index,
                minimum_duration=duration,
            )

            create_footage_scene_video(
                source_path=source_path,
                output_path=video_path,
                duration=duration,
            )

            print(f"  Footage: {source_path}")

            print(f"  Video: {video_path}")

            print(f"  Duration: {duration:.2f}s")

            scene_videos.append(video_path)

    # --------------------------------------
    # COMBINE
    # --------------------------------------

    print()
    print("Combining scenes...")

    silent_video = (
        VIDEO_DIR /
        "silent_video.mp4"
    )

    combine_scenes(
        scene_videos,
        silent_video,
    )

    # --------------------------------------
    # ADD AUDIO
    # --------------------------------------

    safe_topic_name = safe_filename(
        topic
    )

    final_video = (
        VIDEO_DIR /
        f"{safe_topic_name}.mp4"
    )

    if RAW_DEMO_MODE:
        shutil.copy2(silent_video, final_video)
    else:
        print()
        print("Adding voice audio...")
        add_voice(
            video_path=silent_video,
            voice_path=voice_path,
            final_path=final_video,
        )

    # --------------------------------------
    # VERIFY
    # --------------------------------------

    final_duration = get_duration(
        final_video
    )

    print()
    print("==========================================")
    print("        VIDEO RENDER COMPLETE")
    print("==========================================")
    print()
    print(
        f"Final video: {final_video}"
    )
    print(
        f"Final duration: "
        f"{final_duration:.2f} seconds"
    )
    print(
        "Resolution: 1080x1920"
    )
    print(
        "FPS: 30"
    )
    print(
        "Video: H.264"
    )
    print(
        "Audio: AAC"
    )
    print()


# ==========================================
# MAIN
# ==========================================

def main():
    render_video()


if __name__ == "__main__":
    main()
