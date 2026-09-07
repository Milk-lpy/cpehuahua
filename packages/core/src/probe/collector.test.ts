import { describe, expect, it } from "vitest";
import type { CpeHttpRequest, CpeHttpResponse, CpeHttpTransport } from "../types/http";
import { ProbeCollector } from "./collector";
import { H168_PROBE_ENDPOINTS } from "./endpoints";

class FakeProbeTransport implements CpeHttpTransport {
  readonly requests: CpeHttpRequest[] = [];

  async request(request: CpeHttpRequest): Promise<CpeHttpResponse> {
    this.requests.push(request);
    if (request.path.endsWith("/status")) {
      return { status: 200, headers: {}, body: "<response><IMEI>123</IMEI><status>up</status></response>", durationMs: 4 };
    }
    if (request.path.endsWith("/signal")) {
      return { status: 200, headers: {}, body: "<error><code>125003</code><message>session</message></error>", durationMs: 5 };
    }
    throw new Error("fixture transport unavailable");
  }
}

describe("Probe collector", () => {
  it("requires a bound session before reading monitoring status on H168", () => {
    const status = H168_PROBE_ENDPOINTS.find((item) => item.id === "monitoring-status");
    const basic = H168_PROBE_ENDPOINTS.find((item) => item.id === "device-basic-information");

    expect(basic?.requiresAuth).toBe(false);
    expect(status?.requiresAuth).toBe(true);
  });

  it("records raw XML, Huawei errors, keys, latency and a sanitized copy", async () => {
    const transport = new FakeProbeTransport();
    const endpoints = H168_PROBE_ENDPOINTS.filter((item) => ["monitoring-status", "device-signal"].includes(item.id));
    const report = await new ProbeCollector(transport).collect("h168", "192.168.8.1", endpoints);
    const status = report.endpointResults.find((item) => item.endpoint.id === "monitoring-status");
    const signal = report.endpointResults.find((item) => item.endpoint.id === "device-signal");

    expect(report.endpointResults).toHaveLength(2);
    expect(status?.rawXml).toContain("123");
    expect(status?.sanitizedRawXml).not.toContain("123");
    expect(status?.parsedFields).toContain("response.status");
    expect(status?.latencyMs).toBe(4);
    expect(signal?.status).toBe("huawei-error");
    expect(signal?.huaweiError?.code).toBe(125003);
  });

  it("keeps transport failures separate from Huawei errors", async () => {
    const transport = new FakeProbeTransport();
    const endpoint = H168_PROBE_ENDPOINTS.find((item) => item.id === "net-current-plmn");
    if (!endpoint) throw new Error("missing PLMN endpoint");
    const report = await new ProbeCollector(transport).collect("h168", null, [endpoint]);

    expect(report.endpointResults[0]?.status).toBe("transport-error");
    expect(report.endpointResults[0]?.httpStatus).toBeNull();
    expect(report.endpointResults[0]?.rawXml).toBe("");
  });
});
