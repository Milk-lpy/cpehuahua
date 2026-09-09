import { describe, expect, it } from "vitest";
import type { CpeSnapshot } from "../types/model";
import { EventEngine } from "./engine";

function snapshot(
  second: number,
  overrides: Partial<CpeSnapshot["connection"]> & {
    cellId?: string | null;
    pci?: number | null;
    band?: string | null;
    sinrDb?: number | null;
    packetLossPct?: number | null;
    pccTechnology?: "LTE" | "NR";
    pccBand?: string | null;
    scellBands?: Array<string | null>;
  } = {},
): CpeSnapshot {
  const pccBand = overrides.pccBand === undefined ? (overrides.band ?? "n78") : overrides.pccBand;
  const pcc = pccBand === null && overrides.pci === null && overrides.cellId === null
    ? null
    : {
        role: "pcc" as const,
        technology: overrides.pccTechnology ?? "NR",
        rsrpDbm: -90,
        rsrqDb: -10,
        sinrDb: overrides.sinrDb ?? 18,
        rssiDbm: null,
        pci: overrides.pci ?? 187,
        cellId: overrides.cellId ?? "cell-a",
        tac: null,
        band: pccBand,
        arfcn: null,
        bandwidth: null,
        rrcStatus: null,
        cqi: null,
        mimoRank: null,
        dlMcs: null,
        ulMcs: null,
        blerPct: null,
        txPowerDbm: null,
      };
  const scells = (overrides.scellBands ?? ["n78"]).map((band, index) => ({
    role: "scell" as const,
    technology: band?.startsWith("n") ? ("NR" as const) : ("LTE" as const),
    rsrpDbm: -95,
    rsrqDb: -11,
    sinrDb: 8,
    rssiDbm: null,
    pci: 223 + index,
    cellId: null,
    tac: null,
    band,
    arfcn: null,
    bandwidth: null,
    rrcStatus: null,
    cqi: null,
    mimoRank: null,
    dlMcs: null,
    ulMcs: null,
    blerPct: null,
    txPowerDbm: null,
  }));

  return {
    schemaVersion: 1,
    timestamp: `2026-09-05T00:00:${String(second).padStart(2, "0")}.000Z`,
    source: "fixture",
    device: {
      model: "fixture",
      productName: null,
      hardwareVersion: null,
      firmware: "fixture",
      webUiVersion: null,
      parameterVersion: null,
      uptimeSeconds: null,
    },
    connection: {
      cellularOnline: overrides.cellularOnline === undefined ? true : overrides.cellularOnline,
      internetOnline: overrides.internetOnline === undefined ? true : overrides.internetOnline,
      radioMode: overrides.radioMode ?? "5G",
      saNsa: overrides.saNsa ?? "SA",
      plmn: "46000",
      operatorName: null,
      cellularStatusCode: "901",
    },
    radio: {
      rsrpDbm: -90,
      rsrqDb: -10,
      sinrDb: overrides.sinrDb ?? 18,
      rssiDbm: null,
      pci: overrides.pci ?? 187,
      cellId: overrides.cellId ?? "cell-a",
      tac: null,
      band: overrides.band ?? "n78",
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
    cells: { pcc, scells, neighbors: [] },
    network: {
      pingMs: 30,
      jitterMs: 2,
      packetLossPct: overrides.packetLossPct ?? 0,
      downloadBps: null,
      uploadBps: null,
      currentDownloadBytes: null, currentUploadBytes: null, totalDownloadBytes: null,
      totalUploadBytes: null, currentConnectSeconds: null, totalConnectSeconds: null,
      monthDownloadBytes: null, monthUploadBytes: null, monthDurationSeconds: null,
      monthLastClearDate: null, dayUsedBytes: null, dayDurationSeconds: null,
    },
    clients: [],
    messaging: { unread: null, inbox: null, outbox: null, draft: null, deleted: null, capacity: null, simUnread: null, simInbox: null, simUsed: null, simCapacity: null, newMessages: null, storageFull: null },
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
      monthlyTraffic: "unknown",
      clients: "unknown",
      sms: "unknown",
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

describe("EventEngine", () => {
  it("detects serving cell, PCI, band, CA and NR transitions", () => {
    const engine = new EventEngine();
    engine.ingest(snapshot(0));
    const changed = engine.ingest(snapshot(1, {
      cellId: "cell-b",
      pci: 242,
      band: "B5",
      pccBand: "B5",
      pccTechnology: "LTE",
      scellBands: [],
      radioMode: "4G",
      saNsa: "unknown",
    }));

    expect(changed.map((item) => item.type)).toEqual([
      "CELL_CHANGED",
      "PCI_CHANGED",
      "BAND_CHANGED",
      "CA_CHANGED",
      "NR_LOST",
    ]);
    expect(changed.find((item) => item.type === "CA_CHANGED")?.oldValue).toBe("PCC N78 · PCI 187 + SCC N78 · PCI 223");
    expect(changed.find((item) => item.type === "CA_CHANGED")?.newValue).toBe("PCC B5 · PCI 242");
    expect(changed[0]?.previousTimestamp).toBe("2026-09-05T00:00:00.000Z");
    expect(changed[0]?.previousContext?.cellId).toBe("cell-a");
    expect(changed[0]?.context.cellId).toBe("cell-b");

    const restored = engine.ingest(snapshot(2, {
      cellId: "cell-b",
      pci: 242,
      band: "n78",
      pccBand: "n78",
      pccTechnology: "NR",
      scellBands: ["n1"],
      radioMode: "5G",
      saNsa: "SA",
    }));
    expect(restored.map((item) => item.type)).toContain("NR_RESTORED");
  });

  it("tracks Cellular and Internet outages with durations", () => {
    const engine = new EventEngine();
    engine.ingest(snapshot(0));
    const down = engine.ingest(snapshot(1, { cellularOnline: false, internetOnline: false }));
    const up = engine.ingest(snapshot(5, { cellularOnline: true, internetOnline: true }));

    expect(down.map((item) => item.type)).toEqual(["CELLULAR_DOWN", "INTERNET_DOWN"]);
    expect(up.find((item) => item.type === "CELLULAR_UP")?.durationMs).toBe(4_000);
    expect(up.find((item) => item.type === "INTERNET_UP")?.durationMs).toBe(4_000);
  });

  it("emits threshold alerts once per excursion", () => {
    const engine = new EventEngine({ highPacketLossPct: 20, lowSinrDb: 5 });
    engine.ingest(snapshot(0));
    const first = engine.ingest(snapshot(1, { packetLossPct: 25, sinrDb: 3 }));
    const repeated = engine.ingest(snapshot(2, { packetLossPct: 30, sinrDb: 2 }));
    const recovered = engine.ingest(snapshot(3, { packetLossPct: 0, sinrDb: 15 }));

    expect(first.map((item) => item.type)).toEqual(["HIGH_PACKET_LOSS", "LOW_SINR"]);
    expect(repeated).toEqual([]);
    expect(recovered.map((item) => item.type)).toEqual(["PACKET_LOSS_RECOVERED", "SINR_RECOVERED"]);
    expect(recovered.every((item) => item.durationMs === 2_000)).toBe(true);
  });
});
