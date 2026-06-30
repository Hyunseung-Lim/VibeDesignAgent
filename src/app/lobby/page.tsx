"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getIdToken, onAuthStateChanged, signOut } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";
import { isAdminEmail } from "@/lib/admin";
import { buttonVariants } from "@/components/ui/button";
import { AppTopbar } from "@/components/lobby/app-topbar";
import { LobbySummary } from "@/components/lobby/lobby-summary";
import {
  MissionCard,
  type LobbyMission,
} from "@/components/lobby/mission-card";
import type { MissionStatusVariant } from "@/components/lobby/status-badge";
import {
  deriveMissionProgressStatus,
  missionProgressFromSession,
  type MissionProgress,
} from "@/lib/mission-progress";
const ONBOARDING_MISSION_ID = "onboarding";

type Mission = {
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

type OnboardingSettings = {
  durationMinutes: number;
};

function derivedStatus(
  progress: MissionProgress | null,
  durationMinutes?: number,
): { label: string; variant: MissionStatusVariant } {
  return deriveMissionProgressStatus(progress, durationMinutes);
}

function defaultOnboardingSettings(): OnboardingSettings {
  return { durationMinutes: 20 };
}

export default function LobbyPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  // Per-user randomized mission order (from /api/users/me). Lobby renders
  // missions in this order; empty until the profile fetch resolves.
  const [missionOrder, setMissionOrder] = useState<string[]>([]);
  const [isMissionsLoading, setIsMissionsLoading] = useState(true);
  const [missionError, setMissionError] = useState<string | null>(null);
  const [missionProgressById, setMissionProgressById] = useState<
    Record<string, MissionProgress>
  >({});
  const [reviewSubmittedByMissionId, setReviewSubmittedByMissionId] = useState<
    Record<string, boolean>
  >({});
  const [onboardingSettings, setOnboardingSettings] =
    useState<OnboardingSettings>(defaultOnboardingSettings);
  const [isOnboardingRequired, setIsOnboardingRequired] = useState(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  // Summary counts derive from client-only data (auth + Firestore). Render a
  // stable zero summary on the server and the first client render, then the
  // real counts after mount, so SSR HTML and hydration always match.
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await signOut(firebaseAuth);
    } finally {
      router.push("/");
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setUserId(user.uid);
      setUserEmail(user.email ?? "");
      setUserName(user.displayName ?? user.email?.split("@")[0] ?? "사용자");
      setUserPhoto(user.photoURL ?? null);
      setIsAdmin(isAdminEmail(user.email));
      setIsCheckingOnboarding(true);
      getIdToken(user)
        .then((token) =>
          fetch("/api/users/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
        .then((res) => (res.ok ? res.json() : null))
        .then((profile) => {
          setMissionOrder(
            Array.isArray(profile?.missionOrder) ? profile.missionOrder : [],
          );
          const completed = profile?.onboardingCompleted === true;
          if (completed) {
            window.localStorage.setItem(
              `vda:onboarding-completed:${user.uid}`,
              "true",
            );
            window.localStorage.removeItem(
              `vda:onboarding-required:${user.uid}`,
            );
          } else {
            window.localStorage.removeItem(
              `vda:onboarding-completed:${user.uid}`,
            );
          }
          setIsOnboardingRequired(!completed);
        })
        .catch(() => {
          const localOnboardingCompleted =
            window.localStorage.getItem(
              `vda:onboarding-completed:${user.uid}`,
            ) === "true";
          setIsOnboardingRequired(!localOnboardingCompleted);
        })
        .finally(() => setIsCheckingOnboarding(false));
    });
  }, [router]);

  useEffect(() => {
    if (!userId) {
      setMissionProgressById({});
      return;
    }
    return onSnapshot(
      collection(db, "sessions", userId, "missions"),
      (snap) => {
        setMissionProgressById(
          Object.fromEntries(
            snap.docs.map((d) => [
              d.id,
              missionProgressFromSession(d.data() as Record<string, unknown>),
            ]),
          ),
        );
      },
      () => setMissionProgressById({}),
    );
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setReviewSubmittedByMissionId({});
      return;
    }
    const completedMissionIds = Object.entries(missionProgressById)
      .filter(([, progress]) => progress.status === "completed")
      .map(([missionId]) => missionId);
    if (
      !isCheckingOnboarding &&
      !isOnboardingRequired &&
      !completedMissionIds.includes(ONBOARDING_MISSION_ID)
    ) {
      completedMissionIds.unshift(ONBOARDING_MISSION_ID);
    }
    if (completedMissionIds.length === 0) {
      setReviewSubmittedByMissionId({});
      return;
    }
    let cancelled = false;
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return;
    getIdToken(currentUser)
      .then((token) =>
        Promise.all(
          completedMissionIds.map(async (missionId) => {
            const response = await fetch(
              `/api/memory/review-feedback?missionId=${encodeURIComponent(missionId)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            ).catch(() => null);
            if (!response?.ok) return [missionId, false] as const;
            const data = (await response.json().catch(() => null)) as {
              feedback?: { submittedAt?: number | null } | null;
            } | null;
            return [missionId, Boolean(data?.feedback?.submittedAt)] as const;
          }),
        ),
      )
      .then((entries) => {
        if (cancelled) return;
        setReviewSubmittedByMissionId(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!cancelled) setReviewSubmittedByMissionId({});
      });
    return () => {
      cancelled = true;
    };
  }, [
    isCheckingOnboarding,
    isOnboardingRequired,
    missionProgressById,
    userId,
  ]);

  useEffect(() => {
    const q = query(collection(db, "missions"), orderBy("createdAt", "asc"));
    setIsMissionsLoading(true);
    setMissionError(null);
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setMissions(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Mission),
        );
        setMissionError(null);
        if (!snap.metadata.fromCache) {
          setIsMissionsLoading(false);
        }
      },
      () => {
        setMissionError("미션 목록을 불러오지 못했습니다.");
        setIsMissionsLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    fetch("/api/onboarding")
      .then((res) => (res.ok ? res.json() : null))
      .then((settings) => {
        setOnboardingSettings({
          durationMinutes: Number(settings.durationMinutes) || 20,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setIsMenuOpen(false);
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [isMenuOpen]);

  const userInitial = (userName?.trim()?.charAt(0) || "U").toUpperCase();
  const onboardingMission: Mission = {
    id: ONBOARDING_MISSION_ID,
    title: "온보딩 미션",
    description:
      "자유주제로 PC 또는 모바일 화면을 선택해 Design Brief, 목업, 프레젠테이션 생성 흐름을 연습합니다.",
    durationMinutes: onboardingSettings.durationMinutes,
    options: [
      {
        id: "onboarding-desktop",
        title: "PC 자유주제",
        description: "PC 화면 기준으로 자유롭게 웹/앱 아이디어를 진행합니다.",
        imageUrl: "",
        content:
          "자유주제로 랜딩 페이지, 서비스 화면, 포트폴리오, 커머스 등 원하는 웹/앱 화면을 만들어보세요.",
      },
      {
        id: "onboarding-mobile",
        title: "모바일 자유주제",
        description:
          "모바일 화면 기준으로 자유롭게 앱/웹 아이디어를 진행합니다.",
        imageUrl: "",
        content:
          "자유주제로 온보딩, 홈 화면, 상세 화면, 예약/구독/커머스 등 원하는 모바일 화면을 만들어보세요.",
      },
    ],
    createdAt: -1,
  };
  // Order missions by the user's per-user mission order; any mission not yet in
  // the order (or before the order resolves) falls back to createdAt order.
  const orderedMissions =
    missionOrder.length > 0
      ? [...missions].sort((a, b) => {
          const ia = missionOrder.indexOf(a.id);
          const ib = missionOrder.indexOf(b.id);
          const orderDelta =
            (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
          return Number.isNaN(orderDelta)
            ? (a.createdAt ?? 0) - (b.createdAt ?? 0)
            : orderDelta;
        })
      : missions;
  const visibleMissions: LobbyMission[] = [onboardingMission, ...orderedMissions];
  const missionSummaries = visibleMissions.map((mission) => {
    const isOnboardingMission = mission.id === ONBOARDING_MISSION_ID;
    // Onboarding completion is only known after the profile fetch resolves.
    // Until then (isCheckingOnboarding), treat it as not-completed so the card
    // doesn't flash "완료" before reverting (isOnboardingRequired defaults false).
    const onboardingCompleted =
      isOnboardingMission && !isCheckingOnboarding && !isOnboardingRequired;
    const progress =
      missionProgressById[mission.id] ??
      (onboardingCompleted
        ? {
            hasActivity: true,
            timerStartedAt: null,
            endedAt: null,
            status: "completed",
          }
        : null);
    const status = derivedStatus(progress, mission.durationMinutes);
    const isMissionCompleted = isOnboardingMission
      ? onboardingCompleted
      : progress?.status === "completed";
    return { mission, progress, status, isOnboardingMission, isMissionCompleted };
  });
  // Strict linear path: onboarding first, then missions in the user's order.
  // Exactly the first incomplete mission is "current"; everything after is locked.
  // While onboarding status is still resolving, nothing is unlocked yet.
  const currentMissionIndex = isCheckingOnboarding
    ? -1
    : missionSummaries.findIndex((item) => !item.isMissionCompleted);
  const completedCount = missionSummaries.filter(
    (item) => item.isMissionCompleted,
  ).length;
  const isLobbyLoading = isMissionsLoading || isCheckingOnboarding;
  const summary = mounted && !isLobbyLoading
    ? {
        total: missionSummaries.length,
        waiting: missionSummaries.filter(
          (item) =>
            item.status.label === "대기" || item.status.label === "준비중",
        ).length,
        active: missionSummaries.filter((item) => item.status.label === "진행중")
          .length,
        completed: missionSummaries.filter(
          (item) => item.status.label === "완료",
        ).length,
        timedOut: missionSummaries.filter(
          (item) => item.status.label === "시간 초과",
        ).length,
      }
    : { total: 0, waiting: 0, active: 0, completed: 0, timedOut: 0 };

  return (
    <div className="min-h-screen bg-surface-page text-foreground">
      <div ref={menuRef}>
        <AppTopbar
          userEmail={userEmail}
          userName={userName}
          userPhoto={userPhoto}
          userInitial={userInitial}
          isAdmin={isAdmin}
          isMenuOpen={isMenuOpen}
          onToggleMenu={() => setIsMenuOpen((p) => !p)}
          onCloseMenu={() => setIsMenuOpen(false)}
          onLogout={handleLogout}
        />
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 lg:px-10">
        <header className="rounded-xl border border-border bg-card p-6 shadow-panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-2xl font-semibold text-foreground">
                미션 로비
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                오늘 진행할 미션을 선택하고 완료한 작업을 다시 확인하세요.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/agent"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                전체 메모리 데이터 보기
              </Link>
            </div>
          </div>
        </header>

        <LobbySummary {...summary} />

        <main className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">미션 목록</h2>
            <span className="text-sm text-muted-foreground">
              {isLobbyLoading
                ? "미션 불러오는 중"
                : `${completedCount} / ${visibleMissions.length} 완료 · 순서대로 진행`}
            </span>
          </div>

          {isLobbyLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-52 animate-pulse rounded-xl border border-border bg-card shadow-panel"
                >
                  <div className="space-y-3 p-5">
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-3 w-full rounded bg-muted" />
                    <div className="h-3 w-4/5 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : missionError ? (
            <div
              role="alert"
              className="flex h-40 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 px-4 text-center text-sm font-medium text-rose-700"
            >
              {missionError}
            </div>
          ) : visibleMissions.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border bg-card text-sm text-muted-foreground">
              아직 등록된 미션이 없습니다.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {missionSummaries.map(
                ({ mission, status, isOnboardingMission, isMissionCompleted }, index) => {
                  const isCurrent = index === currentMissionIndex;
                  const isLocked =
                    !isMissionCompleted &&
                    (currentMissionIndex === -1 || index > currentMissionIndex);
                  // The blocking step is whatever is "current"; tailor the reason.
                  const blockingIsOnboarding =
                    currentMissionIndex >= 0 &&
                    missionSummaries[currentMissionIndex]?.isOnboardingMission;
                  const lockReason = blockingIsOnboarding
                    ? "온보딩 완료 후 진행 가능"
                    : "이전 미션 완료 후 진행 가능";
                  const openMission = () => router.push(`/main/${mission.id}`);
                  return (
                    <MissionCard
                      key={mission.id}
                      mission={mission}
                      status={status}
                      isCompleted={isMissionCompleted}
                      isReviewSubmitted={Boolean(
                        reviewSubmittedByMissionId[mission.id],
                      )}
                      isCurrent={isCurrent}
                      isLocked={isLocked}
                      lockReason={lockReason}
                      isOnboardingMission={isOnboardingMission}
                      onOpen={openMission}
                      onReview={() =>
                        router.push(`/main/${mission.id}?review=1`)
                      }
                      onLockedClick={() => toast.info(lockReason)}
                    />
                  );
                },
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
