import { createClient } from "@/lib/supabase/server";
import { getFairnessRules } from "@/lib/fairness";
import { guardSlotDifficultyRank, calculatePersonBurden } from "@/lib/guard-burden";
import {
  assignBaseWorkShift,
  assignKitchenShift,
  assignStandbyRoom,
  buildTrackerFromMissions,
  findAssignmentConflicts,
  fitsPerson,
  forceFillEmptySeats,
  formatBaseWorkDiagnostics,
  pickBestCandidate,
  placePerson,
  repairGuardAssignmentGaps,
  slotRank,
  validateNoPersonOverlaps,
} from "@/lib/scheduling-engine";
import {
  flattenMissionSlots,
  isGuardKind,
  isStandbyKind,
  normalizeSchedulingRules,
  resolvePositionKind,
  syncAssignmentSeats,
} from "@/lib/mission-utils";
import { getMissionDay, listMissionDays, saveMissionDay } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import type { Issue, MissionDay, Person } from "@/lib/types";

export type AutoAssignResult = {
  mission: MissionDay;
  filled: number;
  skipped: number;
  warnings: string[];
};

async function loadPeople(): Promise<Person[]> {
  const supabase = await createClient();
  return fetchActivePeople(supabase);
}

async function finalizeAutoAssign(
  mission: MissionDay,
  assignments: Record<string, string[]>,
  warnings: string[],
  peopleByName: Record<string, Person>,
  filled: number,
  skipped: number,
  overlapScope: MissionDay[] = [],
): Promise<AutoAssignResult> {
  const draft: MissionDay = { ...mission, assignments };
  for (const msg of findAssignmentConflicts(draft, peopleByName)) {
    if (!warnings.includes(msg)) warnings.push(msg);
  }

  const scope = overlapScope.length
    ? overlapScope.map((m) => (m.id === mission.id ? draft : m))
    : [draft];
  for (const msg of validateNoPersonOverlaps(scope)) {
    if (!warnings.includes(msg)) warnings.push(`⚠ ${msg}`);
  }

  const saved = await saveMissionDay(
    { ...mission, assignments },
    { validateAssignments: false },
  );
  return { mission: saved, filled, skipped, warnings };
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

function autoAssignKitchenMission(
  mission: MissionDay,
  people: Person[],
  issues: Issue[],
  rules: Awaited<ReturnType<typeof getFairnessRules>>,
  tracker: ReturnType<typeof buildTrackerFromMissions>,
  scheduling: ReturnType<typeof normalizeSchedulingRules>,
  meanPrior: number,
  keepExisting: boolean,
): { assignments: Record<string, string[]>; filled: number; skipped: number; warnings: string[] } {
  const assignments = syncAssignmentSeats(mission.positions, { ...mission.assignments });
  const warnings: string[] = [];
  let filled = 0;
  let skipped = 0;

  const slots = flattenMissionSlots(mission).sort(
    (a, b) => (a.kitchenShiftIndex ?? 0) - (b.kitchenShiftIndex ?? 0),
  );

  for (const slot of slots) {
    const seats = assignments[slot.slotId] || [];
    const shiftIndex = slot.kitchenShiftIndex ?? 0;
    const restSquad =
      scheduling.kitchen?.squad_rest_by_shift?.[shiftIndex % 4] ?? shiftIndex + 1;

    if (keepExisting && seats.every(Boolean)) {
      const keptNames = seats.filter(Boolean);
      for (const name of keptNames) {
        placePerson(
          name,
          slot,
          mission.id,
          tracker,
          rules,
          scheduling,
          slot.seatCount,
          mission.mission_type,
        );
      }
      skipped += keptNames.length;
      continue;
    }

    const kept = keepExisting ? seats.filter(Boolean) : [];
    for (const name of kept) {
      placePerson(
        name,
        slot,
        mission.id,
        tracker,
        rules,
        scheduling,
        slot.seatCount,
        mission.mission_type,
      );
    }

    const need =
      (scheduling.kitchen?.seats_per_shift ?? slot.seatCount) - kept.length;
    if (need <= 0) {
      assignments[slot.slotId] = seats;
      continue;
    }

    const { names, usedRestSquad } = assignKitchenShift({
      people,
      slot,
      shiftIndex,
      need,
      taken: kept,
      tracker,
      issues,
      scheduling,
      rules,
      meanPrior,
      missionId: mission.id,
      missionType: mission.mission_type,
    });

    if (usedRestSquad) {
      warnings.push(
        `${slot.positionName} ${slot.timeLabel}: נוספו צוערים מצוות ${restSquad} (מנוחה) כדי להגיע ל-${scheduling.kitchen?.seats_per_shift ?? 35}`,
      );
    }

    let ni = 0;
    for (let i = 0; i < seats.length; i++) {
      if (keepExisting && seats[i]) continue;
      if (ni < names.length) {
        seats[i] = names[ni++];
        filled++;
      } else {
        seats[i] = "";
      }
    }

    if (names.length < need) {
      warnings.push(
        `${slot.positionName} ${slot.timeLabel}: חסרים ${need - names.length} מתוך ${need} (צוות ${restSquad} במנוחה)`,
      );
    }

    assignments[slot.slotId] = seats;
  }

  return { assignments, filled, skipped, warnings };
}

function autoAssignBaseWorkMission(
  mission: MissionDay,
  people: Person[],
  issues: Issue[],
  rules: Awaited<ReturnType<typeof getFairnessRules>>,
  tracker: ReturnType<typeof buildTrackerFromMissions>,
  scheduling: ReturnType<typeof normalizeSchedulingRules>,
  meanPrior: number,
  keepExisting: boolean,
): { assignments: Record<string, string[]>; filled: number; skipped: number; warnings: string[] } {
  const assignments = syncAssignmentSeats(mission.positions, { ...mission.assignments });
  const warnings: string[] = [];
  let filled = 0;
  let skipped = 0;

  const slots = flattenMissionSlots(mission).sort(
    (a, b) => (a.baseWorkShiftIndex ?? 0) - (b.baseWorkShiftIndex ?? 0),
  );

  for (const slot of slots) {
    const seats = assignments[slot.slotId] || [];
    const shiftIndex = slot.baseWorkShiftIndex ?? 0;
    const restSquad =
      scheduling.base_work?.squad_rest_by_shift?.[shiftIndex % 3] ?? shiftIndex + 1;

    if (keepExisting && seats.every(Boolean)) {
      const keptNames = seats.filter(Boolean);
      for (const name of keptNames) {
        placePerson(
          name,
          slot,
          mission.id,
          tracker,
          rules,
          scheduling,
          slot.seatCount,
          mission.mission_type,
        );
      }
      skipped += keptNames.length;
      continue;
    }

    const kept = keepExisting ? seats.filter(Boolean) : [];
    for (const name of kept) {
      placePerson(
        name,
        slot,
        mission.id,
        tracker,
        rules,
        scheduling,
        slot.seatCount,
        mission.mission_type,
      );
    }

    if (kept.length >= slot.seatCount) {
      assignments[slot.slotId] = seats;
      continue;
    }

    const { names, workSquad, usedFallback, diagnostics } = assignBaseWorkShift({
      people,
      slot,
      shiftIndex,
      taken: kept,
      tracker,
      issues,
      scheduling,
      rules,
      meanPrior,
      missionId: mission.id,
      missionType: mission.mission_type,
    });

    let ni = 0;
    for (let i = 0; i < seats.length; i++) {
      if (keepExisting && seats[i]) continue;
      if (ni < names.length) {
        seats[i] = names[ni++];
        filled++;
      } else {
        seats[i] = "";
      }
    }

    if (workSquad) {
      warnings.push(
        `${slot.timeLabel}: צוות ${workSquad} (${diagnostics.assigned} צוערים) · צ${restSquad} במנוחה`,
      );
    }
    if (usedFallback) {
      warnings.push(`${slot.timeLabel}: שיבוץ חלקי — לא נמצא צוות שלם פנוי`);
    }
    if (diagnostics.assigned < diagnostics.required) {
      warnings.push(formatBaseWorkDiagnostics(slot.timeLabel, diagnostics));
    }

    assignments[slot.slotId] = seats;
  }

  return { assignments, filled, skipped, warnings };
}

function sameDayMissionScope(
  mission: MissionDay,
  allMissions: MissionDay[],
): MissionDay[] {
  const date = mission.mission_date.slice(0, 10);
  return allMissions.filter((m) => m.mission_date.slice(0, 10) === date);
}

function missionHasAnyAssignment(mission: MissionDay): boolean {
  return Object.values(mission.assignments).some((seats) => seats.some(Boolean));
}

async function ensureLinkedBaseWorkAssigned(input: {
  guardsMission: MissionDay;
  allMissions: MissionDay[];
  people: Person[];
  issues: Issue[];
  rules: Awaited<ReturnType<typeof getFairnessRules>>;
  meanPrior: number;
  keepExisting: boolean;
}): Promise<{ allMissions: MissionDay[]; warnings: string[] }> {
  const warnings: string[] = [];
  const scheduling = normalizeSchedulingRules(input.guardsMission.scheduling_rules);
  const linkedId = scheduling.linked_mission_id;
  if (!linkedId) return { allMissions: input.allMissions, warnings };

  let linked = input.allMissions.find((m) => m.id === linkedId);
  if (!linked || linked.mission_type !== "base_work") {
    return { allMissions: input.allMissions, warnings };
  }
  if (missionHasAnyAssignment(linked)) {
    return { allMissions: input.allMissions, warnings };
  }

  const tracker = buildTrackerFromMissions(input.allMissions, input.rules, new Set([linked.id]));
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const result = autoAssignBaseWorkMission(
    linked,
    input.people,
    input.issues,
    input.rules,
    tracker,
    normalizeSchedulingRules(linked.scheduling_rules),
    input.meanPrior,
    input.keepExisting,
  );
  warnings.push(...result.warnings);
  const saved = await saveMissionDay(
    { ...linked, assignments: result.assignments },
    { validateAssignments: false },
  );
  const allMissions = input.allMissions.map((m) => (m.id === saved.id ? saved : m));
  return { allMissions, warnings };
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
  let scopedMissions = allMissions;
  let preWarnings: string[] = [];

  if (mission.mission_type === "guards") {
    const ensured = await ensureLinkedBaseWorkAssigned({
      guardsMission: mission,
      allMissions,
      people,
      issues,
      rules,
      meanPrior: people.reduce((sum, p) => sum + (p.prior_score || 0), 0) / (people.length || 1),
      keepExisting,
    });
    scopedMissions = ensured.allMissions;
    preWarnings = ensured.warnings;
  }

  const sameDayScope = sameDayMissionScope(mission, scopedMissions);

  const tracker = buildTrackerFromMissions(scopedMissions, rules, excludeIds);
  if (options.includeSameDay !== false) {
    const sameDayOthers = sameDayScope.filter((m) => m.id !== mission.id);
    for (const other of sameDayOthers) {
      const t2 = buildTrackerFromMissions([other], rules);
      for (const [name, blocks] of Object.entries(t2.busy)) {
        tracker.busy[name] = [...(tracker.busy[name] || []), ...blocks];
      }
      for (const [name, gs] of Object.entries(t2.guardShifts)) {
        tracker.guardShifts[name] = [...(tracker.guardShifts[name] || []), ...gs];
      }
    }
    for (const name of Object.keys(tracker.busy)) {
      tracker.periodPoints[name] = calculatePersonBurden(
        tracker.busy[name] || [],
        rules,
        scheduling,
      ).totalBurden;
    }
  }

  const meanPrior =
    people.reduce((sum, p) => sum + (p.prior_score || 0), 0) / (people.length || 1);

  if (mission.mission_type === "kitchen") {
    const result = autoAssignKitchenMission(
      mission,
      people,
      issues,
      rules,
      tracker,
      scheduling,
      meanPrior,
      keepExisting,
    );
    const forced = forceFillEmptySeats({
      mission,
      assignments: result.assignments,
      people,
      tracker,
      issues,
      scheduling,
      rules,
      meanPrior,
    });
    return finalizeAutoAssign(
      mission,
      forced.assignments,
      [...preWarnings, ...result.warnings, ...forced.warnings],
      peopleByName,
      result.filled + forced.filled,
      result.skipped,
      sameDayScope,
    );
  }

  if (mission.mission_type === "base_work") {
    const result = autoAssignBaseWorkMission(
      mission,
      people,
      issues,
      rules,
      tracker,
      scheduling,
      meanPrior,
      keepExisting,
    );
    const forced = forceFillEmptySeats({
      mission,
      assignments: result.assignments,
      people,
      tracker,
      issues,
      scheduling,
      rules,
      meanPrior,
    });
    return finalizeAutoAssign(
      mission,
      forced.assignments,
      [...preWarnings, ...result.warnings, ...forced.warnings],
      peopleByName,
      result.filled + forced.filled,
      result.skipped,
      sameDayScope,
    );
  }

  const guardMission = mission;
  const assignments = syncAssignmentSeats(guardMission.positions, { ...guardMission.assignments });
  const warnings: string[] = [];
  let filled = 0;
  let skipped = 0;

  const slots = flattenMissionSlots(guardMission).sort((a, b) => {
    const countEligible = (slot: (typeof a)) => {
      if (!isGuardKind(slot.positionKind)) return 10;
      return people.filter((p) =>
        fitsPerson(p, slot, tracker, issues, scheduling, [], peopleByName),
      ).length;
    };
    const rankA = isGuardKind(a.positionKind)
      ? guardSlotDifficultyRank(a, countEligible(a))
      : slotRank(a, rules);
    const rankB = isGuardKind(b.positionKind)
      ? guardSlotDifficultyRank(b, countEligible(b))
      : slotRank(b, rules);
    return rankB - rankA || b.durationMinutes - a.durationMinutes;
  });

  const standbyPositions = new Set(
    guardMission.positions
      .filter((p) => isStandbyKind(resolvePositionKind(guardMission.mission_type, p)))
      .map((p) => p.id),
  );

  for (const slot of slots) {
    const seats = assignments[slot.slotId] || [];
    const inSlot = new Set<string>();

    if (slot.sameRoom && standbyPositions.has(slot.positionId)) {
      const emptySeats = seats
        .map((name, i) => ({ name, i }))
        .filter(({ name }) => !name || (!keepExisting && name));
      const need = emptySeats.length;
      if (need === 0) {
        for (const name of seats.filter(Boolean)) {
          placePerson(
            name,
            slot,
            guardMission.id,
            tracker,
            rules,
            scheduling,
            slot.seatCount,
            guardMission.mission_type,
          );
          skipped++;
        }
        continue;
      }

      const kept = keepExisting ? seats.filter(Boolean) : [];
      for (const name of kept) {
        placePerson(
          name,
          slot,
          guardMission.id,
          tracker,
          rules,
          scheduling,
          slot.seatCount,
          guardMission.mission_type,
        );
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
        guardMission.id,
      );

      let ai = 0;
      for (let i = 0; i < seats.length; i++) {
        if (keepExisting && seats[i]) continue;
        if (ai < assigned.length) {
          seats[i] = assigned[ai++];
          filled++;
        } else {
          seats[i] = "";
          warnings.push(
            `${slot.positionName}: לא נמצא חדר שלם פנוי (${need} מקומות, אותו מין)`,
          );
        }
      }
      assignments[slot.slotId] = seats;
      continue;
    }

    for (let i = 0; i < slot.seatCount; i++) {
      const current = seats[i] || "";
      if (keepExisting && current) {
        placePerson(
          current,
          slot,
          guardMission.id,
          tracker,
          rules,
          scheduling,
          slot.seatCount,
          guardMission.mission_type,
        );
        skipped++;
        continue;
      }

      const mates = seats.filter((n, idx) => n && idx !== i);
      const candidates = people.filter(
        (p) =>
          !inSlot.has(p.name) &&
          fitsPerson(p, slot, tracker, issues, scheduling, mates, peopleByName),
      );

      const chosen = pickBestCandidate(
        candidates,
        slot,
        tracker,
        rules,
        meanPrior,
        { scheduling },
      );
      if (!chosen) {
        warnings.push(
          `${slot.positionName} ${slot.timeLabel} — משבצת ${i + 1}: לא נמצא צוער שעומד בכללים`,
        );
        seats[i] = "";
        continue;
      }

      seats[i] = chosen.name;
      inSlot.add(chosen.name);
      placePerson(
        chosen.name,
        slot,
        guardMission.id,
        tracker,
        rules,
        scheduling,
        slot.seatCount,
        guardMission.mission_type,
      );
      filled++;
    }

    assignments[slot.slotId] = seats;
  }

  const repaired = repairGuardAssignmentGaps({
    mission: guardMission,
    assignments,
    people,
    tracker,
    issues,
    scheduling,
    rules,
    meanPrior,
  });
  if (repaired.filled > 0) {
    filled += repaired.filled;
    Object.assign(assignments, repaired.assignments);
  }

  const forced = forceFillEmptySeats({
    mission: guardMission,
    assignments,
    people,
    tracker,
    issues,
    scheduling,
    rules,
    meanPrior,
  });
  filled += forced.filled;
  warnings.push(...forced.warnings);
  Object.assign(assignments, forced.assignments);

  return finalizeAutoAssign(
    guardMission,
    assignments,
    [...preWarnings, ...warnings],
    peopleByName,
    filled,
    skipped,
    sameDayScope,
  );
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

  const typeOrder: Record<string, number> = {
    kitchen: 0,
    base_work: 1,
    guards: 2,
  };
  missions.sort(
    (a, b) =>
      (typeOrder[a.mission_type] ?? 9) - (typeOrder[b.mission_type] ?? 9) ||
      a.starts_at.localeCompare(b.starts_at),
  );

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
