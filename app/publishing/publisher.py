import json
import re
import os
import urllib.request
import urllib.error
from pathlib import Path


# ==========================================
# PROJECT CONFIGURATION
# ==========================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
PIPELINE_DIR = OUTPUT_DIR / "pipeline"
FINAL_DIR = OUTPUT_DIR / "final"
PUBLISHING_DIR = OUTPUT_DIR / "publishing"

PUBLISHING_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# ==========================================
# OLLAMA CONFIGURATION
# ==========================================

OLLAMA_URL = "http://localhost:11434/api/generate"
# Keep publishing metadata on the same working local model as the pipeline.
MODEL = os.environ.get("OLLAMA_MODEL", "tinyllama:latest")


# ==========================================
# OLLAMA REQUEST
# ==========================================

def ask_ollama(prompt, max_tokens=250, timeout=180):
    """
    Send a request to the local Ollama server.
    """

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
        headers={
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=timeout,
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
# FIND LATEST PIPELINE
# ==========================================

def find_latest_pipeline():
    """
    Find the newest pipeline JSON file.
    """

    if not PIPELINE_DIR.exists():
        return None

    files = list(
        PIPELINE_DIR.glob("*.json")
    )

    if not files:
        return None

    return max(
        files,
        key=lambda file: file.stat().st_mtime,
    )


# ==========================================
# FIND FINAL VIDEO
# ==========================================

def find_final_video(topic):
    """
    Find the final captioned video for the topic.
    """

    safe_name = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        topic,
    ).strip("_")

    expected = (
        FINAL_DIR
        / f"{safe_name}_captioned.mp4"
    )

    if expected.exists():
        return expected

    videos = list(
        FINAL_DIR.glob("*.mp4")
    )

    if not videos:
        return None

    return max(
        videos,
        key=lambda file: file.stat().st_mtime,
    )


# ==========================================
# CLEAN OLLAMA TEXT
# ==========================================

def clean_ai_text(text):
    """
    Remove common AI formatting artifacts.
    """

    text = text.strip()

    text = re.sub(
        r"^```.*?\n",
        "",
        text,
    )

    text = re.sub(
        r"\n```$",
        "",
        text,
    )

    text = text.strip()

    return text


# ==========================================
# AI CAPTION + HASHTAGS
# ==========================================

def generate_caption_and_hashtags(
    topic,
    script,
):
    """
    Use Ollama to generate a TikTok caption
    and relevant hashtags.
    """

    prompt = f"""
You are an expert TikTok content editor.

Create publishing metadata for this faceless educational TikTok.

TOPIC:
{topic}

SCRIPT:
{script}

Create:

1. One engaging TikTok caption.
2. Exactly 8 to 10 relevant hashtags.

CAPTION RULES:
- 1 to 3 short sentences.
- Natural and human sounding.
- Create curiosity.
- Match the topic.
- Educational but entertaining.
- Do not make claims that are not supported by the topic or script.
- No emojis.
- Do not include hashtags inside the caption.
- Do not mention that you are an AI.

HASHTAG RULES:
- Exactly 8 to 10 hashtags.
- Hashtags must be directly relevant to the topic.
- Prefer useful category hashtags.
- Use hashtags such as science, education, facts, physics, etc. only when relevant.
- Avoid generic filler hashtags except #fyp.
- Never create hashtags from random individual words.
- Never use hashtags like #the, #and, #behind, #into, #why, #this.
- Every hashtag must begin with #.
- No spaces inside a hashtag.

Return ONLY this format:

CAPTION:
your caption here

HASHTAGS:
#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5 #hashtag6 #hashtag7 #hashtag8
"""

    try:
        response = ask_ollama(
            prompt,
            max_tokens=250,
            timeout=180,
        )

    except RuntimeError as error:

        print()
        print(
            f"[WARNING] Ollama caption generation failed: {error}"
        )

        return fallback_caption(
            topic,
            script,
        )

    response = clean_ai_text(
        response
    )

    caption = ""
    hashtags = []

    # --------------------------------------
    # CAPTION
    # --------------------------------------

    caption_match = re.search(
        r"CAPTION:\s*(.*?)(?:\n\s*HASHTAGS:|\Z)",
        response,
        flags=re.IGNORECASE | re.DOTALL,
    )

    if caption_match:
        caption = caption_match.group(1).strip()

    # --------------------------------------
    # HASHTAGS
    # --------------------------------------

    hashtag_match = re.search(
        r"HASHTAGS:\s*(.*)",
        response,
        flags=re.IGNORECASE | re.DOTALL,
    )

    if hashtag_match:

        hashtag_text = hashtag_match.group(1)

        hashtags = re.findall(
            r"#[A-Za-z0-9_]+",
            hashtag_text,
        )

    # --------------------------------------
    # VALIDATE
    # --------------------------------------

    hashtags = clean_hashtags(
        hashtags,
        topic,
    )

    invalid_caption_markers = (
        "caption rules",
        "hashtag rules",
        "exactly 8 to 10",
        "return only",
    )
    if (
        not caption
        or any(marker in caption.lower() for marker in invalid_caption_markers)
    ):
        caption = fallback_caption(topic, script)[0]

    if len(hashtags) < 8:

        fallback = fallback_hashtags(
            topic
        )

        for tag in fallback:

            if tag not in hashtags:
                hashtags.append(tag)

            if len(hashtags) >= 10:
                break

    hashtags = hashtags[:10]

    return caption, hashtags


