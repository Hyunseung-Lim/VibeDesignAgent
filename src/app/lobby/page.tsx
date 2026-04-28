"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";
import { DeviceMobileIcon, MonitorIcon } from "@phosphor-icons/react";

const ADMIN_EMAILS = ["03leesun@gmail.com"];

type Mission = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  device?: "desktop" | "mobile";
  createdAt: number;
};

function derivedStatus(startDate: string, endDate: string): { label: string; style: string } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (now < start) return { label: "대기", style: "bg-slate-100 text-slate-600" };
  if (now > end) return { label: "완료", style: "bg-emerald-100 text-emerald-700" };
  return { label: "진행중", style: "bg-amber-100 text-amber-700" };
}

export default function LobbyPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try { await signOut(firebaseAuth); } finally { router.push("/"); }
  };

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) { router.replace("/"); return; }
      setUserEmail(user.email ?? "");
      setUserName(user.displayName ?? user.email?.split("@")[0] ?? "사용자");
      setUserPhoto(user.photoURL ?? null);
      setIsAdmin(ADMIN_EMAILS.includes(user.email ?? ""));
    });
  }, [router]);

  useEffect(() => {
    const q = query(collection(db, "missions"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => {
      setMissions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Mission));
    });
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsMenuOpen(false);
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [isMenuOpen]);

  const userInitial = (userName?.trim()?.charAt(0) || "U").toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Topbar */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
          <p className="text-lg font-semibold text-slate-800">Vibe Design Agent</p>
          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setIsMenuOpen((p) => !p)} className="flex items-center gap-2 rounded-full">
              {userPhoto ? (
                <Image src={userPhoto} alt={userName} width={36} height={36} className="h-9 w-9 rounded-full object-cover" unoptimized priority />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{userInitial}</span>
              )}
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 mt-3 w-60 rounded-3xl bg-white/90 p-4 text-sm shadow-lg backdrop-blur">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                  {userPhoto ? (
                    <Image src={userPhoto} alt={userName} width={40} height={40} className="h-10 w-10 rounded-full object-cover" unoptimized priority />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">{userInitial}</div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{userName}</p>
                    <p className="text-xs text-slate-500">{userEmail}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  {isAdmin && (
                    <Link href="/admin" onClick={() => setIsMenuOpen(false)} className="block w-full rounded-2xl px-4 py-2 text-left text-sm font-semibold text-slate-500 transition hover:bg-slate-50">
                      관리자 페이지
                    </Link>
                  )}
                  <button type="button" onClick={handleLogout} className="w-full rounded-2xl px-4 py-2 text-left font-semibold text-slate-900 transition hover:bg-slate-50">
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
          <div className="flex items-center justify-between">
            <p className="text-2xl font-semibold text-slate-900">Agent Actions</p>
            <Link href="/agent" className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              에이전트 메모리 평가하기
            </Link>
          </div>
        </header>

        {/* Missions */}
        <main className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Missions</h2>
            <span className="text-sm text-slate-400">{missions.length}개의 미션</span>
          </div>

          {missions.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white text-sm text-slate-400">
              아직 등록된 미션이 없습니다.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {missions.map((mission) => {
                const status = derivedStatus(mission.startDate, mission.endDate);
                return (
                  <article
                    key={mission.id}
                    onClick={() => router.push(`/main/${mission.id}`)}
                    className="cursor-pointer rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <p className="flex-1 text-base font-semibold text-slate-900 leading-snug">{mission.title}</p>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.style}`}>
                        {status.label}
                      </span>
                    </div>
                    {mission.description && (
                      <p className="mt-2 text-sm text-slate-500 leading-relaxed line-clamp-2">{mission.description}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <p className="text-xs text-slate-400">{mission.startDate} – {mission.endDate}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        {(mission.device ?? "desktop") === "mobile" ? <><DeviceMobileIcon size={12} className="inline" /> 모바일</> : <><MonitorIcon size={12} className="inline" /> PC</>}
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
