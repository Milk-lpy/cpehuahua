import { describe, expect, it } from "vitest";
import type { StorageLike } from "./storage";
import { loadTheme, saveTheme, themeStorageKey } from "./theme";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("color theme", () => {
  it("defaults to dark and persists an explicit light theme", () => {
    const storage = new MemoryStorage();
    expect(loadTheme(storage)).toBe("dark");
    expect(saveTheme("light", storage)).toBe(true);
    expect(storage.getItem(themeStorageKey)).toBe("light");
    expect(loadTheme(storage)).toBe("light");
  });

  it("ignores unknown persisted values", () => {
    const storage = new MemoryStorage();
    storage.setItem(themeStorageKey, "system");
    expect(loadTheme(storage)).toBe("dark");
  });
});
