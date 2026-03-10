import type { AgentBinding, BindingMatch } from "../types/binding";

/** Parse raw CLI binding JSON into typed AgentBinding[] */
export function parseBindings(raw: unknown): AgentBinding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => ({
    agentId: item.agentId ?? "",
    match: {
      channel: item.match?.channel ?? item.description ?? "",
      accountId: item.match?.accountId,
      peer: item.match?.peer,
      guildId: item.match?.guildId,
      teamId: item.match?.teamId,
      roles: item.match?.roles,
    },
    comment: item.comment,
    description: item.description,
  }));
}

/** Convert a BindingMatch to CLI --bind spec string */
export function toBindSpec(match: BindingMatch): string {
  if (match.accountId) {
    return `${match.channel}:${match.accountId}`;
  }
  return match.channel;
}

/** Human-readable display text for a binding */
export function bindingDisplayText(match: BindingMatch): string {
  const parts = [match.channel];
  if (match.accountId && match.accountId !== "default") {
    parts.push(`account:${match.accountId}`);
  }
  if (match.peer) {
    parts.push(`${match.peer.kind}:${match.peer.id}`);
  }
  if (match.guildId) {
    parts.push(`guild:${match.guildId}`);
  }
  if (match.teamId) {
    parts.push(`team:${match.teamId}`);
  }
  return parts.join(" / ");
}

/** Parse all bindings directly from openclaw.json config (no CLI calls needed) */
export function parseBindingsFromConfig(config: Record<string, unknown> | null): AgentBinding[] {
  const raw = config?.bindings;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item: any) => item.type === "route" && item.match?.channel)
    .map((item: any) => ({
      agentId: item.agentId ?? "",
      match: {
        channel: item.match.channel,
        accountId: item.match.accountId,
        peer: item.match.peer,
        guildId: item.match.guildId,
        teamId: item.match.teamId,
        roles: item.match.roles,
      },
      comment: item.comment,
      description: item.description,
    }));
}

/** Check if two BindingMatch objects are equivalent */
export function matchEquals(a: BindingMatch, b: BindingMatch): boolean {
  return (
    a.channel === b.channel &&
    (a.accountId ?? "") === (b.accountId ?? "") &&
    (a.peer?.kind ?? "") === (b.peer?.kind ?? "") &&
    (a.peer?.id ?? "") === (b.peer?.id ?? "") &&
    (a.guildId ?? "") === (b.guildId ?? "") &&
    (a.teamId ?? "") === (b.teamId ?? "")
  );
}
