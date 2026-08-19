import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path

from app.topic_manager import choose_new_topic
from app.visual_planner import create_visual_plan
from app.voice.script_voice_pipeline import script_to_voice
from app.config import ask_llm as ask_ollama
from observability import get_logger, log_event, request_context


logger = get_logger("tiktok.pipeline")


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
PIPELINE_DIR = OUTPUT_DIR / "pipeline"

PIPELINE_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

RAW_DEMO_MODE = os.environ.get("VIDEO_STYLE", "raw_demo").strip().lower() == "raw_demo"
AUTO_PUBLISH = os.environ.get("AUTO_PUBLISH", "0").strip() == "1"
MAX_SCRIPT_ATTEMPTS = max(1, int(os.environ.get("MAX_SCRIPT_ATTEMPTS", "3")))


# ============================================================
# GENERATE SCRIPT
# ============================================================

def generate_script(topic):
    """Generate a clean narration using prompts friendly to small local models.

    Small local Ollama models can echo long prompts. Keep each request short,
    vary the wording between attempts, and never paste the rejected draft back
    into the model.
    """
    prompts = [
        (
            f'Write one natural TikTok voiceover about "{topic}" in 55 to 75 words. '
            'Start with a curiosity hook, explain the main idea clearly and factually, '
            'and finish with a very short call to action. Output only the spoken paragraph.'
        ),
        (
            f'VOICEOVER ONLY. Topic: {topic}. Write 55 to 75 natural spoken words. '
            'Use simple English, one clear explanation, a strong opening hook, and a short ending. '
            'No labels, no list, no instructions, no hashtags.'
        ),
        (
            f'Create a short spoken TikTok narration about {topic}. '
            'Length: 55 to 75 words. Make it clear, interesting, and factual. '
            'Return only the narration paragraph.'
        ),
    ]

    attempts = min(MAX_SCRIPT_ATTEMPTS, len(prompts))
    last_issues = []

    for attempt in range(attempts):
        print()
        if attempt == 0:
            print("Generating script with Ollama...")
        else:
            print(
                f"Regenerating script with Ollama... "
                f"attempt {attempt + 1}/{attempts}"
            )

        response = ask_ollama(
            prompts[attempt],
            max_tokens=150,
            timeout=180,
        )

        response = clean_script(response)

        sanitized_response = sanitize_narration(response)

        if sanitized_response != response:
            print()
            print("Production directions removed from generated script.")
            response = sanitized_response

        # If the model runs long, keep complete sentences up to the target.
        if len(response.split()) > 85:
            sentences = re.split(
                r"(?<=[.!?])\s+",
                response,
            )

            shortened = []
            count = 0

            for sentence in sentences:
                sentence_words = sentence.split()

                if count + len(sentence_words) > 75:
                    break

                shortened.append(sentence)
                count += len(sentence_words)

            if shortened:
                response = " ".join(shortened).strip()

        issues = script_quality_issues(response, topic=topic)

        if not issues:
            return response

        last_issues = issues

        print()
        print("Script quality check: REJECTED")
        for issue in issues:
            print(f"  - {issue}")

        print("Rejected draft:")
        print(response)

    raise RuntimeError(
        "Ollama could not produce a clean TikTok narration after "
        f"{attempts} attempts. Pipeline stopped before TTS. "
        "Last rejection: "
        + "; ".join(last_issues)
    )


# ============================================================
# CLEAN SCRIPT
# ============================================================

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

    # Normalize common Unicode punctuation produced by local models so
    # perfectly normal narration is not rejected by quality control.
    punctuation_map = str.maketrans({
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2026": "...",
        "\u00a0": " ",
    })
    script = script.translate(punctuation_map)

    script = re.sub(
        r"\s+",
        " ",
        script,
    ).strip()

    return script



