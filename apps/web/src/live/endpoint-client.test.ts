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

function response(status = 200): EndpointProbeResult {
  return {
    endpoint,
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

    await client.read(endpoint);
    await client.read(endpoint);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[1]?.method).toBe("GET");
    expect(JSON.parse(String(requests[0]?.body)).password).toBe("secret");
    expect(requests[1]?.body).toBeUndefined();
    expect(client.gateway).toBe("192.168.8.1");
  });

  it("does not store a password when remember session is disabled", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
      schemaVersion: 1,
      gateway: "192.168.8.1",
      endpointResult: response(),
      }), { status: 200 });
    });
    const client = new H168EndpointClient("https://bridge.example/api/live", {
      getPassword: () => "secret",
      rememberSession: () => false,
      fetcher,
    });

    await client.read(endpoint);
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      password: "secret",
      rememberSession: false,
      rememberPassword: false,
    });
  });
});
