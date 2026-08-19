"""Resolve credential IDs from environment variables without persisting secrets."""

from __future__ import annotations

import os
import ctypes
from ctypes import wintypes
from dataclasses import dataclass


class CredentialError(RuntimeError):
    pass


@dataclass(frozen=True)
class FacebookCredential:
    credential_id: str
    access_token: str
    graph_version: str
    default_page_id: str = ""


@dataclass(frozen=True)
class GoogleDriveCredential:
    credential_id: str
    access_token: str


class CredentialManager:
    SERVICE = "JarvisWorkflow"

    @classmethod
    def _read_windows_secret(cls, provider: str, credential_id: str) -> str:
        if os.name != "nt": return ""
        class CREDENTIALW(ctypes.Structure):
            _fields_=[("Flags",wintypes.DWORD),("Type",wintypes.DWORD),("TargetName",wintypes.LPWSTR),("Comment",wintypes.LPWSTR),("LastWritten",wintypes.FILETIME),("CredentialBlobSize",wintypes.DWORD),("CredentialBlob",ctypes.POINTER(ctypes.c_ubyte)),("Persist",wintypes.DWORD),("AttributeCount",wintypes.DWORD),("Attributes",ctypes.c_void_p),("TargetAlias",wintypes.LPWSTR),("UserName",wintypes.LPWSTR)]
        pointer=ctypes.POINTER(CREDENTIALW)()
        target=f"{cls.SERVICE}:{provider}:{credential_id}"
        if not ctypes.windll.advapi32.CredReadW(target,1,0,ctypes.byref(pointer)): return ""
        try:
            raw=ctypes.string_at(pointer.contents.CredentialBlob,pointer.contents.CredentialBlobSize)
            return raw.decode("utf-16-le")
        finally: ctypes.windll.advapi32.CredFree(pointer)

    @classmethod
    def save_secret(cls, provider: str, credential_id: str, secret: str) -> None:
        if os.name != "nt": raise CredentialError("Secure credential storage requires Windows Credential Manager.")
        class CREDENTIALW(ctypes.Structure):
            _fields_=[("Flags",wintypes.DWORD),("Type",wintypes.DWORD),("TargetName",wintypes.LPWSTR),("Comment",wintypes.LPWSTR),("LastWritten",wintypes.FILETIME),("CredentialBlobSize",wintypes.DWORD),("CredentialBlob",ctypes.POINTER(ctypes.c_ubyte)),("Persist",wintypes.DWORD),("AttributeCount",wintypes.DWORD),("Attributes",ctypes.c_void_p),("TargetAlias",wintypes.LPWSTR),("UserName",wintypes.LPWSTR)]
        raw=secret.encode("utf-16-le"); blob=(ctypes.c_ubyte*len(raw)).from_buffer_copy(raw)
        credential=CREDENTIALW(0,1,f"{cls.SERVICE}:{provider}:{credential_id}","Jarvis Workflow credential",wintypes.FILETIME(),len(raw),ctypes.cast(blob,ctypes.POINTER(ctypes.c_ubyte)),2,0,None,None,credential_id)
        if not ctypes.windll.advapi32.CredWriteW(ctypes.byref(credential),0):
            raise CredentialError("Windows Credential Manager could not save this credential.")

    def load_google_drive(self, credential_id: str) -> GoogleDriveCredential:
        credential_id = (credential_id or "google_drive_default").strip()
        suffix = "" if credential_id == "google_drive_default" else "_" + credential_id.upper().replace("-", "_")
        token = (self._read_windows_secret("google_drive",credential_id) or os.getenv(f"GOOGLE_DRIVE_ACCESS_TOKEN{suffix}", "")).strip()
        if not token:
            raise CredentialError(
                f"Google Drive credential '{credential_id}' is not configured. "
                f"Set GOOGLE_DRIVE_ACCESS_TOKEN{suffix} in the Jarvis environment."
            )
        return GoogleDriveCredential(credential_id, token)

    def load_facebook(self, credential_id: str) -> FacebookCredential:
        credential_id = (credential_id or "facebook_default").strip()
        suffix = "" if credential_id == "facebook_default" else "_" + credential_id.upper().replace("-", "_")
        token = (self._read_windows_secret("facebook",credential_id) or
            os.getenv(f"FACEBOOK_ACCESS_TOKEN{suffix}", "").strip()
            or os.getenv(f"META_ACCESS_TOKEN{suffix}", "").strip()
            or (os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN", "").strip() if not suffix else "")
        )
        if not token:
            raise CredentialError(
                f"Facebook credential '{credential_id}' is not configured. "
                f"Set FACEBOOK_ACCESS_TOKEN{suffix} in the Jarvis environment."
            )
        version = os.getenv(
            f"FACEBOOK_GRAPH_VERSION{suffix}",
            os.getenv("FACEBOOK_GRAPH_VERSION", "v25.0"),
        ).strip()
        if not version.startswith("v"):
            version = "v" + version
        page_id = os.getenv(
            f"FACEBOOK_PAGE_ID{suffix}", os.getenv("FACEBOOK_PAGE_ID", "")
        ).strip()
        return FacebookCredential(credential_id, token, version, page_id)

class CredentialStore(CredentialManager):
    """Credential-store abstraction; environment is the current protected backend."""
    def references(self) -> list[dict]:
        references=[]
        if os.getenv("FACEBOOK_ACCESS_TOKEN") or os.getenv("META_ACCESS_TOKEN") or os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN"):
            references.append({"id":"facebook_default","provider":"facebook","display_name":"Default Facebook connection"})
        if os.getenv("GOOGLE_DRIVE_ACCESS_TOKEN"):
            references.append({"id":"google_drive_default","provider":"google_drive","display_name":"Default Google Drive connection"})
        for provider, default_id, name in (("facebook","facebook_default","Facebook Graph account"),("google_drive","google_drive_default","Google Drive account")):
            if self._read_windows_secret(provider,default_id) and not any(item["id"]==default_id for item in references):
                references.append({"id":default_id,"provider":provider,"display_name":name})
        return references
