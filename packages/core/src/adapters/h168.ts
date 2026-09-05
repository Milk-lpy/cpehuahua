import type { CpeAdapter, AdapterIdentification, AdapterInput } from "../types/adapter";
import type { CpeCell, CpeSnapshot, CapabilityMatrix, RadioMetrics } from "../types/model";
import type { EndpointProbeResult } from "../types/probe";
import { findHuaweiField, numberOfHuaweiField, textOfHuaweiField } from "../xml/parser";
import { H168_PROBE_ENDPOINTS } from "../probe/endpoints";
import { emptyCapabilities, emptyExtendedMetrics, emptyRadioMetrics } from "./helpers";
import type { ParsedHuaweiXml } from "../types/xml";

const H168_NAMES = ["H168-383", "Huawei 5G CPE Ultra 6", "Brovi 5G CPE Ultra 6"] as const;

function resultFor(input: AdapterInput, id: string): EndpointProbeResult | null {
  return input.endpointResults[id] ?? null;
}

function documentFor(input: AdapterInput, id: string): ParsedHuaweiXml | null {
  const result = resultFor(input, id);
  return result?.status === "ok" && result.parsed?.parseError === null ? result.parsed : null;
}

function text(document: ParsedHuaweiXml | null, names: readonly string[]): string | null {
  const value = textOfHuaweiField(document, names);
  return value === null || value === "" ? null : value;
}

function number(document: ParsedHuaweiXml | null, names: readonly string[]): number | null {
  return numberOfHuaweiField(document, names);
}

function scalarNumber(document: ParsedHuaweiXml | null, names: readonly string[]): number | null {
  const value = text(document, names);
  if (value === null || !/^[-+]?\d+(?:\.\d+)?(?:\s*[a-zA-Z%]+)?$/.test(value)) {
    return null;
  }
  return number(document, names);
}

function booleanFrom(document: ParsedHuaweiXml | null, names: readonly string[]): boolean | null {
  const value = text(document, names)?.toLowerCase();
  if (!value) {
    return null;
  }
  if (["online", "connected", "up", "registered", "connectedstate"].includes(value)) {
    return true;
  }
  if (["offline", "disconnected", "down", "unregistered"].includes(value)) {
    return false;
  }
  return null;
}

function isSaMode(mode: string | null): boolean {
  return mode === "102" || mode === "12";
}

function radioMode(mode: string | null): CpeSnapshot["connection"]["radioMode"] {
  if (mode === "101" || isSaMode(mode)) {
    return "5G";
  }
  if (["7", "8", "9", "10"].includes(mode ?? "")) {
    return "4G";
  }
  if (["1", "2", "3"].includes(mode ?? "")) {
    return mode === "1" ? "2G" : "3G";
  }
  return "unknown";
}

function saNsa(mode: string | null): CpeSnapshot["connection"]["saNsa"] {
  if (mode === "101") return "NSA";
  if (isSaMode(mode)) return "SA";
  return "unknown";
}

function metricSet(document: ParsedHuaweiXml | null, nr: boolean, genericNrKeys = false): RadioMetrics {
  const pciNames = nr
    ? genericNrKeys ? ["nrpci", "pci"] : ["nrpci"]
    : ["pci"];
  const cellIdNames = nr
    ? genericNrKeys ? ["nrcellid", "cell_id", "nrcell_id"] : ["nrcellid", "nrcell_id"]
    : ["cell_id", "cellid"];
  const bandNames = nr
    ? genericNrKeys ? ["nrband", "bandInfo", "band"] : ["nrband", "bandInfo"]
    : ["band", "bandInfo"];
  const arfcnNames = nr
    ? genericNrKeys ? ["nrearfcn", "nrarfcn", "earfcn"] : ["nrearfcn", "nrarfcn"]
    : ["earfcn", "arfcn"];
  return {
    rsrpDbm: scalarNumber(document, [nr ? "nrrsrp" : "rsrp"]),
    rsrqDb: scalarNumber(document, [nr ? "nrrsrq" : "rsrq"]),
    sinrDb: scalarNumber(document, [nr ? "nrsinr" : "sinr"]),
    rssiDbm: scalarNumber(document, [nr ? "nrrssi" : "rssi"]),
    pci: scalarNumber(document, pciNames),
    cellId: text(document, cellIdNames),
    tac: text(document, [nr ? "nrtac" : "tac"]),
    band: text(document, bandNames),
    arfcn: scalarNumber(document, arfcnNames),
    cqi: scalarNumber(document, [nr ? "nrcqi0" : "cqi0", nr ? "nrcqi" : "cqi"]),
    mimoRank: scalarNumber(document, [nr ? "nrrank" : "rank", nr ? "nrmimorank" : "mimorank"]),
    dlMcs: scalarNumber(document, [nr ? "nrdlmcs" : "dl_mcs", nr ? "nrdlmcs" : "dlmcs"]),
    ulMcs: scalarNumber(document, [nr ? "nrulmcs" : "ul_mcs", nr ? "nrumcs" : "ulmcs"]),
    blerPct: scalarNumber(document, [nr ? "nrbler" : "bler"]),
    txPowerDbm: scalarNumber(document, [nr ? "nrtxpower" : "txpower"]),
  };
}

