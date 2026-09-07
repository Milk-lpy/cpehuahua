import { describe, expect, it } from "vitest";
import type { CpeCell, CpeSnapshot } from "../types/model";
import { carrierAggregationLabel, distinctServingCells, isSameCarrierIdentity } from "./cells";

const pcc: CpeCell = {
  role: "pcc", technology: "NR", band: "100MHz@627264(N78)", arfcn: 627264, pci: 521,
  rsrpDbm: -78, rsrqDb: -10, sinrDb: 20, rssiDbm: -55, cellId: null, tac: null,
  bandwidth: "100MHz", rrcStatus: "1", cqi: 8, mimoRank: 3, dlMcs: 0, ulMcs: 24,
  blerPct: 0, txPowerDbm: 16,
};

function snapshot(scells: CpeCell[]): CpeSnapshot {
  const { role: _role, technology: _technology, ...radio } = pcc;
  return {
    schemaVersion: 1, timestamp: "2026-09-07T00:00:00.000Z", source: "fixture",
    device: { model: null, productName: null, hardwareVersion: null, firmware: null, webUiVersion: null, parameterVersion: null, uptimeSeconds: null },
    connection: { cellularOnline: true, internetOnline: null, radioMode: "5G", saNsa: "SA", plmn: null, operatorName: null, cellularStatusCode: "901" },
    radio,
    cells: { pcc, scells, neighbors: [] },
    network: { pingMs: null, jitterMs: null, packetLossPct: null, downloadBps: null, uploadBps: null, currentDownloadBytes: null, currentUploadBytes: null, totalDownloadBytes: null, totalUploadBytes: null, currentConnectSeconds: null, totalConnectSeconds: null, monthDownloadBytes: null, monthUploadBytes: null, monthDurationSeconds: null, monthLastClearDate: null, dayUsedBytes: null, dayDurationSeconds: null },
    clients: [],
    messaging: { unread: null, inbox: null, outbox: null, draft: null, deleted: null, capacity: null, simUnread: null, simInbox: null, simUsed: null, simCapacity: null, newMessages: null, storageFull: null },
    extended: { temperatureC: null, fanRpm: null, cpuUsagePct: null, memoryUsagePct: null, qci: null, fiveQi: null, dlAmbr: null, ulAmbr: null },
    capabilities: { signal: "observed", secondaryCells: "observed", neighbors: "unknown", traffic: "unknown", monthlyTraffic: "unknown", clients: "unknown", sms: "unknown", temperature: "unknown", fan: "unknown", qci: "unknown", fiveQi: "unknown", ambr: "unknown", cpu: "unknown", memory: "unknown", mcs: "observed", cqi: "observed", mimoRank: "observed", bler: "observed", txPower: "observed" },
  };
}

describe("serving cell presentation", () => {
  it("recognizes a device-reported SCell that mirrors the PCC", () => {
    const mirror = { ...pcc, role: "scell" as const, rsrpDbm: -79 };
    expect(isSameCarrierIdentity(pcc, mirror)).toBe(true);
    expect(distinctServingCells(snapshot([mirror]))).toHaveLength(1);
    expect(carrierAggregationLabel(snapshot([mirror]))).toBe("100MHz@627264(N78)");
  });

  it("retains a genuinely distinct secondary carrier", () => {
    const secondary = { ...pcc, role: "scell" as const, band: "40MHz@428910(N1)", arfcn: 428910, pci: 785 };
    expect(distinctServingCells(snapshot([secondary]))).toHaveLength(2);
    expect(carrierAggregationLabel(snapshot([secondary]))).toBe("100MHz@627264(N78) + 40MHz@428910(N1)");
  });
});
