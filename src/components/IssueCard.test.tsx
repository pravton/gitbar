import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { IssueCard } from "@/components/IssueCard";
import type { Issue } from "@/types";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const openMock = open as unknown as ReturnType<typeof vi.fn>;

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 11,
    title: "bug: oops",
    url: "https://github.com/o/r/issues/11",
    created_at: new Date().toISOString(),
    repository: { name_with_owner: "o/r" },
    labels: [],
    state: "OPEN",
    comments: 0,
    ...overrides,
  };
}

describe("IssueCard", () => {
  it("opens the issue when the card body is clicked", async () => {
    render(<IssueCard issue={issue()} />);
    await userEvent.click(screen.getByText("bug: oops"));
    expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/issues/11");
  });

  it("has no comments toggle when there are no comments", () => {
    render(<IssueCard issue={issue({ comments: 0 })} />);
    expect(screen.queryByTitle(/comments \(C\)/)).not.toBeInTheDocument();
  });

  it("toggles the comments panel without opening the issue", async () => {
    invokeMock.mockResolvedValue({ entries: [], omitted: 0 });
    render(<IssueCard issue={issue({ comments: 3 })} />);
    const toggle = screen.getByRole("button", { name: /3\s*comments/ });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(invokeMock).toHaveBeenCalledWith("get_item_comments", {
      itemUrl: "https://github.com/o/r/issues/11",
    });
    expect(openMock).not.toHaveBeenCalled();
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
  });

  it("keeps the selection hook on the outer card element", () => {
    render(<IssueCard issue={issue()} selected />);
    const card = document.querySelector('[data-card-url="https://github.com/o/r/issues/11"]');
    expect(card?.tagName).toBe("ARTICLE");
    expect(card).toHaveAttribute("aria-current", "true");
  });
});
