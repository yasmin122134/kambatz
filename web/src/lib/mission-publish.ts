import type { MissionDay } from "@/lib/types";

type PublishableMission = Pick<MissionDay, "id" | "status" | "scheduling_rules">;

/** Draft IDs to publish, including linked same-bundle drafts. */
export function collectDraftPublishIds(
  missions: PublishableMission[],
  requestedIds: string[],
): string[] {
  const byId = new Map(missions.map((m) => [m.id, m]));
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = requestedIds.map((id) => id.trim()).filter(Boolean);

  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const mission = byId.get(id);
    if (!mission) {
      out.push(id);
      continue;
    }
    if (mission.status !== "draft") continue;
    out.push(id);
    const linked = mission.scheduling_rules?.linked_mission_id?.trim();
    if (linked) queue.push(linked);
  }

  return out;
}

export function publishBoardConfirmMessage(warningCount: number): string {
  if (warningCount <= 0) {
    return "לפרסם את הלוח לכולם? המשתמשים הרגילים יוכלו לראות אותו.";
  }
  const warningLine =
    warningCount === 1
      ? "יש אזהרת שיבוץ אחת בלוח."
      : `יש ${warningCount} אזהרות שיבוץ בלוח.`;
  return `${warningLine} לפרסם לכולם בכל זאת? המשתמשים יראו את הלוח גם עם הבעיות.`;
}

export const PUBLISH_BOARD_ANYWAY_CONFIRM =
  "לפרסם את הלוח לכולם? גם אם יש בעיות בשיבוץ, המשתמשים הרגילים יוכלו לראות אותו.";

