import type { CpeAdapter } from "../types/adapter";
import type { CpeSnapshot } from "../types/model";
import type { EndpointProbeResult, ProbeEndpoint } from "../types/probe";

export type PollingRead = (endpoint: ProbeEndpoint) => Promise<EndpointProbeResult>;

export interface PollingEngineOptions {
  adapter: CpeAdapter;
  read: PollingRead;
  endpoints?: readonly ProbeEndpoint[];
  gateway: string | null;
  source?: CpeSnapshot["source"];
  now?: () => number;
  setTimeout?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  onEndpointResult?: (result: EndpointProbeResult) => void;
  onSnapshot?: (snapshot: CpeSnapshot) => void;
}

interface ScheduleState {
  endpoint: ProbeEndpoint;
  nextDueAt: number;
  completed: boolean;
  inFlight: boolean;
}

function isoAt(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function transportFailure(
  endpoint: ProbeEndpoint,
  requestedAt: string,
  startedAt: number,
  error: unknown,
): EndpointProbeResult {
  return {
    endpoint,
    status: "transport-error",
    requestedAt,
    completedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    httpStatus: null,
    huaweiError: null,
    transportError: error instanceof Error ? error.message : "Polling read failed",
    rawXml: "",
    sanitizedRawXml: "",
    parsed: null,
    parsedFields: [],
  };
}

/**
 * One scheduler owns all endpoint timers. Reads are serialized so a slow
 * Huawei response cannot create concurrent authentication/cookie races.
 */
export class PollingEngine {
  private readonly adapter: CpeAdapter;
  private readonly read: PollingRead;
  private readonly endpoints: readonly ProbeEndpoint[];
  private readonly gateway: string | null;
  private readonly source: CpeSnapshot["source"];
  private readonly now: () => number;
  private readonly scheduleTimer: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly cancelTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly onEndpointResult: ((result: EndpointProbeResult) => void) | undefined;
  private readonly onSnapshot: ((snapshot: CpeSnapshot) => void) | undefined;
  private readonly scheduleStates: ScheduleState[];
  private readonly latest = new Map<string, EndpointProbeResult>();
  // Keep diagnostics current in `latest`, but do not turn one transient
  // transport/session failure into a blank normalized snapshot when a prior
  // successful response exists for the same endpoint.
  private readonly latestReadable = new Map<string, EndpointProbeResult>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activePoll: Promise<CpeSnapshot | null> | null = null;
  private started = false;

  constructor(options: PollingEngineOptions) {
    this.adapter = options.adapter;
    this.read = options.read;
    this.endpoints = [...(options.endpoints ?? options.adapter.probeEndpoints)]
      .filter((endpoint) => endpoint.defaultEnabled);
    this.gateway = options.gateway;
    this.source = options.source ?? "live";
    this.now = options.now ?? (() => Date.now());
    this.scheduleTimer = options.setTimeout
      ?? ((handler, delayMs) => globalThis.setTimeout(handler, delayMs));
    this.cancelTimer = options.clearTimeout
      ?? ((handle) => globalThis.clearTimeout(handle));
    this.onEndpointResult = options.onEndpointResult;
    this.onSnapshot = options.onSnapshot;
    this.scheduleStates = this.endpoints.map((endpoint) => ({
      endpoint,
      nextDueAt: 0,
      completed: false,
      inFlight: false,
    }));
  }

  get isStarted(): boolean {
    return this.started;
  }

  get latestResults(): Readonly<Record<string, EndpointProbeResult>> {
    return Object.fromEntries(this.latest);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.scheduleNext();
  }

  stop(): void {
    this.started = false;
    if (this.timer !== null) {
      this.cancelTimer(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.stop();
    this.latest.clear();
    this.latestReadable.clear();
    for (const state of this.scheduleStates) {
      state.nextDueAt = 0;
      state.completed = false;
      state.inFlight = false;
    }
  }

  /** Runs only endpoints due at `at`; useful for deterministic tests and host-controlled loops. */
  pollDue(at = this.now()): Promise<CpeSnapshot | null> {
    if (this.activePoll !== null) {
      return this.activePoll;
    }
    const operation = this.pollDueInternal(at);
    this.activePoll = operation;
    void operation.then(
      () => this.finishPoll(operation),
      () => this.finishPoll(operation),
    );
    return operation;
  }

  private finishPoll(operation: Promise<CpeSnapshot | null>): void {
    if (this.activePoll !== operation) {
      return;
    }
    this.activePoll = null;
    if (this.started) {
      this.scheduleNext();
    }
  }

  private async pollDueInternal(at: number): Promise<CpeSnapshot | null> {
    const due = this.scheduleStates.filter((state) => (
      !state.completed && !state.inFlight && state.nextDueAt <= at
    ));
    if (due.length === 0) {
      return null;
    }

    for (const state of due) {
      state.inFlight = true;
      const requestedAt = isoAt(this.now());
      const startedAt = Date.now();
      let result: EndpointProbeResult;
      try {
        result = await this.read(state.endpoint);
      } catch (error) {
        result = transportFailure(state.endpoint, requestedAt, startedAt, error);
      } finally {
        state.inFlight = false;
      }
      this.latest.set(state.endpoint.id, result);
      if (result.status === "ok" || !this.latestReadable.has(state.endpoint.id)) {
        this.latestReadable.set(state.endpoint.id, result);
      }
      this.onEndpointResult?.(result);
      if (state.endpoint.intervalMs === null) {
        state.completed = true;
      } else {
        state.nextDueAt = this.now() + state.endpoint.intervalMs;
      }
    }

    const snapshot = this.adapter.normalize({
      timestamp: isoAt(this.now()),
      source: this.source,
      gateway: this.gateway,
      endpointResults: Object.fromEntries(this.latestReadable),
    });
    this.onSnapshot?.(snapshot);
    return snapshot;
  }

  private scheduleNext(): void {
    if (!this.started || this.timer !== null) {
      return;
    }
    const pending = this.scheduleStates.filter((state) => !state.completed && !state.inFlight);
    if (pending.length === 0) {
      return;
    }
    const earliest = Math.min(...pending.map((state) => state.nextDueAt));
    const delayMs = Math.max(0, earliest - this.now());
    this.timer = this.scheduleTimer(() => {
      this.timer = null;
      void this.pollDue(this.now());
    }, delayMs);
  }
}
