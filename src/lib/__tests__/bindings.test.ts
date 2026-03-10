import { describe, it, expect, beforeAll } from "vitest";
import {
  parseBindings,
  toBindSpec,
  bindingDisplayText,
  matchEquals,
} from "../bindings";

describe("parseBindings", () => {
  it("returns empty array for non-array input", () => {
    expect(parseBindings(null)).toEqual([]);
    expect(parseBindings(undefined)).toEqual([]);
    expect(parseBindings("string")).toEqual([]);
    expect(parseBindings({})).toEqual([]);
  });

  it("returns empty array for empty array", () => {
    expect(parseBindings([])).toEqual([]);
  });

  it("parses standard binding objects", () => {
    const raw = [
      {
        agentId: "main",
        match: { channel: "telegram", accountId: "ops-bot" },
        description: "telegram:ops-bot",
      },
    ];
    const result = parseBindings(raw);
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe("main");
    expect(result[0].match.channel).toBe("telegram");
    expect(result[0].match.accountId).toBe("ops-bot");
    expect(result[0].description).toBe("telegram:ops-bot");
  });

  it("falls back to description for channel when match is missing", () => {
    const raw = [{ description: "slack" }];
    const result = parseBindings(raw);
    expect(result[0].match.channel).toBe("slack");
    expect(result[0].agentId).toBe("");
  });

  it("parses peer, guildId, teamId, roles", () => {
    const raw = [
      {
        agentId: "agent-1",
        match: {
          channel: "discord",
          peer: { kind: "group", id: "12345" },
          guildId: "guild-1",
          teamId: "team-1",
          roles: ["admin"],
        },
      },
    ];
    const result = parseBindings(raw);
    expect(result[0].match.peer).toEqual({ kind: "group", id: "12345" });
    expect(result[0].match.guildId).toBe("guild-1");
    expect(result[0].match.teamId).toBe("team-1");
    expect(result[0].match.roles).toEqual(["admin"]);
  });
});

describe("toBindSpec", () => {
  it("returns channel only when no accountId", () => {
    expect(toBindSpec({ channel: "telegram" })).toBe("telegram");
  });

  it("returns channel:accountId when accountId present", () => {
    expect(toBindSpec({ channel: "telegram", accountId: "ops-bot" })).toBe(
      "telegram:ops-bot",
    );
  });

  it("returns channel only when accountId is empty string", () => {
    expect(toBindSpec({ channel: "slack", accountId: "" })).toBe("slack");
  });
});

describe("bindingDisplayText", () => {
  it("shows channel only for simple binding", () => {
    expect(bindingDisplayText({ channel: "telegram" })).toBe("telegram");
  });

  it("skips default accountId", () => {
    expect(
      bindingDisplayText({ channel: "telegram", accountId: "default" }),
    ).toBe("telegram");
  });

  it("shows account for non-default accountId", () => {
    expect(
      bindingDisplayText({ channel: "telegram", accountId: "ops-bot" }),
    ).toBe("telegram / account:ops-bot");
  });

  it("shows peer info", () => {
    expect(
      bindingDisplayText({
        channel: "discord",
        peer: { kind: "group", id: "123" },
      }),
    ).toBe("discord / group:123");
  });

  it("shows guild and team", () => {
    expect(
      bindingDisplayText({
        channel: "discord",
        guildId: "g1",
        teamId: "t1",
      }),
    ).toBe("discord / guild:g1 / team:t1");
  });

  it("shows all parts combined", () => {
    expect(
      bindingDisplayText({
        channel: "slack",
        accountId: "bot-1",
        peer: { kind: "channel", id: "general" },
        guildId: "ws-1",
        teamId: "eng",
      }),
    ).toBe("slack / account:bot-1 / channel:general / guild:ws-1 / team:eng");
  });
});

describe("parseBindingsFromConfig", () => {
  // Import here so the function name is available
  let parseBindingsFromConfig: typeof import("../bindings").parseBindingsFromConfig;
  beforeAll(async () => {
    parseBindingsFromConfig = (await import("../bindings")).parseBindingsFromConfig;
  });

  it("returns empty array for null config", () => {
    expect(parseBindingsFromConfig(null)).toEqual([]);
  });

  it("returns empty array when config has no bindings", () => {
    expect(parseBindingsFromConfig({})).toEqual([]);
    expect(parseBindingsFromConfig({ bindings: "not-array" })).toEqual([]);
  });

  it("filters to only type=route entries with channel", () => {
    const config = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "telegram" } },
        { type: "other", agentId: "main", match: { channel: "slack" } },
        { type: "route", agentId: "main", match: {} }, // no channel
      ],
    };
    const result = parseBindingsFromConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].match.channel).toBe("telegram");
  });

  it("parses all match fields", () => {
    const config = {
      bindings: [
        {
          type: "route",
          agentId: "agent-1",
          match: {
            channel: "discord",
            accountId: "bot-1",
            peer: { kind: "group", id: "123" },
            guildId: "g1",
            teamId: "t1",
            roles: ["admin"],
          },
          comment: "test",
          description: "discord:bot-1",
        },
      ],
    };
    const result = parseBindingsFromConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe("agent-1");
    expect(result[0].match.accountId).toBe("bot-1");
    expect(result[0].match.peer).toEqual({ kind: "group", id: "123" });
    expect(result[0].match.guildId).toBe("g1");
    expect(result[0].match.teamId).toBe("t1");
    expect(result[0].match.roles).toEqual(["admin"]);
    expect(result[0].comment).toBe("test");
  });

  it("defaults agentId to empty string when missing", () => {
    const config = {
      bindings: [
        { type: "route", match: { channel: "telegram" } },
      ],
    };
    const result = parseBindingsFromConfig(config);
    expect(result[0].agentId).toBe("");
  });
});

describe("matchEquals", () => {
  it("matches identical simple bindings", () => {
    expect(
      matchEquals({ channel: "telegram" }, { channel: "telegram" }),
    ).toBe(true);
  });

  it("does not match different channels", () => {
    expect(
      matchEquals({ channel: "telegram" }, { channel: "slack" }),
    ).toBe(false);
  });

  it("treats missing and empty accountId as equal", () => {
    expect(
      matchEquals(
        { channel: "telegram", accountId: undefined },
        { channel: "telegram", accountId: "" },
      ),
    ).toBe(true);
  });

  it("matches with accountId", () => {
    expect(
      matchEquals(
        { channel: "telegram", accountId: "bot-1" },
        { channel: "telegram", accountId: "bot-1" },
      ),
    ).toBe(true);
  });

  it("does not match different accountIds", () => {
    expect(
      matchEquals(
        { channel: "telegram", accountId: "bot-1" },
        { channel: "telegram", accountId: "bot-2" },
      ),
    ).toBe(false);
  });

  it("compares peer fields", () => {
    expect(
      matchEquals(
        { channel: "discord", peer: { kind: "group", id: "1" } },
        { channel: "discord", peer: { kind: "group", id: "1" } },
      ),
    ).toBe(true);

    expect(
      matchEquals(
        { channel: "discord", peer: { kind: "group", id: "1" } },
        { channel: "discord", peer: { kind: "direct", id: "1" } },
      ),
    ).toBe(false);
  });

  it("compares guildId and teamId", () => {
    expect(
      matchEquals(
        { channel: "discord", guildId: "g1" },
        { channel: "discord", guildId: "g1" },
      ),
    ).toBe(true);

    expect(
      matchEquals(
        { channel: "discord", guildId: "g1" },
        { channel: "discord", guildId: "g2" },
      ),
    ).toBe(false);
  });
});
