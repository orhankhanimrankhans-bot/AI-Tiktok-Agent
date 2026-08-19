"""Meta Graph API adapter used by Jarvis workflows, independent of PySide6."""

from __future__ import annotations

import json
import mimetypes
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from uuid import uuid4

import requests

from observability import redact_sensitive

from ..credentials.store import FacebookCredential
from .base import BaseConnector


PERMISSIONS = {
    "list_pages": "pages_show_list",
    "get_page_info": "pages_read_engagement",
    "create_page_post": "pages_manage_posts",
    "upload_page_video": "pages_manage_posts",
    "check_video_status": "pages_read_engagement",
}


class FacebookAPIError(RuntimeError):
    def __init__(self, message: str, code: int | str = "unknown", permission: str = "") -> None:
        self.code = code; self.permission = permission
        prefix = f"Permission required: {permission}. " if permission else ""
        super().__init__(f"{prefix}{message} (Meta error {code})")


class FacebookConnector(BaseConnector):
    """Supported Facebook Page operations through the versioned Graph API."""

    def __init__(self, credential: FacebookCredential, *, opener=None, timeout: float = 60.0) -> None:
        self.credential = credential; self.opener = opener or urllib.request.urlopen; self.timeout = timeout
        self.base_url = f"https://graph.facebook.com/{credential.graph_version}"
        self._page_tokens: dict[str, str] = {}

    @staticmethod
    def _sanitize_message(message: str, tokens: tuple[str, ...] = ()) -> str:
        clean = str(redact_sensitive(message))
        for token in tokens:
            if token: clean = clean.replace(token, "[REDACTED]")
        clean = re.sub(r"access_token=[^&\s]+", "access_token=[REDACTED]", clean, flags=re.I)
        return clean[:600]

    def _decode(self, response) -> dict:
        payload = response.read().decode("utf-8", errors="replace")
        return json.loads(payload) if payload else {}

    def graph_request(self, method: str, endpoint: str, params=None, data=None, files=None, *, access_token: str | None = None) -> dict:
        token = access_token or self.credential.access_token
        params = dict(params or {}); data = dict(data or {})
        target = endpoint if endpoint.startswith("https://") else f"{self.base_url}/{endpoint.lstrip('/')}"
        if method.upper() == "GET":
            params["access_token"] = token
            target += ("&" if "?" in target else "?") + urllib.parse.urlencode(params)
            body, headers = None, {}
        elif files:
            data["access_token"] = token
            boundary = f"Jarvis{uuid4().hex}"
            def multipart_stream():
                for key, value in data.items():
                    yield f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()
                for key, file_path in files.items():
                    path = Path(file_path); mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                    yield f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"; filename=\"{path.name}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
                    with path.open("rb") as source:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk: break
                            yield chunk
                    yield b"\r\n"
                yield f"--{boundary}--\r\n".encode()
            try:
                response = requests.request(method.upper(), target, data=multipart_stream(), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, timeout=self.timeout)
                try: result = response.json() if response.content else {}
                except ValueError: result = {}
                if response.status_code >= 400 or "error" in result:
                    error = result.get("error", {}); code = error.get("code", response.status_code)
                    permission = PERMISSIONS.get(self._operation_for_endpoint(method, endpoint), "") if str(code) in {"10","200","299"} else ""
                    raise FacebookAPIError(self._sanitize_message(error.get("message", "Meta Graph API request failed"), (token,)), code, permission)
                return result
            except requests.RequestException as exc:
                raise FacebookAPIError(self._sanitize_message(str(exc), (token,)), "network") from None
        else:
            data["access_token"] = token; body = urllib.parse.urlencode(data).encode()
            headers = {"Content-Type": "application/x-www-form-urlencoded"}
        request = urllib.request.Request(target, data=body, headers=headers, method=method.upper())
        try:
            with self.opener(request, timeout=self.timeout) as response: result = self._decode(response)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try: error = json.loads(raw).get("error", {})
            except json.JSONDecodeError: error = {}
            code = error.get("code", exc.code); message = error.get("message", "Meta Graph API request failed")
            permission = ""
            if str(code) in {"10", "200", "299"}: permission = PERMISSIONS.get(self._operation_for_endpoint(method, endpoint), "")
            raise FacebookAPIError(self._sanitize_message(message, (token,)), code, permission) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise FacebookAPIError(self._sanitize_message(str(exc), (token,)), "network") from None
        if "error" in result:
            error = result["error"]; raise FacebookAPIError(self._sanitize_message(error.get("message", "Meta API error"), (token,)), error.get("code", "unknown"))
        return result

    @staticmethod
    def _operation_for_endpoint(method: str, endpoint: str) -> str:
        if endpoint.rstrip("/") == "me/accounts": return "list_pages"
        if endpoint.endswith("/feed") and method.upper() == "POST": return "create_page_post"
        if endpoint.endswith("/videos") and method.upper() == "POST": return "upload_page_video"
        if "status" in str(endpoint): return "check_video_status"
        return "get_page_info"

    def test_connection(self) -> dict:
        return self.graph_request("GET", "me", {"fields": "id,name"})

    def operations(self) -> tuple[str, ...]:
        return ("test_connection","list_pages","get_page_info","get_page_posts","create_page_post","upload_page_video","check_video_status","custom_graph_request")

    def execute(self, operation: str, config: dict, input_data: dict, context) -> dict:
        page_id=str(config.get("page_id") or self.credential.default_page_id)
        if operation=="test_connection": result=self.test_connection()
        elif operation=="list_pages": result={"pages":self.list_pages()}
        elif operation=="get_page_info": result=self.get_page_info(page_id)
        elif operation=="get_page_posts": result=self.get_page_posts(page_id)
        elif operation=="create_page_post": result=self.create_page_post(page_id,str(config.get("message") or input_data.get("caption") or ""))
        elif operation=="upload_page_video": result=self.upload_page_video(page_id,str(config.get("video_path") or input_data.get("video_path") or ""),str(config.get("description") or input_data.get("caption") or ""))
        elif operation=="check_video_status": result=self.check_video_status(str(config.get("publish_id") or input_data.get("publish_id") or ""))
        elif operation=="custom_graph_request":
            method=str(config.get("method","GET")).upper(); endpoint=str(config.get("endpoint","")).strip().strip("/")
            if method not in {"GET","POST","DELETE"}: raise ValueError("Facebook HTTP method must be GET, POST, or DELETE.")
            if not endpoint or not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*",endpoint): raise ValueError("Facebook node/edge contains unsupported characters.")
            result=self.graph_request(method,endpoint,params=config.get("params"),data=config.get("data"),access_token=self._page_token(endpoint.split('/')[0]) if endpoint.split('/')[0].isdigit() else None)
        else: raise ValueError(f"Unsupported Facebook operation: {operation}")
        return {**input_data,"facebook":result}

    def list_pages(self) -> list[dict]:
        result = self.graph_request("GET", "me/accounts", {"fields": "id,name,access_token,tasks", "limit": 100})
        pages = []
        for item in result.get("data", []):
            page_id = str(item.get("id", "")); page_token = str(item.get("access_token", ""))
            if page_id and page_token: self._page_tokens[page_id] = page_token
            pages.append({key: value for key, value in item.items() if key != "access_token"})
        return pages

    def _page_token(self, page_id: str) -> str:
        if page_id in self._page_tokens: return self._page_tokens[page_id]
        if self.credential.default_page_id and page_id == self.credential.default_page_id:
            return self.credential.access_token
        self.list_pages()
        return self._page_tokens.get(page_id, self.credential.access_token)

    def get_page_info(self, page_id: str) -> dict:
        return self.graph_request("GET", page_id, {"fields": "id,name,category,fan_count,followers_count,link,picture"}, access_token=self._page_token(page_id))

    def get_page_posts(self, page_id: str) -> dict:
        return self.graph_request("GET", f"{page_id}/posts", {"fields":"id,message,created_time,permalink_url","limit":25}, access_token=self._page_token(page_id))

    def create_page_post(self, page_id: str, message: str, **kwargs) -> dict:
        if not message.strip(): raise ValueError("Facebook post message is required.")
        data = {"message": message, **{k: v for k, v in kwargs.items() if v not in (None, "")}}
        return self.graph_request("POST", f"{page_id}/feed", data=data, access_token=self._page_token(page_id))

    def upload_page_video(self, page_id: str, video_path: str, description: str = "", **kwargs) -> dict:
        path = Path(video_path).expanduser().resolve()
        if not path.is_file(): raise ValueError(f"Video file does not exist: {path}")
        data = {"description": description, **{k: v for k, v in kwargs.items() if v not in (None, "")}}
        return self.graph_request("POST", f"{page_id}/videos", data=data, files={"source": path}, access_token=self._page_token(page_id))

    def check_video_status(self, publish_id: str) -> dict:
        return self.graph_request("GET", publish_id, {"fields": "id,status"})