def sanitize_narration(script):
    """Remove production directions while preserving usable spoken narration."""
    if not script:
        return ""

    original = str(script)
    cleaned = original

    # Remove bracketed production directions such as:
    # [Narrator], [Voiceover], [Cut to ...], [Slide 1: ...], [Camera ...]
    cleaned = re.sub(
        r"\[[^\]]{1,180}\]",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Remove common parenthetical stage directions but keep ordinary
    # explanatory parentheses that are not production instructions.
    stage_direction_pattern = re.compile(
        r"\((?:"
        r"pause|slowly|quickly|whispering|excitedly|dramatically|"
        r"cut(?:away)?(?:\s+to)?[^)]*|camera[^)]*|zoom[^)]*|"
        r"music[^)]*|sound[^)]*|scene[^)]*|shot[^)]*|"
        r"raising[^)]*|lowering[^)]*|pointing[^)]*|showing[^)]*"
        r")\)",
        flags=re.IGNORECASE,
    )
    cleaned = stage_direction_pattern.sub(" ", cleaned)

    # Remove speaker/model labels wherever they appear before spoken text.
    cleaned = re.sub(
        r"(?i)(?:^|(?<=[.!?]))\s*"
        r"(?:narrator|host|assistant|speaker|voice\s*over|voiceover|voice)"
        r"\s*:\s*",
        " ",
        cleaned,
    )

    # Remove leading platform/meta labels such as "TikTok:".
    cleaned = re.sub(
        r"(?i)^\s*tiktok\s*:\s*",
        "",
        cleaned,
    )

    # Remove common prompt-echo labels if the model emits them as a prefix.
    cleaned = re.sub(
        r"(?i)^\s*(?:natural spoken words|opening hook|clear explanation|"
        r"strong opening hook|short ending|call to action|intro|introduction|"
        r"hook|main point|conclusion)\s*[:,-]\s*",
        "",
        cleaned,
    )

    # Strip quote marks that wrap narration fragments.
    cleaned = cleaned.replace('"', "")
    cleaned = cleaned.replace("“", "")
    cleaned = cleaned.replace("”", "")

    # Remove leftover empty bracket/parenthesis artifacts.
    cleaned = re.sub(r"\[\s*\]|\(\s*\)", " ", cleaned)

    cleaned = re.sub(
        r"\s+",
        " ",
        cleaned,
    ).strip()

    return cleaned


def script_quality_issues(script, topic=None):
    """Return human-readable reasons a narration should be rejected."""
    issues = []

    if not script or not script.strip():
        return ["empty narration"]

    normalized = re.sub(r"\s+", " ", script).strip()
    lower_script = normalized.lower()
    words = normalized.split()
    word_count = len(words)

    if word_count < 55:
        issues.append(f"too short ({word_count} words; minimum 55)")

    if word_count > 80:
        issues.append(f"too long ({word_count} words; maximum 80)")

    forbidden_phrases = (
        "your task",
        "your instructions",
        "constraints:",
        "strict length",
        "length requirement",
        "return only",
        "write between",
        "word limit",
        "the narrative must",
        "the script must",
        "natural spoken words",
        "opening hook",
        "clear explanation",
        "strong opening hook",
        "short ending",
        "call to action",
        "spoken paragraph",
        "voiceover only",
        "titles only",
        "intro,",
        "intro:",
        "introduction:",
        "hook,",
        "hook:",
        "main point:",
        "conclusion:",
        "free quote",
        "get started today",
        "buy now",
        "order now",
        "our product",
        "our products",
        "our solar panels",
        "contact us",
        "shop now",
        "limited time",
    )

    for phrase in forbidden_phrases:
        if phrase in lower_script:
            issues.append(f"instruction leakage: {phrase}")
            break

    # Speaker/model labels are especially harmful because TTS reads them aloud.
    label_pattern = re.compile(
        r"(?i)(?:^|[.!?]\s+)"
        r"(narrator|host|assistant|system|speaker|voice|voice\s*over|voiceover)"
        r"\s*[:.]?"
    )
    if label_pattern.search(normalized):
        issues.append("contains a speaker/model label")

    # Reject narration-control words/phrases even when the model omits punctuation.
    role_pattern = re.compile(
        r"(?i)\b(?:narrator|assistant|system|voice\s*over|voiceover)\b"
    )
    if role_pattern.search(normalized):
        issues.append("contains narration-control words")

    # The platform name should not appear in an educational narration unless
    # the requested subject itself is actually about TikTok.
    topic_lower = str(topic or "").lower()
    if "tiktok" in lower_script and "tiktok" not in topic_lower:
        issues.append("contains unrelated TikTok/platform meta text")

    promotional_patterns = (
        r"(?i)\bour\s+(?:product|products|service|services|solar panels?)\b",
        r"(?i)\bfree\s+quote\b",
        r"(?i)\bget\s+started\s+(?:today|now)\b",
        r"(?i)\bbuy\s+now\b",
        r"(?i)\border\s+now\b",
        r"(?i)\bcontact\s+us\b",
        r"(?i)\bshop\s+now\b",
    )
    if any(re.search(pattern, normalized) for pattern in promotional_patterns):
        issues.append("contains promotional/advertising language")

    if "#" in normalized:
        issues.append("contains hashtags")

    if "```" in normalized or normalized.startswith(("-", "*", "•")):
        issues.append("contains markdown/list formatting")

    # Catch obvious generation corruption: very long alphabetic tokens are
    # uncommon in short simple-English narration and often indicate word fusion.
    suspicious_tokens = []
    for token in words:
        cleaned = re.sub(r"[^A-Za-z-]", "", token)
        alpha_only = cleaned.replace("-", "")
        if len(alpha_only) >= 18:
            suspicious_tokens.append(token)

    if suspicious_tokens:
        issues.append(
            "contains suspicious/malformed word(s): "
            + ", ".join(suspicious_tokens[:3])
        )

    # Reject real symbol/control noise, but allow normal English punctuation.
    # Common punctuation such as :, ;, parentheses, quotes, slash and percent
    # is valid in spoken narration and must not trigger a false rejection.
    allowed_punctuation = set(".,!?;:'\"-()/%&")
    unusual_symbols = []

    for char in normalized:
        if char.isalnum() or char.isspace() or char in allowed_punctuation:
            continue

        # Keep ordinary Unicode letters (for names/loanwords) valid too.
        if char.isalpha():
            continue

        unusual_symbols.append(char)

    # A single harmless symbol can occasionally appear in model output.
    # Reject only repeated/meaningful noise.
    if len(unusual_symbols) >= 3:
        preview = " ".join(repr(char) for char in unusual_symbols[:5])
        issues.append(
            "contains unusual symbol noise"
            + (f": {preview}" if preview else "")
        )

    # A useful TikTok narration should be more than a single run-on sentence.
    sentence_count = len(
        [part for part in re.split(r"(?<=[.!?])\s+", normalized) if part.strip()]
    )
    if sentence_count < 2:
        issues.append("needs at least two natural sentences")

    # Reject narration that appears cut off or ends with an unfinished list.
    ending = normalized.rstrip()
    dangling_endings = (
        " and",
        " or",
        " but",
        " because",
        " including",
        " such as",
        " like",
        ",",
        ":",
        ";",
        "...",
    )
    if ending.lower().endswith(dangling_endings):
        issues.append("appears to end mid-sentence or mid-list")

    return issues

def fallback_script(topic):
    """Compatibility helper; production generation now fails closed instead of using it."""
    return (
        f"Ever wondered about {topic}? The answer is more surprising than it first appears. "
        "This short story breaks the idea into simple pieces, explains what is happening, "
        "and shows why it matters in everyday life. Look closely at the clues around you, "
        "then share the fact that surprised you most."
    )


# ============================================================
# VALIDATE SCRIPT
# ============================================================

def validate_script(script, topic=None):
    if not script:
        raise RuntimeError(
            "Script generation returned empty text."
        )

    word_count = len(script.split())

    print()
    print(f"Script word count: {word_count}")

    issues = script_quality_issues(
        script,
        topic=topic,
    )

    if issues:
        raise RuntimeError(
            "Generated script failed final quality validation: "
            + "; ".join(issues)
        )

    print("Script quality: APPROVED")
    return True


# ============================================================
# SAVE PIPELINE
# ============================================================

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
        PIPELINE_DIR
        / f"{safe_name}.json"
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


# ============================================================
# RUN MODULE
# ============================================================

def run_module(
    module_name,
    description,
    *,
    env_overrides=None,
):
    """
    Run another project module using the same
    Python interpreter.
    """

    print()
    print("==========================================")
    print(description)
    print("==========================================")
    print()

    command = [
        sys.executable,
        "-m",
        module_name,
    ]

    print(
        "Running:"
    )

    print(
        " ".join(command)
    )

    log_event(logger, logging.INFO, "execution.started", "TikTok stage subprocess started", module_selection=module_name)
    child_env = os.environ.copy()
    if env_overrides:
        child_env.update({str(key): str(value) for key, value in env_overrides.items()})

    result = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        env=child_env,
    )

    if result.returncode != 0:

        log_event(logger, logging.ERROR, "execution.failed", "TikTok stage subprocess failed", module_selection=module_name, return_code=result.returncode)

        raise RuntimeError(
            f"{module_name} failed with "
            f"exit code {result.returncode}."
        )

    print()
    print(
        f"{module_name} completed successfully."
    )

    log_event(logger, logging.INFO, "execution.completed", "TikTok stage subprocess completed", module_selection=module_name, success=True)
    return True


