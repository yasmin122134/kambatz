import { describe, expect, it } from "vitest";
import {
  collectDraftPublishIds,
  PUBLISH_BOARD_ANYWAY_CONFIRM,
  publishBoardConfirmMessage,
} from "@/lib/mission-publish";
import type { MissionDay } from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function mission(
  id: string,
  status: MissionDay["status"],
  extra?: Partial<MissionDay>,
): MissionDay {
  return {
    id,
    title: id,
    mission_type: "guards",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T09:00:00",
    ends_at: "2026-08-27T09:00:00",
    status,
    positions: [],
    assignments: {},
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
    ...extra,
  };
}

describe("collectDraftPublishIds", () => {
  it("keeps requested drafts and skips published", () => {
    const rows = [
      mission("draft", "draft"),
      mission("pub", "published"),
    ];
    expect(collectDraftPublishIds(rows, ["draft", "pub"])).toEqual(["draft"]);
  });

  it("includes a linked draft even if not requested", () => {
    const rows = [
      mission("guards", "draft", {
        scheduling_rules: {
          ...DEFAULT_MISSION_SCHEDULING_RULES,
          linked_mission_id: "abas",
        },
      }),
      mission("abas", "draft", { mission_type: "base_work" }),
    ];
    expect(collectDraftPublishIds(rows, ["guards"])).toEqual(["guards", "abas"]);
  });

  it("does not include a linked mission that is already published", () => {
    const rows = [
      mission("guards", "draft", {
        scheduling_rules: {
          ...DEFAULT_MISSION_SCHEDULING_RULES,
          linked_mission_id: "abas",
        },
      }),
      mission("abas", "published", { mission_type: "base_work" }),
    ];
    expect(collectDraftPublishIds(rows, ["guards"])).toEqual(["guards"]);
  });
});

describe("publishBoardConfirmMessage", () => {
  it("warns that problems will still be published", () => {
    expect(publishBoardConfirmMessage(3)).toContain("בכל זאת");
    expect(publishBoardConfirmMessage(3)).toContain("3 אזהרות");
  });

  it("asks to publish when there are no warnings", () => {
    expect(publishBoardConfirmMessage(0)).toContain("לפרסם את הלוח לכולם");
  });

  it("always allows publishing despite assignment problems", () => {
    expect(PUBLISH_BOARD_ANYWAY_CONFIRM).toContain("גם אם יש בעיות");
  });
});
