import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const bridge = readFileSync(new URL("../../../../surge/bridge.js", import.meta.url), "utf8");
const functions = bridge.slice(0, bridge.indexOf("const endpointId = endpointIdFromRequest();"));

describe("Surge local-device routing", () => {
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
