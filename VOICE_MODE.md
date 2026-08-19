# Continuous Voice Mode

Date: 2026-08-15
Status: Implemented

## Architecture overview

Continuous voice mode is an interaction layer over the existing Jarvis request path. It does not introduce a second command router or tool executor.

```text
Dashboard Voice button (pressed once)
  -> JarvisVoiceThread (background QThread)
     -> SpeechEngine.listen()
     -> Jarvis.process(transcript)
        -> existing ChatGPT conversation / Python tools / workflows
     -> SpeechEngine.speak(response)
     -> loop back to listening
  -> Stop Voice requests a graceful stop
```

All microphone capture, Whisper transcription, ChatGPT waits, Python tool execution and text-to-speech playback happen outside the Qt UI thread. Dashboard widgets are updated only through Qt signals.

## Session lifecycle

The voice worker exposes these states:

| State | Meaning |
|---|---|
| `Idle` | Worker exists but has not started |
| `Listening` | Capturing microphone audio and transcribing it |
| `Processing` | Passing the transcript through the existing `Jarvis.process()` path |
| `Speaking` | Playing the returned text through configured TTS |
| `Stopped` | User requested stop or recovery attempts were exhausted |

One click starts the continuous loop. After Jarvis speaks, the worker returns to `Listening` automatically. The button is then used only to stop the active session.

## Audio pipeline

### Input

1. `sounddevice.InputStream` opens the configured input device.
2. Mono float audio is sampled at the configured rate.
3. RMS volume detects speech and trailing silence.
4. Audio is written to a temporary 16-bit WAV file.
5. Faster-Whisper transcribes using automatic detection or the configured English/Urdu hint.
6. The temporary WAV is removed in a `finally` block.

### Processing

The transcript is sent unchanged to `Jarvis.process()`. Existing deterministic routes, ChatGPT structured intent, allow-listed Python tools, WhatsApp behavior, TikTok behavior and conversation memory remain the same.

### Output

The final response is displayed in the dashboard and passed to `pyttsx3`. Voice identity, rate and volume are configurable. When TTS is disabled or unavailable, the text response remains available in the dashboard.

## Recovery behavior

- A microphone, transcription, request-processing or TTS exception fails only the current cycle.
- The error is written to structured logs with a request ID.
- The dashboard shows a safe temporary-error message without exposing raw device/API details.
- The worker waits for the configured recovery delay and listens again.
- Consecutive successful/empty cycles reset the error counter.
- When failures exceed `JARVIS_VOICE_RECOVERY_ATTEMPTS`, the session transitions to `Stopped`.

## Configuration

Set these variables in the project `.env` file:

```dotenv
# Input device: blank for system default, or sounddevice device index/name
JARVIS_MICROPHONE=

# auto, en, or ur
JARVIS_SPEECH_LANGUAGE=auto

JARVIS_SAMPLE_RATE=16000
JARVIS_SILENCE_THRESHOLD=0.015
JARVIS_SILENCE_SECONDS=1.2
JARVIS_MAX_RECORD_SECONDS=30

JARVIS_WHISPER_MODEL=base
JARVIS_WHISPER_DEVICE=cpu
JARVIS_WHISPER_COMPUTE_TYPE=int8

JARVIS_TTS_ENABLED=1
# Exact pyttsx3 voice ID or voice name; blank uses system default
JARVIS_TTS_VOICE=
JARVIS_TTS_RATE=175
JARVIS_TTS_VOLUME=1.0

JARVIS_VOICE_RECOVERY_ATTEMPTS=3
JARVIS_VOICE_RECOVERY_DELAY=0.5
```

`JARVIS_TTS_VOLUME` is clamped to `0.0–1.0`. Unsupported speech languages fall back to `auto`. A missing configured voice logs a warning and keeps the system-default voice.

## Structured logging

Voice lifecycle and failures use the centralized request-correlated logger. Important events include:

- `voice.state_changed`
- `voice.listening`
- `voice.transcription_started`
- `voice.transcription_completed`
- `voice.spoken`
- `voice.cycle_failed`
- `voice.recovery_exhausted`
- `voice.tts_failed`
- `voice.tts_skipped`

## Automated tests

Tests are in `tests/test_continuous_voice.py` and cover:

- complete Idle→Listening→Processing→Speaking→Stopped lifecycle
- multiple conversations during one continuous session
- recovery after a temporary microphone disconnection
- bounded recovery after repeated speech-recognition failures
- Qt dashboard responsiveness while the worker is blocked on audio input

Run:

```powershell
python -m unittest tests.test_continuous_voice tests.test_stability_logging -v
python -m unittest discover -s tests -v
```

Focused verification: **14 tests passed**.

Final full-project verification: **49 tests passed**; syntax compilation and diff hygiene checks also passed.

## Limitations

- Stop is cooperative: an active microphone read, API request or TTS playback finishes before the worker exits.
- Echo cancellation and speaker-to-microphone feedback suppression are not implemented.
- The selected microphone must be visible to `sounddevice`; device names vary by operating system.
- Recognition supports automatic detection plus explicit English and Urdu hints in this phase.
- Voice selection depends on voices installed in the operating system and exposed by `pyttsx3`.
- Empty/no-speech cycles resume listening and do not count as failures.
- Automated tests use mocked audio and do not assess acoustic transcription quality.
