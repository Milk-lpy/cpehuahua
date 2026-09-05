import { describe, expect, it } from "vitest";
import {
  loadNetworkProbeUrl,
  networkProbeStorageKey,
  saveNetworkProbeUrl,
} from "./network-settings";
import type { StorageLike } from "./storage";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("network probe settings", () => {
  it("stores only the user-selected target locally", () => {
    const storage = new MemoryStorage();
    expect(saveNetworkProbeUrl(" https://status.example/health ", storage)).toBe(true);
    expect(loadNetworkProbeUrl(storage)).toBe("https://status.example/health");
    expect(storage.getItem(networkProbeStorageKey)).toBe("https://status.example/health");
  });

  it("removes an empty target", () => {
    const storage = new MemoryStorage();
    saveNetworkProbeUrl("https://status.example/health", storage);
    saveNetworkProbeUrl("", storage);
    expect(loadNetworkProbeUrl(storage)).toBe("");
  });
});
