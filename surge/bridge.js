/* global $done, $httpClient, $network, $persistentStore, $request */

/**
 * CPE Huahua local read-only probe bridge.
 *
 * This is a bounded, single-file Surge runtime entrypoint. The canonical
 * protocol logic is tested in packages/core; this file mirrors the required
 * subset for Surge's callback HTTP API and WebView Web Crypto runtime. It never calls a
 * Huawei write endpoint and never logs credentials, cookies, or tokens.
 */

const STORE_KEY = "cpehuahua.bridge.v1";
const DEVICE_TIMEOUT_SECONDS = 8;
// Replace the production origin when the hosted PWA has a real domain.
const ALLOWED_WEB_ORIGINS = new Set([
  "https://cpehuahua.example.com",
  "http://localhost:4173",
]);

const ENDPOINTS = [
  endpoint("device-basic-information", "Device basic information", "/api/device/basic_information", false, null, "h168-reference-claimed"),
  endpoint("monitoring-status", "Monitoring status", "/api/monitoring/status", false, 2_000, "h168-reference-claimed"),
  endpoint("net-current-plmn", "Current PLMN", "/api/net/current-plmn", false, 10_000, "h168-reference-claimed"),
  endpoint("device-signal", "Signal", "/api/device/signal", true, 1_000, "h168-reference-claimed"),
  endpoint("device-seccellinfo", "Secondary cells / CA", "/api/device/seccellinfo", true, 1_000, "reference-shape"),
  endpoint("device-nbrcellinfo", "Neighbor cells", "/api/device/nbrcellinfo", true, 3_000, "reference-shape"),
  endpoint("monitoring-traffic-statistics", "Traffic statistics", "/api/monitoring/traffic-statistics", true, 1_000, "h168-reference-claimed"),
  endpoint("device-information", "Device information (diagnostic)", "/api/device/information", true, null, "h168-reference-claimed"),
  endpoint("webserver-sestokinfo", "Session/token info", "/api/webserver/SesTokInfo", false, null, "login-protocol"),
  endpoint("user-state-login", "Login state", "/api/user/state-login", false, null, "h168-reference-claimed"),
  endpoint("developermode-developer-mode", "Developer mode (read-only candidate)", "/api/developermode/developer-mode", true, null, "reference-shape"),
  endpoint("developermode-developer-item", "Developer items (read-only candidate)", "/api/developermode/developer-item", true, null, "reference-shape"),
  endpoint("app-atport-status", "AT port status (GET only)", "/api/app/atport-status", true, null, "reference-shape"),
  endpoint("net-cell-info", "Generic cell info (candidate)", "/api/net/cell-info", true, null, "candidate"),
];

const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd", "imei", "imsi", "msisdn", "phone",
  "phonenumber", "mobilenumber", "mac", "macaddress", "ipv6", "publicipv6",
  "sessionid", "sesinfo", "tokinfo", "token", "csrf", "csrftoken",
  "requestverificationtoken", "firstnonce", "servernonce", "salt",
  "clientproof", "finalnonce",
]);

function endpoint(id, label, path, requiresAuth, intervalMs, evidence) {
  return {
    id,
    label,
    path,
    intervalMs,
    requiresAuth,
    defaultEnabled: true,
    evidence,
  };
}

function now() {
  return new Date().toISOString();
}

function isSensitiveKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || normalized.includes("requestverificationtoken");
}

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlText(rawXml, names) {
  for (const name of names) {
    const escaped = String(name).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    const pattern = new RegExp(
      "<\\s*" + escaped + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\s*/\\s*" + escaped + "\\s*>",
      "i",
    );
    const match = String(rawXml).match(pattern);
    if (match && match[1] !== undefined) {
      const text = decodeXml(match[1].replace(/<[^>]*>/g, "")).trim();
      if (text) return text;
    }
  }
  return null;
}

function rootName(rawXml) {
  const match = String(rawXml).match(/<\s*([A-Za-z_][\w:.-]*)\b[^>]*>/);
  return match?.[1] ?? null;
}

function errorFromXml(rawXml) {
  const root = rootName(rawXml);
  const hasError = root?.toLowerCase() === "error" || /<\s*error(?:\s[^>]*)?>/i.test(rawXml);
  if (!hasError) return null;
  const rawCode = xmlText(rawXml, ["code"]);
  const numericCode = rawCode === null ? null : Number.parseInt(rawCode, 10);
  return {
    code: Number.isNaN(numericCode) ? null : numericCode,
    rawCode,
    message: xmlText(rawXml, ["message"]),
  };
}

function addObjectValue(object, key, value) {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    object[key] = value;
  } else if (Array.isArray(object[key])) {
    object[key].push(value);
  } else {
    object[key] = [object[key], value];
  }
}

