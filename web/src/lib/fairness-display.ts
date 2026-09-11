import { fairnessRulesChanged } from "@/lib/fairness-stats";
import { nightOverlapMinutes, resolveHourlyRates } from "@/lib/fairness-hourly-rates";
import {
  GUARD_BAND_TIME_RANGES,
  GUARD_TIME_BAND_LABELS,
  PATROL_GUARD_POINTS,
  REST_PENALTY_INTERVAL_LEGEND,
  REST_PENALTY_TIERS,
  getGuardBaseBurden,
  pairGuardHourlyRate,
  resolvePairGuardRateRatio,
  restPenaltyIntervalForBonus,
  restPenaltyTierForHours,
} from "@/lib/guard-burden";
import { isObservationPost, parseTimeMinutes, slotDurationMinutes } from "@/lib/mission-utils";
import {
  type FairnessHourlyRates,
  type FairnessRules,
} from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  FAIRNESS_BUCKET_HELP,
  FAIRNESS_BUCKET_LABELS,
  type FairnessBucket,
  type PersonMissionHistoryItem,
} from "@/lib/types";
export const FAIRNESS_INTRO = {
  lead: "השיבוץ החכם מעדיף מי שנקודות הצדק שלו נמוכות יותר.",
  categories:
    "נקודות צדק = נקודות שמירה (שמירות, עב״ס, כוננות, בונוס חוסר מנוחה) + נקודות תורנות (מטבח).",
  formula: (hist: number) =>
    `ציון שיבוץ = נקודות צדק + (ניקוד קודם − ממוצע) × ${hist}`,
} as const;

export const REST_PENALTY_NOTE =
  `בונוס על חוסר מנוחה בין שמירות (לא בין מטבח/עב״ס). מדד צדק — לא אילוץ קשיח. ${REST_PENALTY_INTERVAL_LEGEND}`;

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
  { key: "kitchen", label: "מטבח" },
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
  { kind: "hourly", key: "kitchen", label: "מטבח" },
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

export function fairnessScoringSections(rules: FairnessRules): FairnessScoringSection[] {
  const rates = resolveHourlyRates(rules);
  const abas = baseWorkShiftRows(rules);

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
        { label: "מטבח", value: perHour(rates.kitchen) },
        { label: "חמגשיות", value: perHour(rates.kitchen) },
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
        `בונוס חוסר מנוחה ${REST_PENALTY_TIERS[i].restHoursLabel}: ${current.rest_penalties[i]}→${penalty}`,
      );
    }
  });

  return parts.join(" · ");
}

export type AssignmentPointsExplainInput = Pick<
  PersonMissionHistoryItem,
  | "positionName"
  | "timeLabel"
  | "hours"
  | "points"
  | "bucket"
  | "burdenBase"
  | "burdenRest"
  | "burdenIsSolo"
  | "restHoursBefore"
  | "previousGuardLabel"
>;

function parseTimeLabelRange(timeLabel: string): { start: string; end: string } | null {
  const parts = timeLabel.split("–").map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { start: parts[0], end: parts[1] };
}

function explainRegularGuardBase(
  timeLabel: string,
  base: number,
  isSolo: boolean,
  rules: FairnessRules,
): string {
  const range = parseTimeLabelRange(timeLabel);
  if (!range) return `${base} נק׳ בסיס`;

  const startMin = parseTimeMinutes(range.start);
  if (startMin == null) return `${base} נק׳ בסיס`;

  const durationMin = slotDurationMinutes(range.start, range.end);
  const nightMin = nightOverlapMinutes(startMin, durationMin);
  const dayMin = Math.max(0, durationMin - nightMin);
  const rates = resolveHourlyRates(rules);
  const ratio = isSolo ? 1 : resolvePairGuardRateRatio(rules);
  const dayRate = rates.guard * ratio;
  const nightRate = rates.guard_night * ratio;
  const dayHours = dayMin / 60;
  const nightHours = nightMin / 60;
  const pairNote = isSolo ? "" : " (זוג 75%)";

  if (nightHours > 0 && dayHours > 0) {
    return `${dayHours.toFixed(1)} שע׳ יום × ${dayRate} + ${nightHours.toFixed(1)} שע׳ לילה × ${nightRate}${pairNote} = ${base}`;
  }
  if (nightHours > 0) {
    return `${nightHours.toFixed(1)} שע׳ לילה × ${nightRate}${pairNote} = ${base}`;
  }
  return `${dayHours.toFixed(1)} שע׳ × ${dayRate}${pairNote} = ${base}`;
}

