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
    slotId: row.slot_id,
    pointsManual: row.manual_override === true,
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

async function loadManualFairnessOverrides(): Promise<StoredFairnessPointRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_assignment_points")
    .select("*")
    .eq("manual_override", true);

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("manual_override")) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data || []) as StoredFairnessPointRow[];
}

function manualOverrideKey(row: Pick<StoredFairnessPointRow, "mission_id" | "slot_id" | "person_name">) {
  return `${row.mission_id}:${row.slot_id}:${row.person_name}`;
}

/** Recompute and persist fairness points for all published missions. */
export async function syncPublishedFairnessPoints(): Promise<void> {
  const supabase = await createClient();
  const [rules, missions, manualRows] = await Promise.all([
    loadFairnessRules(),
    listMissionDays(true),
    loadManualFairnessOverrides(),
  ]);

  const manualByKey = new Map(manualRows.map((row) => [manualOverrideKey(row), row]));
  const assignees = collectAssigneeNames(missions);
  const rows: Omit<StoredFairnessPointRow, "computed_at">[] = [];

  for (const personName of assignees) {
    const stats = buildPersonFairnessStatsFromMissions(personName, missions, rules, 0);
    for (const item of stats.history) {
      const base = historyToRow(item, personName);
      const manual = manualByKey.get(manualOverrideKey(base));
      if (manual) {
        rows.push({
          ...base,
          points: Number(manual.points) || 0,
          manual_override: true,
        });
        manualByKey.delete(manualOverrideKey(base));
      } else {
        rows.push(base);
      }
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
    rows.map((row) => ({
      ...row,
      manual_override: row.manual_override === true,
      computed_at: computedAt,
    })),
  );

  if (insertErr) {
    if (insertErr.code === "PGRST205") return;
    throw new Error(insertErr.message);
  }
}

/** Admin: set or clear manual points override for one assignment row. */
export async function setManualFairnessPoints(input: {
  personName: string;
  missionId: string;
  slotId: string;
  points: number;
}): Promise<void> {
  const supabase = await createClient();
  const points = Math.round(input.points * 100) / 100;

  const { data: existing, error: fetchErr } = await supabase
    .from("fairness_assignment_points")
    .select("*")
    .eq("mission_id", input.missionId)
    .eq("slot_id", input.slotId)
    .eq("person_name", input.personName)
    .maybeSingle();

  if (fetchErr && fetchErr.code !== "PGRST205") {
    throw new Error(fetchErr.message);
  }

  if (!existing) {
    throw new Error("שורת נקודות לא נמצאה — שמרו את המשימה או המתינו לסנכרון");
  }

  const { error: updateErr } = await supabase
    .from("fairness_assignment_points")
    .update({
      points,
      manual_override: true,
      computed_at: new Date().toISOString(),
    })
    .eq("mission_id", input.missionId)
    .eq("slot_id", input.slotId)
    .eq("person_name", input.personName);

  if (updateErr) {
    if (updateErr.message.includes("manual_override")) {
      throw new Error("הריצו supabase/migration_fairness_manual_points.sql");
    }
    throw new Error(updateErr.message);
  }
}

/** Admin: revert row to auto-computed points on next sync. */
export async function clearManualFairnessPoints(input: {
  personName: string;
  missionId: string;
  slotId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("fairness_assignment_points")
    .update({ manual_override: false })
    .eq("mission_id", input.missionId)
    .eq("slot_id", input.slotId)
    .eq("person_name", input.personName);

  if (error && error.code !== "PGRST205") {
    if (error.message.includes("manual_override")) {
      throw new Error("הריצו supabase/migration_fairness_manual_points.sql");
    }
    throw new Error(error.message);
  }

  await syncPublishedFairnessPoints();
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