function domValue(element) {
  const children = Array.from(element.children || []);
  const attributes = Array.from(element.attributes || []);
  if (children.length === 0 && attributes.length === 0) {
    return String(element.textContent || "").trim();
  }

  const result = {};
  for (const attribute of attributes) {
    result["@_" + attribute.name] = attribute.value;
  }
  if (children.length === 0) {
    result["#text"] = String(element.textContent || "").trim();
  } else {
    for (const child of children) {
      addObjectValue(result, child.tagName, domValue(child));
    }
  }
  return result;
}

function collectDomFields(element, prefix, fields) {
  const children = Array.from(element.children || []);
  if (children.length === 0) {
    fields.add(prefix);
    return;
  }
  for (const child of children) {
    collectDomFields(child, prefix + "." + child.tagName, fields);
  }
}

function parseXml(rawXml) {
  const raw = String(rawXml || "");
  const root = rootName(raw);
  const error = errorFromXml(raw);
  const base = {
    rawXml: raw,
    rootName: root,
    data: null,
    response: {},
    fields: [],
    error,
    parseError: null,
  };

  if (!raw.trim()) return { ...base, parseError: "XML response is empty" };
  if (typeof DOMParser === "undefined") {
    return { ...base, parseError: "Surge WebView does not expose DOMParser" };
  }

  try {
    const document = new DOMParser().parseFromString(raw, "application/xml");
    const element = document.documentElement;
    if (!element || element.tagName.toLowerCase() === "parsererror") {
      return { ...base, parseError: "Invalid XML response" };
    }
    const value = domValue(element);
    const data = {};
    data[element.tagName] = value;
    let responseElement = element;
    if (element.tagName.toLowerCase() !== "response") {
      responseElement = Array.from(element.children || [])
        .find((child) => child.tagName.toLowerCase() === "response") || element;
    }
    const response = responseElement === element ? value : domValue(responseElement);
    const fieldSet = new Set();
    collectDomFields(responseElement, "response", fieldSet);
    return {
      ...base,
      data,
      response: typeof response === "object" && response !== null && !Array.isArray(response)
        ? response
        : { "#text": response },
      fields: [...fieldSet].sort(),
    };
  } catch (errorValue) {
    return {
      ...base,
      parseError: errorValue instanceof Error ? errorValue.message : "Invalid XML response",
    };
  }
}

function sanitizeValue(value, key) {
  if (isSensitiveKey(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key));
  if (value && typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = sanitizeValue(childValue, childKey);
    }
    return result;
  }
  return value;
}

function sanitizeXml(rawXml) {
  const tokens = String(rawXml || "").match(/<[^>]+>|[^<]+/g) || [];
  const output = [];
  const openTags = [];
  let sensitiveDepth = 0;
  let redactionWritten = false;

  for (const token of tokens) {
    const closing = token.match(/^<\/\s*([\w:.-]+)\s*>$/);
    if (closing) {
      const tag = closing[1] || "";
      const openIndex = openTags.lastIndexOf(tag);
      if (openIndex >= 0) {
        const openedTag = openTags.splice(openIndex, 1)[0];
        if (openedTag && isSensitiveKey(openedTag)) sensitiveDepth -= 1;
      }
      output.push(token);
      if (sensitiveDepth === 0) redactionWritten = false;
      continue;
    }

    const opening = token.match(/^<\s*([\w:.-]+)(?:\s[^>]*)?>$/);
    if (opening) {
      const tag = opening[1] || "";
      const selfClosing = /\/\s*>$/.test(token);
      if (!selfClosing) {
        openTags.push(tag);
        if (isSensitiveKey(tag)) sensitiveDepth += 1;
      }
      output.push(token);
      continue;
    }

    if (sensitiveDepth > 0) {
      if (!redactionWritten && token.trim()) {
        output.push("[REDACTED]");
        redactionWritten = true;
      } else if (!token.trim()) {
        output.push(token);
      }
    } else {
      output.push(token);
    }
  }
  return output.join("");
}

function parseStoredState() {
  try {
    const text = $persistentStore.read(STORE_KEY);
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredState(context) {
  const state = {};
  if (context.rememberSession && Object.keys(context.cookies).length > 0) {
    state.cookies = context.cookies;
    state.csrfToken = context.csrfToken;
  }
  if (context.rememberPassword && context.password) {
    state.password = context.password;
  }
  state.rememberSession = context.rememberSession;
  state.rememberPassword = context.rememberPassword;
  if (Object.keys(state).length > 2) {
    $persistentStore.write(JSON.stringify(state), STORE_KEY);
  } else {
    $persistentStore.write(null, STORE_KEY);
  }
}

function headerEntries(headers) {
  if (Array.isArray(headers)) {
    return headers.map((item) => [String(item.field || ""), String(item.value || "")]);
  }
  return Object.entries(headers || {}).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.map((item) => [key, String(item)]);
    return [[key, String(value)]];
  });
}

