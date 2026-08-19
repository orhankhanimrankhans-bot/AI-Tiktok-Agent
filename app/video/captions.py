import subprocess
from pathlib import Path

import whisper


# ==========================================
# CONFIGURATION
# ==========================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

OUTPUT_DIR = PROJECT_ROOT / "output"
CAPTION_DIR = OUTPUT_DIR / "captions"

CAPTION_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# ==========================================
# WHISPER
# ==========================================

def transcribe_voice(
    audio_file,
    model_name="base",
):
    """
    Transcribe audio and return Whisper segments.
    """

    audio_file = Path(audio_file)

    if not audio_file.exists():
        raise FileNotFoundError(
            f"Audio file not found: {audio_file}"
        )

    print()
    print("Loading Whisper model...")

    model = whisper.load_model(
        model_name,
        device="cpu",
    )

    print("Transcribing voice...")

    result = model.transcribe(
        str(audio_file),
        fp16=False,
        verbose=False,
    )

    segments = result.get(
        "segments",
        [],
    )

    if not segments:
        raise RuntimeError(
            "Whisper returned no speech segments."
        )

    return segments


# ==========================================
# CREATE SRT
# ==========================================

def format_timestamp(seconds):
    """
    Convert seconds into SRT timestamp format.
    """

    milliseconds = int(
        round(seconds * 1000)
    )

    hours = milliseconds // 3_600_000
    milliseconds %= 3_600_000

    minutes = milliseconds // 60_000
    milliseconds %= 60_000

    seconds_value = milliseconds // 1000
    milliseconds %= 1000

    return (
        f"{hours:02d}:"
        f"{minutes:02d}:"
        f"{seconds_value:02d},"
        f"{milliseconds:03d}"
    )


def create_srt(
    segments,
    output_file,
):
    """
    Create an SRT subtitle file.
    """

    output_file = Path(output_file)

    with open(
        output_file,
        "w",
        encoding="utf-8",
    ) as file:

        for index, segment in enumerate(
            segments,
            start=1,
        ):

            start = segment["start"]
            end = segment["end"]
            text = segment["text"].strip()

            if not text:
                continue

            file.write(
                f"{index}\n"
            )

            file.write(
                f"{format_timestamp(start)} --> "
                f"{format_timestamp(end)}\n"
            )

            file.write(
                f"{text}\n\n"
            )

    return output_file


# ==========================================
# CREATE ASS CAPTIONS
# ==========================================

def create_ass(
    segments,
    output_file,
):
    """
    Create an ASS subtitle file optimized
    for vertical TikTok videos.
    """

    output_file = Path(output_file)

    with open(
        output_file,
        "w",
        encoding="utf-8",
    ) as file:

        file.write(
            "[Script Info]\n"
        )

        file.write(
            "ScriptType: v4.00+\n"
        )

        file.write(
            "PlayResX: 1080\n"
        )

        file.write(
            "PlayResY: 1920\n\n"
        )

        file.write(
            "[V4+ Styles]\n"
        )

        file.write(
            "Format: Name, Fontname, Fontsize, "
            "PrimaryColour, SecondaryColour, "
            "OutlineColour, BackColour, Bold, "
            "Italic, Underline, StrikeOut, "
            "ScaleX, ScaleY, Spacing, Angle, "
            "BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        )

        file.write(
            "Style: TikTok,Arial,64,"
            "&H00FFFFFF,&H0000FFFF,"
            "&H00000000,&H80000000,"
            "1,0,0,0,100,100,0,0,"
            "1,4,2,2,60,60,260,1\n\n"
        )

        file.write(
            "[Events]\n"
        )

        file.write(
            "Format: Layer, Start, End, Style, "
            "Name, MarginL, MarginR, MarginV, "
            "Effect, Text\n"
        )

        for segment in segments:

            start = segment["start"]
            end = segment["end"]
            text = segment["text"].strip()

            if not text:
                continue

            # Keep captions readable.
            text = text.replace(
                "\n",
                " ",
            )

            text = text.replace(
                "{",
                "(",
            )

            text = text.replace(
                "}",
                ")",
            )

            start_time = (
                format_ass_timestamp(start)
            )

            end_time = (
                format_ass_timestamp(end)
            )

            file.write(
                "Dialogue: 0,"
                f"{start_time},"
                f"{end_time},"
                "TikTok,,0,0,0,,"
                f"{text}\n"
            )

    return output_file


def format_ass_timestamp(seconds):
    """
    ASS uses H:MM:SS.cc
    """

    total_centiseconds = int(
        round(seconds * 100)
    )

    hours = (
        total_centiseconds
        // 360000
    )

    total_centiseconds %= 360000

    minutes = (
        total_centiseconds
        // 6000
    )

    total_centiseconds %= 6000

    seconds_value = (
        total_centiseconds
        // 100
    )

    centiseconds = (
        total_centiseconds
        % 100
    )

    return (
        f"{hours}:"
        f"{minutes:02d}:"
        f"{seconds_value:02d}."
        f"{centiseconds:02d}"
    )


# ==========================================
# MAIN CAPTION PIPELINE
# ==========================================

def generate_captions(
    audio_file,
):
    """
    Generate synchronized SRT and ASS captions.
    """

    audio_file = Path(audio_file)

    print()
    print("==========================================")
    print("          AI CAPTION GENERATOR")
    print("==========================================")

    print()
    print(
        f"Audio: {audio_file}"
    )

    segments = transcribe_voice(
        audio_file
    )

    base_name = audio_file.stem

    srt_file = (
        CAPTION_DIR /
        f"{base_name}.srt"
    )

    ass_file = (
        CAPTION_DIR /
        f"{base_name}.ass"
    )

    create_srt(
        segments,
        srt_file,
    )

    create_ass(
        segments,
        ass_file,
    )

    print()
    print(
        f"Caption segments: "
        f"{len(segments)}"
    )

    print(
        f"SRT: {srt_file}"
    )

    print(
        f"ASS: {ass_file}"
    )

    return {
        "segments": segments,
        "srt": srt_file,
        "ass": ass_file,
    }


# ==========================================
# TEST
# ==========================================

def main():

    audio_file = (
        OUTPUT_DIR /
        "ai_tiktok_test.wav"
    )

    result = generate_captions(
        audio_file
    )

    print()
    print("Caption generation complete.")


if __name__ == "__main__":
    main()