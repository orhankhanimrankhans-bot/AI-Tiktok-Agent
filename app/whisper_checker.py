import subprocess
import re
import sys
from pathlib import Path
from difflib import SequenceMatcher


WHISPER_MODEL = "tiny"

PROJECT_ROOT = Path(__file__).resolve().parent.parent

WHISPER_OUTPUT_DIR = (
    PROJECT_ROOT
    / "output"
    / "whisper"
)

WHISPER_OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


def clean_text(text):
    """
    Normalize text before comparing it.
    """

    text = text.lower()

    text = re.sub(
        r"[^a-z0-9\s]",
        " ",
        text,
    )

    text = " ".join(
        text.split()
    )

    return text.strip()


def calculate_accuracy(
    expected_text,
    actual_text,
):
    """
    Calculate similarity between expected script
    and Whisper transcription.
    """

    expected = clean_text(
        expected_text
    )

    actual = clean_text(
        actual_text
    )

    if not expected or not actual:
        return 0.0

    similarity = SequenceMatcher(
        None,
        expected,
        actual,
    ).ratio()

    return round(
        similarity * 100,
        2,
    )


def transcribe_audio(audio_path):
    """
    Convert WAV audio into text using Whisper.
    """

    audio_path = Path(audio_path)

    if not audio_path.exists():
        raise FileNotFoundError(
            f"Audio file not found: {audio_path}"
        )

    output_folder = (
        WHISPER_OUTPUT_DIR
        / audio_path.stem
    )

    output_folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    command = [
        sys.executable,
        "-m",
        "whisper",
        str(audio_path),
        "--model",
        WHISPER_MODEL,
        "--output_dir",
        str(output_folder),
        "--output_format",
        "txt",
        "--language",
        "en",
    ]

    print()
    print("Running Whisper...")
    print()

    try:
        subprocess.run(
            command,
            check=True,
        )

    except FileNotFoundError as error:
        raise RuntimeError(
            "Python could not start Whisper."
        ) from error

    except subprocess.CalledProcessError as error:
        raise RuntimeError(
            f"Whisper transcription failed. "
            f"Exit code: {error.returncode}"
        ) from error

    transcript_file = (
        output_folder
        / f"{audio_path.stem}.txt"
    )

    if not transcript_file.exists():
        raise RuntimeError(
            f"Whisper completed but transcript "
            f"was not found: {transcript_file}"
        )

    transcript = transcript_file.read_text(
        encoding="utf-8"
    ).strip()

    return transcript


def check_voice(
    expected_text,
    audio_path,
    minimum_accuracy=80.0,
):
    """
    Transcribe generated audio and compare it
    with the expected script.
    """

    transcript = transcribe_audio(
        audio_path
    )

    accuracy = calculate_accuracy(
        expected_text,
        transcript,
    )

    passed = accuracy >= minimum_accuracy

    return {
        "accuracy": accuracy,
        "passed": passed,
        "expected": expected_text,
        "actual": transcript,
        "audio_path": str(audio_path),
    }


def main():
    test_audio = (
        PROJECT_ROOT
        / "output"
        / "voice_generator_test.wav"
    )

    test_text = (
        "Artificial intelligence is changing "
        "the way we create content."
    )

    print()
    print("=== WHISPER VOICE CHECKER ===")
    print()

    print(
        f"Audio: {test_audio}"
    )

    print(
        "Transcribing..."
    )

    result = check_voice(
        expected_text=test_text,
        audio_path=test_audio,
        minimum_accuracy=80.0,
    )

    print()
    print(
        f"Accuracy: {result['accuracy']}%"
    )

    print(
        "Required: 80.0%"
    )

    if result["passed"]:
        print(
            "STATUS: PASS"
        )
    else:
        print(
            "STATUS: FAIL"
        )

    print()
    print(
        "Whisper transcription:"
    )

    print(
        result["actual"]
    )


if __name__ == "__main__":
    main()