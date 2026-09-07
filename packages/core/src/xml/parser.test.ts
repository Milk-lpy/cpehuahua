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

  it("honors requested alias priority instead of XML document order", () => {
    const parsed = parseHuaweiXml(
      "<response><band>40MHz@428910(N1)</band><bandInfo>N1</bandInfo>"
        + "<cqi0></cqi0><nrcqi0>8</nrcqi0></response>",
    );

    expect(textOfHuaweiField(parsed, ["bandInfo", "band"])).toBe("N1");
    expect(textOfHuaweiField(parsed, ["nrcqi0", "cqi0"])).toBe("8");
    expect(textOfHuaweiField(parsed, ["cqi0", "nrcqi0"])).toBe("8");
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

  it("redacts device identifiers and address-shaped fields observed in H168 diagnostics", () => {
    const sanitized = sanitizeHuaweiXml(
      "<response>"
        + "<SerialNumber>secret-serial</SerialNumber>"
        + "<Iccid>secret-iccid</Iccid>"
        + "<MacAddress1>AA:BB:CC:DD:EE:FF</MacAddress1>"
        + "<WanIPAddress>10.0.0.1</WanIPAddress>"
        + "<WanIPv6Address>2001:db8::1</WanIPv6Address>"
        + "<WifiMacAddrWl0>AA:BB:CC:DD:EE:00</WifiMacAddrWl0>"
        + "<cell_id>0000000761BC1005</cell_id><tac>760101</tac>"
        + "<rsrp>-70dBm</rsrp>"
        + "</response>",
    );

    expect(sanitized).not.toContain("secret-serial");
    expect(sanitized).not.toContain("secret-iccid");
    expect(sanitized).not.toContain("AA:BB:CC:DD:EE:FF");
    expect(sanitized).not.toContain("10.0.0.1");
    expect(sanitized).not.toContain("2001:db8::1");
    expect(sanitized).not.toContain("0000000761BC1005");
    expect(sanitized).not.toContain("760101");
    expect(sanitized).toContain("<rsrp>-70dBm</rsrp>");
  });

  it("keeps MAC filter state while redacting actual filter addresses", () => {
    const sanitized = sanitizeHuaweiXml(
      "<response><wifimacfilterstatus>2</wifimacfilterstatus><enable>1</enable>"
        + "<wifimacblacklist><WifiMacFilterMac0>AA:BB:CC:DD:EE:FF</WifiMacFilterMac0>"
        + "<wifihostname0>tablet</wifihostname0></wifimacblacklist></response>",
    );

    expect(sanitized).toContain("<wifimacfilterstatus>2</wifimacfilterstatus>");
    expect(sanitized).toContain("<wifimacblacklist>");
    expect(sanitized).toContain("<wifihostname0>tablet</wifihostname0>");
    expect(sanitized).not.toContain("AA:BB:CC:DD:EE:FF");
  });
});
