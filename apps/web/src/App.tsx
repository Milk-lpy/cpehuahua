import { useEffect, useMemo, useRef, useState } from "react";
import type { CpeLiveReport, ProbeReport } from "@cpehuahua/core";
import { H168_PROBE_ENDPOINTS } from "@cpehuahua/core";
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
import { toProbeRows } from "./probe/view-model";

const DEFAULT_BRIDGE_URL = "https://cpe-bridge.example.com/api/probe";

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
      getGateway: () => client.gateway,
      ...(configuredProbeUrl
        ? { networkProbe: () => networkClient.probe(configuredProbeUrl) }
        : {}),
      onUpdate: (update) => {
        setLiveReport(update);
        setRestoredFromStorage(false);
        savePersistedLiveReport(update);
        setLiveMonitoring(true);
        setView("dashboard");
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
      setLiveReport(null);
      setRestoredFromStorage(false);
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
          <span className="count-badge">{report === null ? H168_PROBE_ENDPOINTS.length : rows.length}</span>
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