function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  const entry = headerEntries(headers).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1] || null;
}

function ingestCookies(headers, cookies) {
  for (const [key, value] of headerEntries(headers)) {
    if (key.toLowerCase() !== "set-cookie") continue;
    const pair = value.split(";", 1)[0] || "";
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    if (name && cookieValue) cookies[name] = cookieValue;
  }
}

function cookieHeader(cookies) {
  const values = Object.entries(cookies);
  return values.length === 0 ? null : values.map(([key, value]) => key + "=" + value).join("; ");
}

function responseBodyText(data) {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return data == null ? "" : String(data);
}

function deviceRequest(baseUrl, cookies, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...(headers || {}) };
    const cookiesForRequest = cookieHeader(cookies);
    if (cookiesForRequest) requestHeaders.Cookie = cookiesForRequest;
    const options = {
      url: baseUrl + path,
      headers: requestHeaders,
      timeout: DEVICE_TIMEOUT_SECONDS,
      "auto-cookie": false,
      "full-header-mode": true,
    };
    if (body !== null && body !== undefined) options.body = body;
    const requestMethod = $httpClient[String(method).toLowerCase()];
    if (typeof requestMethod !== "function") {
      reject(new Error("Surge $httpClient method unavailable"));
      return;
    }
    requestMethod.call($httpClient, options, (error, response, data) => {
      if (error) {
        reject(new Error(String(error)));
        return;
      }
      const responseHeaders = response?.headers || {};
      ingestCookies(responseHeaders, cookies);
      resolve({
        status: typeof response?.status === "number" ? response.status : 0,
        headers: responseHeaders,
        body: responseBodyText(data),
      });
    });
  });
}

function isSuccessful(response) {
  return response.status >= 200 && response.status < 300;
}

function isSessionInvalid(response, parsed) {
  return response.status === 401 || parsed.error?.code === 125002 || parsed.error?.code === 125003;
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesFromSalt(value) {
  const trimmed = String(value).trim();
  if (/^(?:[0-9a-f]{2})+$/i.test(trimmed)) {
    const bytes = new Uint8Array(trimmed.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(trimmed.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }
  const binary = atob(trimmed);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function clientProof(password, firstNonce, salt, iterations, serverNonce) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltedPassword = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bytesFromSalt(salt), iterations },
    passwordKey,
    256,
  ));
  // Match cpemanager's current Huawei implementation: literal first as key.
  const clientKey = await hmac(new TextEncoder().encode("Client Key"), saltedPassword);
  const storedKey = new Uint8Array(await crypto.subtle.digest("SHA-256", clientKey));
  const signature = await hmac(
    new TextEncoder().encode(firstNonce + "," + serverNonce + "," + serverNonce),
    storedKey,
  );
  const proof = clientKey.map((byte, index) => byte ^ (signature[index] || 0));
  return hex(proof);
}

function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

function contextFromRequest() {
  const stored = parseStoredState();
  let payload = {};
  if (String($request.method).toUpperCase() === "POST" && $request.body) {
    try {
      const body = typeof $request.body === "string" ? $request.body : new TextDecoder().decode($request.body);
      const parsedPayload = JSON.parse(body);
      payload = parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)
        ? parsedPayload
        : {};
    } catch {
      throw new Error("Probe request body must be JSON");
    }
  }
  const payloadPassword = typeof payload.password === "string" ? payload.password : "";
  const storedPassword = typeof stored.password === "string" ? stored.password : "";
  const rememberSession = typeof payload.rememberSession === "boolean"
    ? payload.rememberSession
    : stored.rememberSession === true;
  const rememberPassword = typeof payload.rememberPassword === "boolean"
    ? payload.rememberPassword
    : stored.rememberPassword === true;
  return {
    baseUrl: null,
    cookies: rememberSession && stored.cookies && typeof stored.cookies === "object" ? { ...stored.cookies } : {},
    csrfToken: rememberSession && typeof stored.csrfToken === "string" ? stored.csrfToken : null,
    password: payloadPassword || (rememberPassword ? storedPassword : ""),
    username: typeof payload.username === "string" && payload.username ? payload.username : "admin",
    rememberSession,
    rememberPassword,
    authenticated: false,
  };
}

function updateContext(context, response) {
  ingestCookies(response.headers, context.cookies);
  const sessionInfo = xmlText(response.body, ["SesInfo"]);
  if (sessionInfo) context.cookies.SessionID = sessionInfo;
  const tokenInfo = xmlText(response.body, ["TokInfo"]);
  if (tokenInfo) context.csrfToken = tokenInfo;
  const rotatedToken = headerValue(response.headers, "__RequestVerificationToken")
    || headerValue(response.headers, "__RequestVerificationTokenone");
  if (rotatedToken) context.csrfToken = rotatedToken;
}