function hasCellData(cell: RadioMetrics): boolean {
  return Object.values(cell).some((value) => value !== null);
}

function makeCell(role: CpeCell["role"], technology: CpeCell["technology"], metrics: RadioMetrics): CpeCell {
  return { role, technology, ...metrics };
}

function cellList(
  raw: string | null,
  technology: CpeCell["technology"],
  role: CpeCell["role"],
  hasBandwidth: boolean,
): CpeCell[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(";")
    .map((item) => item.split(",").map((part) => part.trim()))
    .filter((parts) => parts.some(Boolean))
    .map((parts) => {
      const offset = hasBandwidth ? 1 : 0;
      const value = (index: number): string | null => {
        const item = parts[index + offset];
        return item ? item : null;
      };
      const band = parts[1] ?? null;
      return makeCell(role, technology, {
        rsrpDbm: numberFromText(value(3)),
        rsrqDb: numberFromText(value(4)),
        sinrDb: numberFromText(value(6)),
        rssiDbm: numberFromText(value(5)),
        pci: numberFromText(value(2)),
        cellId: null,
        tac: null,
        band: band || null,
        arfcn: numberFromText(parts[0] ?? null),
        cqi: null,
        mimoRank: null,
        dlMcs: null,
        ulMcs: null,
        blerPct: null,
        txPowerDbm: null,
      });
    });
}

