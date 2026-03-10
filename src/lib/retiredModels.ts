/**
 * Models confirmed retired (404) by their providers.
 *
 * Once a provider returns HTTP 404 / not_found_error for a model,
 * add its full key here (e.g. "anthropic/claude-3-5-haiku-20241022").
 * These models will be hidden from selection UIs and flagged if still
 * set as default.
 *
 * Providers almost never re-launch a retired model, so this list is
 * append-only in practice.
 */
export const RETIRED_MODELS = new Set<string>([
  // Anthropic — legacy dated snapshots removed from API
  "anthropic/claude-3-5-haiku-20241022",
  "anthropic/claude-3-5-sonnet-20241022",
  "anthropic/claude-3-5-sonnet-20240620",
  "anthropic/claude-3-opus-20240229",
  "anthropic/claude-3-sonnet-20240229",
  "anthropic/claude-3-haiku-20240307",
]);

/** Check whether a full model key (provider/model) is retired. */
export function isRetiredModel(key: string): boolean {
  return RETIRED_MODELS.has(key);
}
