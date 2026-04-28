'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup } from "firebase/auth";
import { firebaseAuth, googleProvider } from "@/lib/firebase";
import { GoogleLogoIcon } from "@phosphor-icons/react";

export default function Home() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    if (isLoading) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await signInWithPopup(firebaseAuth, googleProvider);
      router.push("/lobby");
    } catch (error) {
      console.error("Failed to sign in with Google", error);
      setErrorMessage("Google 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md space-y-8 rounded-3xl border border-white/10 bg-white/5 p-10 backdrop-blur">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
            VIBEDESIGN AGENT
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-white">
            Google 계정으로 로그인
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            로그인 후 주차별 과제와 진행 상태를 로비에서 확인할 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-6 py-3 text-base font-semibold text-slate-900 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
          ) : (
            <GoogleLogoIcon size={20} />
          )}
          {isLoading ? "로그인 중..." : "Google 계정으로 시작하기"}
        </button>
        {errorMessage && (
          <p
            role="alert"
            className="text-center text-sm text-red-300"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
