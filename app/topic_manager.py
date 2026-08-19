import os
import re
from pathlib import Path

from app.memory import get_all_videos
from app.config import ask_llm as ask_ollama


# ============================================================
# PROJECT CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = PROJECT_ROOT / "output" / "pipeline"

RAW_DEMO_TOPICS = [
    "How trenching machines install underground drainage pipes",
    "How a tunnel boring machine removes soil underground",
    "How a hydraulic press shapes hot metal",
    "How concrete pumps move concrete up tall buildings",
    "How a waterjet cutter slices thick steel",
    "How road milling machines remove damaged asphalt",
    "How a recycling plant sorts plastic waste",
    "How a CNC machine cuts precision metal parts",
    "How an automated packaging line seals products",
    "How a mobile crane lifts heavy construction materials",
    "How industrial robots weld car bodies",
    "How laser cutters shape sheet metal",
    "How asphalt paving machines build smooth roads",
    "How excavators load soil into dump trucks",
    "How glass bottles are formed in a factory",
    "How steel rebar is bent by automatic machines",
    "How injection molding machines make plastic parts",
    "How conveyor systems move products through factories",
    "How industrial shredders process scrap material",
    "How concrete blocks are made on automated production lines",
]

NARRATED_FALLBACK_TOPICS = [
    "Why the sky changes color at sunset",
    "How airplanes stay in the sky",
    "Why ice melts at room temperature",
    "How GPS satellites know where you are",
    "Why lightning is seen before thunder is heard",
    "How noise canceling headphones reduce sound",
    "Why metal feels colder than wood",
    "How elevators know which floor to stop at",
    "Why fingerprints are unique",
    "How bridges expand and contract with temperature",
    "Why the Moon looks larger near the horizon",
    "How automatic doors detect people",
    "Why popcorn pops when heated",
    "How submarines rise and sink",
    "Why magnets attract some metals",
    "How barcode scanners read black and white lines",
    "Why airplane wings create lift",
    "How traffic lights coordinate busy intersections",
    "Why soap removes grease from your hands",
    "How cameras focus an image",
    "Why onions make your eyes water",
    "How refrigerators keep food cold",
    "Why stars appear to twinkle",
    "How touchscreens detect your finger",
    "Why ocean water tastes salty",
    "How solar panels turn sunlight into electricity",
    "Why leaves change color in autumn",
    "How microwave ovens heat food",
    "Why some objects float while others sink",
    "How seat belts lock during sudden movement",
    "Why glass can be transparent",
    "How electric motors create rotation",
    "Why echoes happen in large spaces",
    "How smoke detectors sense a fire",
    "Why hot air rises",
    "How brakes stop a moving car",
    "Why snowflakes have six sides",
    "How batteries store and release energy",
    "Why static electricity makes hair stand up",
    "How compasses point north",
]

QUESTION_STARTERS = (
    "how ",
    "why ",
    "what ",
    "can ",
    "could ",
    "does ",
    "do ",
    "when ",
    "where ",
)

META_MARKERS = (
    "tiktok",
    "topic:",
    "topic ",
    "idea:",
    "idea ",
    "title:",
    "title ",
    "category",
    "science episode",
    "voiceover",
    "narrator",
    "slide ",
    "cut to",
    "requirements",
    "numbered list",
    "return only",
    "generate ",
    "do not add",
    "example:",
    "avoid politics",
    "topics must",
)


# ============================================================
# HELPERS
# ============================================================

def current_video_style():
    return os.environ.get(
        "VIDEO_STYLE",
        "raw_demo",
    ).strip().lower()


def normalize_topic(topic):
    text = re.sub(
        r"[^a-zA-Z0-9\s]",
        " ",
        str(topic),
    )
    return re.sub(r"\s+", " ", text).strip().lower()


def topic_to_stem(topic):
    return re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        str(topic),
    ).strip("_")


def get_used_topics():
    videos = get_all_videos()
    topics = []

    for video in videos:
        if len(video) > 1 and video[1]:
            topics.append(
                normalize_topic(video[1])
            )

    return topics


def get_pipeline_topics():
    topics = set()

    for file in PIPELINE_DIR.glob("*.json"):
        topics.add(
            normalize_topic(
                file.stem.replace("_", " ")
            )
        )

    return topics


def clean_topic(topic):
    if not topic:
        return ""

    topic = str(topic).strip()

    # Remove markdown/list prefixes.
    topic = re.sub(
        r"^\s*(?:[-*•]|\d+[.)\-:])\s*",
        "",
        topic,
    )

    # Remove a simple "Topic:" / "Idea:" / "Title:" prefix.
    topic = re.sub(
        r"^(?:topic|idea|title)\s*:\s*",
        "",
        topic,
        flags=re.IGNORECASE,
    )

    # Remove trailing category labels such as "(Science)".
    topic = re.sub(
        r"\s*\([^()]{1,30}\)\s*$",
        "",
        topic,
    )

    # Normalize common smart punctuation.
    topic = topic.translate(
        str.maketrans({
            "\u2018": "'",
            "\u2019": "'",
            "\u201c": '"',
            "\u201d": '"',
            "\u2013": "-",
            "\u2014": "-",
            "\u00a0": " ",
        })
    )

    topic = topic.strip().strip('"').strip("'").strip()

    # Remove a trailing question mark only for stable filename/display handling.
    topic = topic.rstrip("?").strip()

    topic = re.sub(
        r"\s+",
        " ",
        topic,
    ).strip()

    return topic


