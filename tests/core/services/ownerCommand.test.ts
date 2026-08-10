import { describe, expect, it } from "vitest";

import {
  chunkForDiscord,
  parseBlockTarget,
  parseOwnerCommand,
  type OwnerCommand,
} from "#core/services/ownerCommand";

const parsed = (content: string): OwnerCommand | undefined => {
  const result = parseOwnerCommand(content);
  return result?.ok === true ? result.command : undefined;
};

describe("parseOwnerCommand", () => {
  it("ignores anything without the prefix", () => {
    // 通常の会話をコマンドとして解釈しない。
    expect(parseOwnerCommand("hello")).toBeUndefined();
    expect(parseOwnerCommand("owner/guilds")).toBeUndefined();
    expect(parseOwnerCommand("!owner")).toBeUndefined();
  });

  it.each([
    ["!owner/guilds", { name: "guilds" }],
    ["!owner/list-bans", { name: "list-bans" }],
    ["!owner/list-blocks", { name: "list-blocks" }],
    ["!owner/status", { name: "status" }],
    ["!owner/help", { name: "help" }],
    ["!owner/", { name: "help" }],
  ] satisfies [string, OwnerCommand][])("parses %s", (input, expected) => {
    expect(parsed(input)).toEqual(expected);
  });

  it.each([
    ["!owner/leave 123", { name: "leave", guildId: "123" }],
    ["!owner/unban 456", { name: "unban", userId: "456" }],
    ["!owner/unban-guild 789", { name: "unban-guild", guildId: "789" }],
    ["!owner/ban 456", { name: "ban", userId: "456" }],
    ["!owner/ban 456 荒らし 継続中", { name: "ban", userId: "456", reason: "荒らし 継続中" }],
    ["!owner/ban-guild 789 誤用", { name: "ban-guild", guildId: "789", reason: "誤用" }],
  ] satisfies [string, OwnerCommand][])("parses %s", (input, expected) => {
    expect(parsed(input)).toEqual(expected);
  });

  it("parses both block granularities", () => {
    expect(parsed("!owner/block 100412238")).toEqual({
      name: "block",
      target: { kind: "artwork", id: "100412238" },
    });
    expect(parsed("!owner/block user:777 削除要請")).toEqual({
      name: "block",
      target: { kind: "user", id: "777" },
      reason: "削除要請",
    });
    expect(parsed("!owner/unblock user:777")).toEqual({
      name: "unblock",
      target: { kind: "user", id: "777" },
    });
  });

  it("rejects commands whose required argument is missing or malformed", () => {
    for (const input of [
      "!owner/leave",
      "!owner/leave abc",
      "!owner/ban",
      "!owner/block",
      "!owner/block not-an-id",
      "!owner/unblock user:abc",
    ]) {
      expect(parseOwnerCommand(input)?.ok).toBe(false);
    }
  });

  it("reports unknown commands rather than silently ignoring them", () => {
    const result = parseOwnerCommand("!owner/selfdestruct");
    expect(result?.ok).toBe(false);
    expect(result?.ok === false ? result.error : "").toContain("selfdestruct");
  });

  it("tolerates surrounding whitespace and repeated spaces", () => {
    expect(parsed("  !owner/ban   456   理由  ")).toEqual({
      name: "ban",
      userId: "456",
      reason: "理由",
    });
  });
});

describe("parseBlockTarget", () => {
  it("distinguishes artwork ids from user ids", () => {
    expect(parseBlockTarget("123")).toEqual({ kind: "artwork", id: "123" });
    expect(parseBlockTarget("user:123")).toEqual({ kind: "user", id: "123" });
  });

  it("rejects anything else", () => {
    expect(parseBlockTarget("user:")).toBeUndefined();
    expect(parseBlockTarget("guild:1")).toBeUndefined();
    expect(parseBlockTarget("")).toBeUndefined();
  });
});

describe("chunkForDiscord", () => {
  it("returns a single chunk when it already fits", () => {
    expect(chunkForDiscord("short")).toEqual(["short"]);
  });

  it("splits on line boundaries", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}`).join("\n");
    const chunks = chunkForDiscord(lines, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(20);
    expect(chunks.join("\n")).toBe(lines);
  });

  it("splits a single over-long line rather than emitting it whole", () => {
    const chunks = chunkForDiscord("a".repeat(50), 20);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(20);
    expect(chunks.join("")).toBe("a".repeat(50));
  });
});
