import { createClient } from "@/lib/supabase/server";
import {
  calculatePersonBurden,
  type BurdenTimelineBlock,
  type PersonBurdenBreakdown,
} from "@/lib/guard-burden";
import { flattenMissionSlots, isGuardKind, normalizeSchedulingRules } from "@/lib/mission-utils";
import { listMissionDays } from "@/lib/missions";
import type {
  FairnessBucket,
  FairnessRules,
  FairnessRuleRequest,
  MissionDay,
  MissionPositionKind,
  MissionType,
  PersonFairnessStats,
  PersonMissionHistoryItem,
} from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";
import { isStandbyKind } from "@/lib/mission-utils";

import { slotDurationHours, pointsForHours } from "@/lib/fairness-math";

export function bucketForAssignment(
  missionType: MissionType,
  seatCount: number,
  positionKind?: MissionPositionKind,
): FairnessBucket {
  if (positionKind === "standby_carmel_a") return "standby_a";
  if (positionKind === "standby_carmel_b") return "standby_b";
  if (positionKind && isStandbyKind(positionKind)) return "standby";
  if (positionKind === "kitchen") return "kitchen";
  if (positionKind === "duty") return "duty";
  if (missionType === "kitchen") return "kitchen";
  if (missionType === "base_work") return "duty";
  return seatCount <= 1 ? "solo" : "pair";
}

export function normalizeFairnessRules(raw: unknown): FairnessRules {
  const src = (raw || {}) as Partial<FairnessRules>;
  const out = { ...DEFAULT_FAIRNESS_RULES };
  for (const key of Object.keys(DEFAULT_FAIRNESS_RULES) as (keyof FairnessRules)[]) {
    const v = parseFloat(String(src[key]));
    if (!Number.isNaN(v) && v >= 0) out[key] = v;
  }
  return out;
}

export { slotDurationHours, pointsForHours } from "@/lib/fairness-math";

function collectPersonBlocks(
  personName: string,
  missions: MissionDay[],
): BurdenTimelineBlock[] {
  const blocks: BurdenTimelineBlock[] = [];
  for (const mission of missions) {
    for (const slot of flattenMissionSlots(mission)) {
      if (!slot.assignees.includes(personName)) continue;
      blocks.push({
        wallStartMin: slot.wallStartMin,
        calendarDayOffset: slot.calendarDayOffset,
        durationMinutes: slot.durationMinutes,
        eatsRest:
          slot.positionKind !== "standby_carmel_a" &&
          slot.positionKind !== "standby_carmel_b",
        positionKind: slot.positionKind,
        missionType: mission.mission_type,
        seatCount: slot.seatCount,
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotId: slot.slotId,
      });
    }
  }
  return blocks;
}

export function computePersonBurdenFromMissions(
  personName: string,
  missions: MissionDay[],
  rules: FairnessRules,
): PersonBurdenBreakdown {
  const blocks = collectPersonBlocks(personName, missions);
  const scheduling = missions[0]
    ? normalizeSchedulingRules(missions[0].scheduling_rules)
    : undefined;
  return calculatePersonBurden(blocks, rules, scheduling);
}

export type RosterBurdenEntry = PersonBurdenBreakdown & {
  personName: string;
  priorScore: number;
  historicalAdjustment: number;
  totalWithHistory: number;
};

export function computeRosterBurdenSummary(
  people: { name: string; prior_score?: number }[],
  missions: MissionDay[],
  rules: FairnessRules,
): RosterBurdenEntry[] {
  const meanPrior =
    people.reduce((s, p) => s + (p.prior_score || 0), 0) / (people.length || 1);
  return people.map((p) => {
    const breakdown = computePersonBurdenFromMissions(p.name, missions, rules);
    const historicalAdjustment = Math.round(
      ((p.prior_score || 0) - meanPrior) * rules.hist * 100,
    ) / 100;
    return {
      personName: p.name,
      priorScore: p.prior_score || 0,
      historicalAdjustment,
      totalWithHistory: Math.round((breakdown.totalBurden + historicalAdjustment) * 100) / 100,
      ...breakdown,
    };
  });
}

export async function getFairnessRules(): Promise<FairnessRules> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_rules")
    .select("rules")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    if (error?.code === "PGRST205" || error?.message?.includes("fairness_rules")) {
      return DEFAULT_FAIRNESS_RULES;
    }
    return DEFAULT_FAIRNESS_RULES;
  }
  return normalizeFairnessRules(data.rules);
}