# ==========================================
# CLEAN HASHTAGS
# ==========================================

def clean_hashtags(
    hashtags,
    topic,
):
    """
    Remove poor-quality hashtags.
    """

    blocked = {
        "#the",
        "#and",
        "#or",
        "#why",
        "#this",
        "#that",
        "#with",
        "#from",
        "#into",
        "#behind",
        "#about",
        "#your",
        "#you",
        "#are",
        "#is",
        "#it",
        "#of",
        "#a",
        "#an",
    }

    cleaned = []

    for tag in hashtags:

        tag = tag.strip()

        if not tag.startswith("#"):
            continue

        if tag.lower() in blocked:
            continue

        if len(tag) < 3:
            continue

        if tag.lower() in [
            existing.lower()
            for existing in cleaned
        ]:
            continue

        cleaned.append(tag)

    return cleaned


# ==========================================
# FALLBACK CAPTION
# ==========================================

def fallback_caption(
    topic,
    script,
):
    """
    Safe fallback if Ollama is unavailable.
    """

    caption = (
        f"Ever wondered about {topic.lower()}? "
        f"Here's a fascinating explanation in just a few seconds."
    )

    hashtags = fallback_hashtags(
        topic
    )

    return caption, hashtags


# ==========================================
# FALLBACK HASHTAGS
# ==========================================

def fallback_hashtags(topic):
    """
    Generate sensible hashtags without AI.
    """

    topic_lower = topic.lower()

    hashtags = [
        "#fyp",
        "#didyouknow",
        "#learnontiktok",
        "#education",
        "#interestingfacts",
    ]

    if "science" in topic_lower:
        hashtags.extend([
            "#science",
            "#sciencefacts",
            "#scientok",
        ])

    if "ice" in topic_lower:
        hashtags.extend([
            "#physics",
            "#ice",
            "#water",
        ])

    if "physics" in topic_lower:
        hashtags.extend([
            "#physics",
            "#physicsfacts",
        ])

    if "animal" in topic_lower:
        hashtags.extend([
            "#animals",
            "#animalfacts",
        ])

    if "space" in topic_lower:
        hashtags.extend([
            "#space",
            "#astronomy",
        ])

    if "history" in topic_lower:
        hashtags.extend([
            "#history",
            "#historyfacts",
        ])

    # Remove duplicates.
    unique = []

    for tag in hashtags:

        if tag not in unique:
            unique.append(tag)

    return unique[:10]


# ==========================================
# CREATE PUBLISHING PACKAGE
# ==========================================

