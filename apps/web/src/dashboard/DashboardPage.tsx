import { useState } from "react";
import { distinctServingCells, type CpeCell, type CpeEvent, type CpeSnapshot } from "@cpehuahua/core";
import { BottomNav, type AppView } from "../ui/BottomNav";
import { BandLockPage, ConfirmDialog, ControlPage, ManagedClients, MessagesPage, SettingsPage } from "../control/ControlPages";
import { H168ControlClient } from "../control/client";
import { loadUiPreferences, saveUiPreferences, type UiPreferences } from "../live/ui-preferences";
import type { ColorTheme } from "../live/theme";
import { ThemeToggle } from "../ui/ThemeToggle";
import {
  aggregationLabel,
  chartPoints,
  DASHBOARD_METRICS,
  eventContextEntries,
  eventDateTime,
  eventDetail,
  eventGroupLabel,
  eventLabel,
  eventObservationWindow,
  eventSourceLabel,
  eventTime,
  eventTone,
  eventToneLabel,
  eventTransition,
  formatDuration,
  formatMetric,
  groupTimelineEvents,
  metricDefinition,
  samplingIntervalMs,
  statusText,
  type DashboardMetricId,
} from "./view-model";

interface DashboardPageProps {
  activeView: AppView;
  snapshot: CpeSnapshot | null;
  history: readonly CpeSnapshot[];
  events: readonly CpeEvent[];
  cached: boolean;
  liveMonitoring: boolean;
  liveError: string | null;
  networkProbeConfigured: boolean;
  onToggleLive: () => void;
  onRetryLive: () => void;
  onNavigate: (view: AppView) => void;
  onClearCache: () => void;
  controlClient: H168ControlClient;
  rememberPassword: boolean;
  autoLogin: boolean;
  theme: ColorTheme;
  onRememberPasswordChange: (value: boolean) => void;
  onAutoLoginChange: (value: boolean) => void;
  onThemeChange: (theme: ColorTheme) => void;
  onLogout: () => void;
}

function Value({ value, unit = "" }: { value: number | string | null; unit?: string }) {
  if (value === null || value === "") return <span className="value-null">—</span>;
  return <>{typeof value === "number" ? formatMetric(value, unit) : value}</>;
}

function DetailList({ items }: { items: Array<[string, number | string | null, string?]> }) {
  return <dl className="detail-list">{items.map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd><Value value={value} unit={unit ?? ""} /></dd></div>)}</dl>;
}

function SectionTitle({ eyebrow, title, badge }: { eyebrow: string; title: string; badge?: string | number | undefined }) {
  return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{badge !== undefined && <span className="count-badge">{badge}</span>}</div>;
}

function PageHeader({ liveMonitoring, theme, onToggleLive, onThemeChange }: { liveMonitoring: boolean; theme: ColorTheme; onToggleLive: () => void; onThemeChange: (theme: ColorTheme) => void }) {
  return <header className="app-header">
    <div className="brand-line"><span className="brand-paw brand-paw--rose" aria-hidden="true">●</span><strong>CPE 花花</strong><button className={`live-switch ${liveMonitoring ? "is-live" : ""}`} type="button" onClick={onToggleLive} aria-label={liveMonitoring ? "暂停实时监控" : "启动实时监控"}><i />{liveMonitoring ? "Live" : "已暂停"}<span aria-hidden="true">⌁</span></button><ThemeToggle theme={theme} onChange={onThemeChange} /></div>
  </header>;
}

