export function tableModel(value) {
  const rows = Array.isArray(value) ? value : [value];
  const normalizedRows = rows.map((row) =>
    row && typeof row === "object" && !Array.isArray(row) ? row : { value: row }
  );
  const columns = [...new Set(normalizedRows.flatMap((row) => Object.keys(row)))];
  return { columns, rows: normalizedRows };
}

export function displayCell(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function inferSchema(value, depth = 0, maxDepth = 3) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const sample = value.find((item) => item !== null && item !== undefined);
    return {
      type: "array",
      count: value.length,
      items: depth < maxDepth && sample !== undefined
        ? inferSchema(sample, depth + 1, maxDepth)
        : undefined,
    };
  }
  if (typeof value === "object") {
    return {
      type: "object",
      fields: depth < maxDepth
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
              key,
              inferSchema(child, depth + 1, maxDepth),
            ])
          )
        : undefined,
    };
  }
  return { type: typeof value };
}
