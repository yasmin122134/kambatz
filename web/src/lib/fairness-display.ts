import { fairnessRulesChanged } from "@/lib/fairness-stats";
import { resolveHourlyRates } from "@/lib/fairness-hourly-rates";
import {
  GUARD_BAND_TIME_RANGES,
  GUARD_TIME_BAND_LABELS,
  PATROL_GUARD_POINTS,
  REST_PENALTY_TIERS,
  getGuardBaseBurden,
} from "@/lib/guard-burden";
import { DEFAULT_HAMAGSHIYOT_SHIFTS } from "@/lib/hamagshiyot-template";
import { DEFAULT_KITCHEN_SHIFTS } from "@/lib/kitchen-day-template";
import {
  type FairnessHourlyRates,
  type FairnessRules,
} from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  FAIRNESS_BUCKET_HELP,
  FAIRNESS_BUCKET_LABELS,
  type FairnessBucket,
} from "@/lib/types";
import {
  pairGuardHourlyRate,
  resolvePairGuardRateRatio,
} from "@/lib/guard-burden";

export const FAIRNESS_INTRO = {
  lead: "השיבוץ החכם מעדיף מי שנקודות הצדק שלו נמוכות יותר.",
  categories:
    "נקודות צדק = נקודות שמירה (שמירות, עב״ס, כוננות, עונש מנוחה) + נקודות תורנות (מטבch).",
  formula: (hist: number) =>
    `ציון שיבוץ = נקודות צדק + (ניקוד קודם − ממוצע) × ${hist}`,
} as const;

export const REST_PENALTY_NOTE =
  "עונש על פער מנוחה קצר בין משימות ש«צורכות מנוחה». מדד צדק — לא אילוץ קשיח.";

export const HOURLY_RATE_ROWS: {
  key: keyof FairnessHourlyRates;
  label: string;
}[] = [
  { key: "guard", label: "שמירה — יום לבד" },
  { key: "guard_night", label: "שמירה — לילה לבד" },
  { key: "observation", label: "תצפיתן" },
  { key: "base_work", label: "עב״ס" },
  { key: "standby_a", label: "כוננות כרמל א׳" },
  { key: "standby_b", label: "כוננות כרמל ב׳" },
  { key: "kitchen", label: "מטבch" },
  { key: "reserve_force", label: "כוח עתודה" },
];

export const EDITABLE_FAIRNESS_BUCKETS = [
  "solo",
  "pair",
  "standby",
  "standby_a",
  "standby_b",
  "duty",
  "kitchen",
] as const satisfies readonly FairnessBucket[];

export type FairnessScoringRow = {
  label: string;
  value: string;
};

export type FairnessScoringSection = {
  id: string;
  title: string;
  rows: FairnessScoringRow[];
};

export type EditableFairnessField =
  | { kind: "hourly"; key: keyof FairnessHourlyRates; label: string }
  | { kind: "pair"; label: string }
  | { kind: "hist"; label: string };

export const EDITABLE_FAIRNESS_FIELDS: EditableFairnessField[] = [
  { kind: "hourly", key: "guard", label: "שמירה — יום לבד" },
  { kind: "pair", label: "שמירה בזוג — יחס מסולו (0.75 = 75%)" },
  { kind: "hourly", key: "guard_night", label: "שמירה — לילה לבד" },
  { kind: "hourly", key: "observation", label: "תצפיתן" },
  { kind: "hourly", key: "base_work", label: "עב״ס" },
  { kind: "hourly", key: "standby_a", label: "כוננות כרמל א׳" },
  { kind: "hourly", key: "standby_b", label: "כוננות כרמל ב׳" },
  { kind: "hourly", key: "kitchen", label: "מטבch" },
  { kind: "hourly", key: "reserve_force", label: "כוח עתודה" },
  { kind: "hist", label: "משקל ניקוד קודם (hist)" },
];

function formatPointValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function perHour(value: number): string {
  return `${formatPointValue(value)} לשעה`;
}

