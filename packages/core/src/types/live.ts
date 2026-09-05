import type { CpeEvent } from "./event";
import type { CpeSnapshot } from "./model";

/** Browser-facing envelope for one normalized live poll. Raw Huawei XML is not part of it. */
export interface CpeLiveReport {
  schemaVersion: 1;
  generatedAt: string;
  adapterId: "h168" | "h155";
  gateway: string | null;
  snapshot: CpeSnapshot;
  /** Optional short history; the local browser may also maintain its own buffer. */
  history: CpeSnapshot[];
  /** Events generated from snapshots in this local monitoring session. */
  events: CpeEvent[];
}
