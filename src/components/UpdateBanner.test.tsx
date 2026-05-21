import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "@/components/UpdateBanner";
import type { UseAutoUpdaterResult } from "@/hooks/useAutoUpdater";

function updaterState(overrides: Partial<UseAutoUpdaterResult> = {}): UseAutoUpdaterResult {
  return {
    phase: "available",
    version: "0.2.0",
    error: null,
    install: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("UpdateBanner", () => {
  it("renders nothing when idle", () => {
    render(<UpdateBanner updater={updaterState({ phase: "idle" })} />);
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("renders nothing on error (silent failure for auto-update)", () => {
    render(
      <UpdateBanner
        updater={updaterState({ phase: "error", error: "boom" })}
      />,
    );
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("renders the version + restart CTA when an update is available", () => {
    render(<UpdateBanner updater={updaterState({ version: "0.2.0" })} />);
    const banner = screen.getByTestId("update-banner");
    expect(banner).toHaveTextContent("Update v0.2.0 available");
    expect(screen.getByRole("button", { name: /Restart to install/i })).toBeInTheDocument();
  });

  it("clicking the CTA calls install()", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    render(<UpdateBanner updater={updaterState({ install })} />);
    await userEvent.click(screen.getByRole("button", { name: /Restart to install/i }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("disables the CTA and shows progress copy while installing", () => {
    render(<UpdateBanner updater={updaterState({ phase: "installing" })} />);
    const banner = screen.getByTestId("update-banner");
    expect(banner).toHaveTextContent(/Installing update/);
    expect(screen.getByRole("button", { name: /Installing/i })).toBeDisabled();
  });
});
