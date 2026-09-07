import { describe, expect, it } from "vitest";
import { H168_PROBE_ENDPOINTS, type EndpointProbeResult, type ProbeReport } from "@cpehuahua/core";
import { parseHuaweiXml } from "@cpehuahua/core";
import { liveReportFromProbe } from "./probe-live";

function result(id: string, rawXml: string): EndpointProbeResult {
  const endpoint = H168_PROBE_ENDPOINTS.find((item) => item.id === id);
  if (!endpoint) throw new Error(`missing endpoint ${id}`);
  const parsed = parseHuaweiXml(rawXml);
  return {
    endpoint,
    status: "ok",
    requestedAt: "2026-09-07T00:00:00.000Z",
    completedAt: "2026-09-07T00:00:00.001Z",
    latencyMs: 1,
    httpStatus: 200,
    huaweiError: null,
    transportError: null,
    rawXml,
    sanitizedRawXml: rawXml,
    parsed,
    parsedFields: parsed.fields,
  };
}

describe("liveReportFromProbe", () => {
  it("seeds the dashboard from an observed H168 Probe without filling unknown fields", () => {
    const report: ProbeReport = {
      schemaVersion: 1,
      generatedAt: "2026-09-07T00:00:00.000Z",
      adapterId: "h168",
      gateway: "192.168.8.1",
      endpointResults: [
        result("device-basic-information", "<response><devicename>H168-383</devicename></response>"),
        result(
          "device-signal",
          "<response><mode>12</mode><pci>521</pci><cell_id>sample-cell</cell_id>"
            + "<bandInfo>N78</bandInfo><nrearfcn>627264</nrearfcn><nrrsrp>-78dBm</nrrsrp>"
            + "<nrsinr>20dB</nrsinr><nrrsrq>-10dB</nrrsrq><nrcqi0>8</nrcqi0>"
            + "<nrrank>3</nrrank><nrbler>0</nrbler><nrdlmcs>carrier expression</nrdlmcs>"
            + "</response>",
        ),
      ],
    };

    const live = liveReportFromProbe(report);

    expect(live?.snapshot.source).toBe("live");
    expect(live?.snapshot.device.model).toBe("H168-383");
    expect(live?.snapshot.cells.pcc?.pci).toBe(521);
    expect(live?.snapshot.radio.rsrpDbm).toBe(-78);
    expect(live?.snapshot.radio.dlMcs).toBeNull();
    expect(live?.snapshot.radio.rawEvidence?.dlMcs).toBe("carrier expression");
    expect(live?.snapshot.extended.temperatureC).toBeNull();
  });

  it("does not seed a future adapter from an H155 report", () => {
    expect(liveReportFromProbe({
      schemaVersion: 1,
      generatedAt: "2026-09-07T00:00:00.000Z",
      adapterId: "h155",
      gateway: null,
      endpointResults: [],
    })).toBeNull();
  });
});
