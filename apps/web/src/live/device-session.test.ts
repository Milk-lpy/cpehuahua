import { describe, expect, it } from "vitest";
import type { CpeAdapter, CpeSnapshot, EndpointProbeResult, ProbeEndpoint } from "@cpehuahua/core";
import { DevicePollingSession } from "./device-session";

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
];

function snapshot(timestamp: string): CpeSnapshot {
  return {
    schemaVersion: 1,
    timestamp,
    source: "live",
    device: { model: "fixture", firmware: null, uptimeSeconds: null },
    connection: { cellularOnline: true, internetOnline: null, radioMode: "unknown", saNsa: "unknown", plmn: null },
    radio: {
      rsrpDbm: null, rsrqDb: null, sinrDb: null, rssiDbm: null, pci: null, cellId: null,
      tac: null, band: null, arfcn: null, cqi: null, mimoRank: null, dlMcs: null,
      ulMcs: null, blerPct: null, txPowerDbm: null,
    },
    cells: { pcc: null, scells: [], neighbors: [] },
    network: { pingMs: null, jitterMs: null, packetLossPct: null, downloadBps: null, uploadBps: null },
    extended: {
      temperatureC: null, fanRpm: null, cpuUsagePct: null, memoryUsagePct: null,
      qci: null, fiveQi: null, dlAmbr: null, ulAmbr: null,
    },
    capabilities: {
      signal: "unknown", secondaryCells: "unknown", neighbors: "unknown", traffic: "unknown",
      temperature: "unknown", fan: "unknown", qci: "unknown", fiveQi: "unknown", ambr: "unknown",
      cpu: "unknown", memory: "unknown", mcs: "unknown", cqi: "unknown", mimoRank: "unknown",
      bler: "unknown", txPower: "unknown",
    },
  };
}

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

describe("DevicePollingSession", () => {
  it("reports endpoint failures instead of silently producing an empty snapshot", async () => {
    const failures: EndpointProbeResult[] = [];
    const failingEndpoint: ProbeEndpoint = { ...endpoints[0]!, id: "device-signal", label: "Signal" };
    const session = new DevicePollingSession(async (endpoint) => ({
      ...result(endpoint),
      status: "transport-error",
      httpStatus: null,
      transportError: "需要 H168 管理密码",
      rawXml: "",
      sanitizedRawXml: "",
      parsed: null,
      parsedFields: [],
    }), {
      adapter: {
        id: "h168",
        modelNames: ["fixture"],
        probeEndpoints: [failingEndpoint],
        baselineCapabilities: {} as CpeAdapter["baselineCapabilities"],
        identify: () => ({ matched: true, confidence: "possible", reason: "test" }),
        normalize: (input) => snapshot(new Date(input.timestamp).toISOString()),
      },
      endpoints: [failingEndpoint],
      onEndpointResult: (failure) => failures.push(failure),
    });

    await session.pollNow();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.status).toBe("transport-error");
    expect(failures[0]?.transportError).toBe("需要 H168 管理密码");
  });

  it("uses the core scheduler and wraps normalized snapshots", async () => {
    let clock = 0;
    let sequence = 0;
    const adapter: CpeAdapter = {
      id: "h168",
      modelNames: ["fixture"],
      probeEndpoints: endpoints,
      baselineCapabilities: {} as CpeAdapter["baselineCapabilities"],
      identify: () => ({ matched: true, confidence: "possible", reason: "test" }),
      normalize: (input) => snapshot(new Date(input.timestamp).toISOString()),
    };
    const updates: string[] = [];
    const session = new DevicePollingSession(async (endpoint) => {
      sequence += 1;
      return result(endpoint);
    }, {
      adapter,
      endpoints,
      gateway: "192.168.8.1",
      now: () => clock,
      onUpdate: (report) => updates.push(report.snapshot.timestamp),
    });

    await session.pollNow();
    clock = 500;
    await session.pollNow();
    clock = 1_000;
    await session.pollNow();

    expect(sequence).toBe(2);
    expect(updates).toHaveLength(2);
    expect(session.latestReport?.history).toHaveLength(2);
    expect(session.latestReport?.gateway).toBe("192.168.8.1");
  });

  it("applies delayed user-path samples without adding duplicate radio history", async () => {
    let resolveProbe: ((sample: { timestamp: string; success: boolean; latencyMs: number | null }) => void) | undefined;
    const networkProbe = new Promise<{ timestamp: string; success: boolean; latencyMs: number | null }>((resolve) => {
      resolveProbe = resolve;
    });
    const updates: CpeSnapshot[] = [];
    const withUpdates = new DevicePollingSession(async (endpoint) => result(endpoint), {
      adapter: {
        id: "h168",
        modelNames: ["fixture"],
        probeEndpoints: endpoints,
        baselineCapabilities: {} as CpeAdapter["baselineCapabilities"],
        identify: () => ({ matched: true, confidence: "possible", reason: "test" }),
        normalize: (input) => snapshot(new Date(input.timestamp).toISOString()),
      },
      endpoints,
      gateway: "192.168.8.1",
      networkProbe: () => networkProbe,
      onUpdate: (report) => updates.push(report.snapshot),
    });

    await withUpdates.pollNow();
    resolveProbe?.({ timestamp: "2026-09-05T00:00:00.100Z", success: true, latencyMs: 31 });
    await Promise.resolve();
    await Promise.resolve();

    expect(updates.at(-1)?.network.pingMs).toBe(31);
    expect(updates.at(-1)?.connection.internetOnline).toBeNull();
    expect(withUpdates.latestReport?.history).toHaveLength(1);
  });
});