function LineChart({ history, metric }: { history: readonly CpeSnapshot[]; metric: DashboardMetricId }) {
  const points = chartPoints(history, metric), definition = metricDefinition(metric);
  const width = 360, height = 118, left = 10, right = 350, top = 10, bottom = 103;
  const values = points.map((point) => point.value), rawMin = values.length ? Math.min(...values) : 0, rawMax = values.length ? Math.max(...values) : 1;
  const padding = rawMin === rawMax ? Math.max(1, Math.abs(rawMin) * .08) : (rawMax - rawMin) * .12, min = rawMin - padding, max = rawMax + padding;
  const x = (index: number) => history.length <= 1 ? 180 : left + (index / (history.length - 1)) * (right - left);
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  return <div className="chart-wrap"><div className="chart-heading"><div><p className="eyebrow">最近 {history.length} 个采样</p><h3>{definition.label} 趋势</h3></div><strong>{formatMetric(points.at(-1)?.value ?? null, definition.unit)}</strong></div><svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${definition.label} 趋势`}>{[.25, .5, .75].map((ratio) => <line key={ratio} x1={left} x2={right} y1={top + (bottom - top) * ratio} y2={top + (bottom - top) * ratio} className="chart-gridline" />)}{path && <path d={path} className="chart-line" />}{points.map((point) => <circle key={`${point.timestamp}-${point.index}`} cx={x(point.index)} cy={y(point.value)} r="2.6" className="chart-point" />)}{!path && <text x="180" y="62" textAnchor="middle" className="chart-empty">等待已验证数据</text>}</svg></div>;
}

function SignalRing({ value }: { value: number | null }) {
  const score = value === null ? 0 : Math.max(0, Math.min(100, (value + 125) * 2));
  const quality = value === null ? "未返回" : value >= -85 ? "优" : value >= -95 ? "良" : value >= -105 ? "一般" : "弱";
  return <div className="signal-ring">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="signal-ring__track" cx="60" cy="60" r="50" pathLength="100" /><circle className="signal-ring__value" cx="60" cy="60" r="50" pathLength="100" strokeDasharray={`${score} 100`} /></svg>
    <div><span>信号强度</span><strong>{value === null ? "—" : value}</strong><small>{quality}</small></div>
  </div>;
}

function SignalBar({ label, value, unit, min, max }: { label: string; value: number | null; unit: string; min: number; max: number }) {
  const score = value === null ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const tone = score >= 60 ? "good" : score >= 32 ? "fair" : "poor";
  return <div className="radio-stat"><span>{label}</span><strong>{formatMetric(value, unit)}</strong><i><b className={`is-${tone}`} style={{ transform: `scaleX(${score / 100})` }} /></i></div>;
}

function Sparkline({ history, field }: { history: readonly CpeSnapshot[]; field: "downloadBps" | "uploadBps" }) {
  const values = history.slice(-24).map((item) => item.network[field]).filter((value): value is number => value !== null);
  if (values.length < 2) return <span className="sparkline-empty">⌁</span>;
  const max = Math.max(...values, 1), width = 86, height = 30;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * width},${height - (value / max) * (height - 4)}`).join(" ");
  return <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} /></svg>;
}

function formatRate(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Kbps`;
  return `${value} bps`;
}

function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(2)} GB`;
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(2)} MB`;
  if (value >= 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${value} B`;
}

function combinedBytes(download: number | null, upload: number | null): number | null {
  return download === null && upload === null ? null : (download ?? 0) + (upload ?? 0);
}

function CarrierCard({ cell, role }: { cell: CpeCell; role: "PCC" | "SCC" }) {
  return <article className="carrier-card"><div className="carrier-heading"><span className={`carrier-role carrier-role--${role.toLowerCase()}`}>{role}</span><strong>{cell.band ?? cell.technology} · {cell.bandwidth ?? "带宽未返回"}</strong><dl><div><dt>NRARFCN</dt><dd>{cell.arfcn ?? "—"}</dd></div><div><dt>PCI</dt><dd>{cell.pci ?? "—"}</dd></div></dl></div><div className="radio-stat-grid"><SignalBar label="RSRP" value={cell.rsrpDbm} unit="dBm" min={-125} max={-70} /><SignalBar label="RSRQ" value={cell.rsrqDb} unit="dB" min={-25} max={-3} /><SignalBar label="RSSI" value={cell.rssiDbm} unit="dBm" min={-105} max={-45} /><SignalBar label="SINR" value={cell.sinrDb} unit="dB" min={-10} max={30} /></div></article>;
}

function numericInput(value: number | null): string { return value === null ? "" : String(value); }
function inputNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : null;
}

