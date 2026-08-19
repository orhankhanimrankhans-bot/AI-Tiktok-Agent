"""Gemini-backed, age-appropriate one-minute kids story generation."""

import re

from app.config import ask_gemini


MIN_WORDS = 110
MAX_WORDS = 150


def generate_kids_story(theme: str) -> str:
    """Create an original 110-150 word story for children ages three to seven."""
    clean_theme = re.sub(r"\s+", " ", str(theme or "").strip())
    if not clean_theme:
        raise ValueError("Enter a story theme first.")
    if len(clean_theme) > 120:
        raise ValueError("Keep the story theme under 120 characters.")

    prompt = f"""Write one original, spoken kids story about: {clean_theme}

Audience: children ages 3 to 7. Write 110 to 150 simple English words, which is about one minute when read aloud.
Requirements:
- Start immediately with the story. Do not add a title, headings, notes, or markdown.
- Use a warm, playful voice, one kind main character, a small everyday problem, and a happy safe ending.
- Include one gentle lesson shown through the character's actions.
- Use short sentences and familiar words.
- Do not use frightening scenes, violence, peril, romance, brands, copyrighted characters, or a request to like/follow.
"""
    # Gemini Flash reserves tokens for internal reasoning. A larger budget is
    # required to reliably return a complete 110-150 word story.
    story = ask_gemini(prompt, max_tokens=800, timeout=90)
    story = re.sub(r"\s+", " ", story).strip().strip('"')
    words = story.split()

    # Some Flash responses conclude early. Continue the same story instead of
    # returning a short video script to the user.
    if len(words) < MIN_WORDS and len(words) >= 60:
        continuation_prompt = f"""Continue this original children's story with enough simple words to bring it to 110-150 words total. Return only the new final sentences, not the existing story. Keep the same characters, add a warm safe ending, and use no headings.

Existing story:
{story}
"""
        continuation = ask_gemini(continuation_prompt, max_tokens=500, timeout=90)
        story = f"{story} {re.sub(r'\s+', ' ', continuation).strip().strip(chr(34))}".strip()
        words = story.split()

    if len(words) > MAX_WORDS:
        story = " ".join(words[:MAX_WORDS]).rstrip(" ,;:") + "."
        words = story.split()
    if len(words) < MIN_WORDS:
        raise RuntimeError(
            "Gemini returned a story that is too short for one minute. Please try again."
        )
    return story