async function contextRequest(context, method, path, headers = {}, body = null) {
  const response = await deviceRequest(context.baseUrl, context.cookies, method, path, headers, body);
  updateContext(context, response);
  return response;
}

async function acquireToken(context) {
  let response = await contextRequest(context, "GET", "/api/webserver/SesTokInfo");
  let parsed = parseXml(response.body);
  let token = xmlText(response.body, ["TokInfo"]);
  if (isSuccessful(response) && token) {
    context.csrfToken = token;
    return token;
  }

  response = await contextRequest(context, "GET", "/api/webserver/token");
  parsed = parseXml(response.body);
  token = xmlText(response.body, ["token"]);
  if (!isSuccessful(response) || !token) {
    throw new Error("无法获取 Huawei CSRF token" + (parsed.error?.code ? " (" + parsed.error.code + ")" : ""));
  }
  context.csrfToken = token.length > 32 ? token.slice(32) : token;
  return context.csrfToken;
}

function authHeaders(context, token) {
  const headers = { "Content-Type": "application/xml" };
  if (token) headers.__RequestVerificationToken = token;
  return headers;
}

async function login(context, force) {
  if (force) {
    context.cookies = {};
    context.csrfToken = null;
    context.authenticated = false;
  }
  if (context.authenticated && context.csrfToken && cookieHeader(context.cookies)) return;

  let content = await contextRequest(context, "GET", "/html/content.html");
  if (!isSuccessful(content)) content = await contextRequest(context, "GET", "/");

  // This is advisory. The challenge flow below is the authority for new firmware.
  await contextRequest(context, "GET", "/api/user/state-login").catch(() => null);

  if (!context.password && cookieHeader(context.cookies)) {
    context.csrfToken = await acquireToken(context);
    context.authenticated = true;
    return;
  }
  if (!context.password) throw new Error("需要 H168 管理密码或仍有效的 Remember Session");

  const challengeToken = await acquireToken(context);
  const firstNonce = randomNonce();
  const challenge = await contextRequest(
    context,
    "POST",
    "/api/user/challenge_login",
    authHeaders(context, challengeToken),
    "<request><username>" + escapeXml(context.username)
      + "</username><firstnonce>" + escapeXml(firstNonce)
      + "</firstnonce><mode>1</mode><loginflag>2</loginflag></request>",
  );
  const challengeParsed = parseXml(challenge.body);
  if (!isSuccessful(challenge) || challengeParsed.error) {
    throw new Error("challenge_login 失败" + (challengeParsed.error?.code ? " (" + challengeParsed.error.code + ")" : ""));
  }
  const salt = xmlText(challenge.body, ["salt"]);
  const iterationsText = xmlText(challenge.body, ["iterations"]);
  const serverNonce = xmlText(challenge.body, ["servernonce"]);
  const iterations = iterationsText === null ? NaN : Number.parseInt(iterationsText, 10);
  if (!salt || !serverNonce || !Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("challenge_login 响应缺少 salt/iterations/servernonce");
  }

  const authenticationToken = await acquireToken(context);
  const proof = await clientProof(context.password, firstNonce, salt, iterations, serverNonce);
  const authentication = await contextRequest(
    context,
    "POST",
    "/api/user/authentication_login",
    authHeaders(context, authenticationToken),
    "<request><clientproof>" + proof
      + "</clientproof><finalnonce>" + escapeXml(serverNonce)
      + "</finalnonce><loginflag>2</loginflag></request>",
  );
  const authenticationParsed = parseXml(authentication.body);
  if (!isSuccessful(authentication) || authenticationParsed.error) {
    throw new Error("authentication_login 失败" + (authenticationParsed.error?.code ? " (" + authenticationParsed.error.code + ")" : ""));
  }
  if (!cookieHeader(context.cookies)) throw new Error("认证完成后未获取到 SessionID");
  context.csrfToken = authenticationToken;
  context.authenticated = true;
}

async function authenticatedGet(context, path) {
  await login(context, false);
  let response = await contextRequest(context, "GET", path, authHeaders(context, context.csrfToken));
  const parsed = parseXml(response.body);
  if (isSessionInvalid(response, parsed)) {
    // Exactly one re-authentication attempt; no recursive retry.
    await login(context, true);
    response = await contextRequest(context, "GET", path, authHeaders(context, context.csrfToken));
  }
  return response;
}

async function publicGet(context, path) {
  return contextRequest(context, "GET", path);
}

