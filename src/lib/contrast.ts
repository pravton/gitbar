/**
 * Pick a readable text color (black or white) for an arbitrary background.
 *
 * Uses the WCAG 2.x relative-luminance formula and chooses whichever of
 * black or white has the higher contrast ratio against the background. That
 * fixes a known weakness of the cheaper YIQ approach: for mid-gray
 * backgrounds like `#7f7f7f` YIQ picks white, but black actually has the
 * higher WCAG contrast ratio.
 *
 * Accepts hex strings with or without a leading `#`, in both 3- and 6-digit
 * forms. Invalid input falls back to white (safer on the typical dark UI).
 *
 * Use this anywhere a *dynamic* color from an external source (GitHub label
 * colors, user-picked theme colors, etc.) backs text. Static palette colors
 * defined in CSS vars are already paired with a readable text color and
 * don't need this.
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

  const bg = relativeLuminance(r, g, b);
  // WCAG contrast ratio with text luminance L_t against background L_bg is
  //   (max(L_bg, L_t) + 0.05) / (min(L_bg, L_t) + 0.05)
  // For text = white (L = 1): ratio_white = 1.05 / (bg + 0.05)
  // For text = black (L = 0): ratio_black = (bg + 0.05) / 0.05
  const ratioWhite = 1.05 / (bg + 0.05);
  const ratioBlack = (bg + 0.05) / 0.05;
  return ratioBlack >= ratioWhite ? "#000000" : "#ffffff";
}

function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (channel: number) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}
