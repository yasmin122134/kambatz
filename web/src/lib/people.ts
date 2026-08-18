import type { SupabaseClient } from "@supabase/supabase-js";

/** Columns always present after initial schema.sql */
export const PEOPLE_BASE_SELECT =
  "id,name,email,room,gender,active,created_at" as const;

export const PEOPLE_FLAG_SELECT =
  "km,exam,no_weapon,no_guard,no_mag,prior_score" as const;

export type SchedulerPersonPayload = {
  id: string;
  name: string;
  on?: boolean;
  room?: string;
  gender?: string;
  km?: boolean;
  exam?: boolean;
  noWeapon?: boolean;
  noGuard?: boolean;
  noMag?: boolean;
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
    km: p.km != null ? !!p.km : undefined,
    exam: p.exam != null ? !!p.exam : undefined,
    noWeapon: p.no_weapon != null ? !!p.no_weapon : undefined,
    noGuard: p.no_guard != null ? !!p.no_guard : undefined,
    noMag: p.no_mag != null ? !!p.no_mag : undefined,
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
    active: p.on !== false,
  };
  if (withFlags) {
    row.km = !!p.km;
    row.exam = !!p.exam;
    row.no_weapon = !!p.noWeapon;
    row.no_guard = !!p.noGuard;
    row.no_mag = !!p.noMag;
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
  const { error } = await supabase.from("people").select("km").limit(1);
  return !error;
}

export async function probePeopleEmail(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase.from("people").select("email").limit(1);
  return !error;
}

export async function probePeopleAdmin(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { error } = await supabase.from("people").select("is_admin").limit(1);
  return !error;
}

export function peopleToSchedulerList(
  rows: Record<string, unknown>[],
): SchedulerPersonPayload[] {
  return rows.map(dbPersonToScheduler);
}
