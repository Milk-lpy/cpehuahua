import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseHuaweiXml } from "../xml/parser";

const bridge = readFileSync(new URL("../../../../surge/bridge.js", import.meta.url), "utf8");
const functions = bridge.slice(0, bridge.indexOf("const endpointId = endpointIdFromRequest();"));

describe("Surge local-device routing", () => {
  it("identifies an older saved session before polling without requiring the password again", async () => {
    const storage = JSON.stringify({ gateway: "192.168.8.1", cookies: { SessionID: "fixture" }, csrfToken: "fixture-token", rememberSession: true });
    const paths: string[] = [];
    const response = await runInNewContext(functions + `
      parseXml = testParse;
      const next = contextFromRequest(); bindReadTarget(next, '192.168.8.1');
      authenticatedGet(next, '/api/device/signal');
    `, {
      testParse: parseHuaweiXml, $request: { method: "GET", headers: {} },
      $persistentStore: { read: () => storage },
      $httpClient: { get: (options: { url: string; headers: Record<string, string> }, callback: (error: null, response: object, body: string) => void) => {
        const path = new URL(options.url).pathname; paths.push(path);
        if (path === "/api/device/basic_information") callback(null, { status: 200, headers: {} }, "<response><devicename>E6888-982</devicename></response>");
        else {
          expect(options.headers["X-Requested-With"]).toBe("XMLHttpRequest");
          expect(options.headers.Cookie).toBe("SessionID=fixture");
          callback(null, { status: 200, headers: {} }, "<response><nrrsrp>-104dBm</nrrsrp></response>");
        }
      } }, TextDecoder, Uint8Array,
    });
    expect(parseHuaweiXml(response.body).error).toBeNull();
    expect(paths).toEqual(["/api/device/basic_information", "/api/device/signal"]);
  });
  it("keeps the E6888 request profile across separate polling requests", async () => {
    const storage: Record<string, string> = {};
    const response = await runInNewContext(functions + `
      parseXml = testParse;
      saveStoredState({ baseUrl: 'http://192.168.8.1', adapterId: 'e6888', authenticated: true,
        rememberSession: true, rememberPassword: false, cookies: { SessionID: 'fixture' }, csrfToken: 'fixture-token' });
      const next = contextFromRequest();
      bindReadTarget(next, '192.168.8.1');
      authenticatedGet(next, '/api/device/signal');
    `, {
      testParse: parseHuaweiXml,
      $request: { method: "GET", headers: {} },
      $persistentStore: { read: (k: string) => storage[k] ?? null, write: (v: string, k: string) => (storage[k] = v, true) },
      $httpClient: { get: (options: { headers: Record<string, string> }, callback: (error: null, response: object, body: string) => void) => {
        const browser = options.headers["X-Requested-With"] === "XMLHttpRequest" && options.headers._ResponseSource === "Broswer";
        callback(null, { status: 200, headers: {} }, browser ? "<response><nrrsrp>-104dBm</nrrsrp></response>" : "<error><code>100003</code></error>");
      } }, TextDecoder, Uint8Array,
    });
    expect(parseHuaweiXml(response.body).error).toBeNull();
  });
  it("does not carry cookies or tokens from the default gateway to the discovered device", () => {
    const context = { sessionGateway: "192.168.9.1", cookies: { SessionID: "fixture-session" }, csrfToken: "fixture-token", authenticated: true };
    runInNewContext(functions + `\nbindReadTarget(context, '192.168.8.1')`, { context });
    expect(context.cookies).toEqual({});
    expect(context.csrfToken).toBeNull();
    expect(context.authenticated).toBe(false);
  });
  it("ignores the remembered management address after the phone changes networks", () => {
    const target = runInNewContext(functions + `\nrememberedReadTarget()`, {
      $network: { v4: { primaryRouter: "192.168.10.1" } },
      $persistentStore: { read: () => JSON.stringify({ networkGateway: "192.168.9.1", gateway: "192.168.8.1" }) },
    });
    expect(target).toBeNull();
  });
  it("finds E6888 at 192.168.8.1 when the phone gateway 192.168.9.1 returns 404", async () => {
    const requests: { url: string; headers: Record<string, string> }[] = [];
    const storage: Record<string, string> = {};
    const result = await new Promise<{ response: { status: number; body: string } }>((resolve, reject) => {
      const run = runInNewContext(functions + `\nparseXml = testParse; runEndpoint('device-basic-information')`, {
        testParse: parseHuaweiXml,
        $request: { method: "GET", headers: {}, url: "https://cpe-bridge.example.com/api/endpoint/device-basic-information" },
        $network: { v4: { primaryRouter: "192.168.9.1" } },
        $persistentStore: { read: (k: string) => storage[k] ?? null, write: (v: string, k: string) => (storage[k] = v, true) },
        $done: resolve,
        $httpClient: { get: (options: { url: string; headers: Record<string, string> }, callback: (error: null, response: object, body: string) => void) => {
          requests.push(options);
          callback(null, { status: options.url.includes("192.168.9.1") ? 404 : 200, headers: {} },
            options.url.includes("192.168.9.1") ? "<html>Not found</html>" : "<response><devicename>E6888-982</devicename></response>");
        } }, TextDecoder, Uint8Array,
      });
      run.catch(reject);
    });
    const payload = JSON.parse(result.response.body);
    expect(payload.gateway).toBe("192.168.8.1");
    expect(payload.endpointResult.status).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(requests.every(r => !r.headers.Cookie && !r.headers.__RequestVerificationToken)).toBe(true);
  });
  it("reads basic information directly even when normal requests use a failing SOCKS proxy", async () => {
    const xml = "<response><devicename>E6888-982</devicename></response>";
    const result = runInNewContext(functions + `\ndeviceRequest('http://192.168.8.1', {}, 'GET', '/api/device/basic_information', {}, null)`, {
      $httpClient: { get: (options: { policy?: string }, callback: (error: string | null, response?: object, body?: string) => void) => {
        if (options.policy !== "DIRECT") callback("SOCKS proxy server returned an invalid response");
        else callback(null, { status: 200, headers: {} }, xml);
      } }, TextDecoder, Uint8Array,
    });
    await expect(result).resolves.toMatchObject({ status: 200, body: xml });
  });
});
