import { describe, expect, it } from "vitest";
import type { CpeEvent, CpeSnapshot } from "@cpehuahua/core";
import {
  aggregationLabel,
  chartPoints,
  eventContextEntries,
  eventDetail,
  eventGroupLabel,
  eventObservationWindow,
  eventTone,
  eventToneLabel,
  eventTransition,
  formatDuration,
  formatMetric,
  groupTimelineEvents,
  samplingIntervalMs,
} from "./view-model";

function snapshot(second: number, sinrDb: number | null): CpeSnapshot {
  const cell = {
    role: "pcc" as const,
    technology: "NR" as const,
    rsrpDbm: -90,
    rsrqDb: -10,
    sinrDb,
    rssiDbm: null,
    pci: 187,
    cellId: "long-cell-id-that-must-remain-a-string",
    tac: null,
    band: "n78",
    arfcn: 643660,
    bandwidth: null,
    rrcStatus: null,
    cqi: null,
    mimoRank: null,
    dlMcs: null,
    ulMcs: null,
    blerPct: null,
    txPowerDbm: null,
  };
  const { role: _role, technology: _technology, ...radio } = cell;
  return {
    schemaVersion: 1,
    timestamp: `2026-09-05T00:00:${String(second).padStart(2, "0")}.000Z`,
    source: "fixture",
    device: {
      model: "fixture", productName: null, hardwareVersion: null, firmware: null,
      webUiVersion: null, parameterVersion: null, uptimeSeconds: null,
    },
    connection: {
      cellularOnline: true,
      internetOnline: null,
      radioMode: "5G",
      saNsa: "SA",
      plmn: null,
      operatorName: null,
      cellularStatusCode: "901",
    },
    radio,
    cells: {
      pcc: cell,
      scells: [
        { ...cell, role: "scell", band: "n1" },
        { ...cell, role: "scell", band: "n78" },
      ],
      neighbors: [],
    },
    network: {
      pingMs: 31,
      jitterMs: null,
      packetLossPct: 0,
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

describe("dashboard view model", () => {
  it("shows dynamic PCC and SCell composition without a fixed cell count", () => {
    expect(aggregationLabel(snapshot(0, 18))).toBe("n78 + n1");
  });

  it("keeps null chart samples as gaps", () => {
    const points = chartPoints([snapshot(0, 18), snapshot(1, null), snapshot(2, 3)], "sinrDb");
    expect(points.map((point) => point.index)).toEqual([0, 2]);
    expect(formatMetric(null, "dB")).toBe("—");
  });

  it("formats outage duration explicitly", () => {
    expect(formatDuration(17_000)).toBe("17.0 秒");
  });

  it("assigns event tones without changing event semantics", () => {
    expect(eventTone("INTERNET_DOWN")).toBe("danger");
    expect(eventTone("INTERNET_UP")).toBe("success");
    expect(eventTone("PACKET_LOSS_RECOVERED")).toBe("success");
    expect(eventTone("SINR_RECOVERED")).toBe("success");
    expect(eventTone("LOW_SINR")).toBe("warning");
    expect(eventTone("BAND_CHANGED")).toBe("info");
  });

  it("exposes detailed device-log context from an existing event", () => {
    const entries = eventContextEntries({
      timestamp: "2026-09-05T00:00:01.000Z",
      type: "BAND_CHANGED",
      oldValue: "N78",
      newValue: "N41",
      context: {
        band: "N41",
        pci: 160,
        cellId: "cell-1",
        radioMode: "5G",
        saNsa: "SA",
        plmn: "46011",
      },
      durationMs: null,
    });
    expect(entries).toEqual(expect.arrayContaining([
      { label: "网络制式", value: "5G / SA" },
      { label: "蜂窝连接", value: "未验证" },
      { label: "Internet", value: "未验证" },
      { label: "PLMN", value: "46011" },
      { label: "频段", value: "N41" },
      { label: "PCI", value: "160" },
      { label: "Cell ID", value: "cell-1" },
    ]));
    expect(eventGroupLabel("BAND_CHANGED")).toBe("无线参数");
    expect(eventToneLabel("BAND_CHANGED")).toBe("记录");
  });

  it("expresses event time as an observation window instead of a fabricated exact switch time", () => {
    const item: CpeEvent = {
      timestamp: "2026-09-05T00:00:02.250Z",
      previousTimestamp: "2026-09-05T00:00:01.000Z",
      type: "SINR_RECOVERED",
      oldValue: 3,
      newValue: 9,
      context: { source: "live", sinrDb: 9 },
      previousContext: { source: "live", sinrDb: 3 },
      durationMs: 5_000,
    };
    expect(eventObservationWindow(item).durationMs).toBe(1_250);
    expect(eventTransition(item)).toEqual({ before: "3 dB", after: "9 dB" });
    expect(eventDetail(item)).toContain("异常持续 5.0 秒");
    expect(eventContextEntries(item, "previous")).toContainEqual({ label: "SINR", value: "3 dB" });
  });

  it("groups simultaneous changes into one newest-first timeline observation", () => {
    const base: CpeEvent = {
      timestamp: "2026-09-05T00:00:02.000Z",
      previousTimestamp: "2026-09-05T00:00:01.000Z",
      type: "BAND_CHANGED",
      oldValue: "N78",
      newValue: "N41",
      context: {},
      previousContext: {},
      durationMs: null,
    };
    const groups = groupTimelineEvents([
      base,
      { ...base, type: "PCI_CHANGED", oldValue: 1, newValue: 2 },
      { ...base, timestamp: "2026-09-05T00:00:03.000Z", previousTimestamp: base.timestamp, type: "LOW_SINR", oldValue: 9, newValue: 3 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.timestamp).toBe("2026-09-05T00:00:03.000Z");
    expect(groups[1]?.events).toHaveLength(2);
  });

  it("uses the median of recent positive snapshot intervals", () => {
    expect(samplingIntervalMs([snapshot(0, 10), snapshot(1, 10), snapshot(4, 10)])).toBe(2_000);
  });
});
