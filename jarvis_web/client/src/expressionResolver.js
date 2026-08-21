const EXPRESSION = /{{\s*\$json(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\s*}}/g;

function readPath(input, path) {
  if (!path) return input;
  let value = input;
  for (const segment of path.split(".")) {
    if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), segment)) {
      throw new Error(`Expression path $json.${path} was not found.`);
    }
    value = value[segment];
  }
  return value;
}

export function resolveExpression(value, input) {
  if (typeof value !== "string") return value;
  const exact = value.match(/^{{\s*\$json(?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?\s*}}$/);
  if (exact) return readPath(input, exact[1]);
  return value.replace(EXPRESSION, (_, path) => {
    const resolved = readPath(input, path);
    return resolved == null ? "" : typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
  });
}

// One array means independent current items. Results are flattened by one level only.
export async function executePerItem(input, executor) {
  const items = Array.isArray(input) ? input : [input];
  const results = [];
  for (const item of items) {
    const result = await executor(item);
    if (Array.isArray(result)) results.push(...result);
    else results.push(result);
  }
  return Array.isArray(input) ? results : results[0];
}
