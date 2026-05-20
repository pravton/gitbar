import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListView } from "@/components/ListView";
import type { GitHubError, Issue, PullRequest } from "@/types";

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
    const err: GitHubError = { kind: "network", message: "offline" };
    const retryAt = new Date(Date.now() + 8_000);
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
    const note = screen.getByTestId("error-banner-retry");
    expect(note.textContent ?? "").toMatch(/Retrying in [78]s/);
  });

  it("shows 'Retrying…' when the scheduled retry time has passed", () => {
    const err: GitHubError = { kind: "network", message: "offline" };
    const retryAt = new Date(Date.now() - 1_000);
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
    expect(screen.getByTestId("error-banner-retry")).toHaveTextContent("Retrying");
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
});
