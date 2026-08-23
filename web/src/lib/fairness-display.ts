import {
  GUARD_TIME_BAND_HELP,
  GUARD_TIME_BAND_LABELS,
  REST_PENALTY_TIERS,
  guardBandScoreForFullBlock,
} from "@/lib/guard-burden";
import { fairnessRulesChanged } from "@/lib/fairness-stats";
import type { FairnessBucket, FairnessRules, GuardBandRule } from "@/lib/types";
import {
  DEFAULT_BASE_WORK_SHIFTS,
  DEFAULT_FAIRNESS_RULES,
  FAIRNESS_BUCKET_HELP,
  FAIRNESS_BUCKET_LABELS,
} from "@/lib/types";

/** All scoring buckets — every value can be proposed for change. */
export const EDITABLE_FAIRNESS_BUCKETS = [
  "solo",
  "pair",
  "standby",
  "standby_a",
  "standby_b",
  "duty",
  "kitchen",
] as const satisfies readonly FairnessBucket[];

/** Buckets scored as hours × rate (kitchen = per shift). */
export const HOURLY_FAIRNESS_BUCKETS = [
  "solo",
  "pair",
  "standby",
  "standby_a",
  "standby_b",
  "duty",
] as const satisfies readonly FairnessBucket[];

export const FAIRNESS_EDITABLE_HELP: Record<
  (typeof EDITABLE_FAIRNESS_BUCKETS)[number],
  string
> = {
  solo: "שמירה לבד — נקודות לשעה (למשימות שאינן משתמשות בטבלת רצועות)",
  pair: "שמירה בזוג — נקודות לשעה (למשימות שאינן משתמשות בטבלת רצועות)",
  standby: "כיתת כוננות (כללי) — נקודות × שעות",
  standby_a: "כרמל א׳ — יום כוננות מלא, 3 צוערים; נקודות × שעות (לא צורך מנוחה)",
  standby_b: "כרמל ב׳ — כוננות; נקודות × שעות (מותר במקביל לעב״ס)",
  duty: "כוח עתודה — duty × שעות. עב״ס — טבלה קבועה (לא duty).",
  kitchen: "35 צוערים למשמרת — נקודה קבועה לכל משמרת (לא × שעות)",
};

export const BASE_WORK_SCORING_EXPLANATION = [
  "עבודות בסיס — נקודות קבועות לכל חלון (לא × שעות).",
  "כוח עתודה בשמירות — duty × שעות.",
] as const;

export const FAIRNESS_OVERVIEW = [
  "בשיבוץ חכם נבחר מי שציון העומס שלו הכי נמוך.",
  "ציון = עומס בתקופה הנוכחית + התאמת ניקוד קודם (hist).",
  "שמירות — נקודות לפי רצועות 4 שעות; חוצה רצועות = יחסית (ציון × שעות/4).",
  "עונש מנוחה קצרה מתווסף למשמרת שאחרי הפער.",
  "עב״ס — נקודות קבועות לחלון; כרמל/מטבח/עתודה — לפי «נקודות לשעה» / «למשמרת».",
  "כרמל א/ב לא צורכים מנוחה — לא נספרים לעונש מנוחה של שמירה.",
  "כל הערכים בדף זה ניתנים להצעת שינוי (לאחר אישור מפקד).",
] as const;

export const GUARD_SCORING_EXPLANATION = [
  "כל משמרת שמירה מחולקת לרצועות של 4 שעות (00–04, 04–08, …).",
  "לכל רצועה ציון לסולו (מאייש יחיד) ולזוג (2+ מאיישים) — למשמרת 4 שעות מלאה.",
  "משמרת קצרה או חוצה רצועות: sum(ציון_רצועה × שעות_בה ÷ 4) × guard_hours_factor.",
  "דוגמה: 00:00–04:00 סולו = 10 נק׳; 08:00–12:00 בזוג = 5 נק׳.",
  "02:00–05:00 סולו = (10×2/4) + (9×1/4) = 7.25 נק׳.",
  "קצין תורן — אותה טבלת שעות כמו שמירה (seat_count=1 → סולו).",
] as const;

