"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type Participant = {
  id: string; // userId
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  updatedAt: number;
  onboardingStatus?: "completed" | "required" | "unknown";
  isAdmin?: boolean;
};

export type AdminUser = Participant & {
  missionIds: string[];
  sessionMissionIds: string[];
  completedSessionMissionIds: string[];
  missionOrder: string[];
};

export function onboardingBadge(
  status?: Participant["onboardingStatus"],
): { label: string; variant: "success" | "warning" | "secondary" } {
  if (status === "completed") {
    return { label: "온보딩 완료", variant: "success" };
  }
  if (status === "required") {
    return { label: "온보딩 필요", variant: "warning" };
  }
  return { label: "온보딩 확인 불가", variant: "secondary" };
}

interface AdminUserCardProps {
  user: AdminUser;
  onboardingMissionId: string;
  missionTitle: (missionId: string) => string;
  isLoadingMemory: boolean;
  isDeletingSessions: boolean;
  onOpenMemoryTable: () => void;
  onBackupAndDeleteSessions: () => void;
}

/** Per-user card on the admin users tab: profile, mission order, session links, actions. */
export function AdminUserCard({
  user,
  onboardingMissionId,
  missionTitle,
  isLoadingMemory,
  isDeletingSessions,
  onOpenMemoryTable,
  onBackupAndDeleteSessions,
}: AdminUserCardProps) {
  const badge = onboardingBadge(user.onboardingStatus);
  // Google profile photos (lh3.googleusercontent.com) intermittently 403/429;
  // fall back to the initial-letter badge when the image fails to load.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const missionIds = Array.from(
    new Set([
      ...(user.onboardingStatus === "completed" ? [onboardingMissionId] : []),
      ...user.missionIds,
    ]),
  );
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
            <Badge variant={badge.variant} className="rounded-full">
              {badge.label}
            </Badge>
            {user.isAdmin && (
              <Badge
                variant="outline"
                className="rounded-full border-transparent bg-indigo-50 text-indigo-700"
              >
                관리자
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

      {user.missionOrder?.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            미션 순서 (유저별 랜덤)
          </p>
          <ol className="flex flex-wrap gap-1.5">
            {user.missionOrder.map((mid, i) => (
              <li
                key={mid}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
              >
                <span className="font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="truncate max-w-40">{missionTitle(mid)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {missionIds.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            연결된 미션 없음
          </span>
        ) : (
          missionIds.map((missionId) => {
            const isCompleted =
              missionId === onboardingMissionId
                ? user.onboardingStatus === "completed"
                : user.completedSessionMissionIds.includes(missionId);
            return (
              <span
                key={missionId}
                className="inline-flex overflow-hidden rounded-full border border-border text-xs font-semibold"
              >
                <Link
                  href={`/main/${missionId}?viewAs=${user.id}`}
                  className="px-3 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  {missionTitle(missionId)}
                </Link>
                {isCompleted && (
                  <Link
                    href={`/main/${missionId}?viewAs=${user.id}&review=1`}
                    className="border-l border-border px-2.5 py-1 text-indigo-500 transition hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    리뷰
                  </Link>
                )}
              </span>
            );
          })
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="link"
          onClick={onOpenMemoryTable}
          disabled={isLoadingMemory}
          className="h-auto rounded-md px-3 py-1.5 text-[11px] font-semibold text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 hover:no-underline disabled:text-muted-foreground"
        >
          메모리 테이블 보기 →
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={onBackupAndDeleteSessions}
          disabled={isDeletingSessions}
          className="h-auto rounded-md px-3 py-1.5 text-[11px] font-semibold text-red-400 hover:bg-red-50 hover:text-red-600 hover:no-underline disabled:text-muted-foreground"
        >
          {isDeletingSessions ? "백업/삭제 중..." : "세션 백업 후 삭제"}
        </Button>
      </div>
    </div>
  );
}
