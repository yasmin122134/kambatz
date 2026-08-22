import { createClient } from "@/lib/supabase/server";
import type { PersonBurdenBreakdown } from "@/lib/guard-burden";
import { calculatePersonBurden } from "@/lib/guard-burden";
import { normalizeSchedulingRules } from "@/lib/mission-utils";
import {
  buildPersonFairnessStatsFromMissions,
  bucketForAssignment,
  collectPersonBlocks,
  normalizeFairnessRulesFromRaw,
  statsFromStoredHistory,
} from "@/lib/fairness-stats";
import {
  hasStoredFairnessPoints,
  listStoredFairnessPointsForPerson,
  syncPublishedFairnessPoints,
} from "@/lib/fairness-persistence";
import { listMissionDays } from "@/lib/missions";
import type {
  FairnessRules,
  FairnessRuleRequest,
  MissionDay,
  PersonFairnessStats,
} from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";

export {
  bucketForAssignment,
  buildPersonFairnessStatsFromMissions,
  collectAssigneeNames,
  collectPersonBlocks,
  buildPersonFairnessHistory,
  statsFromStoredHistory,
  normalizeFairnessRulesFromRaw,
} from "@/lib/fairness-stats";
export { slotDurationHours, pointsForHours } from "@/lib/fairness-math";

export function normalizeFairnessRules(raw: unknown): FairnessRules {
  return normalizeFairnessRulesFromRaw(raw);
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

  const hasAssignments = missions.some((m) =>
    Object.values(m.assignments || {}).some((seats) => seats.some(Boolean)),
  );

  if (hasAssignments && !(await hasStoredFairnessPoints())) {
    try {
      await syncPublishedFairnessPoints();
    } catch {
      return buildPersonFairnessStatsFromMissions(
        personName,
        missions,
        rules,
        priorScore,
      );
    }
  }

  const storedHistory = await listStoredFairnessPointsForPerson(personName);
  if (storedHistory.length > 0 || (hasAssignments && (await hasStoredFairnessPoints()))) {
    return statsFromStoredHistory(storedHistory, rules, priorScore);
  }

  return buildPersonFairnessStatsFromMissions(personName, missions, rules, priorScore);
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

export { syncPublishedFairnessPoints, deleteFairnessPointsForMission } from "@/lib/fairness-persistence";
