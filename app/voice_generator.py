from pathlib import Path
import subprocess
import sys


PROJECT_ROOT = Path(__file__).resolve().parent.parent

MODEL_PATH = (
    PROJECT_ROOT
    / "models"
    / "en_US-lessac-medium.onnx"
)

OUTPUT_DIR = PROJECT_ROOT / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def create_voice(text, filename="voice_test.wav"):
    if not text or not text.strip():
        raise ValueError("Text cannot be empty.")

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Piper model not found: {MODEL_PATH}"
        )

    output_file = OUTPUT_DIR / filename

    command = [
        sys.executable,
        "-m",
        "piper",
        "--model",
        str(MODEL_PATH),
        "--output_file",
        str(output_file),
    ]

    try:
        subprocess.run(
            command,
            input=text,
            text=True,
            check=True,
        )

    except FileNotFoundError as error:
        raise RuntimeError(
            "Piper is not installed or is not available "
            "through the current Python environment."
        ) from error

    except subprocess.CalledProcessError as error:
        raise RuntimeError(
            f"Piper failed to generate audio. "
            f"Exit code: {error.returncode}"
        ) from error

    if not output_file.exists():
        raise RuntimeError(
            f"Voice generation completed but output file "
            f"was not created: {output_file}"
        )

    return output_file


def main():
    test_text = (
        "Artificial intelligence is changing the way "
        "we create content."
    )

    print()
    print("=== AI VOICE GENERATOR ===")
    print()
    print("Generating voice...")

    output_file = create_voice(
        test_text,
        "voice_generator_test.wav",
    )

    print()
    print("Voice generated successfully.")
    print(f"Output: {output_file}")


if __name__ == "__main__":
    main()
