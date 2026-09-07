import type {
  EndpointProbeResult,
  ProbeReport,
  ProbeResultStatus,
} from "@cpehuahua/core";
import { sanitizeHuaweiValue } from "@cpehuahua/core";

export interface ProbeRow {
  id: string;
  label: string;
  url: string;
  status: ProbeResultStatus;
  statusLabel: string;
  httpStatus: string;
  huaweiStatus: string;
  latency: string;
  fields: string[];
  rawXml: string;
  sanitizedResult: string;
}

const STATUS_LABELS: Record<ProbeResultStatus, string> = {
  ok: "成功",
  "http-error": "HTTP 错误",
  "huawei-error": "Huawei 错误",
  "parse-error": "XML 解析错误",
  "transport-error": "传输错误",
  "not-run": "未执行",
};

export function statusLabel(status: ProbeResultStatus): string {
  return STATUS_LABELS[status];
}

export function formatNullable(value: number | string | null, suffix = ""): string {
  if (value === null || value === "") {
    return "—";
  }

  return `${value}${suffix}`;
}

export function displayIdentifier(value: string | null, maxLength = 28): string {
  if (value === null || value === "") {
    return "—";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function huaweiStatus(result: EndpointProbeResult): string {
  if (result.huaweiError !== null) {
    return `${result.huaweiError.code}: ${result.huaweiError.message ?? "未提供消息"}`;
  }

  if (result.transportError !== null) {
    return result.transportError;
  }

  return result.status === "ok" ? "OK" : "—";
}

export function toProbeRows(report: ProbeReport): ProbeRow[] {
  return report.endpointResults.map((result) => {
    const row = {
      id: result.endpoint.id,
      label: result.endpoint.label,
      url: `${report.gateway ?? "<gateway>"}${result.endpoint.path}`,
      status: result.status,
      statusLabel: statusLabel(result.status),
      httpStatus: formatNullable(result.httpStatus),
      huaweiStatus: huaweiStatus(result),
      latency: formatNullable(result.latencyMs, " ms"),
      fields: result.parsedFields,
      rawXml: result.sanitizedRawXml,
    };

    return {
      ...row,
      sanitizedResult: JSON.stringify({
        endpoint: row.id,
        label: row.label,
        url: row.url,
        status: row.status,
        httpStatus: row.httpStatus,
        huaweiStatus: row.huaweiStatus,
        latency: row.latency,
        parsedFields: row.fields,
        rawXml: row.rawXml,
      }, null, 2),
    };
  });
}

/** Build one valid, sanitized JSON document for the complete current Probe run. */
export function sanitizedProbeReport(report: ProbeReport): string {
  return JSON.stringify({
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    adapterId: report.adapterId,
    gateway: report.gateway,
    endpointResults: report.endpointResults.map((result) => ({
      endpoint: result.endpoint,
      status: result.status,
      requestedAt: result.requestedAt,
      completedAt: result.completedAt,
      latencyMs: result.latencyMs,
      httpStatus: result.httpStatus,
      huaweiError: result.huaweiError,
      transportError: result.transportError,
      rawXml: result.sanitizedRawXml,
      sanitizedRawXml: result.sanitizedRawXml,
      parsed: result.parsed === null ? null : {
        ...result.parsed,
        rawXml: result.sanitizedRawXml,
        data: result.parsed.data === null ? null : sanitizeHuaweiValue(result.parsed.data),
        response: sanitizeHuaweiValue(result.parsed.response),
      },
      parsedFields: result.parsedFields,
    })),
  }, null, 2);
}
