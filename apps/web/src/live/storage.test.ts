import { describe, expect, it } from "vitest";
import type { CpeLiveReport, CpeSnapshot } from "@cpehuahua/core";
import {
  clearPersistedLiveReport,
  liveStorageKey,
  loadPersistedLiveReport,
  savePersistedLiveReport,
  type StorageLike,
} from "./storage";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function report(overrides: Partial<CpeLiveReport> = {}): CpeLiveReport {
  const snapshot: CpeSnapshot = {
    schemaVersion: 1,
    timestamp: "2026-09-05T08:00:00.000Z",
    source: "live" as const,
    device: { model: "H168-383", firmware: null, uptimeSeconds: null },
    connection: {
      cellularOnline: true,
      internetOnline: null,
      radioMode: "5G" as const,
      saNsa: "SA" as const,
      plmn: "46000",
    },
    radio: {
      band: "n78",
      arfcn: null,
      rsrpDbm: -91,
      rsrqDb: -9,
      sinrDb: 23,
      rssiDbm: null,
      pci: 187,
      cellId: "123456789",
      tac: null,
      bandwidth: null,
      rrcStatus: null,
      cqi: null,
      mimoRank: null,
      dlMcs: null,
      ulMcs: null,
      blerPct: null,
      txPowerDbm: null,
    },
    cells: { pcc: null, scells: [], neighbors: [] },
    network: { pingMs: null, jitterMs: null, packetLossPct: null, downloadBps: null, uploadBps: null },
    extended: {
      temperatureC: null,
      fanRpm: null,
      cpuUsagePct: null,
      memoryUsagePct: null,
      qci: null,
      fiveQi: null,
      dlAmbr: null,
      ulAmbr: null,
    },
    capabilities: {
      signal: "observed",
      secondaryCells: "unknown",
      neighbors: "unknown",
      traffic: "unknown",
      temperature: "unknown",
      fan: "unknown",
      qci: "unknown",
      fiveQi: "unknown",
      ambr: "unknown",
      cpu: "unknown",
      memory: "unknown",
      mcs: "unknown",
      cqi: "unknown",
      mimoRank: "unknown",
      bler: "unknown",
      txPower: "unknown",
    },
  };

  return {
    schemaVersion: 1,
    generatedAt: snapshot.timestamp,
    adapterId: "h168",
    gateway: "192.168.8.1",
    snapshot,
    history: [snapshot],
    events: [],
    ...overrides,
  };
}

describe("live snapshot storage", () => {
  it("round-trips only a normalized live report", () => {
    const storage = new MemoryStorage();
    const input = report();

    expect(savePersistedLiveReport(input, storage)).toBe(true);
    expect(loadPersistedLiveReport(storage)).toEqual(input);
    expect(storage.getItem(liveStorageKey)).not.toContain("password");
  });

  it("bounds restored history and events", () => {
    const storage = new MemoryStorage();
    const input = report({
      history: Array.from({ length: 70 }, (_, index) => ({
        ...report().snapshot,
        timestamp: `2026-09-05T08:00:${String(index).padStart(2, "0")}.000Z`,
      })),
      events: Array.from({ length: 520 }, (_, index) => ({
        timestamp: `2026-09-05T08:00:${String(index % 60).padStart(2, "0")}.000Z`,
        type: "LOW_SINR" as const,
        oldValue: null,
        newValue: index,
        context: {},
        durationMs: null,
      })),
    });

    expect(savePersistedLiveReport(input, storage)).toBe(true);
    const loaded = loadPersistedLiveReport(storage);
    expect(loaded?.history).toHaveLength(60);
    expect(loaded?.events).toHaveLength(500);
  });

  it("hydrates snapshots saved before the radio detail fields existed", () => {
    const storage = new MemoryStorage();
    const input = report();
    const { bandwidth: _bandwidth, rrcStatus: _rrcStatus, ...legacyRadio } = input.snapshot.radio;
    const legacyReport = {
      ...input,
      snapshot: { ...input.snapshot, radio: legacyRadio },
    };
    storage.setItem(liveStorageKey, JSON.stringify({
      version: 1,
      savedAt: input.generatedAt,
      report: legacyReport,
    }));

    const loaded = loadPersistedLiveReport(storage);

    expect(loaded?.snapshot.radio.bandwidth).toBeNull();
    expect(loaded?.snapshot.radio.rrcStatus).toBeNull();
  });

  it("rejects corrupt, wrong-version, and oversized state", () => {
    const storage = new MemoryStorage();
    storage.setItem(liveStorageKey, "not-json");
    expect(loadPersistedLiveReport(storage)).toBeNull();

    storage.setItem(liveStorageKey, JSON.stringify({ version: 2, report: report() }));
    expect(loadPersistedLiveReport(storage)).toBeNull();

    storage.setItem(liveStorageKey, "x".repeat(512 * 1024 + 1));
    expect(loadPersistedLiveReport(storage)).toBeNull();
  });

  it("can clear state without throwing", () => {
    const storage = new MemoryStorage();
    savePersistedLiveReport(report(), storage);
    clearPersistedLiveReport(storage);
    expect(loadPersistedLiveReport(storage)).toBeNull();
  });
});
