import { H168Adapter } from "@cpehuahua/core";
import type { CpeLiveReport, ProbeReport } from "@cpehuahua/core";

/** Convert one real Probe result into the first local dashboard snapshot. */
export function liveReportFromProbe(report: ProbeReport): CpeLiveReport | null {
  if (report.adapterId !== "h168") return null;

  const endpointResults = Object.fromEntries(
    report.endpointResults.map((result) => [result.endpoint.id, result]),
  );
  const snapshot = new H168Adapter().normalize({
    timestamp: report.generatedAt,
    source: "live",
    gateway: report.gateway,
    endpointResults,
  });
  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    adapterId: "h168",
    gateway: report.gateway,
    snapshot,
    history: [snapshot],
    events: [],
  };
}
