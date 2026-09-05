import type { StorageLike } from "./storage";

const NETWORK_PROBE_KEY = "cpehuahua.network-probe-url.v1";

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadNetworkProbeUrl(storage: StorageLike | null = defaultStorage()): string {
  try {
    return storage?.getItem(NETWORK_PROBE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveNetworkProbeUrl(
  value: string,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    const normalized = value.trim();
    if (!normalized) {
      storage.removeItem(NETWORK_PROBE_KEY);
    } else {
      storage.setItem(NETWORK_PROBE_KEY, normalized);
    }
    return true;
  } catch {
    return false;
  }
}

export const networkProbeStorageKey = NETWORK_PROBE_KEY;
