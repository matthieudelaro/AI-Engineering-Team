import type { Zone } from "../config.js";
import type { Cell } from "./types.js";

export function inZone(cell: Cell, zone: Zone): boolean {
  return (
    cell.x >= zone.x &&
    cell.x < zone.x + zone.w &&
    cell.y >= zone.y &&
    cell.y < zone.y + zone.h
  );
}

export interface BoardBounds {
  width: number;
  height: number;
}

export function partitionBoardHorizontally(
  bounds: BoardBounds,
  count: number,
): Zone[] {
  if (count <= 0) {
    return [];
  }
  const sliceWidth = Math.floor(bounds.width / count);
  const zones: Zone[] = [];
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    zones.push({
      x: i * sliceWidth,
      y: 0,
      w: isLast ? bounds.width - i * sliceWidth : sliceWidth,
      h: bounds.height,
    });
  }
  return zones;
}

export function partitionBoardVertically(
  bounds: BoardBounds,
  count: number,
): Zone[] {
  if (count <= 0) {
    return [];
  }
  const sliceHeight = Math.floor(bounds.height / count);
  const zones: Zone[] = [];
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    zones.push({
      x: 0,
      y: i * sliceHeight,
      w: bounds.width,
      h: isLast ? bounds.height - i * sliceHeight : sliceHeight,
    });
  }
  return zones;
}

export function zonesOverlap(a: Zone, b: Zone): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

export function validateZones(zones: Zone[]): void {
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      if (a && b && zonesOverlap(a, b)) {
        throw new Error(`zones overlap: index ${i} and ${j}`);
      }
    }
  }
}
