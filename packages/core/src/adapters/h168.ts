import type { CpeAdapter, AdapterIdentification, AdapterInput } from "../types/adapter";
import type {
  CpeCell,
  CpeClient,
  CpeSnapshot,
  CapabilityMatrix,
  RadioMetrics,
  RadioRawFields,
} from "../types/model";
import type { EndpointProbeResult } from "../types/probe";
import { findHuaweiField, numberOfHuaweiField, textOfHuaweiField } from "../xml/parser";
import { H168_PROBE_ENDPOINTS } from "../probe/endpoints";
import { emptyCapabilities, emptyExtendedMetrics, emptyRadioMetrics } from "./helpers";
import type { HuaweiXmlObject, HuaweiXmlValue, ParsedHuaweiXml } from "../types/xml";

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

function rawRadioFields(document: ParsedHuaweiXml | null, nr: boolean): RadioRawFields | null {
  const fields: RadioRawFields = {
    dlMcs: text(document, nr ? ["nrdlmcs"] : ["dl_mcs", "dlmcs"]),
    ulMcs: text(document, nr ? ["nrulmcs"] : ["ul_mcs", "ulmcs"]),
    txPower: text(document, nr ? ["nrtxpower"] : ["txpower"]),
  };
  return Object.values(fields).some((value) => value !== null) ? fields : null;
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

function cellularOnline(document: ParsedHuaweiXml | null): boolean | null {
  const status = text(document, ["ConnectionStatus", "connectionstatus"]);
  // Huawei HiLink implementations consistently define 901 as connected and
  // 902/904 as disconnected/failed. Keep transitional/unknown codes null so
  // the event engine does not invent an outage during connect/disconnect.
  if (status === "901") return true;
  if (status === "902" || status === "904") return false;
  return booleanFrom(document, ["cellularonline", "cellularstatus"]);
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
  const rawEvidence = rawRadioFields(document, nr);
  return {
    rsrpDbm: scalarNumber(document, [nr ? "nrrsrp" : "rsrp"]),
    rsrqDb: scalarNumber(document, [nr ? "nrrsrq" : "rsrq"]),
    sinrDb: scalarNumber(document, [nr ? "nrsinr" : "sinr"]),
    rssiDbm: scalarNumber(document, [nr ? "nrrssi" : "rssi"]),
    pci: scalarNumber(document, pciNames),
    cellId: text(document, cellIdNames),
    tac: text(document, nr
      ? genericNrKeys ? ["nrtac", "tac"] : ["nrtac"]
      : ["tac"]),
    band: text(document, bandNames),
    arfcn: scalarNumber(document, arfcnNames),
    bandwidth: text(document, nr ? ["nrdlbandwidth", "dlbandwidth"] : ["dlbandwidth"]),
    rrcStatus: text(document, ["rrc_status"]),
    cqi: scalarNumber(document, [nr ? "nrcqi0" : "cqi0", nr ? "nrcqi" : "cqi"]),
    mimoRank: scalarNumber(document, [nr ? "nrrank" : "rank", nr ? "nrmimorank" : "mimorank"]),
    dlMcs: scalarNumber(document, [nr ? "nrdlmcs" : "dl_mcs", nr ? "nrdlmcs" : "dlmcs"]),
    ulMcs: scalarNumber(document, [nr ? "nrulmcs" : "ul_mcs", nr ? "nrumcs" : "ulmcs"]),
    blerPct: scalarNumber(document, [nr ? "nrbler" : "bler"]),
    txPowerDbm: scalarNumber(document, [nr ? "nrtxpower" : "txpower"]),
    ...(rawEvidence === null ? {} : { rawEvidence }),
  };
}

function hasCellData(cell: RadioMetrics): boolean {
  return Object.values(cell).some((value) => value !== null);
}

function hasExplicitLteSignalData(document: ParsedHuaweiXml | null): boolean {
  return [
    "earfcn",
    "rsrp",
    "rsrq",
    "sinr",
    "rssi",
    "ulbandwidth",
    "dlbandwidth",
    "ul_mcs",
    "dl_mcs",
  ].some((name) => text(document, [name]) !== null);
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
        bandwidth: hasBandwidth ? (parts[2] || null) : null,
        rrcStatus: null,
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

function objectValue(value: HuaweiXmlValue | undefined): HuaweiXmlObject | null {
  return value !== undefined && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function directValue(object: HuaweiXmlObject | null, name: string): HuaweiXmlValue | undefined {
  if (!object) return undefined;
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}

function directText(object: HuaweiXmlObject | null, name: string): string | null {
  const value = directValue(object, name);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized !== "[REDACTED]" ? normalized : null;
}

function directNumber(object: HuaweiXmlObject | null, name: string): number | null {
  return numberFromText(directText(object, name));
}

function connectedClients(document: ParsedHuaweiXml | null): CpeClient[] {
  const hosts = objectValue(directValue(document?.response ?? null, "Hosts"));
  const rawHosts = directValue(hosts, "Host");
  const list = Array.isArray(rawHosts) ? rawHosts : rawHosts === undefined ? [] : [rawHosts];
  return list.flatMap((value) => {
    const host = objectValue(value);
    if (!host) return [];
    return [{
      id: directText(host, "ID"),
      name: directText(host, "ActualName") ?? directText(host, "HostName"),
      hostName: directText(host, "HostName"),
      manufacturer: directText(host, "IdentifyBrands") ?? directText(host, "ActualManu"),
      deviceType: directText(host, "IdentifyType") ?? directText(host, "ActualType"),
      frequency: directText(host, "Frequency"),
      ssid: directText(host, "AssociatedSsid"),
      associatedSeconds: directNumber(host, "AssociatedTime"),
      ipAddress: directText(host, "IpAddress"),
      macAddress: directText(host, "MacAddress"),
    }];
  });
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
  } else if (result.huaweiError?.code === 100002) {
    baseline[key] = "unsupported";
  }
}

function emptySnapshot(input: AdapterInput, capabilities: CapabilityMatrix): CpeSnapshot {
  return {
    schemaVersion: 1,
    timestamp: input.timestamp,
    source: input.source,
    device: {
      model: null,
      productName: null,
      hardwareVersion: null,
      firmware: null,
      webUiVersion: null,
      parameterVersion: null,
      uptimeSeconds: null,
    },
    connection: {
      cellularOnline: null,
      internetOnline: null,
      radioMode: "unknown",
      saNsa: "unknown",
      plmn: null,
      operatorName: null,
      cellularStatusCode: null,
    },
    radio: emptyRadioMetrics(),
    cells: { pcc: null, scells: [], neighbors: [] },
    network: {
      pingMs: null,
      jitterMs: null,
      packetLossPct: null,
      downloadBps: null,
      uploadBps: null,
      currentDownloadBytes: null,
      currentUploadBytes: null,
      totalDownloadBytes: null,
      totalUploadBytes: null,
      currentConnectSeconds: null,
      totalConnectSeconds: null,
      monthDownloadBytes: null,
      monthUploadBytes: null,
      monthDurationSeconds: null,
      monthLastClearDate: null,
      dayUsedBytes: null,
      dayDurationSeconds: null,
    },
    clients: [],
    messaging: {
      unread: null,
      inbox: null,
      outbox: null,
      draft: null,
      deleted: null,
      capacity: null,
      simUnread: null,
      simInbox: null,
      simUsed: null,
      simCapacity: null,
      newMessages: null,
      storageFull: null,
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
    capability(capabilities, input, "monitoring-month-statistics", "monthlyTraffic");
    capability(capabilities, input, "wlan-host-list", "clients");
    capability(capabilities, input, "sms-count", "sms");

    const signal = documentFor(input, "device-signal");
    const basic = documentFor(input, "device-basic-information");
    const deviceInfo = documentFor(input, "device-information");
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
    if (isSaMode(mode) && hasCellData(lte) && hasExplicitLteSignalData(signal)) {
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
    const monthTraffic = documentFor(input, "monitoring-month-statistics");
    const hostList = documentFor(input, "wlan-host-list");
    const notifications = documentFor(input, "monitoring-check-notifications");
    const smsCount = documentFor(input, "sms-count");
    const plmn = text(signal, ["plmn"])
      ?? text(plmnDocument, ["Numeric", "plmn", "currentplmn", "current_plmn"]);
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
      model: text(basic, ["devicename", "DeviceName", "model", "modelname"])
        ?? text(deviceInfo, ["devicename", "DeviceName", "model", "modelname"]),
      productName: text(basic, ["spreadname_zh", "spreadname_en"])
        ?? text(deviceInfo, ["spreadname_zh", "spreadname_en"]),
      hardwareVersion: text(deviceInfo, ["HardwareVersion"]),
      firmware: text(basic, ["softwareversion", "SoftwareVersion", "firmware", "Software_version"])
        ?? text(deviceInfo, ["softwareversion", "SoftwareVersion", "firmware", "Software_version"]),
      webUiVersion: text(deviceInfo, ["WebUIVersion"]),
      parameterVersion: text(deviceInfo, ["ParameterVersion"]),
      uptimeSeconds: number(basic, ["uptime", "UpTime", "uptimeseconds"])
        ?? number(deviceInfo, ["uptime", "UpTime", "uptimeseconds"]),
    };
    result.connection = {
      cellularOnline: cellularOnline(status),
      internetOnline: null,
      radioMode: radioMode(mode),
      saNsa: saNsa(mode),
      plmn,
      operatorName: text(plmnDocument, ["FullName", "ShortName", "Spn"]),
      cellularStatusCode: text(status, ["ConnectionStatus", "connectionstatus"]),
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
      currentDownloadBytes: number(traffic, ["CurrentDownload"]),
      currentUploadBytes: number(traffic, ["CurrentUpload"]),
      totalDownloadBytes: number(traffic, ["TotalDownload"]),
      totalUploadBytes: number(traffic, ["TotalUpload"]),
      currentConnectSeconds: number(traffic, ["CurrentConnectTime"]),
      totalConnectSeconds: number(traffic, ["TotalConnectTime"]),
      monthDownloadBytes: number(monthTraffic, ["CurrentMonthDownload"]),
      monthUploadBytes: number(monthTraffic, ["CurrentMonthUpload"]),
      monthDurationSeconds: number(monthTraffic, ["MonthDuration"]),
      monthLastClearDate: text(monthTraffic, ["MonthLastClearTime"]),
      dayUsedBytes: number(monthTraffic, ["CurrentDayUsed"]),
      dayDurationSeconds: number(monthTraffic, ["CurrentDayDuration"]),
    };
    result.clients = connectedClients(hostList);
    result.messaging = {
      unread: number(smsCount, ["LocalUnread"]) ?? number(notifications, ["UnreadMessage"]),
      inbox: number(smsCount, ["LocalInbox"]),
      outbox: number(smsCount, ["LocalOutbox"]),
      draft: number(smsCount, ["LocalDraft"]),
      deleted: number(smsCount, ["LocalDeleted"]),
      capacity: number(smsCount, ["LocalMax"]),
      simUnread: number(smsCount, ["SimUnread"]),
      simInbox: number(smsCount, ["SimInbox"]),
      simUsed: number(smsCount, ["SimUsed"]),
      simCapacity: number(smsCount, ["SimMax"]),
      newMessages: number(smsCount, ["NewMsg"]),
      storageFull: text(notifications, ["SmsStorageFull"]) === null
        ? null
        : text(notifications, ["SmsStorageFull"]) === "1",
    };
    // Temperature/QCI/5QI/AMBR and other extended fields remain null until a
    // verified H168 read path is demonstrated by Probe data.
    return result;
  }
}

export { emptySnapshot };