def looks_like_valid_topic(topic, style=None):
    if not topic:
        return False

    style = style or current_video_style()
    lower = topic.lower()
    words = topic.split()

    if len(words) < 5 or len(words) > 14:
        return False

    # Reject model meta-output before it can ever reach the script generator.
    if any(marker in lower for marker in META_MARKERS):
        return False

    # Reject formatting/category artifacts that indicate the model returned a
    # label or structured response rather than one clean title.
    if any(char in topic for char in ('[', ']', '{', '}', '"', ':', ';')):
        return False

    if style == "narrated":
        # Curiosity/question phrasing is much more reliable with the small
        # local model than broad titles such as "The Science of X".
        if not lower.startswith(QUESTION_STARTERS):
            return False

    if style == "raw_demo":
        # Raw-demo subjects should describe an observable process.
        if not lower.startswith("how "):
            return False

    return True


def unique_topics(items, style=None):
    output = []
    seen = set()

    for item in items:
        cleaned = clean_topic(item)

        if not looks_like_valid_topic(cleaned, style=style):
            continue

        normalized = normalize_topic(cleaned)

        if normalized in seen:
            continue

        seen.add(normalized)
        output.append(cleaned)

    return output


# ============================================================
# OLLAMA TOPIC GENERATION
# ============================================================

def generate_ollama_topics(count=20):
    style = current_video_style()

    if style == "raw_demo":
        prompt = (
            f"Write {count} different titles. Each title must start with How and "
            "describe a real machine, factory, construction, engineering, or tool "
            "process that can be filmed happening. One title per line. Titles only."
        )
    else:
        prompt = (
            f"Write {count} different educational video questions. Each line must "
            "start with Why, How, What, Can, Does, When, or Where. Use science, "
            "technology, engineering, everyday mysteries, nature, or history. "
            "Do not mention TikTok or social media. One title per line. Titles only."
        )

    try:
        response = ask_ollama(
            prompt,
            max_tokens=500,
        )
    except Exception as error:
        print(
            f"Topic generation warning: Ollama failed: {error}"
        )
        return []

    if not response:
        return []

    topics = []

    for line in str(response).splitlines():
        cleaned = clean_topic(line)

        if looks_like_valid_topic(
            cleaned,
            style=style,
        ):
            topics.append(cleaned)

    return unique_topics(
        topics,
        style=style,
    )


# ============================================================
# CANDIDATE TOPICS
# ============================================================

def generate_topics(count=30):
    style = current_video_style()

    ollama_topics = generate_ollama_topics(
        count=max(count, 20)
    )

    if style == "raw_demo":
        fallback_topics = RAW_DEMO_TOPICS
    else:
        fallback_topics = NARRATED_FALLBACK_TOPICS

    # Generated topics are preferred when they pass strict validation.
    # Curated topics guarantee automation still works when the local model
    # returns prompt echoes, labels, categories, or other unusable text.
    candidates = unique_topics(
        ollama_topics + fallback_topics,
        style=style,
    )

    return candidates[:count]


# ============================================================
# SELECT UNUSED TOPIC
# ============================================================

def choose_new_topic():
    style = current_video_style()

    used_topics = set(
        get_used_topics()
    )

    pipeline_topics = get_pipeline_topics()

    candidates = generate_topics(
        count=40
    )

    print(
        f"Topic candidates available: {len(candidates)}"
    )

    for candidate in candidates:
        normalized = normalize_topic(candidate)

        if normalized in used_topics:
            continue

        pipeline_name = normalize_topic(
            topic_to_stem(candidate).replace("_", " ")
        )

        if (
            normalized in pipeline_topics
            or pipeline_name in pipeline_topics
        ):
            continue

        print(
            f"Topic quality: APPROVED ({style})"
        )
        return candidate

    return None


# ============================================================
# MAIN
# ============================================================

def main():
    print()
    print("=== AI TOPIC MANAGER ===")
    print()

    used_topics = get_used_topics()

    print(
        f"Video style: {current_video_style()}"
    )
    print(
        f"Previously used topics: {len(used_topics)}"
    )

    print()
    print("Generating new topics...")

    topic = choose_new_topic()

    if topic:
        print()
        print("FINAL TOPIC:")
        print(topic)
    else:
        print()
        print(
            "No new topic was found."
        )


if __name__ == "__main__":
    main()