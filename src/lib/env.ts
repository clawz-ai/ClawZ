/** Check whether we're running inside a Tauri webview */
export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Extract an error message from a Tauri invoke rejection.
 *
 * IMPORTANT: Tauri invoke() rejects with a plain string, NOT an Error instance.
 * This was a real bug — using `err instanceof Error` to branch logic caused
 * Tauri errors to be misidentified as "not in Tauri" browser mode.
 *
 * Always use this helper to safely extract the message from either type.
 */
export function extractErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
