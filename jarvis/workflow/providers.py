"""Provider identity and icon loading for the Jarvis workflow UI."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from PySide6.QtGui import QIcon

@dataclass(frozen=True)
class ProviderDefinition:
    id: str
    name: str
    icon: str
    color: str

class ProviderIconRegistry:
    ASSET_ROOT = Path(__file__).resolve().parent / "assets" / "providers"
    _providers = {
        "facebook": ProviderDefinition("facebook", "Facebook", "facebook.svg", "#1877F2"),
        "google_drive": ProviderDefinition("google_drive", "Google Drive", "google_drive.svg", "#34A853"),
        "google drive": ProviderDefinition("google_drive", "Google Drive", "google_drive.svg", "#34A853"),
        "tiktok": ProviderDefinition("tiktok", "TikTok", "tiktok.svg", "#FF3158"),
        "whatsapp": ProviderDefinition("whatsapp", "WhatsApp", "whatsapp.svg", "#25D366"),
        "youtube": ProviderDefinition("youtube", "YouTube", "youtube.svg", "#FF3030"),
        "jarvis": ProviderDefinition("jarvis", "Jarvis", "jarvis.svg", "#23D7FF"),
        "http": ProviderDefinition("http", "HTTP", "http.svg", "#A78BFA"),
        "file": ProviderDefinition("file", "Files", "files.svg", "#5BC0EB"),
        "data": ProviderDefinition("data", "Data", "files.svg", "#5BC0EB"),
        "schedule": ProviderDefinition("schedule", "Schedule", "schedule.svg", "#F4B942"),
        "logic": ProviderDefinition("logic", "Logic", "logic.svg", "#D18BF2"),
        "web": ProviderDefinition("web", "Web", "http.svg", "#A78BFA"),
    }

    @classmethod
    def provider(cls, provider_id: str, node_type: str = "") -> ProviderDefinition:
        key = (provider_id or "jarvis").casefold().replace("-", "_")
        if node_type == "schedule_trigger": key = "schedule"
        return cls._providers.get(key, cls._providers["jarvis"])

    @classmethod
    def icon(cls, provider_id: str, node_type: str = "") -> QIcon:
        definition = cls.provider(provider_id, node_type)
        return QIcon(str(cls.ASSET_ROOT / definition.icon))
