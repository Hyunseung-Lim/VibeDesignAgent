"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, DeviceMobileIcon, MonitorIcon } from "@phosphor-icons/react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

type Device = "desktop" | "mobile";

type MissionOption = {
  id: string;
  title: string;
  description: string;
  content: string;
};

function createEmptyOption(): MissionOption {
  return { id: crypto.randomUUID(), title: "", description: "", content: "" };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  title: "",
  description: "",
  startDate: today(),
  endDate: today(),
  device: "desktop" as Device,
  durationMinutes: 30,
  options: [createEmptyOption()],
};

export default function NewMissionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
        router.replace("/lobby");
        return;
      }
      setReady(true);
    });
  }, [router]);

  const updateOption = (id: string, changes: Partial<MissionOption>) => {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((o) => o.id === id ? { ...o, ...changes } : o),
    }));
  };

  const addOption = () => {
    setForm((prev) => ({ ...prev, options: [...prev.options, createEmptyOption()] }));
  };

  const removeOption = (id: string) => {
    setForm((prev) => ({
      ...prev,
      options: prev.options.length <= 1 ? prev.options : prev.options.filter((o) => o.id !== id),
    }));
  };

  const validOptions = form.options.filter((o) => o.title.trim());
  const canSubmit = form.title.trim() && validOptions.length > 0 && !isCreating;

  const createMission = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    try {
      const now = new Date();
      const id = `mission-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      await setDoc(doc(db, "missions", id), {
        title: form.title.trim(),
        description: form.description.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        device: form.device,
        durationMinutes: form.durationMinutes > 0 ? form.durationMinutes : null,
        options: validOptions.map((o) => ({
          ...o,
          title: o.title.trim(),
        })),
        createdAt: Date.now(),
      });
      router.push("/admin");
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
            <p className="text-xs font-semibold text-slate-500">수행 기간</p>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
              />
              <span className="text-slate-400">–</span>
              <input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
              />
            </div>
          </div>

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

        {/* Options */}
        <div className="rounded-3xl border border-slate-100 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">미션 옵션</p>
            <button
              type="button"
              onClick={addOption}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
            >
              + 옵션 추가
            </button>
          </div>

          {form.options.map((option, index) => (
            <div key={option.id} className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400">옵션 {index + 1}</p>
                <button
                  type="button"
                  onClick={() => removeOption(option.id)}
                  className="text-xs text-red-400 transition hover:text-red-500"
                >
                  삭제
                </button>
              </div>
              <input
                value={option.title}
                onChange={(e) => updateOption(option.id, { title: e.target.value })}
                placeholder="옵션 제목"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
              <textarea
                value={option.description}
                onChange={(e) => updateOption(option.id, { description: e.target.value })}
                placeholder="옵션 설명"
                rows={2}
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
              {/* Content — markdown */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400">콘텐츠 (마크다운)</p>
                <textarea
                  value={option.content}
                  onChange={(e) => updateOption(option.id, { content: e.target.value })}
                  placeholder={"## 서비스 개요\n- ...\n\n## 주요 기능\n- ..."}
                  rows={6}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
