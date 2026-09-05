import type { CpeAdapter, AdapterIdentification, AdapterInput } from "../types/adapter";
import type { CapabilityMatrix } from "../types/model";
import type { ParsedHuaweiXml } from "../types/xml";
import { emptyCapabilities } from "./helpers";

export class ReservedAdapterError extends Error {
  constructor() {
    super("H155-381 adapter is reserved and not implemented in V1");
    this.name = "ReservedAdapterError";
  }
}

/** Interface reservation only; no H155 endpoint or field support is claimed. */
export class H155Adapter implements CpeAdapter {
  readonly id = "h155" as const;
  readonly modelNames = ["H155-381", "Brovi H155-381"] as const;
  readonly probeEndpoints = [] as const;
  readonly baselineCapabilities: CapabilityMatrix = emptyCapabilities();

  identify(input: ParsedHuaweiXml | null): AdapterIdentification {
    const serialized = input?.response ? JSON.stringify(input.response).toLowerCase() : "";
    if (serialized.includes("h155-381")) {
      return { matched: true, confidence: "exact", reason: "响应中出现 H155-381，但该 Adapter 仍为 stub" };
    }
    return { matched: false, confidence: "none", reason: "H155 Adapter 仅预留" };
  }

  normalize(_input: AdapterInput): never {
    throw new ReservedAdapterError();
  }
}
