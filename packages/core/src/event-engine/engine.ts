import type { CpeEvent, CpeEventType, CpeEventValue } from "../types/event";
import type { CpeSnapshot } from "../types/model";
import { distinctServingCells, servingCarrierCompositionLabel } from "../signal/cells";

export interface EventEngineOptions {
  /** Packet-loss percentage at or above which an alarm is emitted. */
  highPacketLossPct?: number;
  /** SINR at or below which an alarm is emitted. */
  lowSinrDb?: number;
  /** Maximum retained event history; ingestion still returns all new events. */
  maxEvents?: number;
}

const DEFAULT_HIGH_PACKET_LOSS_PCT = 20;
const DEFAULT_LOW_SINR_DB = 5;
const DEFAULT_MAX_EVENTS = 500;

function timestampMs(timestamp: string): number | null {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
}

function contextFor(snapshot: CpeSnapshot): Record<string, CpeEventValue> {
  const servingCells = distinctServingCells(snapshot);
  return {
    source: snapshot.source,
    cellularOnline: snapshot.connection.cellularOnline,
    internetOnline: snapshot.connection.internetOnline,
    band: snapshot.radio.band,
    arfcn: snapshot.radio.arfcn,
    bandwidth: snapshot.radio.bandwidth,
    pci: snapshot.radio.pci,
    cellId: snapshot.radio.cellId,
    rrcStatus: snapshot.radio.rrcStatus,
    radioMode: snapshot.connection.radioMode,
    saNsa: snapshot.connection.saNsa,
    plmn: snapshot.connection.plmn,
    carrierCount: servingCells.length,
    carriers: servingCarrierCompositionLabel(snapshot),
    rsrpDbm: snapshot.radio.rsrpDbm,
    rsrqDb: snapshot.radio.rsrqDb,
    rssiDbm: snapshot.radio.rssiDbm,
    sinrDb: snapshot.radio.sinrDb,
    cqi: snapshot.radio.cqi,
    mimoRank: snapshot.radio.mimoRank,
    blerPct: snapshot.radio.blerPct,
    pingMs: snapshot.network.pingMs,
    jitterMs: snapshot.network.jitterMs,
    packetLossPct: snapshot.network.packetLossPct,
  };
}

function event(
  previous: CpeSnapshot,
  current: CpeSnapshot,
  type: CpeEventType,
  oldValue: CpeEventValue,
  newValue: CpeEventValue,
  durationMs: number | null = null,
): CpeEvent {
  return {
    timestamp: current.timestamp,
    previousTimestamp: previous.timestamp,
    type,
    oldValue,
    newValue,
    context: contextFor(current),
    previousContext: contextFor(previous),
    durationMs,
  };
}

function changedScalar(
  previous: CpeSnapshot,
  current: CpeSnapshot,
  oldValue: CpeEventValue,
  newValue: CpeEventValue,
  type: CpeEventType,
): CpeEvent | null {
  if (oldValue === null || newValue === null || oldValue === newValue) {
    return null;
  }
  return event(previous, current, type, oldValue, newValue);
}

function nrPresence(snapshot: CpeSnapshot): boolean | null {
  const hasNrCell = [snapshot.cells.pcc, ...snapshot.cells.scells]
    .some((cell) => cell?.technology === "NR");
  if (hasNrCell || snapshot.connection.radioMode === "5G") {
    return true;
  }
  if (["2G", "3G", "4G"].includes(snapshot.connection.radioMode)) {
    return false;
  }
  return null;
}

function thresholdActive(value: number | null, threshold: number, low: boolean): boolean | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return low ? value <= threshold : value >= threshold;
}

function transitionEvent(
  previousSnapshot: CpeSnapshot,
  currentSnapshot: CpeSnapshot,
  previous: boolean | null,
  current: boolean | null,
  downType: "CELLULAR_DOWN" | "INTERNET_DOWN",
  upType: "CELLULAR_UP" | "INTERNET_UP",
  downAt: number | null,
): { change: CpeEvent | null; downAt: number | null } {
  if (current === null || previous === null || current === previous) {
    return {
      change: null,
      downAt: current === false ? downAt : null,
    };
  }

  if (!current) {
    return { change: event(previousSnapshot, currentSnapshot, downType, previous, current), downAt: timestampMs(currentSnapshot.timestamp) };
  }

  const currentAt = timestampMs(currentSnapshot.timestamp);
  const durationMs = downAt !== null && currentAt !== null ? Math.max(0, currentAt - downAt) : null;
  return { change: event(previousSnapshot, currentSnapshot, upType, previous, current, durationMs), downAt: null };
}

function initialDownAt(snapshot: CpeSnapshot, value: boolean | null): number | null {
  return value === false ? timestampMs(snapshot.timestamp) : null;
}

/** Converts consecutive normalized snapshots into a de-duplicated timeline. */
export class EventEngine {
  private readonly highPacketLossPct: number;
  private readonly lowSinrDb: number;
  private readonly maxEvents: number;
  private previousSnapshot: CpeSnapshot | null = null;
  private readonly eventHistory: CpeEvent[] = [];
  private cellularDownAt: number | null = null;
  private internetDownAt: number | null = null;
  private highPacketLossActive = false;
  private lowSinrActive = false;
  private highPacketLossAt: number | null = null;
  private lowSinrAt: number | null = null;

  constructor(options: EventEngineOptions = {}) {
    this.highPacketLossPct = Number.isFinite(options.highPacketLossPct)
      ? (options.highPacketLossPct ?? DEFAULT_HIGH_PACKET_LOSS_PCT)
      : DEFAULT_HIGH_PACKET_LOSS_PCT;
    this.lowSinrDb = Number.isFinite(options.lowSinrDb)
      ? (options.lowSinrDb ?? DEFAULT_LOW_SINR_DB)
      : DEFAULT_LOW_SINR_DB;
    this.maxEvents = Number.isInteger(options.maxEvents) && (options.maxEvents ?? 0) > 0
      ? (options.maxEvents ?? DEFAULT_MAX_EVENTS)
      : DEFAULT_MAX_EVENTS;
  }

