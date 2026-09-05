import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findHuaweiField,
  parseHuaweiXml,
  sanitizeHuaweiXml,
  textOfHuaweiField,
} from "../index";

function fixture(name: string): string {
  return readFileSync(new URL(`../../../../fixtures/h168/${name}`, import.meta.url), "utf8");
}

describe("Huawei XML parser", () => {
  it("preserves unknown fields and exposes field paths", () => {
    const parsed = parseHuaweiXml(fixture("signal.xml"));

    expect(parsed.parseError).toBeNull();
    expect(parsed.rootName).toBe("response");
    expect(textOfHuaweiField(parsed, ["future_unknown_key"])).toBe("preserve-me");
    expect(parsed.fields).toContain("response.future_unknown_key");
    expect(findHuaweiField(parsed, ["nrrsrp"])).toBe("-95dBm");
  });

  it("does not turn missing or empty input into zero", () => {
    const empty = parseHuaweiXml("");
    const missing = parseHuaweiXml("<response><rsrp></rsrp></response>");

    expect(empty.parseError).toBe("XML response is empty");
    expect(textOfHuaweiField(missing, ["rsrp"])).toBeNull();
    expect(findHuaweiField(missing, ["not-present"])).toBeUndefined();
  });

  it("extracts Huawei error codes without throwing", () => {
    const parsed = parseHuaweiXml(fixture("error-125003.xml"));

    expect(parsed.error).toEqual({
      code: 125003,
      rawCode: "125003",
      message: "fixture session token error",
    });
  });

  it("reports malformed XML as a parse error", () => {
    const parsed = parseHuaweiXml("<response><rsrp>");

    expect(parsed.parseError).toBeTypeOf("string");
    expect(parsed.response).toEqual({});
  });

  it("redacts sensitive XML tags while keeping non-sensitive raw content", () => {
    const raw = "<response><IMEI>123456789012345</IMEI><rsrp>-91dBm</rsrp><future>x</future></response>";
    const sanitized = sanitizeHuaweiXml(raw);

    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("123456789012345");
    expect(sanitized).toContain("-91dBm");
    expect(sanitized).toContain("<future>x</future>");
  });

  it("does not leak a sensitive value inside nested XML", () => {
    const sanitized = sanitizeHuaweiXml(
      "<response><sessionId><value>secret-session</value></sessionId><rsrp>-91dBm</rsrp></response>",
    );

    expect(sanitized).not.toContain("secret-session");
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).toContain("-91dBm");
  });
});
