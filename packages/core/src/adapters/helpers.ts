import type {
  CapabilityKey,
  CapabilityMatrix,
  ExtendedMetrics,
  RadioMetrics,
} from "../types/model";

export function emptyCapabilities(): CapabilityMatrix {
  const keys: CapabilityKey[] = [
    "signal",
    "secondaryCells",
    "neighbors",
    "traffic",
    "temperature",
    "fan",
    "qci",
    "fiveQi",
    "ambr",
    "cpu",
    "memory",
    "mcs",
    "cqi",
    "mimoRank",
    "bler",
    "txPower",
  ];
  return Object.fromEntries(keys.map((key) => [key, "unknown"])) as CapabilityMatrix;
}

export function emptyRadioMetrics(): RadioMetrics {
  return {
    rsrpDbm: null,
    rsrqDb: null,
    sinrDb: null,
    rssiDbm: null,
    pci: null,
    cellId: null,
    tac: null,
    band: null,
    arfcn: null,
    bandwidth: null,
    rrcStatus: null,
    cqi: null,
    mimoRank: null,
    dlMcs: null,
    ulMcs: null,
    blerPct: null,
    txPowerDbm: null,
  };
}

export function emptyExtendedMetrics(): ExtendedMetrics {
  return {
    temperatureC: null,
    fanRpm: null,
    cpuUsagePct: null,
    memoryUsagePct: null,
    qci: null,
    fiveQi: null,
    dlAmbr: null,
    ulAmbr: null,
  };
}
