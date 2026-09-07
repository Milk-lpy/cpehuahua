import { H168_PROBE_ENDPOINTS } from "@cpehuahua/core";
import type { EndpointProbeResult, ProbeEndpoint } from "@cpehuahua/core";

interface EndpointBridgePayload {
  schemaVersion: 1;
  gateway: string | null;
  endpointResult: EndpointProbeResult;
}

export interface EndpointClientOptions {
  getPassword?: () => string;
  rememberSession?: () => boolean;
  rememberPassword?: () => boolean;
  fetcher?: typeof fetch;
  onGateway?: (gateway: string | null) => void;
}

function bridgePath(value: string, route: string): string {
  try {
    const url = new URL(value);
    const marker = url.pathname.indexOf("/api/");
    const prefix = marker >= 0 ? url.pathname.slice(0, marker) : url.pathname.replace(/\/$/, "");
    url.pathname = `${prefix}/api/${route}`;
    url.search = "";
    return url.toString();
  } catch {
    return value.replace(/\/api\/(?:probe|live)$/, `/api/${route}`);
  }
}

function endpointPath(value: string, endpointId: string): string {
  return bridgePath(value, `endpoint/${encodeURIComponent(endpointId)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEndpointResult(value: unknown): value is EndpointProbeResult {
  if (!isRecord(value)) return false;
  return isRecord(value.endpoint)
    && typeof value.status === "string"
    && typeof value.requestedAt === "string"
    && typeof value.completedAt === "string"
    && Array.isArray(value.parsedFields);
}

function isEndpointPayload(value: unknown): value is EndpointBridgePayload {
  return isRecord(value)
    && value.schemaVersion === 1
    && (typeof value.gateway === "string" || value.gateway === null)
    && isEndpointResult(value.endpointResult);
}

const REAUTH_ON_NO_RIGHTS_ENDPOINTS = new Set([
  "device-signal",
  "monitoring-status",
  "device-seccellinfo",
  "device-nbrcellinfo",
  "monitoring-traffic-statistics",
  "device-information",
  "net-cell-info",
]);

function isSessionFailure(result: EndpointProbeResult, endpoint?: ProbeEndpoint): boolean {
  return result.status === "transport-error"
    || result.httpStatus === 401
    || result.huaweiError?.code === 125002
    || result.huaweiError?.code === 125003
    // H168 may report an expired/insufficiently bound session as 100003
    // instead of the more specific 12500x session errors. The Bridge gets one
    // password-backed retry; a persistent 100003 remains visible as evidence.
    || (result.huaweiError?.code === 100003
      && endpoint !== undefined
      && REAUTH_ON_NO_RIGHTS_ENDPOINTS.has(endpoint.id));
}

function isHardSessionFailure(result: EndpointProbeResult, endpoint: ProbeEndpoint): boolean {
  return isSessionFailure(result, endpoint)
    && (result.huaweiError?.code === 100003
      || result.huaweiError?.code === 125002
      || result.huaweiError?.code === 125003);
}

function isAuthenticationFailure(result: EndpointProbeResult): boolean {
  const transportError = result.transportError ?? "";
  return result.huaweiError?.code === 125002
    || result.huaweiError?.code === 125003
    || result.huaweiError?.code === 100003
    || /(?:authentication_login|challenge_login|100003|125002|125003)/i.test(transportError);
}

/** Reads one endpoint through the local Surge Bridge; it never contacts Huawei directly. */
export class H168EndpointClient {
  private readonly bridgeUrl: string;
  private readonly getPassword: () => string;
  private readonly rememberSession: () => boolean;
  private readonly rememberPassword: () => boolean;
  private readonly fetcher: typeof fetch;
  private readonly onGateway: ((gateway: string | null) => void) | undefined;
  private deviceConfirmed = false;
  private sessionPrimed = false;
  private latestGateway: string | null = null;
  private readonly blockedSessionRetries = new Set<string>();

  constructor(bridgeUrl: string, options: EndpointClientOptions = {}) {
    this.bridgeUrl = bridgeUrl;
    this.getPassword = options.getPassword ?? (() => "");
    this.rememberSession = options.rememberSession ?? (() => true);
    this.rememberPassword = options.rememberPassword ?? (() => false);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.onGateway = options.onGateway;
  }

  get gateway(): string | null {
    return this.latestGateway;
  }

  async authenticate(): Promise<void> {
    const basic = H168_PROBE_ENDPOINTS.find((item) => item.id === "device-basic-information");
    const status = H168_PROBE_ENDPOINTS.find((item) => item.id === "monitoring-status");
    if (!basic || !status) throw new Error("H168 认证端点未配置");

    const basicResult = await this.read(basic);
    if (basicResult.status !== "ok") {
      throw new Error(basicResult.transportError ?? "无法确认 H168 设备");
    }
    const statusResult = await this.read(status);
    if (statusResult.status !== "ok") {
      if (isAuthenticationFailure(statusResult)) {
        throw new Error("管理密码错误，或 H168 登录会话已失效");
      }
      throw new Error(statusResult.transportError ?? "H168 登录失败，请检查设备连接");
    }
  }

  async read(endpoint: ProbeEndpoint): Promise<EndpointProbeResult> {
    if (endpoint.id !== "device-basic-information" && !this.deviceConfirmed) {
      throw new Error("必须先通过 basic_information 确认 H168-383");
    }
    const rememberSession = this.rememberSession();
    const password = this.getPassword();
    const retryBlocked = this.blockedSessionRetries.has(endpoint.id);
    const shouldSendPassword = endpoint.requiresAuth
      && password.length > 0
      && !retryBlocked
      && (!rememberSession || !this.sessionPrimed);
    let result = await this.request(endpoint, shouldSendPassword ? password : "", rememberSession);

    // A remembered Huawei session may expire between endpoint polls. Retry the
    // failed read once with the in-memory password, never recursively. The
    // Huawei firmware may report this as transport failure, HTTP 401, error
    // 125002/125003, or the less-specific 100003 depending on where the
    // session was rejected.
    if (
      isSessionFailure(result, endpoint)
      && password
      && rememberSession
      && !shouldSendPassword
      && !retryBlocked
    ) {
      result = await this.request(endpoint, password, rememberSession);
      if (isSessionFailure(result, endpoint)) {
        this.blockedSessionRetries.add(endpoint.id);
      }
    } else if (shouldSendPassword && rememberSession && isHardSessionFailure(result, endpoint)) {
      // The Bridge already attempted its single password-backed recovery for
      // this request. Avoid sending the password again on every poll if the
      // device still rejects the endpoint.
      this.blockedSessionRetries.add(endpoint.id);
    }

    if (result.status === "ok") {
      this.blockedSessionRetries.delete(endpoint.id);
    }

    if (endpoint.requiresAuth && rememberSession && (
      result.status === "ok"
      || (result.status === "huawei-error" && !isSessionFailure(result, endpoint))
    )) {
      this.sessionPrimed = true;
    }
    if (endpoint.id === "device-basic-information") {
      this.deviceConfirmed = result.status === "ok";
    }
    return result;
  }

  private async request(
    endpoint: ProbeEndpoint,
    password: string,
    rememberSession: boolean,
  ): Promise<EndpointProbeResult> {
    const hasPassword = password.length > 0;
    const response = await this.fetcher(endpointPath(this.bridgeUrl, endpoint.id), {
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
              rememberPassword: this.rememberPassword(),
            }),
          }
        : {}),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok || !isEndpointPayload(payload)) {
      const details = isRecord(payload) ? payload : {};
      throw new Error(
        typeof details.error === "string"
          ? details.error
          : `Bridge endpoint ${endpoint.id} failed (${response.status})`,
      );
    }
    if (this.latestGateway !== null && this.latestGateway !== payload.gateway) {
      this.deviceConfirmed = false;
      this.sessionPrimed = false;
      this.blockedSessionRetries.clear();
    }
    this.latestGateway = payload.gateway;
    this.onGateway?.(this.latestGateway);
    return { ...payload.endpointResult, endpoint };
  }
}

export { bridgePath, endpointPath };
