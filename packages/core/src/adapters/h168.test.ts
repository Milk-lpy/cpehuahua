import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { H155Adapter, ReservedAdapterError } from "./h155";
import { H168Adapter } from "./h168";
import { H168_PROBE_ENDPOINTS } from "../probe/endpoints";
import { parseHuaweiXml } from "../xml/parser";
import type { AdapterInput } from "../types/adapter";
import type { EndpointProbeResult } from "../types/probe";

function fixture(name: string): string {
  return readFileSync(new URL(`../../../../fixtures/h168/${name}`, import.meta.url), "utf8");
}

function result(id: string, raw: string, status: EndpointProbeResult["status"] = "ok"): EndpointProbeResult {
  const endpoint = H168_PROBE_ENDPOINTS.find((item) => item.id === id);
  if (!endpoint) throw new Error(`missing endpoint ${id}`);
  const parsed = parseHuaweiXml(raw);
  return {
    endpoint,
    status,
    requestedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:00.001Z",
    latencyMs: 1,
    httpStatus: 200,
    huaweiError: parsed.error,
    transportError: null,
    rawXml: raw,
    sanitizedRawXml: raw,
    parsed,
    parsedFields: parsed.fields,
  };
}

function input(overrides: Partial<AdapterInput> = {}): AdapterInput {
  return {
    timestamp: "2026-09-05T00:00:00.000Z",
    source: "fixture",
    gateway: "192.168.8.1",
    endpointResults: {
      "device-signal": result("device-signal", fixture("signal.xml")),
      "device-basic-information": result("device-basic-information", fixture("basic_information.xml")),
      "net-current-plmn": result("net-current-plmn", fixture("plmn.xml")),
      "device-seccellinfo": result("device-seccellinfo", fixture("seccellinfo.xml")),
      "device-nbrcellinfo": result("device-nbrcellinfo", fixture("nbrcellinfo.xml")),
      "monitoring-status": result("monitoring-status", fixture("status.xml")),
      "monitoring-traffic-statistics": result("monitoring-traffic-statistics", fixture("traffic.xml")),
    },
    ...overrides,
  };
}

