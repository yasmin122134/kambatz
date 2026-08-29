import Link from "next/link";
import {
  FAIRNESS_INTRO,
  guardBandRows,
  fairnessScoringSections,
  REST_PENALTY_NOTE,
} from "@/lib/fairness-display";
import { restPenaltyTiersFromRules } from "@/lib/guard-burden";
import { JUSTICE_POINTS_EXPLANATION } from "@/lib/justice-points";
import type { FairnessRules } from "@/lib/types";

type Props = {
  rules: FairnessRules;
  /** כותרת מותאמת — ברירת מחדל «תעריפי נקודות» */
  title?: string;
  showIntro?: boolean;
  linkToFull?: boolean;
};

export function FairnessRulesPanel({
  rules,
  title = "תעריפי נקודות — טבלת צדק",
  showIntro = true,
  linkToFull = false,
}: Props) {
  const scoringSections = fairnessScoringSections(rules);
  const restTiers = restPenaltyTiersFromRules(rules);
  const bandRows = guardBandRows(rules);

  return (
    <section className="card space-y-6">
      <div className="space-y-2">
        <div className="bar spread flex-wrap gap-2">
          <h3 className="font-display text-lg">{title}</h3>
          {linkToFull && (
            <Link href="/fairness" className="text-xs text-brick hover:underline">
              טבלה מלאה →
            </Link>
          )}
        </div>
        {showIntro && (
          <>
            <p className="text-sm text-ink2">{FAIRNESS_INTRO.lead}</p>
            <p className="text-sm text-ink2">{JUSTICE_POINTS_EXPLANATION}</p>
            <p className="text-sm font-medium">{FAIRNESS_INTRO.formula(rules.hist)}</p>
          </>
        )}
      </div>

      <div className="schedule-table-wrap overflow-x-auto">
        <table className="schedule-table w-full text-sm">
          <thead>
            <tr>
              <th className="w-[28%]">קטגוריה</th>
              <th>משימה</th>
              <th className="w-[22%]">נקודות</th>
            </tr>
          </thead>
          <tbody>
            {scoringSections.map((section) =>
              section.rows.map((row, index) => (
                <tr key={`${section.id}-${row.label}`}>
                  {index === 0 ? (
                    <td
                      className="font-medium align-top bg-paper2/40"
                      rowSpan={section.rows.length}
                    >
                      {section.title}
                    </td>
                  ) : null}
                  <td>{row.label}</td>
                  <td className="mono font-bold text-accent whitespace-nowrap">
                    {row.value}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line pt-4 space-y-2">
        <h4 className="font-display text-base">טבלת פסי שמירה (לפי שעון)</h4>
        <p className="text-xs text-ink2">
          נקודות בסיס לשמירה של 4 שעות מלאות בכל פס — מוכפלות לפי אורך המשמרת.
          מקדם שעות: {rules.guard_hours_factor}.
        </p>
        <div className="schedule-table-wrap overflow-x-auto">
          <table className="schedule-table w-full text-sm">
            <thead>
              <tr>
                <th>פס זמן</th>
                <th className="w-[22%]">סולו (4 שע׳)</th>
                <th className="w-[22%]">זוג (4 שע׳)</th>
              </tr>
            </thead>
            <tbody>
              {bandRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="mono font-bold text-accent">{row.solo}</td>
                  <td className="mono font-bold text-accent">{row.pair}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border-t border-line pt-4 space-y-2">
        <h4 className="font-display text-base">עונש מנוחה</h4>
        <p className="text-xs text-ink2">{REST_PENALTY_NOTE}</p>
        <div className="schedule-table-wrap overflow-x-auto">
          <table className="schedule-table w-full text-sm">
            <thead>
              <tr>
                <th>פער מנוחה בין משימות</th>
                <th className="w-[22%]">עונש (+נק׳)</th>
              </tr>
            </thead>
            <tbody>
              {restTiers.map((tier) => (
                <tr key={tier.restHoursLabel}>
                  <td>{tier.restHoursLabel}</td>
                  <td className="mono font-bold text-accent">+{tier.penalty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
