export function normalizeHex(value) {
  const input = String(value || "").trim();
  if (/^#[0-9a-f]{3}$/i.test(input)) return `#${[...input.slice(1)].map((digit) => digit.repeat(2)).join("")}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : null;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function hexToRgb(value) {
  const hex = normalizeHex(value); if (!hex) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsl({ r, g, b }) {
  const values = [r, g, b].map((value) => clamp(value, 0, 255) / 255); const max = Math.max(...values); const min = Math.min(...values);
  const lightness = (max + min) / 2; const delta = max - min; let hue = 0;
  if (delta) {
    if (max === values[0]) hue = ((values[1] - values[2]) / delta) % 6;
    else if (max === values[1]) hue = (values[2] - values[0]) / delta + 2;
    else hue = (values[0] - values[1]) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { h: Math.round(hue), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
}

export function hslToRgb({ h, s, l }) {
  const hue = ((clamp(h, 0, 360) % 360) + 360) % 360; const saturation = clamp(s, 0, 100) / 100; const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation; const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)); const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsv({ r, g, b }) {
  const values = [r, g, b].map((value) => clamp(value, 0, 255) / 255); const max = Math.max(...values); const min = Math.min(...values); const delta = max - min;
  let hue = 0;
  if (delta) hue = max === values[0] ? 60 * (((values[1] - values[2]) / delta) % 6)
    : max === values[1] ? 60 * ((values[2] - values[0]) / delta + 2) : 60 * ((values[0] - values[1]) / delta + 4);
  return { h: Math.round((hue + 360) % 360), s: Math.round((max ? delta / max : 0) * 100), v: Math.round(max * 100) };
}

export function hsvToRgb({ h, s, v }) {
  const hue = ((clamp(h, 0, 360) % 360) + 360) % 360; const saturation = clamp(s, 0, 100) / 100; const value = clamp(v, 0, 100) / 100;
  const chroma = value * saturation; const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)); const m = value - chroma;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function contrastRatio(first, second) {
  const luminance = (hex) => { const rgb = hexToRgb(hex); if (!rgb) return 0; const channels = [rgb.r, rgb.g, rgb.b]
    .map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05);
}

export function safeCustomColors(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeHex).filter(Boolean))].slice(0, 24);
}