function perShift(value: number): string {
  return `${formatPointValue(value)} למשמרת`;
}

export function pairGuardDayRate(rules: FairnessRules): number {
  return pairGuardHourlyRate(resolveHourlyRates(rules).guard, rules);
}

export function pairGuardNightRate(rules: FairnessRules): number {
  return pairGuardHourlyRate(resolveHourlyRates(rules).guard_night, rules);
}

export function baseWorkShiftRows(rules: FairnessRules) {
  const rate = resolveHourlyRates(rules).base_work;
  return [
    { timeLabel: "08:30–11:30", hours: 3 },
    { timeLabel: "13:30–17:30", hours: 4 },
    { timeLabel: "18:30–20:00", hours: 1.5 },
  ].map((row) => ({
    ...row,
    points: Math.round(row.hours * rate * 100) / 100,
  }));
}

export function hamagshiyotShiftRows(rules: FairnessRules) {
  const points = rules.kitchen;
  return DEFAULT_HAMAGSHIYOT_SHIFTS.map((shift) => ({
    timeLabel: `${shift.start}–${shift.end}`,
    points,
  }));
}

export function fairnessScoringSections(rules: FairnessRules): FairnessScoringSection[] {
  const rates = resolveHourlyRates(rules);
  const abas = baseWorkShiftRows(rules);
  const hamagsh = hamagshiyotShiftRows(rules);

  return [
    {
      id: "guard",
      title: "שמירות",
      rows: [
        { label: "יום — לבד", value: perHour(rates.guard) },
        {
          label: "יום — בזוג (2+ מאיישים)",
          value: `${perHour(pairGuardDayRate(rules))} (${Math.round(resolvePairGuardRateRatio(rules) * 100)}% מסולו)`,
        },
        { label: "לילה — לבד (22:00–06:00)", value: perHour(rates.guard_night) },
        {
          label: "לילה — בזוג",
          value: `${perHour(pairGuardNightRate(rules))} (${Math.round(resolvePairGuardRateRatio(rules) * 100)}% מסולו)`,
        },
        { label: "תצפיתן", value: perHour(rates.observation) },
        {
          label: "סיור (פטרול)",
          value: `${formatPointValue(PATROL_GUARD_POINTS)} לסיור`,
        },
      ],
    },
    {
      id: "standby",
      title: "כוננות",
      rows: [
        { label: "כרמל א׳", value: perHour(rates.standby_a) },
        { label: "כרמל ב׳", value: perHour(rates.standby_b) },
      ],
    },
    {
      id: "duty",
      title: "עב״ס ועתודה",
      rows: [
        { label: "עבודות בסיס — לפי שעות", value: perHour(rates.base_work) },
        ...abas.map((row) => ({
          label: row.timeLabel,
          value: perShift(row.points),
        })),
        { label: "כוח עתודה", value: perHour(rates.reserve_force) },
      ],
    },
    {
      id: "kitchen",
      title: "תורנות",
      rows: [
        { label: "יום מטבch — למשמרת", value: perShift(rules.kitchen) },
        ...DEFAULT_KITCHEN_SHIFTS.map((shift) => ({
          label: `מטבch ${shift.start}–${shift.end}${shift.label ? ` (${shift.label})` : ""}`,
          value: perShift(rules.kitchen),
        })),
        { label: "מטבch — לפי שעות (אם לא למשמרת)", value: perHour(rates.kitchen) },
        ...hamagsh.map((row) => ({
          label: `חמגשיות ${row.timeLabel}`,
          value: perShift(row.points),
        })),
      ],
    },
    {
      id: "meta",
      title: "פרמטרים כלליים",
      rows: [
        {
          label: "משקל ניקוד קודם (hist)",
          value: formatPointValue(rules.hist),
        },
        {
          label: "שמירה בזוג (יחס מסולו)",
          value: `${Math.round(resolvePairGuardRateRatio(rules) * 100)}%`,
        },
        {
          label: "שעות לילה (תעריף לילה)",
          value: "22:00–06:00",
        },
        {
          label: "נקודות צדק",
          value: "נקודות שמירה + נקודות תורנות",
        },
      ],
    },
  ];
}