function resultFor(endpointDefinition, response, requestedAt, started) {
  const parsed = parseXml(response.body);
  const status = parsed.error
    ? "huawei-error"
    : parsed.parseError
      ? "parse-error"
      : !isSuccessful(response)
        ? "http-error"
        : "ok";
  const sanitizedRawXml = sanitizeXml(response.body);
  return {
    endpoint: endpointDefinition,
    status,
    requestedAt,
    completedAt: now(),
    latencyMs: Date.now() - started,
    httpStatus: response.status,
    huaweiError: parsed.error,
    transportError: null,
    rawXml: response.body,
    sanitizedRawXml,
    parsed: {
      ...parsed,
      rawXml: response.body,
      data: sanitizeValue(parsed.data, ""),
      response: sanitizeValue(parsed.response, ""),
    },
    parsedFields: parsed.fields,
  };
}

function transportResult(endpointDefinition, requestedAt, started, message) {
  return {
    endpoint: endpointDefinition,
    status: "transport-error",
    requestedAt,
    completedAt: now(),
    latencyMs: Date.now() - started,
    httpStatus: null,
    huaweiError: null,
    transportError: message,
    rawXml: "",
    sanitizedRawXml: "",
    parsed: null,
    parsedFields: [],
  };
}

function rawResult(results, id) {
  const result = results.find((item) => item.endpoint.id === id);
  return result && result.status === "ok" ? result.rawXml : null;
}

