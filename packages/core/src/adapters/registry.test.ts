import { describe, expect, it } from "vitest";
import { adapterForId, CPE_ADAPTERS, identifyAdapter } from "./registry";
import { parseHuaweiXml } from "../xml/parser";

describe("adapter registry", () => {
  it("keeps H168 implementation and H155 reservation behind one registry", () => {
    expect(CPE_ADAPTERS.map((adapter) => adapter.id)).toEqual(["h168", "h155"]);
    expect(adapterForId("h168")?.id).toBe("h168");
    expect(adapterForId("h155")?.id).toBe("h155");
  });

  it("identifies H168 only from an explicit model response", () => {
    const result = identifyAdapter(parseHuaweiXml("<response><devicename>H168-383</devicename></response>"));
    expect(result.adapter?.id).toBe("h168");
    expect(result.identification.confidence).toBe("exact");
  });
});
