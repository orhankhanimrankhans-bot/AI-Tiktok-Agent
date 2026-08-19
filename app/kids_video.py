"""Create an original vertical storybook video from a generated kids story."""

import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

from app.config import ask_gemini, generate_gemini_image
from app.voice_generator import create_voice

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
STORIES = OUTPUT / "kids_stories"
SCENES = STORIES / "scenes"
VIDEO = OUTPUT / "video"
FINAL = OUTPUT / "final"
for folder in (STORIES, SCENES, VIDEO, FINAL):
    folder.mkdir(parents=True, exist_ok=True)


def _run(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-1200:] or "FFmpeg could not render the story video.")


def _duration(path):
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
    return float(result.stdout.strip())


def _storyboard(story):
    prompt = f"""Return JSON only: {{"character_bible":"...", "scenes":["...","...","...","...","...","..."]}}.
Create exactly six original 3D animated-storybook visual scenes for this kids story. The character bible must lock the main character's colors, clothes, and features so every scene matches. Scene text must be visual only. Do not mention existing cartoons, studios, logos, brands, or words on screen.

Story: {story}"""
    raw = ask_gemini(prompt, max_tokens=900, timeout=90)
    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if not match:
        raise RuntimeError("Gemini could not create a visual storyboard.")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise RuntimeError("Gemini returned an invalid visual storyboard.") from error
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or len(scenes) != 6:
        raise RuntimeError("Gemini storyboard must contain six scenes.")
    return str(data.get("character_bible", "friendly original story character")), [str(scene) for scene in scenes]


def _render_scene(image, output, duration):
    frames = max(1, int(duration * 30))
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,"
        f"zoompan=z='min(zoom+0.00035,1.08)':d={frames}:s=1080x1920:fps=30,format=yuv420p"
    )
    _run(["ffmpeg", "-y", "-loop", "1", "-i", str(image), "-t", f"{duration:.3f}", "-vf", vf,
          "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(output)])


def create_kids_video(story):
    """Generate six illustrations, Piper narration, and a reviewable MP4. Never publishes."""
    story = re.sub(r"\s+", " ", str(story or "").strip())
    if len(story.split()) < 80:
        raise ValueError("Create a complete kids story before making a video.")
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_scenes = SCENES / run_id
    run_scenes.mkdir(parents=True, exist_ok=True)
    character_bible, storyboard = _storyboard(story)

    images = []
    for index, scene in enumerate(storyboard, start=1):
        prompt = f"""Original vertical 9:16 3D animated storybook illustration for children. Warm cinematic lighting, expressive faces, family-friendly, no text, no logos, no watermark.
Character consistency: {character_bible}
Scene {index}: {scene}"""
        data, mime = generate_gemini_image(prompt, timeout=180)
        image = run_scenes / f"scene_{index:02d}{'.jpg' if 'jpeg' in mime.lower() else '.png'}"
        image.write_bytes(data)
        images.append(image)

    voice = create_voice(story, filename=f"kids_story_{run_id}.wav")
    scene_duration = max(55.0, _duration(voice)) / len(images)
    clips = []
    for index, image in enumerate(images, start=1):
        clip = run_scenes / f"scene_{index:02d}.mp4"
        _render_scene(image, clip, scene_duration)
        clips.append(clip)
    concat = run_scenes / "concat.txt"
    concat.write_text("".join(f"file '{clip.as_posix()}'\n" for clip in clips), encoding="utf-8")
    silent = VIDEO / f"kids_story_{run_id}.mp4"
    _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(silent)])
    final = FINAL / f"kids_story_{run_id}.mp4"
    _run(["ffmpeg", "-y", "-i", str(silent), "-i", str(voice), "-map", "0:v:0", "-map", "1:a:0",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(final)])
    (STORIES / f"kids_story_{run_id}.json").write_text(json.dumps({"story": story, "video": str(final)}, indent=2), encoding="utf-8")
    return final