function numericText(value) {
  const text = value === null || value === undefined ? null : String(value).trim();
  if (!text || !/^[-+]?\d+(?:\.\d+)?(?:\s*[a-zA-Z%]+)?$/.test(text)) return null;
  const match = text.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function xmlNumber(rawXml, names) {
  return numericText(xmlText(rawXml, names));
}

function xmlBoolean(rawXml, names) {
  const value = xmlText(rawXml, names)?.toLowerCase();
  if (!value) return null;
  if (["online", "connected", "up", "registered", "connectedstate"].includes(value)) return true;
  if (["offline", "disconnected", "down", "unregistered"].includes(value)) return false;
  return null;
}

function emptyRadio() {
  return {
    rsrpDbm: null,
    rsrqDb: null,
    sinrDb: null,
    rssiDbm: null,
    pci: null,
    cellId: null,
    tac: null,
    band: null,
    arfcn: null,
    cqi: null,
    mimoRank: null,
    dlMcs: null,
    ulMcs: null,
    blerPct: null,
    txPowerDbm: null,
  };
}

function metricSet(rawXml, nr, genericNrKeys) {
  const pciNames = nr ? (genericNrKeys ? ["nrpci", "pci"] : ["nrpci"]) : ["pci"];
  const cellIdNames = nr
    ? (genericNrKeys ? ["nrcellid", "cell_id", "nrcell_id"] : ["nrcellid", "nrcell_id"])
    : ["cell_id", "cellid"];
  const bandNames = nr
    ? (genericNrKeys ? ["nrband", "bandInfo", "band"] : ["nrband", "bandInfo"])
    : ["band", "bandInfo"];
  const arfcnNames = nr
    ? (genericNrKeys ? ["nrearfcn", "nrarfcn", "earfcn"] : ["nrearfcn", "nrarfcn"])
    : ["earfcn", "arfcn"];
  return {
    rsrpDbm: xmlNumber(rawXml, [nr ? "nrrsrp" : "rsrp"]),
    rsrqDb: xmlNumber(rawXml, [nr ? "nrrsrq" : "rsrq"]),
    sinrDb: xmlNumber(rawXml, [nr ? "nrsinr" : "sinr"]),
    rssiDbm: xmlNumber(rawXml, [nr ? "nrrssi" : "rssi"]),
    pci: xmlNumber(rawXml, pciNames),
    cellId: xmlText(rawXml, cellIdNames),
    tac: xmlText(rawXml, [nr ? "nrtac" : "tac"]),
    band: xmlText(rawXml, bandNames),
    arfcn: xmlNumber(rawXml, arfcnNames),
    cqi: xmlNumber(rawXml, [nr ? "nrcqi0" : "cqi0", nr ? "nrcqi" : "cqi"]),
    mimoRank: xmlNumber(rawXml, [nr ? "nrrank" : "rank", nr ? "nrmimorank" : "mimorank"]),
    dlMcs: xmlNumber(rawXml, [nr ? "nrdlmcs" : "dl_mcs", nr ? "nrdlmcs" : "dlmcs"]),
    ulMcs: xmlNumber(rawXml, [nr ? "nrulmcs" : "ul_mcs", nr ? "nrumcs" : "ulmcs"]),
    blerPct: xmlNumber(rawXml, [nr ? "nrbler" : "bler"]),
    txPowerDbm: xmlNumber(rawXml, [nr ? "nrtxpower" : "txpower"]),
  };
}

function hasCellData(cell) {
  return Object.values(cell).some((value) => value !== null);
}

function makeCell(role, technology, metrics) {
  return { role, technology, ...metrics };
}

function cellList(raw, technology, role, hasBandwidth) {
  if (!raw) return [];
  return String(raw).split(";")
    .map((item) => item.split(",").map((part) => part.trim()))
    .filter((parts) => parts.some(Boolean))
    .map((parts) => {
      const offset = hasBandwidth ? 1 : 0;
      const value = (index) => parts[index + offset] || null;
      return makeCell(role, technology, {
        rsrpDbm: numericText(value(3)),
        rsrqDb: numericText(value(4)),
        sinrDb: numericText(value(6)),
        rssiDbm: numericText(value(5)),
        pci: numericText(value(2)),
        cellId: null,
        tac: null,
        band: parts[1] || null,
        arfcn: numericText(parts[0] || null),
        cqi: null,
        mimoRank: null,
        dlMcs: null,
        ulMcs: null,
        blerPct: null,
        txPowerDbm: null,
      });
    });
}

function emptyCapabilities() {
  return {
    signal: "unknown",
    secondaryCells: "unknown",
    neighbors: "unknown",
    traffic: "unknown",
    temperature: "unknown",
    fan: "unknown",
    qci: "unknown",
    fiveQi: "unknown",
    ambr: "unknown",
    cpu: "unknown",
    memory: "unknown",
    mcs: "unknown",
    cqi: "unknown",
    mimoRank: "unknown",
    bler: "unknown",
    txPower: "unknown",
  };
}

function markCapability(capabilities, results, endpointId, key) {
  const result = results.find((item) => item.endpoint.id === endpointId);
  if (!result) return;
  if (result.status === "ok") capabilities[key] = "observed";
  if (result.huaweiError?.code === 100002 || result.huaweiError?.code === 100003) {
    capabilities[key] = "unsupported";
  }
}

function radioModeFor(mode) {
  if (mode === "101" || mode === "102" || mode === "12") return "5G";
  if (["7", "8", "9", "10"].includes(mode)) return "4G";
  if (["1", "2", "3"].includes(mode)) return mode === "1" ? "2G" : "3G";
  return "unknown";
}

function saNsaFor(mode) {
  if (mode === "101") return "NSA";
  if (mode === "102" || mode === "12") return "SA";
  return "unknown";
}

function rateBps(rawXml, names) {
  const value = xmlNumber(rawXml, names);
  // Reference documentation describes Current*Rate as bytes/s. H168 unit
  // still needs live confirmation, so this conversion remains easy to revise.
  return value === null ? null : value * 8;
}

function normalizeLiveSnapshot(results) {
  const signal = rawResult(results, "device-signal");
  const basic = rawResult(results, "device-basic-information");
  const plmnDocument = rawResult(results, "net-current-plmn");
  const secondary = rawResult(results, "device-seccellinfo");
  const neighborsDocument = rawResult(results, "device-nbrcellinfo");
  const status = rawResult(results, "monitoring-status");
  const traffic = rawResult(results, "monitoring-traffic-statistics");
  const mode = xmlText(signal, ["mode"]);
  const isSa = mode === "102" || mode === "12";
  const lte = metricSet(signal, false, false);
  const nr = metricSet(signal, true, isSa);
  const pcc = isSa
    ? (hasCellData(nr) ? makeCell("pcc", "NR", nr) : null)
    : hasCellData(lte)
      ? makeCell("pcc", "LTE", lte)
      : hasCellData(nr)
        ? makeCell("pcc", "NR", nr)
        : null;
  const signalScells = [];
  if (mode === "101" && hasCellData(nr)) signalScells.push(makeCell("scell", "NR", nr));
  if (isSa && hasCellData(lte)) signalScells.push(makeCell("scell", "LTE", lte));
  if (xmlText(signal, ["scc_pci"])) {
    signalScells.push(makeCell("scell", "LTE", {
      ...emptyRadio(),
      pci: xmlNumber(signal, ["scc_pci"]),
      band: xmlText(signal, ["scc_band"]),
    }));
  }
  const scells = [
    ...signalScells,
    ...cellList(xmlText(secondary, ["nrseccell_list"]), "NR", "scell", true),
    ...cellList(xmlText(secondary, ["lteseccell_list"]), "LTE", "scell", true),
  ];
  const neighbors = [
    ...cellList(xmlText(neighborsDocument, ["nbrcell_nrlist"]), "NR", "neighbor", false),
    ...cellList(xmlText(neighborsDocument, ["nbrcell_ltelist"]), "LTE", "neighbor", false),
  ];
  const capabilities = emptyCapabilities();
  markCapability(capabilities, results, "device-signal", "signal");
  markCapability(capabilities, results, "device-seccellinfo", "secondaryCells");
  markCapability(capabilities, results, "device-nbrcellinfo", "neighbors");
  markCapability(capabilities, results, "monitoring-traffic-statistics", "traffic");
  if (xmlText(signal, ["nrcqi0", "nrcqi", "cqi0", "cqi"]) !== null) capabilities.cqi = "observed";
  if (xmlText(signal, ["nrrank", "nrmimorank", "rank", "mimorank"]) !== null) capabilities.mimoRank = "observed";
  if (xmlText(signal, ["nrdlmcs", "nrulmcs", "nrumcs", "dl_mcs", "ul_mcs", "dlmcs", "ulmcs"]) !== null) capabilities.mcs = "observed";
  if (xmlText(signal, ["nrbler", "bler"]) !== null) capabilities.bler = "observed";
  if (xmlText(signal, ["nrtxpower", "txpower"]) !== null) capabilities.txPower = "observed";
  const radio = pcc ? { ...pcc } : emptyRadio();
  if (radio.role) delete radio.role;
  if (radio.technology) delete radio.technology;
  return {
    schemaVersion: 1,
    timestamp: now(),
    source: "live",
    device: {
      model: xmlText(basic, ["devicename", "DeviceName", "model", "modelname"]),
      firmware: xmlText(basic, ["softwareversion", "SoftwareVersion", "firmware", "Software_version"]),
      uptimeSeconds: xmlNumber(basic, ["uptime", "UpTime", "uptimeseconds"]),
    },
    connection: {
      cellularOnline: xmlBoolean(status, ["cellularonline", "connectionstatus", "cellularstatus"]),
      internetOnline: null,
      radioMode: radioModeFor(mode),
      saNsa: saNsaFor(mode),
      plmn: xmlText(signal, ["plmn"]) || xmlText(plmnDocument, ["plmn", "currentplmn", "current_plmn"]),
    },
    radio,
    cells: { pcc, scells, neighbors },
    network: {
      pingMs: null,
      jitterMs: null,
      packetLossPct: null,
      downloadBps: rateBps(traffic, ["CurrentDownloadRate", "downloadrate"]),
      uploadBps: rateBps(traffic, ["CurrentUploadRate", "uploadrate"]),
    },
    extended: {
      temperatureC: null,
      fanRpm: null,
      cpuUsagePct: null,
      memoryUsagePct: null,
      qci: null,
      fiveQi: null,
      dlAmbr: null,
      ulAmbr: null,
    },
    capabilities,
  };
}

function safeEndpointResult(result) {
  return {
    ...result,
    // Raw data must not leave the local Bridge unredacted, even though the
    // browser page itself is local-facing. Keep the unsanitized value only in
    // this request's Surge memory for normalization/error handling.
    rawXml: result.sanitizedRawXml,
    parsed: result.parsed ? { ...result.parsed, rawXml: result.sanitizedRawXml } : null,
  };
}

async function collectEndpoint(context, endpointDefinition) {
  const requestedAt = now();
  const started = Date.now();
  try {
    const response = endpointDefinition.requiresAuth
      ? await authenticatedGet(context, endpointDefinition.path)
      : await publicGet(context, endpointDefinition.path);
    return resultFor(endpointDefinition, response, requestedAt, started);
  } catch (error) {
    return transportResult(
      endpointDefinition,
      requestedAt,
      started,
      error instanceof Error ? error.message : "H168 request failed",
    );
  }
}

function unavailableEndpoint(endpointDefinition, message) {
  return transportResult(endpointDefinition, now(), Date.now(), message);
}

function gatewayAddress() {
  return $network?.v4?.primaryRouter || null;
}

function looksLikeH168(rawXml) {
  const model = [
    xmlText(rawXml, ["DeviceName"]),
    xmlText(rawXml, ["devicename"]),
    xmlText(rawXml, ["model"]),
    xmlText(rawXml, ["modelname"]),
  ].filter(Boolean).join(" ");
  return /H168-383|Ultra\s*6|Brovi/i.test(model);
}

function bridgeResponse(status, body) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  const origin = headerValue($request.headers || {}, "Origin");
  if (origin && ALLOWED_WEB_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Accept, Content-Type";
    headers.Vary = "Origin";
  }
  $done({
    response: {
      status,
      headers,
      body: JSON.stringify(body),
    },
  });
}

