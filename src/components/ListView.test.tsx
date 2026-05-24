import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-shell";
import { ListView } from "@/components/ListView";
import { KeybindHelp } from "@/components/KeybindHelp";
import type { GitHubError, Issue, PullRequest } from "@/types";

const openMock = open as unknown as ReturnType<typeof vi.fn>;

/**
 * Default values for the help/refresh/settings props that App now owns.
 * Tests that don't care about that wiring can spread this; tests that DO
 * care use `HostListView` below.
 */
const defaultHostProps = {
  helpOpen: false,
  onOpenHelp: () => {},
  onCloseHelp: () => {},
  onRefresh: () => {},
  onOpenSettings: () => {},
};

/**
 * Stateful wrapper that mirrors how `App` wires the help overlay around
 * `ListView`. The `?` keybind and the Esc-close behaviors both need a
 * parent that actually flips `helpOpen` and renders `<KeybindHelp>`, so
 * the keyboard-nav tests use this instead of `<ListView>` directly.
 */
function HostListView(
  props: Omit<React.ComponentProps<typeof ListView>, keyof typeof defaultHostProps> & {
    onRefresh?: () => void;
    onOpenSettings?: () => void;
  },
) {
  const [helpOpen, setHelpOpen] = useState(false);
  const { onRefresh, onOpenSettings, ...rest } = props;
  return (
    <>
      <ListView
        {...rest}
        helpOpen={helpOpen}
        onOpenHelp={() => setHelpOpen(true)}
        onCloseHelp={() => setHelpOpen(false)}
        onRefresh={onRefresh ?? (() => {})}
        onOpenSettings={onOpenSettings ?? (() => {})}
      />
      <KeybindHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

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
        {...defaultHostProps}
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
        {...defaultHostProps}
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
        {...defaultHostProps}
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
        {...defaultHostProps}
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
          {...defaultHostProps}
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
          {...defaultHostProps}
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
        {...defaultHostProps}
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
        {...defaultHostProps}
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
        {...defaultHostProps}
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
        {...defaultHostProps}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Issues/ }));
    expect(onTabChange).toHaveBeenCalledWith("issues");
  });

  it("does NOT show the empty state when the list collapses entirely into a repo group", () => {
    // Regression: items is the *selectable* list (collapsed-group
    // children are skipped), but the empty-state condition lives on
    // displayCount (top-level rows), so a fully-grouped list with
    // every tile collapsed should still render the group tile and
    // hide the "No open PRs" placeholder.
    const prs = [
      pr({ url: "https://x/1", number: 1, repository: { name_with_owner: "o/big" } }),
      pr({ url: "https://x/2", number: 2, repository: { name_with_owner: "o/big" } }),
      pr({ url: "https://x/3", number: 3, repository: { name_with_owner: "o/big" } }),
    ];
    render(
      <ListView
        activeTab="prs"
        onTabChange={() => {}}
        prs={prs}
        issues={[]}
        loading={false}
        error={null}
        retry={null}
        partialMessage={null}
        {...defaultHostProps}
      />,
    );
    expect(screen.queryByText(/No open PRs/)).not.toBeInTheDocument();
    // The group tile is the only visible row; assert by its
    // data-group-key attribute set in RepoGroupTile.
    expect(document.querySelector('[data-group-key="group:o/big"]')).toBeInTheDocument();
  });

  describe("keyboard navigation", () => {
    function renderPrs(
      extra: {
        onTabChange?: (t: "prs" | "issues") => void;
        onRefresh?: () => void;
        onOpenSettings?: () => void;
      } = {},
    ) {
      // Give each PR a distinct repo so the new auto-grouping
      // (3+ PRs from the same repo) doesn't collapse them into one
      // group tile. The keyboard-nav tests below assume three
      // independent, individually-selectable cards.
      const prs = [
        pr({
          url: "https://x/1",
          title: "first PR",
          repository: { name_with_owner: "o/one" },
        }),
        pr({
          url: "https://x/2",
          title: "second PR",
          repository: { name_with_owner: "o/two" },
        }),
        pr({
          url: "https://x/3",
          title: "third PR",
          repository: { name_with_owner: "o/three" },
          deployment_url: "https://preview.example.com/3",
        }),
      ];
      const onTabChange = extra.onTabChange ?? vi.fn();
      const utils = render(
        <HostListView
          activeTab="prs"
          onTabChange={onTabChange}
          prs={prs}
          issues={[]}
          loading={false}
          error={null}
          retry={null}
          partialMessage={null}
          onRefresh={extra.onRefresh}
          onOpenSettings={extra.onOpenSettings}
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

    it("? opens the keyboard-shortcut help overlay; Esc closes it", async () => {
      renderPrs();
      // Help isn't rendered initially.
      expect(screen.queryByTestId("keybind-help")).toBeNull();

      // Press ?
      await userEvent.keyboard("?");
      expect(screen.getByTestId("keybind-help")).toBeInTheDocument();

      // Esc closes (and does NOT also clear selection, since the help
      // owns that Esc press).
      await userEvent.keyboard("{ArrowDown}"); // would normally select, but
      // — help is open, so ArrowDown is swallowed. Let me re-verify by
      // checking selection state before/after.
      // (Actually, ArrowDown only fires through the handler when help is
      // closed, so this just becomes inert.)
      expect(document.querySelector('[aria-current="true"]')).toBeNull();

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByTestId("keybind-help")).toBeNull();
    });

    it("while help is open, other shortcuts are inert", async () => {
      openMock.mockClear();
      const onTabChange = vi.fn();
      const onRefresh = vi.fn();
      const onOpenSettings = vi.fn();
      renderPrs({ onTabChange, onRefresh, onOpenSettings });

      // Open help. Focus moves into the dialog (close button).
      await userEvent.keyboard("?");
      expect(screen.getByTestId("keybind-help")).toBeInTheDocument();
      // Wait for the microtask focus call.
      await new Promise((r) => setTimeout(r, 0));

      // Note: we don't test Enter here — Enter activates the focused
      // close button (default browser button behavior, not a "shortcut"
      // we control). The other shortcuts must all be inert.
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("d");
      await userEvent.keyboard("{Meta>}1{/Meta}");
      await userEvent.keyboard("/");
      await userEvent.keyboard("r");
      await userEvent.keyboard("s");

      // Help is still open; nothing else fired.
      expect(screen.getByTestId("keybind-help")).toBeInTheDocument();
      expect(document.querySelector('[aria-current="true"]')).toBeNull();
      expect(openMock).not.toHaveBeenCalled();
      expect(onTabChange).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
      expect(onOpenSettings).not.toHaveBeenCalled();
    });

    it("R triggers onRefresh", async () => {
      const onRefresh = vi.fn();
      renderPrs({ onRefresh });
      await userEvent.keyboard("r");
      expect(onRefresh).toHaveBeenCalledTimes(1);
      await userEvent.keyboard("R");
      expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    it("S triggers onOpenSettings", async () => {
      const onOpenSettings = vi.fn();
      renderPrs({ onOpenSettings });
      await userEvent.keyboard("s");
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      await userEvent.keyboard("S");
      expect(onOpenSettings).toHaveBeenCalledTimes(2);
    });

    it("R/S are inert while typing in an input (preset-name field)", async () => {
      const onRefresh = vi.fn();
      const onOpenSettings = vi.fn();
      renderPrs({ onRefresh, onOpenSettings });
      await userEvent.keyboard("/");
      const input = await screen.findByPlaceholderText(/Save current filters as/);
      input.focus();
      await userEvent.type(input, "rs");
      expect(input).toHaveValue("rs");
      expect(onRefresh).not.toHaveBeenCalled();
      expect(onOpenSettings).not.toHaveBeenCalled();
    });

    it("R/S do not fire when a modifier is held (so Cmd+R reload still works)", async () => {
      const onRefresh = vi.fn();
      const onOpenSettings = vi.fn();
      renderPrs({ onRefresh, onOpenSettings });
      await userEvent.keyboard("{Meta>}r{/Meta}");
      await userEvent.keyboard("{Meta>}s{/Meta}");
      await userEvent.keyboard("{Control>}r{/Control}");
      expect(onRefresh).not.toHaveBeenCalled();
      expect(onOpenSettings).not.toHaveBeenCalled();
    });

    it("Escape precedence: help → filter popover → clear selection", async () => {
      renderPrs();

      // Open filter popover.
      await userEvent.keyboard("/");
      const popover = await screen.findByPlaceholderText(/Save current filters as/);
      expect(popover).toBeInTheDocument();

      // Open help on top of popover.
      await userEvent.keyboard("?");
      expect(screen.getByTestId("keybind-help")).toBeInTheDocument();

      // First Esc closes help, leaves popover open.
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByTestId("keybind-help")).toBeNull();
      expect(screen.queryByPlaceholderText(/Save current filters as/)).toBeInTheDocument();

      // Second Esc closes popover.
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByPlaceholderText(/Save current filters as/)).toBeNull();
    });

    it("clicking the backdrop closes the help overlay", async () => {
      renderPrs();
      await userEvent.keyboard("?");
      const backdrop = screen.getByTestId("keybind-help-backdrop");
      await userEvent.click(backdrop);
      expect(screen.queryByTestId("keybind-help")).toBeNull();
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

    it("Esc closes the filter popover even when typing inside its preset-name input", async () => {
      renderPrs();
      await userEvent.keyboard("/");
      const input = await screen.findByPlaceholderText(/Save current filters as/);
      input.focus();
      await userEvent.type(input, "x");
      expect(input).toHaveValue("x");

      // Esc with focus inside an input must still close the popover.
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByPlaceholderText(/Save current filters as/)).toBeNull();
    });

    it("clicking the help backdrop while filter is open closes ONLY help", async () => {
      renderPrs();
      // Open filter, then help on top.
      await userEvent.keyboard("/");
      await userEvent.keyboard("?");
      expect(screen.getByTestId("keybind-help")).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/Save current filters as/)).toBeInTheDocument();

      // Click the backdrop. Help closes; filter must NOT also close from
      // its own document-level click-outside detector picking up this
      // mousedown.
      const backdrop = screen.getByTestId("keybind-help-backdrop");
      await userEvent.click(backdrop);

      expect(screen.queryByTestId("keybind-help")).toBeNull();
      expect(screen.queryByPlaceholderText(/Save current filters as/)).toBeInTheDocument();
    });

    it("Tab inside the help dialog stays in the dialog (focus trap)", async () => {
      renderPrs();
      await userEvent.keyboard("?");
      const closeBtn = screen.getByLabelText(/Close keyboard shortcuts/);
      // The microtask focus call hasn't necessarily run yet — wait one tick.
      await new Promise((r) => setTimeout(r, 0));
      expect(document.activeElement).toBe(closeBtn);

      // Tab stays on closeBtn (only interactive child).
      await userEvent.tab();
      expect(document.activeElement).toBe(closeBtn);

      // Shift+Tab also keeps it there.
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(closeBtn);
    });

    it("closing help restores focus to the previously-focused element", async () => {
      renderPrs();
      const filterBtn = screen.getByLabelText(/Filters/);
      filterBtn.focus();
      expect(document.activeElement).toBe(filterBtn);

      await userEvent.keyboard("?");
      await new Promise((r) => setTimeout(r, 0));
      expect(document.activeElement).not.toBe(filterBtn);

      await userEvent.keyboard("{Escape}");
      expect(document.activeElement).toBe(filterBtn);
    });
  });
});
