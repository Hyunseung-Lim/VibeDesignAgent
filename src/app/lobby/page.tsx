'use client';

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";

const weeklyMissions = [
  {
    id: "wk1",
    week: "Mission 1",
    status: "진행중",
  },
  {
    id: "wk2",
    week: "Mission 2",
    status: "대기",
  },
  {
    id: "wk3",
    week: "Mission 3",
    status: "완료",
  },
];

const statusStyle = {
  진행중: "bg-amber-100 text-amber-700",
  대기: "bg-slate-100 text-slate-600",
  완료: "bg-emerald-100 text-emerald-700",
};

export default function LobbyPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await signOut(firebaseAuth);
    } finally {
      router.push("/");
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      setUserEmail(user.email ?? "");
      const nameCandidate =
        user.displayName ?? user.email?.split("@")[0] ?? "사용자";
      setUserName(nameCandidate);
      setUserPhoto(user.photoURL ?? null);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [isMenuOpen]);

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);

  const userInitial = (userName?.trim()?.charAt(0) || "U").toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
          <p className="text-lg font-semibold text-slate-800">Vibe Design Agent</p>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={toggleMenu}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
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
              <div
                role="menu"
                className="absolute right-0 mt-3 w-60 rounded-3xl bg-white/90 p-4 text-sm backdrop-blur"
              >
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
                <div className="mt-4">
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
        <header className="rounded-3xl bg-white p-8 shadow-lg shadow-slate-900/5">
          <div className="flex items-center justify-between">
            <p className="text-2xl font-semibold text-slate-900">
              Agent Actions
            </p>
            <Link
              href="/agent"
              className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              에이전트 메모리 평가하기
            </Link>
          </div>
        </header>

        <main className="grid gap-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Missions</h2>
              </div>
              <span className="text-sm text-slate-400">
                {weeklyMissions.length}개의 미션
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {weeklyMissions.map((mission) => (
                <article
                  key={mission.id}
                  onClick={() => router.push(`/main/${mission.id}`)}
                  className="cursor-pointer rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition hover:bg-slate-100"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {mission.week}
                    </span>
                    <div className="ml-auto">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle[mission.status as keyof typeof statusStyle]}`}
                      >
                        {mission.status}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
