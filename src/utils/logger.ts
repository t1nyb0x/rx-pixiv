import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

export const REDACT_PATHS = [
  "cookie",
  "*.cookie",
  "PIXIV_PHPSESSID",
  "*.PIXIV_PHPSESSID",
  "req.headers.cookie",
] as const;

export interface LogContext {
  traceId?: string;
  guildId?: string;
  channelId?: string;
  workId?: string;
  source?: string;
}

export interface CreateLoggerOptions {
  level?: string;
  development?: boolean;
  destination?: DestinationStream;
}

export function buildLoggerOptions(options: CreateLoggerOptions = {}): LoggerOptions {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? "info",
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[Redacted]",
    },
  };

  if (options.development === true && options.destination === undefined) {
    loggerOptions.transport = {
      target: "pino-pretty",
      options: { colorize: true, singleLine: true },
    };
  }
  return loggerOptions;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const loggerOptions = buildLoggerOptions(options);
  return options.destination === undefined
    ? pino(loggerOptions)
    : pino(loggerOptions, options.destination);
}

export function createContextLogger(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}
