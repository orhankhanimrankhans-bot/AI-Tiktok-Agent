import json
import re
import urllib.request
import urllib.error
from pathlib import Path


OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "phi3:latest"

PROJECT_ROOT = Path(__file__).resolve().parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output" / "visual"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def ask_ollama(prompt, max_tokens=700):
    data = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": max_tokens,
        },
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.loads(
                response.read().decode("utf-8")
            )

    except urllib.error.URLError as error:
        raise RuntimeError(
            f"Could not connect to Ollama at {OLLAMA_URL}. "
            f"Make sure Ollama is running. Details: {error}"
        ) from error

    if "response" not in result:
        raise RuntimeError(
            f"Ollama returned an unexpected response: {result}"
        )

    return result["response"].strip()


def clean_json_response(text):
    text = text.strip()

    text = re.sub(
        r"^```json\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )

    text = re.sub(
        r"^```\s*",
        "",
        text,
    )

    text = re.sub(
        r"\s*```$",
        "",
        text,
    )

    return text.strip()


def create_visual_plan(script, topic):
    if not script or not script.strip():
        raise ValueError("Script cannot be empty.")

    if not topic or not topic.strip():
        raise ValueError("Topic cannot be empty.")

    prompt = f"""
You are a professional TikTok visual planner.

Create a visual plan for a short faceless TikTok video.

TOPIC:
{topic}

SCRIPT:
{script}

RULES:

- Split the script into logical visual scenes.
- Create 4 to 8 scenes when the script length allows.
- Each scene must contain one narration section.
- Keep narration exactly as provided.
- Do not rewrite the narration.
- Do not add facts.
- Visuals must directly match the narration.
- Use cinematic, realistic visual descriptions.
- No camera directions.
- No text overlays.
- No subtitles.
- No logos.
- No people speaking directly to camera.
- Return ONLY valid JSON.
- Do not use Markdown.
- Every scene must contain:
  scene
  narration
  visual_prompt
  duration_hint

JSON FORMAT:

[
  {{
    "scene": 1,
    "narration": "exact narration",
    "visual_prompt": "detailed realistic cinematic visual description",
    "duration_hint": 3
  }}
]
"""

    response = ask_ollama(
        prompt,
        max_tokens=700,
    )

    response = clean_json_response(response)

    try:
        scenes = json.loads(response)

    except json.JSONDecodeError as error:
        raise ValueError(
            "Ollama did not return valid JSON.\n\n"
            f"Raw response:\n{response}"
        ) from error

    if not isinstance(scenes, list):
        raise ValueError(
            "Visual plan must be a JSON list."
        )

    validated_scenes = []

    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            continue

        validated_scene = {
            "scene": scene.get("scene", index),
            "narration": scene.get("narration", ""),
            "visual_prompt": scene.get("visual_prompt", ""),
            "duration_hint": scene.get("duration_hint", 3),
        }

        if not validated_scene["narration"]:
            raise ValueError(
                f"Scene {index} is missing narration."
            )

        if not validated_scene["visual_prompt"]:
            raise ValueError(
                f"Scene {index} is missing visual_prompt."
            )

        validated_scenes.append(validated_scene)

    if not validated_scenes:
        raise ValueError(
            "Ollama returned an empty visual plan."
        )

    return validated_scenes


def save_visual_plan(scenes, topic):
    safe_topic = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        topic.strip(),
    ).strip("_")

    if not safe_topic:
        safe_topic = "visual_plan"

    output_file = OUTPUT_DIR / f"{safe_topic}.json"

    with open(
        output_file,
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            scenes,
            file,
            indent=2,
            ensure_ascii=False,
        )

    return output_file


def main():
    topic = "Surprising facts about gravity"

    script = (
        "Gravity is one of the most important forces in the universe. "
        "It keeps planets in orbit around stars. "
        "It also keeps us standing on the surface of Earth."
    )

    print()
    print("=== AI VISUAL PLANNER ===")
    print()
    print(f"Topic: {topic}")
    print()
    print("Generating visual plan with Ollama...")
    print()

    scenes = create_visual_plan(
        script=script,
        topic=topic,
    )

    output_file = save_visual_plan(
        scenes=scenes,
        topic=topic,
    )

    print(f"Generated {len(scenes)} scenes.")
    print()
    print(f"Saved to: {output_file}")
    print()

    for scene in scenes:
        print(f"Scene {scene['scene']}")
        print(f"Narration: {scene['narration']}")
        print(f"Visual: {scene['visual_prompt']}")
        print(f"Duration: {scene['duration_hint']}s")
        print("-" * 60)


if __name__ == "__main__":
    main()