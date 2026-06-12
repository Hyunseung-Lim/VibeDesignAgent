"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAdditionalUserInfo,
  getIdToken,
  signInWithPopup,
} from "firebase/auth";
import { firebaseAuth, googleProvider } from "@/lib/firebase";
import { GoogleLogoIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    if (isLoading) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const userInfo = getAdditionalUserInfo(result);
      if (userInfo?.isNewUser) {
        window.localStorage.setItem(
          `vda:onboarding-required:${result.user.uid}`,
          "true",
        );
        window.localStorage.removeItem(
          `vda:onboarding-completed:${result.user.uid}`,
        );
      }
      const token = await getIdToken(result.user, true);
      const profileRes = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          userInfo?.isNewUser ? { onboardingCompleted: false } : {},
        ),
      });
      if (!profileRes.ok) {
        throw new Error(`User profile sync failed: ${profileRes.status}`);
      }
      router.push("/lobby");
    } catch (error) {
      console.error("Failed to sign in with Google", error);
      setErrorMessage(
        "Google 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page px-4 text-foreground">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-card p-10 shadow-panel">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
            VIBEDESIGN AGENT
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-balance text-foreground">
            Google 계정으로 로그인
          </h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            로그인 후 일별 과제와 진행 상태를 로비에서 확인할 수 있습니다.
          </p>
        </div>
        <Button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          variant="outline"
          size="lg"
          className="w-full bg-surface-panel text-base"
        >
          {isLoading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          ) : (
            <GoogleLogoIcon size={20} />
          )}
          {isLoading ? "로그인 중..." : "Google 계정으로 시작하기"}
        </Button>
        {errorMessage && (
          <p role="alert" className="text-center text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