function TrafficPanel({ snapshot, history, client }: { snapshot: CpeSnapshot; history: readonly CpeSnapshot[]; client: H168ControlClient }) {
  const [preferences, setPreferences] = useState<UiPreferences>(() => loadUiPreferences());
  const [editing, setEditing] = useState(false);
  const [pendingClear, setPendingClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(patch: Partial<UiPreferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveUiPreferences(next);
  }

  async function clearTraffic() {
    setPendingClear(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.execute<{ accepted: boolean; verified: boolean; readbackAvailable: boolean; monthLastClearDate: string | null }>("traffic.clear");
      if (!result.data?.accepted) throw new Error("设备未确认接收清零请求");
      setNotice(result.data.verified
        ? `流量统计已清零并确认计数变化${result.data.monthLastClearDate ? `（${result.data.monthLastClearDate}）` : ""}。`
        : result.data.readbackAvailable
          ? "设备已接受请求并返回最新统计，但计数变化尚不足以确认清零。"
          : "设备已接受清零请求，等待实时统计刷新。" );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "流量统计清零失败");
    } finally {
      setBusy(false);
    }
  }

  return <><section className="soft-panel speed-panel"><SectionTitle eyebrow="实时速率" title="" badge="1 秒刷新" /><div className="speed-grid speed-grid--spark"><div><b className="rate-icon rate-icon--down">↓</b><span>下载<strong>{formatRate(snapshot.network.downloadBps)}</strong></span><Sparkline history={history} field="downloadBps" /></div><div><b className="rate-icon rate-icon--up">↑</b><span>上传<strong>{formatRate(snapshot.network.uploadBps)}</strong></span><Sparkline history={history} field="uploadBps" /></div></div></section>
    <section className="soft-panel contract-panel"><div className="section-heading"><div><p className="eyebrow">签约速率</p><h2>宽带套餐</h2></div><button type="button" className="icon-button" aria-label="编辑签约速率" onClick={() => setEditing((value) => !value)}>↻</button></div><div className="contract-grid"><label>下行<input inputMode="decimal" placeholder="--" value={numericInput(preferences.contractedDownloadMbps)} disabled={!editing} onChange={(event) => update({ contractedDownloadMbps: inputNumber(event.target.value) })} /><small>Mbps</small></label><label>上行<input inputMode="decimal" placeholder="--" value={numericInput(preferences.contractedUploadMbps)} disabled={!editing} onChange={(event) => update({ contractedUploadMbps: inputNumber(event.target.value) })} /><small>Mbps</small></label></div><p className="panel-note">签约速率仅保存在当前浏览器，用于和实时速率对照。</p></section>
    <section className="soft-panel traffic-panel"><div className="section-heading"><div><p className="eyebrow">流量统计</p><h2>套餐与用量</h2></div><span className="muted-label">上次清空 {snapshot.network.monthLastClearDate ?? "—"}</span></div><div className="plan-settings"><label><span><strong>日套餐设置</strong><small>{preferences.dayLimitGb ? `${preferences.dayLimitGb} GB` : "未设置额度"}</small></span><input type="checkbox" checked={preferences.dayPlanEnabled} onChange={(event) => update({ dayPlanEnabled: event.target.checked })} /></label>{preferences.dayPlanEnabled && <label className="limit-input">每日额度<input inputMode="decimal" value={numericInput(preferences.dayLimitGb)} onChange={(event) => update({ dayLimitGb: inputNumber(event.target.value) })} /><span>GB</span></label>}<label><span><strong>月套餐设置</strong><small>{preferences.monthLimitGb ? `${preferences.monthLimitGb} GB` : "未设置额度"}</small></span><input type="checkbox" checked={preferences.monthPlanEnabled} onChange={(event) => update({ monthPlanEnabled: event.target.checked })} /></label>{preferences.monthPlanEnabled && <label className="limit-input">每月额度<input inputMode="decimal" value={numericInput(preferences.monthLimitGb)} onChange={(event) => update({ monthLimitGb: inputNumber(event.target.value) })} /><span>GB</span></label>}</div><div className="usage-table"><div><b>类型</b><b>当前</b><b>日</b><b>月</b></div><div><span>已用</span><strong>{formatBytes(combinedBytes(snapshot.network.currentDownloadBytes, snapshot.network.currentUploadBytes))}</strong><strong>{formatBytes(snapshot.network.dayUsedBytes)}</strong><strong>{formatBytes(combinedBytes(snapshot.network.monthDownloadBytes, snapshot.network.monthUploadBytes))}</strong></div><div><span>时间</span><strong>{formatUptime(snapshot.network.currentConnectSeconds)}</strong><strong>{formatUptime(snapshot.network.dayDurationSeconds)}</strong><strong>{formatUptime(snapshot.network.monthDurationSeconds)}</strong></div></div><button className="primary-button clear-traffic-button" type="button" disabled={busy} onClick={() => setPendingClear(true)}>{busy ? "正在清零…" : "清空流量统计"}</button>{notice && <p className="action-notice">{notice}</p>}{error && <p className="action-error" role="alert">{error}</p>}</section>
    <ConfirmDialog open={pendingClear} title="清空设备流量统计？" detail="会清除 H168 中的累计流量和统计周期，操作不可撤销；不会删除短信或终端设置。" confirmLabel="确认清空" danger onCancel={() => setPendingClear(false)} onConfirm={() => void clearTraffic()} /></>;
}

