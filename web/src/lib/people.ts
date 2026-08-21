import type { SupabaseClient } from "@supabase/supabase-js";
import type { Person } from "@/lib/types";

/** Columns always present after initial schema.sql */
export const PEOPLE_BASE_SELECT =
  "id,name,email,room,gender,squad,active,created_at" as const;

export const PEOPLE_FLAG_SELECT =
  "no_guard,no_standby,no_standing,no_base_work,no_kitchen,prior_score" as const;

export type SchedulerPersonPayload = {
  id: string;
  name: string;
  on?: boolean;
  room?: string;
  gender?: string;
  squad?: number;
  noGuard?: boolean;
  noStandby?: boolean;
  noStanding?: boolean;
  noBaseWork?: boolean;
  noKitchen?: boolean;
  prior?: number;
};

export function dbPersonToScheduler(
  p: Record<string, unknown>,
): SchedulerPersonPayload {
  return {
    id: String(p.id),
    name: String(p.name),
    on: p.active !== false,
    room: p.room ? String(p.room) : undefined,
    gender: p.gender ? String(p.gender) : undefined,
    squad: p.squad != null ? Number(p.squad) : undefined,
    noGuard: p.no_guard != null ? !!p.no_guard : undefined,
    noStandby: p.no_standby != null ? !!p.no_standby : undefined,
    noStanding: p.no_standing != null ? !!p.no_standing : undefined,
    noBaseWork: p.no_base_work != null ? !!p.no_base_work : undefined,
    noKitchen: p.no_kitchen != null ? !!p.no_kitchen : undefined,
    prior: p.prior_score != null ? Number(p.prior_score) : undefined,
  };
}

export function schedulerPersonToDb(
  p: SchedulerPersonPayload,
  withFlags: boolean,
) {
  const row: Record<string, unknown> = {
    name: p.name.trim(),
    room: p.room || null,
    gender: p.gender === "m" || p.gender === "f" ? p.gender : null,
    squad:
      p.squad != null && p.squad >= 1 && p.squad <= 4 ? Math.round(p.squad) : null,
    active: p.on !== false,
  };
  if (withFlags) {
    row.no_guard = !!p.noGuard;
    row.no_standby = !!p.noStandby;
    row.no_standing = !!p.noStanding;
    row.no_base_work = !!p.noBaseWork;
    row.no_kitchen = !!p.noKitchen;
    row.prior_score = Number(p.prior ?? 0);
  }
  return row;
}

export function roomsFromPeople(people: SchedulerPersonPayload[]) {
  const rooms: Record<
    string,
    { name: string; members: string[]; gender: string }
  > = {};
  for (const p of people) {
    if (!p.room) continue;
    if (!rooms[p.room]) {
      rooms[p.room] = { name: p.room, members: [], gender: p.gender || "" };
    }
    rooms[p.room].members.push(p.name);
    if (p.gender && !rooms[p.room].gender) {
      rooms[p.room].gender = p.gender;
    }
  }
  return Object.values(rooms);
}

export async function probePeopleFlags(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase.from("people").select("no_standby").limit(1);
  return !error;
}

export async function probePeopleEmail(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase.from("people").select("email").limit(1);
  return !error;
}

export async function probePeopleSquad(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase.from("people").select("squad").limit(1);
  return !error;
}

export async function probePeopleAdmin(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase.from("people").select("is_admin").limit(1);
  return !error;
}

export async function probePeopleOfficer(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase.from("people").select("is_officer").limit(1);
  return !error;
}

export async function fetchActivePeople(
  supabase: SupabaseClient,
): Promise<Person[]> {
  const [withFlags, withSquad, withAdmin, withOfficer] = await Promise.all([
    probePeopleFlags(supabase),
    probePeopleSquad(supabase),
    probePeopleAdmin(supabase),
    probePeopleOfficer(supabase),
  ]);
  const cols = ["id", "name", "email", "room", "gender", "active", "created_at"];
  if (withSquad) cols.splice(5, 0, "squad");
  if (withFlags) cols.push(...PEOPLE_FLAG_SELECT.split(","));
  if (withAdmin) cols.push("is_admin");
  if (withOfficer) cols.push("is_officer");

  const { data, error } = await supabase
    .from("people")
    .select(cols.join(","))
    .eq("active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return (data || []) as unknown as Person[];
}

export function peopleToSchedulerList(
  rows: Record<string, unknown>[],
): SchedulerPersonPayload[] {
  return rows.map(dbPersonToScheduler);
}
