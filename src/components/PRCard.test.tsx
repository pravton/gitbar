import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-shell";
import { PRCard, prTone } from "@/components/PRCard";
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
    review_requested: false,
    ci_status: "SUCCESS",
    additions: 1,
    deletions: 0,
    comments: 0,
    deployment_url: null,
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

  it("opens the PR url when the title link is clicked", async () => {
    const target = pr({ url: "https://github.com/o/r/pull/42", title: "feat: thing" });
    render(<PRCard pr={target} />);
    await userEvent.click(screen.getByRole("link", { name: /feat: thing/ }));
    expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/pull/42");
  });

  it("the card itself is not interactive (article element wraps independent controls)", () => {
    render(<PRCard pr={pr({ deployment_url: "https://preview.example.com/x" })} />);
    // The CI pill is now a button — clicking it toggles the lazy
    // 'Checks' drill-down without opening the PR. Critically: this
    // button is a sibling of the title/Deploy links, not nested
    // inside them (the article element is the wrapper, not a button).
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
    // Two links: the PR title and the Deploy button.
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("shows the comment count when > 0", () => {
    render(<PRCard pr={pr({ comments: 5 })} />);
    expect(screen.getByTitle("5 comments")).toBeInTheDocument();
    expect(screen.getByTitle("5 comments")).toHaveTextContent("5");
  });

  it("hides the comment chip when there are zero comments", () => {
    render(<PRCard pr={pr({ comments: 0 })} />);
    expect(screen.queryByTitle(/comment/)).not.toBeInTheDocument();
  });

  it("singularizes the comment-count title for exactly one", () => {
    render(<PRCard pr={pr({ comments: 1 })} />);
    expect(screen.getByTitle("1 comment")).toBeInTheDocument();
  });

  it("renders a Deploy link when deployment_url is present", () => {
    render(<PRCard pr={pr({ deployment_url: "https://preview.example.com/7" })} />);
    const link = screen.getByRole("link", { name: /Deploy/ });
    expect(link).toHaveAttribute("href", "https://preview.example.com/7");
  });

  it("opens the deployment via the shell plugin and does not open the PR", async () => {
    const target = pr({
      url: "https://github.com/o/r/pull/7",
      deployment_url: "https://preview.example.com/7",
    });
    render(<PRCard pr={target} />);
    await userEvent.click(screen.getByRole("link", { name: /Deploy/ }));
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith("https://preview.example.com/7");
  });

  it("omits the Deploy link when no deployment_url is set", () => {
    render(<PRCard pr={pr({ deployment_url: null })} />);
    expect(screen.queryByRole("link", { name: /Deploy/ })).not.toBeInTheDocument();
  });

  it("renders a green pill for 'CI passing' even when the PR is a draft", () => {
    render(<PRCard pr={pr({ is_draft: true, ci_status: "SUCCESS" })} />);
    const pill = screen.getByText(/CI passing/);
    expect(pill).toHaveClass("ci-pill");
    expect(pill).toHaveClass("ci-pill-success");
    expect(pill).not.toHaveClass("ci-pill-warning");
  });

  it("renders a red pill for 'CI failing'", () => {
    render(<PRCard pr={pr({ ci_status: "FAILURE" })} />);
    const pill = screen.getByText(/CI failing/);
    expect(pill).toHaveClass("ci-pill-danger");
  });

  it("renders an orange pill for 'CI pending'", () => {
    render(<PRCard pr={pr({ ci_status: "PENDING" })} />);
    const pill = screen.getByText(/CI pending/);
    expect(pill).toHaveClass("ci-pill-warning");
  });

  it("renders an orange pill for 'CI unknown' when no status is reported", () => {
    render(<PRCard pr={pr({ ci_status: null })} />);
    const pill = screen.getByText(/CI unknown/);
    expect(pill).toHaveClass("ci-pill-warning");
  });

  describe("compact density", () => {
    it("renders a single-line row (a button, not an article)", () => {
      render(<PRCard pr={pr()} density="compact" />);
      // The whole row becomes one button; the comfortable variant
      // is an <article> with internal links.
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("data-card-url", "https://github.com/o/r/pull/7");
    });

    it("does not render the verbose CI pill in compact mode", () => {
      render(<PRCard pr={pr({ ci_status: "SUCCESS" })} density="compact" />);
      // The text label "CI passing" only lives on the comfortable
      // pill. Compact replaces it with an icon (aria-label still
      // carries the status for screen readers).
      expect(screen.queryByText(/CI passing/)).not.toBeInTheDocument();
    });

    it("does not render the Deploy link in compact mode", () => {
      render(
        <PRCard
          pr={pr({ deployment_url: "https://preview.example.com/7" })}
          density="compact"
        />,
      );
      expect(screen.queryByRole("link", { name: /Deploy/ })).not.toBeInTheDocument();
    });

    it("does not render the +X/-Y additions/deletions delta in compact mode", () => {
      render(<PRCard pr={pr({ additions: 42, deletions: 17 })} density="compact" />);
      expect(screen.queryByText(/\+42/)).not.toBeInTheDocument();
      expect(screen.queryByText(/-17/)).not.toBeInTheDocument();
    });

    it("opens the PR url when the compact row is clicked", async () => {
      openMock.mockClear();
      const target = pr({ url: "https://github.com/o/r/pull/7", title: "feat: thing" });
      render(<PRCard pr={target} density="compact" />);
      await userEvent.click(screen.getByRole("button"));
      expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/pull/7");
    });

    it("still shows the PR number and repo name in compact mode", () => {
      render(<PRCard pr={pr({ number: 137 })} density="compact" />);
      expect(screen.getByText("#137")).toBeInTheDocument();
      expect(screen.getByText("r")).toBeInTheDocument();
    });

    it("uses an aria-label for the CI icon so screen readers still get the status", () => {
      render(<PRCard pr={pr({ ci_status: "FAILURE" })} density="compact" />);
      expect(screen.getByLabelText(/CI failing/)).toBeInTheDocument();
    });

    it("propagates the selected state via aria-current", () => {
      render(<PRCard pr={pr()} density="compact" selected />);
      expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
    });
  });

  describe("checks drill-down (CI pill click)", () => {
    it("the checks panel is hidden by default and renders on first click", async () => {
      render(<PRCard pr={pr()} />);
      // Closed: no Checks panel.
      expect(screen.queryByText("Checks")).not.toBeInTheDocument();

      // The CI pill is the only button on the card.
      const pill = screen.getByRole("button");
      expect(pill).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(pill);

      expect(pill).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Checks")).toBeInTheDocument();
    });

    it("a second click collapses the panel again", async () => {
      render(<PRCard pr={pr()} />);
      const pill = screen.getByRole("button");
      await userEvent.click(pill);
      expect(screen.getByText("Checks")).toBeInTheDocument();
      await userEvent.click(pill);
      expect(screen.queryByText("Checks")).not.toBeInTheDocument();
    });
  });

  describe("draft indicator", () => {
    it("renders a Draft glyph in the comfortable card when the PR is a draft", () => {
      render(<PRCard pr={pr({ is_draft: true })} />);
      expect(screen.getByLabelText("Draft")).toBeInTheDocument();
    });

    it("renders a Draft glyph in the compact row too", () => {
      render(<PRCard pr={pr({ is_draft: true })} density="compact" />);
      expect(screen.getByLabelText("Draft")).toBeInTheDocument();
    });

    it("does NOT render the Draft glyph for a published PR", () => {
      render(<PRCard pr={pr({ is_draft: false })} />);
      expect(screen.queryByLabelText("Draft")).toBeNull();
    });
  });
});

