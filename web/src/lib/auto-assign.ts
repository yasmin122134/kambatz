import { createClient } from "@/lib/supabase/server";
import { getFairnessRules } from "@/lib/fairness";
import {
  defaultGuardDayPositions,
  flattenMissionSlots,
  isStandbyKind,
  normalizeSchedulingRules,
  resolvePositionKind,
  syncAssignmentSeats,
} from "@/lib/mission-utils";
import { getMissionDay, listMissionDays, saveMissionDay } from "@/lib/missions";
import {
  PEOPLE_BASE_SELECT,
  PEOPLE_FLAG_SELECT,
  probePeopleFlags,
} from "@/lib/people";
import {
  assignStandbyRoom,
  buildTrackerFromMissions,
  fitsPerson,
  pickBestCandidate,
  placePerson,
  slotRank,
  workScore,
} from "@/lib/scheduling-engine";
import type { Issue, MissionDay, Person } from "@/lib/types";

export type AutoAssignResult = {
  mission: MissionDay;
  filled: number;
  skipped: number;
  warnings: string[];
};

async function loadPeople(): Promise<Person[]> {
  const supabase = await createClient();
  const withFlags = await probePeopleFlags(supabase);
  const select = withFlags
    ? `${PEOPLE_BASE_SELECT},${PEOPLE_FLAG_SELECT}`
    : PEOPLE_BASE_SELECT;

  const { data, error } = await supabase
    .from("people")
    .select(select)
    .eq("active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return (data || []) as unknown as Person[];
}

async function loadApprovedIssues(): Promise<Issue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select("*")
    .eq("status", "approved");

  if (error) {
    if (error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return (data || []) as Issue[];
}

export async function autoAssignMission(
  missionId: string,
  options: { keepExisting?: boolean; includeSameDay?: boolean } = {},
): Promise<AutoAssignResult> {
  const keepExisting = options.keepExisting !== false;
  const mission = await getMissionDay(missionId);
  if (!mission) throw new Error("יום משימה לא נמצא");

  const [people, issues, rules, allMissions] = await Promise.all([
    loadPeople(),
    loadApprovedIssues(),
    getFairnessRules(),
    listMissionDays(false),
  ]);

  if (!people.length) throw new Error("אין צוערים פעילים במאגר");

  const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
  const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  const excludeIds = new Set([mission.id]);

  const sameDayOthers = allMissions.filter(
    (m) => m.mission_date === mission.mission_date && m.id !== mission.id,
  );

  const tracker = buildTrackerFromMissions(allMissions, rules, excludeIds);
  if (options.includeSameDay !== false) {
    for (const other of sameDayOthers) {
      const t2 = buildTrackerFromMissions([other], rules);
      for (const [name, blocks] of Object.entries(t2.busy)) {
        tracker.busy[name] = [...(tracker.busy[name] || []), ...blocks];
      }
      for (const [name, gs] of Object.entries(t2.guardShifts)) {
        tracker.guardShifts[name] = [...(tracker.guardShifts[name] || []), ...gs];
      }
    }
  }

  const meanPrior =
    people.reduce((sum, p) => sum + (p.prior_score || 0), 0) / (people.length || 1);

  const assignments = syncAssignmentSeats(mission.positions, { ...mission.assignments });
  const warnings: string[] = [];
  let filled = 0;
  let skipped = 0;

  const slots = flattenMissionSlots(mission).sort(
    (a, b) =>
      slotRank(b, rules, scheduling) - slotRank(a, rules, scheduling) ||
      b.durationMinutes - a.durationMinutes,
  );

  const standbyPositions = new Set(
    mission.positions
      .filter((p) => isStandbyKind(resolvePositionKind(mission.mission_type, p)))
      .map((p) => p.id),
  );

  for (const slot of slots) {
    const seats = assignments[slot.slotId] || [];
    let inSlot = new Set(seats.filter(Boolean));

    if (slot.sameRoom && standbyPositions.has(slot.positionId)) {
      const emptySeats = seats
        .map((name, i) => ({ name, i }))
        .filter(({ name }) => !name || (!keepExisting && name));
      const need = emptySeats.length;
      if (need === 0) {
        for (const name of seats.filter(Boolean)) {
          placePerson(name, slot, mission.id, tracker, rules, scheduling, slot.seatCount);
          skipped++;
        }
        continue;
      }

      const kept = keepExisting ? seats.filter(Boolean) : [];
      for (const name of kept) {
        placePerson(name, slot, mission.id, tracker, rules, scheduling, slot.seatCount);
      }

      const assigned = assignStandbyRoom(
        people,
        slot,
        need,
        kept,
        tracker,
        issues,
        scheduling,
        rules,
        meanPrior,
        mission.id,
      );

      let ai = 0;
      for (let i = 0; i < seats.length; i++) {
        if (keepExisting && seats[i]) continue;
        if (ai < assigned.length) {
          seats[i] = assigned[ai++];
          inSlot.add(seats[i]);
          filled++;
        } else {
          seats[i] = "";
          warnings.push(
            `${slot.positionName}: לא נמצא חדר שלם פנוי (${need} מקומות)`,
          );
        }
      }
      assignments[slot.slotId] = seats;
      continue;
    }

    for (let i = 0; i < slot.seatCount; i++) {
      const current = seats[i] || "";
      if (keepExisting && current) {
        placePerson(current, slot, mission.id, tracker, rules, scheduling, slot.seatCount);
        skipped++;
        continue;
      }

      const mates = seats.filter((n, idx) => n && idx !== i);
      const candidates = people.filter(
        (p) =>
          !inSlot.has(p.name) &&
          fitsPerson(p, slot, tracker, issues, scheduling, mates, peopleByName),
      );

      const chosen = pickBestCandidate(candidates, slot, tracker, rules, meanPrior);
      if (!chosen) {
        warnings.push(
          `${slot.positionName} ${slot.timeLabel} — משבצת ${i + 1}: לא נמצא צוער שעומד בכללים`,
        );
        seats[i] = "";
        continue;
      }

      seats[i] = chosen.name;
      inSlot.add(chosen.name);
      placePerson(chosen.name, slot, mission.id, tracker, rules, scheduling, slot.seatCount);
      filled++;
    }

    assignments[slot.slotId] = seats;
  }

  const saved = await saveMissionDay({ ...mission, assignments });
  return { mission: saved, filled, skipped, warnings };
}

export async function autoAssignDate(
  missionDate: string,
  options: { keepExisting?: boolean } = {},
): Promise<{ results: AutoAssignResult[]; warnings: string[] }> {
  const missions = (await listMissionDays(false)).filter(
    (m) => m.mission_date === missionDate.slice(0, 10),
  );

  if (!missions.length) {
    throw new Error("אין ימי משימה בתאריך זה");
  }

  missions.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const results: AutoAssignResult[] = [];
  const warnings: string[] = [];

  for (const m of missions) {
    const result = await autoAssignMission(m.id, {
      ...options,
      includeSameDay: true,
    });
    results.push(result);
    warnings.push(...result.warnings);
  }

  return { results, warnings };
}
