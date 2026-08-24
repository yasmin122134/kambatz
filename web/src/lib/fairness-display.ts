import { fairnessRulesChanged } from "@/lib/fairness-stats";
import { resolveHourlyRates } from "@/lib/fairness-hourly-rates";
import {
  REST_PENALTY_TIERS,
  guardBandScoreForFullBlock,
} from "@/lib/guard-burden";
import type { FairnessHourlyRates, FairnessRules } from "@/lib/types";
import {
  DEFAULT_FAIRNESS_HOURLY_RATES,
  DEFAULT_FAIRNESS_RULES,
  FAIRNESS_BUCKET_HELP,
  FAIRNESS_BUCKET_LABELS,
  type FairnessBucket,
} from "@/lib/types";

export const HOURLY_RATE_ROWS: {
  key: keyof FairnessHourlyRates;
  label: string;
  help: string;
}[] = [
  { key: "guard", label: "שעת שמירה", help: "שמירה רגילה (לא לילה, לא תצפיתן)" },
  {
    key: "guard_night",
    label: "שעת שמירה בלילה (22:00–06:00)",
    help: "כל שעה שחופפת לחלון הלילה",
  },
  { key: "observation", label: "שעת שמירה בתצפיתן", help: "עמדת תצפיתן בלבד" },
  { key: "base_work", label: "שעת עב״ס", help: "עבודות בסיס וכוח עתודה" },
  { key: "standby_a", label: "שעת כ\"כ א", help: "כוננות כרמל א׳" },
  { key: "standby_b", label: "שעת כ\"כ ב", help: "כוננות כרמל ב׳" },
  { key: "kitchen", label: "שעת מטבח", help: "תורנות מטbch" },
];

/** All scoring buckets — legacy; primary model is hourly_rates. */
export const EDITABLE_FAIRNESS_BUCKETS = [
  "solo",
  "pair",
  "standby",
  "standby_a",
  "standby_b",
  "duty",
  "kitchen",
] as const satisfies readonly FairnessBucket[];

export const HOURLY_FAIRNESS_BUCKETS = [
  "solo",
  "pair",
  "standby",
  "standby_a",
  "standby_b",
  "duty",
] as const satisfies readonly FairnessBucket[];

export const FAIRNESS_OVERVIEW = [
  "נקודות שמירה — שמירות + עונש מנוחה בין משימות.",
  "נקודות תורנות — מטbch, עב״ס, כוננות כרמל.",
  "נקודות צדק = נקודות שמירה + נקודות תורנות.",
  "בשיבוץ חכם נבחר מי שציון העומס שלו הכי נמוך + התאמת ניקוד קודם (hist).",
  "כל הערכים בדף זה ניתנים להצעת שינוי (לאחר אישור מפקד).",
] as const;

export const GUARD_SCORING_EXPLANATION = [
  "שעת שמירה רגילה = 1 נק׳ צדק.",
  "שעות בלילה (22:00–06:00) = 1.25 נק׳ לשעה.",
  "תצpיתן = 0.6 נק׳ לשעה (מחליף את תעריף השמירה).",
  "משמרת חוצה לילה/יום — חישוב יחסי לפי שעות בכל חלון.",
] as const;

export const SOLO_PAIR_DEFINITION = {
  solo: "במודל החדש — אין הבדל סולו/זוג; תצpיתן בתעריף נפרד.",
  pair: "שמירה בזוג — אותו תעריף שעה כמו סולo (למעט תצpיתן).",
} as const;

export const REST_PENALTY_EXPLANATION = [
  "נמדד רק בין משימות ש«צורכות מנוחה» (שמירה, עב״ס, מטbch — לא כרמל).",
  "העונש מתווסף לנקודות השמירה של המשמרת שאחרי הפער הקצר.",
  "זה מדד צדק לשיבוץ — לא אילוץ קשיח.",
] as const;

export const BASE_WORK_SCORING_EXPLANATION = [
  "עבודות בסיס — 0.75 נק׳ לשעה (לא טבלה קבועה לחלון).",
  "כוח עתודה — אותו תעריף עב״ס.",
] as const;