export async function saveFairnessRules(rules: FairnessRules): Promise<FairnessRules> {
  const supabase = await createClient();
  const normalized = normalizeFairnessRules(rules);
  const { error } = await supabase
    .from("fairness_rules")
    .upsert({ id: 1, rules: normalized, updated_at: new Date().toISOString() });

  if (error) throw new Error(error.message);
  return normalized;
}

export async function getPersonFairnessStats(
  personName: string,
  priorScore = 0,
): Promise<PersonFairnessStats> {
  const [rules, missions] = await Promise.all([
    getFairnessRules(),
    listMissionDays(true),
  ]);

  const blocks = collectPersonBlocks(personName, missions);
  const breakdown = calculatePersonBurden(blocks, rules);
  const history: PersonMissionHistoryItem[] = [];
  const guardDetailBySlot = new Map(
    breakdown.guardDetails.map((d) => [d.slotId || "", d]),
  );

  for (const mission of missions) {
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    for (const slot of flattenMissionSlots(mission)) {
      if (!slot.assignees.includes(personName)) continue;
      const hours = slotDurationHours(slot.startTime, slot.endTime);
      const bucket = bucketForAssignment(
        mission.mission_type,
        slot.seatCount,
        slot.positionKind,
      );

      if (isGuardKind(slot.positionKind)) {
        const detail = guardDetailBySlot.get(slot.slotId);
        history.push({
          id: `${mission.id}:${slot.slotId}:${personName}`,
          missionId: mission.id,
          missionTitle: mission.title,
          missionDate: mission.mission_date,
          missionType: mission.mission_type,
          positionName: slot.positionName,
          timeLabel: slot.timeLabel,
          hours,
          bucket,
          points: detail?.totalContribution ?? 0,
          burdenBase: detail?.baseBurden,
          burdenRest: detail?.restPenaltyBefore,
          burdenIsSolo: detail?.isSolo,
        });
        continue;
      }

      const kitchenPerShift =
        mission.mission_type === "kitchen" &&
        scheduling.kitchen?.points_per_shift !== false;
      const points = pointsForHours(hours, bucket, rules, {
        perShift: kitchenPerShift,
      });
      history.push({
        id: `${mission.id}:${slot.slotId}:${personName}`,
        missionId: mission.id,
        missionTitle: mission.title,
        missionDate: mission.mission_date,
        missionType: mission.mission_type,
        positionName: slot.positionName,
        timeLabel: slot.timeLabel,
        hours,
        bucket,
        points,
      });
    }
  }

  history.sort(
    (a, b) =>
      b.missionDate.localeCompare(a.missionDate) || b.timeLabel.localeCompare(a.timeLabel),
  );

  const periodPoints = breakdown.totalBurden;
  const totalPoints = Math.round((priorScore + periodPoints) * 100) / 100;

  return {
    rules,
    priorScore,
    periodPoints,
    totalPoints,
    history,
    burden: breakdown,
  };
}

export async function listFairnessRequests(
  status?: string,
): Promise<FairnessRuleRequest[]> {
  const supabase = await createClient();
  let query = supabase
    .from("fairness_rule_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST205") return [];
    throw new Error(error.message);
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    person_id: row.person_id ? String(row.person_id) : null,
    person_name: String(row.person_name),
    proposed_rules: normalizeFairnessRules(row.proposed_rules),
    note: String(row.note),
    status: row.status as FairnessRuleRequest["status"],
    created_at: String(row.created_at),
  }));
}

export async function createFairnessRequest(input: {
  personId: string;
  personName: string;
  proposedRules: FairnessRules;
  note: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_rule_requests")
    .insert({
      person_id: input.personId,
      person_name: input.personName,
      proposed_rules: normalizeFairnessRules(input.proposedRules),
      note: input.note.trim(),
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function resolveFairnessRequest(
  id: string,
  status: "approved" | "rejected",
) {
  const supabase = await createClient();

  const { data: req, error: fetchErr } = await supabase
    .from("fairness_rule_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !req) throw new Error("בקשה לא נמצאה");

  const { data: updated, error: updateErr } = await supabase
    .from("fairness_rule_requests")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (updateErr) throw new Error(updateErr.message);

  if (status === "approved") {
    await saveFairnessRules(normalizeFairnessRules(req.proposed_rules));
  }

  return updated;
}
