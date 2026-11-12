import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { E6888Adapter } from "./e6888";
import { parseHuaweiXml } from "../xml/parser";
import type { EndpointProbeResult } from "../types/probe";

const adapter = new E6888Adapter();
function result(id: string, rawXml: string): EndpointProbeResult {
  const parsed = parseHuaweiXml(rawXml);
  return { endpoint: adapter.probeEndpoints.find(e => e.id === id)!, status: "ok",
    requestedAt: "2026-11-12T12:00:00Z", completedAt: "2026-11-12T12:00:00Z",
    latencyMs: 1, httpStatus: 200, huaweiError: null, transportError: null,
    rawXml, sanitizedRawXml: rawXml, parsed, parsedFields: parsed.fields };
}
const signal = readFileSync(new URL("../../../../fixtures/e6888/signal-sa.xml", import.meta.url), "utf8");
function snapshot(status = "<BatteryPercent>100</BatteryPercent><usbup>1</usbup>") {
  return adapter.normalize({ timestamp: "2026-11-12T12:00:00Z", source: "live", gateway: "192.168.8.1",
    endpointResults: {
      "device-signal": result("device-signal", signal),
      "monitoring-status": result("monitoring-status", `<response><ConnectionStatus>901</ConnectionStatus>${status}</response>`),
      "device-basic-information": result("device-basic-information", "<response><devicename>E6888-982</devicename></response>"),
    } });
}

describe("live E6888 firmware mapping", () => {
  it("parses separate DL/UL ARFCN and band text without inventing an LTE SCC or RSSI", () => {
    const s = snapshot();
    expect(s.radio.arfcn).toBe(175380);
    expect(s.radio.band).toBe("N5");
    expect(s.radio.bandwidth).toBe("15MHz");
    expect(s.radio.rsrpDbm).toBe(-103);
    expect(s.radio.rssiDbm).toBeNull();
    expect(s.radio.rawEvidence?.txPower).toContain("PPusch:8dBm");
    expect(s.cells.pcc?.technology).toBe("NR");
    expect(s.cells.scells).toEqual([]);
    expect(s.connection.saNsa).toBe("SA");
    expect(s.device.batteryPercent).toBe(100);
    expect(s.device.usbConnected).toBe(true);
  });
  it("preserves empty and zero battery/USB values", () => {
    expect(snapshot("").device.batteryPercent).toBeNull();
    expect(snapshot("").device.usbConnected).toBeNull();
    const s = snapshot("<BatteryPercent>0</BatteryPercent><usbup>0</usbup>");
    expect(s.device.batteryPercent).toBe(0);
    expect(s.device.usbConnected).toBe(false);
  });
  it("does not poll endpoints denied on the verified firmware", () => {
    const ids = adapter.probeEndpoints.map(e => e.id);
    expect(ids).toContain("device-information");
    expect(ids).not.toContain("device-seccellinfo");
    expect(ids).not.toContain("device-nbrcellinfo");
    expect(snapshot().capabilities.neighbors).toBe("unsupported");
    expect(snapshot().capabilities.secondaryCells).toBe("unsupported");
  });
});
