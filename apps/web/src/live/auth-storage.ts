import type { StorageLike } from "./storage";

const AUTH_PREFERENCES_KEY = "cpehuahua.auth-preferences.v1";

export interface AuthPreferences {
  rememberPassword: boolean;
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
    if (!raw) return { rememberPassword: false };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return { rememberPassword: false };
    return { rememberPassword: (value as { rememberPassword?: unknown }).rememberPassword === true };
  } catch {
    return { rememberPassword: false };
  }
}

export function saveAuthPreferences(
  preferences: AuthPreferences,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTH_PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export const authPreferencesStorageKey = AUTH_PREFERENCES_KEY;
