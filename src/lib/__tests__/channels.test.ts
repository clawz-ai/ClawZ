import { describe, it, expect } from "vitest";
import { CHANNEL_IDENTITY_FIELD, findDuplicateTokenAccount } from "../channels";

describe("CHANNEL_IDENTITY_FIELD", () => {
  it("maps telegram to botToken", () => {
    expect(CHANNEL_IDENTITY_FIELD.telegram).toBe("botToken");
  });

  it("maps discord to token", () => {
    expect(CHANNEL_IDENTITY_FIELD.discord).toBe("token");
  });

  it("maps feishu to appId", () => {
    expect(CHANNEL_IDENTITY_FIELD.feishu).toBe("appId");
  });
});

describe("findDuplicateTokenAccount", () => {
  const configs: Record<string, Record<string, unknown>> = {
    telegram: {
      accounts: {
        default: { botToken: "abc123" },
        "ops-bot": { botToken: "xyz789" },
      },
    },
    discord: {
      accounts: {
        default: { token: "disc-token-1" },
      },
    },
  };

  it("returns account ID when duplicate token found", () => {
    expect(findDuplicateTokenAccount("telegram", "botToken", "abc123", configs)).toBe("default");
    expect(findDuplicateTokenAccount("telegram", "botToken", "xyz789", configs)).toBe("ops-bot");
  });

  it("returns null when no duplicate", () => {
    expect(findDuplicateTokenAccount("telegram", "botToken", "new-token", configs)).toBeNull();
  });

  it("returns null for unknown channel", () => {
    expect(findDuplicateTokenAccount("slack", "botToken", "abc123", configs)).toBeNull();
  });

  it("returns null for empty configs", () => {
    expect(findDuplicateTokenAccount("telegram", "botToken", "abc123", {})).toBeNull();
  });

  it("returns null for empty/whitespace-only value", () => {
    expect(findDuplicateTokenAccount("telegram", "botToken", "", configs)).toBeNull();
    expect(findDuplicateTokenAccount("telegram", "botToken", "   ", configs)).toBeNull();
  });

  it("trims whitespace before comparing", () => {
    expect(findDuplicateTokenAccount("telegram", "botToken", "  abc123  ", configs)).toBe("default");
  });

  it("returns null when channel has no accounts", () => {
    const noAccounts = { telegram: { enabled: true } };
    expect(findDuplicateTokenAccount("telegram", "botToken", "abc123", noAccounts)).toBeNull();
  });

  it("handles missing field key in account gracefully", () => {
    const partial = {
      telegram: { accounts: { default: { otherField: "value" } } },
    };
    expect(findDuplicateTokenAccount("telegram", "botToken", "abc123", partial)).toBeNull();
  });
});
