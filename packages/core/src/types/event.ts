/** Event categories reserved for the device timeline. */
export type CpeEventType =
  | "CELL_CHANGED"
  | "PCI_CHANGED"
  | "BAND_CHANGED"
  | "CA_CHANGED"
  | "NR_LOST"
  | "NR_RESTORED"
  | "CELLULAR_DOWN"
  | "CELLULAR_UP"
  | "INTERNET_DOWN"
  | "INTERNET_UP"
  | "HIGH_PACKET_LOSS"
  | "PACKET_LOSS_RECOVERED"
  | "LOW_SINR"
  | "SINR_RECOVERED";

export type CpeEventValue = string | number | boolean | null;

/** Normalized event contract; detection logic belongs to the future EventEngine phase. */
export interface CpeEvent {
  /** Timestamp of the snapshot that first confirms this transition. */
  timestamp: string;
  /** Previous observation boundary; the real transition happened after this time and no later than `timestamp`. */
  previousTimestamp?: string | null;
  type: CpeEventType;
  oldValue: CpeEventValue;
  newValue: CpeEventValue;
  /** Context from the confirming snapshot. */
  context: Record<string, CpeEventValue>;
  /** Context from the preceding snapshot; absent only on legacy persisted events. */
  previousContext?: Record<string, CpeEventValue>;
  /** Filled for outage close events; null for instantaneous changes. */
  durationMs: number | null;
}