export const SQUAD_EXPLANATION = [
  "לכל צוער שדה squad (1–4) — חלוקה ל-4 צוותים.",
  "מטbch: בכל משמרת צוות אחד במנוחה.",
] as const;

export const MISSION_TO_BUCKET = [
  { mission: "שמירה", scoring: "1 נק׳/שעה; לילה 1.25; תצpיתן 0.6", editable: true },
  { mission: "קצין תורן", scoring: "כמו שמירה + עונש מנוחה", editable: true },
  { mission: "כרמל א׳", scoring: "0.5 נק׳/שעה", editable: true },
  { mission: "כרמel ב׳", scoring: "0.3 נק׳/שעה", editable: true },
  { mission: "עבודות בסיס", scoring: "0.75 נק׳/שעה", editable: true },
  { mission: "כוח עתודה", scoring: "0.75 נק׳/שעה", editable: true },
  { mission: "מטbch", scoring: "1 נק׳/שעה", editable: true },
] as const;

export const FAIRNESS_POINT_CATEGORIES = [
  {
    title: "נקודות שמירה",
    description: "שמירות + עונש מנוחה בין משימות",
  },
  {
    title: "נקודות תורנות",
    description: "מטbch, עב״ס, כוננות כרמel",
  },
  {
    title: "נקודות צדק",
    description: "סה״כ = שמירה + תורנות (לשיבוץ והשוואה)",
  },
] as const;

export function hourlyRateRows(rules: FairnessRules) {
  const rates = resolveHourlyRates(rules);
  return HOURLY_RATE_ROWS.map((row) => ({
    ...row,
    value: rates[row.key],
  }));
}

export function baseWorkShiftRows() {
  const rate = DEFAULT_FAIRNESS_HOURLY_RATES.base_work;
  return [
    { timeLabel: "08:30–11:30", points: rate * 3 },
    { timeLabel: "13:30–17:30", points: rate * 4 },
    { timeLabel: "18:30–20:00", points: rate * 1.5 },
  ].map((row) => ({
    ...row,
    points: Math.round(row.points * 100) / 100,
  }));
}

export function guardBandRows(rules: FairnessRules) {
  const factor = rules.guard_hours_factor;
  return rules.guard_bands.map((band, i) => ({
    label: ["00:00–04:00", "04:00–08:00", "08:00–12:00", "12:00–16:00", "16:00–20:00", "20:00–00:00"][i],
    help: "מודל ישן — נשמר לתאימות; החישוב הפעיל לפי hourly_rates",
    solo: guardBandScoreForFullBlock(band.solo, factor),
    pair: guardBandScoreForFullBlock(band.paired, factor),
    soloBase: band.solo,
    pairBase: band.paired,
  }));
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
      parts.push(
        `${row.label}: ${current.hourly_rates[key]}→${proposed.hourly_rates[key]}`,
      );
    }
  }

  for (const bucket of EDITABLE_FAIRNESS_BUCKETS) {
    if (current[bucket] !== proposed[bucket]) {
      parts.push(`${FAIRNESS_BUCKET_LABELS[bucket]}: ${current[bucket]}→${proposed[bucket]}`);
    }
  }

  if (current.hist !== proposed.hist) {
    parts.push(`hist: ${current.hist}→${proposed.hist}`);
  }

  if (current.guard_hours_factor !== proposed.guard_hours_factor) {
    parts.push(
      `מקדם שעות שמירה (ישן): ${current.guard_hours_factor}→${proposed.guard_hours_factor}`,
    );
  }

  proposed.rest_penalties.forEach((penalty, i) => {
    if (penalty !== current.rest_penalties[i]) {
      parts.push(`עונש מנוחה ${REST_PENALTY_TIERS[i].restHoursLabel}: ${current.rest_penalties[i]}→${penalty}`);
    }
  });

  return parts.join(" · ");
}

export { fairnessRulesChanged };
