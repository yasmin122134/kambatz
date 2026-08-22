import { createClient } from "@/lib/supabase/server";
import {
  buildPersonFairnessStatsFromMissions,
  collectAssigneeNames,
  normalizeFairnessRulesFromRaw,
  statsFromStoredHistory,
  type StoredFairnessPointRow,
} from "@/lib/fairness-stats";
import { listMissionDays } from "@/lib/missions";
import type { PersonMissionHistoryItem } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";
import type { FairnessRules } from "@/lib/types";

async function loadFairnessRules(): Promise<FairnessRules> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_rules")
    .select("rules")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return DEFAULT_FAIRNESS_RULES;
  }
  return normalizeFairnessRulesFromRaw(data.rules);
}

function rowToHistoryItem(row: StoredFairnessPointRow): PersonMissionHistoryItem {
  return {
    id: `${row.mission_id}:${row.slot_id}:${row.person_name}`,
    missionId: row.mission_id,
    missionTitle: row.mission_title,
    missionDate: row.mission_date,
    missionType: row.mission_type as PersonMissionHistoryItem["missionType"],
    positionName: row.position_name,
    timeLabel: row.time_label,
    hours: Number(row.hours) || 0,
    bucket: row.bucket as PersonMissionHistoryItem["bucket"],
    points: Number(row.points) || 0,
    burdenBase: row.burden_base != null ? Number(row.burden_base) : undefined,
    burdenRest: row.burden_rest != null ? Number(row.burden_rest) : undefined,
    burdenIsSolo: row.burden_is_solo ?? undefined,
  };
}

function historyToRow(
  item: PersonMissionHistoryItem,
  personName: string,
): Omit<StoredFairnessPointRow, "computed_at"> {
  const slotId = item.id.split(":")[1] || item.missionId;
  return {
    person_name: personName,
    mission_id: item.missionId,
    slot_id: slotId,
    mission_date: item.missionDate,
    mission_title: item.missionTitle,
    mission_type: item.missionType,
    position_name: item.positionName,
    time_label: item.timeLabel,
    hours: item.hours,
    bucket: item.bucket,
    points: item.points,
    burden_base: item.burdenBase ?? null,
    burden_rest: item.burdenRest ?? null,
    burden_is_solo: item.burdenIsSolo ?? null,
  };
}

export async function listStoredFairnessPointsForPerson(
  personName: string,
): Promise<PersonMissionHistoryItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_assignment_points")
    .select("*")
    .eq("person_name", personName)
    .order("mission_date", { ascending: false })
    .order("time_label", { ascending: false });

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("fairness_assignment_points")) {
      return [];
    }
    throw new Error(error.message);
  }

  return (data || []).map((row) =>
    rowToHistoryItem(row as StoredFairnessPointRow),
  );
}

export async function hasStoredFairnessPoints(): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("fairness_assignment_points")
    .select("id", { count: "exact", head: true })
    .limit(1);

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("fairness_assignment_points")) {
      return false;
    }
    throw new Error(error.message);
  }
  return (count || 0) > 0;
}

/** Recompute and persist fairness points for all published missions. */
export async function syncPublishedFairnessPoints(): Promise<void> {
  const supabase = await createClient();
  const [rules, missions] = await Promise.all([
    loadFairnessRules(),
    listMissionDays(true),
  ]);

  const assignees = collectAssigneeNames(missions);
  const rows: Omit<StoredFairnessPointRow, "computed_at">[] = [];

  for (const personName of assignees) {
    const stats = buildPersonFairnessStatsFromMissions(personName, missions, rules, 0);
    for (const item of stats.history) {
      rows.push(historyToRow(item, personName));
    }
  }

  const missionIds = missions.map((m) => m.id);
  if (missionIds.length) {
    const { error: deleteErr } = await supabase
      .from("fairness_assignment_points")
      .delete()
      .in("mission_id", missionIds);
    if (deleteErr && deleteErr.code !== "PGRST205") {
      throw new Error(deleteErr.message);
    }
  } else {
    const { error: deleteAllErr } = await supabase
      .from("fairness_assignment_points")
      .delete()
      .not("person_name", "is", null);
    if (deleteAllErr && deleteAllErr.code !== "PGRST205") {
      throw new Error(deleteAllErr.message);
    }
    return;
  }

  if (!rows.length) return;

  const computedAt = new Date().toISOString();
  const { error: insertErr } = await supabase.from("fairness_assignment_points").insert(
    rows.map((row) => ({ ...row, computed_at: computedAt })),
  );

  if (insertErr) {
    if (insertErr.code === "PGRST205") return;
    throw new Error(insertErr.message);
  }
}

export async function deleteFairnessPointsForMission(missionId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("fairness_assignment_points")
    .delete()
    .eq("mission_id", missionId);

  if (error && error.code !== "PGRST205") {
    throw new Error(error.message);
  }
}
