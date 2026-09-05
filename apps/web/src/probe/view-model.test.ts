import { describe, expect, it } from "vitest";
import type { ProbeReport } from "@cpehuahua/core";
import { displayIdentifier, formatNullable, statusLabel, toProbeRows } from "./view-model";

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
          sanitizedRawXml: "<response><imei>[REDACTED]</imei></response>",
          parsed: null,
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
});
