from pathlib import Path

from app.voice_generator import create_voice
from app.whisper_checker import check_voice


# ==========================================
# PROJECT CONFIGURATION
# ==========================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

VOICE_OUTPUT_DIR = PROJECT_ROOT / "output"

VOICE_OUTPUT_DIR.mkdir(exist_ok=True)


# ==========================================
# GENERATE + VERIFY VOICE
# ==========================================

def generate_and_verify_voice(
    script,
    filename="verified_voice.wav",
    minimum_accuracy=80.0
):
    """
    Generate AI voice with Piper,
    then verify it using Whisper.
    """

    print("\n====================================")
    print("       AI VOICE PIPELINE")
    print("====================================")

    print("\n📝 Script:")
    print(script)

    # ======================================
    # STEP 1 — PIPER
    # ======================================

    print("\n------------------------------------")
    print("STEP 1: PIPER VOICE GENERATION")
    print("------------------------------------")

    voice_file = create_voice(
        script,
        filename
    )

    if voice_file is None:

        print(
            "\n❌ Voice generation failed."
        )

        return {
            "approved": False,
            "accuracy": 0.0,
            "audio_path": None,
            "transcription": ""
        }

    # ======================================
    # STEP 2 — WHISPER
    # ======================================

    print("\n------------------------------------")
    print("STEP 2: WHISPER VERIFICATION")
    print("------------------------------------")

    result = check_voice(
        audio_path=voice_file,
        expected_script=script,
        minimum_accuracy=minimum_accuracy
    )

    # ======================================
    # FINAL RESULT
    # ======================================

    print("\n====================================")
    print("       VOICE PIPELINE RESULT")
    print("====================================")

    print(
        f"\n📊 Accuracy: "
        f"{result['accuracy']}%"
    )

    print(
        f"🎯 Approved: "
        f"{result['approved']}"
    )

    print(
        f"🔊 Audio: "
        f"{voice_file}"
    )

    if result["approved"]:

        print(
            "\n✅ VOICE PIPELINE PASSED"
        )

    else:

        print(
            "\n❌ VOICE PIPELINE FAILED"
        )

    return {
        "approved": result["approved"],
        "accuracy": result["accuracy"],
        "audio_path": str(voice_file),
        "transcription": result["transcription"]
    }


# ==========================================
# TEST
# ==========================================

if __name__ == "__main__":

    test_script = (
        "Hello, this is my local AI TikTok agent, "
        "today we are creating videos automatically."
    )

    result = generate_and_verify_voice(
        script=test_script,
        filename="pipeline_test.wav",
        minimum_accuracy=80.0
    )

    print("\n====================================")
    print("              DONE")
    print("====================================")