import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { contrastRatio, hexToRgb, hslToRgb, hsvToRgb, normalizeHex, rgbToHex, rgbToHsl, rgbToHsv, safeCustomColors } from "./appearanceColor.js";
import { safeAppearance } from "./workflowCanvas.js";

test("HEX accepts three or six digits and invalid values fail safely", () => {
  assert.equal(normalizeHex("#0ef"), "#00eeff"); assert.equal(normalizeHex("#7534FF"), "#7534ff"); assert.equal(normalizeHex("red"), null);
  assert.deepEqual(hexToRgb("#ff0055"), { r: 255, g: 0, b: 85 }); assert.equal(rgbToHex({ r: 255, g: 0, b: 85 }), "#ff0055");
});

test("RGB, HSL, and HSV representations remain synchronized", () => {
  const rgb = hexToRgb("#7534ff"); const hsl = rgbToHsl(rgb); const hsv = rgbToHsv(rgb);
  for (const roundTrip of [hslToRgb(hsl), hsvToRgb(hsv)]) {
    assert.ok(["r", "g", "b"].every((key) => Math.abs(roundTrip[key] - rgb[key]) <= 2));
  }
  assert.deepEqual(rgbToHsl({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, l: 100 });
});

test("custom swatches are normalized, deduplicated, bounded, and persisted appearance-only", () => {
  const colors = safeCustomColors(["#000", "#000000", "bad", ...Array.from({ length: 30 }, (_, index) => `#${index.toString(16).padStart(6, "0")}`)]);
  assert.equal(colors[0], "#000000"); assert.equal(colors.length, 24);
  const appearance = safeAppearance({ customColors: ["#0ef", "invalid"], accessToken: "forbidden" });
  assert.deepEqual(appearance.customColors, ["#00eeff"]); assert.equal(Object.hasOwn(appearance, "accessToken"), false);
});

test("contrast calculation identifies readable and low-contrast pairs", () => {
  assert.ok(contrastRatio("#ffffff", "#000000") > 20); assert.ok(contrastRatio("#777777", "#777777") < 1.1);
});

test("workflow theme menu exposes only Dark and Light without the color panel", () => {
  const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.match(app, /className="theme-menu"/);
  assert.match(app, /\[\["dark", "Dark"\], \["light", "Light"\]\]/);
  assert.match(app, /applySimpleTheme/);
  assert.doesNotMatch(app, /setColorEditor|colorEditor\.original|Reset Entire Theme|Reset Section|appearance-popover/);
  assert.match(styles, /\.theme-menu/);
});
