import { createClient } from "@/lib/supabase/server";
import { flattenMissionSlots, normalizeSchedulingRules } from "@/lib/mission-utils";
import { listMissionDays } from "@/lib/missions";
import type {
  FairnessBucket,
  FairnessRules,
  FairnessRuleRequest,
  MissionPositionKind,
  MissionType,
  PersonFairnessStats,
  PersonMissionHistoryItem,
} from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";
import { isStandbyKind } from "@/lib/mission-utils";

function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

export function slotDurationHours(start: string, end: string): number {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s === null || e === null) return 0;
  let dur = e - s;
  if (dur <= 0) dur += 1440;
  return Math.round((dur / 60) * 100) / 100;
}

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

export function pointsForHours(
  hours: number,
  bucket: FairnessBucket,
  rules: FairnessRules,
  options?: { perShift?: boolean },
) {
  if (options?.perShift) {
    return Math.round(rules[bucket] * 100) / 100;
  }
  return Math.round(hours * rules[bucket] * 100) / 100;
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

  const history: PersonMissionHistoryItem[] = [];

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

  const periodPoints =
    Math.round(history.reduce((sum, h) => sum + h.points, 0) * 100) / 100;
  const totalPoints = Math.round((priorScore + periodPoints) * 100) / 100;

  return {
    rules,
    priorScore,
    periodPoints,
    totalPoints,
    history,
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