# ============================================================
# PRODUCTION PIPELINE
# ============================================================

def run_pipeline(
    topic=None,
    *,
    auto_publish=None,
    raw_demo_mode=None,
):
    """Run the TikTok pipeline.

    When ``topic`` is provided, Jarvis or another controller can launch a
    specific objective. When it is omitted, the existing Topic Manager
    behavior is preserved. Publishing remains controlled explicitly.
    """
    if auto_publish is None:
        auto_publish = AUTO_PUBLISH

    if raw_demo_mode is None:
        raw_demo_mode = RAW_DEMO_MODE

    print()
    print("==========================================")
    print("      AI TIKTOK MASTER ORCHESTRATOR")
    print("==========================================")

    # ========================================================
    # 1. TOPIC
    # ========================================================

    print()
    if topic is None:
        print("[1/9] Selecting new topic...")
        topic = choose_new_topic()
    else:
        print("[1/9] Using requested topic...")

    if not topic:
        raise RuntimeError(
            "No TikTok topic was provided or generated."
        )

    topic = str(topic).strip()
    if not topic:
        raise RuntimeError("TikTok topic is empty.")

    print()
    print(
        f"Topic: {topic}"
    )

    if raw_demo_mode:
        print()
        print("[2-4/9] Raw-demo format selected: skipping script, voice, and captions.")
        script = "Raw real-world process footage with original ambient sound."
        visual_plan = [{
            "scene": 1,
            "narration": "",
            "visual_prompt": topic,
            "duration_hint": 45,
        }]
        voice_result = {
            "approved": True,
            "skipped": True,
            "reason": "Raw-demo channel uses original source audio.",
        }
    else:
        print()
        print("[2/9] Generating script...")
        script = clean_script(generate_script(topic))
        validate_script(script, topic=topic)

        print()
        print("[3/9] Generating visual plan...")
        visual_plan = create_visual_plan(script=script, topic=topic)
        if not visual_plan:
            raise RuntimeError("Visual planner returned no scenes.")

        print()
        print("[4/9] Generating and verifying voice...")
        voice_result = script_to_voice(
            script=script,
            video_id="ai_tiktok_test",
            minimum_accuracy=80.0,
        )
        if not voice_result or not voice_result.get("approved", False):
            raise RuntimeError("Voice verification failed.")

    # ========================================================
    # 5. SAVE PIPELINE
    # ========================================================

    print()
    print("[5/9] Saving production pipeline...")

    pipeline_file = save_pipeline_data(
        topic=topic,
        script=script,
        visual_plan=visual_plan,
        voice_result=voice_result,
    )

    print()
    print(
        f"Pipeline saved: {pipeline_file}"
    )

    # ========================================================
    # 6. RENDER VIDEO
    # ========================================================

    stage_env = {
        "VIDEO_STYLE": "raw_demo" if raw_demo_mode else "narrated",
    }

    run_module(
        "app.video.renderer",
        "[6/9] RENDERING VIDEO",
        env_overrides=stage_env,
    )

    # ========================================================
    # 7. BURN CAPTIONS
    # ========================================================

    if raw_demo_mode:
        print()
        print("[7/9] Captions skipped for raw-demo format.")
    else:
        run_module(
            "app.video.caption_renderer",
            "[7/9] ADDING CAPTIONS",
            env_overrides=stage_env,
        )

    # ========================================================
    # 8. CREATE PUBLISHING PACKAGE
    # ========================================================

    run_module(
        "app.publishing.publisher",
        "[8/9] CREATING PUBLISHING PACKAGE",
        env_overrides=stage_env,
    )

    # ========================================================
    # 9. TIKTOK PUBLISHER
    # ========================================================

    if auto_publish:
        run_module(
            "app.publishing.tiktok_publisher",
            "[9/9] PUBLISHING TO TIKTOK",
            env_overrides=stage_env,
        )
    else:
        print()
        print("[9/9] TikTok publishing skipped. Review the local video before posting.")

    # ========================================================
    # COMPLETE
    # ========================================================

    print()
    print("==========================================")
    print("       AI TIKTOK PIPELINE COMPLETE")
    print("==========================================")
    print()

    print(
        f"Topic: {topic}"
    )

    print(
        f"Scenes: {len(visual_plan)}"
    )

    print(
        "Audio: ORIGINAL CLIP" if raw_demo_mode else "Voice: APPROVED"
    )

    print(
        "Video: RENDERED"
    )

    print(
        "Captions: OFF" if raw_demo_mode else "Captions: ADDED"
    )

    print(
        "Publishing package: CREATED"
    )

    print(
        "TikTok: UPLOAD ATTEMPTED" if auto_publish else "TikTok: REVIEW REQUIRED"
    )

    print()
    print(
        "The final TikTok status is determined "
        "by the TikTok publisher."
    )

    print()

    return {
        "topic": topic,
        "script": script,
        "visual_plan": visual_plan,
        "voice": voice_result,
        "pipeline_file": str(
            pipeline_file
        ),
        "auto_publish": auto_publish,
        "raw_demo_mode": raw_demo_mode,
    }


