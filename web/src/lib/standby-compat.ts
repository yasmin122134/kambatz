import type { MissionPositionKind, MissionType } from "@/lib/types";

/**
 * Conservative default: no concurrent assignments are allowed.
 * Future explicit compatibility rules can be added here deliberately.
 */
export function missionsOverlapCompatible(
  _kindA: MissionPositionKind,
  _typeA: MissionType,
  _kindB: MissionPositionKind,
  _typeB: MissionType,
): boolean {
  return false;
}