def create_publishing_package():
    """
    Create publishing metadata for the latest
    completed pipeline.
    """

    print()
    print("==========================================")
    print("        AI PUBLISHING MANAGER")
    print("==========================================")
    print()

    # --------------------------------------
    # FIND PIPELINE
    # --------------------------------------

    pipeline_file = find_latest_pipeline()

    if pipeline_file is None:
        raise RuntimeError(
            "No pipeline JSON file was found."
        )

    print(
        f"Pipeline: {pipeline_file}"
    )

    # --------------------------------------
    # READ PIPELINE
    # --------------------------------------

    try:

        pipeline_data = json.loads(
            pipeline_file.read_text(
                encoding="utf-8"
            )
        )

    except json.JSONDecodeError as error:

        raise RuntimeError(
            f"Invalid pipeline JSON: {pipeline_file}"
        ) from error

    topic = pipeline_data.get(
        "topic",
        "",
    ).strip()

    script = pipeline_data.get(
        "script",
        "",
    ).strip()

    visual_plan = pipeline_data.get(
        "visual_plan",
        [],
    )

    voice = pipeline_data.get(
        "voice",
        {},
    )

    if not topic:
        raise RuntimeError(
            "Pipeline does not contain a topic."
        )

    if not script:
        raise RuntimeError(
            "Pipeline does not contain a script."
        )

    # --------------------------------------
    # FIND VIDEO
    # --------------------------------------

    video_file = find_final_video(
        topic
    )

    if video_file is None:
        raise RuntimeError(
            "No final MP4 video was found."
        )

    print(
        f"Video:    {video_file}"
    )

    # --------------------------------------
    # VOICE APPROVAL
    # --------------------------------------

    voice_approved = bool(
        voice.get(
            "approved",
            False,
        )
    )

    print(
        f"Voice approved: {voice_approved}"
    )

    if not voice_approved:
        raise RuntimeError(
            "Voice verification is not approved."
        )

    # --------------------------------------
    # AI METADATA
    # --------------------------------------

    print()
    print(
        "Generating caption and hashtags with Ollama..."
    )

    caption, hashtags = (
        generate_caption_and_hashtags(
            topic,
            script,
        )
    )

    hashtag_text = " ".join(
        hashtags
    )

    # --------------------------------------
    # POST TEXT
    # --------------------------------------

    post_text = (
        f"{caption}\n\n"
        f"{hashtag_text}"
    )

    # --------------------------------------
    # SAFE FILE NAME
    # --------------------------------------

    safe_name = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        topic,
    ).strip("_")

    output_file = (
        PUBLISHING_DIR
        / f"{safe_name}_publish.json"
    )

    # --------------------------------------
    # PUBLISHING DATA
    # --------------------------------------

    publishing_data = {
        "status": "READY_TO_PUBLISH",
        "topic": topic,
        "video": str(video_file),
        "caption": caption,
        "hashtags": hashtags,
        "post_text": post_text,
        "script": script,
        "scene_count": len(visual_plan),
        "voice_approved": voice_approved,
        "pipeline_file": str(pipeline_file),
    }

    # --------------------------------------
    # SAVE
    # --------------------------------------

    output_file.write_text(
        json.dumps(
            publishing_data,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # --------------------------------------
    # DISPLAY
    # --------------------------------------

    print()
    print("==========================================")
    print("       PUBLISHING PACKAGE READY")
    print("==========================================")
    print()

    print(
        f"Topic:       {topic}"
    )

    print(
        f"Video:       {video_file.name}"
    )

    print(
        f"Scenes:      {len(visual_plan)}"
    )

    print(
        "Voice:       APPROVED"
    )

    print()
    print("CAPTION:")
    print(caption)

    print()
    print("HASHTAGS:")
    print(hashtag_text)

    print()
    print(
        "STATUS: READY_TO_PUBLISH"
    )

    print()
    print(
        "Publishing data saved to:"
    )

    print(
        output_file
    )

    print()

    return output_file


# ==========================================
# MAIN
# ==========================================

def main():

    try:

        create_publishing_package()

    except RuntimeError as error:

        print()
        print("==========================================")
        print("       PUBLISHING PACKAGE FAILED")
        print("==========================================")
        print()
        print(error)
        print()

        raise SystemExit(1)


if __name__ == "__main__":
    main()
