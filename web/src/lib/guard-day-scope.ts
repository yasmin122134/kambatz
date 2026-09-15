import { isBaseWorkPosition } from "@/lib/base-work-template";
import type { MissionDay } from "@/lib/types";

/**
 * Drop leftover linked base_work rows once ABAS is already embedded in guards.
 * Those rows are hidden on the board but still break date-wide auto-assign.
 */
export function omitLegacyLinkedBaseWorkMissions(missions: MissionDay[]): MissionDay[] {
  const hide = new Set<string>();
  for (const mission of missions) {
    if (mission.mission_type !== "guards") continue;
    if (!(mission.positions || []).some(isBaseWorkPosition)) continue;
    const linkedId = mission.scheduling_rules?.linked_mission_id;
    if (linkedId) hide.add(linkedId);
  }
  if (!hide.size) return missions;
  return missions.filter((mission) => !hide.has(mission.id));
}

/** Missions to assign for a calendar day — same set the board shows as that day. */
export function missionsForDateAssignScope(
  allMissions: MissionDay[],
  missionDate: string,
): MissionDay[] {
  const date = missionDate.slice(0, 10);
  return omitLegacyLinkedBaseWorkMissions(
    allMissions.filter((mission) => mission.mission_date.slice(0, 10) === date),
  );
}
