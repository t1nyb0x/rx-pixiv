export const OWNER_COMMAND_PREFIX = "!owner/";

export type OwnerCommand =
  | { readonly name: "guilds" }
  | { readonly name: "leave"; readonly guildId: string }
  | { readonly name: "ban"; readonly userId: string; readonly reason?: string }
  | { readonly name: "unban"; readonly userId: string }
  | { readonly name: "ban-guild"; readonly guildId: string; readonly reason?: string }
  | { readonly name: "unban-guild"; readonly guildId: string }
  | { readonly name: "list-bans" }
  | { readonly name: "block"; readonly target: BlockArgument; readonly reason?: string }
  | { readonly name: "unblock"; readonly target: BlockArgument }
  | { readonly name: "list-blocks" }
  | { readonly name: "status" }
  | { readonly name: "help" };

export interface BlockArgument {
  readonly kind: "artwork" | "user";
  readonly id: string;
}

export type OwnerCommandParse =
  | { readonly ok: true; readonly command: OwnerCommand }
  | { readonly ok: false; readonly error: string };

const ID_PATTERN = /^\d{1,20}$/;

/**
 * `!owner/...` を解釈する純粋関数（ADR 0015）。
 *
 * discord.js に依存させないことで、全コマンドの解釈をテーブルテストで担保できる。
 * **実行者の確認はここでは行わない** —— 呼び出し側が DM かつオーナーであることを
 * 確かめてから渡す。
 */
export function parseOwnerCommand(content: string): OwnerCommandParse | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith(OWNER_COMMAND_PREFIX)) return undefined;

  const body = trimmed.slice(OWNER_COMMAND_PREFIX.length);
  const [name = "", ...rest] = body.split(/\s+/).filter((part) => part !== "");
  const reason = rest.slice(1).join(" ") || undefined;
  const first = rest[0];

  switch (name) {
    case "guilds":
      return okCommand({ name: "guilds" });
    case "list-bans":
      return okCommand({ name: "list-bans" });
    case "list-blocks":
      return okCommand({ name: "list-blocks" });
    case "status":
      return okCommand({ name: "status" });
    case "help":
    case "":
      return okCommand({ name: "help" });

    case "leave":
      return requireId(first, (guildId) => ({ name: "leave", guildId }), "guildId");
    case "unban":
      return requireId(first, (userId) => ({ name: "unban", userId }), "userId");
    case "unban-guild":
      return requireId(first, (guildId) => ({ name: "unban-guild", guildId }), "guildId");

    case "ban":
      return requireId(
        first,
        (userId) =>
          reason === undefined ? { name: "ban", userId } : { name: "ban", userId, reason },
        "userId",
      );
    case "ban-guild":
      return requireId(
        first,
        (guildId) =>
          reason === undefined
            ? { name: "ban-guild", guildId }
            : { name: "ban-guild", guildId, reason },
        "guildId",
      );

    case "block":
      return requireBlockTarget(first, (target) =>
        reason === undefined ? { name: "block", target } : { name: "block", target, reason },
      );
    case "unblock":
      return requireBlockTarget(first, (target) => ({ name: "unblock", target }));

    default:
      return { ok: false, error: `unknown command: ${name}` };
  }
}

/**
 * 展開拒否の対象。作品 ID そのものか、`user:<pixivUserId>` の2粒度。
 */
export function parseBlockTarget(raw: string): BlockArgument | undefined {
  const userMatch = /^user:(\d{1,20})$/.exec(raw);
  if (userMatch?.[1] !== undefined) return { kind: "user", id: userMatch[1] };
  if (ID_PATTERN.test(raw)) return { kind: "artwork", id: raw };
  return undefined;
}

function requireId(
  value: string | undefined,
  build: (id: string) => OwnerCommand,
  label: string,
): OwnerCommandParse {
  if (value === undefined || !ID_PATTERN.test(value)) {
    return { ok: false, error: `${label} is required` };
  }
  return okCommand(build(value));
}

function requireBlockTarget(
  value: string | undefined,
  build: (target: BlockArgument) => OwnerCommand,
): OwnerCommandParse {
  if (value === undefined) return { ok: false, error: "target is required" };
  const target = parseBlockTarget(value);
  if (target === undefined) {
    return { ok: false, error: "target must be an artwork id or user:<pixivUserId>" };
  }
  return okCommand(build(target));
}

function okCommand(command: OwnerCommand): OwnerCommandParse {
  return { ok: true, command };
}

/** 出力を Discord のメッセージ長に収まる塊へ分割する。 */
export function chunkForDiscord(text: string, limit = 1_900): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current !== "" && current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = "";
    }
    // 1行が上限を超える場合は行の途中で切る。
    let remaining = line;
    while (remaining.length > limit) {
      chunks.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
    current = current === "" ? remaining : `${current}\n${remaining}`;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}
