
import json
import re
from pathlib import Path

from app.config import ask_llm as ask_ollama

PROJECT_ROOT = Path(__file__).resolve().parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output" / "visual"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ==========================================
# CREATE VISUAL PLAN
# ==========================================

def create_visual_plan(script, topic):

    # --------------------------------------
    # Split script into sentences
    # --------------------------------------

    sentences = re.split(
        r"(?<=[.!?])\s+",
        script.strip()
    )

    sentences = [
        sentence.strip()
        for sentence in sentences
        if sentence.strip()
    ]

    if not sentences:
        raise RuntimeError(
            "Script contains no usable sentences."
        )


    # --------------------------------------
    # Select up to 3 narration sections
    # --------------------------------------

    if len(sentences) >= 3:

        narration_parts = [
            sentences[0],
            sentences[len(sentences) // 2],
            sentences[-1]
        ]

    else:

        narration_parts = sentences


    # --------------------------------------
    # Remove duplicates
    # --------------------------------------

    unique_parts = []

    for sentence in narration_parts:

        if sentence not in unique_parts:
            unique_parts.append(sentence)


    narration_parts = unique_parts[:3]


    print("Generating visual plan with Ollama...")


    # --------------------------------------
    # Generate visual descriptions
    # --------------------------------------

    scenes = []

    for index, narration in enumerate(
        narration_parts,
        start=1
    ):

        prompt = f"""
You are a professional TikTok visual planner.

Create ONE short visual description for this narration.

TOPIC:
{topic}

NARRATION:
{narration}

RULES:

- Describe only what should appear visually.
- The video is faceless.
- Keep the visual realistic and cinematic.
- Directly match the narration.
- Do not add new facts.
- No camera directions.
- No text.
- No subtitles.
- No logos.
- No dialogue.
- Maximum 15 words.
- Return ONLY the visual description.
- Do not explain anything.
"""

        try:

            visual_prompt = ask_ollama(
                prompt,
                max_tokens=60,
                timeout=180
            )

        except RuntimeError as error:

            raise RuntimeError(
                f"Failed to generate visual for scene {index}: {error}"
            ) from error


        # ----------------------------------
        # Clean Ollama response
        # ----------------------------------

        visual_prompt = visual_prompt.strip()

        # Remove accidental quotation marks
        visual_prompt = visual_prompt.replace(
            '"',
            ""
        )

        # Remove markdown code fences
        visual_prompt = re.sub(
            r"```.*?```",
            "",
            visual_prompt,
            flags=re.DOTALL
        )

        # Remove excessive whitespace
        visual_prompt = " ".join(
            visual_prompt.split()
        )


        # ----------------------------------
        # Fallback visual
        # ----------------------------------

        if not visual_prompt:

            visual_prompt = (
                "Realistic visual matching the narration."
            )


        # ----------------------------------
        # Save scene
        # ----------------------------------

        scenes.append(
            {
                "scene": index,
                "narration": narration,
                "visual_prompt": visual_prompt,
                "duration_hint": 3
            }
        )


    # --------------------------------------
    # Final validation
    # --------------------------------------

    if not scenes:

        raise RuntimeError(
            "Could not create any visual scenes."
        )


    print(
        f"Generated {len(scenes)} scenes."
    )

    return scenes


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

    print(
        f"Topic: {topic}"
    )

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


# ==========================================
# RUN
# ==========================================

if __name__ == "__main__":
    main()
