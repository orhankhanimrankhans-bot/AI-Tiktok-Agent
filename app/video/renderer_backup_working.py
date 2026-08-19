import json
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


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


# ==========================================
# VIDEO SETTINGS
# ==========================================

VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
FPS = 30


# ==========================================
# FONT
# ==========================================

def get_font(size=48):
    font_paths = [
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
        Path(r"C:\Windows\Fonts\calibri.ttf"),
    ]

    for font_path in font_paths:
        if font_path.exists():
            return ImageFont.truetype(str(font_path), size)

    return ImageFont.load_default()


# ==========================================
# TEXT WRAPPING
# ==========================================

def wrap_text(draw, text, font, max_width):
    words = text.split()

    if not words:
        return []

    lines = []
    current = words[0]

    for word in words[1:]:
        test = current + " " + word
        box = draw.textbbox((0, 0), test, font=font)
        width = box[2] - box[0]

        if width <= max_width:
            current = test
        else:
            lines.append(current)
            current = word

    lines.append(current)
    return lines


# ==========================================
# LOAD PIPELINE
# ==========================================

def load_pipeline_data(pipeline_file):
    pipeline_file = Path(pipeline_file)

    if not pipeline_file.exists():
        raise FileNotFoundError(
            f"Pipeline file not found: {pipeline_file}"
        )

    with open(pipeline_file, "r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        raise RuntimeError("Pipeline JSON must contain an object.")

    return data


# ==========================================
# CREATE SCENE IMAGE
# ==========================================

def create_scene_image(scene_number, narration, visual_prompt):
    image = Image.new(
        "RGB",
        (VIDEO_WIDTH, VIDEO_HEIGHT),
        (18, 18, 18),
    )

    draw = ImageDraw.Draw(image)

    title_font = get_font(72)
    visual_font = get_font(48)
    narration_font = get_font(38)

    # Scene number
    title = f"SCENE {scene_number}"
    box = draw.textbbox((0, 0), title, font=title_font)
    title_width = box[2] - box[0]

    draw.text(
        ((VIDEO_WIDTH - title_width) / 2, 180),
        title,
        font=title_font,
        fill="white",
    )

    # Visual description
    visual_lines = wrap_text(
        draw,
        visual_prompt.strip(),
        visual_font,
        VIDEO_WIDTH - 160,
    )

    y = 650

    for line in visual_lines:
        box = draw.textbbox((0, 0), line, font=visual_font)
        width = box[2] - box[0]

        draw.text(
            ((VIDEO_WIDTH - width) / 2, y),
            line,
            font=visual_font,
            fill="white",
        )

        y += 65

    # Narration
    narration_lines = wrap_text(
        draw,
        narration.strip(),
        narration_font,
        VIDEO_WIDTH - 180,
    )

    y = 1300

    for line in narration_lines:
        box = draw.textbbox((0, 0), line, font=narration_font)
        width = box[2] - box[0]

        draw.text(
            ((VIDEO_WIDTH - width) / 2, y),
            line,
            font=narration_font,
            fill="white",
        )

        y += 52

    output_file = SCENE_DIR / f"scene_{scene_number:02d}.png"

    image.save(output_file, "PNG")

    return output_file


# ==========================================
# CREATE SCENE VIDEO
# ==========================================

def create_scene_video(image_file, output_file, duration=3):
    command = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-i",
        str(image_file),
        "-t",
        str(duration),
        "-r",
        str(FPS),
        "-vf",
        f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT},format=yuv420p",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(output_file),
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            "FFmpeg failed while creating the scene video:\n"
            + result.stderr
        )

    return output_file


# ==========================================
# CONCATENATE SCENES
# ==========================================

def concatenate_videos(scene_files, output_file):
    list_file = VIDEO_DIR / "scene_list.txt"

    with open(list_file, "w", encoding="utf-8") as file:
        for scene_file in scene_files:
            path = Path(scene_file).resolve().as_posix()
            file.write(f"file '{path}'\n")

    command = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c",
        "copy",
        str(output_file),
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            "FFmpeg failed while joining scenes:\n"
            + result.stderr
        )

    return output_file


# ==========================================
# RENDER VIDEO
# ==========================================

def render_video(pipeline_file):
    print()
    print("==========================================")
    print("          AI VIDEO RENDERER")
    print("==========================================")
    print()

    data = load_pipeline_data(pipeline_file)

    topic = data.get("topic", "AI TikTok Video")
    visual_plan = data.get("visual_plan", [])

    if not visual_plan:
        raise RuntimeError(
            "Pipeline contains no visual scenes."
        )

    print(f"Topic: {topic}")
    print(f"Scenes: {len(visual_plan)}")
    print()

    scene_videos = []

    for scene in visual_plan:
        scene_number = int(scene.get("scene", 1))
        narration = str(scene.get("narration", ""))
        visual_prompt = str(scene.get("visual_prompt", ""))
        duration = int(scene.get("duration_hint", 3))

        print(f"Rendering scene {scene_number}...")

        image_file = create_scene_image(
            scene_number,
            narration,
            visual_prompt,
        )

        video_file = VIDEO_DIR / f"scene_{scene_number:02d}.mp4"

        create_scene_video(
            image_file,
            video_file,
            duration,
        )

        scene_videos.append(video_file)

        print(f"  Image: {image_file}")
        print(f"  Video: {video_file}")

    safe_topic = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        topic,
    ).strip("_")

    final_video = VIDEO_DIR / f"{safe_topic}.mp4"

    print()
    print("Combining scenes...")

    concatenate_videos(
        scene_videos,
        final_video,
    )

    print()
    print("==========================================")
    print("        VIDEO RENDER COMPLETE")
    print("==========================================")
    print()
    print(f"Final video: {final_video}")

    return final_video


# ==========================================
# MAIN
# ==========================================

def main():
    pipeline_files = sorted(
        PIPELINE_DIR.glob("*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    if not pipeline_files:
        raise RuntimeError(
            f"No pipeline JSON files found in {PIPELINE_DIR}"
        )

    latest_pipeline = pipeline_files[0]

    print(f"Using latest pipeline: {latest_pipeline.name}")

    render_video(latest_pipeline)


if __name__ == "__main__":
    main()