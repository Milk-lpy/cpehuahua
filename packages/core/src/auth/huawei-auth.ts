import type { CpeHttpRequest, CpeHttpResponse, CpeHttpTransport, HttpHeaders } from "../types/http";
import { parseHuaweiXml, textOfHuaweiField } from "../xml/parser";
import type { HuaweiError } from "../types/xml";

export type HuaweiAuthState =
  | "idle"
  | "bootstrapping"
  | "token-ready"
  | "challenged"
  | "authenticated"
  | "failed";

export interface AuthTrace {
  method: "GET" | "POST";
  path: string;
  httpStatus: number | null;
  tokenSent: boolean;
  sessionSent: boolean;
  durationMs: number | null;
}

export interface HuaweiAuthResult {
  sessionId: string;
  csrfToken: string;
  trace: AuthTrace[];
}

export interface HuaweiAuthOptions {
  username: string;
  password: string;
  loginFlag?: string;
  nonceFactory?: () => string;
}

export class HuaweiAuthError extends Error {
  readonly code: number | null;
  readonly authState: HuaweiAuthState;

  constructor(message: string, authState: HuaweiAuthState, code: number | null = null) {
    super(message);
    this.name = "HuaweiAuthError";
    this.code = code;
    this.authState = authState;
  }
}

function headerValues(headers: HttpHeaders, name: string): string[] {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  if (!key) {
    return [];
  }
  const value = headers[key];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

function hasHeader(headers: HttpHeaders, name: string): boolean {
  return Object.keys(headers).some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function bytesFromHex(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(normalized)) {
    throw new Error("salt is not an even-length hexadecimal string");
  }
  const result = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function hexFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function cryptoSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is unavailable");
  }
  return subtle;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await cryptoSubtle().digest("SHA-256", stableBuffer(data)));
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await cryptoSubtle().importKey(
    "raw",
    stableBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await cryptoSubtle().sign("HMAC", key, stableBuffer(data)));
}

/** Huawei challenge/authentication proof used by the current reference flow. */
export async function computeHuaweiClientProof(
  password: string,
  firstNonce: string,
  saltHex: string,
  iterations: number,
  serverNonce: string,
): Promise<string> {
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("challenge iterations must be a positive integer");
  }
  const subtle = cryptoSubtle();
  const passwordKey = await subtle.importKey(
    "raw",
    stableBuffer(new TextEncoder().encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltedPassword = new Uint8Array(
    await subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: stableBuffer(bytesFromHex(saltHex)), iterations },
      passwordKey,
      256,
    ),
  );
  // cpemanager's current Huawei flow uses the literal as the HMAC key and
  // the PBKDF2 result as the message; keep this order explicit.
  const clientKey = await hmacSha256(new TextEncoder().encode("Client Key"), saltedPassword);
  const storedKey = await sha256(clientKey);
  const authMessage = new TextEncoder().encode(`${firstNonce},${serverNonce},${serverNonce}`);
  // The same implementation uses authMessage as the HMAC key for storedKey.
  const signature = await hmacSha256(authMessage, storedKey);
  const proof = clientKey.map((value, index) => value ^ (signature[index] ?? 0));
  return hexFromBytes(proof);
}

function createNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto?.getRandomValues(bytes);
  if (bytes.every((byte) => byte === 0)) {
    throw new Error("secure random nonce generation failed");
  }
  return hexFromBytes(bytes);
}

/** Small, in-memory cookie jar. It deliberately stores only cookie pairs. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  ingest(headers: HttpHeaders): void {
    for (const header of headerValues(headers, "set-cookie")) {
      const firstPart = header.split(";", 1)[0] ?? "";
      const separator = firstPart.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const name = firstPart.slice(0, separator).trim();
      const value = firstPart.slice(separator + 1).trim();
      if (name && value) {
        this.cookies.set(name, value);
      }
    }
  }

  set(name: string, value: string): void {
    if (name && value) {
      this.cookies.set(name, value);
    }
  }

  get(name: string): string | null {
    return this.cookies.get(name) ?? null;
  }

  header(): string | null {
    if (this.cookies.size === 0) {
      return null;
    }
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function errorFrom(response: CpeHttpResponse): HuaweiError | null {
  return parseHuaweiXml(response.body).error;
}

function isSuccess(response: CpeHttpResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

function isSessionInvalid(response: CpeHttpResponse): boolean {
  const error = errorFrom(response);
  return response.status === 401 || error?.code === 125002 || error?.code === 125003;
}

/**
 * Huawei's two-step login state machine. The password is kept only in memory
 * for this instance so a single re-authentication can be attempted later.
 */
