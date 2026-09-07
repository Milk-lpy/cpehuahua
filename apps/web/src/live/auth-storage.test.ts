import { describe, expect, it } from "vitest";
import {
  authPreferencesStorageKey,
  loadAuthPreferences,
  saveAuthPreferences,
} from "./auth-storage";
import type { StorageLike } from "./storage";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("auth preferences storage", () => {
  it("defaults to no automatic login", () => {
    expect(loadAuthPreferences(new MemoryStorage())).toEqual({ rememberPassword: false });
  });

  it("round-trips only the remember-password preference", () => {
    const storage = new MemoryStorage();

    expect(saveAuthPreferences({ rememberPassword: true }, storage)).toBe(true);
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: true });
    expect(storage.getItem(authPreferencesStorageKey)).not.toContain("secret");
    expect(storage.getItem(authPreferencesStorageKey)).not.toContain("password");
  });

  it("ignores malformed or unsupported stored values", () => {
    const storage = new MemoryStorage();
    storage.setItem(authPreferencesStorageKey, "not-json");
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: false });

    storage.setItem(authPreferencesStorageKey, JSON.stringify({ rememberPassword: "yes" }));
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: false });
  });
});
