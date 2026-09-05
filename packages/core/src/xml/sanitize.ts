import type { HuaweiXmlObject, HuaweiXmlValue } from "../types/xml";
import type { HttpHeaders } from "../types/http";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "imei",
  "imsi",
  "msisdn",
  "phone",
  "phonenumber",
  "mobilenumber",
  "mac",
  "macaddress",
  "ipv6",
  "publicipv6",
  "sessionid",
  "sesinfo",
  "tokinfo",
  "token",
  "csrf",
  "csrftoken",
  "requestverificationtoken",
  "firstnonce",
  "servernonce",
  "salt",
  "clientproof",
  "finalnonce",
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || normalized.includes("requestverificationtoken");
}

function sanitizeValue(value: HuaweiXmlValue, key: string): HuaweiXmlValue {
  if (isSensitiveKey(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key));
  }
  if (typeof value === "string") {
    return value;
  }
  const result: HuaweiXmlObject = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeValue(childValue, childKey);
  }
  return result;
}

/** Redact sensitive XML tag bodies while preserving the rest of the raw response. */
export function sanitizeHuaweiXml(rawXml: string): string {
  const tokens = rawXml.match(/<[^>]+>|[^<]+/g) ?? [];
  const output: string[] = [];
  const openTags: string[] = [];
  let sensitiveDepth = 0;
  let redactionWritten = false;

  for (const token of tokens) {
    const closing = token.match(/^<\/\s*([\w:.-]+)\s*>$/);
    if (closing) {
      const tag = closing[1] ?? "";
      const openIndex = openTags.lastIndexOf(tag);
      if (openIndex >= 0) {
        const [openedTag] = openTags.splice(openIndex, 1);
        if (openedTag !== undefined && isSensitiveKey(openedTag)) {
          sensitiveDepth -= 1;
        }
      }
      output.push(token);
      if (sensitiveDepth === 0) {
        redactionWritten = false;
      }
      continue;
    }
    const opening = token.match(/^<\s*([\w:.-]+)(?:\s[^>]*)?>$/);
    if (opening) {
      const tag = opening[1] ?? "";
      const selfClosing = /\/\s*>$/.test(token);
      if (!selfClosing) {
        openTags.push(tag);
        if (isSensitiveKey(tag)) {
          sensitiveDepth += 1;
        }
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

export function sanitizeHuaweiValue(value: HuaweiXmlValue): HuaweiXmlValue {
  return sanitizeValue(value, "");
}

export function sanitizeHeaders(headers: HttpHeaders): HttpHeaders {
  const result: HttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (normalized === "cookie" || normalized === "setcookie" || isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }
  return result;
}
