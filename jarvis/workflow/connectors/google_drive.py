"""Google Drive v3 storage adapter for workflow search, download, and delete."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from pathlib import Path

from observability import redact_sensitive

from ..credentials.store import GoogleDriveCredential
from .base import BaseConnector


class StorageConnector(BaseConnector, ABC):
    @abstractmethod
    def search(self, **settings) -> dict: ...

    @abstractmethod
    def download(self, file_id: str, destination: Path, **settings) -> dict: ...

    @abstractmethod
    def delete(self, file_id: str, **settings) -> dict: ...


class GoogleDriveAPIError(RuntimeError):
    pass


class GoogleDriveConnector(StorageConnector):
    API = "https://www.googleapis.com/drive/v3"

    def __init__(self, credential: GoogleDriveCredential, *, opener=None, timeout: float = 60.0) -> None:
        self.credential = credential
        self.opener = opener or urllib.request.urlopen
        self.timeout = timeout

    def operations(self) -> tuple[str, ...]:
        return "test_connection", "search", "download", "delete"

    def _request(self, method: str, endpoint: str, params: dict | None = None):
        url = f"{self.API}/{endpoint.lstrip('/')}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(
            url, method=method, headers={"Authorization": f"Bearer {self.credential.access_token}"}
        )
        try:
            return self.opener(request, timeout=self.timeout)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                error = json.loads(raw).get("error", {})
                message = error.get("message") or "Google Drive API request failed"
                code = error.get("code", exc.code)
            except json.JSONDecodeError:
                message, code = "Google Drive API request failed", exc.code
            clean = str(redact_sensitive(message)).replace(self.credential.access_token, "[REDACTED]")
            if code in (401, 403):
                clean = f"Permission required: Google Drive file access. {clean}"
            raise GoogleDriveAPIError(f"{clean} (Google Drive error {code})") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            clean = str(redact_sensitive(str(exc))).replace(self.credential.access_token, "[REDACTED]")
            raise GoogleDriveAPIError(clean) from None

    def test_connection(self, credential=None, config=None) -> dict:
        with self._request("GET", "about", {"fields": "user(displayName,emailAddress)"}) as response:
            return json.loads(response.read().decode("utf-8"))

    @staticmethod
    def _escape_query(value: str) -> str:
        return value.replace("\\", "\\\\").replace("'", "\\'")

    def search(self, **settings) -> dict:
        clauses = ["trashed = false"]
        folder_id = str(settings.get("folder_id") or settings.get("folder") or "").strip()
        if folder_id:
            clauses.append(f"'{self._escape_query(folder_id)}' in parents")
        query = str(settings.get("query") or "").strip()
        if query:
            clauses.append(f"name contains '{self._escape_query(query)}'")
        mime_type = str(settings.get("mime_type") or settings.get("file_type") or "").strip()
        if mime_type:
            clauses.append(f"mimeType = '{self._escape_query(mime_type)}'")
        maximum = max(1, min(int(settings.get("maximum_results") or 100), 1000))
        params = {
            "q": " and ".join(clauses),
            "pageSize": maximum,
            "fields": "files(id,name,mimeType,size,modifiedTime,parents,webViewLink)",
            "orderBy": str(settings.get("order_by") or "modifiedTime desc"),
        }
        with self._request("GET", "files", params) as response:
            payload = json.loads(response.read().decode("utf-8"))
        files = [{
            "id": item.get("id", ""), "name": item.get("name", ""),
            "mime_type": item.get("mimeType", ""), "size": item.get("size"),
            "modified_time": item.get("modifiedTime"), "parents": item.get("parents", []),
            "web_view_link": item.get("webViewLink", ""),
        } for item in payload.get("files", [])]
        return {"files": files, "count": len(files)}

    def download(self, file_id: str, destination: Path, **settings) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", file_id or ""):
            raise ValueError("Download File requires an exact Google Drive file ID.")
        with self._request("GET", f"files/{file_id}", {"fields": "id,name,mimeType,size"}) as response:
            metadata = json.loads(response.read().decode("utf-8"))
        if metadata.get("mimeType", "").startswith("application/vnd.google-apps"):
            raise ValueError("Google Workspace documents require an explicit export format and cannot be downloaded as binary files.")
        destination = Path(destination).resolve()
        destination.mkdir(parents=True, exist_ok=True)
        safe_name = Path(str(metadata.get("name") or file_id)).name
        local_path = destination / safe_name
        temporary = local_path.with_suffix(local_path.suffix + ".part")
        with self._request("GET", f"files/{file_id}", {"alt": "media"}) as response, temporary.open("wb") as target:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)
        temporary.replace(local_path)
        return {"file_id": file_id, "id": file_id, "file_name": safe_name, "local_path": str(local_path), "mime_type": metadata.get("mimeType", "")}

    def delete(self, file_id: str, **settings) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", file_id or ""):
            raise ValueError("Delete File requires an exact Google Drive file ID; wildcards and paths are not allowed.")
        response = self._request("DELETE", f"files/{file_id}")
        if hasattr(response, "close"):
            response.close()
        return {"success": True, "deleted": True, "file_id": file_id, "provider": "google_drive"}

    def execute(self, operation: str, config: dict, input_data: dict, context) -> dict:
        if operation == "test_connection":
            return {**input_data, "google_drive": self.test_connection()}
        if operation == "search":
            return {**input_data, **self.search(**config)}
        if operation == "download":
            file_id = str(config.get("file_id") or input_data.get("id") or input_data.get("file_id") or "")
            destination = Path(config.get("destination") or Path.cwd() / "output" / "workflow_downloads")
            return {**input_data, **self.download(file_id, destination, **config)}
        if operation == "delete":
            file_id = str(config.get("file_id") or input_data.get("file_id") or input_data.get("id") or "")
            return {**input_data, **self.delete(file_id, **config)}
        raise ValueError(f"Unsupported Google Drive operation: {operation}")
