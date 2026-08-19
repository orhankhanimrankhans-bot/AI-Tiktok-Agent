import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from dotenv import load_dotenv


# Project paths
JARVIS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = JARVIS_DIR.parent
IS_PACKAGED = bool(getattr(sys, "frozen", False))
_packaged_root = Path(os.getenv("LOCALAPPDATA", PROJECT_ROOT)) / "Jarvis"
USER_DATA_ROOT = Path(os.getenv("JARVIS_USER_DATA_DIR", "")).expanduser() if os.getenv("JARVIS_USER_DATA_DIR") else (_packaged_root if IS_PACKAGED else PROJECT_ROOT)
load_dotenv(USER_DATA_ROOT / ".env")
if USER_DATA_ROOT != PROJECT_ROOT:
    load_dotenv(PROJECT_ROOT / ".env", override=False)
DATA_DIR = USER_DATA_ROOT / "data"
LOGS_DIR = USER_DATA_ROOT / "logs"
BACKUPS_DIR = USER_DATA_ROOT / "backups"
UPDATES_DIR = USER_DATA_ROOT / "updates"


DATA_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)
BACKUPS_DIR.mkdir(exist_ok=True)
UPDATES_DIR.mkdir(exist_ok=True)


# Jarvis identity
JARVIS_NAME = "Jarvis"


# Language settings
DEFAULT_LANGUAGE = "auto"
SUPPORTED_LANGUAGES = [
    "en",
    "ur",
    "ur-roman",
    "mixed",
]


# Assistant behavior
RESPONSE_STYLE = "natural"
DEFAULT_AUTONOMY = "assisted"


# Safety
ALLOW_DESTRUCTIVE_ACTIONS = False
REQUIRE_CONFIRMATION_FOR_MESSAGES = True


# Conversation
MAX_CONVERSATION_HISTORY = 20

_PARSE_ISSUES: list[tuple[str, str]] = []


def _number_setting(name: str, default: str, cast, *, minimum: float | None = None):
    raw = os.getenv(name, default).strip()
    try:
        value = cast(raw)
        if minimum is not None and value < minimum:
            raise ValueError
        return value
    except (TypeError, ValueError):
        _PARSE_ISSUES.append((name, f"Set {name} to a number greater than or equal to {minimum}."))
        return cast(default)

# ChatGPT conversation brain. TikTok provider configuration remains separate.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
JARVIS_OPENAI_MODEL = os.getenv("JARVIS_OPENAI_MODEL", "gpt-5.6-luna").strip()
JARVIS_OPENAI_TIMEOUT = _number_setting("JARVIS_OPENAI_TIMEOUT", "45", float, minimum=0.1)
JARVIS_OPENAI_MAX_RETRIES = _number_setting("JARVIS_OPENAI_MAX_RETRIES", "2", int, minimum=0)
JARVIS_SYSTEM_PROMPT = os.getenv("JARVIS_SYSTEM_PROMPT", "").strip()
JARVIS_SYSTEM_PROMPT_FILE = os.getenv("JARVIS_SYSTEM_PROMPT_FILE", "").strip()
JARVIS_INTENT_CONFIDENCE_THRESHOLD = min(
    1.0,
    max(0.0, _number_setting("JARVIS_INTENT_CONFIDENCE_THRESHOLD", "0.65", float)),
)


def _csv_setting(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(part.strip().casefold() for part in os.getenv(name, default).split(",") if part.strip())


# Modular skill lifecycle. An empty enabled list permits all registered skills.
JARVIS_ENABLED_SKILLS = _csv_setting(
    "JARVIS_ENABLED_SKILLS", "conversation,automation,whatsapp,system_health"
)
JARVIS_DISABLED_SKILLS = _csv_setting("JARVIS_DISABLED_SKILLS")
JARVIS_ENABLED_PLUGINS = _csv_setting("JARVIS_ENABLED_PLUGINS", "diagnostics")
JARVIS_DISABLED_PLUGINS = _csv_setting("JARVIS_DISABLED_PLUGINS")
JARVIS_UPDATE_MANIFEST_URL = os.getenv("JARVIS_UPDATE_MANIFEST_URL", "").strip()
JARVIS_AUTO_BACKUP = os.getenv("JARVIS_AUTO_BACKUP", "1" if IS_PACKAGED else "0").strip() == "1"


@dataclass(frozen=True)
class ConfigIssue:
    key: str
    message: str
    severity: str = "error"


@dataclass(frozen=True)
class ConfigReport:
    issues: tuple[ConfigIssue, ...]

    @property
    def valid(self) -> bool:
        return not any(issue.severity == "error" for issue in self.issues)

    def safe_summary(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "model": JARVIS_OPENAI_MODEL,
            "api_key_configured": bool(OPENAI_API_KEY),
            "enabled_skills": JARVIS_ENABLED_SKILLS,
            "enabled_plugins": JARVIS_ENABLED_PLUGINS,
            "issues": [issue.__dict__ for issue in self.issues],
        }


def validate_configuration(values: Mapping[str, object] | None = None) -> ConfigReport:
    """Validate startup settings without ever returning secret values."""
    current = {
        "OPENAI_API_KEY": OPENAI_API_KEY,
        "JARVIS_OPENAI_MODEL": JARVIS_OPENAI_MODEL,
        "JARVIS_OPENAI_TIMEOUT": JARVIS_OPENAI_TIMEOUT,
        "JARVIS_OPENAI_MAX_RETRIES": JARVIS_OPENAI_MAX_RETRIES,
        "JARVIS_INTENT_CONFIDENCE_THRESHOLD": JARVIS_INTENT_CONFIDENCE_THRESHOLD,
    }
    if values:
        current.update(values)
    issues = [ConfigIssue(key, message) for key, message in _PARSE_ISSUES]
    if not str(current["OPENAI_API_KEY"]).strip():
        issues.append(ConfigIssue("OPENAI_API_KEY", "Add OPENAI_API_KEY to .env to enable ChatGPT conversation.", "warning"))
    if not str(current["JARVIS_OPENAI_MODEL"]).strip():
        issues.append(ConfigIssue("JARVIS_OPENAI_MODEL", "Set JARVIS_OPENAI_MODEL to a supported model name."))
    checks = (
        ("JARVIS_OPENAI_TIMEOUT", current["JARVIS_OPENAI_TIMEOUT"], 0.1, "Use a timeout of at least 0.1 seconds."),
        ("JARVIS_OPENAI_MAX_RETRIES", current["JARVIS_OPENAI_MAX_RETRIES"], 0, "Retries cannot be negative."),
        ("JARVIS_INTENT_CONFIDENCE_THRESHOLD", current["JARVIS_INTENT_CONFIDENCE_THRESHOLD"], 0, "Confidence must be between 0 and 1."),
    )
    for key, value, minimum, message in checks:
        try:
            numeric = float(value)
            invalid = numeric < minimum or (key.endswith("THRESHOLD") and numeric > 1)
        except (TypeError, ValueError):
            invalid = True
        if invalid:
            issues.append(ConfigIssue(key, message))
    return ConfigReport(tuple(issues))
