import {
  CircleCheckIcon,
  SmartphoneIcon,
  LockIcon,
  MonitorIcon,
} from "lucide-react";
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
  isReviewSubmitted: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  lockReason?: string;
  isOnboardingMission: boolean;
  onOpen: () => void;
  onReview: () => void;
  onLockedClick: () => void;
};

function DeviceBadge({ device }: { device?: "desktop" | "mobile" }) {
  if (device === "mobile") {
    return (
      <Badge variant="secondary" className="gap-1 font-medium">
        <SmartphoneIcon size={12} className="inline" /> 모바일
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
      <SmartphoneIcon size={12} className="inline" /> 모바일
    </Badge>
  );
}

export function MissionCard({
  mission,
  status,
  isCompleted,
  isReviewSubmitted,
  isCurrent,
  isLocked,
  lockReason,
  isOnboardingMission,
  onOpen,
  onReview,
  onLockedClick,
}: MissionCardProps) {
  return (
    <article
      onClick={isLocked ? onLockedClick : undefined}
      className={`flex min-h-52 flex-col rounded-xl border bg-card p-5 shadow-panel transition-colors ${
        isLocked
          ? "cursor-pointer border-border opacity-60 hover:opacity-80"
          : isCurrent
            ? "border-primary ring-2 ring-primary/20 hover:bg-muted/35"
            : "border-border hover:bg-muted/35"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <p className="flex flex-1 items-center gap-1.5 text-base font-semibold leading-snug text-card-foreground text-balance">
          {isLocked && (
            <LockIcon
              size={15}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          {isCompleted && (
            <CircleCheckIcon
              size={16}
              className="shrink-0 text-emerald-500"
              aria-hidden
            />
          )}
          {mission.title}
        </p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <StatusBadge status={status} />
          {isCompleted ? (
            <Badge
              variant="outline"
              className={
                isReviewSubmitted
                  ? "font-medium text-muted-foreground"
                  : "border-amber-200 bg-amber-50 font-medium text-amber-700"
              }
            >
              {isReviewSubmitted ? "리뷰 완료" : "리뷰 필요"}
            </Badge>
          ) : null}
        </div>
      </div>
      {(() => {
        // Standalone missions show the per-mission content one-liner (brand/
        // persona) rather than the shared task-type description, which repeats
        // across same-type missions. Onboarding keeps its own description.
        const cardDescription =
          (!isOnboardingMission && mission.options?.[0]?.description) ||
          mission.description;
        return cardDescription ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {cardDescription}
          </p>
        ) : null;
      })()}
      {isOnboardingMission && (
        <p className="mt-3 text-xs text-muted-foreground">
          PC/모바일 중 선택
        </p>
      )}
      {isLocked && lockReason && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <LockIcon size={12} aria-hidden />
          {lockReason}
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
          {isCompleted ? (
            // Completed missions are review-only; re-running is blocked to keep
            // the linear cumulative-memory data clean.
            <Button type="button" onClick={onReview} variant="secondary" size="sm">
              {isReviewSubmitted ? "리뷰 보기" : "리뷰하기"}
            </Button>
          ) : isLocked ? (
            <Button
              type="button"
              onClick={onLockedClick}
              variant="secondary"
              size="sm"
            >
              잠김
            </Button>
          ) : (
            <Button type="button" onClick={onOpen} variant="default" size="sm">
              시작
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
