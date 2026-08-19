from __future__ import annotations

import logging
import os
import re
import tempfile
import time
import wave
from pathlib import Path
from typing import Optional
from observability import get_logger, log_event


logger = get_logger("speech")

import numpy as np

try:
    import sounddevice as sd
except ImportError:
    sd = None

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None

try:
    import pyttsx3
except ImportError:
    pyttsx3 = None


class SpeechEngine:
    """
    Jarvis speech layer.

    Features:
    - Microphone recording
    - Simple silence detection
    - Faster-Whisper transcription
    - Urdu / English auto language detection
    - Local TTS fallback
    """

    def __init__(self) -> None:

        microphone = os.getenv("JARVIS_MICROPHONE", "").strip()
        self.microphone = (
            int(microphone)
            if microphone.lstrip("-").isdigit()
            else microphone or None
        )

        configured_language = os.getenv(
            "JARVIS_SPEECH_LANGUAGE", "auto"
        ).strip().lower()
        self.recognition_language = (
            configured_language
            if configured_language in {"auto", "en", "ur"}
            else "auto"
        )

        self.sample_rate = int(
            os.getenv("JARVIS_SAMPLE_RATE", "16000")
        )

        self.channels = 1

        self.silence_threshold = float(
            os.getenv("JARVIS_SILENCE_THRESHOLD", "0.015")
        )

        self.silence_seconds = float(
            os.getenv("JARVIS_SILENCE_SECONDS", "0.6")
        )

        self.max_record_seconds = float(
            os.getenv("JARVIS_MAX_RECORD_SECONDS", "30")
        )

        self.whisper_model_name = os.getenv(
            "JARVIS_WHISPER_MODEL",
            "small",
        )

        self.tts_enabled = os.getenv("JARVIS_TTS_ENABLED", "1").strip() == "1"
        self.tts_voice = os.getenv("JARVIS_TTS_VOICE", "").strip()
        self.tts_rate = int(os.getenv("JARVIS_TTS_RATE", "175"))
        self.tts_volume = min(1.0, max(0.0, float(os.getenv("JARVIS_TTS_VOLUME", "1.0"))))
        self.voice_recovery_attempts = max(0, int(os.getenv("JARVIS_VOICE_RECOVERY_ATTEMPTS", "3")))
        self.voice_recovery_delay = max(0.0, float(os.getenv("JARVIS_VOICE_RECOVERY_DELAY", "0.5")))

        self._whisper_model: Optional[WhisperModel] = None
        self._tts = None

    # ========================================================
    # Dependency checks
    # ========================================================

    def microphone_available(self) -> bool:
        if sd is None:
            return False

        try:
            if self.microphone is not None:
                device = sd.query_devices(self.microphone, "input")
                return int(device.get("max_input_channels", 0)) > 0
            devices = sd.query_devices()
            return any(int(device.get("max_input_channels", 0)) > 0 for device in devices)
        except Exception:
            logger.exception("Microphone capability check failed", extra={"event": "voice.microphone_check_failed"})
            return False

    def stt_available(self) -> bool:
        return WhisperModel is not None

    def tts_available(self) -> bool:
        return pyttsx3 is not None

    # ========================================================
    # Whisper model
    # ========================================================

    def _get_whisper_model(self):

        if WhisperModel is None:
            raise RuntimeError(
                "faster-whisper is not installed."
            )

        if self._whisper_model is None:

            compute_type = os.getenv(
                "JARVIS_WHISPER_COMPUTE_TYPE",
                "int8",
            )

            device = os.getenv(
                "JARVIS_WHISPER_DEVICE",
                "cpu",
            )

            print(
                f"[Jarvis] Loading Whisper model "
                f"'{self.whisper_model_name}'..."
            )

            cpu_threads = max(
                2,
                min(
                    8,
                    os.cpu_count() or 4,
                ),
            )

            self._whisper_model = WhisperModel(
                self.whisper_model_name,
                device=device,
                compute_type=compute_type,
                cpu_threads=cpu_threads,
                num_workers=1,
            )

            print(
                f"[Jarvis] Whisper CPU threads: {cpu_threads}"
            )

        return self._whisper_model

    def preload(self) -> bool:
        """Preload speech models so the first voice request is faster."""

        try:
            start = time.perf_counter()
            self._get_whisper_model()
            elapsed = time.perf_counter() - start

            print(
                f"[Jarvis] Whisper preloaded in {elapsed:.2f}s"
            )

            logger.info(
                "Whisper model preloaded in %.2fs",
                elapsed,
            )

            return True

        except Exception:
            logger.exception(
                "Whisper preload failed",
                extra={"event": "voice.whisper_preload_failed"},
            )
            return False

    # ========================================================
    # Audio recording
    # ========================================================

    def record_until_silence(self) -> Path:
        """
        Record microphone audio until the user stops speaking.

        Returns path to temporary WAV file.
        """

        if sd is None:
            raise RuntimeError(
                "sounddevice is not installed."
            )

        print("[Jarvis] Listening...")

        block_duration = 0.1

        block_size = int(
            self.sample_rate * block_duration
        )

        silence_blocks_needed = max(
            1,
            int(
                self.silence_seconds
                / block_duration
            ),
        )

        maximum_blocks = int(
            self.max_record_seconds
            / block_duration
        )

        recorded_blocks = []

        silence_blocks = 0
        speech_started = False

        with sd.InputStream(
            device=self.microphone,
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype="float32",
            blocksize=block_size,
        ) as stream:

            for _ in range(maximum_blocks):

                block, _overflowed = stream.read(
                    block_size
                )

                block = np.asarray(
                    block,
                    dtype=np.float32,
                )

                volume = float(
                    np.sqrt(
                        np.mean(
                            np.square(block)
                        )
                    )
                )

                # Speech detected
                if volume >= self.silence_threshold:

                    speech_started = True
                    silence_blocks = 0

                elif speech_started:

                    silence_blocks += 1

                recorded_blocks.append(
                    block.copy()
                )

                if (
                    speech_started
                    and silence_blocks
                    >= silence_blocks_needed
                ):
                    break

        if not speech_started:
            raise RuntimeError(
                "No speech was detected."
            )

        audio = np.concatenate(
            recorded_blocks,
            axis=0,
        )

        audio = np.clip(
            audio,
            -1.0,
            1.0,
        )

        audio_int16 = (
            audio * 32767
        ).astype(np.int16)

        temp_file = tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False,
        )

        temp_path = Path(temp_file.name)
        temp_file.close()

        with wave.open(
            str(temp_path),
            "wb",
        ) as wav_file:

            wav_file.setnchannels(
                self.channels
            )

            wav_file.setsampwidth(2)

            wav_file.setframerate(
                self.sample_rate
            )

            wav_file.writeframes(
                audio_int16.tobytes()
            )

        return temp_path

    # ========================================================
    # Speech-to-text
    # ========================================================

    @staticmethod
    def _latin_ratio(text: str) -> float:
        """Estimate how much of a transcript is Latin/English-like text."""
        letters = [char for char in text if char.isalpha()]
        if not letters:
            return 0.0

        latin = sum(
            1
            for char in letters
            if ("a" <= char.casefold() <= "z")
        )
        return latin / len(letters)

    @staticmethod
    def _command_score(text: str) -> int:
        """Prefer transcripts that preserve known Jarvis command vocabulary."""
        value = text.casefold()

        keywords = (
            "jarvis",
            "tiktok",
            "tik tok",
            "video",
            "create",
            "make",
            "generate",
            "produce",
            "build",
            "about",
            "solar",
            "panel",
            "panels",
            "whatsapp",
            "message",
            "chrome",
            "vs code",
            "vscode",
            "open",
        )

        score = sum(
            2
            for keyword in keywords
            if keyword in value
        )

        # Reward complete command-like phrases.
        if (
            ("create" in value or "make" in value or "generate" in value)
            and "video" in value
        ):
            score += 4

        if "tiktok" in value or "tik tok" in value:
            score += 3

        if "jarvis" in value:
            score += 2

        return score

    @staticmethod
    def _normalize_command_text(text: str) -> str:
        """Normalize a few common STT variants without changing normal speech."""
        value = " ".join(str(text).split()).strip()

        replacements = (
            (r"(?i)\btik\s*tok\b", "TikTok"),
            (r"(?i)\bvs\s+code\b", "VS Code"),
        )

        for pattern, replacement in replacements:
            value = re.sub(pattern, replacement, value)

        return value

    def _transcribe_once(
        self,
        model,
        audio_path: Path,
        whisper_language: Optional[str],
    ) -> dict:
        """Run one Faster-Whisper pass."""
        segments, info = model.transcribe(
            str(audio_path),
            language=whisper_language,
            task="transcribe",
            beam_size=3,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 300,
            },
            condition_on_previous_text=False,
            temperature=0.0,
            initial_prompt=(
                "This is a command to a Windows AI assistant named Jarvis. "
                "The user may speak English, Urdu, or Roman Urdu. "
                "Common commands: Jarvis create a TikTok video about solar panels; "
                "create a video about solar panels; TikTok agent start karo; "
                "WhatsApp kholo; Basit ko message karo; Sulaiman ko message karo; "
                "Chrome kholo; VS Code kholo."
            ),
            hotwords=(
                "Jarvis TikTok Tik Tok video create make generate solar panel panels "
                "solar panels WhatsApp Basit Sulaiman Muhammad Sulaiman "
                "Chrome VS Code YouTube Gemini"
            ),
        )

        text_parts = []

        for segment in segments:
            value = segment.text.strip()
            if value:
                text_parts.append(value)

        transcript = self._normalize_command_text(
            " ".join(text_parts).strip()
        )

        return {
            "text": transcript,
            "language": getattr(info, "language", None),
            "language_probability": getattr(
                info,
                "language_probability",
                None,
            ),
        }

    def transcribe(
        self,
        audio_path: Path,
        language: Optional[str] = None,
    ) -> dict:

        model = self._get_whisper_model()

        log_event(
            logger,
            logging.INFO,
            "voice.transcription_started",
            "Speech transcription started",
            model=self.whisper_model_name,
        )

        selected_language = (
            language
            or self.recognition_language
        )

        whisper_language = None

        if selected_language in {"ur", "en"}:
            whisper_language = selected_language

        primary = self._transcribe_once(
            model,
            audio_path,
            whisper_language,
        )

        best = primary

        primary_text = primary.get("text", "")
        detected_language = primary.get("language")
        latin_ratio = self._latin_ratio(primary_text)

        # Auto-detection can label mostly-English Jarvis commands as Urdu or
        # another language. In that case retry the same audio as English and
        # keep whichever transcript better preserves command vocabulary.
        should_retry_english = (
            selected_language == "auto"
            and bool(primary_text)
            and (
                detected_language not in {"en", "ur"}
                or (
                    detected_language == "ur"
                    and latin_ratio >= 0.65
                )
            )
        )

        if should_retry_english:
            print(
                "[Jarvis] Language check: retrying command in English..."
            )

            english = self._transcribe_once(
                model,
                audio_path,
                "en",
            )

            primary_score = self._command_score(
                primary.get("text", "")
            )
            english_score = self._command_score(
                english.get("text", "")
            )

            # Prefer English when command preservation is better, or tied
            # while the auto pass was clearly language-mismatched.
            if (
                english_score > primary_score
                or (
                    english_score == primary_score
                    and english.get("text")
                )
            ):
                best = english

        transcript = best.get("text", "").strip()
        detected_language = best.get("language")
        probability = best.get(
            "language_probability"
        )

        result = {
            "text": transcript,
            "language": detected_language,
            "language_probability": probability,
        }

        log_event(
            logger,
            logging.INFO,
            "voice.transcription_completed",
            "Speech transcription completed",
            success=bool(transcript),
            language=detected_language,
            text_length=len(transcript),
        )

        return result

    # ========================================================
    # Listen + transcribe
    # ========================================================

    def listen(
        self,
        language: Optional[str] = None,
    ) -> dict:

        audio_path = None
        total_start = time.perf_counter()

        try:
            # 1. Record microphone audio
            record_start = time.perf_counter()
            audio_path = self.record_until_silence()
            record_time = time.perf_counter() - record_start

            # 2. Speech-to-text
            stt_start = time.perf_counter()
            result = self.transcribe(
                audio_path,
                language=language,
            )
            stt_time = time.perf_counter() - stt_start
            total_time = time.perf_counter() - total_start

            logger.info(
                "Voice Performance | Record: %.2fs | STT: %.2fs | Total: %.2fs",
                record_time,
                stt_time,
                total_time,
            )

            print(
                f"[Jarvis Voice Speed] "
                f"Record={record_time:.2f}s | "
                f"STT={stt_time:.2f}s | "
                f"Total={total_time:.2f}s"
            )

            return result

        finally:
            if audio_path and audio_path.exists():
                try:
                    audio_path.unlink()
                except OSError:
                    logger.debug(
                        "Temporary voice file cleanup failed",
                        exc_info=True,
                        extra={"event": "voice.cleanup_failed"},
                    )

    # ========================================================
    # Text-to-speech
    # ========================================================

    def _get_tts(self):

        if pyttsx3 is None:
            raise RuntimeError(
                "pyttsx3 is not installed."
            )

        if self._tts is None:

            self._tts = pyttsx3.init()

            self._tts.setProperty("rate", self.tts_rate)

            self._tts.setProperty("volume", self.tts_volume)

            if self.tts_voice:
                selected = self.tts_voice.casefold()
                for voice in self._tts.getProperty("voices") or []:
                    voice_id = str(getattr(voice, "id", ""))
                    voice_name = str(getattr(voice, "name", ""))
                    if selected in {voice_id.casefold(), voice_name.casefold()}:
                        self._tts.setProperty("voice", voice_id)
                        break
                else:
                    logger.warning("Configured TTS voice was not found", extra={"event": "voice.tts_voice_not_found", "voice": self.tts_voice})

        return self._tts

    def speak(
        self,
        text: str,
    ) -> bool:

        text = text.strip()

        if not text:
            return False

        if not self.tts_enabled:
            log_event(logger, logging.INFO, "voice.tts_skipped", "Voice output is disabled", success=False)
            return False

        if pyttsx3 is None:

            print(
                f"Jarvis: {text}"
            )

            return False

        try:

            engine = self._get_tts()

            engine.say(text)
            engine.runAndWait()

            return True

        except Exception as exc:

            logger.exception("Text-to-speech failed gracefully", extra={"event": "voice.tts_failed"})

            print(
                f"[Jarvis TTS Error] {exc}"
            )

            print(
                f"Jarvis: {text}"
            )

            return False

    # ========================================================
    # Diagnostic test
    # ========================================================

    def status(self) -> dict:

        return {
            "microphone":
                self.microphone_available(),

            "speech_to_text":
                self.stt_available(),

            "text_to_speech":
                self.tts_available(),

            "whisper_model":
                self.whisper_model_name,

            "microphone_device":
                self.microphone,

            "recognition_language":
                self.recognition_language,

            "tts_enabled":
                self.tts_enabled,

            "tts_voice":
                self.tts_voice or "system-default",
        }


speech = SpeechEngine()