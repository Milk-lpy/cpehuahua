import type { BridgeRequestGate } from "../live/bridge-request-gate";

export type ControlAction =
  | "auth.forget"
  | "auth.logout"
  | "features.get"
  | "sms.list"
  | "sms.send"
  | "sms.read"
  | "sms.delete"
  | "network.get"
  | "network.set"
  | "network.lock"
  | "network.unlock"
  | "network.mobile-data"
  | "network.reconnect"
  | "traffic.clear"
  | "wlan.get"
  | "maintenance.get"
  | "maintenance.auto-update"
  | "clients.list"
  | "clients.block"
  | "clients.unblock"
  | "device.reboot";

export interface SmsMessage {
  index: string;
  unread: boolean;
  phone: string | null;
  content: string | null;
  date: string | null;
  smsType: string | null;
}

export interface NetworkControlState {
  networkMode: string | null;
  networkBand: string | null;
  lteBand: string | null;
  nrBand: string | null;
  networkOption: string | null;
  supportedModes: string[];
  supportedLteBands: number[];
  supportedNrBands: number[];
  lteLockMode: string | null;
  nrLockMode: string | null;
  lockedLteBands: number[];
  lockedNrBands: number[];
  lockSupported: boolean;
  mobileData: boolean | null;
}

export interface ManagedClient {
  id: string | null;
  name: string | null;
  hostName: string | null;
  manufacturer: string | null;
  deviceType: string | null;
  frequency: string | null;
  ssid: string | null;
  associatedSeconds: number | null;
  ipAddress: string | null;
  macAddress: string;
  ssidIndex: string | null;
  blocked: boolean | null;
  canControl: boolean;
  downloadRateBps: number | null;
  uploadRateBps: number | null;
  totalDownloadBytes: number | null;
  totalUploadBytes: number | null;
  linkRateMbps: number | null;
}

export type FeatureStatus = "available" | "read-only" | "unverified" | "unsupported";

export interface FeatureCapability {
  status: FeatureStatus;
  value: boolean | string | number | null;
  reason: string;
}

export type DeviceFeatureKey =
  | "ipv6"
  | "nfc"
  | "vpn"
  | "appAcceleration"
  | "ambientLight"
  | "dualWanTurbo"
  | "automaticFailover"
  | "triBandOptimization"
  | "mlo"
  | "pmf"
  | "backupNetwork"
  | "scheduledRestart"
  | "scheduledLedOff";

export type DeviceFeatureState = Record<DeviceFeatureKey, FeatureCapability>;

export interface WlanSsidState {
  index: string;
  radio: "2.4GHz" | "5GHz_1" | "5GHz_2" | "unknown";
  name: string | null;
  enabled: boolean | null;
  guest: boolean | null;
  authMode: string | null;
  supportedSecurityModes: string[];
  broadcast: boolean | null;
  maxClients: number | null;
  bandwidth: string | null;
  channel: string | null;
  wifiMode: string | null;
}

export interface WlanControlState {
  ssids: WlanSsidState[];
  compatibilityMode: string | null;
  compatibilityEnabled: boolean | null;
  dbhoEnabled: boolean | null;
  writeSupported: boolean;
  writeReason: string;
}

export interface MaintenanceControlState {
  autoUpdateSupported: boolean;
  autoUpdate: boolean | null;
  uiDownload: boolean | null;
  timedRestart: FeatureCapability;
  ledSchedule: FeatureCapability;
}

export interface ControlResponse<T = unknown> {
  schemaVersion: 1;
  gateway: string;
  action: ControlAction;
  status: "ok" | "partial" | "huawei-error" | "http-error";
  httpStatus: number;
  huaweiError: { code: number | null; rawCode: string | null; message: string | null } | null;
  data: T;
}

export interface ControlClientOptions {
  getPassword: () => string;
  rememberSession: () => boolean;
  rememberPassword?: () => boolean;
  fetcher?: typeof fetch;
  requestGate?: BridgeRequestGate;
}
