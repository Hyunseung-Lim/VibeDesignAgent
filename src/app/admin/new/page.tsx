"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, DeviceMobileIcon, MonitorIcon } from "@phosphor-icons/react";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { isAdminEmail } from "@/lib/admin";

type Device = "desktop" | "mobile";

type MissionContent = {
  id: string;
  title: string;
  description: string;
  content: string;
};

function createEmptyContent(): MissionContent {
  return { id: crypto.randomUUID(), title: "", description: "", content: "" };
}

const EMPTY_FORM = {
  title: "",
  description: "",
  device: "desktop" as Device,
  durationMinutes: 30,
  contentBlock: createEmptyContent(),
};

export default function NewMissionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user || !isAdminEmail(user.email)) {
        router.replace("/lobby");
        return;
      }
      setReady(true);
    });
  }, [router]);

  const updateContent = (changes: Partial<MissionContent>) => {
    setForm((prev) => ({
      ...prev,
      contentBlock: { ...prev.contentBlock, ...changes },
    }));
  };

  const hasContentTitle = form.contentBlock.title.trim();
  const canSubmit = form.title.trim() && hasContentTitle && !isCreating;

  const createMission = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    setError("");
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("로그인이 필요합니다.");
      const token = await getIdToken(user);
      const res = await fetch("/api/admin/missions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          device: form.device,
          durationMinutes: form.durationMinutes > 0 ? form.durationMinutes : null,
          // Firestore still stores the mission content in options[0] so the
          // existing session content plumbing remains compatible.
          options: [
            {
              ...form.contentBlock,
              title: form.contentBlock.title.trim(),
              description: form.contentBlock.description.trim(),
            },
          ],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "미션 생성에 실패했습니다.");
      }
      router.push("/admin");
    } catch (err) {
      console.error("[admin/new] create mission failed", err);
      setError(err instanceof Error ? err.message : "미션 생성에 실패했습니다.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm text-slate-500 transition hover:text-slate-900">
              <ArrowLeftIcon size={14} className="inline" /> 관리자
            </Link>
            <h1 className="text-lg font-semibold text-slate-900">새 미션 만들기</h1>
          </div>
          <button
            onClick={createMission}
            disabled={!canSubmit}
            className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
          >
            {isCreating ? "생성 중..." : "만들기"}
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 lg:px-10">
        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {error}
          </div>
        )}
        <div className="rounded-3xl border border-slate-100 bg-white p-6 space-y-4">
          <p className="text-sm font-semibold text-slate-500">기본 정보</p>

          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="미션 제목"
            autoFocus
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="미션 설명 (선택)"
            rows={3}
            className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
          />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">제한 시간 (분)</p>
            <input
              type="number"
              min={0}
              value={form.durationMinutes}
              onChange={(e) => setForm((p) => ({ ...p, durationMinutes: Number(e.target.value) }))}
              placeholder="0 = 시간 제한 없음"
              className="w-40 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">디바이스</p>
            <div className="flex gap-2">
              {(["desktop", "mobile"] as Device[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, device: d }))}
                  className={`flex-1 rounded-2xl border py-3 text-sm font-semibold transition ${
                    form.device === d
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {d === "desktop"
                    ? <><MonitorIcon size={14} className="inline mr-1" />PC</>
                    : <><DeviceMobileIcon size={14} className="inline mr-1" />모바일</>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mission content */}
        <div className="rounded-3xl border border-slate-100 bg-white p-6 space-y-4">
          <p className="text-sm font-semibold text-slate-500">미션 콘텐츠</p>

          <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <input
              value={form.contentBlock.title}
              onChange={(e) => updateContent({ title: e.target.value })}
              placeholder="주제/브랜드 이름"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <textarea
              value={form.contentBlock.description}
              onChange={(e) => updateContent({ description: e.target.value })}
              placeholder="한 줄 설명"
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">콘텐츠 (마크다운)</p>
              <textarea
                value={form.contentBlock.content}
                onChange={(e) => updateContent({ content: e.target.value })}
                placeholder={"## 서비스 개요\n- ...\n\n## 주요 기능\n- ..."}
                rows={6}
                className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-slate-400"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
