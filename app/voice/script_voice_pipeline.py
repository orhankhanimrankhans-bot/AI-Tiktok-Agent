from pathlib import Path

from app.voice_generator import create_voice
from app.whisper_checker import check_voice


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

VOICE_OUTPUT_DIR = (
    PROJECT_ROOT
    / "output"
    / "voice"
)

VOICE_OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


def script_to_voice(
    script,
    video_id="test",
    minimum_accuracy=80.0,
):
    """
    Convert an approved script into AI voice,
    then verify the generated voice using Whisper.
    """

    if not script or not script.strip():
        raise ValueError(
            "Script cannot be empty."
        )

    filename = (
        f"{video_id}.wav"
    )

    print()
    print("====================================")
    print("       SCRIPT TO VOICE PIPELINE")
    print("====================================")

    print()
    print("Generating voice...")

    audio_path = create_voice(
        script,
        filename=filename,
    )

    print()
    print(
        f"Voice created: {audio_path}"
    )

    print()
    print("Verifying voice with Whisper...")

    result = check_voice(
        expected_text=script,
        audio_path=audio_path,
        minimum_accuracy=minimum_accuracy,
    )

    accuracy = result["accuracy"]
    approved = result["passed"]

    print()
    print(
        f"Accuracy: {accuracy}%"
    )

    print(
        f"Required: {minimum_accuracy}%"
    )

    if approved:
        print("STATUS: APPROVED")
    else:
        print("STATUS: REJECTED")

    return {
        "video_id": video_id,
        "audio_path": str(audio_path),
        "accuracy": accuracy,
        "approved": approved,
        "transcript": result["actual"],
    }


def main():

    test_script = (
        "Artificial intelligence is changing "
        "the way we create content."
    )

    result = script_to_voice(
        script=test_script,
        video_id="script_voice_test",
        minimum_accuracy=80.0,
    )

    print()
    print("====================================")
    print("             RESULT")
    print("====================================")

    print(
        f"Video ID : {result['video_id']}"
    )

    print(
        f"Audio    : {result['audio_path']}"
    )

    print(
        f"Accuracy : {result['accuracy']}%"
    )

    print(
        f"Approved : {result['approved']}"
    )


if __name__ == "__main__":
    main()
