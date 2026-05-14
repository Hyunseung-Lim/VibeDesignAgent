"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, DeviceMobileIcon, MonitorIcon, XIcon, PencilSimpleIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
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
const ONBOARDING_MISSION_ID = "onboarding";

type Device = "desktop" | "mobile";

type Participant = {
  id: string; // userId
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  updatedAt: number;
  onboardingStatus?: "completed" | "required" | "unknown";
  isAdmin?: boolean;
};

type AdminUser = Participant & {
  missionIds: string[];
  sessionMissionIds: string[];
  sessionRuns?: {
    runId: string;
    missionId: string;
    missionTitle?: string;
    updatedAt?: number;
  }[];
};

type AdminMemoryRow = {
  id: string;
  version?: string;
  type: "episodic" | "semantic" | "interaction" | string;
  input?: string;
  output?: string;
  timestamp?: number;
  category?: string[];
  subcategory?: string[];
  keywords?: string[];
  episode?: string;
  semantic?: string;
};

type MemoryCounts = Record<string, number>;
type MemoryVersionTab = "0.1.0" | "0.1.1";

type MissionOption = {
  id: string;
  title: string;
  description: string;
  content: string;
};

type Mission = {
  id: string;
  title: string;
  description: string;
  device: Device;
  durationMinutes?: number | null;
  options?: MissionOption[];
  createdAt: number;
};

type OnboardingSettings = {
  durationMinutes: number;
};

function defaultOnboardingSettings(): OnboardingSettings {
  return { durationMinutes: 20 };
}

function createEmptyOption(): MissionOption {
  return { id: crypto.randomUUID(), title: "", description: "", content: "" };
}

function normalizeOptions(options?: MissionOption[]) {
  return (options ?? []).map((option) => ({
    id: option.id || crypto.randomUUID(),
    title: option.title ?? "",
    description: option.description ?? "",
    content: option.content ?? "",
  }));
}