describe("prTone", () => {
  // The status dot's tone summarizes whether the PR needs attention.
  // Draft state supersedes CI/review state here because a draft isn't
  // asking for review yet; the CI pill still shows the real CI state.
  it("a draft is always neutral (deprioritized), regardless of CI", () => {
    expect(prTone(pr({ is_draft: true, ci_status: "SUCCESS" }))).toBe("neutral");
    expect(prTone(pr({ is_draft: true, ci_status: "FAILURE" }))).toBe("neutral");
    expect(prTone(pr({ is_draft: true, ci_status: "PENDING" }))).toBe("neutral");
    expect(prTone(pr({ is_draft: true, review_decision: "CHANGES_REQUESTED" }))).toBe("neutral");
  });

  it("published PRs keep CI-driven semantics", () => {
    expect(prTone(pr({ is_draft: false, ci_status: "SUCCESS" }))).toBe("success");
    expect(prTone(pr({ is_draft: false, ci_status: "FAILURE" }))).toBe("danger");
    expect(prTone(pr({ is_draft: false, ci_status: "ERROR" }))).toBe("danger");
    expect(prTone(pr({ is_draft: false, ci_status: "PENDING" }))).toBe("warning");
  });

  it("changes-requested is danger on a published PR (and overrides PENDING)", () => {
    expect(
      prTone(pr({ is_draft: false, ci_status: "PENDING", review_decision: "CHANGES_REQUESTED" })),
    ).toBe("danger");
  });

  it("an unknown CI status on a published PR falls back to warning", () => {
    expect(prTone(pr({ is_draft: false, ci_status: null }))).toBe("warning");
  });
});
