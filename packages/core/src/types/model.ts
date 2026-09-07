/** A value that is deliberately unavailable or not verified. */
export type Nullable<T> = T | null;

export type CapabilityStatus = "unknown" | "observed" | "unsupported";

export type CapabilityKey =
  | "signal"
  | "secondaryCells"
  | "neighbors"
  | "traffic"
  | "temperature"
  | "fan"
  | "qci"
  | "fiveQi"
  | "ambr"
  | "cpu"
  | "memory"
  | "mcs"
  | "cqi"
  | "mimoRank"
  | "bler"
  | "txPower";

export type CapabilityMatrix = Record<CapabilityKey, CapabilityStatus>;

export type RadioTechnology = "LTE" | "NR" | "unknown";
export type CellRole = "pcc" | "scell" | "neighbor" | "unknown";
export type RadioMode = "2G" | "3G" | "4G" | "5G" | "unknown";
export type SaNsaMode = "SA" | "NSA" | "unknown";

export interface DeviceIdentity {
  model: Nullable<string>;
  firmware: Nullable<string>;
  uptimeSeconds: Nullable<number>;
}

/**
 * Huawei sometimes returns MCS and TX power as a carrier/channel expression,
 * not as one scalar. Keep that evidence separate from the normalized numeric
 * fields so the UI can show the device text without inventing a number.
 */
export interface RadioRawFields {
  dlMcs: Nullable<string>;
  ulMcs: Nullable<string>;
  txPower: Nullable<string>;
}

export interface ConnectionState {
  /** Cellular registration/radio state; intentionally separate from Internet. */
  cellularOnline: Nullable<boolean>;
  /** User-path reachability measured by iPhone/Surge, not by CPE WAN status. */
  internetOnline: Nullable<boolean>;
  radioMode: RadioMode;
  saNsa: SaNsaMode;
  plmn: Nullable<string>;
}

export interface RadioMetrics {
  rsrpDbm: Nullable<number>;
  rsrqDb: Nullable<number>;
  sinrDb: Nullable<number>;
  rssiDbm: Nullable<number>;
  pci: Nullable<number>;
  cellId: Nullable<string>;
  tac: Nullable<string>;
  band: Nullable<string>;
  arfcn: Nullable<number>;
  /** H168 bandwidth text, e.g. the observed `100MHz` value. */
  bandwidth: Nullable<string>;
  /** Huawei `rrc_status` value; semantics remain firmware-specific. */
  rrcStatus: Nullable<string>;
  cqi: Nullable<number>;
  mimoRank: Nullable<number>;
  dlMcs: Nullable<number>;
  ulMcs: Nullable<number>;
  blerPct: Nullable<number>;
  txPowerDbm: Nullable<number>;
  /** Present only when the device returned a non-scalar radio expression. */
  rawEvidence?: RadioRawFields;
}

export interface CpeCell extends RadioMetrics {
  role: CellRole;
  technology: RadioTechnology;
}

export interface CellCollection {
  pcc: Nullable<CpeCell>;
  scells: CpeCell[];
  neighbors: CpeCell[];
}

export interface NetworkMetrics {
  pingMs: Nullable<number>;
  jitterMs: Nullable<number>;
  packetLossPct: Nullable<number>;
  downloadBps: Nullable<number>;
  uploadBps: Nullable<number>;
}

/** Reserved fields remain null until a supported read path is verified. */
export interface ExtendedMetrics {
  temperatureC: Nullable<number>;
  fanRpm: Nullable<number>;
  cpuUsagePct: Nullable<number>;
  memoryUsagePct: Nullable<number>;
  qci: Nullable<number>;
  fiveQi: Nullable<number>;
  dlAmbr: Nullable<number>;
  ulAmbr: Nullable<number>;
}

export interface CpeSnapshot {
  schemaVersion: 1;
  timestamp: string;
  source: "live" | "fixture" | "unknown";
  device: DeviceIdentity;
  connection: ConnectionState;
  radio: RadioMetrics;
  cells: CellCollection;
  network: NetworkMetrics;
  extended: ExtendedMetrics;
  capabilities: CapabilityMatrix;
}
