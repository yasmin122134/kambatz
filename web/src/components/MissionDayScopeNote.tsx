import { missionDayScopeLabel } from "@/lib/mission-scope";

type Props = {
  count: number;
  className?: string;
};

export function MissionDayScopeNote({ count, className = "" }: Props) {
  return (
    <p className={`text-xs text-ink3 ${className}`.trim()}>{missionDayScopeLabel(count)}</p>
  );
}
