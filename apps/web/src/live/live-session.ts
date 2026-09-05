import { EventEngine } from "@cpehuahua/core";
import type { CpeLiveReport } from "@cpehuahua/core";

export interface LivePollingOptions {
  intervalMs?: number;
  historySize?: number;
  eventEngine?: EventEngine;
  now?: () => number;
  setTimeout?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  onUpdate?: (report: CpeLiveReport) => void;
  onError?: (error: unknown) => void;
}

export type LiveReportReader = () => Promise<CpeLiveReport>;

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Central browser coordinator for one atomic `/api/live` snapshot request. */
export class LivePollingSession {
  private readonly read: LiveReportReader;
  private readonly intervalMs: number;
  private readonly historySize: number;
  private readonly eventEngine: EventEngine;
  private readonly scheduleTimer: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly cancelTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly onUpdate: ((report: CpeLiveReport) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly history: CpeLiveReport["history"] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activePoll: Promise<CpeLiveReport | null> | null = null;
  private latest: CpeLiveReport | null = null;
  private started = false;

  constructor(read: LiveReportReader, options: LivePollingOptions = {}) {
    this.read = read;
    this.intervalMs = positiveInteger(options.intervalMs, 1_000);
    this.historySize = positiveInteger(options.historySize, 60);
    this.eventEngine = options.eventEngine ?? new EventEngine();
    this.scheduleTimer = options.setTimeout
      ?? ((handler, delayMs) => globalThis.setTimeout(handler, delayMs));
    this.cancelTimer = options.clearTimeout
      ?? ((handle) => globalThis.clearTimeout(handle));
    this.onUpdate = options.onUpdate;
    this.onError = options.onError;
  }

  get isStarted(): boolean {
    return this.started;
  }

  get latestReport(): CpeLiveReport | null {
    return this.latest;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
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
    this.latest = null;
    this.history.length = 0;
    this.eventEngine.reset();
  }

  pollNow(): Promise<CpeLiveReport | null> {
    if (this.activePoll !== null) return this.activePoll;
    const operation = this.readAndProcess();
    this.activePoll = operation;
    void operation.then(
      () => this.finish(operation),
      (error) => {
        this.onError?.(error);
        this.finish(operation);
      },
    );
    return operation;
  }

  private finish(operation: Promise<CpeLiveReport | null>): void {
    if (this.activePoll !== operation) return;
    this.activePoll = null;
    if (this.started) this.schedule(this.intervalMs);
  }

  private async readAndProcess(): Promise<CpeLiveReport> {
    const report = await this.read();
    this.eventEngine.ingest(report.snapshot);
    this.history.push(report.snapshot);
    while (this.history.length > this.historySize) this.history.shift();
    const update: CpeLiveReport = {
      ...report,
      history: [...this.history],
      events: [...this.eventEngine.events],
    };
    this.latest = update;
    this.onUpdate?.(update);
    return update;
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.timer !== null) return;
    this.timer = this.scheduleTimer(() => {
      this.timer = null;
      void this.pollNow().catch(() => undefined);
    }, delayMs);
  }
}
