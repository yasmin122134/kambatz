import { createClient } from "@/lib/supabase/server";
import {
  buildPersonFairnessStatsFromMissions,
  collectAssigneeNames,
  normalizeFairnessRulesFromRaw,
  statsFromStoredHistory,
  type StoredFairnessPointRow,
} from "@/lib/fairness-stats";
import { listVisibleMissionDays } from "@/lib/missions";
import type { PersonMissionHistoryItem } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES } from "@/lib/types";
import type { FairnessRules } from "@/lib/types";

/** Bump when guard/fairness row computation logic changes (forces DB resync). */
export const FAIRNESS_COMPUTE_VERSION = 3;

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

async function loadRawFairnessRulesRecord(): Promise<{
  rules: FairnessRules;
  raw: Record<string, unknown>;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_rules")
    .select("rules")
    .eq("id", 1)
    .maybeSingle();

  const raw =
    data?.rules && typeof data.rules === "object"
      ? ({ ...(data.rules as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  if (error || !data) {
    return { rules: DEFAULT_FAIRNESS_RULES, raw };
  }
  return { rules: normalizeFairnessRulesFromRaw(data.rules), raw };
}

function storedComputeVersion(raw: Record<string, unknown>): number {
  const v = raw._fairness_compute_version;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

async function markFairnessComputeVersion(): Promise<void> {
  const supabase = await createClient();
  const { raw } = await loadRawFairnessRulesRecord();
  if (storedComputeVersion(raw) === FAIRNESS_COMPUTE_VERSION) return;

  const { error } = await supabase
    .from("fairness_rules")
    .update({
      rules: { ...raw, _fairness_compute_version: FAIRNESS_COMPUTE_VERSION },
    })
    .eq("id", 1);

  if (error && error.code !== "PGRST205") {
    throw new Error(error.message);
  }
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
  const slotId = item.slotId || item.id.split(":")[1] || item.missionId;
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

async function latestFairnessComputedAt(): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_assignment_points")
    .select("computed_at")
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.computed_at) return null;
  const ts = Date.parse(String(data.computed_at));
  return Number.isNaN(ts) ? null : ts;
}

/** True when published missions, assignments, or fairness rules changed since last sync. */
export async function needsFairnessResync(): Promise<boolean> {
  const supabase = await createClient();
  const [missions, lastComputed, rulesRes, rulesRecord] = await Promise.all([
    listVisibleMissionDays(),
    latestFairnessComputedAt(),
    supabase.from("fairness_rules").select("updated_at").eq("id", 1).maybeSingle(),
    loadRawFairnessRulesRecord(),
  ]);

  if (storedComputeVersion(rulesRecord.raw) !== FAIRNESS_COMPUTE_VERSION) {
    return true;
  }

  const hasAssignments = missions.some((m) =>
    Object.values(m.assignments || {}).some((seats) => seats.some(Boolean)),
  );
  if (!hasAssignments) return false;
  if (lastComputed == null) return true;

  for (const mission of missions) {
    const updated = Date.parse(mission.updated_at);
    if (!Number.isNaN(updated) && updated > lastComputed) return true;
  }

  const rulesUpdated = rulesRes.data?.updated_at
    ? Date.parse(String(rulesRes.data.updated_at))
    : NaN;
  if (!Number.isNaN(rulesUpdated) && rulesUpdated > lastComputed) return true;

  return false;
}

/** Sync published mission points when cache is empty or stale. */
export async function ensurePublishedFairnessSynced(): Promise<void> {
  if (!(await needsFairnessResync())) return;
  try {
    await syncPublishedFairnessPoints();
  } catch {
    /* table may be missing in dev */
  }
}

export async function listStoredFairnessGroupedByPerson(): Promise<
  Map<string, PersonMissionHistoryItem[]>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fairness_assignment_points")
    .select("*")
    .order("mission_date", { ascending: false })
    .order("time_label", { ascending: false });

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("fairness_assignment_points")) {
      return new Map();
    }
    throw new Error(error.message);
  }

  const grouped = new Map<string, PersonMissionHistoryItem[]>();
  for (const row of data || []) {
    const item = rowToHistoryItem(row as StoredFairnessPointRow);
    const list = grouped.get(row.person_name) || [];
    list.push(item);
    grouped.set(String(row.person_name), list);
  }
  return grouped;
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

export function applyManualFairnessOverrides(
  personName: string,
  history: PersonMissionHistoryItem[],
  manualRows: StoredFairnessPointRow[],
): PersonMissionHistoryItem[] {
  const manualByKey = new Map(
    manualRows.map((row) => [manualOverrideKey(row), row]),
  );
  return history.map((item) => {
    const slotId = item.slotId ?? item.id.split(":")[1] ?? item.missionId;
    const key = `${item.missionId}:${slotId}:${personName}`;
    const manual = manualByKey.get(key);
    if (!manual) return item;
    return {
      ...item,
      points: Number(manual.points) || 0,
      pointsManual: true,
    };
  });
}

/** Manual point overrides — safe when table/column missing. */
export async function loadManualFairnessOverridesForSync(): Promise<StoredFairnessPointRow[]> {
  try {
    return await loadManualFairnessOverrides();
  } catch {
    return [];
  }
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
    listVisibleMissionDays(),
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

  await markFairnessComputeVersion();
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
