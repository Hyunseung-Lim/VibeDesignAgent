"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, query, orderBy, getDocs,
} from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";

const ADMIN_EMAILS = ["03leesun@gmail.com"];

type Device = "desktop" | "mobile";

type Participant = {
  id: string; // userId
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  updatedAt: number;
};

type Mission = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  device: Device;
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_FORM = { title: "", description: "", startDate: today(), endDate: today(), device: "desktop" as Device };

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<Mission>>({});
  const [participantsMissionId, setParticipantsMissionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
        router.replace("/lobby");
        return;
      }
      setReady(true);
    });
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    const q = query(collection(db, "missions"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => {
      setMissions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Mission));
    });
  }, [ready]);

  const createMission = async () => {
    if (!form.title.trim()) return;
    setIsCreating(true);
    try {
      await addDoc(collection(db, "missions"), {
        title: form.title.trim(),
        description: form.description.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        device: form.device,
        createdAt: Date.now(),
      });
      setForm(EMPTY_FORM);
      setShowModal(false);
    } finally {
      setIsCreating(false);
    }
  };

  const deleteMission = async (id: string) => {
    if (!confirm("미션을 삭제할까요?")) return;
    await deleteDoc(doc(db, "missions", id));
  };

  const startEdit = (mission: Mission) => {
    setEditingId(mission.id);
    setEditFields({
      title: mission.title,
      description: mission.description,
      startDate: mission.startDate,
      endDate: mission.endDate,
      device: mission.device ?? "desktop",
    });
  };

  const saveEdit = async (id: string) => {
    if (editFields.title?.trim()) {
      await updateDoc(doc(db, "missions", id), {
        title: editFields.title.trim(),
        description: editFields.description?.trim() ?? "",
        startDate: editFields.startDate,
        endDate: editFields.endDate,
        device: editFields.device ?? "desktop",
      });
    }
    setEditingId(null);
  };

  const openParticipants = async (missionId: string) => {
    setParticipantsMissionId(missionId);
    setParticipants([]);
    const snap = await getDocs(collection(db, "missions", missionId, "participants"));
    setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Participant));
  };

  const closeParticipants = () => { setParticipantsMissionId(null); setParticipants([]); };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-4">
            <Link href="/lobby" className="text-sm text-slate-500 transition hover:text-slate-900">← 로비</Link>
            <h1 className="text-lg font-semibold text-slate-900">관리자 페이지</h1>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            + 새 미션
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 lg:px-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">미션 목록</h2>
          <span className="text-sm text-slate-400">{missions.length}개</span>
        </div>

        {missions.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white text-sm text-slate-400">
            아직 미션이 없습니다. 첫 미션을 만들어보세요.
          </div>
        ) : (
          <div className="space-y-3">
            {missions.map((mission) => {
              const status = derivedStatus(mission.startDate, mission.endDate);
              const isEditing = editingId === mission.id;

              return (
                <div key={mission.id} className="rounded-3xl border border-slate-100 bg-white px-6 py-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-3">
                      {isEditing ? (
                        <>
                          <input
                            autoFocus
                            value={editFields.title ?? ""}
                            onChange={e => setEditFields(p => ({ ...p, title: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            placeholder="미션 제목"
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold outline-none focus:border-slate-400"
                          />
                          <textarea
                            value={editFields.description ?? ""}
                            onChange={e => setEditFields(p => ({ ...p, description: e.target.value }))}
                            placeholder="미션 설명 (선택)"
                            rows={2}
                            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-slate-400"
                          />
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>기간</span>
                            <input
                              type="date"
                              value={editFields.startDate ?? ""}
                              onChange={e => setEditFields(p => ({ ...p, startDate: e.target.value }))}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400"
                            />
                            <span className="text-slate-300">–</span>
                            <input
                              type="date"
                              value={editFields.endDate ?? ""}
                              min={editFields.startDate}
                              onChange={e => setEditFields(p => ({ ...p, endDate: e.target.value }))}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400"
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>디바이스</span>
                            {(["desktop", "mobile"] as Device[]).map(d => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setEditFields(p => ({ ...p, device: d }))}
                                className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                                  (editFields.device ?? "desktop") === d
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                                }`}
                              >
                                {d === "desktop" ? "PC" : "모바일"}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit(mission.id)}
                              className="rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                            >
                              저장
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                            >
                              취소
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <p className="text-sm font-semibold text-slate-900 truncate">{mission.title}</p>
                            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.style}`}>
                              {status.label}
                            </span>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                              {(mission.device ?? "desktop") === "desktop" ? "💻 PC" : "📱 모바일"}
                            </span>
                          </div>
                          {mission.description && (
                            <p className="text-xs text-slate-500 leading-relaxed">{mission.description}</p>
                          )}
                          <p className="text-xs text-slate-400">{mission.startDate} – {mission.endDate}</p>
                        </>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => openParticipants(mission.id)}
                          className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-slate-600"
                          title="참여자 보기"
                        >
                          👥
                        </button>
                        <button
                          onClick={() => startEdit(mission)}
                          className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-slate-600"
                          title="수정"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => deleteMission(mission.id)}
                          className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-400"
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Participants modal */}
      {participantsMissionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeParticipants}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">참여자</h3>
              <button onClick={closeParticipants} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mt-4 space-y-2">
              {participants.length === 0 ? (
                <p className="text-sm text-slate-400">아직 참여자가 없습니다.</p>
              ) : (
                participants.map(p => (
                  <Link
                    key={p.id}
                    href={`/main/${participantsMissionId}?viewAs=${p.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-slate-100 px-4 py-3 transition hover:bg-slate-50"
                    onClick={closeParticipants}
                  >
                    {p.photoURL ? (
                      <img src={p.photoURL} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                        {(p.displayName ?? p.email ?? "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{p.displayName ?? p.email ?? p.id}</p>
                      {p.displayName && p.email && <p className="truncate text-xs text-slate-400">{p.email}</p>}
                    </div>
                    <span className="ml-auto text-xs text-slate-400">→</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create mission modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">새 미션 만들기</h3>
            <div className="mt-6 space-y-4">
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && createMission()}
                placeholder="미션 제목"
                autoFocus
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
              />
              <textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
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
                    onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))}
                    className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                  />
                  <span className="text-slate-400">–</span>
                  <input
                    type="date"
                    value={form.endDate}
                    min={form.startDate}
                    onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))}
                    className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500">디바이스</p>
                <div className="flex gap-2">
                  {(["desktop", "mobile"] as Device[]).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, device: d }))}
                      className={`flex-1 rounded-2xl border py-3 text-sm font-semibold transition ${
                        form.device === d
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {d === "desktop" ? "💻 PC" : "📱 모바일"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }}
                className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                취소
              </button>
              <button
                onClick={createMission}
                disabled={!form.title.trim() || isCreating}
                className="flex-1 rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
              >
                {isCreating ? "생성 중..." : "만들기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
