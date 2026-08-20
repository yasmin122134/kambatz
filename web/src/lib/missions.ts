import { createClient } from "@/lib/supabase/server";
import type { MissionDay } from "@/lib/types";
import {
  defaultGuardDayPositions,
  emptyAssignments,
  newPosition,
  normalizeSchedulingRules,
  syncAssignmentSeats,
  upcomingFromMissions,
} from "@/lib/mission-utils";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

export {
  flattenMissionSlots,
  newPosition,
  newSlot,
  emptyAssignments,
  syncAssignmentSeats,
  upcomingFromMissions,
  defaultGuardDayPositions,
  normalizeSchedulingRules,
} from "@/lib/mission-utils";
export type { FlatSlot, UpcomingMissionItem } from "@/lib/mission-utils";

function rowFromDb(row: Record<string, unknown>): MissionDay {
  return {
    id: String(row.id),
    title: String(row.title),
    mission_type: row.mission_type as MissionDay["mission_type"],
    mission_date: String(row.mission_date).slice(0, 10),
    starts_at: String(row.starts_at),
    ends_at: String(row.ends_at),
    status: row.status as MissionDay["status"],
    positions: (row.positions as MissionDay["positions"]) || [],
    assignments: (row.assignments as Record<string, string[]>) || {},
    scheduling_rules: normalizeSchedulingRules(row.scheduling_rules),
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listMissionDays(publishedOnly = false): Promise<MissionDay[]> {
  const supabase = await createClient();
  let query = supabase
    .from("mission_days")
    .select("*")
    .order("mission_date", { ascending: true })
    .order("starts_at", { ascending: true });

  if (publishedOnly) {
    query = query.eq("status", "published");
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST205" || error.message.includes("mission_days")) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data || []).map(rowFromDb);
}

export async function getMissionDay(id: string): Promise<MissionDay | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mission_days")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("mission_days")) {
      return null;
    }
    throw new Error(error.message);
  }
  return data ? rowFromDb(data) : null;
}

export async function getUpcomingForPersonFromMissions(personName: string) {
  const missions = await listMissionDays(true);
  return upcomingFromMissions(missions, personName);
}

export async function saveMissionDay(
  payload: Omit<MissionDay, "id" | "created_at" | "updated_at"> & { id?: string },
): Promise<MissionDay> {
  const supabase = await createClient();
  const positions = payload.positions || [];
  const assignments = syncAssignmentSeats(positions, payload.assignments || {});

  const row = {
    title: payload.title.trim(),
    mission_type: payload.mission_type,
    mission_date: payload.mission_date,
    starts_at: payload.starts_at,
    ends_at: payload.ends_at,
    status: payload.status,
    positions,
    assignments,
    scheduling_rules: normalizeSchedulingRules(
      payload.scheduling_rules ?? DEFAULT_MISSION_SCHEDULING_RULES,
    ),
    notes: payload.notes || null,
    updated_at: new Date().toISOString(),
  };

  if (payload.id) {
    const { data, error } = await supabase
      .from("mission_days")
      .update(row)
      .eq("id", payload.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowFromDb(data);
  }

  const { data, error } = await supabase
    .from("mission_days")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return rowFromDb(data);
}

export async function deleteMissionDay(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("mission_days").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export { newPosition as createDefaultPosition };
