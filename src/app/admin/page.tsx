"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, DeviceMobileIcon, MonitorIcon, XIcon, PencilSimpleIcon, UsersThreeIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
  query,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";

const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

type Device = "desktop" | "mobile";

type Participant = {
  id: string; // userId
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  updatedAt: number;
};

type MissionOption = {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  content: string;
};

type Mission = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  device: Device;
  durationMinutes?: number | null;
  options?: MissionOption[];
  createdAt: number;
};

function derivedStatus(
  startDate: string,
  endDate: string,
): { label: string; style: string } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (now < start)
    return { label: "대기", style: "bg-slate-100 text-slate-600" };
  if (now > end)
    return { label: "완료", style: "bg-emerald-100 text-emerald-700" };
  return { label: "진행중", style: "bg-amber-100 text-amber-700" };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyOption(): MissionOption {
  return { id: crypto.randomUUID(), title: "", description: "", imageUrls: [], content: "" };
}

function normalizeOptions(options?: MissionOption[]) {
  return (options ?? []).map((option) => ({
    id: option.id || crypto.randomUUID(),
    title: option.title ?? "",
    description: option.description ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    imageUrls: (option as any).imageUrls ?? ((option as any).imageUrl ? [(option as any).imageUrl] : []),
    content: option.content ?? "",
  }));
}

