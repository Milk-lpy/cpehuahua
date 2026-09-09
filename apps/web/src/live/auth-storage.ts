import type { StorageLike } from "./storage";

const AUTH_PREFERENCES_KEY = "cpehuahua.auth-preferences.v1";

export interface AuthPreferences {
  rememberPassword: boolean;
  autoLogin: boolean;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadAuthPreferences(storage: StorageLike | null = defaultStorage()): AuthPreferences {
  try {
    const raw = storage?.getItem(AUTH_PREFERENCES_KEY);
    if (!raw) return { rememberPassword: false, autoLogin: false };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return { rememberPassword: false, autoLogin: false };
    const preferences = value as { rememberPassword?: unknown; autoLogin?: unknown };
    const rememberPassword = preferences.rememberPassword === true;
    // Older builds coupled both choices. Missing autoLogin therefore preserves
    // the old behaviour once, while all new saves keep the switches separate.
    const autoLogin = rememberPassword && (preferences.autoLogin === undefined || preferences.autoLogin === true);
    return { rememberPassword, autoLogin };
  } catch {
    return { rememberPassword: false, autoLogin: false };
  }
}

export function saveAuthPreferences(
  preferences: AuthPreferences,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTH_PREFERENCES_KEY, JSON.stringify({
      rememberPassword: preferences.rememberPassword,
      autoLogin: preferences.rememberPassword && preferences.autoLogin,
    }));
    return true;
  } catch {
    return false;
  }
}

export const authPreferencesStorageKey = AUTH_PREFERENCES_KEY;
