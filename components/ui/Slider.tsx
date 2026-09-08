import type { CSSProperties } from "react";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
  /** Suffix appended to the numeral readout. Defaults to "%". */
  unit?: string;
}

// Fill percentage handed to globals.css via the --fill-percent custom
// property, which the .ft-slider track/thumb pseudo-elements read.
function fillPercent(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const clamped = Math.min(Math.max(value, min), max);
  return ((clamped - min) / (max - min)) * 100;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  disabled = false,
  unit = "%",
}: SliderProps) {
  const percent = fillPercent(value, min, max);
  const trackStyle = {
    "--fill-percent": `${percent}%`,
  } as CSSProperties;

  return (
    <div className="flex w-full items-center gap-3">
      <label className="sr-only" htmlFor={`slider-${label}`}>
        {label}
      </label>
      <input
        id={`slider-${label}`}
        type="range"
        className="ft-slider"
        style={trackStyle}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {/* Fixed-width readout: reserves space for 3 digits + the unit so the
          layout never reflows as the value changes (SPEC §7). */}
      <span className="numeral inline-block w-14 shrink-0 text-right text-sm text-text">
        {value}
        {unit}
      </span>
    </div>
  );
}
