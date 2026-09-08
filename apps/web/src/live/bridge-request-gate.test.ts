import { describe, expect, it } from "vitest";
import { BridgeRequestGate } from "./bridge-request-gate";

describe("BridgeRequestGate", () => {
  it("runs shared Bridge operations in order and continues after rejection", async () => {
    const gate = new BridgeRequestGate();
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = gate.run(() => new Promise<void>((resolve) => {
      events.push("first:start");
      releaseFirst = () => {
        events.push("first:end");
        resolve();
      };
    }));
    const second = gate.run(async () => {
      events.push("second");
      throw new Error("expected test failure");
    });
    const third = gate.run(async () => {
      events.push("third");
      return "ok";
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await first;
    await expect(second).rejects.toThrow("expected test failure");
    await expect(third).resolves.toBe("ok");
    expect(events).toEqual(["first:start", "first:end", "second", "third"]);
  });
});
