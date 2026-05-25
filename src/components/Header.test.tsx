import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "@/components/Header";

function renderHeader(overrides: Partial<React.ComponentProps<typeof Header>> = {}) {
  const onTabChange = vi.fn();
  const onPRTileClick = vi.fn();
  const onReviewTileClick = vi.fn();
  const onToggleCollapsed = vi.fn();
  const ref = createRef<HTMLElement>();
  const props: React.ComponentProps<typeof Header> = {
    ref,
    prCount: 3,
    reviewRequestedCount: 1,
    issueCount: 2,
    updatedAt: null,
    refreshing: false,
    collapsed: false,
    density: "comfortable",
    activeTab: "prs",
    reviewFilterOn: false,
    hasGroups: false,
    allGroupsExpanded: false,
    onRefresh: vi.fn(),
    onSettings: vi.fn(),
    onHelp: vi.fn(),
    onToggleDensity: vi.fn(),
    onToggleAllGroups: vi.fn(),
    onToggleCollapsed,
    onTabChange,
    onPRTileClick,
    onReviewTileClick,
    ...overrides,
  };
  const utils = render(<Header {...props} />);
  return { ...utils, onTabChange, onPRTileClick, onReviewTileClick, onToggleCollapsed };
}

describe("Header stat tiles", () => {
  it("review tile click fires review handler + switches to PR tab", async () => {
    const user = userEvent.setup();
    const { onTabChange, onReviewTileClick, onPRTileClick } = renderHeader();
    await user.click(screen.getByTitle("1 review"));
    expect(onReviewTileClick).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("prs");
    expect(onPRTileClick).not.toHaveBeenCalled();
  });

  it("PR tile click fires PR handler + switches to PR tab", async () => {
    const user = userEvent.setup();
    const { onTabChange, onPRTileClick, onReviewTileClick } = renderHeader({
      activeTab: "issues",
    });
    await user.click(screen.getByTitle("3 PRs"));
    expect(onPRTileClick).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("prs");
    expect(onReviewTileClick).not.toHaveBeenCalled();
  });

  it("Issues tile click does NOT fire the review-filter handlers", async () => {
    const user = userEvent.setup();
    const { onTabChange, onPRTileClick, onReviewTileClick } = renderHeader();
    await user.click(screen.getByTitle("2 issues"));
    expect(onTabChange).toHaveBeenCalledWith("issues");
    expect(onPRTileClick).not.toHaveBeenCalled();
    expect(onReviewTileClick).not.toHaveBeenCalled();
  });

  it("any tile click expands the panel when collapsed", async () => {
    const user = userEvent.setup();
    const { onToggleCollapsed } = renderHeader({ collapsed: true });
    await user.click(screen.getByTitle("3 PRs"));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("does not toggle collapse when the panel is already expanded", async () => {
    const user = userEvent.setup();
    const { onToggleCollapsed } = renderHeader({ collapsed: false });
    await user.click(screen.getByTitle("3 PRs"));
    expect(onToggleCollapsed).not.toHaveBeenCalled();
  });

  it("PR tile is active when on PR tab and review filter is OFF", () => {
    renderHeader({ activeTab: "prs", reviewFilterOn: false });
    const pr = screen.getByTitle("3 PRs");
    const review = screen.getByTitle("1 review");
    // `bg-[var(--accent)]/10` is the active-state class added by StatTile.
    expect(pr.className).toMatch(/bg-\[var\(--accent\)\]\/10/);
    expect(review.className).not.toMatch(/bg-\[var\(--accent\)\]\/10/);
  });

  it("Review tile is active when on PR tab and review filter is ON", () => {
    renderHeader({ activeTab: "prs", reviewFilterOn: true });
    const pr = screen.getByTitle("3 PRs");
    const review = screen.getByTitle("1 review");
    expect(review.className).toMatch(/bg-\[var\(--accent\)\]\/10/);
    expect(pr.className).not.toMatch(/bg-\[var\(--accent\)\]\/10/);
  });

  it("tiles with count 0 are not rendered", () => {
    renderHeader({ prCount: 0, reviewRequestedCount: 0, issueCount: 5 });
    expect(screen.queryByTitle(/PRs$/)).toBeNull();
    expect(screen.queryByTitle(/review$/)).toBeNull();
    expect(screen.getByTitle("5 issues")).toBeInTheDocument();
  });
});
