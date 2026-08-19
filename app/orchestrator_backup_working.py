import json
import re
import urllib.request
import urllib.error
from pathlib import Path

from app.topic_manager import choose_new_topic
from app.visual_planner import create_visual_plan
from app.voice.script_voice_pipeline import script_to_voice

PROJECT_ROOT = Path(__file__).resolve().parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
PIPELINE_DIR = OUTPUT_DIR / "pipeline"

PIPELINE_DIR.mkdir(parents=True, exist_ok=True)

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "phi3:latest"


def ask_ollama(prompt, max_tokens=250, timeout=180):
    data = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.4,
            "num_predict": max_tokens,
        },
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(
                response.read().decode("utf-8")
            )

        text = result.get("response", "").strip()

        if not text:
            raise RuntimeError("Ollama returned an empty response.")

        return text

    except urllib.error.URLError as error:
        raise RuntimeError(
            f"Ollama connection failed: {error}"
        ) from error

    except TimeoutError as error:
        raise RuntimeError(
            f"Ollama timed out after {timeout} seconds."
        ) from error


def generate_script(topic):
    prompt = f"""
You are a professional TikTok narrator.

TOPIC:
{topic}

Write ONE final faceless TikTok narration.

RULES:
- 60 to 90 words.
- Simple natural English.
- Start with a strong curiosity hook.
- Educational and interesting.
- Explain the topic clearly.
- End with a short call to action.
- No headings.
- No bullet points.
- No markdown.
- No quotation marks.
- Do not mention instructions.
- Do not mention "your task".
- Do not mention constraints.
- Do not explain your answer.
- Do not create another prompt.

IMPORTANT:
Your entire response will be sent directly to a text-to-speech system.

Return ONLY the narration that should be spoken aloud.

Write the final narration now.
"""

    print()
    print("Generating script with Ollama...")

    return ask_ollama(
        prompt,
        max_tokens=250,
        timeout=180,
    )


def clean_script(script):
    if not script:
        return ""

    script = script.strip()

    script = re.sub(
        r"^```(?:text|plaintext)?\s*",
        "",
        script,
        flags=re.IGNORECASE,
    )

    script = re.sub(
        r"\s*```$",
        "",
        script,
    )

    if (
        len(script) >= 2
        and script[0] in "\"'"
        and script[-1] == script[0]
    ):
        script = script[1:-1].strip()

    markers = [
        "## your task:",
        "your task:",
        "your instructions:",
        "instructions:",
        "constraints:",
        "the narrative must",
        "the script must",
    ]

    lower_script = script.lower()

    cut_position = None

    for marker in markers:
        position = lower_script.find(marker)

        if position != -1:
            if cut_position is None:
                cut_position = position
            else:
                cut_position = min(
                    cut_position,
                    position,
                )

    if cut_position is not None:
        script = script[:cut_position].strip()

    script = re.sub(
        r"\s+",
        " ",
        script,
    ).strip()

    return script


def validate_script(script):
    if not script:
        raise RuntimeError(
            "Script generation returned empty text."
        )

    word_count = len(script.split())

    print()
    print(f"Script word count: {word_count}")

    if word_count < 40:
        raise RuntimeError(
            "Generated script is too short."
        )

    if word_count > 120:
        raise RuntimeError(
            "Generated script is too long."
        )

    forbidden = [
        "your task",
        "constraints:",
        "the narrative must",
        "the script must",
        "return only",
        "do not use headings",
        "do not use bullet points",
    ]

    lower_script = script.lower()

    for phrase in forbidden:
        if phrase in lower_script:
            raise RuntimeError(
                f"Generated script contains instruction leakage: {phrase}"
            )

    return True


def save_pipeline_data(
    topic,
    script,
    visual_plan,
    voice_result,
):
    safe_name = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        topic,
    ).strip("_")

    if not safe_name:
        safe_name = "tiktok_video"

    output_file = (
        PIPELINE_DIR / f"{safe_name}.json"
    )

    data = {
        "topic": topic,
        "script": script,
        "visual_plan": visual_plan,
        "voice": voice_result,
    }

    output_file.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    return output_file


def run_pipeline():

    print()
    print("==========================================")
    print("        AI TIKTOK PRODUCTION AGENT")
    print("==========================================")

    print()
    print("[1/5] Selecting new topic...")

    topic = choose_new_topic()

    if not topic:
        raise RuntimeError(
            "Topic Manager could not generate a new topic."
        )

    topic = str(topic).strip()

    print(f"Topic: {topic}")

    print()
    print("[2/5] Generating script...")

    script = generate_script(topic)

    script = clean_script(script)

    validate_script(script)

    print()
    print("SCRIPT:")
    print(script)

    print()
    print("[3/5] Generating visual plan...")

    visual_plan = create_visual_plan(
        script=script,
        topic=topic,
    )

    if not visual_plan:
        raise RuntimeError(
            "Visual planner returned no scenes."
        )

    print()
    print(
        f"Generated {len(visual_plan)} scenes."
    )

    print()
    print("[4/5] Generating and verifying voice...")

    voice_result = script_to_voice(
        script=script,
        video_id="ai_tiktok_test",
        minimum_accuracy=80.0,
    )

    if not voice_result:
        raise RuntimeError(
            "Voice pipeline returned no result."
        )

    print()
    print("[5/5] Checking final approval...")

    if not voice_result.get("approved", False):
        raise RuntimeError(
            "Voice verification failed."
        )

    output_file = save_pipeline_data(
        topic=topic,
        script=script,
        visual_plan=visual_plan,
        voice_result=voice_result,
    )

    print()
    print("==========================================")
    print("             PIPELINE COMPLETE")
    print("==========================================")

    print()
    print(f"Topic: {topic}")
    print(f"Scenes: {len(visual_plan)}")

    print(
        f"Voice accuracy: "
        f"{voice_result.get('accuracy', 'N/A')}%"
    )

    print("Voice status: APPROVED")

    print()
    print("Pipeline data saved to:")
    print(output_file)

    return {
        "topic": topic,
        "script": script,
        "visual_plan": visual_plan,
        "voice": voice_result,
        "output_file": str(output_file),
    }


def main():

    try:
        run_pipeline()

    except Exception as error:

        print()
        print("==========================================")
        print("             PIPELINE FAILED")
        print("==========================================")

        print()
        print(f"Error: {error}")

        raise


if __name__ == "__main__":
    main()