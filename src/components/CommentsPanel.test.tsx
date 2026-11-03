import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    // The markup is shown literally, not rendered.
    expect(screen.getByText(/<b>bold<\/b>/)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("opens the entry on GitHub from its header", async () => {
    resolveWith({ entries: [entry()], omitted: 0 });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByText("@alice"));
    expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/pull/1#issuecomment-1");
  });

  it("collapses long bodies behind Show more", async () => {
    const long = `${"word ".repeat(100)}END`;
    resolveWith({ entries: [entry({ body: long })], omitted: 0 });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(screen.getByText(/END$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
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
    expect(await screen.findByText("(1 unresolved of 2)")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /3 more replies on GitHub/ }));
    expect(openMock).toHaveBeenCalledWith("https://github.com/o/r/pull/1#discussion_r2");
  });

  it("links to the PR for older threads that weren't fetched", async () => {
    resolveWith({ entries: [], omitted: 0, threads: [thread()], threads_omitted: 7 });
    render(<CommentsPanel itemUrl={URL_} />);
    await userEvent.click(await screen.findByRole("button", { name: /7 older threads on GitHub/ }));
    expect(openMock).toHaveBeenCalledWith(URL_);
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
