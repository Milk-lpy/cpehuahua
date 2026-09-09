import { carrierAggregationLabel, type CpeEvent, type CpeEventType, type CpeEventValue, type CpeSnapshot } from "@cpehuahua/core";

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
  if (id === "pingMs") return snapshot.network.pingMs;
  return snapshot.radio[id];
}

export interface ChartPoint {
  index: number;
  timestamp: string;
  value: number;
}

export function chartPoints(history: readonly CpeSnapshot[], id: DashboardMetricId): ChartPoint[] {
  return history.flatMap((snapshot, index) => {
    const value = metricValue(snapshot, id);
    return value === null || !Number.isFinite(value)
      ? []
      : [{ index, timestamp: snapshot.timestamp, value }];
  });
}

export function formatMetric(value: number | null, unit = ""): string {
  if (value === null || !Number.isFinite(value)) return "—";
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
  if (typeof value === "boolean") return value ? "在线" : "离线";
  return String(value);
}

const EVENT_LABELS: Record<CpeEventType, string> = {
  CELL_CHANGED: "服务小区变化",
  PCI_CHANGED: "PCI 变化",
  BAND_CHANGED: "主频段变化",
  CA_CHANGED: "载波组合变化",
  NR_LOST: "NR 信号丢失",
  NR_RESTORED: "NR 信号恢复",
  CELLULAR_DOWN: "蜂窝连接断开",
  CELLULAR_UP: "蜂窝连接恢复",
  INTERNET_DOWN: "Internet 路径断开",
  INTERNET_UP: "Internet 路径恢复",
  HIGH_PACKET_LOSS: "丢包率过高",
  PACKET_LOSS_RECOVERED: "丢包率恢复",
  LOW_SINR: "SINR 过低",
  SINR_RECOVERED: "SINR 恢复",
};

const EVENT_GROUPS: Record<CpeEventType, string> = {
  CELL_CHANGED: "蜂窝身份",
  PCI_CHANGED: "蜂窝身份",
  BAND_CHANGED: "无线参数",
  CA_CHANGED: "载波聚合",
  NR_LOST: "无线状态",
  NR_RESTORED: "无线状态",
  CELLULAR_DOWN: "连接状态",
  CELLULAR_UP: "连接状态",
  INTERNET_DOWN: "用户路径",
  INTERNET_UP: "用户路径",
  HIGH_PACKET_LOSS: "用户路径",
  PACKET_LOSS_RECOVERED: "用户路径",
  LOW_SINR: "无线质量",
  SINR_RECOVERED: "无线质量",
};

export function eventLabel(type: CpeEventType): string {
  return EVENT_LABELS[type];
}

export function eventGroupLabel(type: CpeEventType): string {
  return EVENT_GROUPS[type];
}

export type EventTone = "info" | "warning" | "danger" | "success";

export function eventTone(type: CpeEventType): EventTone {
  if (type === "CELLULAR_DOWN" || type === "INTERNET_DOWN" || type === "NR_LOST" || type === "HIGH_PACKET_LOSS") return "danger";
  if (type === "CELLULAR_UP" || type === "INTERNET_UP" || type === "NR_RESTORED" || type === "PACKET_LOSS_RECOVERED" || type === "SINR_RECOVERED") return "success";
  if (type === "LOW_SINR") return "warning";
  return "info";
}

