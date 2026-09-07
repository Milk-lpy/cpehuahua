import type { NetworkMetrics } from "../types/model";

export interface NetworkProbeSample {
  timestamp: string;
  success: boolean;
  latencyMs: number | null;
}

export interface NetworkQualityOptions {
  /** Number of recent probes used for loss, latency and jitter. */
  windowSize?: number;
  /** Consecutive failed probes required before declaring Internet down. */
  failureThreshold?: number;
  /** Consecutive successful probes required before declaring Internet up. */
  recoveryThreshold?: number;
}

export interface NetworkQualityUpdate {
  metrics: NetworkMetrics;
  internetOnline: boolean | null;
  changed: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_THRESHOLD = 2;

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function validLatency(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Converts individual user-path probes into stable network metrics.
 *
 * A failed probe counts toward packet loss but never contributes a fake
 * latency. Internet state deliberately uses hysteresis: one lost request is
 * not enough to declare an outage, and one success is not enough to close it.
 */
export class NetworkQualityTracker {
  private readonly windowSize: number;
  private readonly failureThreshold: number;
  private readonly recoveryThreshold: number;
  private readonly sampleHistory: NetworkProbeSample[] = [];
  private state: boolean | null = null;
  private consecutiveFailuresValue = 0;
  private consecutiveSuccessesValue = 0;

  constructor(options: NetworkQualityOptions = {}) {
    this.windowSize = positiveInteger(options.windowSize, DEFAULT_WINDOW_SIZE);
    this.failureThreshold = positiveInteger(options.failureThreshold, DEFAULT_FAILURE_THRESHOLD);
    this.recoveryThreshold = positiveInteger(options.recoveryThreshold, DEFAULT_RECOVERY_THRESHOLD);
  }

  get internetOnline(): boolean | null {
    return this.state;
  }

  get samples(): readonly NetworkProbeSample[] {
    return this.sampleHistory;
  }

  record(sample: NetworkProbeSample): NetworkQualityUpdate {
    this.sampleHistory.push({
      ...sample,
      latencyMs: sample.success && validLatency(sample.latencyMs) ? sample.latencyMs : null,
    });
    while (this.sampleHistory.length > this.windowSize) {
      this.sampleHistory.shift();
    }

    if (sample.success) {
      this.consecutiveSuccessesValue += 1;
      this.consecutiveFailuresValue = 0;
    } else {
      this.consecutiveFailuresValue += 1;
      this.consecutiveSuccessesValue = 0;
    }

    const previousState = this.state;
    if (this.state === null) {
      if (this.consecutiveFailuresValue >= this.failureThreshold) {
        this.state = false;
      } else if (this.consecutiveSuccessesValue >= this.recoveryThreshold) {
        this.state = true;
      }
    } else if (this.state && this.consecutiveFailuresValue >= this.failureThreshold) {
      this.state = false;
    } else if (!this.state && this.consecutiveSuccessesValue >= this.recoveryThreshold) {
      this.state = true;
    }

    const successfulLatencies = this.sampleHistory.flatMap((item) => (
      item.success && validLatency(item.latencyMs) ? [item.latencyMs] : []
    ));
    const jitterSamples: number[] = [];
    let previousLatency: number | null = null;
    for (const item of this.sampleHistory) {
      if (!item.success || !validLatency(item.latencyMs)) {
        continue;
      }
      if (previousLatency !== null) {
        jitterSamples.push(Math.abs(item.latencyMs - previousLatency));
      }
      previousLatency = item.latencyMs;
    }

    return {
      metrics: {
        pingMs: average(successfulLatencies),
        jitterMs: average(jitterSamples),
        packetLossPct: this.sampleHistory.length === 0
          ? null
          : (this.sampleHistory.filter((item) => !item.success).length / this.sampleHistory.length) * 100,
        downloadBps: null,
        uploadBps: null,
        currentDownloadBytes: null,
        currentUploadBytes: null,
        totalDownloadBytes: null,
        totalUploadBytes: null,
        currentConnectSeconds: null,
        totalConnectSeconds: null,
      },
      internetOnline: this.state,
      changed: previousState !== this.state,
      consecutiveFailures: this.consecutiveFailuresValue,
      consecutiveSuccesses: this.consecutiveSuccessesValue,
    };
  }

  reset(): void {
    this.sampleHistory.length = 0;
    this.state = null;
    this.consecutiveFailuresValue = 0;
    this.consecutiveSuccessesValue = 0;
  }
}
