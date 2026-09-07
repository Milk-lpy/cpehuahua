import { useEffect, useMemo, useRef, useState } from "react";
import { H168_PROBE_ENDPOINTS } from "@cpehuahua/core";
import type { CpeLiveReport, EndpointProbeResult, ProbeReport } from "@cpehuahua/core";
import { DashboardPage } from "./dashboard/DashboardPage";
import { H168EndpointClient } from "./live/endpoint-client";
import { DevicePollingSession } from "./live/device-session";
import { SurgeNetworkProbeClient } from "./live/network-client";
import { loadNetworkProbeUrl, saveNetworkProbeUrl } from "./live/network-settings";
import {
  clearPersistedLiveReport,
  loadPersistedLiveReport,
  savePersistedLiveReport,
} from "./live/storage";
import { sanitizedProbeReport, toProbeRows } from "./probe/view-model";
import { liveReportFromProbe } from "./live/probe-live";

const DEFAULT_BRIDGE_URL = "https://cpe-bridge.example.com/api/probe";
const NETWORK_PROBE_INTERVAL_MS = 1_000;

interface BridgeErrorPayload {
  error?: string;
  message?: string;
}

function userFacingBridgeError(cause: unknown): string {
  if (cause instanceof Error && /load failed|failed to fetch|networkerror/i.test(cause.message)) {
    return "无法访问本地 Bridge：请在 Surge 中更新并启用 CPE Huahua Module，确认 cpe-bridge.example.com 已开启 MITM，并连接 H168 Wi-Fi。";
  }
  return cause instanceof Error ? cause.message : "无法读取 Bridge";
}

function isProbeReport(value: unknown): value is ProbeReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ProbeReport>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.endpointResults);
}

function isLiveReport(value: unknown): value is CpeLiveReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CpeLiveReport>;
  return candidate.schemaVersion === 1
    && typeof candidate.snapshot === "object"
    && candidate.snapshot !== null
    && Array.isArray(candidate.history)
    && Array.isArray(candidate.events);
}

const LIVE_CORE_ENDPOINTS = new Set([
  "device-basic-information",
  "monitoring-status",
  "net-current-plmn",
  "device-signal",
  "device-seccellinfo",
  "device-nbrcellinfo",
  "monitoring-traffic-statistics",
]);

// Candidate/developer endpoints are useful for Probe diagnostics but should
// not be part of the 1-second live loop. Keep the one-time device info read
// for the device card and leave all exploratory reads in Probe only.
const LIVE_ENDPOINTS = H168_PROBE_ENDPOINTS.filter((endpoint) => (
  LIVE_CORE_ENDPOINTS.has(endpoint.id) || endpoint.id === "device-information"
));

function liveEndpointError(result: EndpointProbeResult): string {
  const detail = result.transportError
    ?? (result.huaweiError?.code === null || result.huaweiError?.code === undefined
      ? null
      : `Huawei error ${result.huaweiError.code}`)
    ?? (result.httpStatus === null ? null : `HTTP ${result.httpStatus}`)
    ?? "未返回可用数据";
  return `${result.endpoint.label}读取失败：${detail}。请返回 Probe 输入密码并读取一次，或更新 Surge Module 后重试。`;
}

function EndpointCard({ row }: { row: ReturnType<typeof toProbeRows>[number] }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copySanitizedResult() {
    try {
      await navigator.clipboard.writeText(row.sanitizedResult);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <article className={`endpoint-card endpoint-card--${row.status}`}>
      <div className="endpoint-heading">
        <div>
          <p className="eyebrow">{row.id}</p>
          <h3>{row.label}</h3>
        </div>
        <span className="status-chip">{row.statusLabel}</span>
      </div>
      <dl className="metadata-grid">
        <div>
          <dt>URL</dt>
          <dd className="monospace">{row.url}</dd>
        </div>
        <div>
          <dt>HTTP</dt>
          <dd>{row.httpStatus}</dd>
        </div>
        <div>
          <dt>Huawei</dt>
          <dd>{row.huaweiStatus}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{row.latency}</dd>
        </div>
      </dl>
      <div className="field-list">
        <span className="field-list__label">Parsed fields</span>
        {row.fields.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          row.fields.map((field) => (
            <code key={field}>{field}</code>
          ))
        )}
      </div>
      <details>
        <summary>RAW XML（默认已脱敏）</summary>
        <pre>{row.rawXml || "（空响应）"}</pre>
      </details>
      <button className="copy-button" type="button" onClick={() => void copySanitizedResult()}>
        {copyState === "copied" ? "已复制脱敏结果" : copyState === "failed" ? "复制失败" : "Copy Sanitized Result"}
      </button>
    </article>
  );
}