const EMPTY_FORM = {
  title: "",
  description: "",
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
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [memoryModal, setMemoryModal] = useState<{ userId: string; userName: string; rows: AdminMemoryRow[]; counts: MemoryCounts } | null>(null);
  const [memoryVersionTab, setMemoryVersionTab] = useState<MemoryVersionTab>("0.1.1");
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isDeletingMemory, setIsDeletingMemory] = useState(false);
  const [deletingSessionsUserId, setDeletingSessionsUserId] = useState<string | null>(null);
  const [onboardingSettings, setOnboardingSettings] =
    useState<OnboardingSettings>(defaultOnboardingSettings);
  const [isSavingOnboardingSettings, setIsSavingOnboardingSettings] =
    useState(false);

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
      device: mission.device ?? "desktop",
      durationMinutes: mission.durationMinutes ?? 30,
      options: normalizeOptions(mission.options).length > 0 ? normalizeOptions(mission.options) : [createEmptyOption()],
    });
  };

  const saveEdit = async (id: string) => {
    if (editFields.title?.trim()) {
      const clean = <T,>(v: T): T =>
        JSON.parse(JSON.stringify(v, (_, val) => (val === undefined ? null : val)));
      await updateDoc(doc(db, "missions", id), clean({
        title: editFields.title.trim(),
        description: editFields.description?.trim() ?? "",
        device: editFields.device ?? "desktop",
        durationMinutes: (editFields.durationMinutes as number) > 0 ? editFields.durationMinutes : null,
        options: normalizeOptions(editFields.options as MissionOption[]).filter((option) => option.title.trim()),
      }));
    }
    setEditingId(null);
  };

  const openParticipants = async (missionId: string) => {
    setParticipantsMissionId(missionId);
    setParticipants([]);
    const snap = await getDocs(
      collection(db, "missions", missionId, "participants"),
    );
    const participantRows = snap.docs.map((d) => {
      const participant = { id: d.id, ...d.data() } as Participant;
      participant.isAdmin = ADMIN_EMAILS.includes(participant.email ?? "");
      return participant;
    });
    const statuses = await fetchOnboardingStatuses(
      participantRows.map((participant) => participant.id),
    );
    participantRows.forEach((participant) => {
      participant.onboardingStatus =
        statuses[participant.id]?.onboardingStatus ?? "unknown";
    });
    setParticipants(participantRows);
  };

  const openOnboardingParticipants = () => {
    setParticipantsMissionId(ONBOARDING_MISSION_ID);
    setParticipants(adminUsers);
  };

  const deleteUserData = async (participant: Participant) => {
    const targetMissionId = participantsMissionId;
    if (!targetMissionId) {
      alert("삭제할 미션 정보가 없습니다.");
      return;
    }
    const label = participant.displayName ?? participant.email ?? participant.id;
    if (
      !confirm(
        `${label} 사용자의 ${missionTitle(targetMissionId)} 기록만 삭제할까요? 유저 정보와 다른 미션 기록은 유지됩니다.`,
      )
    )
      return;

    try {
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) {
        alert("관리자 인증 정보가 없습니다. 다시 로그인해주세요.");
        return;
      }
      const token = await getIdToken(currentUser, true);
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(participant.id)}?recordsOnly=1&missionId=${encodeURIComponent(targetMissionId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "유저 데이터 삭제에 실패했습니다.");
        return;
      }
    } catch (error) {
      console.error("[admin] user delete failed", error);
      alert("유저 데이터 삭제 중 오류가 발생했습니다.");
      return;
    }

    const resetUser = (user: AdminUser) => ({
      ...user,
      missionIds:
        targetMissionId !== ONBOARDING_MISSION_ID
          ? user.missionIds.filter((missionId) => missionId !== targetMissionId)
          : user.missionIds,
      sessionMissionIds: user.sessionMissionIds.filter(
        (missionId) => missionId !== targetMissionId,
      ),
      onboardingStatus:
        targetMissionId === ONBOARDING_MISSION_ID
          ? ("required" as const)
          : user.onboardingStatus,
    });
    setAdminUsers((prev) =>
      prev.map((p) => (p.id === participant.id ? resetUser(p) : p)),
    );
    setParticipants((prev) =>
      targetMissionId === ONBOARDING_MISSION_ID
        ? prev.map((p) =>
            p.id === participant.id
              ? { ...p, onboardingStatus: "required" as const }
              : p,
          )
        : prev.filter((p) => p.id !== participant.id),
    );
  };

  const onboardingBadge = (status?: Participant["onboardingStatus"]) => {
    if (status === "completed") {
      return { label: "온보딩 완료", style: "bg-emerald-50 text-emerald-700" };
    }
    if (status === "required") {
      return { label: "온보딩 필요", style: "bg-amber-50 text-amber-700" };
    }
    return { label: "온보딩 확인 불가", style: "bg-slate-100 text-slate-500" };
  };

  const missionTitle = (missionId: string) =>
    missionId === ONBOARDING_MISSION_ID
      ? "온보딩"
      : missions.find((mission) => mission.id === missionId)?.title ?? missionId;

  const getAdminToken = async () => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return null;
    return getIdToken(currentUser);
  };

  const fetchOnboardingStatuses = async (uids: string[]) => {
    const token = await getAdminToken();
    if (!token || uids.length === 0) {
      return {} as Record<string, { onboardingStatus: Participant["onboardingStatus"] }>;
    }
    const res = await fetch("/api/admin/users/status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uids }),
    });
    if (!res.ok) {
      return {} as Record<string, { onboardingStatus: Participant["onboardingStatus"] }>;
    }
    const data = (await res.json()) as {
      statuses?: Record<
        string,
        { onboardingStatus: Participant["onboardingStatus"] }
      >;
    };
    return data.statuses ?? {};
  };

  const fetchRegisteredUsers = async () => {
    const token = await getAdminToken();
    if (!token) return [] as AdminUser[];
    const res = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [] as AdminUser[];
    const data = (await res.json()) as { users?: AdminUser[] };
    return data.users ?? [];
  };

  const loadOnboardingSettings = async () => {
    const res = await fetch("/api/onboarding");
    if (!res.ok) return;
    const data = (await res.json()) as Partial<OnboardingSettings>;
    setOnboardingSettings({
      durationMinutes: Number(data.durationMinutes) || 20,
    });
  };

  const saveOnboardingSettings = async () => {
    const token = await getAdminToken();
    if (!token) {
      alert("관리자 인증 정보가 없습니다. 다시 로그인해주세요.");
      return;
    }
    setIsSavingOnboardingSettings(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(onboardingSettings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `온보딩 설정 저장 실패 (${res.status})`);
      }
      await loadOnboardingSettings();
    } catch (error) {
      console.error("[admin] onboarding settings save failed", error);
      alert("온보딩 설정 저장에 실패했습니다.");
    } finally {
      setIsSavingOnboardingSettings(false);
    }
  };

  const deleteAllMemory = async (userId: string) => {
    if (!confirm("이 유저의 메모리를 전체 삭제할까요?")) return;
    const token = await getAdminToken();
    if (!token) return;
    setIsDeletingMemory(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/memory`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("삭제 실패");
      setMemoryModal(null);
    } catch (e) {
      alert("메모리 삭제에 실패했습니다.");
      console.error(e);
    } finally {
      setIsDeletingMemory(false);
    }
  };

  const openMemoryTable = async (user: AdminUser) => {
    const token = await getAdminToken();
    if (!token) return;
    setIsLoadingMemory(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/memory`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("메모리 조회 실패");
      const data = await res.json();
      const counts = data.counts ?? {};
      setMemoryVersionTab((counts["0.1.1"] ?? 0) > 0 ? "0.1.1" : "0.1.0");
      setMemoryModal({
        userId: user.id,
        userName: user.displayName ?? user.email ?? user.id,
        rows: Array.isArray(data.memories) ? data.memories : [],
        counts,
      });
    } catch (e) {
      alert("메모리를 불러오지 못했습니다.");
      console.error(e);
    } finally {
      setIsLoadingMemory(false);
    }
  };

  const backupAndDeleteSessions = async (user: AdminUser) => {
    const label = user.displayName ?? user.email ?? user.id;
    if (
      !confirm(
        `${label}의 세션 데이터와 프레젠테이션 파일을 백업한 뒤 삭제할까요?\n\n메모리 컬렉션은 삭제하지 않습니다.`,
      )
    ) {
      return;
    }
    const token = await getAdminToken();
    if (!token) return;
    setDeletingSessionsUserId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm: "backup-and-delete-sessions" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "세션 삭제 실패");
      alert(
        [
          "백업 후 세션 삭제가 완료됐습니다.",
          `백업 경로: ${data.backupPath}`,
          `삭제된 세션: ${data.deletedSessionMissions ?? 0}개`,
          `삭제된 참여 기록: ${data.deletedParticipantRecords ?? 0}개`,
          `삭제된 memoryDrafts: ${data.deletedMemoryDrafts ?? 0}개`,
          `삭제된 Storage 파일: ${data.deletedStorageFiles ?? 0}개`,
        ].join("\n"),
      );
      await loadUsers();
    } catch (e) {
      alert("세션 백업/삭제에 실패했습니다.");
      console.error(e);
    } finally {
      setDeletingSessionsUserId(null);
    }
  };

  const loadUsers = async () => {
    if (!ready) return;
    setIsLoadingUsers(true);
    const users = new Map<string, AdminUser>();
    const upsertUser = (id: string, changes: Partial<AdminUser> = {}) => {
      const prev = users.get(id);
      users.set(id, {
        id,
        displayName: changes.displayName ?? prev?.displayName ?? null,
        email: changes.email ?? prev?.email ?? null,
        photoURL: changes.photoURL ?? prev?.photoURL ?? null,
        updatedAt: changes.updatedAt ?? prev?.updatedAt ?? 0,
        onboardingStatus:
          changes.onboardingStatus ?? prev?.onboardingStatus ?? "unknown",
        isAdmin:
          changes.isAdmin ??
          prev?.isAdmin ??
          ADMIN_EMAILS.includes(changes.email ?? prev?.email ?? ""),
        missionIds: changes.missionIds ?? prev?.missionIds ?? [],
        sessionMissionIds:
          changes.sessionMissionIds ?? prev?.sessionMissionIds ?? [],
        sessionRuns: changes.sessionRuns ?? prev?.sessionRuns ?? [],
      });
    };

    const registeredUsers = await fetchRegisteredUsers();
    registeredUsers.forEach((user) => {
      upsertUser(user.id, {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        updatedAt: user.updatedAt,
        onboardingStatus: user.onboardingStatus,
        isAdmin: user.isAdmin,
      });
    });

    await Promise.all(
      missions.map(async (mission) => {
        const snap = await getDocs(
          collection(db, "missions", mission.id, "participants"),
        ).catch(() => null);
        snap?.docs.forEach((participantDoc) => {
          const data = participantDoc.data() as Partial<Participant>;
          const existing = users.get(participantDoc.id);
          upsertUser(participantDoc.id, {
            displayName: data.displayName ?? existing?.displayName ?? null,
            email: data.email ?? existing?.email ?? null,
            photoURL: data.photoURL ?? existing?.photoURL ?? null,
            updatedAt: data.updatedAt ?? existing?.updatedAt ?? 0,
            isAdmin: ADMIN_EMAILS.includes(
              data.email ?? existing?.email ?? "",
            ),
            missionIds: Array.from(
              new Set([...(existing?.missionIds ?? []), mission.id]),
            ),
          });
        });
      }),
    );

    const sessionsSnap = await getDocs(collection(db, "sessions")).catch(
      () => null,
    );
    await Promise.all(
      (sessionsSnap?.docs ?? []).map(async (userDoc) => {
        const existing = users.get(userDoc.id);
        const sessionMissionSnap = await getDocs(
          collection(db, "sessions", userDoc.id, "missions"),
        ).catch(() => null);
        const sessionMissionIds =
          sessionMissionSnap?.docs.map((missionDoc) => missionDoc.id) ?? [];
        const sessionRunSnap = await getDocs(
          collection(db, "sessions", userDoc.id, "missionRuns"),
        ).catch(() => null);
        const sessionRuns =
          sessionRunSnap?.docs.map((runDoc) => {
            const data = runDoc.data() as {
              missionId?: string;
              missionTitle?: string;
              updatedAt?: number;
            };
            return {
              runId: runDoc.id,
              missionId: data.missionId ?? runDoc.id,
              missionTitle: data.missionTitle,
              updatedAt: data.updatedAt,
            };
          }) ?? [];
        upsertUser(userDoc.id, {
          missionIds: Array.from(
            new Set([
              ...(existing?.missionIds ?? []),
              ...sessionMissionIds,
              ...sessionRuns.map((run) => run.missionId),
            ]),
          ),
          sessionMissionIds: Array.from(
            new Set([
              ...(existing?.sessionMissionIds ?? []),
              ...sessionMissionIds,
            ]),
          ),
          sessionRuns: [...(existing?.sessionRuns ?? []), ...sessionRuns],
        });
      }),
    );

    const rawUsers = Array.from(users.values());
    const statuses = await fetchOnboardingStatuses(rawUsers.map((user) => user.id));
    const enrichedUsers = rawUsers.map((user) => ({
      ...user,
      isAdmin: ADMIN_EMAILS.includes(user.email ?? ""),
      onboardingStatus:
        statuses[user.id]?.onboardingStatus ?? user.onboardingStatus,
    }));

    setAdminUsers(
      enrichedUsers.sort((a, b) =>
        (a.displayName ?? a.email ?? a.id).localeCompare(
          b.displayName ?? b.email ?? b.id,
        ),
      ),
    );
    setIsLoadingUsers(false);
  };

  useEffect(() => {
    if (!ready) return;
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, missions]);

  useEffect(() => {
    if (!ready) return;
    loadOnboardingSettings();
  }, [ready]);

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
  const visibleMemoryRows =
    memoryModal?.rows.filter(
      (row) => (row.version ?? "0.1.0") === memoryVersionTab,
    ) ?? [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Memory modal */}
      {memoryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setMemoryModal(null)}
        >
          <div
            className="w-full max-w-[95vw] rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">유저 메모리</p>
                <p className="text-xs text-slate-400">{memoryModal.userName}</p>
                <p className="mt-1 text-xs text-slate-400">
                  v0.1.0 {memoryModal.counts["0.1.0"] ?? 0}개 · v0.1.1 {memoryModal.counts["0.1.1"] ?? 0}개
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMemoryModal(null)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="border-b border-slate-100 px-6 py-3">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                {(["0.1.1", "0.1.0"] as const).map((version) => (
                  <button
                    key={version}
                    type="button"
                    onClick={() => setMemoryVersionTab(version)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      memoryVersionTab === version
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    v{version} ({memoryModal.counts[version] ?? 0})
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto px-6 py-4">
              {visibleMemoryRows.length === 0 ? (
                <p className="text-sm text-slate-400">v{memoryVersionTab} 메모리 없음</p>
              ) : (
                <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-xs text-slate-600">
                  <thead className="sticky top-0 bg-white text-slate-400">
                    <tr>
                      {["Version", "Type", "Input", "Output", "Timestamp", "Category", "Subcategory", "Keywords", "Episode", "Semantic"].map((label) => (
                        <th key={label} className="border-b border-slate-100 px-3 py-2 font-semibold">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMemoryRows.map((row) => (
                      <tr key={`${row.version ?? "unknown"}-${row.type}-${row.id}`} className="align-top">
                        <td className="whitespace-nowrap border-b border-slate-50 px-3 py-2 font-semibold text-slate-500">{row.version ?? "0.1.0"}</td>
                        <td className="border-b border-slate-50 px-3 py-2 font-semibold text-slate-500">{row.type}</td>
                        <td className="max-w-56 border-b border-slate-50 px-3 py-2">{row.input ?? ""}</td>
                        <td className="max-w-56 border-b border-slate-50 px-3 py-2">{row.output ?? ""}</td>
                        <td className="whitespace-nowrap border-b border-slate-50 px-3 py-2">{row.timestamp ? new Date(row.timestamp).toLocaleString("ko-KR") : ""}</td>
                        <td className="border-b border-slate-50 px-3 py-2">{(row.category ?? []).join(", ")}</td>
                        <td className="border-b border-slate-50 px-3 py-2">{(row.subcategory ?? []).join(", ")}</td>
                        <td className="border-b border-slate-50 px-3 py-2">{(row.keywords ?? []).join(", ")}</td>
                        <td className="max-w-64 border-b border-slate-50 px-3 py-2">{row.episode ?? ""}</td>
                        <td className="max-w-64 border-b border-slate-50 px-3 py-2">{row.semantic ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => deleteAllMemory(memoryModal.userId)}
                disabled={isDeletingMemory}
                className="rounded-2xl bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
              >
                {isDeletingMemory ? "삭제 중..." : "메모리 전체 삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 lg:px-10">
        <section className="space-y-4">

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">유저 목록</h2>
              <p className="text-sm text-slate-400">
                미션 참여 기록과 세션 데이터를 유저별로 모아봅니다.
              </p>
            </div>
            <button
              type="button"
              onClick={loadUsers}
              disabled={isLoadingUsers}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {isLoadingUsers ? "불러오는 중..." : "새로고침"}
            </button>
          </div>

          {adminUsers.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white text-sm text-slate-400">
              {isLoadingUsers ? "유저 데이터를 불러오는 중입니다." : "아직 유저 데이터가 없습니다."}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {adminUsers.map((user) => {
                const badge = onboardingBadge(user.onboardingStatus);
                const missionIds = Array.from(new Set(user.missionIds));
                return (
                  <div
                    key={user.id}
                    className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                          {(user.displayName ?? user.email ?? "?")
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {user.displayName ?? user.email ?? user.id}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.style}`}
                          >
                            {badge.label}
                          </span>
                          {user.isAdmin && (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                              관리자
                            </span>
                          )}
                        </div>
                        {user.displayName && user.email && (
                          <p className="truncate text-xs text-slate-400">
                            {user.email}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-slate-300">
                          {user.id}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {missionIds.length === 0 ? (
                        <span className="text-xs text-slate-400">
                          연결된 미션 없음
                        </span>
                      ) : (
                        missionIds.map((missionId) => (
                          <Link
                            key={missionId}
                            href={`/main/${missionId}?viewAs=${user.id}`}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                          >
                            {missionTitle(missionId)}
                          </Link>
                        ))
                      )}
                    </div>

                    {user.sessionRuns && user.sessionRuns.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {user.sessionRuns
                          .slice()
                          .sort(
                            (a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0),
                          )
                          .map((run) => (
                            <Link
                              key={run.runId}
                              href={`/main/${run.missionId}?viewAs=${user.id}&run=${encodeURIComponent(run.runId)}`}
                              className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-100"
                            >
                              {run.missionTitle || missionTitle(run.missionId)} · run
                            </Link>
                          ))}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openMemoryTable(user)}
                        disabled={isLoadingMemory}
                        className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 disabled:text-slate-300"
                      >
                        메모리 테이블 보기 →
                      </button>
                      <button
                        type="button"
                        onClick={() => backupAndDeleteSessions(user)}
                        disabled={deletingSessionsUserId === user.id}
                        className="text-[11px] font-semibold text-red-400 hover:text-red-600 disabled:text-slate-300"
                      >
                        {deletingSessionsUserId === user.id
                          ? "백업/삭제 중..."
                          : "세션 백업 후 삭제"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">미션 목록</h2>
          <span className="text-sm text-slate-400">{missions.length}개</span>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-500">
                온보딩 설정
              </p>
              <p className="mt-1 text-xs text-slate-400">
                유저 {adminUsers.length}명
              </p>
            </div>
            <button
              type="button"
              onClick={openOnboardingParticipants}
              className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-slate-600"
              title="온보딩 유저 보기"
            >
              <UsersThreeIcon size={16} />
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-semibold text-slate-500">
              제한 시간
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={onboardingSettings.durationMinutes}
                  onChange={(e) =>
                    setOnboardingSettings((prev) => ({
                      ...prev,
                      durationMinutes: Number(e.target.value) || 20,
                    }))
                  }
                  className="block w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                />
                <span className="text-sm font-normal text-slate-400">분</span>
              </div>
            </label>
            <button
              type="button"
              onClick={saveOnboardingSettings}
              disabled={isSavingOnboardingSettings}
              className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {isSavingOnboardingSettings ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>

        {missions.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white text-sm text-slate-400">
            아직 미션이 없습니다. 첫 미션을 만들어보세요.
          </div>
        ) : (
          <div className="space-y-3">
            {missions.map((mission) => {
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
        </section>
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
              <h3 className="text-lg font-semibold text-slate-900">
                {missionTitle(participantsMissionId)} 참여자
              </h3>
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
                  아직 유저 데이터가 없습니다.
                </p>
              ) : (
                participants.map((p) => {
                  const badge = onboardingBadge(p.onboardingStatus);
                  return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-2xl border border-slate-100 px-4 py-3"
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
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {p.displayName ?? p.email ?? p.id}
                      </p>
                      {p.displayName && p.email && (
                        <p className="truncate text-xs text-slate-400">
                          {p.email}
                        </p>
                      )}
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.style}`}
                      >
                        {badge.label}
                      </span>
                      {p.isAdmin && (
                        <span className="ml-1 mt-1 inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                          관리자
                        </span>
                      )}
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <Link
                        href={`/main/${participantsMissionId}?viewAs=${p.id}`}
                        className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
                        onClick={closeParticipants}
                        title="세션 보기"
                      >
                        <ArrowRightIcon size={14} />
                      </Link>
                      <button
                        type="button"
                        onClick={() => deleteUserData(p)}
                        className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                        title={p.isAdmin ? "관리자 기록 삭제" : "유저 데이터 삭제"}
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  </div>
                );
                })
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
