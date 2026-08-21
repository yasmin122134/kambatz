import {
  constantStaffingSegments,
  getRequiredSeats,
  type StaffingProfile,
} from "@/lib/staffing-profile";
import {
  addWallClockMinutes,
  fmtTimeLabel,
  nominalShiftBoundaries,
  type TimeInterval,
} from "@/lib/time-interval";

export type GeneratedPositionSlot = {
  startMs: number;
  endMs: number;
  requiredSeats: number;
};

export type GeneratePositionSlotsInput = {
  missionStartMs: number;
  missionEndMs: number;
  nominalShiftDurationMin: number;
  staffingProfile: StaffingProfile;
  /** Minimum shift length unless forced by mission/staffing boundary (default 120 min). */
  minShiftMin?: number;
};

const DEFAULT_MIN_SHIFT_MIN = 120;

type RawSegment = { startMs: number; endMs: number; durMin: number };

function segmentDurationMin(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / 60_000);
}

function partitionScore(parts: number[], nominalMin: number, minShiftMin: number): number {
  let score = 0;
  for (const dur of parts) {
    score += Math.abs(dur - nominalMin);
    if (dur < minShiftMin) score += (minShiftMin - dur) * 3;
    if (dur > nominalMin * 2) score += (dur - nominalMin * 2) * 2;
  }
  return score;
}

/** Deterministic interval partition — prefer durations close to nominal shift length. */
export function partitionInterval(
  startMs: number,
  endMs: number,
  nominalMin: number,
  minShiftMin = DEFAULT_MIN_SHIFT_MIN,
): TimeInterval[] {
  const totalMin = segmentDurationMin(startMs, endMs);
  if (totalMin <= 0) return [];
  if (totalMin <= nominalMin * 1.25) {
    return [{ startMs, endMs }];
  }

  const maxParts = Math.max(1, Math.ceil(totalMin / minShiftMin));
  let bestParts: number[] = [totalMin];
  let bestScore = partitionScore(bestParts, nominalMin, minShiftMin);

  for (let k = 2; k <= maxParts; k++) {
    const base = Math.floor(totalMin / k);
    const rem = totalMin - base * k;
    const parts = Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
    if (parts.some((p) => p <= 0)) continue;
    const score = partitionScore(parts, nominalMin, minShiftMin);
    if (score < bestScore) {
      bestScore = score;
      bestParts = parts;
    }
  }

  const out: TimeInterval[] = [];
  let cursor = startMs;
  for (const dur of bestParts) {
    const next = addWallClockMinutes(cursor, dur);
    out.push({ startMs: cursor, endMs: next });
    cursor = next;
  }
  return out;
}

function hasAwkwardFragments(segments: RawSegment[], minShiftMin: number): boolean {
  return segments.some((s) => s.durMin < minShiftMin);
}

