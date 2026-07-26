import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "@/components/Settings";
import type { UseReviewRequestNotifierResult } from "@/hooks/useReviewRequestNotifier";

const notifications: UseReviewRequestNotifierResult = {
  enabled: false,
  permission: "default",
  setEnabled: vi.fn().mockResolvedValue(undefined),
};

function renderSettings(overrides: Partial<React.ComponentProps<typeof Settings>> = {}) {
  const props = {
    accounts: ["alice"],
    activeLogin: "alice",
    onAddAccount: vi.fn().mockResolvedValue({ ok: true }),
    onRemoveAccount: vi.fn().mockResolvedValue({ ok: true }),
    onSwitchAccount: vi.fn().mockResolvedValue({ ok: true }),
    onReplaceActiveToken: vi.fn().mockResolvedValue({ ok: true }),
    notifications,
    onClose: vi.fn(),
    ...overrides,
  };
  render(<Settings {...props} />);
  return props;
}

describe("Settings", () => {
  it("shows 'No accounts connected' when the roster is empty", () => {
    renderSettings({ accounts: [], activeLogin: null });
    expect(screen.getByText(/No accounts connected/)).toBeInTheDocument();
  });

  it("marks the active account and doesn't show a Switch button for it", () => {
    renderSettings({ accounts: ["alice", "bob"], activeLogin: "alice" });
    const list = screen.getByRole("list");
    const aliceRow = within(list).getByText("alice").closest("li")!;
    expect(within(aliceRow).getByText("Active")).toBeInTheDocument();
    expect(within(aliceRow).queryByRole("button", { name: "Switch" })).not.toBeInTheDocument();

    const bobRow = within(list).getByText("bob").closest("li")!;
    expect(within(bobRow).getByRole("button", { name: "Switch" })).toBeInTheDocument();
  });

  it("calls onSwitchAccount when a non-active account's Switch button is clicked", async () => {
    const onSwitchAccount = vi.fn().mockResolvedValue({ ok: true });
    renderSettings({ accounts: ["alice", "bob"], activeLogin: "alice", onSwitchAccount });

    const bobRow = within(screen.getByRole("list")).getByText("bob").closest("li")!;
    await userEvent.click(within(bobRow).getByRole("button", { name: "Switch" }));
    expect(onSwitchAccount).toHaveBeenCalledWith("bob");
  });

  it("calls onRemoveAccount when a row's remove button is clicked", async () => {
    const onRemoveAccount = vi.fn().mockResolvedValue({ ok: true });
    renderSettings({ accounts: ["alice"], activeLogin: "alice", onRemoveAccount });

    await userEvent.click(screen.getByRole("button", { name: "Remove alice" }));
    expect(onRemoveAccount).toHaveBeenCalledWith("alice");
  });

  // The add-account input is always the first "ghp_..." field; the
  // rotate-token form (also "ghp_...") only renders below it, and only
  // when there's an active account.
  const addAccountInput = () => screen.getAllByPlaceholderText("ghp_...")[0];

  it("disables the Add-account Connect button until a token is typed", async () => {
    renderSettings();
    const button = screen.getByRole("button", { name: /^Connect$/ });
    expect(button).toBeDisabled();

    await userEvent.type(addAccountInput(), "ghp_xyz");
    expect(button).toBeEnabled();
  });

  it("calls onAddAccount with the entered token and clears the field on success", async () => {
    const onAddAccount = vi.fn().mockResolvedValue({ ok: true });
    renderSettings({ onAddAccount });

    const input = addAccountInput();
    await userEvent.type(input, "ghp_xyz");
    await userEvent.click(screen.getByRole("button", { name: /^Connect$/ }));

    expect(onAddAccount).toHaveBeenCalledWith("ghp_xyz");
    expect(input).toHaveValue("");
  });

  it("shows the add-account error and keeps the token field populated on failure", async () => {
    const onAddAccount = vi.fn().mockResolvedValue({ ok: false, error: "Bad credentials" });
    renderSettings({ onAddAccount });

    const input = addAccountInput();
    await userEvent.type(input, "ghp_bad");
    await userEvent.click(screen.getByRole("button", { name: /^Connect$/ }));

    expect(await screen.findByText("Bad credentials")).toBeInTheDocument();
    expect(input).toHaveValue("ghp_bad");
  });

  it("does not render the rotate-token form when there's no active account", () => {
    renderSettings({ accounts: [], activeLogin: null });
    expect(screen.queryByRole("button", { name: /Rotate token/ })).not.toBeInTheDocument();
  });

  it("calls onReplaceActiveToken with the login captured when the panel opened", async () => {
    const onReplaceActiveToken = vi.fn().mockResolvedValue({ ok: true });
    renderSettings({ activeLogin: "alice", onReplaceActiveToken });

    // Two password inputs now exist (add-account, rotate-token); rotate's
    // is the second ghp_... placeholder field.
    const rotateInput = screen.getAllByPlaceholderText("ghp_...")[1];
    await userEvent.type(rotateInput, "ghp_rotated");
    await userEvent.click(screen.getByRole("button", { name: /Rotate token/ }));

    expect(onReplaceActiveToken).toHaveBeenCalledWith("alice", "ghp_rotated");
  });

  it("disables the rotate form and refuses to submit if the active account changes after the panel opens", async () => {
    const onReplaceActiveToken = vi.fn().mockResolvedValue({ ok: true });
    const { rerender } = render(
      <Settings
        accounts={["alice", "bob"]}
        activeLogin="alice"
        onAddAccount={vi.fn().mockResolvedValue({ ok: true })}
        onRemoveAccount={vi.fn().mockResolvedValue({ ok: true })}
        onSwitchAccount={vi.fn().mockResolvedValue({ ok: true })}
        onReplaceActiveToken={onReplaceActiveToken}
        notifications={notifications}
        onClose={vi.fn()}
      />,
    );

    const rotateInput = screen.getAllByPlaceholderText("ghp_...")[1];
    await userEvent.type(rotateInput, "ghp_rotated");

    // Simulate a tray-driven switch while the panel is still open: the
    // live activeLogin prop changes, but the form's snapshot doesn't.
    rerender(
      <Settings
        accounts={["alice", "bob"]}
        activeLogin="bob"
        onAddAccount={vi.fn().mockResolvedValue({ ok: true })}
        onRemoveAccount={vi.fn().mockResolvedValue({ ok: true })}
        onSwitchAccount={vi.fn().mockResolvedValue({ ok: true })}
        onReplaceActiveToken={onReplaceActiveToken}
        notifications={notifications}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Active account changed to bob/)).toBeInTheDocument();
    const rotateButton = screen.getByRole("button", { name: /Rotate token/ });
    expect(rotateButton).toBeDisabled();

    await userEvent.click(rotateButton);
    expect(onReplaceActiveToken).not.toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    renderSettings({ onClose });
    await userEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalled();
  });
});