function bandEndTime(endMin: number): string {
  if (endMin >= 1440) return "00:00";
  const h = Math.floor(endMin / 60);
  const m = endMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function bandStartTime(startMin: number): string {
  const h = Math.floor(startMin / 60) % 24;
  const m = startMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Four-hour band examples — derived from the same day/night hourly model used in scoring. */
export function guardBandRows(rules: FairnessRules) {
  return GUARD_BAND_TIME_RANGES.map((band, i) => {
    const startTime = bandStartTime(band.startMin);
    const endTime = bandEndTime(band.endMin);
    return {
      label: GUARD_TIME_BAND_LABELS[i],
      solo: getGuardBaseBurden(startTime, endTime, 1, rules),
      pair: getGuardBaseBurden(startTime, endTime, 2, rules),
    };
  });
}

export function editableBucketLabel(bucket: FairnessBucket): string {
  return FAIRNESS_BUCKET_LABELS[bucket];
}

export function editableBucketHelp(bucket: FairnessBucket): string {
  return FAIRNESS_BUCKET_HELP[bucket];
}

export function mergeProposedFairnessRules(
  current: FairnessRules,
  proposedVisible: Partial<FairnessRules>,
): FairnessRules {
  const merged: FairnessRules = {
    ...current,
    ...proposedVisible,
    hist: proposedVisible.hist ?? current.hist,
    guard_hours_factor:
      proposedVisible.guard_hours_factor ?? current.guard_hours_factor,
    guard_bands: proposedVisible.guard_bands
      ? current.guard_bands.map((row, i) => ({
          solo: proposedVisible.guard_bands?.[i]?.solo ?? row.solo,
          paired: proposedVisible.guard_bands?.[i]?.paired ?? row.paired,
        }))
      : current.guard_bands.map((row) => ({ ...row })),
    rest_penalties: proposedVisible.rest_penalties
      ? current.rest_penalties.map(
          (value, i) => proposedVisible.rest_penalties?.[i] ?? value,
        )
      : [...current.rest_penalties],
    hourly_rates: proposedVisible.hourly_rates
      ? {
          ...current.hourly_rates,
          ...proposedVisible.hourly_rates,
        }
      : { ...current.hourly_rates },
  };
  return merged;
}

export function visibleProposedRules(rules: FairnessRules): FairnessRules {
  return { ...DEFAULT_FAIRNESS_RULES, ...rules, hourly_rates: { ...rules.hourly_rates } };
}

export function formatFairnessRulesDiff(
  current: FairnessRules,
  proposed: FairnessRules,
): string {
  const parts: string[] = [];

  for (const row of HOURLY_RATE_ROWS) {
    const key = row.key;
    if (current.hourly_rates[key] !== proposed.hourly_rates[key]) {
      parts.push(`${row.label}: ${current.hourly_rates[key]}→${proposed.hourly_rates[key]}`);
    }
  }

  if (current.pair !== proposed.pair) {
    parts.push(
      `שמירה בזוג (יחס מסולו): ${current.pair}→${proposed.pair}`,
    );
  }

  for (const bucket of EDITABLE_FAIRNESS_BUCKETS) {
    if (bucket === "pair") continue;
    if (current[bucket] !== proposed[bucket]) {
      parts.push(`${FAIRNESS_BUCKET_LABELS[bucket]}: ${current[bucket]}→${proposed[bucket]}`);
    }
  }

  if (current.hist !== proposed.hist) {
    parts.push(`hist: ${current.hist}→${proposed.hist}`);
  }

  proposed.rest_penalties.forEach((penalty, i) => {
    if (penalty !== current.rest_penalties[i]) {
      parts.push(
        `עונש מנוחה ${REST_PENALTY_TIERS[i].restHoursLabel}: ${current.rest_penalties[i]}→${penalty}`,
      );
    }
  });

  return parts.join(" · ");
}

export { fairnessRulesChanged };
