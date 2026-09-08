import { useState } from "react";
import { isMirroredSecondaryCell, type CapabilityStatus, type CpeCell, type CpeEvent, type CpeSnapshot } from "@cpehuahua/core";
import { BottomNav, type AppView } from "../ui/BottomNav";
import { BandLockPage, ControlPage, ManagedClients, MessagesPage } from "../control/ControlPages";
import { H168ControlClient } from "../control/client";
import { aggregationLabel, capabilityText, chartPoints, DASHBOARD_METRICS, eventContextEntries, eventDateTime, eventDetail, eventGroupLabel, eventLabel, eventTime, eventTone, eventToneLabel, formatDuration, formatMetric, metricDefinition, statusText, type DashboardMetricId } from "./view-model";

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

function PageHeader({ liveMonitoring, onToggleLive }: { liveMonitoring: boolean; onToggleLive: () => void }) {
  return <header className="app-header">
    <div className="brand-line"><span className="brand-paw brand-paw--rose" aria-hidden="true">●</span><strong>CPE 花花</strong><button className={`live-switch ${liveMonitoring ? "is-live" : ""}`} type="button" onClick={onToggleLive} aria-label={liveMonitoring ? "暂停实时监控" : "启动实时监控"}><i />{liveMonitoring ? "Live" : "已暂停"}<span aria-hidden="true">⌁</span></button></div>
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
  return <div className="signal-ring">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="signal-ring__track" cx="60" cy="60" r="50" pathLength="100" /><circle className="signal-ring__value" cx="60" cy="60" r="50" pathLength="100" strokeDasharray={`${score} 100`} /></svg>
    <div><span>RSRP</span><strong>{value === null ? "—" : value}</strong><small>{value === null ? "未返回" : "dBm"}</small></div>
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

function Overview({ snapshot, history, events, networkProbeConfigured, onNavigate }: { snapshot: CpeSnapshot; history: readonly CpeSnapshot[]; events: readonly CpeEvent[]; networkProbeConfigured: boolean; onNavigate: (view: AppView) => void }) {
  const [metric, setMetric] = useState<DashboardMetricId>("rsrpDbm"), pcc = snapshot.cells.pcc;
  const secondaryCells = snapshot.cells.scells;
  return <>
    <section className="hero-card hero-card--focus"><div className="hero-title"><div><h1>{snapshot.device.model ?? "H168"}</h1><p>◷ 本地监控快照 · {new Date(snapshot.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</p></div><span>{snapshot.connection.operatorName ?? "蜂窝网络"} {snapshot.connection.radioMode}</span></div><div className="signal-stage"><SignalRing value={snapshot.radio.rsrpDbm} /><aside><small>RSRP</small><strong>{formatMetric(snapshot.radio.rsrpDbm, "dBm")}</strong></aside><p>♧ 数值越大越好</p></div><div className="connection-deck"><div><b className="cellular-icon">▥</b><span><strong>蜂窝 <em>{statusText(snapshot.connection.cellularOnline)}</em></strong><small>蜂窝网络状态</small></span></div><div><b className="internet-icon">◎</b><span><strong>Internet <em>{statusText(snapshot.connection.internetOnline)}</em></strong><small>互联网连接状态</small></span></div></div></section>
    <section className="soft-panel serving-panel"><SectionTitle eyebrow="服务小区（当前主小区 PCC）" title="" badge="⌃" /><div className="serving-identity"><span>{snapshot.connection.radioMode} {snapshot.connection.saNsa}</span><strong>{pcc?.band ?? "频段未返回"} · {pcc?.bandwidth ?? "—"}</strong><dl><div><dt>NRARFCN</dt><dd>{pcc?.arfcn ?? "—"}</dd></div><div><dt>PCI</dt><dd>{pcc?.pci ?? "—"}</dd></div><div><dt>PLMN</dt><dd>{snapshot.connection.plmn ?? "—"}</dd></div></dl></div><div className="secondary-band-row"><span className="secondary-band-label">另外的 SCC</span><div className="secondary-band-values">{secondaryCells.length ? secondaryCells.map((cell, index) => { const mirrored = isMirroredSecondaryCell(snapshot, cell); return <span className={`secondary-band-chip${mirrored ? " is-mirrored" : ""}`} key={`${cell.arfcn ?? "unknown"}-${index}`}><strong>{cell.band ?? "频段未返回"}</strong><small>{cell.arfcn ? `ARFCN ${cell.arfcn}` : "ARFCN 未返回"}{mirrored ? " · PCC 同标识" : ""}</small></span>; }) : <span className="value-null">未返回</span>}</div></div><div className="radio-stat-grid"><SignalBar label="RSRP" value={snapshot.radio.rsrpDbm} unit="dBm" min={-125} max={-70} /><SignalBar label="RSRQ" value={snapshot.radio.rsrqDb} unit="dB" min={-25} max={-3} /><SignalBar label="RSSI" value={snapshot.radio.rssiDbm} unit="dBm" min={-105} max={-45} /><SignalBar label="SINR" value={snapshot.radio.sinrDb} unit="dB" min={-10} max={30} /></div></section>
    <section className="soft-panel speed-panel"><SectionTitle eyebrow="实时速率" title="" badge="单位自动换算" /><div className="speed-grid speed-grid--spark"><div><b className="rate-icon rate-icon--down">↓</b><span>下载<strong>{formatRate(snapshot.network.downloadBps)}</strong></span><Sparkline history={history} field="downloadBps" /></div><div><b className="rate-icon rate-icon--up">↑</b><span>上传<strong>{formatRate(snapshot.network.uploadBps)}</strong></span><Sparkline history={history} field="uploadBps" /></div></div><div className="usage-grid"><span><small>本次</small><b>{formatBytes(combinedBytes(snapshot.network.currentDownloadBytes, snapshot.network.currentUploadBytes))}</b><em>{formatUptime(snapshot.network.currentConnectSeconds)}</em></span><span><small>今日</small><b>{formatBytes(snapshot.network.dayUsedBytes)}</b><em>{formatUptime(snapshot.network.dayDurationSeconds)}</em></span><span><small>本月</small><b>{formatBytes(combinedBytes(snapshot.network.monthDownloadBytes, snapshot.network.monthUploadBytes))}</b><em>{formatUptime(snapshot.network.monthDurationSeconds)}</em></span></div></section>
    <section className="soft-panel telemetry-panel"><SectionTitle eyebrow="实时曲线（最近 60 秒）" title="" /><div className="metric-tabs">{DASHBOARD_METRICS.slice(0, 4).map((item) => <button key={item.id} type="button" className={metric === item.id ? "is-active" : ""} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div><LineChart history={history} metric={metric} /></section>
    <section className="soft-panel log-preview-panel"><div className="section-heading"><div><p className="eyebrow">本地实时记录</p><h2>设备日志</h2></div><div className="section-heading__actions"><span className="count-badge">{events.length}</span><button className="soft-button" type="button" onClick={() => onNavigate("logs")}>全部日志</button></div></div>{events.length === 0 ? <Empty text="保持实时监控，信号和小区变化会记录在这里。" /> : <EventList events={events.slice(-3)} />}{!networkProbeConfigured && <p className="panel-note">Internet 用户路径探测尚未配置，状态保持未验证。</p>}</section>
  </>;
}

function CellCard({ cell, title, mirrored = false }: { cell: CpeCell; title: string; mirrored?: boolean }) {
  return <article className="cell-card"><div className="cell-card__heading"><div><p className="eyebrow">{title}</p><h3>{cell.band ?? "频段未返回"}</h3></div><span className="tech-badge">{cell.technology}</span></div>{mirrored && <p className="mirror-note">与 PCC 身份一致；保留设备原始返回，CA 语义待确认。</p>}<div className="cell-metrics"><span>PCI <b>{cell.pci ?? "—"}</b></span><span>ARFCN <b>{cell.arfcn ?? "—"}</b></span><span>RSRP <b>{formatMetric(cell.rsrpDbm, "dBm")}</b></span><span>SINR <b>{formatMetric(cell.sinrDb, "dB")}</b></span></div></article>;
}

function CellsPage({ snapshot }: { snapshot: CpeSnapshot }) {
  const values = Object.values(snapshot.capabilities), observed = values.filter((value) => value === "observed").length, unknown = values.filter((value) => value === "unknown").length, unsupported = values.filter((value) => value === "unsupported").length;
  return <>
    <section className="soft-panel"><SectionTitle eyebrow="Serving cells" title="服务小区" badge={(snapshot.cells.pcc ? 1 : 0) + snapshot.cells.scells.length} /><div className="card-stack">{snapshot.cells.pcc ? <CellCard cell={snapshot.cells.pcc} title="PCC · 主载波" /> : <Empty text="设备未返回可解析 PCC。" />}{snapshot.cells.scells.map((cell, index) => <CellCard key={`s-${index}`} cell={cell} title={`SCC ${index + 1} · 另外的副载波`} mirrored={isMirroredSecondaryCell(snapshot, cell)} />)}</div></section>
    <section className="soft-panel"><SectionTitle eyebrow="Neighbor cells" title="邻区" badge={snapshot.cells.neighbors.length} /><div className="card-stack">{snapshot.cells.neighbors.length ? snapshot.cells.neighbors.map((cell, index) => <CellCard key={`n-${index}`} cell={cell} title={`Neighbor ${index + 1}`} />) : <Empty text="当前没有已解析邻区。" />}</div></section>
    <section className="soft-panel"><SectionTitle eyebrow="Advanced radio" title="无线证据" /><DetailList items={[["Band", snapshot.radio.band], ["Bandwidth", snapshot.radio.bandwidth], ["RRC 原始状态", snapshot.radio.rrcStatus], ["CQI", snapshot.radio.cqi], ["MIMO Rank", snapshot.radio.mimoRank], ["BLER", snapshot.radio.blerPct, "%"], ["MCS (DL) 原始", snapshot.radio.rawEvidence?.dlMcs ?? null], ["MCS (UL) 原始", snapshot.radio.rawEvidence?.ulMcs ?? null], ["TX Power 原始", snapshot.radio.rawEvidence?.txPower ?? null]]} /><p className="panel-note">复合字段保留设备原文，不虚构单一数值。</p></section>
    <section className="soft-panel"><SectionTitle eyebrow="Capability" title="字段证据" /><div className="capability-summary"><span><b>{observed}</b> 已观察</span><span><b>{unknown}</b> 未验证</span><span><b>{unsupported}</b> 被拒绝</span></div><details className="capability-details"><summary>查看全部字段状态</summary><div className="capability-grid">{Object.entries(snapshot.capabilities).map(([key, value]) => <span key={key} className={`capability-item is-${value}`}><b>{key}</b><em>{capabilityText(value as CapabilityStatus)}</em></span>)}</div></details></section>
  </>;
}

function EventList({ events, detailed = false }: { events: readonly CpeEvent[]; detailed?: boolean }) {
  return <ol className={`event-list${detailed ? " event-list--detailed" : ""}`}>{events.slice().reverse().map((item, index) => {
    const tone = eventTone(item.type);
    return <li className={`event-item event-item--${tone}`} key={`${item.timestamp}-${item.type}-${index}`}>
      <div className="event-item__time"><time dateTime={item.timestamp}>{detailed ? eventDateTime(item.timestamp) : eventTime(item.timestamp)}</time>{detailed && <span className={`event-severity event-severity--${tone}`}>{eventToneLabel(item.type)}</span>}</div>
      <div className="event-item__body"><div className="event-item__title"><strong>{eventLabel(item.type)}</strong><span className="event-group">{eventGroupLabel(item.type)}</span></div><p className="event-transition">{eventDetail(item)}</p>{detailed && <div className="event-context">{eventContextEntries(item).map((entry) => <span key={`${entry.label}-${entry.value}`}><small>{entry.label}</small><b>{entry.value}</b></span>)}</div>}</div>
    </li>;
  })}</ol>;
}

function DeviceLogsPage({ events, snapshot, networkProbeConfigured }: { events: readonly CpeEvent[]; snapshot: CpeSnapshot; networkProbeConfigured: boolean }) {
  const orderedEvents = events.slice().reverse();
  const latestEvent = orderedEvents[0] ?? null;
  const attentionCount = events.filter((event) => eventTone(event.type) === "danger" || eventTone(event.type) === "warning").length;
  const latestDown = orderedEvents.find((event) => event.type === "CELLULAR_DOWN" || event.type === "INTERNET_DOWN");
  const recoveryType = latestDown?.type === "CELLULAR_DOWN" ? "CELLULAR_UP" : "INTERNET_UP";
  const recovered = latestDown && orderedEvents.find((event) => event.timestamp > latestDown.timestamp && event.type === recoveryType);
  const duration = latestDown && !recovered ? Date.parse(snapshot.timestamp) - Date.parse(latestDown.timestamp) : null;
  const currentStatus = snapshot.connection.cellularOnline === false
    ? "蜂窝离线"
    : snapshot.connection.internetOnline === false
      ? "Internet 断开"
      : snapshot.connection.cellularOnline === true && snapshot.connection.internetOnline === true
        ? "连接正常"
        : snapshot.connection.cellularOnline === true
          ? "蜂窝在线 / Internet 未验证"
          : "状态未验证";
  return <><section className="soft-panel event-hero"><div className="section-heading"><div><p className="eyebrow">连续实时快照</p><h2>设备日志</h2></div><span className="count-badge">{events.length} 条</span></div><p className="logs-lede">只展示连续实时快照确认的连接、小区和网络质量变化；不会用样例补写日志。</p><div className="log-summary-grid"><div><small>当前状态</small><strong>{currentStatus}</strong><span>以最新快照为准</span></div><div><small>累计记录</small><strong>{events.length}</strong><span>本地会话</span></div><div><small>告警 / 注意</small><strong>{attentionCount}</strong><span>需要关注的记录</span></div><div><small>最后记录</small><strong>{latestEvent ? eventTime(latestEvent.timestamp) : "—"}</strong><span>{latestEvent ? eventLabel(latestEvent.type) : "暂无日志"}</span></div></div>{duration !== null && duration >= 0 ? <div className="outage-card"><span>当前中断持续</span><strong>{formatDuration(duration)}</strong></div> : <p className="panel-note">当前没有从事件序列确认的持续中断。</p>}{!networkProbeConfigured && <p className="panel-note">Internet 用户路径探测尚未配置；相关日志仍会保留设备端连接状态。</p>}</section><section className="soft-panel"><SectionTitle eyebrow="完整时间线" title="全部记录" badge={events.length} />{events.length ? <EventList events={events} detailed /> : <Empty text="暂无设备日志。保持实时监控后，状态变化会显示在这里。" />}</section></>;
}

function DevicePage({ snapshot, cached, onClearCache, controlClient }: { snapshot: CpeSnapshot; cached: boolean; onClearCache: () => void; controlClient: H168ControlClient }) {
  return <><ManagedClients client={controlClient} /><section className="soft-panel"><SectionTitle eyebrow="Device" title="设备信息" /><DetailList items={[["设备型号", snapshot.device.model], ["产品名称", snapshot.device.productName], ["开机时长", formatUptime(snapshot.device.uptimeSeconds)], ["硬件版本", snapshot.device.hardwareVersion], ["软件版本", snapshot.device.firmware], ["Web UI 版本", snapshot.device.webUiVersion], ["参数版本", snapshot.device.parameterVersion]]} /></section><section className="soft-panel"><SectionTitle eyebrow="Network identity" title="网络身份" /><DetailList items={[["运营商", snapshot.connection.operatorName], ["PLMN", snapshot.connection.plmn], ["Huawei 状态码", snapshot.connection.cellularStatusCode], ["模式", snapshot.connection.radioMode], ["SA / NSA", snapshot.connection.saNsa], ["Cell ID", snapshot.radio.cellId], ["TAC", snapshot.radio.tac]]} /></section><section className="soft-panel privacy-card"><SectionTitle eyebrow="Privacy" title="本地数据" /><p>短信正文、手机号、终端 IP/MAC、密码、Session 和 Token 均不写入浏览器持久存储；关闭页面即释放控制页数据。</p>{cached && <button className="danger-soft-button" type="button" onClick={onClearCache}>清除本地快照</button>}</section></>;
}

function formatUptime(seconds: number | null): string { if (seconds === null) return "—"; const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60); return `${days ? `${days}天 ` : ""}${hours}时${minutes}分`; }
function Empty({ text }: { text: string }) { return <div className="empty-state"><span aria-hidden="true">⌁</span><p>{text}</p></div>; }

export function DashboardPage(props: DashboardPageProps) {
  const { snapshot, activeView, liveMonitoring, liveError, cached, onNavigate } = props;
  if (snapshot === null) return <main className="app-shell"><header className="app-header"><div className="brand-line"><span className="brand-paw">●</span><strong>CPE 花花</strong><i>已登录</i></div><h1>正在连接 H168</h1><p className="lede">认证已通过，正在读取第一份实时快照。</p><button className="primary-button" type="button" onClick={props.onRetryLive} disabled={liveMonitoring}>{liveMonitoring ? "实时抓取中…" : "重新连接"}</button></header>{liveError && <div className="error-banner" role="alert">{liveError}</div>}<BottomNav active={activeView} onNavigate={onNavigate} /></main>;
  return <main className="app-shell dashboard-shell"><PageHeader liveMonitoring={liveMonitoring} onToggleLive={props.onToggleLive} />{liveError && <div className="error-banner dashboard-error" role="alert">{liveError}</div>}{snapshot.source !== "live" && <div className="evidence-banner">当前为 {snapshot.source === "fixture" ? "fixture 参考" : "未知来源"}，不代表实机验证。</div>}{cached && <div className="evidence-banner evidence-banner--cached">正在显示浏览器保存的最近快照，实时连接建立后会更新。</div>}{activeView === "overview" && <Overview snapshot={snapshot} history={props.history} events={props.events} networkProbeConfigured={props.networkProbeConfigured} onNavigate={onNavigate} />}{activeView === "logs" && <DeviceLogsPage events={props.events} snapshot={snapshot} networkProbeConfigured={props.networkProbeConfigured} />}{activeView === "control" && <ControlPage client={props.controlClient} />}{activeView === "cells" && <BandLockPage client={props.controlClient} snapshot={snapshot} />}{activeView === "device" && <DevicePage snapshot={snapshot} cached={cached} onClearCache={props.onClearCache} controlClient={props.controlClient} />}{activeView === "messages" && <MessagesPage client={props.controlClient} />}<BottomNav active={activeView} onNavigate={onNavigate} /></main>;
}
