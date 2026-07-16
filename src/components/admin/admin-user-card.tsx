"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  deriveMissionProgressStatus,
  type MissionProgress,
  type MissionProgressStatus,
} from "@/lib/mission-progress";

export type Participant = {
  id: string; // userId
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  updatedAt: number;
  onboardingStatus?: "completed" | "required" | "unknown";
  memoryReviewSubmittedAt?: number | null;
  isAdmin?: boolean;
  stitchApiGroup?: "A" | "B";
};

export type AdminUser = Participant & {
  missionIds: string[];
  sessionMissionIds: string[];
  completedSessionMissionIds: string[];
  missionOrder: string[];
  missionProgressById: Record<string, MissionProgress>;
  memoryReviewSubmittedByMissionId: Record<string, number | null>;
};

// Mirror the lobby status rule (src/app/lobby/page.tsx): the onboarding mission
// reflects its real session progress, falling back to a synthesized "completed"
// only from the onboarding profile flag. Other missions read their session
// progress directly.
function adminMissionProgress(
  user: AdminUser,
  missionId: string,
  onboardingMissionId: string,
  durationMinutes?: number,
): MissionProgressStatus {
  const progress =
    missionId === onboardingMissionId
      ? user.missionProgressById[missionId] ??
        (user.onboardingStatus === "completed"
          ? {
              hasActivity: true,
              timerStartedAt: null,
              endedAt: null,
              status: "completed",
            }
          : null)
      : user.missionProgressById[missionId];
  return deriveMissionProgressStatus(progress, durationMinutes);
}

// Completion drives the sequential lock, matching the lobby: onboarding counts
// as complete only via its profile flag; other missions via a completed session.
function isMissionCompleted(
  user: AdminUser,
  missionId: string,
  onboardingMissionId: string,
): boolean {
  return missionId === onboardingMissionId
    ? user.onboardingStatus === "completed"
    : user.missionProgressById[missionId]?.status === "completed";
}

function formatSessionDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatSessionMinutes(startedAt: number, endedAt: number) {
  const minutes = Math.max(0, Math.round((endedAt - startedAt) / 60000));
  return `${minutes}분`;
}

function missionTimingParts(progress: MissionProgress | undefined) {
  const startedAt = progress?.timerStartedAt ?? null;
  const endedAt = progress?.endedAt ?? null;
  const parts: string[] = [];
  if (startedAt) parts.push(`시작 ${formatSessionDateTime(startedAt)}`);
  if (endedAt) parts.push(`종료 ${formatSessionDateTime(endedAt)}`);
  if (startedAt && endedAt) {
    parts.push(`소요 ${formatSessionMinutes(startedAt, endedAt)}`);
  } else if (startedAt) {
    parts.push(`경과 ${formatSessionMinutes(startedAt, Date.now())}`);
  }
  return parts;
}

interface AdminUserCardProps {
  user: AdminUser;
  onboardingMissionId: string;
  missionTitle: (missionId: string) => string;
  missionDurationMinutes: (missionId: string) => number | undefined;
}

/** Per-user card on the admin users tab: profile, mission order, session links, actions. */
export function AdminUserCard({
  user,
  onboardingMissionId,
  missionTitle,
  missionDurationMinutes,
}: AdminUserCardProps) {
  // Google profile photos (lh3.googleusercontent.com) intermittently 403/429;
  // fall back to the initial-letter badge when the image fails to load.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const missionIds = Array.from(
    new Set([
      onboardingMissionId,
      ...user.missionOrder,
      ...user.missionIds,
      ...user.sessionMissionIds,
    ]),
  );
  // Sequential-lock rule from the lobby: onboarding first, then the user's
  // order; the first incomplete mission is "current" and everything after it is
  // locked. Admin is read-only, so locks are surfaced as a badge, not enforced.
  const completedFlags = missionIds.map((missionId) =>
    isMissionCompleted(user, missionId, onboardingMissionId),
  );
  const currentMissionIndex = completedFlags.findIndex((done) => !done);
  const completedMissionCount = completedFlags.filter(Boolean).length;
  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        {user.photoURL && !avatarFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.photoURL}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {(user.displayName ?? user.email ?? "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {user.displayName ?? user.email ?? user.id}
            </p>
            {user.isAdmin && (
              <Badge
                variant="outline"
                className="rounded-full border-transparent bg-indigo-50 text-indigo-700"
              >
                관리자
              </Badge>
            )}
            {user.stitchApiGroup && (
              <Badge
                variant="outline"
                className={
                  user.stitchApiGroup === "A"
                    ? "rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "rounded-full border-sky-200 bg-sky-50 text-sky-700"
                }
              >
                Stitch {user.stitchApiGroup}
              </Badge>
            )}
          </div>
          {user.displayName && user.email && (
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">{user.id}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            미션 순서 · 진행상황
          </p>
          {missionIds.length > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {completedMissionCount}/{missionIds.length} 완료
            </span>
          )}
        </div>
        {missionIds.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            연결된 미션 없음
          </span>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-2">
            {missionIds.map((missionId, index) => {
              const progress = adminMissionProgress(
                user,
                missionId,
                onboardingMissionId,
                missionDurationMinutes(missionId),
              );
              const rawProgress = user.missionProgressById[missionId];
              const timingParts = missionTimingParts(rawProgress);
              const isCompleted = completedFlags[index];
              const isReviewSubmitted = Boolean(
                user.memoryReviewSubmittedByMissionId[missionId],
              );
              const isCurrent = index === currentMissionIndex;
              const isLocked =
                !isCompleted &&
                (currentMissionIndex === -1 || index > currentMissionIndex);
              return (
                <li
                  key={missionId}
                  className={`flex min-w-0 items-start gap-2 rounded-xl border border-border bg-background px-2.5 py-2 ${
                    isLocked ? "opacity-60" : ""
                  }`}
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/main/${missionId}?viewAs=${user.id}`}
                        prefetch={false}
                        className="min-w-0 flex-1 truncate text-xs font-medium text-foreground transition hover:text-indigo-600 hover:underline"
                      >
                        {missionTitle(missionId)}
                      </Link>
                      <div className="flex shrink-0 items-center gap-1">
                        {isLocked ? (
                          <Badge
                            variant="secondary"
                            className="h-5 shrink-0 px-1.5 text-[10px]"
                          >
                            잠김
                          </Badge>
                        ) : (
                          isCurrent && (
                            <Badge
                              variant="outline"
                              className="h-5 shrink-0 border-transparent bg-indigo-50 px-1.5 text-[10px] text-indigo-700"
                            >
                              현재
                            </Badge>
                          )
                        )}
                        <Badge
                          variant={progress.variant}
                          className="h-5 shrink-0 px-1.5 text-[10px]"
                        >
                          {progress.label}
                        </Badge>
                        {isCompleted && (
                          <Badge
                            variant="outline"
                            className={
                              isReviewSubmitted
                                ? "h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground"
                                : "h-5 shrink-0 border-amber-200 bg-amber-50 px-1.5 text-[10px] text-amber-700"
                            }
                          >
                            {isReviewSubmitted ? "리뷰 완료" : "리뷰 필요"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {timingParts.length > 0 && (
                      <p className="mt-1 truncate text-[10px] leading-4 text-muted-foreground">
                        {timingParts.join(" · ")}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/users/${encodeURIComponent(user.id)}/memory`}
          className="h-auto rounded-md px-3 py-1.5 text-[11px] font-semibold text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 hover:no-underline disabled:text-muted-foreground"
        >
          메모리 보기 →
        </Link>
      </div>
    </div>
  );
}
