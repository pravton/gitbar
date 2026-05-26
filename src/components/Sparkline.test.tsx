import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "@/components/Sparkline";

function getPath(container: HTMLElement): string {
  const path = container.querySelector("path");
  return path?.getAttribute("d") ?? "";
}

describe("Sparkline", () => {
  it("renders nothing with fewer than two values", () => {
    const { container, rerender } = render(<Sparkline values={[]} />);
    expect(container.querySelector("svg")).toBeNull();
    rerender(<Sparkline values={[3]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders an SVG path for two or more values", () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector("svg")).not.toBeNull();
    const d = getPath(container);
    // 3 points => one M + two L commands.
    expect(d.match(/M/g)?.length).toBe(1);
    expect(d.match(/L/g)?.length).toBe(2);
  });

  it("pins a flat series to the vertical center", () => {
    // Equal values produce a horizontal line at the middle of the box.
    // For default 14px height and 1px stroke, center is at y = 1 + 6 = 7.
    const { container } = render(
      <Sparkline values={[5, 5, 5, 5]} width={32} height={14} />,
    );
    const d = getPath(container);
    // Every y-coord should be the same (the vertical center).
    const ys = d
      .split(/[ML]/)
      .filter(Boolean)
      .map((seg) => Number.parseFloat(seg.split(",")[1] ?? "NaN"));
    expect(ys.length).toBe(4);
    expect(new Set(ys).size).toBe(1);
  });

  it("scales the highest value to the top inset", () => {
    // With a non-flat series, the maximum should land near y = inset
    // (which is `strokeWidth`, so 1 by default) and the minimum near
    // height - inset.
    const height = 14;
    const { container } = render(
      <Sparkline values={[1, 9]} width={32} height={height} />,
    );
    const d = getPath(container);
    const coords = d
      .split(/[ML]/)
      .filter(Boolean)
      .map((seg) => seg.split(",").map(Number));
    const [, y1] = coords[1] ?? [];
    expect(y1).toBeCloseTo(1, 1); // max value -> top inset
  });

  it("respects custom width/height in the SVG attributes", () => {
    const { container } = render(
      <Sparkline values={[1, 2]} width={80} height={20} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("80");
    expect(svg?.getAttribute("height")).toBe("20");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 80 20");
  });
});
