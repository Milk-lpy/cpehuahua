import { useMemo, useState } from "react";
import type { CpeCell, CpeEvent, CpeSnapshot } from "@cpehuahua/core";
import {
  aggregationLabel,
  capabilityText,
  chartPoints,
  DASHBOARD_METRICS,
  eventDetail,
  eventLabel,
  eventTime,
  formatMetric,
  metricDefinition,
  metricValue,
  statusClass,
  statusText,
  type DashboardMetricId,
} from "./view-model";

interface DashboardPageProps {
  snapshot: CpeSnapshot | null;
  history: readonly CpeSnapshot[];
  events: readonly CpeEvent[];
  liveMonitoring: boolean;
  liveError: string | null;
  onToggleLive: () => void;
  onBackToProbe: () => void;
}

function Value({ value, unit = "" }: { value: number | string | null; unit: string }) {
  if (value === null || value === "") return <span className="value-null">—</span>;
  return <span>{typeof value === "number" ? formatMetric(value, unit) : value}</span>;
}

function DefinitionList({ items }: { items: Array<[string, number | string | null, string?]> }) {
  return (
    <dl className="detail-list">
      {items.map(([label, value, unit]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd><Value value={value} unit={unit ?? ""} /></dd>
        </div>
      ))}
    </dl>
  );
}

function presentItems(items: Array<[string, number | string | null, string?]>): Array<[string, number | string | null, string?]> {
  return items.filter(([, value]) => value !== null && value !== "");
}

function cellName(cell: CpeCell, index: number): string {
  if (cell.role === "pcc") return "PCC";
  if (cell.role === "scell") return `SCell ${index}`;
  if (cell.role === "neighbor") return `Neighbor ${index}`;
  return `Cell ${index}`;
}

function CellCard({ cell, index }: { cell: CpeCell; index: number }) {
  return (
    <article className="cell-card">
      <div className="cell-card__heading">
        <div>
          <p className="eyebrow">{cellName(cell, index)}</p>
          <h3>{cell.band ?? "频段未返回"}</h3>
        </div>
        <span className="status-chip status-chip--muted">{cell.technology}</span>
      </div>
      <DefinitionList items={[
        ["PCI", cell.pci],
        ["Cell ID", cell.cellId],
        ["RSRP", cell.rsrpDbm, "dBm"],
        ["RSRQ", cell.rsrqDb, "dB"],
        ["SINR", cell.sinrDb, "dB"],
        ["ARFCN", cell.arfcn],
      ]} />
    </article>
  );
}

