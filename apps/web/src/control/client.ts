import { bridgePath } from "../live/endpoint-client";
import { BridgeRequestGate } from "../live/bridge-request-gate";
import type { ControlAction, ControlClientOptions, ControlResponse } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class H168ControlClient {
  private readonly url: string;
  private readonly options: ControlClientOptions;
  private readonly requestGate: BridgeRequestGate;

  constructor(bridgeUrl: string, options: ControlClientOptions) {
    this.url = bridgePath(bridgeUrl, "control");
    this.options = options;
    this.requestGate = options.requestGate ?? new BridgeRequestGate();
  }

  async execute<T>(action: ControlAction, values: Record<string, unknown> = {}): Promise<ControlResponse<T>> {
    return this.requestGate.run(async () => {
      const password = this.options.getPassword();
      const localAuthCleanup = action === "auth.forget" || action === "auth.logout";
      const response = await (this.options.fetcher ?? fetch)(this.url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...values,
          ...(!localAuthCleanup && password ? { password } : {}),
          ...(!localAuthCleanup ? {
            rememberSession: this.options.rememberSession(),
            rememberPassword: this.options.rememberPassword?.() ?? false,
          } : {}),
        }),
      });
      const payload = await response.json() as unknown;
      if (!response.ok || !isRecord(payload) || payload.schemaVersion !== 1) {
        const message = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `控制 Bridge 返回 HTTP ${response.status}`;
        throw new Error(message);
      }
      const result = payload as unknown as ControlResponse<T>;
      if (result.status !== "ok" && result.status !== "partial") {
        throw new Error(result.huaweiError?.code ? `Huawei error ${result.huaweiError.code}` : "设备拒绝了操作");
      }
      return result;
    });
  }
}
