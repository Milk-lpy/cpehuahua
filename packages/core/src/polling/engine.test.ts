import { describe, expect, it } from "vitest";
import type { CpeAdapter } from "../types/adapter";
import type { CpeSnapshot } from "../types/model";
import type { EndpointProbeResult, ProbeEndpoint } from "../types/probe";
import { PollingEngine } from "./engine";

const endpoints: readonly ProbeEndpoint[] = [
  {
    id: "fast",
    label: "Fast",
    path: "/fast",
    intervalMs: 1_000,
    requiresAuth: false,
    defaultEnabled: true,
    evidence: "candidate",
  },
  {
    id: "slow",
    label: "Slow",
    path: "/slow",
    intervalMs: 2_000,
    requiresAuth: false,
    defaultEnabled: true,
    evidence: "candidate",
  },
  {
    id: "once",
    label: "Once",
    path: "/once",
    intervalMs: null,
    requiresAuth: false,
    defaultEnabled: true,
    evidence: "candidate",
  },
];

const adapter: CpeAdapter = {
  id: "h168",
  modelNames: ["fixture"],
  probeEndpoints: endpoints,
  baselineCapabilities: {} as CpeAdapter["baselineCapabilities"],
  identify: () => ({ matched: true, confidence: "possible", reason: "test" }),
  normalize: (input): CpeSnapshot => ({
    schemaVersion: 1,
    timestamp: input.timestamp,
    source: input.source,
    device: { model: null, firmware: null, uptimeSeconds: null },
    connection: {
      cellularOnline: null,
      internetOnline: null,
      radioMode: "unknown",
      saNsa: "unknown",
      plmn: null,
    },
    radio: {
      rsrpDbm: null,
      rsrqDb: null,
      sinrDb: null,
      rssiDbm: null,
      pci: null,
      cellId: null,
      tac: null,
      band: null,
      arfcn: null,
      cqi: null,
      mimoRank: null,
      dlMcs: null,
      ulMcs: null,
      blerPct: null,
      txPowerDbm: null,
    },
    cells: { pcc: null, scells: [], neighbors: [] },
    network: {
      pingMs: null,
      jitterMs: null,
      packetLossPct: null,
      downloadBps: null,
      uploadBps: null,
    },
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
    capabilities: adapter.baselineCapabilities,
  }),
};

function result(endpoint: ProbeEndpoint): EndpointProbeResult {
  return {
    endpoint,
    status: "ok",
    requestedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:00.000Z",
    latencyMs: 1,
    httpStatus: 200,
    huaweiError: null,
    transportError: null,
    rawXml: "<response />",
    sanitizedRawXml: "<response />",
    parsed: null,
    parsedFields: [],
  };
}

describe("PollingEngine", () => {
  it("runs one centralized schedule and keeps one-time reads one-time", async () => {
    let clock = 0;
    const calls: string[] = [];
    const snapshots: CpeSnapshot[] = [];
    const engine = new PollingEngine({
      adapter,
      endpoints,
      gateway: "192.168.8.1",
      source: "fixture",
      now: () => clock,
      read: async (endpoint) => {
        calls.push(endpoint.id);
        return result(endpoint);
      },
      onSnapshot: (snapshotValue) => snapshots.push(snapshotValue),
    });

    await expect(engine.pollDue(0)).resolves.not.toBeNull();
    expect(calls).toEqual(["fast", "slow", "once"]);
    clock = 500;
    await expect(engine.pollDue(clock)).resolves.toBeNull();
    clock = 1_000;
    await expect(engine.pollDue(clock)).resolves.not.toBeNull();
    expect(calls).toEqual(["fast", "slow", "once", "fast"]);
    clock = 2_000;
    await expect(engine.pollDue(clock)).resolves.not.toBeNull();
    expect(calls).toEqual(["fast", "slow", "once", "fast", "fast", "slow"]);
    expect(snapshots).toHaveLength(3);
    expect(Object.keys(engine.latestResults)).toEqual(["fast", "slow", "once"]);
  });

  it("serializes concurrent pollDue calls and converts thrown reads to transport errors", async () => {
    let resolveRead: (() => void) | undefined;
    const calls: string[] = [];
    const readPromise = new Promise<void>((resolve) => { resolveRead = resolve; });
    const engine = new PollingEngine({
      adapter,
      endpoints: [endpoints[0]!],
      gateway: null,
      now: () => 0,
      read: async (endpoint) => {
        calls.push(endpoint.id);
        await readPromise;
        throw new Error("offline");
      },
    });

    const first = engine.pollDue(0);
    const second = engine.pollDue(0);
    expect(first).toBe(second);
    resolveRead?.();
    const snapshot = await first;
    expect(snapshot).not.toBeNull();
    expect(calls).toEqual(["fast"]);
    expect(engine.latestResults.fast?.status).toBe("transport-error");
  });
});