function mergeAdjacentSegments(
  segments: RawSegment[],
  nominalMin: number,
  minShiftMin: number,
): RawSegment[] {
  const maxSingle = nominalMin * 1.25;
  let cur = [...segments];
  let changed = true;
  while (changed && cur.length > 1) {
    changed = false;
    for (let i = 0; i < cur.length - 1; i++) {
      const combined = cur[i].durMin + cur[i + 1].durMin;
      const tailTooShort = cur[i + 1].durMin < minShiftMin;
      const fitsSingle = combined <= maxSingle;
      if (tailTooShort || fitsSingle) {
        cur[i] = {
          startMs: cur[i].startMs,
          endMs: cur[i + 1].endMs,
          durMin: combined,
        };
        cur.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  return cur;
}

function slotsForStaffingSegment(
  segStartMs: number,
  segEndMs: number,
  seats: number,
  nominalMin: number,
  nominalBounds: number[],
  minShiftMin: number,
): GeneratedPositionSlot[] {
  const totalMin = segmentDurationMin(segStartMs, segEndMs);
  if (totalMin <= 0 || seats <= 0) return [];

  if (totalMin <= nominalMin * 1.25) {
    return [{ startMs: segStartMs, endMs: segEndMs, requiredSeats: seats }];
  }

  const cuts = nominalBounds.filter((t) => t > segStartMs && t < segEndMs);
  const points = [segStartMs, ...cuts, segEndMs];
  let raw: RawSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    raw.push({
      startMs: points[i],
      endMs: points[i + 1],
      durMin: segmentDurationMin(points[i], points[i + 1]),
    });
  }

  if (hasAwkwardFragments(raw, minShiftMin)) {
    return partitionInterval(segStartMs, segEndMs, nominalMin, minShiftMin).map((p) => ({
      ...p,
      requiredSeats: seats,
    }));
  }

  raw = mergeAdjacentSegments(raw, nominalMin, minShiftMin);
  return raw.map((s) => ({
    startMs: s.startMs,
    endMs: s.endMs,
    requiredSeats: seats,
  }));
}

/**
 * Canonical per-position slot generator.
 * Each position gets its own intervals — staffing boundaries are hard, nominal cadence is preferred.
 */
export function generatePositionSlots(input: GeneratePositionSlotsInput): GeneratedPositionSlot[] {
  const {
    missionStartMs,
    missionEndMs,
    nominalShiftDurationMin,
    staffingProfile,
    minShiftMin = DEFAULT_MIN_SHIFT_MIN,
  } = input;

  if (missionEndMs <= missionStartMs) return [];

  const nominalBounds = nominalShiftBoundaries(
    missionStartMs,
    missionEndMs,
    nominalShiftDurationMin,
  );
  const staffingSegments = constantStaffingSegments(
    staffingProfile,
    missionStartMs,
    missionEndMs,
  );

  const slots: GeneratedPositionSlot[] = [];
  for (const seg of staffingSegments) {
    if (seg.seats <= 0) continue;
    slots.push(
      ...slotsForStaffingSegment(
        seg.startMs,
        seg.endMs,
        seg.seats,
        nominalShiftDurationMin,
        nominalBounds,
        minShiftMin,
      ),
    );
  }

  return slots;
}

export function slotStructuralKey(positionId: string, startMs: number, endMs: number): string {
  return `${positionId}|${startMs}|${endMs}`;
}

/** Human-readable debug dump for tests and development. */
export function debugFormatPositionSlots(
  positionName: string,
  slots: GeneratedPositionSlot[],
): string {
  return slots
    .map(
      (s) =>
        `${positionName}\n${fmtTimeLabel(s.startMs)}–${fmtTimeLabel(s.endMs)} | seats=${s.requiredSeats}`,
    )
    .join("\n");
}

export function validateGeneratedSlots(
  slots: GeneratedPositionSlot[],
  profile: StaffingProfile,
  missionStartMs: number,
  missionEndMs: number,
): string[] {
  const errors: string[] = [];
  for (const slot of slots) {
    if (slot.startMs >= slot.endMs) {
      errors.push(`Invalid slot: start >= end (${fmtTimeLabel(slot.startMs)})`);
    }
    if (slot.startMs < missionStartMs || slot.endMs > missionEndMs) {
      errors.push(
        `Slot ${fmtTimeLabel(slot.startMs)}–${fmtTimeLabel(slot.endMs)} outside mission bounds`,
      );
    }
    if (slot.requiredSeats <= 0) {
      errors.push(`Zero-seat assignable slot at ${fmtTimeLabel(slot.startMs)}`);
    }

    const midMs = slot.startMs + (slot.endMs - slot.startMs) / 2;
    const seats = getRequiredSeats(profile, midMs);
    if (seats !== slot.requiredSeats) {
      errors.push(
        `Seat mismatch at ${fmtTimeLabel(slot.startMs)}–${fmtTimeLabel(slot.endMs)}: got ${slot.requiredSeats}, expected ${seats}`,
      );
    }

    const stepMs = 60_000;
    for (let t = slot.startMs; t < slot.endMs - stepMs; t += stepMs) {
      if (getRequiredSeats(profile, t) !== getRequiredSeats(profile, t + stepMs)) {
        errors.push(
          `Slot crosses staffing boundary: ${fmtTimeLabel(slot.startMs)}–${fmtTimeLabel(slot.endMs)}`,
        );
        break;
      }
    }
  }
  return errors;
}

// Fix validateGeneratedSlots - I used bad require/await. Let me fix in the file.
