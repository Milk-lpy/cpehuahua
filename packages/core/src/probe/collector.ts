import type { CpeHttpTransport } from "../types/http";
import type { EndpointProbeResult, ProbeEndpoint, ProbeReport } from "../types/probe";
import { parseHuaweiXml } from "../xml/parser";
import { sanitizeHuaweiXml } from "../xml/sanitize";

function isoNow(): string {
  return new Date().toISOString();
}

function resultStatus(
  httpStatus: number,
  parsedError: boolean,
  parseError: boolean,
): EndpointProbeResult["status"] {
  if (parsedError) return "huawei-error";
  if (parseError) return "parse-error";
  if (httpStatus < 200 || httpStatus >= 300) return "http-error";
  return "ok";
}

/** Sequential read-only endpoint collector for the Probe page. */
export class ProbeCollector {
  private readonly transport: CpeHttpTransport;

  constructor(transport: CpeHttpTransport) {
    this.transport = transport;
  }

  async collect(
    adapterId: "h168" | "h155",
    gateway: string | null,
    endpoints: readonly ProbeEndpoint[],
  ): Promise<ProbeReport> {
    const endpointResults: EndpointProbeResult[] = [];
    for (const endpoint of endpoints.filter((item) => item.defaultEnabled)) {
      endpointResults.push(await this.collectEndpoint(endpoint));
    }
    return {
      schemaVersion: 1,
      generatedAt: isoNow(),
      adapterId,
      gateway,
      endpointResults,
    };
  }

  private async collectEndpoint(endpoint: ProbeEndpoint): Promise<EndpointProbeResult> {
    const requestedAt = isoNow();
    const started = Date.now();
    try {
      const response = await this.transport.request({
        method: "GET",
        path: endpoint.path,
        headers: {},
        body: null,
      });
      const parsed = parseHuaweiXml(response.body);
      const latencyMs = response.durationMs ?? Date.now() - started;
      return {
        endpoint,
        status: resultStatus(response.status, parsed.error !== null, parsed.parseError !== null),
        requestedAt,
        completedAt: isoNow(),
        latencyMs,
        httpStatus: response.status,
        huaweiError: parsed.error,
        transportError: null,
        rawXml: response.body,
        sanitizedRawXml: sanitizeHuaweiXml(response.body),
        parsed,
        parsedFields: parsed.fields,
      };
    } catch (error) {
      return {
        endpoint,
        status: "transport-error",
        requestedAt,
        completedAt: isoNow(),
        latencyMs: Date.now() - started,
        httpStatus: null,
        huaweiError: null,
        transportError: error instanceof Error ? error.message : "Transport request failed",
        rawXml: "",
        sanitizedRawXml: "",
        parsed: null,
        parsedFields: [],
      };
    }
  }
}
