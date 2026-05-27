"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getIdToken, onAuthStateChanged, signOut } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";
import { DeviceMobileIcon, MonitorIcon } from "@phosphor-icons/react";
import { isAdminEmail } from "@/lib/admin";
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

type MissionProgress = {
  hasActivity: boolean;
  timerStartedAt: number | null;
  status: string | null;
};


function missionProgress(data: Record<string, unknown>): MissionProgress {
  const timerStartedAt =
    typeof data.timerStartedAt === "number" ? data.timerStartedAt : null;
  return {
    timerStartedAt,
    status: typeof data.status === "string" ? data.status : null,
    hasActivity: Boolean(
      data.selectedOptionId ||
      data.timerStartedAt ||
      (Array.isArray(data.messages) && data.messages.length > 0) ||
      (Array.isArray(data.ideas) && data.ideas.length > 0) ||
      (Array.isArray(data.artboards) && data.artboards.length > 0) ||
      (Array.isArray(data.references) && data.references.length > 0),
    ),
  };
}

function derivedStatus(
  progress: MissionProgress | null,
  durationMinutes?: number,
): { label: string; style: string } {
  if (progress?.status === "completed") {
    return { label: "완료", style: "bg-emerald-100 text-emerald-700" };
  }
  if (progress?.hasActivity) {
    if (
      progress.timerStartedAt &&
      durationMinutes &&
      Date.now() - progress.timerStartedAt < durationMinutes * 60 * 1000
    ) {
      return { label: "진행중", style: "bg-amber-100 text-amber-700" };
    }
    if (durationMinutes) {
      return { label: "시간 초과", style: "bg-orange-100 text-orange-700" };
    }
    return { label: "완료", style: "bg-emerald-100 text-emerald-700" };
  }

  return { label: "대기", style: "bg-slate-100 text-slate-600" };
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
  const [missionProgressById, setMissionProgressById] = useState<
    Record<string, MissionProgress>
  >({});
  const [onboardingSettings, setOnboardingSettings] =
    useState<OnboardingSettings>(defaultOnboardingSettings);
  const [isOnboardingRequired, setIsOnboardingRequired] = useState(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await signOut(firebaseAuth);
    } finally {
      router.push("/");
    }
  };

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
            snap.docs.map((d) => [d.id, missionProgress(d.data() as Record<string, unknown>)]),
          ),
        );
      },
      () => setMissionProgressById({}),
    );
  }, [userId]);

  useEffect(() => {
    const q = query(collection(db, "missions"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => {
      setMissions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Mission));
    });
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
      "자유주제로 PC 또는 모바일 화면을 선택해 노트, 목업, 프레젠테이션 생성 흐름을 연습합니다.",
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
  const visibleMissions = [onboardingMission, ...missions];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
          <p className="text-lg font-semibold text-slate-800">
            Vibe Design Agent
          </p>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((p) => !p)}
              className="flex items-center gap-2 rounded-full"
            >
              {userPhoto ? (
                <Image
                  src={userPhoto}
                  alt={userName}
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full object-cover"
                  unoptimized
                  priority
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {userInitial}
                </span>
              )}
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 mt-3 w-60 rounded-3xl bg-white/90 p-4 text-sm shadow-lg backdrop-blur">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                  {userPhoto ? (
                    <Image
                      src={userPhoto}
                      alt={userName}
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded-full object-cover"
                      unoptimized
                      priority
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
                      {userInitial}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {userName}
                    </p>
                    <p className="text-xs text-slate-500">{userEmail}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  {isAdmin && (
                    <Link
                      href="/admin"
                      onClick={() => setIsMenuOpen(false)}
                      className="block w-full rounded-2xl px-4 py-2 text-left text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
                    >
                      관리자 페이지
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full rounded-2xl px-4 py-2 text-left font-semibold text-slate-900 transition hover:bg-slate-50"
                  >
                    로그아웃
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 lg:px-10">
        {/* Agent Actions */}
        <header className="rounded-3xl bg-white p-8 shadow-lg shadow-slate-900/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-2xl font-semibold text-slate-900">
              Agent Actions
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/agent"
                className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
              >
                에이전트 메모리 평가하기
              </Link>
            </div>
          </div>
          {isOnboardingRequired && (
            <p className="mt-4 text-sm text-slate-500">
              먼저 미션 목록 섹션에 있는 온보딩 미션을 완료해주세요.
            </p>
          )}
        </header>

        {/* Missions */}
        <main className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">미션 목록</h2>
            <span className="text-sm text-slate-400">
              {visibleMissions.length}개의 미션
            </span>
          </div>

          {visibleMissions.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white text-sm text-slate-400">
              아직 등록된 미션이 없습니다.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleMissions.map((mission) => {
                const isOnboardingMission =
                  mission.id === ONBOARDING_MISSION_ID;
                const progress =
                  missionProgressById[mission.id] ??
                  (isOnboardingMission && !isOnboardingRequired
                    ? { hasActivity: true, timerStartedAt: null }
                    : null);
                const status = derivedStatus(progress, mission.durationMinutes);
                return (
                  <article
                    key={mission.id}
                    onClick={() => {
                      if (isCheckingOnboarding) return;
                      if (isOnboardingRequired && !isOnboardingMission) {
                        router.push(`/main/${ONBOARDING_MISSION_ID}`);
                        return;
                      }
                      router.push(`/main/${mission.id}`);
                    }}
                    className={`rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition ${
                      (!isOnboardingMission && isOnboardingRequired) ||
                      isCheckingOnboarding
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <p className="flex-1 text-base font-semibold text-slate-900 leading-snug">
                        {mission.title}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.style}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    {mission.description && (
                      <p className="mt-2 text-sm text-slate-500 leading-relaxed line-clamp-2">
                        {mission.description}
                      </p>
                    )}
                    <p className="mt-3 text-xs text-slate-400">
                      {isOnboardingMission
                        ? `PC/모바일 중 선택 · 제한 시간 ${mission.durationMinutes ?? 20}분`
                        : `옵션 ${mission.options?.length ?? 0}개 중 선택${
                            mission.durationMinutes
                              ? ` · 제한 시간 ${mission.durationMinutes}분`
                              : " · 제한 시간 없음"
                          }`}
                    </p>
                    {isOnboardingRequired && (
                      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                        {isOnboardingMission
                          ? "이 미션을 완료하면 본 미션에 접근할 수 있습니다."
                          : "온보딩 완료 후 시작할 수 있습니다."}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        {mission.device === "mobile" ? (
                          <>
                            <DeviceMobileIcon size={12} className="inline" />{" "}
                            모바일
                          </>
                        ) : mission.device === "desktop" ? (
                          <>
                            <MonitorIcon size={12} className="inline" /> PC
                          </>
                        ) : (
                          <>
                            <MonitorIcon size={12} className="inline" /> PC ·{" "}
                            <DeviceMobileIcon size={12} className="inline" />{" "}
                            모바일
                          </>
                        )}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        {mission.durationMinutes
                          ? `${mission.durationMinutes}분`
                          : "시간 제한 없음"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
