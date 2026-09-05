import { describe, expect, it } from "vitest";
import { NetworkQualityTracker } from "./quality";

function sample(second: number, success: boolean, latencyMs: number | null) {
  return { timestamp: `2026-09-05T00:00:${String(second).padStart(2, "0")}.000Z`, success, latencyMs };
}

describe("NetworkQualityTracker", () => {
  it("does not flap Internet state on isolated packet loss", () => {
    const tracker = new NetworkQualityTracker({ failureThreshold: 3, recoveryThreshold: 2 });

    expect(tracker.record(sample(0, true, 30)).internetOnline).toBeNull();
    expect(tracker.record(sample(1, true, 32)).internetOnline).toBe(true);
    expect(tracker.record(sample(2, false, null)).internetOnline).toBe(true);
    expect(tracker.record(sample(3, true, 31)).internetOnline).toBe(true);
  });

  it("requires consecutive failures and successes, and computes loss/jitter", () => {
    const tracker = new NetworkQualityTracker({
      windowSize: 6,
      failureThreshold: 3,
      recoveryThreshold: 2,
    });

    tracker.record(sample(0, true, 20));
    tracker.record(sample(1, true, 30));
    tracker.record(sample(2, false, null));
    tracker.record(sample(3, false, null));
    const down = tracker.record(sample(4, false, null));

    expect(down.internetOnline).toBe(false);
    expect(down.changed).toBe(true);
    expect(down.metrics.packetLossPct).toBe(60);
    expect(down.metrics.pingMs).toBe(25);
    expect(down.metrics.jitterMs).toBe(10);

    tracker.record(sample(5, true, 50));
    const restored = tracker.record(sample(6, true, 52));
    expect(restored.internetOnline).toBe(true);
    expect(restored.changed).toBe(true);
    expect(restored.metrics.packetLossPct).toBeCloseTo(50);
  });

  it("keeps latency null when every probe fails", () => {
    const tracker = new NetworkQualityTracker({ failureThreshold: 1 });
    const update = tracker.record(sample(0, false, null));

    expect(update.internetOnline).toBe(false);
    expect(update.metrics.pingMs).toBeNull();
    expect(update.metrics.jitterMs).toBeNull();
    expect(update.metrics.packetLossPct).toBe(100);
  });
});
