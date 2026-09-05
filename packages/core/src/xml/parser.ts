import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  HuaweiError,
  HuaweiXmlObject,
  HuaweiXmlValue,
  ParsedHuaweiXml,
} from "../types/xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toHuaweiValue(value: unknown): HuaweiXmlValue {
  if (Array.isArray(value)) {
    return value.map((item) => toHuaweiValue(item));
  }
  if (isRecord(value)) {
    const result: HuaweiXmlObject = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = toHuaweiValue(child);
    }
    return result;
  }
  return value === null || value === undefined ? "" : String(value);
}

function asObject(value: HuaweiXmlValue): HuaweiXmlObject {
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return { "#text": value };
}

function textOf(value: HuaweiXmlValue | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const result = value.trim();
    return result ? result : null;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? textOf(value[0]) : null;
  }
  const text = value["#text"];
  if (text !== undefined) {
    return textOf(text);
  }
  return null;
}

function findDirectKey(object: HuaweiXmlObject, name: string): HuaweiXmlValue | undefined {
  const wanted = name.toLowerCase();
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === wanted);
  return key === undefined ? undefined : object[key];
}

function findValue(value: HuaweiXmlValue, names: ReadonlySet<string>): HuaweiXmlValue | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, names);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value === "string") {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (names.has(key.toLowerCase())) {
      return child;
    }
  }
  for (const child of Object.values(value)) {
    const found = findValue(child, names);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function collectFields(value: HuaweiXmlValue, prefix: string, output: Set<string>): void {
  if (typeof value === "string") {
    if (prefix) {
      output.add(prefix);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFields(item, prefix, output);
    }
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0 && prefix) {
    output.add(prefix);
    return;
  }
  for (const [key, child] of entries) {
    if (key === "#text") {
      if (prefix) {
        output.add(prefix);
      }
      continue;
    }
    collectFields(child, prefix ? `${prefix}.${key}` : key, output);
  }
}

function readError(data: HuaweiXmlObject | null, rootName: string | null): HuaweiError | null {
  if (!data) {
    return null;
  }
  const root = rootName?.toLowerCase() === "error"
    ? findDirectKey(data, "error") ?? data
    : findValue(data, new Set(["error"]));
  if (root === undefined) {
    return null;
  }
  const errorObject = typeof root === "object" && !Array.isArray(root) ? root : { "#text": root };
  const rawCode = textOf(findDirectKey(errorObject, "code"));
  const message = textOf(findDirectKey(errorObject, "message"));
  const parsedCode = rawCode === null ? null : Number.parseInt(rawCode, 10);
  return {
    code: Number.isNaN(parsedCode) ? null : parsedCode,
    rawCode,
    message,
  };
}

/** Parse Huawei XML without discarding raw text, unknown keys, or Huawei errors. */
export function parseHuaweiXml(rawXml: string): ParsedHuaweiXml {
  const base: ParsedHuaweiXml = {
    rawXml,
    rootName: null,
    data: null,
    response: {},
    fields: [],
    error: null,
    parseError: null,
  };

  if (!rawXml.trim()) {
    return { ...base, parseError: "XML response is empty" };
  }

  try {
    const validation = XMLValidator.validate(rawXml);
    if (validation !== true) {
      throw new Error("Invalid XML response");
    }
    const parsed = parser.parse(rawXml) as unknown;
    if (!isRecord(parsed)) {
      return { ...base, parseError: "XML root is not an object" };
    }
    const rootName = Object.keys(parsed).find((key) => !key.startsWith("?"));
    if (!rootName) {
      return { ...base, parseError: "XML root is missing" };
    }
    const converted = toHuaweiValue(parsed) as HuaweiXmlObject;
    const rootValue = converted[rootName];
    if (rootValue === undefined) {
      return { ...base, rootName, data: converted, parseError: "XML root value is missing" };
    }
    const rootObject = asObject(rootValue);
    const responseCandidate = findDirectKey(rootObject, "response");
    const response = rootName.toLowerCase() === "response"
      ? rootObject
      : responseCandidate === undefined
        ? rootObject
        : asObject(responseCandidate);
    const fieldSet = new Set<string>();
    collectFields(response, "response", fieldSet);
    return {
      ...base,
      rootName,
      data: converted,
      response,
      fields: [...fieldSet].sort(),
      error: readError(converted, rootName),
    };
  } catch (error) {
    return {
      ...base,
      parseError: error instanceof Error ? error.message : "Invalid XML response",
    };
  }
}

/** Return the first matching field from the parsed response, case-insensitively. */
export function findHuaweiField(
  document: ParsedHuaweiXml | null,
  names: readonly string[],
): HuaweiXmlValue | undefined {
  if (!document) {
    return undefined;
  }
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return findValue(document.response, wanted);
}

export function textOfHuaweiField(
  document: ParsedHuaweiXml | null,
  names: readonly string[],
): string | null {
  return textOf(findHuaweiField(document, names));
}

export function numberOfHuaweiField(
  document: ParsedHuaweiXml | null,
  names: readonly string[],
): number | null {
  const text = textOfHuaweiField(document, names);
  if (text === null) {
    return null;
  }
  const match = text.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}
