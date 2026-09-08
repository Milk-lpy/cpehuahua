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
  | "LOW_SINR";

export type CpeEventValue = string | number | boolean | null;

/** Normalized event contract; detection logic belongs to the future EventEngine phase. */
export interface CpeEvent {
  timestamp: string;
  type: CpeEventType;
  oldValue: CpeEventValue;
  newValue: CpeEventValue;
  context: Record<string, CpeEventValue>;
  /** Filled for outage close events; null for instantaneous changes. */
  durationMs: number | null;
}
