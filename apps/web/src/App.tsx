import { useEffect, useMemo, useRef, useState } from "react";
import { H168_PROBE_ENDPOINTS } from "@cpehuahua/core";
import type { CpeLiveReport, EndpointProbeResult } from "@cpehuahua/core";
import { H168ControlClient } from "./control/client";
import { DashboardPage } from "./dashboard/DashboardPage";
import { LoginPage } from "./auth/LoginPage";
import { loadAuthPreferences, saveAuthPreferences } from "./live/auth-storage";
import { H168EndpointClient } from "./live/endpoint-client";
import { BridgeRequestGate } from "./live/bridge-request-gate";
import { DevicePollingSession } from "./live/device-session";
import { SurgeNetworkProbeClient } from "./live/network-client";
import { loadNetworkProbeUrl } from "./live/network-settings";
import {
  clearPersistedLiveReport,
  loadPersistedLiveReport,
  savePersistedLiveReport,
} from "./live/storage";
import type { AppView } from "./ui/BottomNav";

const DEFAULT_BRIDGE_URL = "https://cpe-bridge.example.com/api/probe";
const NETWORK_PROBE_INTERVAL_MS = 1_000;

const LIVE_CORE_ENDPOINTS = new Set([
  "device-basic-information",
  "monitoring-status",
  "net-current-plmn",
  "device-signal",
  "device-seccellinfo",
  "device-nbrcellinfo",
  "monitoring-traffic-statistics",
  "monitoring-month-statistics",
  "wlan-host-list",
  "monitoring-check-notifications",
  "sms-count",
]);

const LIVE_ENDPOINTS = H168_PROBE_ENDPOINTS.filter((endpoint) => (
  LIVE_CORE_ENDPOINTS.has(endpoint.id) || endpoint.id === "device-information"
));

type AuthStatus = "checking" | "login" | "authenticated";

function userFacingBridgeError(cause: unknown): string {
  if (cause instanceof Error && /load failed|failed to fetch|networkerror/i.test(cause.message)) {
    return "无法访问本地 Bridge：请在 Surge 中启用 CPE Huahua Module，并连接 H168 Wi-Fi。";
  }
  return cause instanceof Error ? cause.message : "无法连接 H168";
}

function liveEndpointError(result: EndpointProbeResult): string {
  const detail = result.transportError
    ?? (result.huaweiError?.code === null || result.huaweiError?.code === undefined
      ? null
      : `Huawei error ${result.huaweiError.code}`)
    ?? (result.httpStatus === null ? null : `HTTP ${result.httpStatus}`)
    ?? "未返回可用数据";
  return `${result.endpoint.label}读取失败：${detail}`;
}

function LoadingScreen() {
  return (
    <main className="app-shell login-shell" aria-live="polite">
      <section className="login-card login-card--loading">
        <div className="brand-line"><span className="brand-paw brand-paw--rose" aria-hidden="true">●</span><strong>CPE 花花</strong><i>H168-383</i></div>
        <p className="eyebrow">Secure session</p>
        <h1>正在自动登录</h1>
        <p className="lede">正在通过本地 Surge Bridge 恢复 H168 会话。</p>
      </section>
    </main>
  );
}

