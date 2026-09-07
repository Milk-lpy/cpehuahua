import type { CpeCell, CpeSnapshot } from "../types/model";

function normalizedBand(value: string | null): string | null {
  if (value === null) return null;
  const match = value.toUpperCase().match(/(?:^|\()([BN]\d+)(?:\)|$)/);
  return match?.[1] ?? value.trim().toUpperCase();
}

/** Compare only stable serving-cell identity fields; measurements are intentionally ignored. */
export function isSameCarrierIdentity(left: CpeCell, right: CpeCell): boolean {
  if (left.technology !== right.technology || left.arfcn === null || right.arfcn === null) return false;
  if (left.pci === null || right.pci === null) return false;
  if (left.arfcn !== right.arfcn || left.pci !== right.pci) return false;

  const leftBand = normalizedBand(left.band);
  const rightBand = normalizedBand(right.band);
  return leftBand === null || rightBand === null || leftBand === rightBand;
}

/** Keeps the raw snapshot untouched while removing device-reported PCC mirrors from presentation. */
export function distinctServingCells(snapshot: CpeSnapshot): CpeCell[] {
  const cells = [snapshot.cells.pcc, ...snapshot.cells.scells].filter((cell): cell is CpeCell => cell !== null);
  return cells.filter((cell, index) => !cells.slice(0, index).some((candidate) => isSameCarrierIdentity(candidate, cell)));
}

export function carrierAggregationLabel(snapshot: CpeSnapshot): string | null {
  const cells = distinctServingCells(snapshot);
  if (cells.length === 0 || cells.some((cell) => cell.band === null)) return null;
  return cells.map((cell) => cell.band).join(" + ");
}

export function isMirroredSecondaryCell(snapshot: CpeSnapshot, cell: CpeCell): boolean {
  return snapshot.cells.pcc !== null && isSameCarrierIdentity(snapshot.cells.pcc, cell);
}
