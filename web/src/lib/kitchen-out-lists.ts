import type { KitchenSchedulingRules, Person } from "@/lib/types";
import { DEFAULT_KITCHEN_SCHEDULING_RULES } from "@/lib/types";

export const KITCHEN_SHIFT_COUNT = 4;

function effectiveSquad(person: Person, fallbackIndex: number): number {
  if (person.squad != null && person.squad >= 1 && person.squad <= 4) {
    return person.squad;
  }
  return (fallbackIndex % 4) + 1;
}

/** Normalize per-shift «must be out» name lists (4 kitchen shifts). */
export function normalizeKitchenOutNamesByShift(raw: unknown): string[][] {
  if (!Array.isArray(raw)) {
    return Array.from({ length: KITCHEN_SHIFT_COUNT }, () => []);
  }
  return Array.from({ length: KITCHEN_SHIFT_COUNT }, (_, i) => {
    const row = raw[i];
    if (!Array.isArray(row)) return [];
    return [
      ...new Set(
        row.map((name) => String(name).trim()).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "he"));
  });
}

function squadOfPerson(people: Person[], person: Person): number {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name, "he"));
  return effectiveSquad(person, sorted.findIndex((p) => p.id === person.id));
}

/** Names that must not be assigned to this kitchen shift (explicit list or resting squad). */
export function resolveKitchenOutNames(
  kitchen: KitchenSchedulingRules | undefined,
  shiftIndex: number,
  people: Person[],
): Set<string> {
  const lists = normalizeKitchenOutNamesByShift(kitchen?.out_names_by_shift);
  const explicit = lists[shiftIndex] ?? [];
  if (explicit.length > 0) {
    return new Set(explicit);
  }

  const restList =
    kitchen?.squad_rest_by_shift ??
    DEFAULT_KITCHEN_SCHEDULING_RULES.squad_rest_by_shift;
  const restSquad =
    restList[shiftIndex % restList.length] ?? (shiftIndex % 4) + 1;

  const out = new Set<string>();
  for (const person of people) {
    if (squadOfPerson(people, person) === restSquad) {
      out.add(person.name);
    }
  }
  return out;
}

/** Fill out lists from squad_rest_by_shift + roster squads. */
export function buildKitchenOutNamesFromSquads(
  kitchen: KitchenSchedulingRules,
  people: Person[],
): string[][] {
  const restList = kitchen.squad_rest_by_shift;
  return Array.from({ length: KITCHEN_SHIFT_COUNT }, (_, shiftIndex) => {
    const restSquad =
      restList[shiftIndex % restList.length] ?? (shiftIndex % 4) + 1;
    return people
      .filter((p) => squadOfPerson(people, p) === restSquad)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, "he"));
  });
}

export function hasExplicitKitchenOutLists(
  kitchen: KitchenSchedulingRules | undefined,
): boolean {
  const lists = normalizeKitchenOutNamesByShift(kitchen?.out_names_by_shift);
  return lists.some((row) => row.length > 0);
}
