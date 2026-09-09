import type { StorageLike } from "./storage";

export type ColorTheme = "dark" | "light";

const THEME_STORAGE_KEY = "cpehuahua.theme.v1";
const DEFAULT_THEME: ColorTheme = "dark";

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadTheme(storage: StorageLike | null = defaultStorage()): ColorTheme {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === "light" ? "light" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ColorTheme, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme === "light" ? "light" : "dark");
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(theme: ColorTheme): void {
  if (typeof document === "undefined") return;
  const normalized = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", normalized === "light" ? "#eef3f9" : "#0b111b");
}

export const themeStorageKey = THEME_STORAGE_KEY;
