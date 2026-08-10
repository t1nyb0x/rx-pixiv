import type { FetchError } from "#core/models/errors";
import { err, type Result } from "#core/models/Result";

export type CircuitState = "closed" | "open" | "half_open";
export type CircuitOpenError = {
  readonly kind: "unsupported";
  readonly reason: "circuit_open";
};

export interface CircuitBreakerOptions {
  readonly failureThreshold?: number;
  readonly failureWindowMs?: number;
  readonly openMs?: number;
  readonly now?: () => number;
}

export type CircuitOutcome = "healthy" | "failure" | "trip" | "neutral";

export class CircuitBreaker {
  readonly #failureThreshold: number;
  readonly #failureWindowMs: number;
  readonly #openMs: number;
  readonly #now: () => number;
  #state: CircuitState = "closed";
  #consecutiveFailures = 0;
  #failureWindowStartedAt: number | undefined;
  #openedAt: number | undefined;
  #halfOpenProbeInFlight = false;

  public constructor(options: CircuitBreakerOptions = {}) {
    this.#failureThreshold = options.failureThreshold ?? 5;
    this.#failureWindowMs = options.failureWindowMs ?? 60_000;
    this.#openMs = options.openMs ?? 120_000;
    this.#now = options.now ?? Date.now;

    validatePositiveInteger("failureThreshold", this.#failureThreshold);
    validatePositiveNumber("failureWindowMs", this.#failureWindowMs);
    validatePositiveNumber("openMs", this.#openMs);
  }

  public get state(): CircuitState {
    this.#advanceOpenState();
    return this.#state;
  }

  public async execute<T>(
    operation: () => Promise<Result<T, FetchError>>,
    classify: (error: FetchError) => CircuitOutcome = classifyFetchError,
  ): Promise<Result<T, FetchError>> {
    if (!this.#allowRequest()) return circuitOpen();

    try {
      const result = await operation();
      if (result.ok) {
        this.recordSuccess();
      } else {
        switch (classify(result.error)) {
          case "healthy":
            this.recordSuccess();
            break;
          case "failure":
            this.recordFailure();
            break;
          case "trip":
            this.trip();
            break;
          case "neutral":
            this.recordNeutral();
            break;
        }
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  public recordSuccess(): void {
    this.#state = "closed";
    this.#consecutiveFailures = 0;
    this.#failureWindowStartedAt = undefined;
    this.#openedAt = undefined;
    this.#halfOpenProbeInFlight = false;
  }

  public recordFailure(): void {
    const now = this.#now();

    if (this.#state === "half_open") {
      this.#open(now);
      return;
    }

    if (
      this.#failureWindowStartedAt === undefined ||
      now - this.#failureWindowStartedAt > this.#failureWindowMs
    ) {
      this.#consecutiveFailures = 1;
      this.#failureWindowStartedAt = now;
    } else {
      this.#consecutiveFailures += 1;
    }

    if (this.#consecutiveFailures >= this.#failureThreshold) this.#open(now);
  }

  public trip(): void {
    this.#open(this.#now());
  }

  public recordNeutral(): void {
    if (this.#state === "half_open") this.#halfOpenProbeInFlight = false;
  }

  #allowRequest(): boolean {
    this.#advanceOpenState();
    if (this.#state === "open") return false;
    if (this.#state === "half_open") {
      if (this.#halfOpenProbeInFlight) return false;
      this.#halfOpenProbeInFlight = true;
    }
    return true;
  }

  #advanceOpenState(): void {
    if (
      this.#state === "open" &&
      this.#openedAt !== undefined &&
      this.#now() - this.#openedAt >= this.#openMs
    ) {
      this.#state = "half_open";
      this.#halfOpenProbeInFlight = false;
    }
  }

  #open(now: number): void {
    this.#state = "open";
    this.#openedAt = now;
    this.#halfOpenProbeInFlight = false;
  }
}

function circuitOpen(): Result<never, CircuitOpenError> {
  return err({ kind: "unsupported", reason: "circuit_open" });
}

export function classifyFetchError(error: FetchError): CircuitOutcome {
  switch (error.kind) {
    case "rate_limited":
      return "trip";
    case "upstream_5xx":
    case "timeout":
    case "network":
    case "parse_error":
      return "failure";
    case "not_found":
    case "auth_required":
    case "blocked":
    case "unsupported":
      return "healthy";
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

function validatePositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}
