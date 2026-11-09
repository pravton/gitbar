import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import App from "@/App";

type Responses = Record<string, unknown>;

function mockBackend(getData: () => Promise<unknown>, extra: Responses = {}) {
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "list_accounts") {
      return Promise.resolve({ accounts: ["alice"], active: "alice" });
    }
    if (command === "get_data" || command === "refresh_cache") return getData();
    return Promise.resolve(extra[command] ?? null);
  });
}

const snapshot = (partial_message: string | null) => ({
  prs: [],
  issues: [],
  partial_message,
  last_fetched_at_ms: 1,
  history: [],
});

describe("App", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the empty state and a still refresh icon through a background poll", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const getData = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(snapshot(null))
      .mockReturnValue(new Promise(() => {}));
    mockBackend(getData);
    const { container } = render(<App />);

    await screen.findByText(/No open PRs/);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(getData).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/No open PRs/)).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps the account and opens the rotate form when a token is rejected", async () => {
    mockBackend(() => Promise.reject({ kind: "auth", message: "Bad credentials" }));
    render(<App />);

    await userEvent.click(await screen.findByTestId("error-banner-reconnect"));

    const rotate = await screen.findByLabelText(/Rotate token for/);
    await vi.waitFor(() => expect(rotate).toHaveFocus());
    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands).not.toContain("remove_account");
  });

  it("shows a placeholder, not 0, on the tiles when the first fetch fails", async () => {
    mockBackend(() => Promise.reject({ kind: "network", message: "offline" }));
    render(<App />);

    await screen.findByTestId("error-banner");
    expect(screen.getByTitle("PRs: not loaded yet")).toBeInTheDocument();
    expect(screen.queryByTitle("0 PRs")).not.toBeInTheDocument();
  });

  it("keeps shortcuts off the list behind Settings, and Esc closes the top layer", async () => {
    mockBackend(() => Promise.resolve(snapshot(null)));
    render(<App />);
    await screen.findByText(/No open PRs/);
    const help = () => document.getElementById("keybind-help-title");
    const settings = () => screen.queryByLabelText("Close settings");

    await userEvent.keyboard("s");
    expect(settings()).toBeInTheDocument();
    await userEvent.keyboard("?");
    expect(help()).toBeNull();

    // The header menu can still open help over Settings.
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    expect(help()).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(help()).toBeNull();
    expect(settings()).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(settings()).toBeNull();
  });

  it("links the token settings from a SAML warning", async () => {
    mockBackend(() =>
      Promise.resolve(
        snapshot(
          "GitHub is hiding at least 2 PRs: this token isn't authorized for an organization's SAML SSO. Choose Configure SSO for the token at https://github.com/settings/tokens, then refresh.",
        ),
      ),
    );
    render(<App />);

    const banner = await screen.findByTestId("warning-banner");
    expect(banner).toHaveTextContent("at least 2 PRs");
    expect(banner).toHaveTextContent(", then refresh.");
    await userEvent.click(screen.getByRole("button", { name: "github.com/settings/tokens" }));
    expect(open).toHaveBeenCalledWith("https://github.com/settings/tokens");
  });
});