describe("H168 adapter", () => {
  it("normalizes reference-shaped NSA data without inventing extended fields", () => {
    const snapshot = new H168Adapter().normalize(input());

    expect(snapshot.connection.radioMode).toBe("5G");
    expect(snapshot.connection.saNsa).toBe("NSA");
    expect(snapshot.connection.internetOnline).toBeNull();
    expect(snapshot.cells.pcc?.technology).toBe("LTE");
    expect(snapshot.cells.pcc?.rsrpDbm).toBe(-91);
    expect(snapshot.cells.scells).toHaveLength(5);
    expect(snapshot.cells.neighbors).toHaveLength(4);
    expect(snapshot.network.downloadBps).toBe(443457 * 8);
    expect(snapshot.extended.temperatureC).toBeNull();
    expect(snapshot.extended.cpuUsagePct).toBeNull();
    expect(snapshot.extended.memoryUsagePct).toBeNull();
    expect(snapshot.extended.qci).toBeNull();
    expect(snapshot.capabilities.signal).toBe("unknown");
    expect(snapshot.capabilities.secondaryCells).toBe("unknown");
    expect(snapshot.capabilities.neighbors).toBe("unknown");
  });

  it("handles SA and LTE-only shapes", () => {
    const sa = new H168Adapter().normalize(input({
      endpointResults: {
        "device-signal": result("device-signal", fixture("signal-sa.xml")),
      },
    }));
    const lte = new H168Adapter().normalize(input({
      endpointResults: {
        "device-signal": result("device-signal", fixture("signal-lte.xml")),
      },
    }));

    expect(sa.connection.saNsa).toBe("SA");
    expect(sa.cells.pcc?.technology).toBe("NR");
    expect(sa.cells.pcc?.band).toBe("n78");
    expect(lte.connection.radioMode).toBe("4G");
    expect(lte.connection.saNsa).toBe("unknown");
    expect(lte.cells.pcc?.technology).toBe("LTE");
  });

  it("accepts the mode 12 SA shape without treating generic PCI as LTE", () => {
    const mode12 = result(
      "device-signal",
      "<response><mode>12</mode><pci>360</pci><cell_id>fixture-mode12</cell_id>"
        + "<bandInfo>N78</bandInfo><nrearfcn>633984</nrearfcn><nrrsrp>-92dBm</nrrsrp>"
        + "<nrsinr>17dB</nrsinr></response>",
    );
    const snapshot = new H168Adapter().normalize(input({ endpointResults: { "device-signal": mode12 } }));

    expect(snapshot.connection.radioMode).toBe("5G");
    expect(snapshot.connection.saNsa).toBe("SA");
    expect(snapshot.cells.pcc?.technology).toBe("NR");
    expect(snapshot.cells.pcc?.pci).toBe(360);
    expect(snapshot.cells.pcc?.band).toBe("N78");
  });

  it("normalizes the observed H168 mode 12 and list shapes conservatively", () => {
    const base = input();
    const snapshot = new H168Adapter().normalize({
      ...base,
      source: "live",
      endpointResults: {
        ...base.endpointResults,
        "device-basic-information": result(
          "device-basic-information",
          "<response><classify>cpe</classify><devicename>H168-383</devicename>"
            + "<spreadname_en>5G CPE Ultra 6</spreadname_en></response>",
        ),
        "device-information": result(
          "device-information",
          "<response><DeviceName>H168-383</DeviceName>"
            + "<HardwareVersion>WL1H168M</HardwareVersion>"
            + "<SoftwareVersion>4.4.0.1(H1008SP7C233)</SoftwareVersion>"
            + "<WebUIVersion>WEBUI 4.4.0.1(W2SP7C233)</WebUIVersion>"
            + "<ParameterVersion>scfullv2-2026.0625.01</ParameterVersion>"
            + "<uptime>144</uptime><SerialNumber>[REDACTED]</SerialNumber></response>",
        ),
        "monitoring-status": result(
          "monitoring-status",
          "<response><ConnectionStatus>901</ConnectionStatus><CurrentNetworkTypeEx>111</CurrentNetworkTypeEx></response>",
        ),
        "net-current-plmn": result(
          "net-current-plmn",
          "<response><FullName>中国电信</FullName><Numeric>46011</Numeric><Rat>12</Rat></response>",
        ),
        "device-signal": result(
          "device-signal",
          "<response><mode>12</mode><pci>107</pci><cell_id>[REDACTED-CELL-ID]</cell_id>"
            + "<tac>[REDACTED-TAC]</tac><band>100MHz@627264(N78)</band><bandInfo>N78</bandInfo><nrearfcn>627264</nrearfcn>"
            + "<nrdlbandwidth>100MHz</nrdlbandwidth><rrc_status>1</rrc_status>"
            + "<nrrsrp>-70dBm</nrrsrp><nrrsrq>-11.0dB</nrrsrq><nrsinr>5dB</nrsinr>"
            + "<nrrssi>-47dBm</nrrssi><cqi0></cqi0><nrcqi0>15</nrcqi0><nrrank>4</nrrank>"
            + "<nrbler>0</nrbler><nrulmcs>NRmcsUpCarrier1:23@256QAM</nrulmcs>"
            + "<dl_mcs></dl_mcs><nrdlmcs>NRmcsDownCarrier1Code0:0@QPSK</nrdlmcs>"
            + "<txpower></txpower><nrtxpower>PPusch:-20dBm</nrtxpower></response>",
        ),
        "device-seccellinfo": result(
          "device-seccellinfo",
          "<response><lteseccell_list></lteseccell_list>"
            + "<nrseccell_list>627264,N78,100MHz,107,-71dBm,-10dB,-48dBm,5dB;</nrseccell_list></response>",
        ),
        "device-nbrcellinfo": result(
          "device-nbrcellinfo",
          "<response><nbrcell_ltelist></nbrcell_ltelist>"
            + "<nbrcell_nrlist>627264,N77/N78,108,-75dBm,-12dB,-50dBm,1dB;"
            + "627264,N77/N78,106,-157dBm,-44dB,-100dBm,-24dB;"
            + "627264,N77/N78,410,-157dBm,-44dB,-100dBm,-24dB;"
            + "627264,N77/N78,985,-155dBm,-44dB,-98dBm,-24dB;"
            + "627264,N77/N78,984,-157dBm,-44dB,-100dBm,-24dB;"
            + "627264,N77/N78,825,-157dBm,-44dB,-100dBm,-24dB;</nbrcell_nrlist></response>",
        ),
        "monitoring-traffic-statistics": result(
          "monitoring-traffic-statistics",
          "<response><CurrentConnectTime>120</CurrentConnectTime><CurrentDownload>33573685</CurrentDownload>"
            + "<CurrentUpload>1154036</CurrentUpload><CurrentDownloadRate>47554</CurrentDownloadRate>"
            + "<CurrentUploadRate>4281</CurrentUploadRate><TotalDownload>11493789936</TotalDownload>"
            + "<TotalUpload>503731793</TotalUpload><TotalConnectTime>63041</TotalConnectTime></response>",
        ),
      },
    });

    expect(snapshot.device.firmware).toBe("4.4.0.1(H1008SP7C233)");
    expect(snapshot.device.productName).toBe("5G CPE Ultra 6");
    expect(snapshot.device.hardwareVersion).toBe("WL1H168M");
    expect(snapshot.device.webUiVersion).toBe("WEBUI 4.4.0.1(W2SP7C233)");
    expect(snapshot.device.parameterVersion).toBe("scfullv2-2026.0625.01");
    expect(snapshot.device.uptimeSeconds).toBe(144);
    expect(snapshot.connection.cellularOnline).toBe(true);
    expect(snapshot.connection.cellularStatusCode).toBe("901");
    expect(snapshot.connection.operatorName).toBe("中国电信");
    expect(snapshot.connection.plmn).toBe("46011");
    expect(snapshot.connection.saNsa).toBe("SA");
    expect(snapshot.cells.pcc?.technology).toBe("NR");
    expect(snapshot.cells.pcc?.pci).toBe(107);
    expect(snapshot.cells.pcc?.tac).toBe("[REDACTED-TAC]");
    expect(snapshot.cells.pcc?.rsrpDbm).toBe(-70);
    expect(snapshot.cells.pcc?.sinrDb).toBe(5);
    expect(snapshot.cells.pcc?.cqi).toBe(15);
    expect(snapshot.cells.pcc?.mimoRank).toBe(4);
    expect(snapshot.cells.pcc?.blerPct).toBe(0);
    expect(snapshot.cells.scells).toHaveLength(1);
    expect(snapshot.cells.scells[0]?.pci).toBe(107);
    expect(snapshot.cells.neighbors).toHaveLength(6);
    expect(snapshot.network.downloadBps).toBe(47554 * 8);
    expect(snapshot.network.uploadBps).toBe(4281 * 8);
    expect(snapshot.network.currentDownloadBytes).toBe(33573685);
    expect(snapshot.network.currentUploadBytes).toBe(1154036);
    expect(snapshot.network.totalDownloadBytes).toBe(11493789936);
    expect(snapshot.network.totalUploadBytes).toBe(503731793);
    expect(snapshot.network.currentConnectSeconds).toBe(120);
    expect(snapshot.network.totalConnectSeconds).toBe(63041);
    expect(snapshot.radio.dlMcs).toBeNull();
    expect(snapshot.radio.txPowerDbm).toBeNull();
    expect(snapshot.radio.bandwidth).toBe("100MHz");
    expect(snapshot.radio.rrcStatus).toBe("1");
    expect(snapshot.cells.pcc?.bandwidth).toBe("100MHz");
    expect(snapshot.cells.pcc?.rrcStatus).toBe("1");
    expect(snapshot.cells.scells[0]?.bandwidth).toBe("100MHz");
    expect(snapshot.cells.scells[0]?.rrcStatus).toBeNull();
    expect(snapshot.radio.rawEvidence?.dlMcs).toBe("NRmcsDownCarrier1Code0:0@QPSK");
    expect(snapshot.radio.rawEvidence?.ulMcs).toBe("NRmcsUpCarrier1:23@256QAM");
    expect(snapshot.radio.rawEvidence?.txPower).toBe("PPusch:-20dBm");
    expect(snapshot.capabilities.signal).toBe("observed");
    expect(snapshot.capabilities.secondaryCells).toBe("observed");
    expect(snapshot.capabilities.neighbors).toBe("observed");
    expect(snapshot.capabilities.traffic).toBe("observed");
    expect(snapshot.capabilities.mcs).toBe("observed");
    expect(snapshot.capabilities.txPower).toBe("observed");
  });

  it("keeps all normalized values null when the endpoint is absent", () => {
    const snapshot = new H168Adapter().normalize(input({ endpointResults: {} }));

    expect(snapshot.cells.pcc).toBeNull();
    expect(snapshot.radio.rsrpDbm).toBeNull();
    expect(snapshot.network.downloadBps).toBeNull();
    expect(snapshot.capabilities.signal).toBe("unknown");
  });

  it("normalizes the newly observed monthly traffic, WLAN hosts and SMS summaries", () => {
    const snapshot = new H168Adapter().normalize(input({
      source: "live",
      endpointResults: {
        "monitoring-month-statistics": result(
          "monitoring-month-statistics",
          "<response><CurrentMonthDownload>16365211440</CurrentMonthDownload>"
            + "<CurrentMonthUpload>1427194145</CurrentMonthUpload><MonthDuration>75035</MonthDuration>"
            + "<MonthLastClearTime>2026-09-06</MonthLastClearTime><CurrentDayUsed>7916159831</CurrentDayUsed>"
            + "<CurrentDayDuration>51888</CurrentDayDuration></response>",
        ),
        "wlan-host-list": result(
          "wlan-host-list",
          "<response><Hosts><Host><Frequency>5GHz</Frequency><IdentifyType>Android</IdentifyType>"
            + "<MacAddress>[REDACTED]</MacAddress><AssociatedSsid>super_5GHz_1</AssociatedSsid>"
            + "<IpAddress>[REDACTED]</IpAddress><AssociatedTime>7081</AssociatedTime>"
            + "<ActualName>Y700</ActualName><HostName>Y700</HostName></Host>"
            + "<Host><Frequency>5GHz</Frequency><IdentifyBrands>Apple</IdentifyBrands>"
            + "<IdentifyType>mobile</IdentifyType><AssociatedTime>12050</AssociatedTime>"
            + "<ActualName>iPhone</ActualName></Host></Hosts></response>",
        ),
        "monitoring-check-notifications": result(
          "monitoring-check-notifications",
          "<response><UnreadMessage>0</UnreadMessage><SmsStorageFull>0</SmsStorageFull></response>",
        ),
        "sms-count": result(
          "sms-count",
          "<response><LocalUnread>0</LocalUnread><LocalInbox>2</LocalInbox><LocalOutbox>0</LocalOutbox>"
            + "<LocalDraft>0</LocalDraft><LocalDeleted>0</LocalDeleted><LocalMax>500</LocalMax>"
            + "<SimUnread>0</SimUnread><SimInbox>0</SimInbox><SimMax>0</SimMax><SimUsed>0</SimUsed>"
            + "<NewMsg>0</NewMsg></response>",
        ),
      },
    }));

    expect(snapshot.network.monthDownloadBytes).toBe(16365211440);
    expect(snapshot.network.monthUploadBytes).toBe(1427194145);
    expect(snapshot.network.monthDurationSeconds).toBe(75035);
    expect(snapshot.network.monthLastClearDate).toBe("2026-09-06");
    expect(snapshot.network.dayUsedBytes).toBe(7916159831);
    expect(snapshot.network.dayDurationSeconds).toBe(51888);
    expect(snapshot.clients).toHaveLength(2);
    expect(snapshot.clients[0]).toMatchObject({ name: "Y700", frequency: "5GHz", associatedSeconds: 7081 });
    expect(snapshot.clients[0]?.ipAddress).toBeNull();
    expect(snapshot.clients[0]?.macAddress).toBeNull();
    expect(snapshot.clients[1]).toMatchObject({ name: "iPhone", manufacturer: "Apple" });
    expect(snapshot.messaging).toMatchObject({ unread: 0, inbox: 2, capacity: 500, storageFull: false });
    expect(snapshot.capabilities.monthlyTraffic).toBe("observed");
    expect(snapshot.capabilities.clients).toBe("observed");
    expect(snapshot.capabilities.sms).toBe("observed");
  });

  it("only marks endpoint and advanced capabilities observed for live evidence", () => {
    const snapshot = new H168Adapter().normalize(input({ source: "live" }));

    expect(snapshot.capabilities.signal).toBe("observed");
    expect(snapshot.capabilities.secondaryCells).toBe("observed");
    expect(snapshot.capabilities.neighbors).toBe("observed");
    expect(snapshot.capabilities.cqi).toBe("observed");
    expect(snapshot.capabilities.mcs).toBe("observed");
    expect(snapshot.capabilities.mimoRank).toBe("observed");
    expect(snapshot.capabilities.temperature).toBe("unknown");
  });

  it("keeps Huawei 100003 as unknown because it can be an authentication or permission failure", () => {
    const denied = result(
      "device-seccellinfo",
      "<error><code>100003</code><message /></error>",
      "huawei-error",
    );
    const snapshot = new H168Adapter().normalize(input({
      source: "live",
      endpointResults: { "device-seccellinfo": denied },
    }));

    expect(snapshot.capabilities.secondaryCells).toBe("unknown");
  });

  it("does not pretend that H155 is implemented", () => {
    const adapter = new H155Adapter();

    expect(adapter.identify(parseHuaweiXml("<response><model>H155-381</model></response>")).matched).toBe(true);
    expect(() => adapter.normalize(input())).toThrow(ReservedAdapterError);
  });
});