function App() {
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_BRIDGE_URL);
  const [networkProbeUrl, setNetworkProbeUrl] = useState(() => loadNetworkProbeUrl());
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [liveReport, setLiveReport] = useState<CpeLiveReport | null>(() => loadPersistedLiveReport());
  const [restoredFromStorage, setRestoredFromStorage] = useState(() => liveReport !== null);
  const [view, setView] = useState<"probe" | "dashboard">("probe");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeCopyState, setProbeCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [liveMonitoring, setLiveMonitoring] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [rememberSession, setRememberSession] = useState(true);
  const [rememberPassword, setRememberPassword] = useState(false);
  const liveSessionRef = useRef<DevicePollingSession | null>(null);
  const livePasswordRef = useRef("");

  const rows = useMemo(() => (report === null ? [] : toProbeRows(report)), [report]);

  useEffect(() => () => {
    liveSessionRef.current?.stop();
  }, []);

  function toggleLiveMonitoring() {
    if (liveSessionRef.current !== null) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
      setLiveMonitoring(false);
      return;
    }
    setLiveError(null);
    const client = new H168EndpointClient(bridgeUrl, {
      getPassword: () => livePasswordRef.current,
      rememberSession: () => rememberSession,
    });
    const configuredProbeUrl = networkProbeUrl.trim();
    const networkClient = new SurgeNetworkProbeClient(bridgeUrl);
    const session = new DevicePollingSession(client.read.bind(client), {
      endpoints: LIVE_ENDPOINTS,
      getGateway: () => client.gateway,
      ...(configuredProbeUrl
        ? {
            networkProbe: () => networkClient.probe(configuredProbeUrl),
            networkProbeIntervalMs: NETWORK_PROBE_INTERVAL_MS,
          }
        : {}),
      onUpdate: (update) => {
        setLiveReport(update);
        setRestoredFromStorage(false);
        savePersistedLiveReport(update);
        setLiveMonitoring(true);
        setView("dashboard");
      },
      onEndpointResult: (result) => {
        if (!LIVE_CORE_ENDPOINTS.has(result.endpoint.id)) return;
        if (result.status === "ok") {
          if (result.endpoint.id === "device-signal") setLiveError(null);
          return;
        }
        setLiveError(liveEndpointError(result));
      },
      onError: (cause) => {
        setLiveError(cause instanceof Error ? cause.message : "实时 Bridge 读取失败");
      },
    });
    liveSessionRef.current = session;
    setLiveMonitoring(true);
    session.start();
  }

  async function loadProbe() {
    // A probe report is a point-in-time diagnostic result. Clear the previous
    // browser result before starting so a failed run cannot leave stale data visible.
    setReport(null);
    setLiveReport(null);
    setRestoredFromStorage(false);
    clearPersistedLiveReport();
    setProbeCopyState("idle");
    setLoading(true);
    setError(null);

    try {
      const hasPassword = password.trim().length > 0;
      if (hasPassword) {
        livePasswordRef.current = password;
      }
      const response = await fetch(bridgeUrl, {
        method: hasPassword ? "POST" : "GET",
        headers: {
          Accept: "application/json",
          ...(hasPassword ? { "Content-Type": "application/json" } : {}),
        },
        ...(hasPassword
          ? {
              body: JSON.stringify({
                password,
                rememberSession,
                rememberPassword,
              }),
            }
          : {}),
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        const details = payload as BridgeErrorPayload;
        throw new Error(details.error ?? details.message ?? `Bridge HTTP ${response.status}`);
      }

      if (isLiveReport(payload)) {
        setLiveReport(payload);
        setRestoredFromStorage(false);
        savePersistedLiveReport(payload);
        setReport(null);
        setView("dashboard");
        return;
      }

      if (!isProbeReport(payload)) {
        throw new Error("Bridge 返回的不是 ProbeReport");
      }

      setReport(payload);
      const initialLiveReport = liveReportFromProbe(payload);
      setLiveReport(initialLiveReport);
      setRestoredFromStorage(false);
      if (initialLiveReport !== null) {
        savePersistedLiveReport(initialLiveReport);
      }
      setView("probe");
      if (!rememberPassword) {
        setPassword("");
      }
    } catch (cause) {
      setReport(null);
      setError(userFacingBridgeError(cause));
    } finally {
      setLoading(false);
    }
  }

  async function copyAllProbeResults() {
    if (report === null) return;

    try {
      await navigator.clipboard.writeText(sanitizedProbeReport(report));
      setProbeCopyState("copied");
    } catch {
      setProbeCopyState("failed");
    }
  }

  function clearCachedLiveReport() {
    clearPersistedLiveReport();
    setLiveReport(null);
    setRestoredFromStorage(false);
  }

  if (view === "dashboard") {
    return (
      <DashboardPage
        snapshot={liveReport?.snapshot ?? null}
        history={liveReport?.history ?? []}
        events={liveReport?.events ?? []}
        cached={restoredFromStorage}
        liveMonitoring={liveMonitoring}
        liveError={liveError}
        networkProbeConfigured={networkProbeUrl.trim().length > 0}
        onToggleLive={toggleLiveMonitoring}
        onBackToProbe={() => setView("probe")}
        onClearCache={clearCachedLiveReport}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">CPE Huahua / cpehuahua</p>
          <h1>H168 Probe</h1>
          <p className="lede">
            先看真实设备返回什么。这里不直接请求 H168，也不把未验证字段伪装成支持。
          </p>
        </div>
        <div className="header-actions">
          <span className="stage-badge">Probe skeleton</span>
          <button className="secondary-button" type="button" onClick={() => setView("dashboard")}>Dashboard</button>
        </div>
      </header>

      <section className="panel connection-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Connection</p>
            <h2>本地 Bridge</h2>
          </div>
          <span className={`connection-dot ${report === null ? "connection-dot--idle" : ""}`} />
        </div>
        <label className="input-label" htmlFor="bridge-url">专用 Bridge URL</label>
        <div className="url-row">
          <input
            id="bridge-url"
            type="url"
            value={bridgeUrl}
            onChange={(event) => setBridgeUrl(event.target.value)}
            spellCheck={false}
          />
          <button type="button" onClick={() => void loadProbe()} disabled={loading || bridgeUrl.length === 0}>
            {loading ? "读取中…" : "读取 Probe"}
          </button>
        </div>
        <div className="probe-action-row">
          <p className="helper-text">读取完成后，可复制本次完整的脱敏 JSON 结果。</p>
          <button
            className="copy-all-button copy-all-button--prominent"
            type="button"
            disabled={report === null || loading}
            onClick={() => void copyAllProbeResults()}
          >
            {probeCopyState === "copied"
              ? "已复制本次全部"
              : probeCopyState === "failed"
                ? "复制失败，重试"
                : "复制本次全部"}
          </button>
        </div>
        <label className="input-label" htmlFor="cpe-password">H168 管理密码（仅在需要登录时填写）</label>
        <input
          id="cpe-password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            livePasswordRef.current = event.target.value;
          }}
          autoComplete="current-password"
          placeholder="不写入 URL"
        />
        <label className="input-label" htmlFor="network-probe-url">Internet 用户路径探测 URL（可选）</label>
        <input
          id="network-probe-url"
          type="url"
          value={networkProbeUrl}
          onChange={(event) => {
            const value = event.target.value;
            setNetworkProbeUrl(value);
            saveNetworkProbeUrl(value);
          }}
          spellCheck={false}
          placeholder="https://你的低负载探测地址/health"
        />
        <p className="helper-text">
          不填写时 Internet、Ping、Loss、Jitter 保持 null。填写后由 Surge 在本地访问该 HTTPS 地址；记录的是用户路径 HTTP 延迟，不是 ICMP Ping。
        </p>
        <div className="checkbox-row">
          <label><input type="checkbox" checked={rememberSession} onChange={(event) => setRememberSession(event.target.checked)} /> Remember Session</label>
          <label><input type="checkbox" checked={rememberPassword} onChange={(event) => setRememberPassword(event.target.checked)} /> Remember Password</label>
        </div>
        <p className="helper-text">
          请求只发往专用 Bridge URL，由 Surge 拦截后在本地处理。请确认 Surge Module 已启用；不要在 Surge 未接管时提交密码。
        </p>
        {error !== null && <p className="error-banner">{error}</p>}
      </section>

      <section className="panel status-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">H168 Login</p>
            <h2>设备连接状态</h2>
          </div>
          <span className="status-chip status-chip--muted">只读</span>
        </div>
        <div className="status-grid">
          <div className="status-item">
            <span>Target</span>
            <strong>{report?.adapterId === "h168" ? "H168-383" : "H168-383（待发现）"}</strong>
          </div>
          <div className="status-item">
            <span>Gateway</span>
            <strong className="monospace">{report?.gateway ?? "—"}</strong>
          </div>
          <div className="status-item">
            <span>Session</span>
            <strong>{report === null ? "未读取" : "由 Bridge 管理"}</strong>
          </div>
        </div>
        <p className="helper-text">
          当前 Probe 用于完整诊断；Dashboard 通过 endpoint Bridge 获取规范化快照，浏览器不会解析 Huawei XML。
        </p>
      </section>

      <section className="panel endpoints-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Endpoints</p>
            <h2>只读探针清单</h2>
          </div>
          <div className="probe-tools">
            <span className="count-badge">{report === null ? H168_PROBE_ENDPOINTS.length : rows.length}</span>
          </div>
        </div>
        {report === null ? (
          <div className="empty-state">
            <strong>尚未收到 H168 返回数据</strong>
            <p>安装开发中的 Surge Bridge 后点击“读取 Probe”。成功后这里会保留每个 endpoint 的状态、字段和脱敏 RAW XML。</p>
          </div>
        ) : (
          <div className="endpoint-list">
            {rows.map((row) => <EndpointCard key={row.id} row={row} />)}
          </div>
        )}
      </section>

      <footer className="page-footer">
        <span>V1 目标：Huawei / Brovi H168-383</span>
        <span>实时数据必须来自 iPhone ↔ Surge ↔ H168 本地链路</span>
      </footer>
    </main>
  );
}

export default App;
