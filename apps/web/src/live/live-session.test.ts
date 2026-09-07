import { describe, expect, it } from "vitest";
import type { CpeLiveReport, CpeSnapshot } from "@cpehuahua/core";
import { LivePollingSession } from "./live-session";

function snapshot(second: number, internetOnline: boolean): CpeSnapshot {
  return {
    schemaVersion: 1,
    timestamp: `2026-09-05T00:00:${String(second).padStart(2, "0")}.000Z`,
    source: "live",
    device: { model: "H168-383", firmware: null, uptimeSeconds: null },
    connection: {
      cellularOnline: true,
      internetOnline,
      radioMode: "5G",
      saNsa: "SA",
      plmn: null,
    },
    radio: {
      rsrpDbm: -90,
      rsrqDb: -10,
      sinrDb: 20,
      rssiDbm: null,
      pci: 187,
      cellId: "cell-a",
      tac: null,
      band: "n78",
      arfcn: null,
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
    network: {
      pingMs: 30,
      jitterMs: null,
      packetLossPct: 0,
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
    capabilities: {
      signal: "unknown",
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
}

function report(value: CpeSnapshot): CpeLiveReport {
  return {
    schemaVersion: 1,
    generatedAt: value.timestamp,
    adapterId: "h168",
    gateway: "192.168.8.1",
    snapshot: value,
    history: [],
    events: [],
  };
}

describe("LivePollingSession", () => {
  it("centralizes snapshots, retains a short history and delegates events", async () => {
    const values = [report(snapshot(0, true)), report(snapshot(1, false)), report(snapshot(5, true))];
    const updates: CpeLiveReport[] = [];
    const session = new LivePollingSession(async () => values.shift()!, {
      historySize: 2,
      onUpdate: (update) => updates.push(update),
    });

    await session.pollNow();
    await session.pollNow();
    const latest = await session.pollNow();

    expect(latest?.history).toHaveLength(2);
    expect(latest?.events.map((item) => item.type)).toEqual(["INTERNET_DOWN", "INTERNET_UP"]);
    expect(updates).toHaveLength(3);
  });

  it("does not overlap reads", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    const session = new LivePollingSession(async () => {
      reads += 1;
      await gate;
      return report(snapshot(0, true));
    });

    const first = session.pollNow();
    const second = session.pollNow();
    expect(first).toBe(second);
    release?.();
    await first;
    expect(reads).toBe(1);
  });
});
