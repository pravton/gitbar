import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-shell";
import { ListView } from "@/components/ListView";
import type { GitHubError, Issue, PullRequest } from "@/types";

const openMock = open as unknown as ReturnType<typeof vi.fn>;

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "feat: do thing",
    url: "https://github.com/o/r/pull/1",
    state: "OPEN",
    created_at: new Date(Date.now() - 60 * 1000).toISOString(),
    repository: { name_with_owner: "o/r" },
    author: { login: "alice", avatar_url: null },
    is_draft: false,
    review_decision: null,
    ci_status: "SUCCESS",
    additions: 4,
    deletions: 2,
    comments: 0,
    deployment_url: null,
    ...overrides,
  };
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 11,
    title: "bug: thing broken",
    url: "https://github.com/o/r/issues/11",
    state: "OPEN",
    created_at: new Date(Date.now() - 60 * 1000).toISOString(),
    repository: { name_with_owner: "o/r" },
    labels: [],
    ...overrides,
  };
}

describe("ListView", () => {
  it("shows the 'no PRs' empty state when not loading + no error", () => {
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={[]}
        issues={[]}
        loading={false}
        error={null}
        retry={null}
        partialMessage={null}
      />,
    );
    expect(screen.getByText(/No open PRs/)).toBeInTheDocument();
  });

  it("does not show the empty state while loading on first paint", () => {
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={[]}
        issues={[]}
        loading
        error={null}
        retry={null}
        partialMessage={null}
      />,
    );
    expect(screen.queryByText(/No open PRs/)).not.toBeInTheDocument();
    expect(screen.getByText(/Loading GitHub items/)).toBeInTheDocument();
  });

  it("does not show the empty state when there is an error", () => {
    const err: GitHubError = { kind: "auth", message: "rejected" };
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={[]}
        issues={[]}
        loading={false}
        error={err}
        retry={null}
        partialMessage={null}
      />,
    );
    expect(screen.queryByText(/No open PRs/)).not.toBeInTheDocument();
    expect(screen.getByTestId("error-banner")).toHaveTextContent(
      /Token rejected — reconnect required/,
    );
    expect(screen.getByTestId("error-banner")).toHaveTextContent("rejected");
  });

  it("renders a rate-limit retry-after when present", () => {
    const err: GitHubError = {
      kind: "rate_limited",
      message: "boom",
      retry_after_secs: 42,
    };
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={[]}
        issues={[]}
        loading={false}
        error={err}
        retry={null}
        partialMessage={null}
      />,
    );
    expect(screen.getByTestId("error-banner")).toHaveTextContent("retry in 42s");
  });

  it("renders an auto-retry countdown when retry state is present", () => {
    // Freeze Date so the countdown rendering is deterministic (the prior
    // version asserted on wall-clock drift, which can flake on slow CI).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"));
    try {
      const err: GitHubError = { kind: "network", message: "offline" };
      const retryAt = new Date("2026-05-19T10:00:08Z");
      render(
        <ListView
          activeTab="prs"
          onTabChange={() => {}}
          prs={[]}
          issues={[]}
          loading={false}
          error={err}
          retry={{ retryAt, attempt: 1 }}
          partialMessage={null}
        />,
      );
      expect(screen.getByTestId("error-banner-retry")).toHaveTextContent(
        "Retrying in 8s",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows 'Retrying…' when the scheduled retry time has passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"));
    try {
      const err: GitHubError = { kind: "network", message: "offline" };
      const retryAt = new Date("2026-05-19T09:59:59Z");
      render(
        <ListView
          activeTab="prs"
          onTabChange={() => {}}
          prs={[]}
          issues={[]}
          loading={false}
          error={err}
          retry={{ retryAt, attempt: 1 }}
          partialMessage={null}
        />,
      );
      expect(screen.getByTestId("error-banner-retry")).toHaveTextContent(
        "Retrying",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("strips the 'retry in Xs' suffix from the rate-limit heading when a retry is scheduled", () => {
    const err: GitHubError = {
      kind: "rate_limited",
      message: "boom",
      retry_after_secs: 42,
    };
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={[]}
        issues={[]}
        loading={false}
        error={err}
        retry={{ retryAt: new Date(Date.now() + 43_000), attempt: 1 }}
        partialMessage={null}
      />,
    );
    // Heading is generic; countdown line owns the seconds. No double number.
    const banner = screen.getByTestId("error-banner");
    expect(banner).toHaveTextContent(/Rate limited by GitHub/);
    expect(banner).not.toHaveTextContent(/retry in 42s/);
  });

  it("renders the partial warning banner when data is partial", () => {
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={[pr()]}
        issues={[]}
        loading={false}
        error={null}
        retry={null}
        partialMessage="Review query failed"
      />,
    );
    expect(screen.getByTestId("warning-banner")).toHaveTextContent("Review query failed");
  });

  it("hides the partial warning when there's an error in the same render", () => {
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={[]}
        issues={[]}
        loading={false}
        error={{ kind: "server", message: "500" }}
        retry={null}
        partialMessage="ignored"
      />,
    );
    expect(screen.queryByTestId("warning-banner")).not.toBeInTheDocument();
  });

  it("switches tab via TabButton", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <ListView
        activeTab="prs"
        onTabChange={onTabChange}
        prs={[pr()]}
        issues={[issue()]}
        loading={false}
        error={null}
        retry={null}
        partialMessage={null}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Issues/ }));
    expect(onTabChange).toHaveBeenCalledWith("issues");
  });

  describe("keyboard navigation", () => {
    function renderPrs(extra: { onTabChange?: (t: "prs" | "issues") => void } = {}) {
      const prs = [
        pr({ url: "https://x/1", title: "first PR" }),
        pr({ url: "https://x/2", title: "second PR" }),
        pr({
          url: "https://x/3",
          title: "third PR",
          deployment_url: "https://preview.example.com/3",
        }),
      ];
      const onTabChange = extra.onTabChange ?? vi.fn();
      const utils = render(
        <ListView
          activeTab="prs"
          onTabChange={onTabChange}
          prs={prs}
          issues={[]}
          loading={false}
          error={null}
          retry={null}
          partialMessage={null}
        />,
      );
      return { ...utils, prs, onTabChange };
    }

    it("ArrowDown from no selection lands on the first card", async () => {
      renderPrs();
      await userEvent.keyboard("{ArrowDown}");
      // PRCard renders <article> with aria-current when selected; find it.
      const selected = document.querySelector('[aria-current="true"]');
      expect(selected?.getAttribute("data-card-url")).toBe("https://x/1");
    });

    it("ArrowDown / ArrowUp wraps in both directions", async () => {
      renderPrs();
      // From no selection → 3 down presses land on the third (last) card.
      await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
      expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-card-url"))
        .toBe("https://x/3");
      // The 4th down press is the one that wraps to the first card.
      await userEvent.keyboard("{ArrowDown}");
      expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-card-url"))
        .toBe("https://x/1");
      // Up from first wraps to last.
      await userEvent.keyboard("{ArrowUp}");
      expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-card-url"))
        .toBe("https://x/3");
    });

    it("Enter opens the selected PR via the shell plugin", async () => {
      openMock.mockClear();
      renderPrs();
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(openMock).toHaveBeenCalledWith("https://x/1");
    });

    it("D opens the deploy URL when the selected PR has one", async () => {
      openMock.mockClear();
      renderPrs();
      // Move to the third PR (which has deployment_url).
      await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
      await userEvent.keyboard("d");
      expect(openMock).toHaveBeenCalledWith("https://preview.example.com/3");
    });

    it("D is a no-op when the selected PR has no deploy URL", async () => {
      openMock.mockClear();
      renderPrs();
      await userEvent.keyboard("{ArrowDown}"); // first PR — no deployment_url
      await userEvent.keyboard("d");
      expect(openMock).not.toHaveBeenCalled();
    });

    it("Cmd+1 / Cmd+2 switch tabs", async () => {
      const onTabChange = vi.fn();
      renderPrs({ onTabChange });
      await userEvent.keyboard("{Meta>}2{/Meta}");
      expect(onTabChange).toHaveBeenCalledWith("issues");
      await userEvent.keyboard("{Meta>}1{/Meta}");
      expect(onTabChange).toHaveBeenCalledWith("prs");
    });

    it("Escape clears selection", async () => {
      renderPrs();
      await userEvent.keyboard("{ArrowDown}");
      expect(document.querySelector('[aria-current="true"]')).not.toBeNull();
      await userEvent.keyboard("{Escape}");
      expect(document.querySelector('[aria-current="true"]')).toBeNull();
    });

    it("ignores keys while typing in an input (filter popover input)", async () => {
      renderPrs();
      // Open the filter popover via the / shortcut.
      await userEvent.keyboard("/");
      // Find the preset-name input and type a digit that would otherwise be a hotkey.
      const input = await screen.findByPlaceholderText(/Save current filters as/);
      input.focus();
      await userEvent.type(input, "1");
      // The character should land in the input, not trigger Cmd+1 / selection.
      expect(input).toHaveValue("1");
      expect(document.querySelector('[aria-current="true"]')).toBeNull();
    });
  });
});