function LineChart({ history, metric }: { history: readonly CpeSnapshot[]; metric: DashboardMetricId }) {
  const points = chartPoints(history, metric);
  const definition = metricDefinition(metric);
  const width = 360;
  const height = 128;
  const left = 12;
  const right = width - 12;
  const top = 12;
  const bottom = height - 18;
  const values = points.map((point) => point.value);
  const rawMin = values.length > 0 ? Math.min(...values) : 0;
  const rawMax = values.length > 0 ? Math.max(...values) : 1;
  const padding = rawMin === rawMax ? Math.max(1, Math.abs(rawMin) * 0.1) : (rawMax - rawMin) * 0.12;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index: number) => history.length <= 1
    ? (left + right) / 2
    : left + (index / (history.length - 1)) * (right - left);
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");

  return (
    <div className="chart-wrap">
      <div className="chart-heading">
        <div>
          <p className="eyebrow">最近 {Math.max(0, history.length)} 个采样</p>
          <h3>{definition.label} 趋势</h3>
        </div>
        <span className="chart-current">
          {points.length > 0 ? formatMetric(points[points.length - 1]?.value ?? null, definition.unit) : "—"}
        </span>
      </div>
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${definition.label} trend`}>
        <line x1={left} x2={right} y1={bottom} y2={bottom} className="chart-axis" />
        <line x1={left} x2={left} y1={top} y2={bottom} className="chart-axis" />
        {path && <path d={path} className="chart-line" fill="none" />}
        {points.map((point) => (
          <circle key={`${point.timestamp}-${point.index}`} cx={x(point.index)} cy={y(point.value)} r="2.8" className="chart-point" />
        ))}
        {points.length === 0 && <text x={width / 2} y={height / 2} textAnchor="middle" className="chart-empty">暂无已验证数据</text>}
      </svg>
    </div>
  );
}

function SourceBadge({ source }: { source: CpeSnapshot["source"] }) {
  const label = source === "live" ? "Live" : source === "fixture" ? "Fixture 参考" : "来源未验证";
  return <span className={`stage-badge stage-badge--${source}`}>{label}</span>;
}

export function DashboardPage({
  snapshot,
  history,
  events,
  liveMonitoring,
  liveError,
  onToggleLive,
  onBackToProbe,
}: DashboardPageProps) {
  const [selectedMetric, setSelectedMetric] = useState<DashboardMetricId>("rsrpDbm");

  const servingCells = useMemo(() => (
    snapshot === null
      ? []
      : [snapshot.cells.pcc, ...snapshot.cells.scells].filter((cell): cell is CpeCell => cell !== null)
  ), [snapshot]);
  const extendedItems = snapshot === null ? [] : presentItems([
    ["Temperature", snapshot.extended.temperatureC, "°C"],
    ["Fan", snapshot.extended.fanRpm, "rpm"],
    ["CPU", snapshot.extended.cpuUsagePct, "%"],
    ["Memory", snapshot.extended.memoryUsagePct, "%"],
    ["QCI", snapshot.extended.qci],
    ["5QI", snapshot.extended.fiveQi],
    ["DL AMBR", snapshot.extended.dlAmbr, "bps"],
    ["UL AMBR", snapshot.extended.ulAmbr, "bps"],
  ]);

  if (snapshot === null) {
    return (
      <main className="app-shell dashboard-shell">
        <header className="page-header">
          <div>
            <p className="eyebrow">CPE Huahua / cpehuahua</p>
            <h1>Dashboard</h1>
            <p className="lede">Dashboard 只消费统一 CpeSnapshot；当前 Bridge 尚未返回实时快照。</p>
          </div>
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={onToggleLive}>{liveMonitoring ? "停止实时" : "启动实时"}</button>
            <button className="secondary-button" type="button" onClick={onBackToProbe}>返回 Probe</button>
          </div>
        </header>
        <section className="panel empty-state dashboard-empty">
          <strong>暂无实时快照</strong>
          <p>连接真实 H168-383 并完成后续 `/api/live` 接入后，这里才会显示指标。未验证字段不会用样例数字填充。</p>
          {liveError !== null && <p className="error-banner">{liveError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell dashboard-shell">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">CPE Huahua / cpehuahua</p>
          <div className="dashboard-title-row">
            <h1>{snapshot.device.model ?? "H168-383"}</h1>
            <SourceBadge source={snapshot.source} />
          </div>
          <p className="lede">本地监控快照 · {new Date(snapshot.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" type="button" onClick={onToggleLive}>{liveMonitoring ? "停止实时" : "启动实时"}</button>
          <button className="secondary-button" type="button" onClick={onBackToProbe}>Probe</button>
        </div>
      </header>

      {liveError !== null && <div className="error-banner dashboard-error">{liveError}</div>}

      {snapshot.source !== "live" && (
        <div className="evidence-banner">这是 {snapshot.source === "fixture" ? "fixture 参考数据" : "非实机数据"}，不代表 H168-383 已被验证。</div>
      )}

      <section className="panel dashboard-overview">
        <div className="overview-heading">
          <div>
            <p className="eyebrow">Connection</p>
            <h2>H168-383</h2>
          </div>
          <div className="status-pair">
            <span className={`state-pill state-pill--${statusClass(snapshot.connection.cellularOnline)}`}><i /> Cellular {statusText(snapshot.connection.cellularOnline)}</span>
            <span className={`state-pill state-pill--${statusClass(snapshot.connection.internetOnline)}`}><i /> Internet {statusText(snapshot.connection.internetOnline)}</span>
          </div>
        </div>
        <div className="connection-summary">
          <strong>{snapshot.connection.saNsa === "unknown" ? "模式未验证" : `${snapshot.connection.radioMode} ${snapshot.connection.saNsa}`}</strong>
          <span>{aggregationLabel(snapshot)}</span>
          <span>PLMN {snapshot.connection.plmn ?? "—"}</span>
          <span>Ping <Value value={snapshot.network.pingMs} unit="ms" /></span>
          <span>Loss <Value value={snapshot.network.packetLossPct} unit="%" /></span>
        </div>
      </section>

      <section className="metric-grid metric-grid--hero">
        {(["rsrpDbm", "sinrDb", "rsrqDb"] as const).map((id) => {
          const definition = metricDefinition(id);
          return (
            <article className="metric-card" key={id}>
              <span>{definition.label}</span>
              <strong>{formatMetric(metricValue(snapshot, id), definition.unit)}</strong>
            </article>
          );
        })}
      </section>

      <section className="panel chart-panel">
        <div className="metric-tabs" role="tablist" aria-label="Chart metric">
          {DASHBOARD_METRICS.map((metric) => (
            <button
              className={`metric-tab ${selectedMetric === metric.id ? "metric-tab--active" : ""}`}
              key={metric.id}
              type="button"
              role="tab"
              aria-selected={selectedMetric === metric.id}
              onClick={() => setSelectedMetric(metric.id)}
            >
              {metric.label}
            </button>
          ))}
        </div>
        <LineChart history={history} metric={selectedMetric} />
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Serving Cells</p><h2>PCC / SCell</h2></div><span className="count-badge">{servingCells.length}</span></div>
        <div className="cell-grid">
          {servingCells.length === 0 ? <p className="muted">暂无已解析小区</p> : servingCells.map((cell, index) => <CellCard cell={cell} index={cell.role === "pcc" ? 0 : snapshot.cells.scells.indexOf(cell) + 1} key={`${cell.role}-${index}`} />)}
        </div>
      </section>

      <section className="detail-columns">
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Advanced Radio</p><h2>无线参数</h2></div></div>
          <DefinitionList items={[
            ["Band", snapshot.radio.band],
            ["ARFCN", snapshot.radio.arfcn],
            ["PCI", snapshot.radio.pci],
            ["Cell ID", snapshot.radio.cellId],
            ["TAC", snapshot.radio.tac],
            ["CQI", snapshot.radio.cqi],
            ["MIMO Rank", snapshot.radio.mimoRank],
            ["MCS (DL)", snapshot.radio.dlMcs],
            ["MCS (UL)", snapshot.radio.ulMcs],
            ["BLER", snapshot.radio.blerPct, "%"],
            ["TX Power", snapshot.radio.txPowerDbm, "dBm"],
          ]} />
        </section>
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Network Quality</p><h2>用户路径</h2></div></div>
          <DefinitionList items={[
            ["Ping", snapshot.network.pingMs, "ms"],
            ["Jitter", snapshot.network.jitterMs, "ms"],
            ["Packet loss", snapshot.network.packetLossPct, "%"],
            ["Download", snapshot.network.downloadBps, "bps"],
            ["Upload", snapshot.network.uploadBps, "bps"],
          ]} />
        </section>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Neighbor Cells</p><h2>邻区</h2></div><span className="count-badge">{snapshot.cells.neighbors.length}</span></div>
        <div className="cell-grid">
          {snapshot.cells.neighbors.length === 0 ? <p className="muted">暂无已解析邻区</p> : snapshot.cells.neighbors.map((cell, index) => <CellCard cell={cell} index={index + 1} key={`neighbor-${index}`} />)}
        </div>
      </section>

      <section className="detail-columns">
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Device</p><h2>设备</h2></div></div>
          <DefinitionList items={[
            ["Model", snapshot.device.model],
            ["Firmware", snapshot.device.firmware],
            ["Uptime", snapshot.device.uptimeSeconds, "s"],
            ["PLMN", snapshot.connection.plmn],
          ]} />
        </section>
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Extended</p><h2>扩展字段</h2></div></div>
          {extendedItems.length === 0 ? <p className="muted">暂无已验证扩展字段</p> : <DefinitionList items={extendedItems} />}
        </section>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Capability</p><h2>字段证据状态</h2></div></div>
        <div className="capability-grid">
          {Object.entries(snapshot.capabilities).map(([key, value]) => <span key={key}><b>{key}</b>{capabilityText(value)}</span>)}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Event Timeline</p><h2>高铁事件</h2></div><span className="count-badge">{events.length}</span></div>
        {events.length === 0 ? <p className="muted">暂无事件；需要连续快照后才会产生变化。</p> : (
          <ol className="event-list">
            {events.slice().reverse().map((item, index) => (
              <li key={`${item.timestamp}-${item.type}-${index}`}>
                <time>{eventTime(item.timestamp)}</time>
                <div><strong>{eventLabel(item.type)}</strong><span>{eventDetail(item)}</span></div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
