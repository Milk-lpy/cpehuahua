import { describe, expect, it } from "vitest";
import type { StorageLike } from "./storage";
import { loadUiPreferences, saveUiPreferences, uiPreferencesStorageKey } from "./ui-preferences";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("UI preferences", () => {
  it("stores local plan settings and aliases by non-sensitive host id", () => {
    const storage = new MemoryStorage();
    expect(saveUiPreferences({
      dayPlanEnabled: true,
      dayLimitGb: 20,
      monthPlanEnabled: true,
      monthLimitGb: 500,
      contractedDownloadMbps: 1_000,
      contractedUploadMbps: 100,
      clientAliases: { "InternetGatewayDevice.LANDevice.1.Hosts.Host.8.": "平板" },
    }, storage)).toBe(true);
    expect(loadUiPreferences(storage).clientAliases).toEqual({
      "InternetGatewayDevice.LANDevice.1.Hosts.Host.8.": "平板",
    });
    expect(storage.getItem(uiPreferencesStorageKey)).not.toContain("MacAddress");
  });

  it("drops malformed and out-of-range values", () => {
    const storage = new MemoryStorage();
    storage.setItem(uiPreferencesStorageKey, JSON.stringify({
      dayPlanEnabled: "yes",
      dayLimitGb: -1,
      clientAliases: { "not-a-device-id": "name" },
    }));
    expect(loadUiPreferences(storage)).toMatchObject({
      dayPlanEnabled: false,
      dayLimitGb: null,
      clientAliases: {},
    });
  });

  it("never persists aliases keyed by a MAC address", () => {
    const storage = new MemoryStorage();
    saveUiPreferences({
      dayPlanEnabled: false,
      dayLimitGb: null,
      monthPlanEnabled: false,
      monthLimitGb: null,
      contractedDownloadMbps: null,
      contractedUploadMbps: null,
      clientAliases: {
        "AA:BB:CC:DD:EE:FF": "不应保存",
        "InternetGatewayDevice.LANDevice.1.Hosts.Host.9.": "手机",
      },
    }, storage);

    expect(storage.getItem(uiPreferencesStorageKey)).not.toContain("AA:BB:CC:DD:EE:FF");
    expect(loadUiPreferences(storage).clientAliases).toEqual({
      "InternetGatewayDevice.LANDevice.1.Hosts.Host.9.": "手机",
    });
  });
});
