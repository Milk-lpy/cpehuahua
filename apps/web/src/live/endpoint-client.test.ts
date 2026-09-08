import { describe, expect, it, vi } from "vitest";
import type { EndpointProbeResult, ProbeEndpoint } from "@cpehuahua/core";
import { H168EndpointClient, endpointPath } from "./endpoint-client";

const endpoint: ProbeEndpoint = {
  id: "device-signal",
  label: "Signal",
  path: "/api/device/signal",
  intervalMs: 1_000,
  requiresAuth: true,
  defaultEnabled: true,
  evidence: "h168-reference-claimed",
};

const basicEndpoint: ProbeEndpoint = {
  id: "device-basic-information",
  label: "Basic",
  path: "/api/device/basic_information",
  intervalMs: null,
  requiresAuth: false,
  defaultEnabled: true,
  evidence: "h168-reference-claimed",
};

const monitoringEndpoint: ProbeEndpoint = {
  id: "monitoring-status",
  label: "Monitoring status",
  path: "/api/monitoring/status",
  intervalMs: 2_000,
  requiresAuth: true,
  defaultEnabled: true,
  evidence: "h168-live-observed",
};

function response(forEndpoint = endpoint): EndpointProbeResult {
  return {
    endpoint: forEndpoint,
    status: "ok",
    requestedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:00.010Z",
    latencyMs: 10,
    httpStatus: 200,
    huaweiError: null,
    transportError: null,
    rawXml: "<response />",
    sanitizedRawXml: "<response />",
    parsed: null,
    parsedFields: [],
  };
}

describe("H168EndpointClient", () => {
  it("builds a dedicated endpoint URL", () => {
    expect(endpointPath("https://bridge.example/api/probe", endpoint.id))
      .toBe("https://bridge.example/api/endpoint/device-signal");
  });

  it("sends the password once and reuses a remembered session", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({ schemaVersion: 1, gateway: "192.168.8.1", endpointResult: response() }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/probe", {
      getPassword: () => "secret",
      rememberSession: () => true,
      fetcher,
    });

    await client.read(basicEndpoint);
    await client.read(endpoint);
    await client.read(endpoint);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[1]?.method).toBe("POST");
    expect(requests[2]?.method).toBe("GET");
    expect(JSON.parse(String(requests[1]?.body)).password).toBe("secret");
    expect(JSON.parse(String(requests[1]?.body)).forceLogin).toBeUndefined();
    expect(requests[2]?.body).toBeUndefined();
    expect(client.gateway).toBe("192.168.8.1");
  });

  it("authenticates with the management password and forwards the remember choice", async () => {
    const requests: RequestInit[] = [];
    const results = [response(basicEndpoint), response(monitoringEndpoint)];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
        schemaVersion: 1,
        gateway: "192.168.8.1",
        endpointResult: results.shift() ?? response(monitoringEndpoint),
      }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/probe", {
      getPassword: () => "secret",
      rememberSession: () => true,
      rememberPassword: () => true,
      fetcher,
    });

    await client.authenticate();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[1]?.method).toBe("POST");
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      password: "secret",
      rememberSession: true,
      rememberPassword: true,
      forceLogin: true,
    });
  });

  it("can authenticate through a remembered Bridge session without a browser password", async () => {
    const requests: RequestInit[] = [];
    const results = [response(basicEndpoint), response(monitoringEndpoint)];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
        schemaVersion: 1,
        gateway: "192.168.8.1",
        endpointResult: results.shift() ?? response(monitoringEndpoint),
      }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/probe", {
      getPassword: () => "",
      rememberSession: () => true,
      rememberPassword: () => true,
      fetcher,
    });

    await client.authenticate();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("reports a rejected management password as an authentication error", async () => {
    const rejected = {
      ...response(monitoringEndpoint),
      status: "transport-error" as const,
      huaweiError: null,
      transportError: "authentication_login 失败 (100003)",
    };
    const results = [response(basicEndpoint), rejected];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({
      schemaVersion: 1,
      gateway: "192.168.8.1",
      endpointResult: results.shift() ?? rejected,
    }), { status: 200 }));
    const client = new H168EndpointClient("https://bridge.example/api/probe", {
      getPassword: () => "wrong",
      rememberSession: () => true,
      fetcher,
    });

    await expect(client.authenticate()).rejects.toThrow("管理密码错误");
  });

  it("does not store a password when remember session is disabled", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
      schemaVersion: 1,
      gateway: "192.168.8.1",
      endpointResult: response(basicEndpoint),
      }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/live", {
      getPassword: () => "secret",
      rememberSession: () => false,
      fetcher,
    });

    await client.read(basicEndpoint);
    await client.read(endpoint);
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      password: "secret",
      rememberSession: false,
      rememberPassword: false,
    });
  });

  it("re-authenticates once when a remembered session returns 125003", async () => {
    const requests: RequestInit[] = [];
    const expired = {
      ...response(),
      status: "huawei-error" as const,
      huaweiError: { code: 125003, rawCode: "125003", message: null },
    };
    const results = [response(basicEndpoint), response(), expired, response()];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      const endpointResult = results.shift() ?? response();
      return new Response(JSON.stringify({
        schemaVersion: 1,
        gateway: "192.168.8.1",
        endpointResult,
      }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/probe", {
      getPassword: () => "secret",
      rememberSession: () => true,
      fetcher,
    });

    await client.read(basicEndpoint);
    await client.read(endpoint);
    await client.read(endpoint);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(requests[2]?.method).toBe("GET");
    expect(requests[3]?.method).toBe("POST");
    expect(JSON.parse(String(requests[3]?.body)).password).toBe("secret");
  });

  it("re-authenticates once when a protected endpoint returns 100003", async () => {
    const requests: RequestInit[] = [];
    const expired = {
      ...response(),
      status: "huawei-error" as const,
      huaweiError: { code: 100003, rawCode: "100003", message: null },
    };
    const results = [response(basicEndpoint), response(), expired, response()];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      const endpointResult = results.shift() ?? response();
      return new Response(JSON.stringify({
        schemaVersion: 1,
        gateway: "192.168.8.1",
        endpointResult,
      }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/probe", {
      getPassword: () => "secret",
      rememberSession: () => true,
      fetcher,
    });

    await client.read(basicEndpoint);
    await client.read(endpoint);
    await client.read(endpoint);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(requests[2]?.method).toBe("GET");
    expect(requests[3]?.method).toBe("POST");
    expect(JSON.parse(String(requests[3]?.body)).password).toBe("secret");
  });

  it("cools down a persistently denied endpoint after one recovery attempt", async () => {
    const requests: RequestInit[] = [];
    const denied = {
      ...response(),
      status: "huawei-error" as const,
      huaweiError: { code: 100003, rawCode: "100003", message: null },
    };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      const endpointResult = requests.length <= 2 ? response(basicEndpoint) : denied;
      return new Response(JSON.stringify({
        schemaVersion: 1,
        gateway: "192.168.8.1",
        endpointResult,
      }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/probe", {
      getPassword: () => "secret",
      rememberSession: () => true,
      fetcher,
    });

    await client.read(basicEndpoint);
    await client.read(endpoint);
    await client.read(endpoint);
    await client.read(endpoint);

    // basic GET, initial auth POST, one failed-session GET + one recovery POST,
    // then a cooled-down GET without another password/login attempt.
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(requests[2]?.method).toBe("GET");
    expect(requests[3]?.method).toBe("POST");
    expect(requests[4]?.method).toBe("GET");
  });
});
