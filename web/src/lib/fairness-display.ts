import {
  GUARD_TIME_BANDS,
  GUARD_TIME_BAND_HELP,
  GUARD_TIME_BAND_LABELS,
  REST_PENALTY_TIERS,
} from "@/lib/guard-burden";
import type { FairnessBucket, FairnessRules } from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  FAIRNESS_BUCKET_HELP,
  FAIRNESS_BUCKET_LABELS,
} from "@/lib/types";

/** Buckets that affect scoring and appear in the «הצעת שינוי» form. */
export const EDITABLE_FAIRNESS_BUCKETS: FairnessBucket[] = [
  "standby_a",
  "standby_b",
  "duty",
  "kitchen",
];

export const FAIRNESS_OVERVIEW = [
  "בשיבוץ חכם נבחר מי שציון העומס שלו הכי נמוך.",
  "ציון = עומס בתקופה הנוכחית + התאמת ניקוד קודם (hist).",
  "שמירות וקצין תורן — לפי טבלת שעות (סולו/זוג) + עונש מנוחה בין משימות.",
  "כרמל, עב״ס, כוח עתודה ומטבח — לפי «נקודות לשעה» / «למשמרת» בטבלה למטה.",
  "כרמל א/ב לא צורכים מנוחה — לא נספרים לעונש מנוחה של שמירה.",
] as const;

export const GUARD_SCORING_EXPLANATION = [
  "כל משמרת שמירה מחולקת לרצועות של 4 שעות (00–04, 04–08, …).",
  "לכל רצועה ציון שונה לסולו (מאייש יחיד) ולזוג (2+ מאיישים).",
  "משמרת חוצה כמה רצועות — הציון יחסי: (דקות ברצועה ÷ 240) × ציון הרצועה.",
  "דוגמה: 00:00–04:00 סולו = 10 נק׳; 08:00–12:00 בזוג = 1 נק׳.",
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
  { mission: "שמירה (כל העמדות)", scoring: "טבלת שעות + עונש מנוחה", editable: false },
  { mission: "קצין תורן", scoring: "טבלת שעות (סולו) + עונש מנוחה", editable: false },
  { mission: "כרמל א׳ (כוננות)", scoring: "נק׳/שעה × standby_a", editable: true },
  { mission: "כרמל ב׳ (כוננות)", scoring: "נק׳/שעה × standby_b", editable: true },
  { mission: "עבודות בסיס", scoring: "נק׳/שעה × duty", editable: true },
  { mission: "כוח עתודה", scoring: "נק׳/שעה × duty", editable: true },
  { mission: "מטבח", scoring: "נק׳ קבועות למשמרת × kitchen", editable: true },
] as const;

export function guardBandRows() {
  return GUARD_TIME_BANDS.map((band, i) => ({
    label: GUARD_TIME_BAND_LABELS[i],
    help: GUARD_TIME_BAND_HELP[i],
    solo: band.solo,
    pair: band.paired,
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
  return {
    ...current,
    ...proposedVisible,
    hist: proposedVisible.hist ?? current.hist,
  };
}

export function visibleProposedRules(rules: FairnessRules): FairnessRules {
  return { ...DEFAULT_FAIRNESS_RULES, ...rules };
}
