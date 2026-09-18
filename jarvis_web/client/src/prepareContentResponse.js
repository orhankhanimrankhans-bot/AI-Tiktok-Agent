// Never read or expose a non-JSON response body.
export async function readPrepareContentResponse(response, logger = console) {
  const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0;
  const mime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const json = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mime);
  const id = response.headers.get("x-corex-request-id") || "";
  const diagnostic = { status, contentType: json ? "json" : mime === "text/html" ? "text/html" : "other",
    ...( /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ? { correlationId: id } : {}) };
  function invalidResponse() {
    const error = new Error(`Prepare Content received an unexpected server response (HTTP ${status || "unknown"}).`);
    error.code = "prepare_content_invalid_http_response";
    error.diagnostic = diagnostic;
    try { logger?.warn?.("[PrepareContentHttpResponse]", diagnostic); } catch {}
    return error;
  }
  if (!json) throw invalidResponse();
  let data;
  try { data = await response.json(); } catch { throw invalidResponse(); }
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Prepare Content failed.");
  return data;
}
