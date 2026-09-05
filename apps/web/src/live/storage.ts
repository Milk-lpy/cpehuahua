import type { CpeLiveReport, CpeSnapshot } from "@cpehuahua/core";

const STORAGE_KEY = "cpehuahua.live.v1";
const STORAGE_VERSION = 1;
const MAX_HISTORY = 60;
const MAX_EVENTS = 500;
const MAX_SERIALIZED_BYTES = 512 * 1024;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PersistedLiveState {
  version: typeof STORAGE_VERSION;
  savedAt: string;
  report: CpeLiveReport;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSnapshot(value: unknown): value is CpeSnapshot {
  if (!isRecord(value)) return false;

  return (
    typeof value.timestamp === "string" &&
    (value.source === "live" || value.source === "fixture" || value.source === "unknown") &&
    isRecord(value.device) &&
    isRecord(value.connection) &&
    isRecord(value.radio) &&
    isRecord(value.cells) &&
    Array.isArray(value.cells.scells) &&
    Array.isArray(value.cells.neighbors) &&
    isRecord(value.network) &&
    isRecord(value.extended) &&
    isRecord(value.capabilities)
  );
}

function isLiveReport(value: unknown): value is CpeLiveReport {
  if (!isRecord(value)) return false;

  return (
    value.schemaVersion === 1 &&
    typeof value.generatedAt === "string" &&
    typeof value.adapterId === "string" &&
    (typeof value.gateway === "string" || value.gateway === null) &&
    isSnapshot(value.snapshot) &&
    Array.isArray(value.history) &&
    value.history.every(isSnapshot) &&
    Array.isArray(value.events)
  );
}

function parseState(raw: string | null): CpeLiveReport | null {
  if (!raw || raw.length > MAX_SERIALIZED_BYTES) return null;

  try {
    const state: unknown = JSON.parse(raw);
    if (!isRecord(state) || state.version !== STORAGE_VERSION || !isLiveReport(state.report)) {
      return null;
    }

    return {
      ...state.report,
      history: state.report.history.slice(-MAX_HISTORY),
      events: state.report.events.slice(-MAX_EVENTS),
    };
  } catch {
    return null;
  }
}

export function loadPersistedLiveReport(storage: StorageLike | null = defaultStorage()): CpeLiveReport | null {
  if (!storage) return null;

  try {
    return parseState(storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePersistedLiveReport(
  report: CpeLiveReport,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage || !isLiveReport(report)) return false;

  const state: PersistedLiveState = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    report: {
      ...report,
      history: report.history.slice(-MAX_HISTORY),
      events: report.events.slice(-MAX_EVENTS),
    },
  };

  try {
    const serialized = JSON.stringify(state);
    if (serialized.length > MAX_SERIALIZED_BYTES) return false;
    storage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearPersistedLiveReport(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing or after quota changes.
  }
}

export const liveStorageKey = STORAGE_KEY;
