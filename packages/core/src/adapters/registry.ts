import type { CpeAdapter, AdapterId, AdapterIdentification } from "../types/adapter";
import type { ParsedHuaweiXml } from "../types/xml";
import { H155Adapter } from "./h155";
import { H168Adapter } from "./h168";
import { E6888Adapter } from "./e6888";

/** Single construction point for device adapters; UI and event code use only the contract. */
export const CPE_ADAPTERS: readonly CpeAdapter[] = [new H168Adapter(), new E6888Adapter(), new H155Adapter()];

export function adapterForId(id: AdapterId): CpeAdapter | null {
  return CPE_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

export function identifyAdapter(document: ParsedHuaweiXml | null): {
  adapter: CpeAdapter | null;
  identification: AdapterIdentification;
} {
  let possible: { adapter: CpeAdapter; identification: AdapterIdentification } | null = null;
  for (const adapter of CPE_ADAPTERS) {
    const identification = adapter.identify(document);
    if (identification.matched && identification.confidence === "exact") {
      return { adapter, identification };
    }
    if (identification.matched && possible === null) {
      possible = { adapter, identification };
    }
  }
  if (possible !== null) return possible;
  return {
    adapter: null,
    identification: {
      matched: false,
      confidence: "none",
      reason: "没有已注册 Adapter 确认该设备",
    },
  };
}
