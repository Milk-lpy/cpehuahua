import type { CpeCell, CpeLiveReport, CpeSnapshot } from "@cpehuahua/core";

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
    (value.cells.pcc === null || isRecord(value.cells.pcc)) &&
    Array.isArray(value.cells.scells) &&
    value.cells.scells.every(isRecord) &&
    Array.isArray(value.cells.neighbors) &&
    value.cells.neighbors.every(isRecord) &&
    isRecord(value.network) &&
    isRecord(value.extended) &&
    isRecord(value.capabilities)
  );
}

/** Add fields introduced after the first persisted snapshot schema. */
function normalizeCell(value: CpeCell): CpeCell {
  return {
    ...value,
    bandwidth: value.bandwidth ?? null,
    rrcStatus: value.rrcStatus ?? null,
  };
}

function normalizeSnapshot(value: CpeSnapshot): CpeSnapshot {
  return {
    ...value,
    device: {
      ...value.device,
      productName: value.device.productName ?? null,
      hardwareVersion: value.device.hardwareVersion ?? null,
      webUiVersion: value.device.webUiVersion ?? null,
      parameterVersion: value.device.parameterVersion ?? null,
    },
    connection: {
      ...value.connection,
      operatorName: value.connection.operatorName ?? null,
      cellularStatusCode: value.connection.cellularStatusCode ?? null,
    },
    network: {
      ...value.network,
      currentDownloadBytes: value.network.currentDownloadBytes ?? null,
      currentUploadBytes: value.network.currentUploadBytes ?? null,
      totalDownloadBytes: value.network.totalDownloadBytes ?? null,
      totalUploadBytes: value.network.totalUploadBytes ?? null,
      currentConnectSeconds: value.network.currentConnectSeconds ?? null,
      totalConnectSeconds: value.network.totalConnectSeconds ?? null,
      monthDownloadBytes: value.network.monthDownloadBytes ?? null,
      monthUploadBytes: value.network.monthUploadBytes ?? null,
      monthDurationSeconds: value.network.monthDurationSeconds ?? null,
      monthLastClearDate: value.network.monthLastClearDate ?? null,
      dayUsedBytes: value.network.dayUsedBytes ?? null,
      dayDurationSeconds: value.network.dayDurationSeconds ?? null,
    },
    clients: Array.isArray(value.clients) ? value.clients : [],
    messaging: {
      unread: value.messaging?.unread ?? null,
      inbox: value.messaging?.inbox ?? null,
      outbox: value.messaging?.outbox ?? null,
      draft: value.messaging?.draft ?? null,
      deleted: value.messaging?.deleted ?? null,
      capacity: value.messaging?.capacity ?? null,
      simUnread: value.messaging?.simUnread ?? null,
      simInbox: value.messaging?.simInbox ?? null,
      simUsed: value.messaging?.simUsed ?? null,
      simCapacity: value.messaging?.simCapacity ?? null,
      newMessages: value.messaging?.newMessages ?? null,
      storageFull: value.messaging?.storageFull ?? null,
    },
    capabilities: {
      ...value.capabilities,
      monthlyTraffic: value.capabilities.monthlyTraffic ?? "unknown",
      clients: value.capabilities.clients ?? "unknown",
      sms: value.capabilities.sms ?? "unknown",
    },
    radio: {
      ...value.radio,
      bandwidth: value.radio.bandwidth ?? null,
      rrcStatus: value.radio.rrcStatus ?? null,
    },
    cells: {
      ...value.cells,
      pcc: value.cells.pcc === null ? null : normalizeCell(value.cells.pcc),
      scells: value.cells.scells.map(normalizeCell),
      neighbors: value.cells.neighbors.map(normalizeCell),
    },
  };
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
      snapshot: normalizeSnapshot(state.report.snapshot),
      history: state.report.history.slice(-MAX_HISTORY).map(normalizeSnapshot),
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