export const SOLO_PAIR_DEFINITION = {
  solo: "מאייש יחיד בעמדה (seat_count ≤ 1) — למשל פטל, תצפיתן, נשקייה, ש״ג רגלי ביום.",
  pair: "שני מאיישים ומעלה — למשל ש״ג רכב קדמי/אחורי (2), כוח עתודה (3) לא נכלל כאן (נקודות עב״ס).",
} as const;

export const REST_PENALTY_EXPLANATION = [
  "נמדד רק בין משימות ש«צורכות מנוחה» (שמירה, עב״ס, מטבח — לא כרמל).",
  "העונש מתווסף למשמרת השמירה שבאה אחרי הפער הקצר.",
  "טבלה: מעל 12 שעות = 0, מעל 10 = +1, …, 0–1 שעות = +8 (טבלת צדק).",
  "זה מדד צדק לשיבוץ — לא אילוץ קשיח (אילוץ המנוחה נקבע ב«שעות מנוחה» ביום).",
] as const;

export const SQUAD_EXPLANATION = [
  "לכל צוער שדה squad (1–4) — חלוקה ל-4 צוותים.",
  "מטבח: בכל משמרת (06–10, 10–15, 15–19, 19–22) צוות אחד במנוחה; 35 צוערים במשמרת.",
  "עב״ס: בכל חלון (08:30, 13:30, 18:30) צוות אחד במנוחה; ~14 צוערים בחלון.",
  "השיבוץ מעדיף צוות שלם באותו חלון — לא רק איזון נקודות.",
] as const;

export const MISSION_TO_BUCKET = [
  { mission: "שמירה (כל העמדות)", scoring: "טבלת רצועות + עונש מנוחה", editable: true },
  { mission: "קצין תורן", scoring: "טבלת רצועות (סולו) + עונש מנוחה", editable: true },
  { mission: "כרמל א׳ (כוננות)", scoring: "נק׳/שעה × standby_a", editable: true },
  { mission: "כרמל ב׳ (כוננות)", scoring: "נק׳/שעה × standby_b", editable: true },
  { mission: "עבודות בסיס", scoring: "נק׳ קבועות לחלון (08:30 / 13:30 / 18:30)", editable: false },
  { mission: "כוח עתודה", scoring: "נק׳/שעה × duty", editable: true },
  { mission: "מטבח", scoring: "נק׳ קבועות למשמרת × kitchen", editable: true },
] as const;

export function baseWorkShiftRows() {
  return DEFAULT_BASE_WORK_SHIFTS.map((row) => ({
    timeLabel: `${row.start}–${row.end}`,
    points: row.points,
  }));
}

export function guardBandRows(rules: FairnessRules) {
  const factor = rules.guard_hours_factor;
  return rules.guard_bands.map((band, i) => ({
    label: GUARD_TIME_BAND_LABELS[i],
    help: GUARD_TIME_BAND_HELP[i],
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
  if (bucket in FAIRNESS_EDITABLE_HELP) {
    return FAIRNESS_EDITABLE_HELP[bucket as keyof typeof FAIRNESS_EDITABLE_HELP];
  }
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
  };
  return merged;
}

export function visibleProposedRules(rules: FairnessRules): FairnessRules {
  return { ...DEFAULT_FAIRNESS_RULES, ...rules };
}

export function formatFairnessRulesDiff(
  current: FairnessRules,
  proposed: FairnessRules,
): string {
  const parts: string[] = [];

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
      `מקדם שעות שמירה: ${current.guard_hours_factor}→${proposed.guard_hours_factor}`,
    );
  }

  proposed.guard_bands.forEach((band, i) => {
    const prev = current.guard_bands[i];
    if (!prev) return;
    if (band.solo !== prev.solo) {
      parts.push(`${GUARD_TIME_BAND_LABELS[i]} סולו: ${prev.solo}→${band.solo}`);
    }
    if (band.paired !== prev.paired) {
      parts.push(`${GUARD_TIME_BAND_LABELS[i]} זוג: ${prev.paired}→${band.paired}`);
    }
  });

  proposed.rest_penalties.forEach((penalty, i) => {
    if (penalty !== current.rest_penalties[i]) {
      parts.push(`עונש מנוחה ${REST_PENALTY_TIERS[i].restHoursLabel}: ${current.rest_penalties[i]}→${penalty}`);
    }
  });

  return parts.join(" · ");
}

export { fairnessRulesChanged };
