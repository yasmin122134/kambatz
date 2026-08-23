import {
  GUARD_TIME_BAND_HELP,
  GUARD_TIME_BAND_LABELS,
  REST_PENALTY_TIERS,
  guardBandScoreForFullBlock,
} from "@/lib/guard-burden";
import { fairnessRulesChanged } from "@/lib/fairness-stats";
import type { FairnessBucket, FairnessRules, GuardBandRule } from "@/lib/types";
import {
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
  duty: "עבודות בסיס (~14 בחלון) וכוח עתודה (3) — נקודות × שעות",
  kitchen: "35 צוערים למשמרת — נקודה קבועה לכל משמרת (לא × שעות)",
};

export const FAIRNESS_OVERVIEW = [
  "בשיבוץ חכם נבחר מי שציון העומס שלו הכי נמוך.",
  "ציון = עומס בתקופה הנוכחית + התאמת ניקוד קודם (hist).",
  "שמירות וקצין תורן — guard_hours_factor × שעות × ציון רצועה + עונש מנוחה.",
  "כרמל, עב״ס, כוח עתודה ומטבח — לפי «נקודות לשעה» / «למשמרת» בטבלה.",
  "כרמל א/ב לא צורכים מנוחה — לא נספרים לעונש מנוחה של שמירה.",
  "כל הערכים בדף זה ניתנים להצעת שינוי (לאחר אישור מפקד).",
] as const;

export const GUARD_SCORING_EXPLANATION = [
  "כל משמרת שמירה מחולקת לרצועות של 4 שעות (00–04, 04–08, …).",
  "לכל רצועה ציון בסיס שונה לסולו (מאייש יחיד) ולזוג (2+ מאיישים).",
  "הניקוד = guard_hours_factor × שעות × (ציון רצועת 4ש׳ ÷ 4).",
  "דוגמה (ברירת מחדל): 00:00–04:00 סולו = 20 נק׳; 08:00–12:00 בזוג = 2 נק׳.",
  "קצין תורן — אותה טבלת שעות כמו שמירה (seat_count=1 → סולו).",
] as const;

export const SOLO_PAIR_DEFINITION = {
  solo: "מאייש יחיד בעמדה (seat_count ≤ 1) — למשל פטל, תצפיתן, נשקייה, ש״ג רגלי ביום.",
  pair: "שני מאיישים ומעלה — למשל ש״ג רכב קדמי/אחורי (2), כוח עתודה (3) לא נכלל כאן (נקודות עב״ס).",
} as const;

export const REST_PENALTY_EXPLANATION = [
  "נמדד רק בין משימות ש«צורכות מנוחה» (שמירה, עב״ס, מטבח — לא כרמל).",
  "העונש מתווסף למשמרת השמירה שבאה אחרי הפער הקצר.",
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
  { mission: "עבודות בסיס", scoring: "נק׳/שעה × duty", editable: true },
  { mission: "כוח עתודה", scoring: "נק׳/שעה × duty", editable: true },
  { mission: "מטבח", scoring: "נק׳ קבועות למשמרת × kitchen", editable: true },
] as const;

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
