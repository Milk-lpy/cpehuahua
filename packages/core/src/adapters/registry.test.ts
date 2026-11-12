import { describe, expect, it } from "vitest";
import { adapterForId, CPE_ADAPTERS, identifyAdapter } from "./registry";
import { parseHuaweiXml } from "../xml/parser";

describe("adapter registry", () => {
  it("keeps H168, E6888 candidate, and H155 reservation behind one registry", () => {
    expect(CPE_ADAPTERS.map((adapter) => adapter.id)).toEqual(["h168", "e6888", "h155"]);
    expect(adapterForId("h168")?.id).toBe("h168");
    expect(adapterForId("e6888")?.id).toBe("e6888");
    expect(adapterForId("h155")?.id).toBe("h155");
  });

  it("identifies H168 only from an explicit model response", () => {
    const result = identifyAdapter(parseHuaweiXml("<response><devicename>H168-383</devicename></response>"));
    expect(result.adapter?.id).toBe("h168");
    expect(result.identification.confidence).toBe("exact");
  });

  it("identifies E6888 only from its explicit model response", () => {
    const result = identifyAdapter(parseHuaweiXml("<response><DeviceName>E6888-982</DeviceName></response>"));
    expect(result.adapter?.id).toBe("e6888");
    expect(result.identification.confidence).toBe("exact");
  });
});
