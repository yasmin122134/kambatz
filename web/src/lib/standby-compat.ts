import type { MissionPositionKind, MissionType } from "@/lib/types";

/**
 * כוננות כרמל יכולה לחפוף עם משימות מסוימות (כמו במחולל הישן):
 * כרמל א׳ — מטבח; כרמל ב׳ — מטבח + עב״ס (רס״ר).
 */
export function missionsOverlapCompatible(
  kindA: MissionPositionKind,
  typeA: MissionType,
  kindB: MissionPositionKind,
  typeB: MissionType,
): boolean {
  const allows = (
    standby: MissionPositionKind,
    otherKind: MissionPositionKind,
    otherType: MissionType,
  ) => {
    if (standby === "standby_carmel_a") {
      return otherKind === "kitchen" || otherType === "kitchen";
    }
    if (standby === "standby_carmel_b") {
      return (
        otherKind === "kitchen" ||
        otherType === "kitchen" ||
        otherKind === "duty" ||
        otherType === "base_work"
      );
    }
    return false;
  };
  return allows(kindA, kindB, typeB) || allows(kindB, kindA, typeA);
}
