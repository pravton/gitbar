import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("keeps the account and opens the rotate form when a token is rejected", async () => {
    mockBackend(() => Promise.reject({ kind: "auth", message: "Bad credentials" }));
    render(<App />);

    await userEvent.click(await screen.findByTestId("error-banner-reconnect"));

    const rotate = await screen.findByLabelText(/Rotate token for/);
    await vi.waitFor(() => expect(rotate).toHaveFocus());
    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands).not.toContain("remove_account");
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
