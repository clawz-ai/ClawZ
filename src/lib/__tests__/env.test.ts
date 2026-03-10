import { describe, it, expect, afterEach } from "vitest";
import { isTauriEnv, extractErrorMessage } from "../env";

describe("isTauriEnv", () => {
  // Bug: Previously used `err instanceof Error` to detect browser mode.
  // Tauri invoke() rejects with plain strings, not Error instances,
  // so all Tauri errors were misidentified as "browser mode" and
  // fallback demo data was shown instead of real error messages.
  // Fix: Use window.__TAURI_INTERNALS__ to detect Tauri environment.

  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore window to original state
    if (originalWindow === undefined) {
      // @ts-expect-error — test cleanup
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it("returns false when not in Tauri (no __TAURI_INTERNALS__)", () => {
    // Simulate browser environment without Tauri
    globalThis.window = {} as typeof window;
    expect(isTauriEnv()).toBe(false);
  });

  it("returns true when __TAURI_INTERNALS__ is present", () => {
    // Simulate Tauri webview
    globalThis.window = { __TAURI_INTERNALS__: {} } as unknown as typeof window;
    expect(isTauriEnv()).toBe(true);
  });

  it("returns false when window is undefined (SSR/Node)", () => {
    // @ts-expect-error — simulating no window
    globalThis.window = undefined;
    expect(isTauriEnv()).toBe(false);
  });
});

describe("extractErrorMessage", () => {
  // Bug: Tauri invoke() errors are plain strings, not Error instances.
  // Code that did `err instanceof Error ? err.message : ...` would
  // incorrectly fall through to the else branch for Tauri errors.

  it("extracts message from a string (Tauri invoke rejection)", () => {
    // This is what Tauri actually throws on invoke failure
    const tauriError = "Failed to install OpenClaw CLI: npm not found";
    expect(extractErrorMessage(tauriError)).toBe(tauriError);
  });

  it("extracts message from an Error instance (browser/JS error)", () => {
    const jsError = new Error("Network request failed");
    expect(extractErrorMessage(jsError)).toBe("Network request failed");
  });

  it("handles undefined", () => {
    expect(extractErrorMessage(undefined)).toBe("undefined");
  });

  it("handles null", () => {
    expect(extractErrorMessage(null)).toBe("null");
  });

  it("handles numbers", () => {
    expect(extractErrorMessage(404)).toBe("404");
  });

  it("handles objects", () => {
    expect(extractErrorMessage({ code: "ERR" })).toBe("[object Object]");
  });

  // Regression test: ensure string errors are NOT misidentified
  it("string error is NOT instanceof Error", () => {
    const tauriError: unknown = "some error from Tauri";
    // This is the exact bug pattern — the old code would go to fallback
    const isError = tauriError instanceof Error;
    expect(isError).toBe(false);
    // But extractErrorMessage handles it correctly
    expect(extractErrorMessage(tauriError)).toBe("some error from Tauri");
  });
});