function endpointIdFromRequest() {
  const match = String($request.url).match(/\/api\/endpoint\/([a-z0-9-]+)$/i);
  return match?.[1] ?? null;
}

function endpointById(id) {
  return ENDPOINTS.find((item) => item.id === id) || null;
}

async function runEndpoint(endpointId) {
  const gateway = gatewayAddress();
  if (!gateway) {
    bridgeResponse(503, { error: "Surge 未发现 IPv4 默认网关，请先连接 H168 Wi-Fi。" });
    return;
  }

  const endpointDefinition = endpointById(endpointId);
  if (!endpointDefinition) {
    bridgeResponse(404, { error: "Unknown H168 endpoint", endpoint: endpointId });
    return;
  }

  const context = contextFromRequest();
  context.baseUrl = "http://" + gateway;
  const result = await collectEndpoint(context, endpointDefinition);
  if (context.rememberSession || context.rememberPassword) {
    saveStoredState(context);
  }

  // The identity gate is mandatory for the first request made by an endpoint
  // scheduler. It prevents the basic-information route from silently accepting
  // an unrelated default gateway. Other routes remain limited to this explicit
  // read-only allowlist and are expected to be called after that gate.
  if (endpointDefinition.id === "device-basic-information"
    && result.status === "ok"
    && !looksLikeH168(result.rawXml)) {
    bridgeResponse(422, {
      error: "默认网关返回的数据未确认是 H168-383。",
      gateway,
      endpoint: endpointDefinition.id,
      parsedFields: result.parsedFields,
      sanitizedRawXml: result.sanitizedRawXml,
    });
    return;
  }

  bridgeResponse(200, {
    schemaVersion: 1,
    gateway,
    endpointResult: safeEndpointResult(result),
  });
}

