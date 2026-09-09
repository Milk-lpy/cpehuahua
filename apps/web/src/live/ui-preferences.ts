import type { StorageLike } from "./storage";

const UI_PREFERENCES_KEY = "cpehuahua.ui-preferences.v1";

export interface UiPreferences {
  dayPlanEnabled: boolean;
  dayLimitGb: number | null;
  monthPlanEnabled: boolean;
  monthLimitGb: number | null;
  contractedDownloadMbps: number | null;
  contractedUploadMbps: number | null;
  clientAliases: Record<string, string>;
}

const DEFAULTS: UiPreferences = {
  dayPlanEnabled: false,
  dayLimitGb: null,
  monthPlanEnabled: false,
  monthLimitGb: null,
  contractedDownloadMbps: null,
  contractedUploadMbps: null,
  clientAliases: {},
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1_000_000
    ? value
    : null;
}

function aliases(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => /^InternetGatewayDevice\.[\w.-]{1,160}$/.test(key)
      && typeof item === "string" && item.trim().length > 0 && item.trim().length <= 32)
    .map(([key, item]) => [key, String(item).trim()]));
}

function normalize(value: Partial<UiPreferences>): UiPreferences {
  return {
    dayPlanEnabled: value.dayPlanEnabled === true,
    dayLimitGb: finitePositive(value.dayLimitGb),
    monthPlanEnabled: value.monthPlanEnabled === true,
    monthLimitGb: finitePositive(value.monthLimitGb),
    contractedDownloadMbps: finitePositive(value.contractedDownloadMbps),
    contractedUploadMbps: finitePositive(value.contractedUploadMbps),
    clientAliases: aliases(value.clientAliases),
  };
}

export function loadUiPreferences(storage: StorageLike | null = defaultStorage()): UiPreferences {
  try {
    const raw = storage?.getItem(UI_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULTS, clientAliases: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULTS, clientAliases: {} };
    return normalize(parsed as Partial<UiPreferences>);
  } catch {
    return { ...DEFAULTS, clientAliases: {} };
  }
}

export function saveUiPreferences(
  preferences: UiPreferences,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify(normalize(preferences)));
    return true;
  } catch {
    return false;
  }
}

export const uiPreferencesStorageKey = UI_PREFERENCES_KEY;