def run_jarvis_objective(
    topic,
    *,
    auto_publish=False,
    raw_demo_mode=False,
):
    """Jarvis-facing adapter for a specific TikTok creation objective.

    The safe default is review-before-publish. Jarvis can request a fully
    narrated video by leaving ``raw_demo_mode`` as False.
    """
    topic = str(topic).strip()
    if not topic:
        raise ValueError("Jarvis TikTok objective requires a topic.")

    log_event(
        logger,
        logging.INFO,
        "jarvis.objective.received",
        "Jarvis TikTok objective received",
        intent="create_tiktok",
        topic=topic,
        auto_publish=auto_publish,
        raw_demo_mode=raw_demo_mode,
    )

    return run_pipeline(
        topic=topic,
        auto_publish=auto_publish,
        raw_demo_mode=raw_demo_mode,
    )


# ============================================================
# MAIN
# ============================================================

def main():
    with request_context():
        try:
            log_event(logger, logging.INFO, "request.received", "TikTok pipeline request received", intent="create_tiktok", module_selection="app.orchestrator")
            run_pipeline()
            log_event(logger, logging.INFO, "request.completed", "TikTok pipeline request completed", success=True)

        except Exception as error:

            logger.exception("TikTok pipeline failed", extra={"event": "request.failed", "module_selection": "app.orchestrator"})

            print()
            print("==========================================")
            print("       AI TIKTOK PIPELINE FAILED")
            print("==========================================")
            print()

            print(
                f"Error: {error}"
            )

            print()

            raise SystemExit(1)


if __name__ == "__main__":
    main()