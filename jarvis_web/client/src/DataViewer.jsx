import { displayCell, inferSchema, tableModel } from "./dataView.js";

function SchemaRows({ schema, path = "root", depth = 0 }) {
  const label = path === "root" ? "data" : path.split(".").at(-1);
  const detail = schema.type === "array" ? `array (${schema.count})` : schema.type;
  return <>
    <div className={`schema-row schema-depth-${Math.min(depth, 3)}`}><strong>{label}</strong><span>{detail}</span></div>
    {schema.fields && Object.entries(schema.fields).map(([key, child]) => (
      <SchemaRows key={`${path}.${key}`} schema={child} path={`${path}.${key}`} depth={depth + 1} />
    ))}
    {schema.items && <SchemaRows schema={schema.items} path={`${path}.items`} depth={depth + 1} />}
  </>;
}

export default function DataViewer({ value, tab }) {
  const count = Array.isArray(value) ? value.length : null;
  const viewer = tab === "JSON"
    ? <pre className="json-output">{JSON.stringify(value, null, 2)}</pre>
    : null;
  if (tab === "JSON") {
    return <div className="data-viewer">{count !== null && <div className="data-item-count">{count} {count === 1 ? "item" : "items"}</div>}{viewer}</div>;
  }
  if (tab === "Table") {
    const model = tableModel(value);
    return <div className="data-viewer">{count !== null && <div className="data-item-count">{count} {count === 1 ? "item" : "items"}</div>}<div className="array-table-wrap">
      <table className="array-output-table">
        <thead><tr>{model.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{model.rows.map((row, index) => <tr key={index}>{model.columns.map((column) => <td key={column}>{displayCell(row[column])}</td>)}</tr>)}</tbody>
      </table>
    </div></div>;
  }
  return <div className="data-viewer">{count !== null && <div className="data-item-count">{count} {count === 1 ? "item" : "items"}</div>}<div className="schema-output"><SchemaRows schema={inferSchema(value)} /></div></div>;
}
