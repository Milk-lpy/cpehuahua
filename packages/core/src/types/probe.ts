import type { CpeHttpResponse } from "./http";
import type { ParsedHuaweiXml, HuaweiError } from "./xml";

export type ProbeEvidence =
  | "h168-live-observed"
  | "h168-reference-claimed"
  | "reference-shape"
  | "login-protocol"
  | "candidate";

export interface ProbeEndpoint {
  id: string;
  label: string;
  path: string;
  intervalMs: number | null;
  requiresAuth: boolean;
  defaultEnabled: boolean;
  evidence: ProbeEvidence;
}

export type ProbeResultStatus =
  | "ok"
  | "http-error"
  | "huawei-error"
  | "parse-error"
  | "transport-error"
  | "not-run";

export interface EndpointProbeResult {
  endpoint: ProbeEndpoint;
  status: ProbeResultStatus;
  requestedAt: string;
  completedAt: string;
  latencyMs: number | null;
  httpStatus: number | null;
  huaweiError: HuaweiError | null;
  transportError: string | null;
  /** Local-only evidence; never send this property to a remote server. */
  rawXml: string;
  /** Safe default for UI display and user feedback. */
  sanitizedRawXml: string;
  parsed: ParsedHuaweiXml | null;
  parsedFields: string[];
}

export interface ProbeReport {
  schemaVersion: 1;
  generatedAt: string;
  adapterId: "h168" | "h155";
  gateway: string | null;
  endpointResults: EndpointProbeResult[];
}

export interface ProbeRequestResult {
  response: CpeHttpResponse | null;
  transportError: string | null;
}
