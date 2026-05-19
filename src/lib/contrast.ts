/**
 * Pick a readable text color for an arbitrary background.
 *
 * Uses the YIQ luminance formula (same approach GitHub uses for label
 * legibility): a weighted-RGB perceived brightness. Returns black for light
 * backgrounds and white for dark ones, so a label with a light-blue background
 * doesn't render white-on-near-white.
 *
 * Accepts hex strings with or without a leading "#", and both 3- and 6-digit
 * forms. Invalid input falls back to white (safer on the typical dark UI).
 *
 * Use this anywhere a *dynamic* color from an external source (GitHub label
 * colors, user-picked theme colors, etc.) backs text. Static palette colors
 * defined in CSS vars are already paired with a readable text color and don't
 * need this.
 */
export function pickReadableTextColor(hexBackground: string): "#000000" | "#ffffff" {
  const cleaned = hexBackground.trim().replace(/^#/, "");
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;

  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return "#ffffff";
  }

  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);

  // YIQ — coefficients reflect the human eye's relative sensitivity per channel.
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}
