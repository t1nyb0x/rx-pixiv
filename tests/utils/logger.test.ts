import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { buildLoggerOptions, createContextLogger, createLogger } from "#utils/logger";

class LogSink extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }
}

describe("logger", () => {
  it("uses pretty transport only for development stdout", () => {
    expect(buildLoggerOptions({ development: true }).transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true, singleLine: true },
    });
    expect(buildLoggerOptions({ development: false })).not.toHaveProperty("transport");
    expect(createLogger({ level: "silent" }).level).toBe("silent");
  });

  it("redacts cookies and PIXIV_PHPSESSID while retaining context", () => {
    const sink = new LogSink();
    const logger = createLogger({ destination: sink });
    const child = createContextLogger(logger, {
      traceId: "trace-1",
      guildId: "guild-1",
      channelId: "channel-1",
      workId: "work-1",
      source: "ajax",
    });

    child.info(
      {
        auth: { cookie: "cookie-secret", PIXIV_PHPSESSID: "session-secret" },
        req: { headers: { cookie: "request-secret" } },
      },
      "redaction test",
    );

    const line = sink.chunks.join("");
    expect(line).toContain("trace-1");
    expect(line).toContain("[Redacted]");
    expect(line).not.toContain("cookie-secret");
    expect(line).not.toContain("session-secret");
    expect(line).not.toContain("request-secret");
  });
});
