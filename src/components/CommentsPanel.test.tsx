import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { CommentsPanel } from "@/components/CommentsPanel";
import { _clearItemCommentsCache } from "@/hooks/useItemComments";
import type { CommentEntry, ItemComments, ReviewThread } from "@/types";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const openMock = open as unknown as ReturnType<typeof vi.fn>;
const URL_ = "https://github.com/o/r/pull/1";

function entry(overrides: Partial<CommentEntry> = {}): CommentEntry {
  return {
    kind: "comment",
    author: { login: "alice", avatar_url: null },
    body: "hello",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    url: "https://github.com/o/r/pull/1#issuecomment-1",
    review_state: null,
    ...overrides,
  };
}

function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    path: "src-tauri/src/github/client.rs",
    line: 184,
    is_resolved: false,
    is_outdated: false,
    comments: [
      entry({ body: "thread start", url: "https://github.com/o/r/pull/1#discussion_r1" }),
    ],
    omitted: 0,
    ...overrides,
  };
}

/** Threads default to none, as for an issue. */
function resolveWith(
  data: Pick<ItemComments, "entries" | "omitted"> & Partial<ItemComments>,
) {
  invokeMock.mockResolvedValue({ threads: [], threads_omitted: 0, ...data });
}

describe("CommentsPanel", () => {
  beforeEach(() => _clearItemCommentsCache());

  it("renders comments and reviews with author, badge and body", async () => {
    resolveWith({
      entries: [
        entry({ body: "first comment" }),
        entry({
          kind: "review",
          author: { login: "bob", avatar_url: null },
          body: "",
          review_state: "APPROVED",
          url: "https://github.com/o/r/pull/1#pullrequestreview-2",
        }),
        entry({
          kind: "review",
          author: { login: "carol", avatar_url: null },
          body: "please fix",
          review_state: "CHANGES_REQUESTED",
          url: "https://github.com/o/r/pull/1#pullrequestreview-3",
        }),
      ],
      omitted: 0,
    });
    render(<CommentsPanel itemUrl={URL_} />);
    expect(await screen.findByText("first comment")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("changes requested")).toBeInTheDocument();
    expect(screen.getByText("please fix")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("get_item_comments", { itemUrl: URL_ });
  });

  it("renders URLs in a body as links and nothing as HTML", async () => {
    resolveWith({
      entries: [entry({ body: "<b>bold</b> see https://example.com/x." })],
      omitted: 0,
    });
    render(<CommentsPanel itemUrl={URL_} />);
    const link = await screen.findByRole("link", { name: "https://example.com/x" });
    await userEvent.click(link);
    expect(openMock).toHaveBeenCalledWith("https://example.com/x");
    // Formatting tags are stripped, never rendered as HTML.
    expect(screen.getByText(/bold see/)).toBeInTheDocument();
    expect(screen.queryByText(/<b>/)).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });

  it("renders a Codex review body: badge pill, bold, code, no raw markup", async () => {
    resolveWith({
      entries: [
        entry({
          body:
            "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Don't announce inbound asks as completed**\n\n" +
            'When a fresh inbound turn has `slot: "ask"`, it is still included.\n\n' +
            '<img src="x" onerror="alert(1)"><script>alert(2)</script>',
        }),
      ],
      omitted: 0,
    });
    render(<CommentsPanel itemUrl={URL_} />);
    expect(await screen.findByText("P2")).toBeInTheDocument();
    expect(screen.getByText(/Don't announce inbound asks as completed/).closest("strong")).not.toBeNull();
    expect(screen.getByText('slot: "ask"').tagName).toBe("CODE");
    expect(screen.queryByText(/<sub>|\*\*|shields\.io/)).toBeNull();
    expect(document.querySelector("img, script, sub")).toBeNull();
  });

  it("opens markdown links through the safe opener only", async () => {
    resolveWith({
      entries: [entry({ body: "see [the docs](https://example.com/d) and [bad](javascript:alert(1))" })],
      omitted: 0,
    });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByRole("link", { name: "the docs" }));
    expect(openMock).toHaveBeenCalledWith("https://example.com/d");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
  });

  it("opens the entry on GitHub only from its link", async () => {
    resolveWith({ entries: [entry()], omitted: 0 });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByText("@alice"));
    expect(openMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Open @alice's comment on GitHub" }));
    expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/pull/1#issuecomment-1");
  });

  it("closes from its header when it has a close handler", async () => {
    resolveWith({ entries: [entry()], omitted: 0 });
    const onClose = vi.fn();
    const { rerender } = render(<CommentsPanel itemUrl={URL_} onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Close comments" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<CommentsPanel itemUrl={URL_} />);
    expect(screen.queryByRole("button", { name: "Close comments" })).toBeNull();
  });

  it("summarizes comments and unresolved threads in the header", async () => {
    resolveWith({
      entries: [entry(), entry({ url: "https://github.com/o/r/pull/1#issuecomment-2" })],
      omitted: 3,
      threads: [thread(), thread({ is_resolved: true, comments: [entry({ url: "u2" })] })],
    });
    render(<CommentsPanel itemUrl={URL_} />);
    expect(await screen.findByText("5 comments · 1 unresolved thread")).toBeInTheDocument();
  });

  it("puts unresolved threads above the conversation and resolved ones below", async () => {
    resolveWith({
      entries: [entry()],
      omitted: 0,
      threads: [
        thread(),
        thread({ is_resolved: true, comments: [entry({ url: "resolved" })] }),
      ],
    });
    render(<CommentsPanel itemUrl={URL_} />);
    const headings = (await screen.findAllByRole("heading")).map((h) => h.textContent);
    expect(headings).toEqual(["Unresolved threads(1)", "Conversation", "Resolved threads(1)"]);
  });

  it("keeps the older-threads link after the conversation", async () => {
    resolveWith({ entries: [entry()], omitted: 0, threads: [thread()], threads_omitted: 2 });
    render(<CommentsPanel itemUrl={URL_} />);
    const link = await screen.findByRole("button", { name: /2 older threads on GitHub/ });
    expect(screen.getByRole("heading", { name: "Conversation" }).compareDocumentPosition(link)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("marks the newest comments as new, and keeps them marked once seen", async () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    resolveWith({
      entries: [
        entry({ body: "old", created_at: minutesAgo(30), url: "old" }),
        entry({ body: "recent", created_at: minutesAgo(5), url: "recent" }),
      ],
      omitted: 0,
      threads: [
        thread({
          comments: [entry({ body: "in a thread", created_at: minutesAgo(1), url: "in-thread" })],
        }),
      ],
    });
    const { rerender } = render(<CommentsPanel itemUrl={URL_} unreadCount={2} />);
    // A thread holding a new comment starts open so the comment is readable.
    const inThread = await screen.findByText("in a thread");
    const rowOf = (el: HTMLElement) => el.closest("li") as HTMLElement;
    expect(within(rowOf(inThread)).getByText("new")).toBeInTheDocument();
    expect(within(rowOf(screen.getByText("recent"))).getByText("new")).toBeInTheDocument();
    expect(within(rowOf(screen.getByText("old"))).queryByText("new")).toBeNull();

    rerender(<CommentsPanel itemUrl={URL_} unreadCount={0} />);
    expect(within(rowOf(screen.getByText("recent"))).getByText("new")).toBeInTheDocument();
  });

  it("opens a collapsed thread when fresh data puts a new comment in it", async () => {
    const start = entry({ body: "thread start", url: "start" });
    resolveWith({ entries: [], omitted: 0, threads: [thread({ comments: [start] })] });
    const { rerender } = render(<CommentsPanel itemUrl={URL_} revision={1} />);
    await screen.findByRole("heading", { name: /Unresolved threads/ });
    expect(screen.queryByText("thread start")).toBeNull();

    const reply = entry({ body: "the reply", url: "reply" });
    resolveWith({ entries: [], omitted: 0, threads: [thread({ comments: [start, reply] })] });
    rerender(<CommentsPanel itemUrl={URL_} revision={2} unreadCount={1} />);
    expect(await screen.findByText("the reply")).toBeInTheDocument();
  });

  it("waits until the panel can be seen before marking comments seen", async () => {
    let report: (visible: boolean) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = (isIntersecting) => callback([{ isIntersecting }]);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      resolveWith({ entries: [entry({ body: "one" })], omitted: 0 });
      const onSeen = vi.fn();
      render(<CommentsPanel itemUrl={URL_} onSeen={onSeen} />);
      expect(await screen.findByText("one")).toBeInTheDocument();
      expect(onSeen).not.toHaveBeenCalled();
      act(() => report(true));
      expect(onSeen).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("collapses long bodies behind Show full comment", async () => {
    const long = `${"word ".repeat(100)}END`;
    resolveWith({ entries: [entry({ body: long })], omitted: 0 });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByRole("button", { name: "Show full comment" }));
    expect(screen.getByText(/END$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });

  it("links to GitHub for omitted older entries", async () => {
    resolveWith({ entries: [entry()], omitted: 12 });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByRole("button", { name: /12 earlier on GitHub/ }));
    expect(openMock).toHaveBeenCalledWith(URL_);
  });

  it("lists review threads collapsed, with location, badges and reply count", async () => {
    resolveWith({
      entries: [],
      omitted: 0,
      threads: [
        thread({
          comments: [
            entry({ body: "thread start", url: "https://github.com/o/r/pull/1#discussion_r1" }),
            entry({
              author: { login: "bob", avatar_url: null },
              body: "a reply",
              url: "https://github.com/o/r/pull/1#discussion_r2",
            }),
          ],
          omitted: 3,
          is_outdated: true,
        }),
        thread({
          path: "README.md",
          line: null,
          is_resolved: true,
          comments: [entry({ url: "https://github.com/o/r/pull/1#discussion_r9" })],
        }),
      ],
      threads_omitted: 0,
    });
    render(<CommentsPanel itemUrl={URL_} />);
    expect(await screen.findByRole("heading", { name: /Unresolved threads/ })).toHaveTextContent("(1)");
    expect(screen.getByRole("heading", { name: /Resolved threads/ })).toHaveTextContent("(1)");
    expect(screen.queryByText("No comments yet.")).toBeNull();
    const first = screen.getByRole("button", { name: /client\.rs:184/ });
    expect(first).toHaveAttribute("title", "src-tauri/src/github/client.rs:184");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(first).toHaveTextContent("outdated");
    expect(first).toHaveTextContent("@alice +4");
    // File-level thread: no line number.
    expect(screen.getByRole("button", { name: /README\.md/ })).toHaveTextContent("resolved");
    // Collapsed: bodies hidden until expanded.
    expect(screen.queryByText("a reply")).toBeNull();
    await userEvent.click(first);
    expect(screen.getByText("thread start")).toBeInTheDocument();
    expect(screen.getByText("a reply")).toBeInTheDocument();
    // The left-out replies sit between the start and the newest replies.
    const more = screen.getByRole("button", { name: /3 earlier replies on GitHub/ });
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByText("thread start"), more)).toBe(true);
    expect(follows(more, screen.getByText("a reply"))).toBe(true);
    await userEvent.click(more);
    expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/pull/1#discussion_r1");
  });

  it("links to the PR for older threads that weren't fetched", async () => {
    resolveWith({ entries: [], omitted: 0, threads: [thread()], threads_omitted: 7 });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByRole("button", { name: /7 older threads on GitHub/ }));
    expect(openMock).toHaveBeenCalledWith(URL_);
  });

  it("reports seen only after a successful fetch for this revision", async () => {
    const onSeen = vi.fn();
    invokeMock.mockRejectedValueOnce({ kind: "network", message: "offline" });
    const { rerender } = render(<CommentsPanel itemUrl={URL_} revision={1} onSeen={onSeen} />);
    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(onSeen).not.toHaveBeenCalled();

    resolveWith({ entries: [entry({ body: "one" })], omitted: 0 });
    await userEvent.click(screen.getByRole("button", { name: "Refresh comments" }));
    expect(await screen.findByText("one")).toBeInTheDocument();
    expect(onSeen).toHaveBeenCalled();

    // A new count refetches even inside the cache TTL, and only reports
    // seen again once the new data is in.
    onSeen.mockClear();
    invokeMock.mockClear();
    resolveWith({ entries: [entry({ body: "one and two" })], omitted: 0 });
    rerender(<CommentsPanel itemUrl={URL_} revision={2} onSeen={onSeen} />);
    expect(await screen.findByText("one and two")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(onSeen).toHaveBeenCalled();
  });

  it("shows an empty state and an error state", async () => {
    resolveWith({ entries: [], omitted: 0 });
    const { unmount } = render(<CommentsPanel itemUrl={URL_} />);
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
    unmount();

    _clearItemCommentsCache();
    invokeMock.mockRejectedValue({ kind: "network", message: "offline" });
    render(<CommentsPanel itemUrl={URL_} />);
    expect(await screen.findByText("offline")).toBeInTheDocument();
  });
});
