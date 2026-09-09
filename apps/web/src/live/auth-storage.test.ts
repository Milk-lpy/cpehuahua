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
    expect(loadAuthPreferences(new MemoryStorage())).toEqual({ rememberPassword: false, autoLogin: false });
  });

  it("round-trips separate remember-password and automatic-login preferences", () => {
    const storage = new MemoryStorage();

    expect(saveAuthPreferences({ rememberPassword: true, autoLogin: false }, storage)).toBe(true);
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: true, autoLogin: false });
    expect(storage.getItem(authPreferencesStorageKey)).not.toContain("secret");
  });

  it("migrates the old coupled preference and prevents auto login without a remembered password", () => {
    const storage = new MemoryStorage();
    storage.setItem(authPreferencesStorageKey, JSON.stringify({ rememberPassword: true }));
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: true, autoLogin: true });

    expect(saveAuthPreferences({ rememberPassword: false, autoLogin: true }, storage)).toBe(true);
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: false, autoLogin: false });
  });

  it("ignores malformed or unsupported stored values", () => {
    const storage = new MemoryStorage();
    storage.setItem(authPreferencesStorageKey, "not-json");
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: false, autoLogin: false });

    storage.setItem(authPreferencesStorageKey, JSON.stringify({ rememberPassword: "yes" }));
    expect(loadAuthPreferences(storage)).toEqual({ rememberPassword: false, autoLogin: false });
  });
});
