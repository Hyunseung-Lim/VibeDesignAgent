"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "sonner";
import { OnboardingSteps } from "@/components/onboarding/onboarding-steps";

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
      toast.error("온보딩 상태 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-page px-4 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl flex-col justify-center">
        <div className="rounded-xl border border-border bg-card p-8 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
            Onboarding
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-balance">
            {isCompleted ? "나의 온보딩" : "Vibe Design Agent 시작하기"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-pretty text-muted-foreground">
            이 워크스페이스에서는 에이전트와 대화하며 레퍼런스를 찾고, 노트를
            만들고, 목업과 프레젠테이션을 생성합니다. 온보딩을 완료하면 오늘의
            미션을 시작할 수 있습니다.
          </p>
          {isCompleted && (
            <p className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              온보딩을 완료했습니다. 언제든 이 페이지에서 진행 방식을 다시 확인할 수 있습니다.
            </p>
          )}

          <OnboardingSteps />

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {!isCompleted && (
              <Button
                onClick={completeOnboarding}
                disabled={!userId || isSaving}
                variant="default"
              >
                {isSaving ? "완료 처리 중..." : "온보딩 완료하기"}
              </Button>
            )}
            <Link
              href="/lobby"
              className={buttonVariants({
                variant: "outline",
              })}
            >
              로비로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
