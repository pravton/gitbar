import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAutoUpdater } from "@/hooks/useAutoUpdater";

const checkMock = check as unknown as ReturnType<typeof vi.fn>;
const relaunchMock = relaunch as unknown as ReturnType<typeof vi.fn>;

function updateHandle(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.2.0",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  checkMock.mockReset();
  relaunchMock.mockReset();
  relaunchMock.mockResolvedValue(undefined);
});

describe("useAutoUpdater", () => {
  it("stays idle when no update is available", async () => {
    checkMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAutoUpdater());
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.version).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("flips to 'available' and surfaces the version when check returns an update", async () => {
    checkMock.mockResolvedValueOnce(updateHandle({ version: "0.2.0" }));
    const { result } = renderHook(() => useAutoUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    expect(result.current.version).toBe("0.2.0");
  });

  it("install() invokes downloadAndInstall + relaunch when an update is available", async () => {
    const handle = updateHandle();
    checkMock.mockResolvedValueOnce(handle);
    const { result } = renderHook(() => useAutoUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));

    await act(async () => {
      await result.current.install();
    });

    expect(handle.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("install() is a no-op when no update is pending", async () => {
    checkMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAutoUpdater());
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => {
      await result.current.install();
    });

    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("surfaces check() errors into phase=error", async () => {
    checkMock.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useAutoUpdater());
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("network down");
  });

  it("surfaces downloadAndInstall errors into phase=error", async () => {
    const handle = updateHandle({
      downloadAndInstall: vi.fn().mockRejectedValueOnce(new Error("disk full")),
    });
    checkMock.mockResolvedValueOnce(handle);
    const { result } = renderHook(() => useAutoUpdater());
    await waitFor(() => expect(result.current.phase).toBe("available"));

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("disk full");
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});
