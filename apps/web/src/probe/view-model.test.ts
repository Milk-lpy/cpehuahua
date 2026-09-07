import { describe, expect, it } from "vitest";
import type { ProbeReport } from "@cpehuahua/core";
import {
  displayIdentifier,
  formatNullable,
  sanitizedProbeReport,
  statusLabel,
  toProbeRows,
} from "./view-model";

describe("probe view model", () => {
  it("renders missing values without inventing zeroes", () => {
    expect(formatNullable(null)).toBe("—");
    expect(formatNullable(0, " ms")).toBe("0 ms");
    expect(formatNullable("", " dBm")).toBe("—");
  });

  it("keeps long identifiers safe for a compact card", () => {
    const value = displayIdentifier("123456789012345678901234567890123456", 12);

    expect(value).toHaveLength(12);
    expect(value.endsWith("…")).toBe(true);
  });

  it("labels offline and unsupported-like probe outcomes", () => {
    expect(statusLabel("transport-error")).toBe("传输错误");
    expect(statusLabel("not-run")).toBe("未执行");
  });

  it("uses sanitized XML and preserves the parsed field list", () => {
    const report: ProbeReport = {
      schemaVersion: 1,
      generatedAt: "2026-09-05T00:00:00.000Z",
      adapterId: "h168",
      gateway: "192.168.8.1",
      endpointResults: [
        {
          endpoint: {
            id: "device-signal",
            label: "Signal",
            path: "/api/device/signal",
            intervalMs: 1000,
            requiresAuth: true,
            defaultEnabled: true,
            evidence: "h168-reference-claimed",
          },
          status: "ok",
          requestedAt: "2026-09-05T00:00:00.000Z",
          completedAt: "2026-09-05T00:00:00.010Z",
          latencyMs: 10,
          httpStatus: 200,
          huaweiError: null,
          transportError: null,
          rawXml: "<response><imei>secret</imei></response>",
          sanitizedRawXml: "<response><imei>secret</imei></response>",
          parsed: {
            rawXml: "<response><imei>secret</imei></response>",
            rootName: "response",
            data: null,
            response: { imei: "secret", signal: "-91" },
            fields: ["response.imei", "response.signal"],
            error: null,
            parseError: null,
          },
          parsedFields: ["response.imei"],
        },
      ],
    };

    const [row] = toProbeRows(report);

    expect(row?.url).toBe("192.168.8.1/api/device/signal");
    expect(row?.rawXml).toContain("[REDACTED]");
    expect(row?.fields).toEqual(["response.imei"]);
    expect(row?.sanitizedResult).not.toContain("secret");
    expect(row?.sanitizedResult).toContain("[REDACTED]");
  });

  it("copies the complete run as one sanitized JSON document", () => {
    const report: ProbeReport = {
      schemaVersion: 1,
      generatedAt: "2026-09-07T00:00:00.000Z",
      adapterId: "h168",
      gateway: "192.168.8.1",
      endpointResults: [
        {
          endpoint: {
            id: "device-basic-information",
            label: "Device basic information",
            path: "/api/device/basic_information",
            intervalMs: null,
            requiresAuth: false,
            defaultEnabled: true,
            evidence: "h168-reference-claimed",
          },
          status: "ok",
          requestedAt: "2026-09-07T00:00:00.000Z",
          completedAt: "2026-09-07T00:00:00.010Z",
          latencyMs: 10,
          httpStatus: 200,
          huaweiError: null,
          transportError: null,
          rawXml: "<response><imei>secret</imei></response>",
          sanitizedRawXml: "<response><imei>[REDACTED]</imei></response>",
          parsed: {
            rawXml: "<response><imei>secret</imei></response>",
            rootName: "response",
            data: null,
            response: { imei: "secret", signal: "-91" },
            fields: ["response.imei", "response.signal"],
            error: null,
            parseError: null,
          },
          parsedFields: ["response.imei"],
        },
      ],
    };

    const copied = JSON.parse(sanitizedProbeReport(report)) as {
      endpointResults: Array<{
        endpoint: { id: string };
        requestedAt: string;
        latencyMs: number;
        rawXml: string;
        parsed: { rawXml: string; response: { imei: string } };
      }>;
    };

    expect(copied.endpointResults).toHaveLength(1);
    expect(copied.endpointResults[0]?.endpoint.id).toBe("device-basic-information");
    expect(copied.endpointResults[0]?.requestedAt).toBe("2026-09-07T00:00:00.000Z");
    expect(copied.endpointResults[0]?.latencyMs).toBe(10);
    expect(copied.endpointResults[0]?.rawXml).toContain("[REDACTED]");
    expect(copied.endpointResults[0]?.parsed.rawXml).toContain("[REDACTED]");
    expect(copied.endpointResults[0]?.parsed.response.imei).toBe("[REDACTED]");
    expect(sanitizedProbeReport(report)).not.toContain("secret");
  });
});
