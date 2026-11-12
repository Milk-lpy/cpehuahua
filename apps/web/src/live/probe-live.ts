import { adapterForId } from "@cpehuahua/core";
import type { CpeLiveReport, ProbeReport } from "@cpehuahua/core";

/** Convert one real Probe result into the first local dashboard snapshot. */
export function liveReportFromProbe(report: ProbeReport): CpeLiveReport | null {
  const adapter = adapterForId(report.adapterId);
  if (!adapter || report.adapterId === "h155") return null;

  const endpointResults = Object.fromEntries(
    report.endpointResults.map((result) => [result.endpoint.id, result]),
  );
  const snapshot = adapter.normalize({
    timestamp: report.generatedAt,
    source: "live",
    gateway: report.gateway,
    endpointResults,
  });
  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    adapterId: adapter.id,
    gateway: report.gateway,
    snapshot,
    history: [snapshot],
    events: [],
  };
}
