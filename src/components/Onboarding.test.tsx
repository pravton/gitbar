import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "@/components/Onboarding";

describe("Onboarding", () => {
  it("disables the connect button until a token is typed", async () => {
    const onConnect = vi.fn().mockResolvedValue(true);
    render(<Onboarding checking={false} error={null} onConnect={onConnect} />);
    const button = screen.getByRole("button", { name: /Connect$/ });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("ghp_..."), "ghp_xyz");
    expect(button).toBeEnabled();
  });

  it("calls onConnect with the entered token", async () => {
    const onConnect = vi.fn().mockResolvedValue(true);
    render(<Onboarding checking={false} error={null} onConnect={onConnect} />);
    await userEvent.type(screen.getByPlaceholderText("ghp_..."), "ghp_xyz");
    await userEvent.click(screen.getByRole("button", { name: /Connect$/ }));
    expect(onConnect).toHaveBeenCalledWith("ghp_xyz");
  });

  it("shows the error message when provided", () => {
    render(<Onboarding checking={false} error="rejected" onConnect={vi.fn()} />);
    expect(screen.getByText("rejected")).toBeInTheDocument();
  });

  it("shows 'Checking...' while validating", () => {
    render(<Onboarding checking error={null} onConnect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Checking/ })).toBeDisabled();
  });
});