export class HuaweiAuthMachine {
  private readonly transport: CpeHttpTransport;
  private readonly username: string;
  private readonly password: string;
  private readonly loginFlag: string;
  private readonly nonceFactory: () => string;
  private readonly jar = new CookieJar();
  private readonly traces: AuthTrace[] = [];
  private stateValue: HuaweiAuthState = "idle";
  private csrfTokenValue: string | null = null;
  private sessionIdValue: string | null = null;

  constructor(transport: CpeHttpTransport, options: HuaweiAuthOptions) {
    this.transport = transport;
    this.username = options.username;
    this.password = options.password;
    this.loginFlag = options.loginFlag ?? "2";
    this.nonceFactory = options.nonceFactory ?? createNonce;
  }

  get state(): HuaweiAuthState {
    return this.stateValue;
  }

  get sessionId(): string | null {
    return this.sessionIdValue ?? this.jar.get("SessionID");
  }

  get hasCsrfToken(): boolean {
    return this.csrfTokenValue !== null;
  }

  get trace(): readonly AuthTrace[] {
    return this.traces;
  }

  private updateSessionFromResponse(response: CpeHttpResponse): void {
    this.jar.ingest(response.headers);
    const document = parseHuaweiXml(response.body);
    const sessionInfo = textOfHuaweiField(document, ["SesInfo"]);
    if (sessionInfo && sessionInfo !== "[REDACTED]") {
      this.sessionIdValue = sessionInfo;
      this.jar.set("SessionID", sessionInfo);
    }
  }

  private async send(request: CpeHttpRequest, token: string | null = null): Promise<CpeHttpResponse> {
    const headers: HttpHeaders = { ...request.headers };
    const cookie = this.jar.header();
    if (cookie && !hasHeader(headers, "cookie")) {
      headers.Cookie = cookie;
    }
    if (token && !hasHeader(headers, "__RequestVerificationToken")) {
      headers.__RequestVerificationToken = token;
    }
    const started = Date.now();
    try {
      const response = await this.transport.request({ ...request, headers });
      this.updateSessionFromResponse(response);
      this.traces.push({
        method: request.method,
        path: request.path,
        httpStatus: response.status,
        tokenSent: hasHeader(headers, "__RequestVerificationToken"),
        sessionSent: hasHeader(headers, "cookie"),
        durationMs: response.durationMs ?? Date.now() - started,
      });
      return response;
    } catch (error) {
      this.traces.push({
        method: request.method,
        path: request.path,
        httpStatus: null,
        tokenSent: hasHeader(headers, "__RequestVerificationToken"),
        sessionSent: hasHeader(headers, "cookie"),
        durationMs: Date.now() - started,
      });
      throw new HuaweiAuthError(
        error instanceof Error ? error.message : "Huawei request failed",
        this.stateValue,
      );
    }
  }

  private async acquireToken(): Promise<string> {
    const sessionResponse = await this.send({
      method: "GET",
      path: "/api/webserver/SesTokInfo",
      headers: {},
      body: null,
    });
    const sessionDocument = parseHuaweiXml(sessionResponse.body);
    const token = textOfHuaweiField(sessionDocument, ["TokInfo"]);
    if (isSuccess(sessionResponse) && token) {
      this.csrfTokenValue = token;
      return token;
    }

    const fallbackResponse = await this.send({
      method: "GET",
      path: "/api/webserver/token",
      headers: {},
      body: null,
    });
    const fallbackDocument = parseHuaweiXml(fallbackResponse.body);
    const fallback = textOfHuaweiField(fallbackDocument, ["token"]);
    if (!isSuccess(fallbackResponse) || !fallback) {
      throw new HuaweiAuthError("无法获取 Huawei CSRF token", this.stateValue, errorFrom(fallbackResponse)?.code ?? null);
    }
    // Older firmware commonly prefixes the usable token with a 32-character marker.
    this.csrfTokenValue = fallback.length > 32 ? fallback.slice(32) : fallback;
    return this.csrfTokenValue;
  }

