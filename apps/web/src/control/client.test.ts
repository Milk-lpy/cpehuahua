import { describe, expect, it, vi } from "vitest";
import { H168ControlClient } from "./client";

describe("H168ControlClient", () => {
  it("uses the strict control route and does not persist a password", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({
        schemaVersion: 1, gateway: "192.168.8.1", action: "network.get", status: "ok", httpStatus: 200, huaweiError: null, data: {},
      }), { status: 200 });
    });
    const client = new H168ControlClient("https://bridge.example/api/probe", {
      getPassword: () => "secret", rememberSession: () => true, fetcher,
    });
    await client.execute("network.get");
    expect(requests[0]?.input).toBe("https://bridge.example/api/control");
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({ action: "network.get", password: "secret", rememberSession: true, rememberPassword: false });
  });
});
