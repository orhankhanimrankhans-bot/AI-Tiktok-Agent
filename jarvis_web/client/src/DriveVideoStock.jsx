import { stockSummary } from "./driveVideoStockState.js";
import "./DriveVideoStock.css";
const date = value => value ? new Date(value).toLocaleString() : "Not checked yet";

export default function DriveVideoStock({ stock }) {
  const { counts } = stockSummary(stock);
  const lastScan = Math.max(0, ...stock.folders.map(f => f.lastChecked || 0));
  return <section className="drive-stock" aria-label="Google Drive video stock">
    <header><div><h2>GOOGLE DRIVE VIDEO STOCK</h2><p>Source folders · automatic checks every 6 hours</p></div><button type="button" onClick={stock.refresh} disabled={stock.refreshing || stock.scanning}>{stock.refreshing || stock.scanning ? "Checking…" : "Refresh Now"}</button></header>
    <p className="drive-stock-summary">{stock.folders.length} folders · {counts.HEALTHY} healthy · {counts.LOW} low · {counts.CRITICAL} critical · {counts.UNAVAILABLE} unavailable</p>
    <small>Last scan: {date(lastScan)}</small>
    {stock.error && <p role="alert">{stock.error}</p>}
    {!stock.error && !stock.folders.length && <p>No configured Google Drive source folders found in this workspace.</p>}
    <div className="drive-stock-list">{stock.folders.map((folder, i) => <article key={`${folder.folderId}-${i}`} className={`drive-stock-folder ${folder.status.toLowerCase()}`}>
      <div><h3>{folder.name}</h3><b><i aria-hidden="true" />{folder.status}</b></div>
      <strong>{folder.count ?? "—"} <span>{folder.status === "UNAVAILABLE" && folder.count !== null ? "videos at last successful check" : "videos remaining"}</span></strong>
      <small>Last successful check: {date(folder.lastSuccess)}</small>
      {folder.error && <p>{folder.error}</p>}
    </article>)}</div>
  </section>;
}