function Overview({ snapshot, history, events, networkProbeConfigured, onNavigate, controlClient }: { snapshot: CpeSnapshot; history: readonly CpeSnapshot[]; events: readonly CpeEvent[]; networkProbeConfigured: boolean; onNavigate: (view: AppView) => void; controlClient: H168ControlClient }) {
  const [metric, setMetric] = useState<DashboardMetricId>("rsrpDbm");
  const servingCells = distinctServingCells(snapshot);
  const pcc = servingCells.find((cell) => cell.role === "pcc") ?? null;
  const secondaryCells = servingCells.filter((cell) => cell.role === "scell");
  return <>
    <section className="hero-card hero-card--focus"><div className="hero-title"><div><h1>{snapshot.connection.operatorName ?? "蜂窝网络"} {snapshot.connection.radioMode === "5G" ? "5G-A" : snapshot.connection.radioMode}</h1><p>{snapshot.device.model ?? "H168"} · {snapshot.connection.saNsa} · {new Date(snapshot.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</p></div><span className={snapshot.connection.cellularOnline ? "is-online" : ""}>{statusText(snapshot.connection.cellularOnline)}</span></div><div className="signal-stage"><SignalRing value={snapshot.radio.rsrpDbm} /><p>当前信号强度 · 数值越接近 0 越好</p></div></section>
    <section className="soft-panel carrier-panel"><SectionTitle eyebrow="信号详情" title="服务载波" badge={servingCells.length} /><div className="carrier-list">{pcc ? <CarrierCard cell={pcc} role="PCC" /> : <Empty text="当前没有可用的主载波数据。" />}{secondaryCells.map((cell, index) => <CarrierCard key={`scc-${cell.arfcn ?? index}-${cell.pci ?? index}`} cell={cell} role="SCC" />)}</div></section>
    <TrafficPanel snapshot={snapshot} history={history} client={controlClient} />
    <ManagedClients client={controlClient} />
    <section className="soft-panel telemetry-panel"><SectionTitle eyebrow="实时曲线（最近 60 秒）" title="" /><div className="metric-tabs">{DASHBOARD_METRICS.slice(0, 4).map((item) => <button key={item.id} type="button" className={metric === item.id ? "is-active" : ""} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div><LineChart history={history} metric={metric} /></section>
    <section className="soft-panel log-preview-panel"><div className="section-heading"><div><p className="eyebrow">本地实时记录</p><h2>设备日志</h2></div><div className="section-heading__actions"><span className="count-badge">{events.length}</span><button className="soft-button" type="button" onClick={() => onNavigate("logs")}>全部日志</button></div></div>{events.length === 0 ? <Empty text="保持实时监控，信号和小区变化会记录在这里。" /> : <EventList events={events.slice(-3)} />}{!networkProbeConfigured && <p className="panel-note">Internet 用户路径探测尚未配置，状态保持未验证。</p>}</section>
  </>;
}

function EventList({ events, detailed = false }: { events: readonly CpeEvent[]; detailed?: boolean }) {
  if (!detailed) {
    return <ol className="event-list">{events.slice().reverse().map((item, index) => {
      const tone = eventTone(item.type);
      return <li className={`event-item event-item--${tone}`} key={`${item.timestamp}-${item.type}-${index}`}>
        <div className="event-item__time"><time dateTime={item.timestamp}>{eventTime(item.timestamp)}</time></div>
        <div className="event-item__body"><div className="event-item__title"><strong>{eventLabel(item.type)}</strong><span className="event-group">{eventGroupLabel(item.type)}</span></div><p className="event-transition">{eventDetail(item)}</p></div>
      </li>;
    })}</ol>;
  }

  return <ol className="event-timeline">{groupTimelineEvents(events).map((group, groupIndex) => {
    const representative = group.events[0]!;
    const window = eventObservationWindow(representative);
    const previousContext = eventContextEntries(representative, "previous");
    const currentContext = eventContextEntries(representative);
    return <li className={`timeline-node timeline-node--${group.tone}`} key={`${group.previousTimestamp ?? "legacy"}-${group.timestamp}-${groupIndex}`}>
      <article className="timeline-card">
        <header className="timeline-card__header">
          <div><small>确认采样</small><time dateTime={group.timestamp}>{eventDateTime(group.timestamp)}</time></div>
          <span>{group.events.length} 项变化</span>
        </header>
        <div className="observation-window">
          <span>检测窗口</span>
          <strong>{window.label}</strong>
          <small>{window.durationMs === null ? "旧日志没有前一采样边界，无法计算时间精度。" : `窗口宽度 ${formatDuration(window.durationMs)}；变化发生在此区间内，结束时间是系统确认时间。`}</small>
        </div>
        <div className="timeline-changes">{group.events.map((item, index) => {
          const tone = eventTone(item.type);
          const transition = eventTransition(item);
          return <section className={`timeline-change timeline-change--${tone}`} key={`${item.type}-${index}`}>
            <div className="timeline-change__heading"><div><strong>{eventLabel(item.type)}</strong><span>{eventGroupLabel(item.type)}</span></div><span className={`event-severity event-severity--${tone}`}>{eventToneLabel(item.type)}</span></div>
            <p>{eventDetail(item)}</p>
            <div className="transition-values"><span><small>前一采样</small><b>{transition.before}</b></span><i aria-hidden="true">→</i><span><small>确认采样</small><b>{transition.after}</b></span></div>
            <div className="event-source"><span aria-hidden="true">◎</span><span>数据来源：{eventSourceLabel(item)}</span>{item.durationMs !== null && <b>异常历时 {formatDuration(item.durationMs)}</b>}</div>
          </section>;
        })}</div>
        <div className="event-context event-context--summary">{currentContext.slice(0, 10).map((entry) => <span key={`${entry.label}-${entry.value}`}><small>{entry.label}</small><b>{entry.value}</b></span>)}</div>
        <details className="timeline-evidence">
          <summary>查看前后两次完整采样证据</summary>
          <div className="timeline-evidence__grid">
            <section><h3>前一采样</h3><time dateTime={group.previousTimestamp ?? undefined}>{group.previousTimestamp ? eventDateTime(group.previousTimestamp) : "时间未知"}</time>{previousContext.length ? <dl>{previousContext.map((entry) => <div key={`before-${entry.label}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl> : <p>旧日志未保存前一采样上下文。</p>}</section>
            <section><h3>确认采样</h3><time dateTime={group.timestamp}>{eventDateTime(group.timestamp)}</time><dl>{currentContext.map((entry) => <div key={`after-${entry.label}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl></section>
          </div>
        </details>
      </article>
    </li>;
  })}</ol>;
}

function activeOutageDuration(events: readonly CpeEvent[], snapshotTimestamp: string, scope: "cellular" | "internet"): { startedAt: string; durationMs: number } | null {
  const downType = scope === "cellular" ? "CELLULAR_DOWN" : "INTERNET_DOWN";
  const upType = scope === "cellular" ? "CELLULAR_UP" : "INTERNET_UP";
  const latestStateEvent = events.slice().reverse().find((item) => item.type === downType || item.type === upType);
  if (!latestStateEvent || latestStateEvent.type !== downType) return null;
  const durationMs = Date.parse(snapshotTimestamp) - Date.parse(latestStateEvent.timestamp);
  return Number.isFinite(durationMs) && durationMs >= 0 ? { startedAt: latestStateEvent.timestamp, durationMs } : null;
}

function DeviceLogsPage({ events, history, snapshot, networkProbeConfigured }: { events: readonly CpeEvent[]; history: readonly CpeSnapshot[]; snapshot: CpeSnapshot; networkProbeConfigured: boolean }) {
  const orderedEvents = events.slice().reverse();
  const latestEvent = orderedEvents[0] ?? null;
  const attentionCount = events.filter((event) => eventTone(event.type) === "danger" || eventTone(event.type) === "warning").length;
  const cellularOutage = snapshot.connection.cellularOnline === false ? activeOutageDuration(events, snapshot.timestamp, "cellular") : null;
  const internetOutage = snapshot.connection.internetOnline === false ? activeOutageDuration(events, snapshot.timestamp, "internet") : null;
  const cadenceMs = samplingIntervalMs(history);
  const currentStatus = snapshot.connection.cellularOnline === false
    ? "蜂窝离线"
    : snapshot.connection.internetOnline === false
      ? "Internet 断开"
      : snapshot.connection.cellularOnline === true && snapshot.connection.internetOnline === true
        ? "连接正常"
        : snapshot.connection.cellularOnline === true
          ? "蜂窝在线 / Internet 未验证"
          : "状态未验证";
  return <>
    <section className="soft-panel event-hero">
      <div className="section-heading"><div><p className="eyebrow">连续实时快照</p><h2>设备日志</h2></div><span className="count-badge">{events.length} 条</span></div>
      <p className="logs-lede">只记录实时采样实际确认的连接、小区、载波与网络质量变化。日志时间是确认时刻，真实变化发生在前后两次采样之间。</p>
      <div className="log-summary-grid">
        <div><small>当前状态</small><strong>{currentStatus}</strong><span>最新快照 {eventTime(snapshot.timestamp)}</span></div>
        <div><small>采样精度</small><strong>{cadenceMs === null ? "等待样本" : formatDuration(cadenceMs)}</strong><span>最近 30 份快照中位间隔</span></div>
        <div><small>告警 / 注意</small><strong>{attentionCount}</strong><span>本地会话累计</span></div>
        <div><small>最后记录</small><strong>{latestEvent ? eventTime(latestEvent.timestamp) : "—"}</strong><span>{latestEvent ? eventLabel(latestEvent.type) : "暂无日志"}</span></div>
      </div>
      <div className="active-outages">
        {cellularOutage && <div className="outage-card"><span>蜂窝中断持续</span><strong>{formatDuration(cellularOutage.durationMs)}</strong><small>最迟于 {eventDateTime(cellularOutage.startedAt)} 确认断开</small></div>}
        {internetOutage && <div className="outage-card"><span>Internet 路径中断持续</span><strong>{formatDuration(internetOutage.durationMs)}</strong><small>最迟于 {eventDateTime(internetOutage.startedAt)} 确认断开</small></div>}
      </div>
      {!cellularOutage && !internetOutage && <p className="panel-note">当前没有从事件序列确认的持续中断。</p>}
      {!networkProbeConfigured && <p className="panel-note">Internet 用户路径探测尚未配置，因此不会推断 Internet 断开或恢复；蜂窝设备日志不受影响。</p>}
    </section>
    <section className="soft-panel timeline-panel"><SectionTitle eyebrow="采样证据时间线" title="全部记录" badge={events.length} />{events.length ? <EventList events={events} detailed /> : <Empty text="暂无设备日志。保持实时监控后，已确认的状态变化会显示在这里。" />}</section>
  </>;
}

function ParametersPage({ snapshot, events, cached, onClearCache, onNavigate }: { snapshot: CpeSnapshot; events: readonly CpeEvent[]; cached: boolean; onClearCache: () => void; onNavigate: (view: AppView) => void }) {
  return <>
    <section className="soft-panel log-entry-panel"><div><p className="eyebrow">独立时间线</p><h2>设备日志</h2><p>查看连接、小区、频段和信号质量的详细变化。</p></div><button className="primary-button" type="button" onClick={() => onNavigate("logs")}>查看 {events.length} 条日志</button></section>
    <section className="soft-panel"><SectionTitle eyebrow="Device" title="设备信息" /><DetailList items={[["设备型号", snapshot.device.model], ["产品名称", snapshot.device.productName], ["开机时长", formatUptime(snapshot.device.uptimeSeconds)], ["硬件版本", snapshot.device.hardwareVersion], ["软件版本", snapshot.device.firmware], ["Web UI 版本", snapshot.device.webUiVersion], ["参数版本", snapshot.device.parameterVersion]]} /></section>
    <section className="soft-panel"><SectionTitle eyebrow="Network identity" title="网络身份" /><DetailList items={[["运营商", snapshot.connection.operatorName], ["PLMN", snapshot.connection.plmn], ["Huawei 状态码", snapshot.connection.cellularStatusCode], ["模式", snapshot.connection.radioMode], ["SA / NSA", snapshot.connection.saNsa], ["Cell ID", snapshot.radio.cellId], ["TAC", snapshot.radio.tac]]} /></section>
    <section className="soft-panel"><SectionTitle eyebrow="Advanced radio" title="无线参数" /><DetailList items={[["Band", snapshot.radio.band], ["Bandwidth", snapshot.radio.bandwidth], ["RRC 原始状态", snapshot.radio.rrcStatus], ["CQI", snapshot.radio.cqi], ["MIMO Rank", snapshot.radio.mimoRank], ["BLER", snapshot.radio.blerPct, "%"], ["MCS (DL) 原始", snapshot.radio.rawEvidence?.dlMcs ?? null], ["MCS (UL) 原始", snapshot.radio.rawEvidence?.ulMcs ?? null], ["TX Power 原始", snapshot.radio.rawEvidence?.txPower ?? null]]} /><p className="panel-note">复合字段保留设备原文，不把多载波表达式伪装成单个数值。</p></section>
    <section className="soft-panel privacy-card"><SectionTitle eyebrow="Privacy" title="本地数据" /><p>短信正文、手机号、终端 IP/MAC、密码、Session 和 Token 均不写入快照缓存；终端别名仅按不含 MAC 的 Host ID 保存在当前浏览器。</p>{cached && <button className="danger-soft-button" type="button" onClick={onClearCache}>清除本地快照</button>}</section>
  </>;
}

function formatUptime(seconds: number | null): string { if (seconds === null) return "—"; const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60); return `${days ? `${days}天 ` : ""}${hours}时${minutes}分`; }
function Empty({ text }: { text: string }) { return <div className="empty-state"><span aria-hidden="true">⌁</span><p>{text}</p></div>; }

export function DashboardPage(props: DashboardPageProps) {
  const { snapshot, activeView, liveMonitoring, liveError, cached, onNavigate } = props;
  if (snapshot === null) return <main className="app-shell"><header className="app-header"><div className="brand-line"><span className="brand-paw">●</span><strong>CPE 花花</strong><i>已登录</i></div><h1>正在连接 H168</h1><p className="lede">认证已通过，正在读取第一份实时快照。</p><button className="primary-button" type="button" onClick={props.onRetryLive} disabled={liveMonitoring}>{liveMonitoring ? "实时抓取中…" : "重新连接"}</button></header>{liveError && <div className="error-banner" role="alert">{liveError}</div>}<BottomNav active={activeView} onNavigate={onNavigate} /></main>;
  return <main className="app-shell dashboard-shell">
    <PageHeader liveMonitoring={liveMonitoring} theme={props.theme} onToggleLive={props.onToggleLive} onThemeChange={props.onThemeChange} />
    {liveError && <div className="error-banner dashboard-error" role="alert">{liveError}</div>}
    {snapshot.source !== "live" && <div className="evidence-banner">当前为 {snapshot.source === "fixture" ? "fixture 参考" : "未知来源"}，不代表实机验证。</div>}
    {cached && <div className="evidence-banner evidence-banner--cached">正在显示浏览器保存的最近快照，实时连接建立后会更新。</div>}
    {activeView === "overview" && <Overview snapshot={snapshot} history={props.history} events={props.events} networkProbeConfigured={props.networkProbeConfigured} onNavigate={onNavigate} controlClient={props.controlClient} />}
    {activeView === "logs" && <DeviceLogsPage events={props.events} history={props.history} snapshot={snapshot} networkProbeConfigured={props.networkProbeConfigured} />}
    {activeView === "control" && <ControlPage client={props.controlClient} />}
    {activeView === "cells" && <BandLockPage client={props.controlClient} snapshot={snapshot} />}
    {activeView === "parameters" && <ParametersPage snapshot={snapshot} events={props.events} cached={cached} onClearCache={props.onClearCache} onNavigate={onNavigate} />}
    {activeView === "messages" && <MessagesPage client={props.controlClient} summary={snapshot.messaging} />}
    {activeView === "settings" && <SettingsPage client={props.controlClient} rememberPassword={props.rememberPassword} autoLogin={props.autoLogin} theme={props.theme} onRememberPasswordChange={props.onRememberPasswordChange} onAutoLoginChange={props.onAutoLoginChange} onThemeChange={props.onThemeChange} onLogout={props.onLogout} />}
    <BottomNav active={activeView} onNavigate={onNavigate} />
  </main>;
}
