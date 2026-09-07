import { carrierAggregationLabel, type CpeEvent, type CpeEventValue, type CpeSnapshot } from "@cpehuahua/core";

export type DashboardMetricId =
  | "rsrpDbm"
  | "sinrDb"
  | "pingMs"
  | "rsrqDb"
  | "cqi"
  | "dlMcs"
  | "blerPct"
  | "txPowerDbm";

export interface DashboardMetricDefinition {
  id: DashboardMetricId;
  label: string;
  unit: string;
}

export const DASHBOARD_METRICS: readonly DashboardMetricDefinition[] = [
  { id: "rsrpDbm", label: "RSRP", unit: "dBm" },
  { id: "sinrDb", label: "SINR", unit: "dB" },
  { id: "pingMs", label: "Ping", unit: "ms" },
  { id: "rsrqDb", label: "RSRQ", unit: "dB" },
  { id: "cqi", label: "CQI", unit: "" },
  { id: "dlMcs", label: "MCS (DL)", unit: "" },
  { id: "blerPct", label: "BLER", unit: "%" },
  { id: "txPowerDbm", label: "TX Power", unit: "dBm" },
];

export function metricDefinition(id: DashboardMetricId): DashboardMetricDefinition {
  return DASHBOARD_METRICS.find((metric) => metric.id === id) ?? DASHBOARD_METRICS[0]!;
}

export function metricValue(snapshot: CpeSnapshot, id: DashboardMetricId): number | null {
  if (id === "pingMs") {
    return snapshot.network.pingMs;
  }
  return snapshot.radio[id];
}

export interface ChartPoint {
  index: number;
  timestamp: string;
  value: number;
}

export function chartPoints(
  history: readonly CpeSnapshot[],
  id: DashboardMetricId,
): ChartPoint[] {
  return history.flatMap((snapshot, index) => {
    const value = metricValue(snapshot, id);
    return value === null || !Number.isFinite(value)
      ? []
      : [{ index, timestamp: snapshot.timestamp, value }];
  });
}

export function formatMetric(value: number | null, unit = ""): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const displayed = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${displayed}${unit ? ` ${unit}` : ""}`;
}

export function statusText(value: boolean | null): string {
  if (value === null) return "未验证";
  return value ? "在线" : "离线";
}

export function statusClass(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "online" : "offline";
}

export function aggregationLabel(snapshot: CpeSnapshot): string {
  return carrierAggregationLabel(snapshot) ?? "—";
}

export function eventValue(value: CpeEventValue): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Online" : "Down";
  return String(value);
}

const EVENT_LABELS: Record<CpeEvent["type"], string> = {
  CELL_CHANGED: "小区变化",
  PCI_CHANGED: "PCI 变化",
  BAND_CHANGED: "频段变化",
  CA_CHANGED: "载波聚合变化",
  NR_LOST: "NR 丢失",
  NR_RESTORED: "NR 恢复",
  CELLULAR_DOWN: "蜂窝断开",
  CELLULAR_UP: "蜂窝恢复",
  INTERNET_DOWN: "Internet 断开",
  INTERNET_UP: "Internet 恢复",
  HIGH_PACKET_LOSS: "高丢包",
  LOW_SINR: "低 SINR",
};

export function eventLabel(type: CpeEvent["type"]): string {
  return EVENT_LABELS[type];
}

export type EventTone = "info" | "warning" | "danger" | "success";

export function eventTone(type: CpeEvent["type"]): EventTone {
  if (type === "CELLULAR_DOWN" || type === "INTERNET_DOWN" || type === "NR_LOST" || type === "HIGH_PACKET_LOSS") {
    return "danger";
  }
  if (type === "CELLULAR_UP" || type === "INTERNET_UP" || type === "NR_RESTORED") {
    return "success";
  }
  if (type === "LOW_SINR") {
    return "warning";
  }
  return "info";
}

export function eventTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

export function eventDetail(item: CpeEvent): string {
  const transition = `${eventValue(item.oldValue)} → ${eventValue(item.newValue)}`;
  if (item.durationMs !== null) {
    return `${transition}，持续 ${formatDuration(item.durationMs)}`;
  }
  return transition;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
  return `${(durationMs / 1_000).toFixed(1)} 秒`;
}

export function capabilityText(value: CpeSnapshot["capabilities"][keyof CpeSnapshot["capabilities"]]): string {
  if (value === "observed") return "已观察";
  if (value === "unsupported") return "设备不支持/被拒绝";
  return "未验证";
}
