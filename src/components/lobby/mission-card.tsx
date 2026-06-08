import { DeviceMobileIcon, MonitorIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, type MissionStatus } from "@/components/lobby/status-badge";

export type LobbyMission = {
  id: string;
  title: string;
  description: string;
  device?: "desktop" | "mobile";
  durationMinutes?: number;
  options?: {
    id: string;
    title: string;
    description: string;
    imageUrl: string;
    content: string;
  }[];
  createdAt: number;
};

type MissionCardProps = {
  mission: LobbyMission;
  status: MissionStatus;
  isCompleted: boolean;
  isLocked: boolean;
  isOnboardingMission: boolean;
  isOnboardingRequired: boolean;
  onOpen: () => void;
  onReview: () => void;
};

function DeviceBadge({ device }: { device?: "desktop" | "mobile" }) {
  if (device === "mobile") {
    return (
      <Badge variant="secondary" className="gap-1 font-medium">
        <DeviceMobileIcon size={12} className="inline" /> 모바일
      </Badge>
    );
  }

  if (device === "desktop") {
    return (
      <Badge variant="secondary" className="gap-1 font-medium">
        <MonitorIcon size={12} className="inline" /> PC
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1 font-medium">
      <MonitorIcon size={12} className="inline" /> PC ·{" "}
      <DeviceMobileIcon size={12} className="inline" /> 모바일
    </Badge>
  );
}

export function MissionCard({
  mission,
  status,
  isCompleted,
  isLocked,
  isOnboardingMission,
  isOnboardingRequired,
  onOpen,
  onReview,
}: MissionCardProps) {
  return (
    <article className="flex min-h-52 flex-col rounded-xl border border-border bg-card p-5 shadow-panel transition-colors hover:bg-muted/35">
      <div className="flex flex-wrap items-start gap-3">
        <p className="flex-1 text-base font-semibold leading-snug text-card-foreground text-wrap">
          {mission.title}
        </p>
        <StatusBadge status={status} />
      </div>
      {mission.description && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {mission.description}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {isOnboardingMission
          ? `PC/모바일 중 선택 · 제한 시간 ${mission.durationMinutes ?? 20}분`
          : `옵션 ${mission.options?.length ?? 0}개 중 선택${
              mission.durationMinutes
                ? ` · 제한 시간 ${mission.durationMinutes}분`
                : " · 제한 시간 없음"
            }`}
      </p>
      {isOnboardingRequired && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-700 ring-1 ring-amber-100">
          {isOnboardingMission
            ? "이 미션을 완료하면 본 미션에 접근할 수 있습니다."
            : "온보딩 완료 후 시작할 수 있습니다."}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <DeviceBadge device={mission.device} />
          <Badge variant="secondary" className="font-medium">
            {mission.durationMinutes
              ? `${mission.durationMinutes}분`
              : "시간 제한 없음"}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isCompleted && (
            <Button
              type="button"
              onClick={onReview}
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
            >
              리뷰 보기
            </Button>
          )}
          <Button
            type="button"
            onClick={onOpen}
            disabled={isLocked}
            variant={isLocked ? "secondary" : "default"}
            size="sm"
          >
            {isLocked ? "잠김" : isCompleted ? "다시 열기" : "시작"}
          </Button>
        </div>
      </div>
    </article>
  );
}