export function eventToneLabel(type: CpeEventType): string {
  const tone = eventTone(type);
  if (tone === "danger") return "告警";
  if (tone === "warning") return "注意";
  if (tone === "success") return "恢复";
  return "记录";
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function eventTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function eventDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${eventTime(timestamp)}.${pad(date.getMilliseconds(), 3)}`;
}

function eventSpecificValue(type: CpeEventType, value: CpeEventValue): string {
  if (value === null) return "—";
  if (type === "NR_LOST" || type === "NR_RESTORED") {
    return value === true ? "检测到 NR" : value === false ? "未检测到 NR" : eventValue(value);
  }
  if (type === "CELLULAR_DOWN" || type === "CELLULAR_UP" || type === "INTERNET_DOWN" || type === "INTERNET_UP") {
    return value === true ? "在线" : value === false ? "离线" : eventValue(value);
  }
  if (type === "HIGH_PACKET_LOSS" || type === "PACKET_LOSS_RECOVERED") {
    return typeof value === "number" ? formatMetric(value, "%") : eventValue(value);
  }
  if (type === "LOW_SINR" || type === "SINR_RECOVERED") {
    return typeof value === "number" ? formatMetric(value, "dB") : eventValue(value);
  }
  return eventValue(value);
}

export interface EventTransition {
  before: string;
  after: string;
}

export function eventTransition(item: CpeEvent): EventTransition {
  return {
    before: eventSpecificValue(item.type, item.oldValue),
    after: eventSpecificValue(item.type, item.newValue),
  };
}

export function eventDetail(item: CpeEvent): string {
  const transition = eventTransition(item);
  const duration = item.durationMs !== null ? `，异常持续 ${formatDuration(item.durationMs)}` : "";
  switch (item.type) {
    case "CELL_CHANGED": return `服务小区由 ${transition.before} 切换为 ${transition.after}${duration}`;
    case "PCI_CHANGED": return `物理小区标识由 ${transition.before} 变为 ${transition.after}${duration}`;
    case "BAND_CHANGED": return `主载波频段由 ${transition.before} 变为 ${transition.after}${duration}`;
    case "CA_CHANGED": return `服务载波组合由 ${transition.before} 变为 ${transition.after}${duration}`;
    case "NR_LOST": return `NR 状态由 ${transition.before} 变为 ${transition.after}${duration}`;
    case "NR_RESTORED": return `NR 状态由 ${transition.before} 变为 ${transition.after}${duration}`;
    case "CELLULAR_DOWN": return `设备蜂窝连接由 ${transition.before} 变为 ${transition.after}${duration}`;
    case "CELLULAR_UP": return `设备蜂窝连接由 ${transition.before} 恢复为 ${transition.after}${duration}`;
    case "INTERNET_DOWN": return `用户路径由 ${transition.before} 变为 ${transition.after}${duration}`;
    case "INTERNET_UP": return `用户路径由 ${transition.before} 恢复为 ${transition.after}${duration}`;
    case "HIGH_PACKET_LOSS": return `丢包率由 ${transition.before} 升至 ${transition.after}${duration}`;
    case "PACKET_LOSS_RECOVERED": return `丢包率由 ${transition.before} 恢复至 ${transition.after}${duration}`;
    case "LOW_SINR": return `SINR 由 ${transition.before} 降至 ${transition.after}${duration}`;
    case "SINR_RECOVERED": return `SINR 由 ${transition.before} 恢复至 ${transition.after}${duration}`;
  }
}

export interface EventContextEntry {
  label: string;
  value: string;
}

type ContextBoundary = "previous" | "current";

function contextMetric(value: CpeEventValue | undefined, unit: string): string {
  if (typeof value === "number") return formatMetric(value, unit);
  return eventValue(value ?? null);
}

function contextStatus(value: CpeEventValue | undefined): string {
  return value === null || value === undefined ? "未验证" : eventValue(value);
}

export function eventContextEntries(item: CpeEvent, boundary: ContextBoundary = "current"): EventContextEntry[] {
  const context = boundary === "previous" ? item.previousContext : item.context;
  if (!context) return [];
  const radio = [context.radioMode ?? null, context.saNsa ?? null]
    .map(eventValue)
    .filter((value) => value !== "—")
    .join(" / ");
  return [
    { label: "网络制式", value: radio || "—" },
    { label: "蜂窝连接", value: contextStatus(context.cellularOnline) },
    { label: "Internet", value: contextStatus(context.internetOnline) },
    { label: "PLMN", value: eventValue(context.plmn ?? null) },
    { label: "频段", value: eventValue(context.band ?? null) },
    { label: "ARFCN", value: eventValue(context.arfcn ?? null) },
    { label: "带宽", value: eventValue(context.bandwidth ?? null) },
    { label: "PCI", value: eventValue(context.pci ?? null) },
    { label: "Cell ID", value: eventValue(context.cellId ?? null) },
    { label: "RRC", value: eventValue(context.rrcStatus ?? null) },
    { label: "载波数", value: eventValue(context.carrierCount ?? null) },
    { label: "载波组合", value: eventValue(context.carriers ?? context.ca ?? null) },
    { label: "RSRP", value: contextMetric(context.rsrpDbm, "dBm") },
    { label: "RSRQ", value: contextMetric(context.rsrqDb, "dB") },
    { label: "RSSI", value: contextMetric(context.rssiDbm, "dBm") },
    { label: "SINR", value: contextMetric(context.sinrDb, "dB") },
    { label: "CQI", value: contextMetric(context.cqi, "") },
    { label: "MIMO Rank", value: contextMetric(context.mimoRank, "") },
    { label: "BLER", value: contextMetric(context.blerPct, "%") },
    { label: "Ping", value: contextMetric(context.pingMs, "ms") },
    { label: "抖动", value: contextMetric(context.jitterMs, "ms") },
    { label: "丢包", value: contextMetric(context.packetLossPct, "%") },
  ].filter((entry) => entry.value !== "—");
}

export function eventSourceLabel(item: CpeEvent): string {
  if (item.type === "INTERNET_DOWN" || item.type === "INTERNET_UP" || item.type === "HIGH_PACKET_LOSS" || item.type === "PACKET_LOSS_RECOVERED") {
    return "Internet 用户路径探测";
  }
  return item.context.source === "live" ? "H168 实机实时轮询" : "设备快照对比";
}

export interface EventObservationWindow {
  start: string | null;
  end: string;
  durationMs: number | null;
  label: string;
}

export function eventObservationWindow(item: CpeEvent): EventObservationWindow {
  const startMs = item.previousTimestamp ? Date.parse(item.previousTimestamp) : Number.NaN;
  const endMs = Date.parse(item.timestamp);
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : null;
  return {
    start: item.previousTimestamp ?? null,
    end: item.timestamp,
    durationMs,
    label: item.previousTimestamp
      ? `${eventDateTime(item.previousTimestamp)} 后 ～ ${eventDateTime(item.timestamp)}`
      : `最迟于 ${eventDateTime(item.timestamp)} 确认`,
  };
}

export interface TimelineEventGroup {
  timestamp: string;
  previousTimestamp: string | null;
  events: CpeEvent[];
  tone: EventTone;
}

const TONE_PRIORITY: Record<EventTone, number> = { info: 0, success: 1, warning: 2, danger: 3 };

export function groupTimelineEvents(events: readonly CpeEvent[]): TimelineEventGroup[] {
  const groups = new Map<string, TimelineEventGroup>();
  for (const item of events) {
    const previousTimestamp = item.previousTimestamp ?? null;
    const key = `${previousTimestamp ?? "legacy"}\u0000${item.timestamp}`;
    const existing = groups.get(key);
    const tone = eventTone(item.type);
    if (existing) {
      existing.events.push(item);
      if (TONE_PRIORITY[tone] > TONE_PRIORITY[existing.tone]) existing.tone = tone;
    } else {
      groups.set(key, { timestamp: item.timestamp, previousTimestamp, events: [item], tone });
    }
  }
  return [...groups.values()].sort((left, right) => {
    const leftMs = Date.parse(left.timestamp);
    const rightMs = Date.parse(right.timestamp);
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return rightMs - leftMs;
    return right.timestamp.localeCompare(left.timestamp);
  });
}

export function samplingIntervalMs(history: readonly CpeSnapshot[]): number | null {
  const timestamps = history.slice(-30).map((item) => Date.parse(item.timestamp)).filter(Number.isFinite);
  const intervals = timestamps.slice(1).map((value, index) => value - timestamps[index]!).filter((value) => value > 0);
  if (!intervals.length) return null;
  intervals.sort((left, right) => left - right);
  const middle = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[middle - 1]! + intervals[middle]!) / 2
    : intervals[middle]!;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)} 毫秒`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} 秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = ((durationMs % 60_000) / 1_000).toFixed(1);
  return `${minutes} 分 ${seconds} 秒`;
}
