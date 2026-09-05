import { describe, expect, it, vi } from "vitest";
import { SurgeNetworkProbeClient } from "./network-client";

describe("SurgeNetworkProbeClient", () => {
  it("sends a configured HTTPS target to the local Bridge", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
        schemaVersion: 1,
        sample: {
          timestamp: "2026-09-05T00:00:00.000Z",
          success: true,
          latencyMs: 31,
        },
      }), { status: 200 });
    });
    const client = new SurgeNetworkProbeClient("https://bridge.example/api/probe", { fetcher });

    await expect(client.probe("https://status.example/health")).resolves.toEqual({
      timestamp: "2026-09-05T00:00:00.000Z",
      success: true,
      latencyMs: 31,
    });
    expect(requests[0]?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.body))).toEqual({ url: "https://status.example/health" });
  });

  it("rejects empty, non-HTTPS and credential-bearing targets", async () => {
    const client = new SurgeNetworkProbeClient("https://bridge.example/api/probe", {
      fetcher: vi.fn(),
    });
    await expect(client.probe(" ")).rejects.toThrow("未配置");
    await expect(client.probe("http://status.example/health")).rejects.toThrow("HTTPS");
    await expect(client.probe("https://user:pass@status.example/health")).rejects.toThrow("凭据");
  });
});
