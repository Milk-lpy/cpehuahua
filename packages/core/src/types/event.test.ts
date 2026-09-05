import { describe, expect, it } from "vitest";
import type { CpeEvent } from "./event";

describe("CpeEvent contract", () => {
  it("keeps outage duration and values explicit", () => {
    const event: CpeEvent = {
      timestamp: "2026-09-05T00:00:00.000Z",
      type: "INTERNET_UP",
      oldValue: false,
      newValue: true,
      context: { source: "iphone-surge", probe: "connectivity" },
      durationMs: 17_000,
    };

    expect(event.durationMs).toBe(17_000);
    expect(event.oldValue).toBe(false);
  });
});
