import { memo, useMemo } from "react";

interface SparklineProps {
  /** Series of count values, ordered oldest -> newest. */
  values: number[];
  /** Rendered SVG width in CSS pixels. */
  width?: number;
  /** Rendered SVG height in CSS pixels. */
  height?: number;
  /** Stroke color. Defaults to `currentColor` so the parent can drive
      it via Tailwind's text-* classes. */
  stroke?: string;
  /** Stroke width in pixels. */
  strokeWidth?: number;
  className?: string;
}

/**
 * Minimal SVG sparkline. Two design choices worth flagging:
 *
 *   - We always plot at least two points: a single sample would
 *     render as a dot at the right edge, which looks broken. With
 *     fewer than two values we render nothing (the caller can show
 *     a placeholder).
 *
 *   - The y-axis is normalized to the series' own min/max plus a
 *     small inset so the line never touches the top or bottom edge
 *     of the box. A perfectly flat series (all same value) draws a
 *     horizontal line at vertical center.
 *
 * Pure visual: no axes, no labels, no interaction.
 */
function SparklineImpl({
  values,
  width = 36,
  height = 14,
  stroke = "currentColor",
  strokeWidth = 1,
  className,
}: SparklineProps) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const inset = strokeWidth; // keep stroke fully inside the viewBox
    const usableW = width - inset * 2;
    const usableH = height - inset * 2;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const stepX = usableW / (values.length - 1);

    const points = values.map((v, i) => {
      const x = inset + i * stepX;
      // Flat series: pin to the vertical center. Otherwise normalize
      // into [0, usableH] then invert so larger values draw higher
      // (SVG y grows downward).
      const y =
        range === 0
          ? inset + usableH / 2
          : inset + (1 - (v - min) / range) * usableH;
      return [x, y] as const;
    });

    return points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
  }, [values, width, height, strokeWidth]);

  if (!path) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const Sparkline = memo(SparklineImpl);
