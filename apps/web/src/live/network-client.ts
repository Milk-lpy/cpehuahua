import type { NetworkProbeSample } from "@cpehuahua/core";
import { bridgePath } from "./endpoint-client";

interface NetworkProbePayload {
  schemaVersion: 1;
  sample: NetworkProbeSample;
}

export interface NetworkProbeClientOptions {
  fetcher?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNetworkProbePayload(value: unknown): value is NetworkProbePayload {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.sample)) return false;
  return typeof value.sample.timestamp === "string"
    && typeof value.sample.success === "boolean"
    && (typeof value.sample.latencyMs === "number" || value.sample.latencyMs === null);
}

/** Calls the optional Surge-side user-path probe; no browser-to-target CORS is needed. */
export class SurgeNetworkProbeClient {
  private readonly bridgeUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(bridgeUrl: string, options: NetworkProbeClientOptions = {}) {
    this.bridgeUrl = bridgeUrl;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async probe(target: string): Promise<NetworkProbeSample> {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) throw new Error("未配置 Internet 用户路径探测地址");
    let parsedTarget: URL;
    try {
      parsedTarget = new URL(normalizedTarget);
    } catch {
      throw new Error("Internet 探测地址必须是有效 HTTPS URL");
    }
    if (parsedTarget.protocol !== "https:" || parsedTarget.username || parsedTarget.password) {
      throw new Error("Internet 探测地址只允许不带凭据的 HTTPS URL");
    }

    const response = await this.fetcher(bridgePath(this.bridgeUrl, "network-probe"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: parsedTarget.toString() }),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok || !isNetworkProbePayload(payload)) {
      const details = isRecord(payload) ? payload : {};
      throw new Error(
        typeof details.error === "string"
          ? details.error
          : `Surge 网络探测失败 (${response.status})`,
      );
    }
    return payload.sample;
  }
}
