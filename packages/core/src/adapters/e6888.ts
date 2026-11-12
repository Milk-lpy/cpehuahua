import type { CpeAdapter, AdapterIdentification, AdapterInput } from "../types/adapter";
import type { CapabilityMatrix } from "../types/model";
import type { ParsedHuaweiXml } from "../types/xml";
import { H168_PROBE_ENDPOINTS } from "../probe/endpoints";
import { H168Adapter } from "./h168";
import { emptyCapabilities } from "./helpers";
import { numberOfHuaweiField, textOfHuaweiField } from "../xml/parser";

const E6888_ENDPOINT_IDS = new Set([
  "device-basic-information",
  "monitoring-status",
  "net-current-plmn",
  "device-signal",
  "device-information",
  "monitoring-traffic-statistics",
  "monitoring-month-statistics",
  "sms-count",
  "monitoring-check-notifications",
  "wlan-host-list",
]);

/**
 * Read endpoints verified on E6888-982 4.0.0.1(H3568SP91C00).
 * Secondary/neighbor endpoints returned 100003 even after a verified login.
 */
export const E6888_PROBE_ENDPOINTS = H168_PROBE_ENDPOINTS
  .filter((endpoint) => E6888_ENDPOINT_IDS.has(endpoint.id))
  .map((endpoint) => ({
    ...endpoint,
    intervalMs: ({
      "monitoring-status": 2_000,
      "net-current-plmn": 60_000,
      "device-signal": 2_000,
      "device-information": 60_000,
      "monitoring-traffic-statistics": 2_000,
      "monitoring-month-statistics": 60_000,
      "sms-count": 10_000,
      "monitoring-check-notifications": 10_000,
      "wlan-host-list": 10_000,
    } as Record<string, number>)[endpoint.id] ?? null,
    evidence: "e6888-live-observed" as const,
  }));

function serializedResponse(input: ParsedHuaweiXml | null): string {
  if (!input || input.parseError || !input.data) return "";
  return JSON.stringify(input.response ?? input.data).toLowerCase();
}

export class E6888Adapter implements CpeAdapter {
  readonly id = "e6888" as const;
  readonly modelNames = ["E6888-982", "Brovi 5G Mobile WiFi Pro 5"] as const;
  readonly probeEndpoints = E6888_PROBE_ENDPOINTS;
  readonly baselineCapabilities: CapabilityMatrix = emptyCapabilities();
  private readonly commonReadNormalizer = new H168Adapter();

  identify(input: ParsedHuaweiXml | null): AdapterIdentification {
    if (serializedResponse(input).includes("e6888-982")) {
      return { matched: true, confidence: "exact", reason: "响应中出现 E6888-982" };
    }
    return { matched: false, confidence: "none", reason: "响应未确认 E6888-982" };
  }

  normalize(input: AdapterInput) {
    // The generic read-field mapping is reused only as a best-effort parser;
    // each missing E6888 field remains null/unknown and must be confirmed live.
    const snapshot = this.commonReadNormalizer.normalize(input);
    const status = input.endpointResults["monitoring-status"];
    const statusDocument = status?.status === "ok" ? status.parsed : null;
    const battery = numberOfHuaweiField(statusDocument, ["BatteryPercent"]);
    snapshot.device.batteryPercent = battery !== null && battery >= 0 && battery <= 100 ? battery : null;
    const usb = textOfHuaweiField(statusDocument, ["usbup"]);
    snapshot.device.usbConnected = usb === "1" ? true : usb === "0" ? false : null;
    const signal = input.endpointResults["device-signal"];
    if (signal?.status === "ok") {
      const data = signal.parsed?.response;
      const arfcn = typeof data?.nrearfcn === "string" ? data.nrearfcn.match(/\bDL:\s*(\d+)/i) : null;
      const band = typeof data?.band === "string" ? data.band.match(/\((N\d+)\)/i) : null;
      if (snapshot.cells.pcc?.technology === "NR") {
        if (arfcn) snapshot.cells.pcc.arfcn = Number(arfcn[1]);
        if (band && !data?.bandInfo) snapshot.cells.pcc.band = band[1]!.toUpperCase();
        const { role: _role, technology: _technology, ...radio } = snapshot.cells.pcc;
        snapshot.radio = radio;
      }
    }
    snapshot.capabilities.secondaryCells = "unsupported";
    snapshot.capabilities.neighbors = "unsupported";
    if (snapshot.device.model === null) snapshot.device.model = "E6888-982";
    return snapshot;
  }
}