const EMPTY_FORM = {
  title: "",
  description: "",
  startDate: today(),
  endDate: today(),
  device: "desktop" as Device,
  options: [createEmptyOption()],
};

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<Mission>>({});
  const [participantsMissionId, setParticipantsMissionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [editUploadingIds, setEditUploadingIds] = useState<Set<string>>(new Set());
  const editImageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
      durationMinutes: mission.durationMinutes ?? 30,
      options: normalizeOptions(mission.options).length > 0 ? normalizeOptions(mission.options) : [createEmptyOption()],
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
        durationMinutes: (editFields.durationMinutes as number) > 0 ? editFields.durationMinutes : null,
        options: normalizeOptions(editFields.options as MissionOption[]).filter((option) => option.title.trim()),
      });
    }
    setEditingId(null);
  };

  const openParticipants = async (missionId: string) => {
    setParticipantsMissionId(missionId);
    setParticipants([]);
    const snap = await getDocs(
      collection(db, "missions", missionId, "participants"),
    );
    setParticipants(
      snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Participant),
    );
  };

  const closeParticipants = () => {
    setParticipantsMissionId(null);
    setParticipants([]);
  };

  const updateEditOption = (id: string, changes: Partial<MissionOption>) => {
    setEditFields((prev) => {
      const options = normalizeOptions(prev.options as MissionOption[]);
      return {
        ...prev,
        options: options.map((option) => option.id === id ? { ...option, ...changes } : option),
      };
    });
  };

  const addEditOption = () => {
    setEditFields((prev) => ({ ...prev, options: [...normalizeOptions(prev.options as MissionOption[]), createEmptyOption()] }));
  };

  const removeEditOption = (id: string) => {
    setEditFields((prev) => {
      const options = normalizeOptions(prev.options as MissionOption[]);
      return {
        ...prev,
        options: options.length <= 1 ? options : options.filter((option) => option.id !== id),
      };
    });
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-4">
            <Link
              href="/lobby"
              className="text-sm text-slate-500 transition hover:text-slate-900"
            >
              <ArrowLeftIcon size={14} className="inline" /> 로비
            </Link>
            <h1 className="text-lg font-semibold text-slate-900">
              관리자 페이지
            </h1>
          </div>
          <Link
            href="/admin/new"
            className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            + 새 미션
          </Link>
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
                <div
                  key={mission.id}
                  className="rounded-3xl border border-slate-100 bg-white px-6 py-5 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-3">
                      {isEditing ? (
                        <>
                          <input
                            autoFocus
                            value={editFields.title ?? ""}
                            onChange={(e) =>
                              setEditFields((p) => ({
                                ...p,
                                title: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            placeholder="미션 제목"
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold outline-none focus:border-slate-400"
                          />
                          <textarea
                            value={editFields.description ?? ""}
                            onChange={(e) =>
                              setEditFields((p) => ({
                                ...p,
                                description: e.target.value,
                              }))
                            }
                            placeholder="미션 설명 (선택)"
                            rows={2}
                            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-slate-400"
                          />
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>기간</span>
                            <input
                              type="date"
                              value={editFields.startDate ?? ""}
                              onChange={(e) =>
                                setEditFields((p) => ({
                                  ...p,
                                  startDate: e.target.value,
                                }))
                              }
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400"
                            />
                            <span className="text-slate-300">–</span>
                            <input
                              type="date"
                              value={editFields.endDate ?? ""}
                              min={editFields.startDate}
                              onChange={(e) =>
                                setEditFields((p) => ({
                                  ...p,
                                  endDate: e.target.value,
                                }))
                              }
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400"
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>디바이스</span>
                            {(["desktop", "mobile"] as Device[]).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() =>
                                  setEditFields((p) => ({ ...p, device: d }))
                                }
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
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>제한 시간 (분)</span>
                            <input
                              type="number"
                              min={0}
                              value={(editFields.durationMinutes as number) ?? 30}
                              onChange={(e) => setEditFields((p) => ({ ...p, durationMinutes: Number(e.target.value) }))}
                              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400"
                            />
                            <span className="text-slate-400">(0 = 제한 없음)</span>
                          </div>
                          <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold text-slate-500">옵션</p>
                              <button
                                type="button"
                                onClick={addEditOption}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                              >
                                + 옵션 추가
                              </button>
                            </div>
                            {normalizeOptions(editFields.options as MissionOption[]).map((option, index) => (
                              <div key={option.id} className="space-y-2 rounded-xl border border-slate-100 bg-white p-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold text-slate-400">옵션 {index + 1}</p>
                                  <button
                                    type="button"
                                    onClick={() => removeEditOption(option.id)}
                                    className="text-xs text-red-400 hover:text-red-500"
                                  >
                                    삭제
                                  </button>
                                </div>
                                <input
                                  value={option.title}
                                  onChange={(e) => updateEditOption(option.id, { title: e.target.value })}
                                  placeholder="옵션 제목"
                                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                                />
                                <textarea
                                  value={option.description}
                                  onChange={(e) => updateEditOption(option.id, { description: e.target.value })}
                                  placeholder="옵션 설명"
                                  rows={2}
                                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                                />
                                {/* Images */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold text-slate-400">이미지 ({option.imageUrls.length}개)</p>
                                    <button type="button" onClick={() => editImageInputRefs.current[option.id]?.click()} disabled={editUploadingIds.has(option.id)}
                                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                                      <UploadSimpleIcon size={12} />{editUploadingIds.has(option.id) ? "업로드 중..." : "이미지 추가"}
                                    </button>
                                    <input ref={(el) => { editImageInputRefs.current[option.id] = el; }} type="file" accept="image/*" multiple className="hidden"
                                      onChange={async (e) => {
                                        const files = Array.from(e.target.files ?? []); if (!files.length) return;
                                        setEditUploadingIds((s) => new Set(s).add(option.id));
                                        try {
                                          const urls = await Promise.all(files.map(async (f, i) => {
                                            const ext = f.name.split(".").pop() || "jpg";
                                            const imgRef = storageRef(storage, `missions/options/${option.id}-${Date.now()}-${i}/image.${ext}`);
                                            await uploadBytes(imgRef, f);
                                            return getDownloadURL(imgRef);
                                          }));
                                          updateEditOption(option.id, { imageUrls: [...option.imageUrls, ...urls] });
                                        } finally {
                                          setEditUploadingIds((s) => { const n = new Set(s); n.delete(option.id); return n; });
                                          e.target.value = "";
                                        }
                                      }} />
                                  </div>
                                  {option.imageUrls.length > 0 && (
                                    <div className="grid grid-cols-3 gap-1.5">
                                      {option.imageUrls.map((url: string, i: number) => (
                                        <div key={i} className="relative group">
                                          <img src={url} alt="" className="h-20 w-full rounded-lg object-cover border border-slate-100" />
                                          <button type="button" onClick={() => updateEditOption(option.id, { imageUrls: option.imageUrls.filter((_: string, j: number) => j !== i) })}
                                            className="absolute top-0.5 right-0.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white text-xs">✕</button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {/* Content — markdown */}
                                <div className="space-y-1.5">
                                  <p className="text-xs font-semibold text-slate-400">콘텐츠 (마크다운)</p>
                                  <textarea
                                    value={option.content}
                                    onChange={(e) => updateEditOption(option.id, { content: e.target.value })}
                                    placeholder={"## 서비스 개요\n- ..."}
                                    rows={4}
                                    className="w-full resize-y rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs outline-none focus:border-slate-400"
                                  />
                                </div>
                              </div>
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
                            <p className="text-sm font-semibold text-slate-900 truncate">
                              {mission.title}
                            </p>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.style}`}
                            >
                              {status.label}
                            </span>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                              {(mission.device ?? "desktop") === "desktop"
                                ? <><MonitorIcon size={12} className="inline" /> PC</>
                                : <><DeviceMobileIcon size={12} className="inline" /> 모바일</>}
                            </span>
                          </div>
                          {mission.description && (
                            <p className="text-xs text-slate-500 leading-relaxed">
                              {mission.description}
                            </p>
                          )}
                          <p className="text-xs text-slate-400">
                            옵션 {mission.options?.length ?? 0}개
                          </p>
                          <p className="text-xs text-slate-400">
                            {mission.startDate} – {mission.endDate}
                          </p>
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
                          <UsersThreeIcon size={16} />
                        </button>
                        <button
                          onClick={() => startEdit(mission)}
                          className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-slate-600"
                          title="수정"
                        >
                          <PencilSimpleIcon size={16} />
                        </button>
                        <button
                          onClick={() => deleteMission(mission.id)}
                          className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-400"
                          title="삭제"
                        >
                          <XIcon size={16} />
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeParticipants}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">참여자</h3>
              <button
                onClick={closeParticipants}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {participants.length === 0 ? (
                <p className="text-sm text-slate-400">
                  아직 참여자가 없습니다.
                </p>
              ) : (
                participants.map((p) => (
                  <Link
                    key={p.id}
                    href={`/main/${participantsMissionId}?viewAs=${p.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-slate-100 px-4 py-3 transition hover:bg-slate-50"
                    onClick={closeParticipants}
                  >
                    {p.photoURL ? (
                      <img
                        src={p.photoURL}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                        {(p.displayName ?? p.email ?? "?")
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {p.displayName ?? p.email ?? p.id}
                      </p>
                      {p.displayName && p.email && (
                        <p className="truncate text-xs text-slate-400">
                          {p.email}
                        </p>
                      )}
                    </div>
                    <ArrowRightIcon size={14} className="ml-auto text-slate-400" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
