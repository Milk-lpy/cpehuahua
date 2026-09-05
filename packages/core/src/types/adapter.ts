import type { CpeSnapshot, CapabilityMatrix } from "./model";
import type { ParsedHuaweiXml } from "./xml";
import type { EndpointProbeResult, ProbeEndpoint } from "./probe";

export type AdapterId = "h168" | "h155";

export interface AdapterIdentification {
  matched: boolean;
  confidence: "exact" | "possible" | "none";
  reason: string;
}

export interface AdapterInput {
  timestamp: string;
  source: CpeSnapshot["source"];
  gateway: string | null;
  endpointResults: Readonly<Record<string, EndpointProbeResult>>;
}

export interface CpeAdapter {
  readonly id: AdapterId;
  readonly modelNames: readonly string[];
  readonly probeEndpoints: readonly ProbeEndpoint[];
  readonly baselineCapabilities: CapabilityMatrix;

  identify(input: ParsedHuaweiXml | null): AdapterIdentification;
  normalize(input: AdapterInput): CpeSnapshot;
}
