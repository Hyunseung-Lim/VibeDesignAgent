"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setUserId(user.uid);
      getIdToken(user)
        .then((token) =>
          fetch("/api/users/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
        .then((res) => (res.ok ? res.json() : null))
        .then((profile) => {
          const completed = profile?.onboardingCompleted === true;
          setIsCompleted(completed);
          if (completed) {
            window.localStorage.setItem(
              `vda:onboarding-completed:${user.uid}`,
              "true",
            );
            window.localStorage.removeItem(`vda:onboarding-required:${user.uid}`);
          }
        })
        .catch(() => {
          setIsCompleted(
            window.localStorage.getItem(
              `vda:onboarding-completed:${user.uid}`,
            ) === "true",
          );
        });
    });
  }, [router]);

  const completeOnboarding = async () => {
    if (!userId || isSaving) return;
    setIsSaving(true);
    try {
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) throw new Error("No signed-in user");
      const token = await getIdToken(currentUser, true);
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ onboardingCompleted: true }),
      });
      if (!res.ok) throw new Error(`Onboarding update failed: ${res.status}`);
      window.localStorage.removeItem(`vda:onboarding-required:${userId}`);
      window.localStorage.setItem(`vda:onboarding-completed:${userId}`, "true");
      setIsCompleted(true);
      router.replace("/lobby");
    } catch (error) {
      console.warn("Unable to persist onboarding completion", error);
      alert("온보딩 상태 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl flex-col justify-center">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/20 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">
            Onboarding
          </p>
          <h1 className="mt-4 text-3xl font-semibold">
            {isCompleted ? "나의 온보딩" : "Vibe Design Agent 시작하기"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            이 워크스페이스에서는 에이전트와 대화하며 레퍼런스를 찾고, 노트를
            만들고, 목업과 프레젠테이션을 생성합니다. 온보딩을 완료하면 오늘의
            미션을 시작할 수 있습니다.
          </p>
          {isCompleted && (
            <p className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-200">
              온보딩을 완료했습니다. 언제든 이 페이지에서 진행 방식을 다시 확인할 수 있습니다.
            </p>
          )}

          <div className="mt-8 grid gap-3 text-sm text-slate-200">
            {[
              "미션 옵션을 먼저 선택합니다.",
              "에이전트가 노트를 작성하고, 사용자는 노트를 선택합니다.",
              "목업은 여러 디자인으로 생성할 수 있고, 우클릭으로 삭제할 수 있습니다.",
              "프레젠테이션은 생성된 목업 캡쳐를 기반으로 만듭니다.",
            ].map((item, index) => (
              <div
                key={item}
                className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-950">
                  {index + 1}
                </span>
                <p>{item}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {!isCompleted && (
              <button
                type="button"
                onClick={completeOnboarding}
                disabled={!userId || isSaving}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "완료 처리 중..." : "온보딩 완료하기"}
              </button>
            )}
            <Link
              href="/lobby"
              className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              로비로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
