"""Generic HTTP connector with bounded requests and structured output."""
from __future__ import annotations
import json, urllib.error, urllib.parse, urllib.request
from observability import redact_sensitive
from .base import BaseConnector

class HttpConnector(BaseConnector):
    def __init__(self, opener=None): self.opener = opener or urllib.request.urlopen
    def operations(self): return ("request",)
    def execute(self, operation, config, input_data, context):
        if operation != "request": raise ValueError(f"Unsupported HTTP operation: {operation}")
        method = str(config.get("method", "GET")).upper()
        if method not in {"GET","POST","PUT","PATCH","DELETE"}: raise ValueError(f"Unsupported HTTP method: {method}")
        url = str(config.get("url", "")).strip()
        if not url.startswith(("http://", "https://")): raise ValueError("HTTP URL must start with http:// or https://")
        query = config.get("query") or {}; headers = {str(k): str(v) for k,v in (config.get("headers") or {}).items()}
        if query: url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)
        body = config.get("body"); data = None
        if body not in (None, ""):
            if isinstance(body, (dict,list)): data=json.dumps(body).encode(); headers.setdefault("Content-Type","application/json")
            else: data=str(body).encode()
        request=urllib.request.Request(url,data=data,headers=headers,method=method)
        try:
            with self.opener(request, timeout=min(120.0,max(.1,float(config.get("timeout",30))))) as response:
                raw=response.read(); status=getattr(response,"status",200); response_headers=dict(response.headers.items()) if getattr(response,"headers",None) else {}
        except urllib.error.HTTPError as exc: raw=exc.read(); status=exc.code; response_headers={}
        except (urllib.error.URLError,TimeoutError,OSError) as exc: raise RuntimeError(str(redact_sensitive(str(exc)))) from None
        text=raw.decode("utf-8",errors="replace"); result={"status_code":status,"headers":redact_sensitive(response_headers)}
        try: result["json"]=json.loads(text)
        except json.JSONDecodeError: result["text"]=text[:1_000_000]
        return {**input_data,"http":result}
