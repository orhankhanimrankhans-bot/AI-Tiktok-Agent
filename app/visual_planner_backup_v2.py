import json
import re
import urllib.request
import urllib.error
from pathlib import Path


# ==========================================
# OLLAMA CONFIGURATION
# ==========================================

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "phi3:latest"

PROJECT_ROOT = Path(__file__).resolve().parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output" / "visual"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ==========================================
# OLLAMA REQUEST
# ==========================================

def ask_ollama(prompt, max_tokens=300, timeout=180):

    data = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": max_tokens
        }
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Content-Type": "application/json"
        }
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=timeout
        ) as response:

            result = json.loads(
                response.read().decode("utf-8")
            )

        return result["response"].strip()

    except urllib.error.URLError as error:

        raise RuntimeError(
            f"Ollama connection failed: {error}"
        ) from error

    except TimeoutError as error:

        raise RuntimeError(
            f"Ollama timed out after {timeout} seconds."
        ) from error


# ==========================================
# CLEAN JSON
# ==========================================

def clean_json_response(text):

    text = text.strip()

    # Remove markdown code fences
    text = re.sub(
        r"^```json\s*",
        "",
        text,
        flags=re.IGNORECASE
    )

    text = re.sub(
        r"^```\s*",
        "",
        text
    )

    text = re.sub(
        r"\s*```$",
        "",
        text
    )

    # Find the JSON array if Ollama added extra text
    start = text.find("[")
    end = text.rfind("]")

    if start != -1 and end != -1:
        text = text[start:end + 1]

    return text.strip()


# ==========================================
# CREATE VISUAL PLAN
# ==========================================

def create_visual_plan(script, topic):

    prompt = f"""
You are a professional TikTok visual planner.

Create a visual plan for this faceless TikTok video.

TOPIC:
{topic}

SCRIPT:
{script}

IMPORTANT:
- Use ONLY information from the script.
- Do not add facts.
- Keep every narration sentence exactly unchanged.
- Create 3 to 6 scenes.
- Each scene must have one narration section.
- Visuals must directly match the narration.
- Make visuals realistic and cinematic.
- No camera directions.
- No text overlays.
- No subtitles.
- No logos.
- No people speaking to camera.
- Return ONLY JSON.
- Do not explain anything.

Return exactly this structure:

[
  {{
    "scene": 1,
    "narration": "exact narration",
    "visual_prompt": "realistic visual description",
    "duration_hint": 3
  }}
]
"""

    print("Generating visual plan with Ollama...")

    response = ask_ollama(
        prompt,
        max_tokens=300,
        timeout=180
    )

    response = clean_json_response(response)

    try:
        scenes = json.loads(response)

    except json.JSONDecodeError as error:

        print("\nOllama returned invalid JSON:")
        print(response)

        raise RuntimeError(
            "Visual planner received invalid JSON from Ollama."
        ) from error

    if not isinstance(scenes, list):
        raise RuntimeError(
            "Visual planner response is not a JSON list."
        )

    # Basic validation
    valid_scenes = []

    for scene in scenes:

        if not isinstance(scene, dict):
            continue

        if "scene" not in scene:
            continue

        if "narration" not in scene:
            continue

        if "visual_prompt" not in scene:
            continue

        if "duration_hint" not in scene:
            scene["duration_hint"] = 3

        valid_scenes.append(scene)

    if not valid_scenes:
        raise RuntimeError(
            "Ollama returned no valid visual scenes."
        )

    print(
        f"Generated {len(valid_scenes)} scenes."
    )

    return valid_scenes


# ==========================================
# SAVE VISUAL PLAN
# ==========================================

def save_visual_plan(scenes, topic):

    safe_topic = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        topic
    ).strip("_")

    output_file = (
        OUTPUT_DIR /
        f"{safe_topic}.json"
    )

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            scenes,
            file,
            indent=2,
            ensure_ascii=False
        )

    return output_file


# ==========================================
# TEST
# ==========================================

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

    scenes = create_visual_plan(
        script,
        topic
    )

    output_file = save_visual_plan(
        scenes,
        topic
    )

    print()
    print(
        f"Saved to: {output_file}"
    )

    print()

    for scene in scenes:

        print(
            f"Scene {scene['scene']}"
        )

        print(
            f"Narration: {scene['narration']}"
        )

        print(
            f"Visual: {scene['visual_prompt']}"
        )

        print(
            f"Duration: "
            f"{scene['duration_hint']}s"
        )

        print(
            "-" * 60
        )


if __name__ == "__main__":
    main()