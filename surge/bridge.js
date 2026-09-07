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
// Keep this list narrow: only the hosted PWA and local development origin may
// read Bridge responses. The Bridge host itself is configured separately in
// cpehuahua.sgmodule.
const ALLOWED_WEB_ORIGINS = new Set([
  "https://milk-lpy.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

// 100003 means "no rights" on Huawei firmware. For runtime data endpoints it
// can also be the firmware's response to a stale session. Retry authentication
// once for these paths only; developer/AT candidates intentionally remain
// explicit capability evidence and must not enter an auth loop.
const REAUTH_ON_NO_RIGHTS_PATHS = new Set([
  "/api/device/signal",
  "/api/monitoring/status",
  "/api/device/seccellinfo",
  "/api/device/nbrcellinfo",
  "/api/monitoring/traffic-statistics",
  "/api/device/information",
  "/api/net/cell-info",
]);

const ENDPOINTS = [
  endpoint("device-basic-information", "Device basic information", "/api/device/basic_information", false, null, "h168-reference-claimed"),
  endpoint("monitoring-status", "Monitoring status", "/api/monitoring/status", true, 2_000, "h168-live-observed"),
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
  endpoint("monitoring-month-statistics", "Monthly traffic statistics", "/api/monitoring/month_statistics", true, 60_000, "h168-live-observed"),
  endpoint("wlan-host-list", "Connected WLAN clients", "/api/wlan/host-list", true, 10_000, "h168-live-observed"),
  endpoint("monitoring-check-notifications", "Notifications / unread SMS count", "/api/monitoring/check-notifications", true, 10_000, "h168-live-observed"),
  endpoint("sms-count", "SMS mailbox counts", "/api/sms/sms-count", true, 10_000, "h168-live-observed"),
];

const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd", "imei", "imeisvn", "imsi", "msisdn", "phone",
  "phonenumber", "mobilenumber", "serial", "serialnumber", "sn", "iccid", "eid",
  "mac", "macaddress", "ipv6", "publicipv6",
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
  return SENSITIVE_KEYS.has(normalized)
    || normalized.includes("requestverificationtoken")
    || normalized.includes("imei")
    || normalized.includes("imsi")
    || normalized.includes("iccid")
    || normalized.includes("mac")
    || normalized.includes("ipv6")
    || normalized.includes("ipaddress")
    || normalized.includes("nonce")
    || normalized.includes("session")
    || normalized.includes("token");
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

function isSessionInvalid(response, parsed, path, passwordProvided) {
  return response.status === 401
    || parsed.error?.code === 125002
    || parsed.error?.code === 125003
    || (passwordProvided && parsed.error?.code === 100003 && REAUTH_ON_NO_RIGHTS_PATHS.has(path));
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

const SHA256_BLOCK_SIZE = 64;
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function concatenateBytes(first, second) {
  const result = new Uint8Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
}

// Surge WebView may expose crypto but not crypto.subtle.importKey. Keep the
// fallback dependency-free so the password never leaves the local script.
function sha256Bytes(data) {
  const bitLength = data.length * 8;
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  const highLength = Math.floor(bitLength / 0x100000000);
  const lowLength = bitLength >>> 0;
  padded[paddedLength - 8] = (highLength >>> 24) & 0xff;
  padded[paddedLength - 7] = (highLength >>> 16) & 0xff;
  padded[paddedLength - 6] = (highLength >>> 8) & 0xff;
  padded[paddedLength - 5] = highLength & 0xff;
  padded[paddedLength - 4] = (lowLength >>> 24) & 0xff;
  padded[paddedLength - 3] = (lowLength >>> 16) & 0xff;
  padded[paddedLength - 2] = (lowLength >>> 8) & 0xff;
  padded[paddedLength - 1] = lowLength & 0xff;

  const state = new Uint32Array(SHA256_INITIAL_STATE);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      schedule[index] = (
        (padded[position] << 24)
        | (padded[position + 1] << 16)
        | (padded[position + 2] << 8)
        | padded[position + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const lower = schedule[index - 15];
      const upper = schedule[index - 2];
      const lowerSigma = rotateRight(lower, 7) ^ rotateRight(lower, 18) ^ (lower >>> 3);
      const upperSigma = rotateRight(upper, 17) ^ rotateRight(upper, 19) ^ (upper >>> 10);
      schedule[index] = (schedule[index - 16] + lowerSigma + schedule[index - 7] + upperSigma) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let index = 0; index < 64; index += 1) {
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const upperSigma = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const lowerSigma = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const temporary1 = (h + upperSigma + choose + SHA256_ROUND_CONSTANTS[index] + schedule[index]) >>> 0;
      const temporary2 = (lowerSigma + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const result = new Uint8Array(32);
  for (let index = 0; index < state.length; index += 1) {
    const value = state[index];
    result[index * 4] = (value >>> 24) & 0xff;
    result[index * 4 + 1] = (value >>> 16) & 0xff;
    result[index * 4 + 2] = (value >>> 8) & 0xff;
    result[index * 4 + 3] = value & 0xff;
  }
  return result;
}

function hmacSha256Bytes(key, data) {
  const normalizedKey = key.length > SHA256_BLOCK_SIZE ? sha256Bytes(key) : key;
  const paddedKey = new Uint8Array(SHA256_BLOCK_SIZE);
  paddedKey.set(normalizedKey);
  const innerPad = new Uint8Array(SHA256_BLOCK_SIZE);
  const outerPad = new Uint8Array(SHA256_BLOCK_SIZE);
  for (let index = 0; index < SHA256_BLOCK_SIZE; index += 1) {
    innerPad[index] = paddedKey[index] ^ 0x36;
    outerPad[index] = paddedKey[index] ^ 0x5c;
  }
  return sha256Bytes(concatenateBytes(outerPad, sha256Bytes(concatenateBytes(innerPad, data))));
}

function pbkdf2Sha256Bytes(password, salt, iterations, outputLength = 32) {
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("PBKDF2 iterations must be a positive integer");
  }
  const blockCount = Math.ceil(outputLength / 32);
  const output = new Uint8Array(blockCount * 32);
  for (let block = 1; block <= blockCount; block += 1) {
    const blockInput = new Uint8Array(salt.length + 4);
    blockInput.set(salt);
    blockInput[salt.length] = (block >>> 24) & 0xff;
    blockInput[salt.length + 1] = (block >>> 16) & 0xff;
    blockInput[salt.length + 2] = (block >>> 8) & 0xff;
    blockInput[salt.length + 3] = block & 0xff;
    let intermediate = hmacSha256Bytes(password, blockInput);
    const accumulated = new Uint8Array(intermediate);
    for (let round = 1; round < iterations; round += 1) {
      intermediate = hmacSha256Bytes(password, intermediate);
      for (let index = 0; index < accumulated.length; index += 1) {
        accumulated[index] ^= intermediate[index];
      }
    }
    output.set(accumulated, (block - 1) * 32);
  }
  return output.slice(0, outputLength);
}

function hasSubtleCrypto() {
  if (typeof crypto === "undefined" || !crypto.subtle) return false;
  return typeof crypto.subtle.importKey === "function"
    && typeof crypto.subtle.sign === "function"
    && typeof crypto.subtle.digest === "function"
    && typeof crypto.subtle.deriveBits === "function";
}

async function hmac(keyBytes, dataBytes) {
  if (!hasSubtleCrypto()) return hmacSha256Bytes(keyBytes, dataBytes);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function clientProof(password, firstNonce, salt, iterations, serverNonce) {
  const passwordBytes = new TextEncoder().encode(password);
  const saltBytes = bytesFromSalt(salt);
  let saltedPassword;
  if (hasSubtleCrypto()) {
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    saltedPassword = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
      passwordKey,
      256,
    ));
  } else {
    saltedPassword = pbkdf2Sha256Bytes(passwordBytes, saltBytes, iterations);
  }
  // Match cpemanager's current Huawei implementation: literal first as key.
  const clientKey = await hmac(new TextEncoder().encode("Client Key"), saltedPassword);
  const storedKey = hasSubtleCrypto()
    ? new Uint8Array(await crypto.subtle.digest("SHA-256", clientKey))
    : sha256Bytes(clientKey);
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

function requestPayload() {
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
  return payload;
}

function contextFromRequest() {
  const stored = parseStoredState();
  const payload = requestPayload();
  const payloadPassword = typeof payload.password === "string" ? payload.password : "";
  const storedPassword = typeof stored.password === "string" ? stored.password : "";
  const rememberSession = typeof payload.rememberSession === "boolean"
    ? payload.rememberSession
    : stored.rememberSession === true;
  const rememberPassword = typeof payload.rememberPassword === "boolean"
    ? payload.rememberPassword
    : stored.rememberPassword === true;
  const cookies = rememberSession && stored.cookies && typeof stored.cookies === "object"
    ? { ...stored.cookies }
    : {};
  const csrfToken = rememberSession && typeof stored.csrfToken === "string"
    ? stored.csrfToken
    : null;
  return {
    baseUrl: null,
    cookies,
    csrfToken,
    password: payloadPassword || (rememberPassword ? storedPassword : ""),
    passwordProvided: payloadPassword.length > 0,
    username: typeof payload.username === "string" && payload.username ? payload.username : "admin",
    rememberSession,
    rememberPassword,
    // Endpoint routes are independent Surge requests. Reuse the persisted
    // session directly instead of replaying the login preflight for every
    // 1-second signal/traffic request. The endpoint itself remains the
    // authority; an explicit session error, or runtime-data 100003 response,
    // triggers at most one re-login.
    authenticated: Boolean(csrfToken && cookieHeader(cookies)),
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
  let reauthenticationAttempted = false;
  try {
    await login(context, false);
  } catch (error) {
    // A persisted cookie can be stale before the endpoint request is made.
    // If this request carries the password, clear that state and retry once.
    // Do not loop: a wrong password must become a visible endpoint error.
    if (!context.password) throw error;
    reauthenticationAttempted = true;
    await login(context, true);
  }
  let response;
  try {
    response = await contextRequest(context, "GET", path, authHeaders(context, context.csrfToken));
  } catch (error) {
    // Some H168 firmware versions close the socket instead of returning
    // 125003 when the persisted session is stale. If this request carries a
    // password, rebuild the session once and retry the endpoint.
    if (!context.password || reauthenticationAttempted) throw error;
    reauthenticationAttempted = true;
    await login(context, true);
    response = await contextRequest(context, "GET", path, authHeaders(context, context.csrfToken));
  }
  const parsed = parseXml(response.body);
  if (isSessionInvalid(response, parsed, path, context.passwordProvided) && !reauthenticationAttempted) {
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

function rawRadioFields(rawXml, nr) {
  const fields = {
    dlMcs: xmlText(rawXml, nr ? ["nrdlmcs"] : ["dl_mcs", "dlmcs"]),
    ulMcs: xmlText(rawXml, nr ? ["nrulmcs"] : ["ul_mcs", "ulmcs"]),
    txPower: xmlText(rawXml, nr ? ["nrtxpower"] : ["txpower"]),
  };
  return Object.values(fields).some((value) => value !== null) ? fields : null;
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
    bandwidth: null,
    rrcStatus: null,
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
  const rawEvidence = rawRadioFields(rawXml, nr);
  return {
    rsrpDbm: xmlNumber(rawXml, [nr ? "nrrsrp" : "rsrp"]),
    rsrqDb: xmlNumber(rawXml, [nr ? "nrrsrq" : "rsrq"]),
    sinrDb: xmlNumber(rawXml, [nr ? "nrsinr" : "sinr"]),
    rssiDbm: xmlNumber(rawXml, [nr ? "nrrssi" : "rssi"]),
    pci: xmlNumber(rawXml, pciNames),
    cellId: xmlText(rawXml, cellIdNames),
    tac: xmlText(rawXml, nr
      ? genericNrKeys ? ["nrtac", "tac"] : ["nrtac"]
      : ["tac"]),
    band: xmlText(rawXml, bandNames),
    arfcn: xmlNumber(rawXml, arfcnNames),
    bandwidth: xmlText(rawXml, nr ? ["nrdlbandwidth", "dlbandwidth"] : ["dlbandwidth"]),
    rrcStatus: xmlText(rawXml, ["rrc_status"]),
    cqi: xmlNumber(rawXml, [nr ? "nrcqi0" : "cqi0", nr ? "nrcqi" : "cqi"]),
    mimoRank: xmlNumber(rawXml, [nr ? "nrrank" : "rank", nr ? "nrmimorank" : "mimorank"]),
    dlMcs: xmlNumber(rawXml, [nr ? "nrdlmcs" : "dl_mcs", nr ? "nrdlmcs" : "dlmcs"]),
    ulMcs: xmlNumber(rawXml, [nr ? "nrulmcs" : "ul_mcs", nr ? "nrumcs" : "ulmcs"]),
    blerPct: xmlNumber(rawXml, [nr ? "nrbler" : "bler"]),
    txPowerDbm: xmlNumber(rawXml, [nr ? "nrtxpower" : "txpower"]),
    ...(rawEvidence === null ? {} : { rawEvidence }),
  };
}

function hasCellData(cell) {
  return Object.values(cell).some((value) => value !== null);
}

function hasExplicitLteSignalData(rawXml) {
  return [
    "earfcn",
    "rsrp",
    "rsrq",
    "sinr",
    "rssi",
    "ulbandwidth",
    "dlbandwidth",
    "ul_mcs",
    "dl_mcs",
  ].some((name) => xmlText(rawXml, [name]) !== null);
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
        bandwidth: hasBandwidth ? (parts[2] || null) : null,
        rrcStatus: null,
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
    monthlyTraffic: "unknown",
    clients: "unknown",
    sms: "unknown",
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

function connectedClients(rawXml) {
  if (!rawXml) return [];
  return [...String(rawXml).matchAll(/<\s*Host(?:\s[^>]*)?>([\s\S]*?)<\s*\/\s*Host\s*>/gi)].map((match, index) => {
    const host = match[1] || "";
    return {
      id: xmlText(host, ["ID"]) || `host-${index + 1}`,
      name: xmlText(host, ["ActualName", "HostName"]),
      hostName: xmlText(host, ["HostName"]),
      manufacturer: xmlText(host, ["IdentifyBrands", "ActualManu"]),
      deviceType: xmlText(host, ["IdentifyType", "ActualType"]),
      frequency: xmlText(host, ["Frequency"]),
      ssid: xmlText(host, ["AssociatedSsid"]),
      associatedSeconds: xmlNumber(host, ["AssociatedTime"]),
      ipAddress: null,
      macAddress: null,
    };
  });
}

function normalizeLiveSnapshot(results) {
  const signal = rawResult(results, "device-signal");
  const basic = rawResult(results, "device-basic-information");
  const deviceInfo = rawResult(results, "device-information");
  const plmnDocument = rawResult(results, "net-current-plmn");
  const secondary = rawResult(results, "device-seccellinfo");
  const neighborsDocument = rawResult(results, "device-nbrcellinfo");
  const status = rawResult(results, "monitoring-status");
  const traffic = rawResult(results, "monitoring-traffic-statistics");
  const monthTraffic = rawResult(results, "monitoring-month-statistics");
  const hosts = rawResult(results, "wlan-host-list");
  const notifications = rawResult(results, "monitoring-check-notifications");
  const smsCount = rawResult(results, "sms-count");
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
  if (isSa && hasCellData(lte) && hasExplicitLteSignalData(signal)) {
    signalScells.push(makeCell("scell", "LTE", lte));
  }
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
  markCapability(capabilities, results, "monitoring-month-statistics", "monthlyTraffic");
  markCapability(capabilities, results, "wlan-host-list", "clients");
  markCapability(capabilities, results, "sms-count", "sms");
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
      model: xmlText(basic, ["devicename", "DeviceName", "model", "modelname"])
        || xmlText(deviceInfo, ["devicename", "DeviceName", "model", "modelname"]),
      productName: xmlText(basic, ["spreadname_zh", "spreadname_en"])
        || xmlText(deviceInfo, ["spreadname_zh", "spreadname_en"]),
      hardwareVersion: xmlText(deviceInfo, ["HardwareVersion"]),
      firmware: xmlText(basic, ["softwareversion", "SoftwareVersion", "firmware", "Software_version"])
        || xmlText(deviceInfo, ["softwareversion", "SoftwareVersion", "firmware", "Software_version"]),
      webUiVersion: xmlText(deviceInfo, ["WebUIVersion"]),
      parameterVersion: xmlText(deviceInfo, ["ParameterVersion"]),
      uptimeSeconds: xmlNumber(basic, ["uptime", "UpTime", "uptimeseconds"])
        ?? xmlNumber(deviceInfo, ["uptime", "UpTime", "uptimeseconds"]),
    },
    connection: {
      cellularOnline: xmlText(status, ["ConnectionStatus", "connectionstatus"]) === "901"
        ? true
        : xmlBoolean(status, ["cellularonline", "connectionstatus", "cellularstatus"]),
      internetOnline: null,
      radioMode: radioModeFor(mode),
      saNsa: saNsaFor(mode),
      plmn: xmlText(signal, ["plmn"]) || xmlText(plmnDocument, ["Numeric", "plmn", "currentplmn", "current_plmn"]),
      operatorName: xmlText(plmnDocument, ["FullName", "ShortName", "Spn"]),
      cellularStatusCode: xmlText(status, ["ConnectionStatus", "connectionstatus"]),
    },
    radio,
    cells: { pcc, scells, neighbors },
    network: {
      pingMs: null,
      jitterMs: null,
      packetLossPct: null,
      downloadBps: rateBps(traffic, ["CurrentDownloadRate", "downloadrate"]),
      uploadBps: rateBps(traffic, ["CurrentUploadRate", "uploadrate"]),
      currentDownloadBytes: xmlNumber(traffic, ["CurrentDownload"]),
      currentUploadBytes: xmlNumber(traffic, ["CurrentUpload"]),
      totalDownloadBytes: xmlNumber(traffic, ["TotalDownload"]),
      totalUploadBytes: xmlNumber(traffic, ["TotalUpload"]),
      currentConnectSeconds: xmlNumber(traffic, ["CurrentConnectTime"]),
      totalConnectSeconds: xmlNumber(traffic, ["TotalConnectTime"]),
      monthDownloadBytes: xmlNumber(monthTraffic, ["CurrentMonthDownload"]),
      monthUploadBytes: xmlNumber(monthTraffic, ["CurrentMonthUpload"]),
      monthDurationSeconds: xmlNumber(monthTraffic, ["MonthDuration"]),
      monthLastClearDate: xmlText(monthTraffic, ["MonthLastClearTime"]),
      dayUsedBytes: xmlNumber(monthTraffic, ["CurrentDayUsed"]),
      dayDurationSeconds: xmlNumber(monthTraffic, ["CurrentDayDuration"]),
    },
    clients: connectedClients(hosts),
    messaging: {
      unread: xmlNumber(smsCount, ["LocalUnread"]) ?? xmlNumber(notifications, ["UnreadMessage"]),
      inbox: xmlNumber(smsCount, ["LocalInbox"]),
      outbox: xmlNumber(smsCount, ["LocalOutbox"]),
      draft: xmlNumber(smsCount, ["LocalDraft"]),
      deleted: xmlNumber(smsCount, ["LocalDeleted"]),
      capacity: xmlNumber(smsCount, ["LocalMax"]),
      simUnread: xmlNumber(smsCount, ["SimUnread"]),
      simInbox: xmlNumber(smsCount, ["SimInbox"]),
      simUsed: xmlNumber(smsCount, ["SimUsed"]),
      simCapacity: xmlNumber(smsCount, ["SimMax"]),
      newMessages: xmlNumber(smsCount, ["NewMsg"]),
      storageFull: xmlText(notifications, ["SmsStorageFull"]) === null
        ? null
        : xmlText(notifications, ["SmsStorageFull"]) === "1",
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

function networkProbeTarget() {
  const payload = requestPayload();
  const value = typeof payload.url === "string" ? payload.url.trim() : "";
  if (!value) throw new Error("未提供 Internet 用户路径探测地址");
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("Internet 探测地址必须是有效 HTTPS URL");
  }
  if (target.protocol !== "https:" || target.username || target.password) {
    throw new Error("Internet 探测地址只允许不带凭据的 HTTPS URL");
  }
  return target.toString();
}

function requestNetworkTarget(target) {
  return new Promise((resolve) => {
    if (typeof $httpClient?.get !== "function") {
      resolve({ status: 0, error: "Surge $httpClient.get unavailable" });
      return;
    }
    $httpClient.get({
      url: target,
      headers: {
        Accept: "*/*",
        "Cache-Control": "no-cache",
      },
      timeout: 3,
      "auto-cookie": false,
    }, (error, response) => {
      resolve({
        status: typeof response?.status === "number" ? response.status : 0,
        error: error ? String(error) : null,
      });
    });
  });
}

async function runNetworkProbe() {
  let target;
  try {
    target = networkProbeTarget();
  } catch (error) {
    bridgeResponse(400, { error: error instanceof Error ? error.message : "Invalid probe target" });
    return;
  }
  const started = Date.now();
  const result = await requestNetworkTarget(target);
  const success = result.error === null && result.status >= 200 && result.status < 400;
  bridgeResponse(200, {
    schemaVersion: 1,
    sample: {
      timestamp: now(),
      success,
      latencyMs: success ? Date.now() - started : null,
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
const isNetworkProbeRoute = $request.url.endsWith("/api/network-probe");

if ((isProbeRoute || isEndpointRoute || isNetworkProbeRoute)
  && String($request.method).toUpperCase() === "OPTIONS") {
  bridgeResponse(204, {});
} else if (isEndpointRoute) {
  runEndpoint(endpointId).catch((error) => {
    bridgeResponse(500, { error: error instanceof Error ? error.message : "Bridge endpoint failed" });
  });
} else if (isNetworkProbeRoute) {
  runNetworkProbe().catch((error) => {
    bridgeResponse(500, { error: error instanceof Error ? error.message : "Network probe failed" });
  });
} else if (isProbeRoute) {
  runProbe().catch((error) => {
    bridgeResponse(500, { error: error instanceof Error ? error.message : "Bridge failed" });
  });
} else {
  bridgeResponse(404, { error: "Unknown CPE Huahua Bridge path" });
}
