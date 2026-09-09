import type { BridgeRequestGate } from "../live/bridge-request-gate";

export type ControlAction =
  | "auth.forget"
  | "auth.logout"
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