  get events(): readonly CpeEvent[] {
    return this.eventHistory;
  }

  ingest(snapshot: CpeSnapshot): CpeEvent[] {
    const previous = this.previousSnapshot;
    if (previous === null) {
      this.previousSnapshot = snapshot;
      this.cellularDownAt = initialDownAt(snapshot, snapshot.connection.cellularOnline);
      this.internetDownAt = initialDownAt(snapshot, snapshot.connection.internetOnline);
      this.highPacketLossActive = thresholdActive(
        snapshot.network.packetLossPct,
        this.highPacketLossPct,
        false,
      ) ?? false;
      this.lowSinrActive = thresholdActive(snapshot.radio.sinrDb, this.lowSinrDb, true) ?? false;
      this.highPacketLossAt = this.highPacketLossActive ? timestampMs(snapshot.timestamp) : null;
      this.lowSinrAt = this.lowSinrActive ? timestampMs(snapshot.timestamp) : null;
      return [];
    }

    const events: CpeEvent[] = [];
    const cellChanged = changedScalar(
      previous,
      snapshot,
      previous.radio.cellId,
      snapshot.radio.cellId,
      "CELL_CHANGED",
    );
    const pciChanged = changedScalar(
      previous,
      snapshot,
      previous.radio.pci,
      snapshot.radio.pci,
      "PCI_CHANGED",
    );
    const bandChanged = changedScalar(
      previous,
      snapshot,
      previous.radio.band,
      snapshot.radio.band,
      "BAND_CHANGED",
    );
    if (cellChanged) events.push(cellChanged);
    if (pciChanged) events.push(pciChanged);
    if (bandChanged) events.push(bandChanged);

    const previousCa = servingCarrierCompositionLabel(previous);
    const currentCa = servingCarrierCompositionLabel(snapshot);
    if (previousCa !== null && currentCa !== null && previousCa !== currentCa) {
      events.push(event(previous, snapshot, "CA_CHANGED", previousCa, currentCa));
    }

    const previousNr = nrPresence(previous);
    const currentNr = nrPresence(snapshot);
    if (previousNr !== null && currentNr !== null && previousNr !== currentNr) {
      events.push(event(previous, snapshot, currentNr ? "NR_RESTORED" : "NR_LOST", previousNr, currentNr));
    }

    const cellular = transitionEvent(
      previous,
      snapshot,
      previous.connection.cellularOnline,
      snapshot.connection.cellularOnline,
      "CELLULAR_DOWN",
      "CELLULAR_UP",
      this.cellularDownAt,
    );
    const internet = transitionEvent(
      previous,
      snapshot,
      previous.connection.internetOnline,
      snapshot.connection.internetOnline,
      "INTERNET_DOWN",
      "INTERNET_UP",
      this.internetDownAt,
    );
    if (cellular.change) events.push(cellular.change);
    if (internet.change) events.push(internet.change);
    this.cellularDownAt = cellular.downAt;
    this.internetDownAt = internet.downAt;

    const highPacketLoss = thresholdActive(
      snapshot.network.packetLossPct,
      this.highPacketLossPct,
      false,
    );
    if (highPacketLoss === true && !this.highPacketLossActive) {
      events.push(event(
        previous,
        snapshot,
        "HIGH_PACKET_LOSS",
        previous.network.packetLossPct,
        snapshot.network.packetLossPct,
      ));
      this.highPacketLossAt = timestampMs(snapshot.timestamp);
    } else if (highPacketLoss === false && this.highPacketLossActive) {
      const currentAt = timestampMs(snapshot.timestamp);
      const durationMs = this.highPacketLossAt !== null && currentAt !== null
        ? Math.max(0, currentAt - this.highPacketLossAt)
        : null;
      events.push(event(previous, snapshot, "PACKET_LOSS_RECOVERED", previous.network.packetLossPct, snapshot.network.packetLossPct, durationMs));
      this.highPacketLossAt = null;
    }
    if (highPacketLoss !== null) {
      this.highPacketLossActive = highPacketLoss;
    }

    const lowSinr = thresholdActive(snapshot.radio.sinrDb, this.lowSinrDb, true);
    if (lowSinr === true && !this.lowSinrActive) {
      events.push(event(previous, snapshot, "LOW_SINR", previous.radio.sinrDb, snapshot.radio.sinrDb));
      this.lowSinrAt = timestampMs(snapshot.timestamp);
    } else if (lowSinr === false && this.lowSinrActive) {
      const currentAt = timestampMs(snapshot.timestamp);
      const durationMs = this.lowSinrAt !== null && currentAt !== null
        ? Math.max(0, currentAt - this.lowSinrAt)
        : null;
      events.push(event(previous, snapshot, "SINR_RECOVERED", previous.radio.sinrDb, snapshot.radio.sinrDb, durationMs));
      this.lowSinrAt = null;
    }
    if (lowSinr !== null) {
      this.lowSinrActive = lowSinr;
    }

    this.previousSnapshot = snapshot;
    this.eventHistory.push(...events);
    while (this.eventHistory.length > this.maxEvents) {
      this.eventHistory.shift();
    }
    return events;
  }

  reset(): void {
    this.previousSnapshot = null;
    this.eventHistory.length = 0;
    this.cellularDownAt = null;
    this.internetDownAt = null;
    this.highPacketLossActive = false;
    this.lowSinrActive = false;
    this.highPacketLossAt = null;
    this.lowSinrAt = null;
  }
}
