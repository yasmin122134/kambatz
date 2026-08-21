import type { FlatSlot } from "@/lib/mission-utils";
import type { MissionDay, Person } from "@/lib/types";

export type SmartAssignStatus = "complete" | "partial" | "infeasible";

export type CarmelGroupCandidate = {
  room: string;
  gender: string;
  people: Person[];
};

export type CarmelFeasibilitySnapshot = {
  slotId: string;
  positionName: string;
  timeLabel: string;
  initialGroupCount: number;
  initialRooms: Array<{ room: string; candidateCount: number }>;
};

export type UnresolvedRequirement = {
  missionId: string;
  positionName: string;
  timeLabel: string;
  requiredSeats: number;
  assignedSeats: number;
  reasons: string[];
  carmelSnapshot?: CarmelFeasibilitySnapshot;
};

export type SmartAssignObjectiveSummary = {
  filledSeats: number;
  requiredSeats: number;
  carmelFilled: number;
  carmelRequired: number;
  fairnessSpread: number;
  searchNodes: number;
  attempts: number;
  timedOut?: boolean;
};

export type CarmelAssignmentUnit = {
  kind: "carmel";
  id: string;
  mission: MissionDay;
  slot: FlatSlot;
  need: number;
  fixedNames: string[];
  seatIndices: number[];
};

export type SeatAssignmentUnit = {
  kind: "seat";
  id: string;
  mission: MissionDay;
  slot: FlatSlot;
  seatIndex: number;
};

export type AssignmentUnit = CarmelAssignmentUnit | SeatAssignmentUnit;

export type GlobalAssignInput = {
  missions: MissionDay[];
  people: Person[];
  issues: import("@/lib/types").Issue[];
  rules: import("@/lib/types").FairnessRules;
  meanPrior: number;
  keepExisting: boolean;
  /** Missions outside scope used only for cross-day tracker seeding */
  crossDayMissions?: MissionDay[];
  maxNodes?: number;
  maxAttempts?: number;
  /** Wall-clock budget for the whole search (ms). */
  deadlineMs?: number;
};

export type GlobalAssignOutput = {
  status: SmartAssignStatus;
  assignmentsByMission: Map<string, Record<string, string[]>>;
  filled: number;
  skipped: number;
  requiredSeats: number;
  unresolved: UnresolvedRequirement[];
  warnings: string[];
  objectiveSummary: SmartAssignObjectiveSummary;
  carmelSnapshots: CarmelFeasibilitySnapshot[];
};