function App() {
  const bridgeUrl = DEFAULT_BRIDGE_URL;
  const [networkProbeUrl] = useState(() => loadNetworkProbeUrl());
  const [liveReport, setLiveReport] = useState<CpeLiveReport | null>(() => loadPersistedLiveReport());
  const [restoredFromStorage, setRestoredFromStorage] = useState(() => liveReport !== null);
  const [view, setView] = useState<AppView>("overview");
  const [authPreferences] = useState(() => loadAuthPreferences());
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() => authPreferences.rememberPassword ? "checking" : "login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(authPreferences.rememberPassword);
  const [liveMonitoring, setLiveMonitoring] = useState(false);
  const [liveErrors, setLiveErrors] = useState<Record<string, string>>({});
  const liveSessionRef = useRef<DevicePollingSession | null>(null);
  const liveClientRef = useRef<H168EndpointClient | null>(null);
  const livePasswordRef = useRef("");
  const autoLoginAttemptedRef = useRef(false);
  const bridgeRequestGate = useMemo(() => new BridgeRequestGate(), [bridgeUrl]);

  const liveError = Object.values(liveErrors)[0] ?? null;
  const controlClient = useMemo(() => new H168ControlClient(bridgeUrl, {
    getPassword: () => livePasswordRef.current,
    rememberSession: () => true,
    rememberPassword: () => rememberPassword,
    requestGate: bridgeRequestGate,
  }), [bridgeUrl, bridgeRequestGate, rememberPassword]);

  function startLiveMonitoring(client: H168EndpointClient) {
    liveSessionRef.current?.stop();
    setLiveErrors({});
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
        setLiveErrors((current) => {
          if (!("bridge" in current)) return current;
          const next = { ...current };
          delete next.bridge;
          return next;
        });
      },
      onEndpointResult: (result) => {
        if (!LIVE_CORE_ENDPOINTS.has(result.endpoint.id)) return;
        if (result.status === "ok") {
          setLiveErrors((current) => {
            if (!(result.endpoint.id in current)) return current;
            const next = { ...current };
            delete next[result.endpoint.id];
            return next;
          });
          return;
        }
        setLiveErrors((current) => ({ ...current, [result.endpoint.id]: liveEndpointError(result) }));
      },
      onError: (cause) => {
        setLiveErrors((current) => ({ ...current, bridge: userFacingBridgeError(cause) }));
      },
    });
    liveSessionRef.current = session;
    setLiveMonitoring(true);
    session.start();
  }

  async function authenticateAndStart(inputPassword: string, automatic = false) {
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError(null);
    if (inputPassword) livePasswordRef.current = inputPassword;
    const client = new H168EndpointClient(bridgeUrl, {
      getPassword: () => livePasswordRef.current,
      rememberSession: () => true,
      rememberPassword: () => rememberPassword,
      requestGate: bridgeRequestGate,
    });
    try {
      await client.authenticate();
      liveClientRef.current = client;
      setAuthStatus("authenticated");
      setView("overview");
      startLiveMonitoring(client);
    } catch (cause) {
      setAuthStatus("login");
      setAuthError(automatic ? "自动登录未完成，请输入 H168 管理密码。" : userFacingBridgeError(cause));
    } finally {
      setAuthLoading(false);
    }
  }

  function toggleLiveMonitoring() {
    if (liveSessionRef.current !== null) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
      setLiveMonitoring(false);
      return;
    }
    const client = liveClientRef.current;
    if (client) startLiveMonitoring(client);
  }

  function retryLive() {
    const client = liveClientRef.current;
    if (client) {
      startLiveMonitoring(client);
      return;
    }
    setAuthStatus("login");
  }

  function updateRememberPassword(value: boolean) {
    setRememberPassword(value);
    saveAuthPreferences({ rememberPassword: value });
  }

  function clearCachedLiveReport() {
    clearPersistedLiveReport();
    setLiveReport(null);
    setRestoredFromStorage(false);
  }

  useEffect(() => {
    if (!rememberPassword || autoLoginAttemptedRef.current) return;
    autoLoginAttemptedRef.current = true;
    void authenticateAndStart("", true);
  }, []);

  useEffect(() => () => {
    liveSessionRef.current?.stop();
  }, []);

  if (authStatus === "checking") return <LoadingScreen />;
  if (authStatus !== "authenticated") {
    return (
      <LoginPage
        busy={authLoading}
        error={authError}
        rememberPassword={rememberPassword}
        onSubmit={(value) => {
          saveAuthPreferences({ rememberPassword });
          void authenticateAndStart(value);
        }}
        onRememberPasswordChange={updateRememberPassword}
      />
    );
  }

  return (
    <DashboardPage
      activeView={view}
      snapshot={liveReport?.snapshot ?? null}
      history={liveReport?.history ?? []}
      events={liveReport?.events ?? []}
      cached={restoredFromStorage}
      liveMonitoring={liveMonitoring}
      liveError={liveError}
      networkProbeConfigured={networkProbeUrl.trim().length > 0}
      onToggleLive={toggleLiveMonitoring}
      onRetryLive={retryLive}
      onNavigate={setView}
      onClearCache={clearCachedLiveReport}
      controlClient={controlClient}
    />
  );
}

export default App;
