import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { H155Adapter, ReservedAdapterError } from "./h155";
import { H168Adapter } from "./h168";
import { H168_PROBE_ENDPOINTS } from "../probe/endpoints";
import { parseHuaweiXml } from "../xml/parser";
import type { AdapterInput } from "../types/adapter";
import type { EndpointProbeResult } from "../types/probe";

function fixture(name: string): string {
  return readFileSync(new URL(`../../../../fixtures/h168/${name}`, import.meta.url), "utf8");
}

function result(id: string, raw: string, status: EndpointProbeResult["status"] = "ok"): EndpointProbeResult {
  const endpoint = H168_PROBE_ENDPOINTS.find((item) => item.id === id);
  if (!endpoint) throw new Error(`missing endpoint ${id}`);
  const parsed = parseHuaweiXml(raw);
  return {
    endpoint,
    status,
    requestedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:00.001Z",
    latencyMs: 1,
    httpStatus: 200,
    huaweiError: parsed.error,
    transportError: null,
    rawXml: raw,
    sanitizedRawXml: raw,
    parsed,
    parsedFields: parsed.fields,
  };
}

function input(overrides: Partial<AdapterInput> = {}): AdapterInput {
  return {
    timestamp: "2026-09-05T00:00:00.000Z",
    source: "fixture",
    gateway: "192.168.8.1",
    endpointResults: {
      "device-signal": result("device-signal", fixture("signal.xml")),
      "device-basic-information": result("device-basic-information", fixture("basic_information.xml")),
      "net-current-plmn": result("net-current-plmn", fixture("plmn.xml")),
      "device-seccellinfo": result("device-seccellinfo", fixture("seccellinfo.xml")),
      "device-nbrcellinfo": result("device-nbrcellinfo", fixture("nbrcellinfo.xml")),
      "monitoring-status": result("monitoring-status", fixture("status.xml")),
      "monitoring-traffic-statistics": result("monitoring-traffic-statistics", fixture("traffic.xml")),
    },
    ...overrides,
  };
}

describe("H168 adapter", () => {
  it("normalizes reference-shaped NSA data without inventing extended fields", () => {
    const snapshot = new H168Adapter().normalize(input());

    expect(snapshot.connection.radioMode).toBe("5G");
    expect(snapshot.connection.saNsa).toBe("NSA");
    expect(snapshot.connection.internetOnline).toBeNull();
    expect(snapshot.cells.pcc?.technology).toBe("LTE");
    expect(snapshot.cells.pcc?.rsrpDbm).toBe(-91);
    expect(snapshot.cells.scells).toHaveLength(5);
    expect(snapshot.cells.neighbors).toHaveLength(4);
    expect(snapshot.network.downloadBps).toBe(443457 * 8);
    expect(snapshot.extended.temperatureC).toBeNull();
    expect(snapshot.extended.cpuUsagePct).toBeNull();
    expect(snapshot.extended.memoryUsagePct).toBeNull();
    expect(snapshot.extended.qci).toBeNull();
    expect(snapshot.capabilities.signal).toBe("unknown");
    expect(snapshot.capabilities.secondaryCells).toBe("unknown");
    expect(snapshot.capabilities.neighbors).toBe("unknown");
  });

  it("handles SA and LTE-only shapes", () => {
    const sa = new H168Adapter().normalize(input({
      endpointResults: {
        "device-signal": result("device-signal", fixture("signal-sa.xml")),
      },
    }));
    const lte = new H168Adapter().normalize(input({
      endpointResults: {
        "device-signal": result("device-signal", fixture("signal-lte.xml")),
      },
    }));

    expect(sa.connection.saNsa).toBe("SA");
    expect(sa.cells.pcc?.technology).toBe("NR");
    expect(sa.cells.pcc?.band).toBe("n78");
    expect(lte.connection.radioMode).toBe("4G");
    expect(lte.connection.saNsa).toBe("unknown");
    expect(lte.cells.pcc?.technology).toBe("LTE");
  });

  it("accepts the mode 12 SA shape without treating generic PCI as LTE", () => {
    const mode12 = result(
      "device-signal",
      "<response><mode>12</mode><pci>360</pci><cell_id>fixture-mode12</cell_id>"
        + "<bandInfo>N78</bandInfo><nrearfcn>633984</nrearfcn><nrrsrp>-92dBm</nrrsrp>"
        + "<nrsinr>17dB</nrsinr></response>",
    );
    const snapshot = new H168Adapter().normalize(input({ endpointResults: { "device-signal": mode12 } }));

    expect(snapshot.connection.radioMode).toBe("5G");
    expect(snapshot.connection.saNsa).toBe("SA");
    expect(snapshot.cells.pcc?.technology).toBe("NR");
    expect(snapshot.cells.pcc?.pci).toBe(360);
    expect(snapshot.cells.pcc?.band).toBe("N78");
  });

  it("keeps all normalized values null when the endpoint is absent", () => {
    const snapshot = new H168Adapter().normalize(input({ endpointResults: {} }));

    expect(snapshot.cells.pcc).toBeNull();
    expect(snapshot.radio.rsrpDbm).toBeNull();
    expect(snapshot.network.downloadBps).toBeNull();
    expect(snapshot.capabilities.signal).toBe("unknown");
  });

  it("only marks endpoint and advanced capabilities observed for live evidence", () => {
    const snapshot = new H168Adapter().normalize(input({ source: "live" }));

    expect(snapshot.capabilities.signal).toBe("observed");
    expect(snapshot.capabilities.secondaryCells).toBe("observed");
    expect(snapshot.capabilities.neighbors).toBe("observed");
    expect(snapshot.capabilities.cqi).toBe("observed");
    expect(snapshot.capabilities.mcs).toBe("observed");
    expect(snapshot.capabilities.mimoRank).toBe("observed");
    expect(snapshot.capabilities.temperature).toBe("unknown");
  });

  it("does not pretend that H155 is implemented", () => {
    const adapter = new H155Adapter();

    expect(adapter.identify(parseHuaweiXml("<response><model>H155-381</model></response>")).matched).toBe(true);
    expect(() => adapter.normalize(input())).toThrow(ReservedAdapterError);
  });
});