  private assertResponse(response: CpeHttpResponse, operation: string): void {
    const error = errorFrom(response);
    if (!isSuccess(response) || error) {
      throw new HuaweiAuthError(
        `${operation} failed${error?.message ? `: ${error.message}` : ""}`,
        this.stateValue,
        error?.code ?? null,
      );
    }
  }

  async login(force = false): Promise<HuaweiAuthResult> {
    if (this.stateValue === "authenticated" && !force && this.sessionId && this.csrfTokenValue) {
      return {
        sessionId: this.sessionId,
        csrfToken: this.csrfTokenValue,
        trace: [...this.traces],
      };
    }

    this.stateValue = "bootstrapping";
    this.csrfTokenValue = null;
    this.traces.length = 0;
    try {
      const content = await this.send({ method: "GET", path: "/html/content.html", headers: {}, body: null });
      if (!isSuccess(content)) {
        await this.send({ method: "GET", path: "/", headers: {}, body: null });
      }
      try {
        await this.send({ method: "GET", path: "/api/user/state-login", headers: {}, body: null });
      } catch {
        // State discovery is advisory; the challenge flow remains authoritative.
      }

      const challengeToken = await this.acquireToken();
      const firstNonce = this.nonceFactory();
      const challenge = await this.send(
        {
          method: "POST",
          path: "/api/user/challenge_login",
          headers: { "Content-Type": "application/xml" },
          body:
            `<request><username>${escapeXml(this.username)}</username>`
            + `<firstnonce>${escapeXml(firstNonce)}</firstnonce><mode>1</mode>`
            + `<loginflag>${escapeXml(this.loginFlag)}</loginflag></request>`,
        },
        challengeToken,
      );
      this.assertResponse(challenge, "challenge_login");
      const challengeDocument = parseHuaweiXml(challenge.body);
      const salt = textOfHuaweiField(challengeDocument, ["salt"]);
      const iterationsText = textOfHuaweiField(challengeDocument, ["iterations"]);
      const serverNonce = textOfHuaweiField(challengeDocument, ["servernonce"]);
      const iterations = iterationsText === null ? null : Number.parseInt(iterationsText, 10);
      if (!salt || !serverNonce || iterations === null || !Number.isInteger(iterations)) {
        throw new HuaweiAuthError("challenge_login 响应缺少 salt/iterations/servernonce", this.stateValue);
      }
      this.stateValue = "challenged";

      const authenticationToken = await this.acquireToken();
      const clientProof = await computeHuaweiClientProof(
        this.password,
        firstNonce,
        salt,
        iterations,
        serverNonce,
      );
      const authentication = await this.send(
        {
          method: "POST",
          path: "/api/user/authentication_login",
          headers: { "Content-Type": "application/xml" },
          body:
            `<request><clientproof>${clientProof}</clientproof>`
            + `<finalnonce>${escapeXml(serverNonce)}</finalnonce>`
            + `<loginflag>${escapeXml(this.loginFlag)}</loginflag></request>`,
        },
        authenticationToken,
      );
      this.assertResponse(authentication, "authentication_login");
      if (!this.sessionId) {
        throw new HuaweiAuthError("认证完成后未获取到 SessionID", this.stateValue);
      }
      this.stateValue = "authenticated";
      return {
        sessionId: this.sessionId,
        csrfToken: authenticationToken,
        trace: [...this.traces],
      };
    } catch (error) {
      this.stateValue = "failed";
      if (error instanceof HuaweiAuthError) {
        throw error;
      }
      throw new HuaweiAuthError(
        error instanceof Error ? error.message : "Huawei login failed",
        this.stateValue,
      );
    }
  }

  async requestWithSession(request: CpeHttpRequest): Promise<CpeHttpResponse> {
    if (this.stateValue !== "authenticated" || !this.sessionId || !this.csrfTokenValue) {
      await this.login();
    }
    const response = await this.send(request, this.csrfTokenValue);
    if (!isSessionInvalid(response)) {
      return response;
    }
    // Exactly one refresh attempt. The caller sees the second failure.
    await this.login(true);
    return this.send(request, this.csrfTokenValue);
  }
}

export { isSessionInvalid };
