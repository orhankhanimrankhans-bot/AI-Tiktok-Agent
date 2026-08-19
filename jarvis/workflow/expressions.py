"""Resolve safe workflow field mappings such as {{$json.video_path}}."""

from __future__ import annotations

import re


EXPRESSION = re.compile(r"\{\{\s*\$json(?:\.([A-Za-z_][\w.\-\[\]]*))?\s*\}\}")
NODE_EXPRESSION = re.compile(r'''\{\{\s*\$node\["([^"]+)"\]\.output(?:\.([A-Za-z_][\w.\-\[\]]*))?\s*\}\}''')


def _path_get(value, path: str | None):
    """Resolve dotted keys and numeric indexes without eval()."""
    current = value
    for key, index in re.findall(r"([^.\[\]]+)|\[(\d+)\]", path or ""):
        part = key or index
        if key:
            current = current.get(part) if isinstance(current, dict) else None
        else:
            position = int(part)
            current = current[position] if isinstance(current, (list, tuple)) and position < len(current) else None
        if current is None:
            break
    return current


def resolve_value(value, input_data: dict, node_outputs: dict | None = None):
    if not isinstance(value, str):
        return value
    full = EXPRESSION.fullmatch(value)

    def lookup(path: str | None):
        return _path_get(input_data, path)

    node_full = NODE_EXPRESSION.fullmatch(value)
    if node_full:
        return _path_get((node_outputs or {}).get(node_full.group(1), {}), node_full.group(2))
    if full:
        return lookup(full.group(1))
    rendered = EXPRESSION.sub(lambda match: str(lookup(match.group(1)) or ""), value)
    def node_lookup(match):
        current=_path_get((node_outputs or {}).get(match.group(1),{}),match.group(2))
        return str(current or "")
    return NODE_EXPRESSION.sub(node_lookup, rendered)

def resolve_structure(value, input_data: dict, node_outputs: dict | None = None):
    if isinstance(value, dict): return {key: resolve_structure(item,input_data,node_outputs) for key,item in value.items()}
    if isinstance(value, list): return [resolve_structure(item,input_data,node_outputs) for item in value]
    return resolve_value(value,input_data,node_outputs)
