import { useRef, useState } from "react";
import { contrastRatio, hexToRgb, hslToRgb, hsvToRgb, normalizeHex, rgbToHex, rgbToHsl, rgbToHsv } from "./appearanceColor.js";

const numberValue = (value, max) => Math.min(max, Math.max(0, Number(value) || 0));

export default function AdvancedColorPicker({ label, initialColor, contrastBackground, customColors, onPreview, onConfirm, onCancel, onAddCustom }) {
  const initialRgb = hexToRgb(initialColor) || { r: 0, g: 0, b: 0 };
  const [rgb, setRgb] = useState(initialRgb); const [hexDraft, setHexDraft] = useState(rgbToHex(initialRgb)); const surfaceRef = useRef(null);
  const hsv = rgbToHsv(rgb); const hsl = rgbToHsl(rgb); const hex = rgbToHex(rgb); const invalidHex = !normalizeHex(hexDraft);
  const updateRgb = (next) => { const safe = { r: numberValue(next.r, 255), g: numberValue(next.g, 255), b: numberValue(next.b, 255) };
    setRgb(safe); const nextHex = rgbToHex(safe); setHexDraft(nextHex); onPreview(nextHex); };
  const updateHex = (value) => { setHexDraft(value); const normalized = normalizeHex(value); if (normalized) updateRgb(hexToRgb(normalized)); };
  const updateHsl = (key, value) => updateRgb(hslToRgb({ ...hsl, [key]: numberValue(value, key === "h" ? 360 : 100) }));
  const updateHue = (value) => updateRgb(hsvToRgb({ ...hsv, h: numberValue(value, 360) }));
  const updateSurface = (event) => { const rect = surfaceRef.current?.getBoundingClientRect(); if (!rect) return;
    const s = Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 100);
    const v = Math.round((1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))) * 100);
    updateRgb(hsvToRgb({ h: hsv.h, s, v })); };
  const surfaceKey = (event) => { const step = event.shiftKey ? 10 : 1; if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); updateRgb(hsvToRgb({ h: hsv.h, s: hsv.s + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
      v: hsv.v + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0) })); };
  const lowContrast = contrastBackground && contrastRatio(hex, contrastBackground) < 4.5;
  return <div className="advanced-color-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="advanced-color-dialog" role="dialog" aria-modal="true" aria-labelledby="advanced-color-title">
      <header><div><span>JARVIS COLOR LAB</span><h2 id="advanced-color-title">{label}</h2></div><button type="button" onClick={onCancel} aria-label="Cancel color editing">×</button></header>
      <div className="advanced-color-main">
        <div className="color-visual-controls">
          <div ref={surfaceRef} className="color-sv-surface" style={{ "--picker-hue": `hsl(${hsv.h} 100% 50%)` }} role="slider" tabIndex="0"
            aria-label="Saturation and brightness" aria-valuetext={`${hsv.s}% saturation, ${hsv.v}% value`}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateSurface(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSurface(event); }} onKeyDown={surfaceKey}>
            <i style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
          </div>
          <label className="color-hue-control"><span>Hue spectrum</span><input type="range" min="0" max="360" value={hsv.h} onChange={(event) => updateHue(event.target.value)} /></label>
          <div className="color-preview-row"><div style={{ background: hex }} /><div><span>Selected color</span><strong>{hex.toUpperCase()}</strong></div></div>
          {lowContrast && <p className="color-contrast-warning" role="status">Low contrast against the related background. The color is still allowed.</p>}
        </div>
        <div className="color-value-controls">
          <label className={invalidHex ? "invalid" : ""}><span>HEX</span><input value={hexDraft.toUpperCase()} onChange={(event) => updateHex(event.target.value)} maxLength="7" aria-invalid={invalidHex} /></label>
          {invalidHex && <p className="color-validation">Enter a valid 3- or 6-digit HEX color.</p>}
          <fieldset><legend>RGB</legend>{[["r", "Red"], ["g", "Green"], ["b", "Blue"]].map(([key, name]) => <label key={key}><span>{name}</span><input type="number" min="0" max="255" value={rgb[key]} onChange={(event) => updateRgb({ ...rgb, [key]: event.target.value })} /></label>)}</fieldset>
          <fieldset><legend>HSL</legend>{[["h", "Hue", 360], ["s", "Saturation", 100], ["l", "Lightness", 100]].map(([key, name, max]) => <label key={key}><span>{name}</span><input type="number" min="0" max={max} value={hsl[key]} onChange={(event) => updateHsl(key, event.target.value)} /></label>)}</fieldset>
        </div>
      </div>
      <div className="custom-color-section"><div><strong>Custom Colors</strong><button type="button" onClick={() => onAddCustom(hex)}>Add to Custom Colors</button></div>
        <div>{customColors.map((color) => <button key={color} type="button" style={{ background: color }} title={color} aria-label={`Use custom color ${color}`} onClick={() => updateHex(color)} />)}</div></div>
      <footer><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="color-confirm" onClick={() => onConfirm(hex)}>OK</button></footer>
    </section>
  </div>;
}