/** Human-readable lines for one assignment row (base, night, rest penalty, …). */
export function explainAssignmentPoints(
  item: AssignmentPointsExplainInput,
  rules: FairnessRules = DEFAULT_FAIRNESS_RULES,
): string[] {
  const lines: string[] = [];

  if (item.burdenBase != null) {
    if (isObservationPost(item.positionName)) {
      const rate = resolveHourlyRates(rules).observation;
      lines.push(`בסיס: ${item.hours} שע׳ × ${rate} (תצפיתן) = ${item.burdenBase}`);
    } else if (
      item.burdenBase === PATROL_GUARD_POINTS &&
      item.points === PATROL_GUARD_POINTS &&
      item.hours >= 2
    ) {
      lines.push(`בסיס: ${PATROL_GUARD_POINTS} נק׳ (פטרול — קבוע)`);
    } else {
      const isSolo = item.burdenIsSolo !== false && item.bucket !== "pair";
      lines.push(`בסיס: ${explainRegularGuardBase(item.timeLabel, item.burdenBase, isSolo, rules)}`);
    }
    if (item.burdenRest && item.burdenRest > 0) {
      const interval =
        item.restHoursBefore != null
          ? restPenaltyTierForHours(item.restHoursBefore).restHoursInterval
          : restPenaltyIntervalForBonus(item.burdenRest, rules);
      const gap =
        item.restHoursBefore != null
          ? `${item.restHoursBefore.toFixed(1)} שעות מנוחה (${interval})`
          : interval
            ? `${interval} שעות מנוחה`
            : "חוסר מנוחה";
      const after = item.previousGuardLabel
        ? ` — אחרי ${item.previousGuardLabel}`
        : "";
      lines.push(`+${item.burdenRest} ${gap}${after}`);
    }
    return lines;
  }

  if (item.bucket && item.hours > 0) {
    const rateKey = item.bucket === "kitchen" ? "kitchen" : item.bucket === "duty" ? "base_work" : item.bucket === "standby_a" ? "standby_a" : item.bucket === "standby_b" ? "standby_b" : null;
    if (rateKey) {
      const rate = resolveHourlyRates(rules)[rateKey as keyof FairnessHourlyRates];
      lines.push(`${item.hours} שע׳ × ${rate} (${FAIRNESS_BUCKET_LABELS[item.bucket].replace(" (לשעה)", "")})`);
    }
  }

  return lines;
}

export function assignmentBucketLabel(item: AssignmentPointsExplainInput): string {
  if (item.burdenBase != null) {
    if (isObservationPost(item.positionName)) return "תצפיתן (לשעה)";
    if (item.burdenIsSolo === false || item.bucket === "pair") return "שמירה בזוג (יחס מסולו)";
    return "שמירה (לשעה)";
  }
  return FAIRNESS_BUCKET_LABELS[item.bucket ?? "solo"];
}

export function fairnessHistoryLabel(
  item: AssignmentPointsExplainInput,
  rules: FairnessRules = DEFAULT_FAIRNESS_RULES,
): string {
  const explain = explainAssignmentPoints(item, rules);
  if (explain.length) return explain.join(" · ");
  return assignmentBucketLabel(item);
}

export { fairnessRulesChanged };
