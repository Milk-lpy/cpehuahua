import {
  EventEngine,
  H168Adapter,
  PollingEngine,
  type CpeAdapter,
  type CpeEvent,
  type CpeLiveReport,
  type CpeSnapshot,
  type EndpointProbeResult,
  type ProbeEndpoint,
} from "@cpehuahua/core";

export interface DevicePollingOptions {
  adapter?: CpeAdapter;
  endpoints?: readonly ProbeEndpoint[];
  gateway?: string | null;
  getGateway?: () => string | null;
  historySize?: number;
  eventEngine?: EventEngine;
  now?: () => number;
  setTimeout?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  onUpdate?: (report: CpeLiveReport) => void;
  onError?: (error: unknown) => void;
}

export type EndpointReader = (endpoint: ProbeEndpoint) => Promise<EndpointProbeResult>;

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Browser-side session backed by the core endpoint scheduler and EventEngine. */
export class DevicePollingSession {
  private readonly adapter: CpeAdapter;
  private readonly historySize: number;
  private readonly eventEngine: EventEngine;
  private readonly getGateway: () => string | null;
  private readonly onUpdate: ((report: CpeLiveReport) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly history: CpeSnapshot[] = [];
  private readonly engine: PollingEngine;
  private latest: CpeLiveReport | null = null;

  constructor(read: EndpointReader, options: DevicePollingOptions = {}) {
    this.adapter = options.adapter ?? new H168Adapter();
    this.historySize = positiveInteger(options.historySize, 60);
    this.eventEngine = options.eventEngine ?? new EventEngine();
    this.getGateway = options.getGateway ?? (() => options.gateway ?? null);
    this.onUpdate = options.onUpdate;
    this.onError = options.onError;
    this.engine = new PollingEngine({
      adapter: this.adapter,
      ...(options.endpoints !== undefined ? { endpoints: options.endpoints } : {}),
      gateway: options.gateway ?? null,
      source: "live",
      read,
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.setTimeout !== undefined ? { setTimeout: options.setTimeout } : {}),
      ...(options.clearTimeout !== undefined ? { clearTimeout: options.clearTimeout } : {}),
      onEndpointResult: (result) => {
        if (result.endpoint.id === "device-basic-information" && result.status === "transport-error") {
          this.onError?.(new Error(result.transportError ?? "Bridge 无法读取 H168"));
        }
      },
      onSnapshot: (snapshot) => this.acceptSnapshot(snapshot),
    });
  }

  get isStarted(): boolean {
    return this.engine.isStarted;
  }

  get latestReport(): CpeLiveReport | null {
    return this.latest;
  }

  start(): void {
    this.engine.start();
  }

  stop(): void {
    this.engine.stop();
  }

  reset(): void {
    this.engine.reset();
    this.history.length = 0;
    this.eventEngine.reset();
    this.latest = null;
  }

  async pollNow(): Promise<CpeLiveReport | null> {
    const snapshot = await this.engine.pollDue();
    if (snapshot === null) return null;
    return this.latest;
  }

  private acceptSnapshot(snapshot: CpeSnapshot): void {
    this.eventEngine.ingest(snapshot);
    this.history.push(snapshot);
    while (this.history.length > this.historySize) this.history.shift();
    const report: CpeLiveReport = {
      schemaVersion: 1,
      generatedAt: snapshot.timestamp,
      adapterId: this.adapter.id,
      gateway: this.getGateway(),
      snapshot,
      history: [...this.history],
      events: [...this.eventEngine.events] as CpeEvent[],
    };
    this.latest = report;
    this.onUpdate?.(report);
  }
}