function numberFromText(value: string | null): number | null {
  if (!value || !/[-+]?\d/.test(value)) {
    return null;
  }
  const match = value.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function rateBps(document: ParsedHuaweiXml | null, names: readonly string[]): number | null {
  const value = scalarNumber(document, names);
  // Huawei's Current*Rate is documented by the reference monitor as bytes/s.
  // Keep the conversion local and easy to remove if H168 Probe shows a
  // different unit on the target firmware.
  return value === null ? null : value * 8;
}

function capability(
  baseline: CapabilityMatrix,
  input: AdapterInput,
  endpointId: string,
  key: keyof CapabilityMatrix,
): void {
  const result = resultFor(input, endpointId);
  if (!result) return;
  // A fixture or reference-shaped response is parser test input, not device
  // capability evidence. Only a live Probe may move this matrix out of
  // unknown; explicit live Huawei permission errors can become unsupported.
  if (input.source !== "live") return;
  if (result.status === "ok") {
    baseline[key] = "observed";
  } else if (result.huaweiError?.code === 100002 || result.huaweiError?.code === 100003) {
    baseline[key] = "unsupported";
  }
}

function emptySnapshot(input: AdapterInput, capabilities: CapabilityMatrix): CpeSnapshot {
  return {
    schemaVersion: 1,
    timestamp: input.timestamp,
    source: input.source,
    device: { model: null, firmware: null, uptimeSeconds: null },
    connection: {
      cellularOnline: null,
      internetOnline: null,
      radioMode: "unknown",
      saNsa: "unknown",
      plmn: null,
    },
    radio: emptyRadioMetrics(),
    cells: { pcc: null, scells: [], neighbors: [] },
    network: {
      pingMs: null,
      jitterMs: null,
      packetLossPct: null,
      downloadBps: null,
      uploadBps: null,
    },
    extended: emptyExtendedMetrics(),
    capabilities,
  };
}

function getRawCellList(document: ParsedHuaweiXml | null, names: readonly string[]): string | null {
  const value = findHuaweiField(document, names);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class H168Adapter implements CpeAdapter {
  readonly id = "h168" as const;
  readonly modelNames = H168_NAMES;
  readonly probeEndpoints = H168_PROBE_ENDPOINTS;
  readonly baselineCapabilities = emptyCapabilities();

  identify(input: ParsedHuaweiXml | null): AdapterIdentification {
    if (!input || input.parseError || !input.data) {
      return { matched: false, confidence: "none", reason: "没有可解析的设备信息" };
    }
    const serialized = JSON.stringify(input.response).toLowerCase();
    if (serialized.includes("h168-383")) {
      return { matched: true, confidence: "exact", reason: "响应中出现 H168-383" };
    }
    if (serialized.includes("ultra 6") || serialized.includes("brovi")) {
      return { matched: true, confidence: "possible", reason: "响应中出现 Ultra 6/Brovi，但未出现精确型号" };
    }
    return { matched: false, confidence: "none", reason: "响应未确认 H168-383" };
  }

  normalize(input: AdapterInput): CpeSnapshot {
    const capabilities = { ...this.baselineCapabilities };
    capability(capabilities, input, "device-signal", "signal");
    capability(capabilities, input, "device-seccellinfo", "secondaryCells");
    capability(capabilities, input, "device-nbrcellinfo", "neighbors");
    capability(capabilities, input, "monitoring-traffic-statistics", "traffic");

    const signal = documentFor(input, "device-signal");
    const basic = documentFor(input, "device-basic-information");
    const plmnDocument = documentFor(input, "net-current-plmn");
    const sec = documentFor(input, "device-seccellinfo");
    const nbr = documentFor(input, "device-nbrcellinfo");
    const mode = text(signal, ["mode"]);
    const lte = metricSet(signal, false);
    const nr = metricSet(signal, true, isSaMode(mode));
    const pcc = isSaMode(mode)
      ? (hasCellData(nr) ? makeCell("pcc", "NR", nr) : null)
      : hasCellData(lte)
        ? makeCell("pcc", "LTE", lte)
        : hasCellData(nr)
          ? makeCell("pcc", "NR", nr)
          : null;
    const signalScells: CpeCell[] = [];
    if (mode === "101" && hasCellData(nr)) {
      signalScells.push(makeCell("scell", "NR", nr));
    }
    if (isSaMode(mode) && hasCellData(lte)) {
      signalScells.push(makeCell("scell", "LTE", lte));
    }
    if (text(signal, ["scc_pci"])) {
      signalScells.push(makeCell("scell", "LTE", {
        ...emptyRadioMetrics(),
        pci: scalarNumber(signal, ["scc_pci"]),
        band: text(signal, ["scc_band"]),
      }));
    }
    const scells = [
      ...signalScells,
      ...cellList(getRawCellList(sec, ["nrseccell_list"]), "NR", "scell", true),
      ...cellList(getRawCellList(sec, ["lteseccell_list"]), "LTE", "scell", true),
    ];
    const neighbors = [
      ...cellList(getRawCellList(nbr, ["nbrcell_nrlist"]), "NR", "neighbor", false),
      ...cellList(getRawCellList(nbr, ["nbrcell_ltelist"]), "LTE", "neighbor", false),
    ];
    const status = documentFor(input, "monitoring-status");
    const traffic = documentFor(input, "monitoring-traffic-statistics");
    const plmn = text(signal, ["plmn"]) ?? text(plmnDocument, ["plmn", "currentplmn", "current_plmn"]);
    const result = emptySnapshot(input, capabilities);
    if (input.source === "live") {
      if (text(signal, ["nrcqi0", "nrcqi", "cqi0", "cqi"]) !== null) capabilities.cqi = "observed";
      if (text(signal, ["nrrank", "nrmimorank", "rank", "mimorank"]) !== null) capabilities.mimoRank = "observed";
      if (text(signal, ["nrdlmcs", "nrulmcs", "nrumcs", "dl_mcs", "ul_mcs", "dlmcs", "ulmcs"]) !== null) {
        capabilities.mcs = "observed";
      }
      if (text(signal, ["nrbler", "bler"]) !== null) capabilities.bler = "observed";
      if (text(signal, ["nrtxpower", "txpower"]) !== null) capabilities.txPower = "observed";
    }
    result.device = {
      model: text(basic, ["devicename", "DeviceName", "model", "modelname"]),
      firmware: text(basic, ["softwareversion", "SoftwareVersion", "firmware", "Software_version"]),
      uptimeSeconds: number(basic, ["uptime", "UpTime", "uptimeseconds"]),
    };
    result.connection = {
      cellularOnline: booleanFrom(status, ["cellularonline", "connectionstatus", "cellularstatus"]),
      internetOnline: null,
      radioMode: radioMode(mode),
      saNsa: saNsa(mode),
      plmn,
    };
    if (pcc) {
      const { role: _role, technology: _technology, ...radioMetrics } = pcc;
      result.radio = radioMetrics;
    }
    result.cells = { pcc, scells, neighbors };
    result.network = {
      pingMs: null,
      jitterMs: null,
      packetLossPct: null,
      downloadBps: rateBps(traffic, ["CurrentDownloadRate", "downloadrate"]),
      uploadBps: rateBps(traffic, ["CurrentUploadRate", "uploadrate"]),
    };
    // Temperature/QCI/5QI/AMBR and other extended fields remain null until a
    // verified H168 read path is demonstrated by Probe data.
    return result;
  }
}

export { emptySnapshot };