async function runProbe() {
  const gateway = gatewayAddress();
  if (!gateway) {
    bridgeResponse(503, { error: "Surge 未发现 IPv4 默认网关，请先连接 H168 Wi-Fi。" });
    return;
  }

  const context = contextFromRequest();
  context.baseUrl = "http://" + gateway;
  const results = [];
  const basicEndpoint = ENDPOINTS[0];
  const basicResult = await collectEndpoint(context, basicEndpoint);
  results.push(basicResult);
  if (basicResult.status !== "ok") {
    bridgeResponse(502, {
      error: "无法读取 H168 basic_information；请检查 Wi-Fi、Surge 接管和设备地址。",
      gateway,
      endpoint: basicResult.endpoint.id,
      status: basicResult.status,
      huaweiError: basicResult.huaweiError,
      sanitizedRawXml: basicResult.sanitizedRawXml,
    });
    return;
  }
  if (!looksLikeH168(basicResult.rawXml)) {
    bridgeResponse(422, {
      error: "默认网关返回的数据未确认是 H168-383；没有继续访问其他 endpoint。",
      gateway,
      endpoint: basicResult.endpoint.id,
      parsedFields: basicResult.parsedFields,
      sanitizedRawXml: basicResult.sanitizedRawXml,
    });
    return;
  }

  let authenticationError = null;
  const hasPrivateEndpoints = ENDPOINTS.some((item) => item.requiresAuth);
  if (hasPrivateEndpoints) {
    try {
      await login(context, false);
    } catch (error) {
      authenticationError = error instanceof Error ? error.message : "H168 login failed";
    }
  }

  for (const endpointDefinition of ENDPOINTS.slice(1)) {
    if (endpointDefinition.requiresAuth && authenticationError) {
      results.push(unavailableEndpoint(endpointDefinition, "登录未完成：" + authenticationError));
      continue;
    }
    results.push(await collectEndpoint(context, endpointDefinition));
  }

  if (context.rememberSession || context.rememberPassword) {
    saveStoredState(context);
  }
  const browserResults = results.map((result) => safeEndpointResult(result));
  if ($request.url.endsWith("/api/live")) {
    const snapshot = normalizeLiveSnapshot(results);
    bridgeResponse(200, {
      schemaVersion: 1,
      generatedAt: now(),
      adapterId: "h168",
      gateway,
      snapshot,
      history: [snapshot],
      events: [],
    });
    return;
  }
  bridgeResponse(200, {
    schemaVersion: 1,
    generatedAt: now(),
    adapterId: "h168",
    gateway,
    endpointResults: browserResults,
  });
}

const endpointId = endpointIdFromRequest();
const isProbeRoute = $request.url.endsWith("/api/probe") || $request.url.endsWith("/api/live");
const isEndpointRoute = endpointId !== null;

if ((isProbeRoute || isEndpointRoute)
  && String($request.method).toUpperCase() === "OPTIONS") {
  bridgeResponse(204, {});
} else if (isEndpointRoute) {
  runEndpoint(endpointId).catch((error) => {
    bridgeResponse(500, { error: error instanceof Error ? error.message : "Bridge endpoint failed" });
  });
} else if (isProbeRoute) {
  runProbe().catch((error) => {
    bridgeResponse(500, { error: error instanceof Error ? error.message : "Bridge failed" });
  });
} else {
  bridgeResponse(404, { error: "Unknown CPE Huahua Bridge path" });
}
