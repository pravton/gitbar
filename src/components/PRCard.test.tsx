import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-shell";
import { PRCard } from "@/components/PRCard";
import type { PullRequest } from "@/types";

const openMock = open as unknown as ReturnType<typeof vi.fn>;

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 7,
    title: "feat: thing",
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    created_at: new Date().toISOString(),
    repository: { name_with_owner: "o/r" },
    author: { login: "alice", avatar_url: null },
    is_draft: false,
    review_decision: null,
    ci_status: "SUCCESS",
    additions: 1,
    deletions: 0,
    ...overrides,
  };
}

describe("PRCard", () => {
  it("renders CI passing for SUCCESS status", () => {
    render(<PRCard pr={pr()} />);
    expect(screen.getByText(/CI passing/)).toBeInTheDocument();
  });

  it("marks failing when CI is FAILURE", () => {
    render(<PRCard pr={pr({ ci_status: "FAILURE" })} />);
    expect(screen.getByText(/CI failing/)).toBeInTheDocument();
  });

  it("marks pending when CI is PENDING", () => {
    render(<PRCard pr={pr({ ci_status: "PENDING" })} />);
    expect(screen.getByText(/CI pending/)).toBeInTheDocument();
  });

  it("renders CI unknown when no status", () => {
    render(<PRCard pr={pr({ ci_status: null })} />);
    expect(screen.getByText(/CI unknown/)).toBeInTheDocument();
  });

  it("opens the PR url via the shell plugin on click", async () => {
    const target = pr({ url: "https://github.com/o/r/pull/42" });
    render(<PRCard pr={target} />);
    await userEvent.click(screen.getByRole("button"));
    expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/pull/42");
  });
});
