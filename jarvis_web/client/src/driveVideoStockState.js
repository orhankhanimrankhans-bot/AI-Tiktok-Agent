import { useEffect, useState } from "react";


export function useDriveVideoStock(apiBaseUrl) {
  const [data, setData] = useState({ folders: [], scanning: false });
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/drive/video-stock`, { credentials: "include", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 403 ? "Drive monitoring requires storage and workflow viewing access." : "Drive stock is unavailable.");
        setData(await response.json()); setError("");
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiBaseUrl]);
  async function refresh() {
    if (refreshing || data.scanning) return;
    setRefreshing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/drive/video-stock/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Could not refresh Drive stock. Check your access and retry.");
      setData(await response.json()); setError("");
    } catch (e) { setError(e.message); } finally { setRefreshing(false); }
  }
  return { ...data, error, refresh, refreshing };
}

export function stockSummary(stock) {
  const folders = stock.folders || [];
  const counts = Object.fromEntries(["HEALTHY", "LOW", "CRITICAL", "UNAVAILABLE"].map(status => [status, folders.filter(f => f.status === status).length]));
  const tone = stock.error || !folders.length || counts.UNAVAILABLE ? "disabled" : counts.CRITICAL ? "critical" : counts.LOW ? "warning" : "healthy";
  return { counts, tone, text: stock.error ? "Unavailable" : !folders.length ? "No source folders" : `${folders.length} folders · ${counts.CRITICAL} critical · ${counts.LOW} low` };
}
