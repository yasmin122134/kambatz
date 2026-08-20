import type { Person } from "@/lib/types";

/** חלוקת מושבים לפי גודל קבוצות (שיטת המספרים הגדולים) */
export function apportionSeats(total: number, groupSizes: number[]): number[] {
  if (total <= 0) return groupSizes.map(() => 0);
  const sum = groupSizes.reduce((a, b) => a + b, 0);
  if (sum <= 0) return groupSizes.map(() => 0);

  const exact = groupSizes.map((s) => (total * s) / sum);
  const floors = exact.map((e) => Math.floor(e));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (let j = 0; j < remainder; j++) {
    out[order[j % order.length].i] += 1;
  }
  return out;
}

export function groupPeopleBySquad(
  people: Person[],
  squadOf: (p: Person) => number,
): Record<number, Person[]> {
  const groups: Record<number, Person[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of people) {
    const s = squadOf(p);
    if (s >= 1 && s <= 4) groups[s].push(p);
  }
  return groups;
}

export const SQUAD_LABELS = [
  "צוות 13 — מפק״ץ איתי",
  "צוות 14 — מפק״ץ זיו",
  "צוות 15 — מפק״ץ סיוון",
  "צוות 16 — מפק״ץ רוני",
] as const;
