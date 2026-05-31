"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DeviceMobileIcon,
  MonitorIcon,
  XIcon,
  PencilSimpleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
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
import { isAdminEmail } from "@/lib/admin";

const MemoryClusterGraph = dynamic(() => import("./MemoryClusterGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-112 min-h-96 items-center justify-center rounded-2xl border border-slate-100 bg-white text-sm text-slate-400 shadow-sm">
      Graph view loading...
    </div>
  ),
});

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
};

type AdminMemoryRow = {
  id: string;
  version?: string;
  type: "episodic" | "semantic" | "interaction" | string;
  input?: string;
  output?: string;
  link?: string | null;
  timestamp?: number;
  category?: string[];
  subcategory?: string[];
  keyword?: string[];
  keywords?: string[];
  episode?: string;
  semantic?: string;
  weight?: number;
  semanticItems?: Array<{
    semantic?: string;
    retentionScore?: number;
    weight?: number;
    archivedAt?: number | null;
  }>;
  agentActionCategory?: string;
  source?: { missionId?: string; draftId?: string };
};

type MemoryCounts = Record<string, number>;
type MemoryVersionTab = "0.1.0" | "0.1.1" | "0.1.2";
type MemorySortKey =
  | "timestamp"
  | "action"
  | "semantic"
  | "retentionMax"
  | "retentionMin"
  | "retentionAvg";
type SortDirection = "asc" | "desc";
type SemanticFilter = "all" | "with" | "without";
type MemoryViewTab =
  | "table"
  | "clusters"
  | "retrievals"
  | "forgetting"
  | "archived";
type MemoryClusterViewTab = "graph" | "detail";

type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
};

type MemoryGraphClusterDiagnostics = {
  duplicateItemIds: string[];
  recoveredUnassignedItemIds?: string[];
  unassignedItemIds: string[];
  method?: string;
  embeddingModel?: string;
  labelModel?: string;
  requestedClusterCount?: null;
  actualClusterCount?: number;
  graph?: {
    minSimilarity: number;
    strongSimilarity: number;
    knnEdges: number;
    nodeCount: number;
    edgeCount: number;
    averageDegree: number;
    singletonCount: number;
    rawCommunityCount: number;
    cappedCommunityCount: number;
  };
};

type MemoryRetrievalItem = {
  id: string;
  memoryId: string;
  semanticItemId: string | null;
  semantic: string;
  episodic?: string;
  episode?: string;
  similarity: number | null;
  weight?: number | null;
  retrievedCount: number;
  archivedAt?: number | null;
  source?: { missionId?: string; draftId?: string } | null;
  timestamp?: number | null;
};

type MemoryRetrievalScoreDelta = {
  memoryId?: string;
  semanticItemId?: string | null;
  weight?: number;
  weightDelta?: number;
};

type MemoryRetrievalLog = {
  id: string;
  query: string;
  missionId?: string | null;
  queryEmbeddingModel?: string;
  createdAt: number;
  retrieved: MemoryRetrievalItem[];
  scoreDeltas: MemoryRetrievalScoreDelta[];
};

type MemoryForgettingCandidate = {
  id: string;
  reason: "low-weight" | "duplicate";
  reasonLabel: string;
  memoryId: string;
  semanticItemId: string | null;
  semantic: string | null;
  episodic?: string;
  weight?: number | null;
  retrievedCount: number;
  lastRetrievedAt: number | null;
  createdAt: number | null;
  archivedAt?: number | null;
  archiveReason?: string | null;
  duplicateOf?: string | null;
  source?: { missionId?: string; draftId?: string } | null;
  keywords?: string[];
  duplicate?: {
    memoryId: string;
    semanticItemId: string | null;
    semantic: string | null;
    episodic?: string;
    similarity: number;
  };
};

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

function semanticItems(row: AdminMemoryRow) {
  return typeof row.semantic === "string"
    ? row.semantic
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function memoryWeights(row: AdminMemoryRow) {
  if (typeof row.weight === "number" && Number.isFinite(row.weight)) {
    return [row.weight];
  }
  return Array.isArray(row.semanticItems)
    ? row.semanticItems.map((item) =>
        typeof (item.weight ?? item.retentionScore) === "number" &&
        Number.isFinite(item.weight ?? item.retentionScore)
          ? (item.weight ?? item.retentionScore)
          : null,
      )
    : [];
}

function numericMemoryWeights(row: AdminMemoryRow) {
  return memoryWeights(row).filter(
    (score): score is number => typeof score === "number",
  );
}

function memoryWeightSortValue(row: AdminMemoryRow, mode: MemorySortKey) {
  const weights = numericMemoryWeights(row);
  if (weights.length === 0) return null;
  if (mode === "retentionMax") return Math.max(...weights);
  if (mode === "retentionMin") return Math.min(...weights);
  if (mode === "retentionAvg") {
    return weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
  }
  return null;
}

function dateInputValue(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function parseMemoryGraphClusterDiagnostics(value: unknown) {
  const diagnostics = value as Partial<MemoryGraphClusterDiagnostics>;
  const graph = diagnostics?.graph as
    | Partial<NonNullable<MemoryGraphClusterDiagnostics["graph"]>>
    | undefined;
  return diagnostics &&
    Array.isArray(diagnostics.duplicateItemIds) &&
    Array.isArray(diagnostics.unassignedItemIds) &&
    graph
    ? {
        duplicateItemIds: diagnostics.duplicateItemIds,
        recoveredUnassignedItemIds: Array.isArray(
          diagnostics.recoveredUnassignedItemIds,
        )
          ? diagnostics.recoveredUnassignedItemIds
          : [],
        unassignedItemIds: diagnostics.unassignedItemIds,
        method:
          typeof diagnostics.method === "string" ? diagnostics.method : "",
        embeddingModel:
          typeof diagnostics.embeddingModel === "string"
            ? diagnostics.embeddingModel
            : "",
        labelModel:
          typeof diagnostics.labelModel === "string"
            ? diagnostics.labelModel
            : "",
        requestedClusterCount: null,
        actualClusterCount:
          typeof diagnostics.actualClusterCount === "number"
            ? diagnostics.actualClusterCount
            : undefined,
        graph: {
          minSimilarity: Number(graph.minSimilarity ?? 0),
          strongSimilarity: Number(graph.strongSimilarity ?? 0),
          knnEdges: Number(graph.knnEdges ?? 0),
          nodeCount: Number(graph.nodeCount ?? 0),
          edgeCount: Number(graph.edgeCount ?? 0),
          averageDegree: Number(graph.averageDegree ?? 0),
          singletonCount: Number(graph.singletonCount ?? 0),
          rawCommunityCount: Number(graph.rawCommunityCount ?? 0),
          cappedCommunityCount: Number(graph.cappedCommunityCount ?? 0),
        },
      }
    : null;
}

function formatScore(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "—";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
  const [participantsMissionId, setParticipantsMissionId] = useState<
    string | null
  >(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [memoryModal, setMemoryModal] = useState<{
    userId: string;
    userName: string;
    rows: AdminMemoryRow[];
    counts: MemoryCounts;
  } | null>(null);
  const [memoryVersionTab, setMemoryVersionTab] =
    useState<MemoryVersionTab>("0.1.2");
  const [memorySortKey, setMemorySortKey] =
    useState<MemorySortKey>("timestamp");
  const [memorySortDirection, setMemorySortDirection] =
    useState<SortDirection>("desc");
  const [memoryActionFilter, setMemoryActionFilter] = useState("all");
  const [memorySemanticFilter, setMemorySemanticFilter] =
    useState<SemanticFilter>("all");
  const [memoryStartDate, setMemoryStartDate] = useState("");
  const [memoryEndDate, setMemoryEndDate] = useState("");
  const [memoryViewTab, setMemoryViewTab] = useState<MemoryViewTab>("table");
  const [memoryClusterViewTab, setMemoryClusterViewTab] =
    useState<MemoryClusterViewTab>("graph");
  const [memoryGraphClusters, setMemoryGraphClusters] = useState<
    MemoryCluster[]
  >([]);
  const [selectedMemoryClusterId, setSelectedMemoryClusterId] = useState<
    string | null
  >(null);
  const [isLoadingMemoryClusters, setIsLoadingMemoryClusters] = useState(false);
  const [isClusteringMemory, setIsClusteringMemory] = useState(false);
  const [memoryClusterError, setMemoryClusterError] = useState<string | null>(
    null,
  );
  const [memoryGraphClusterDiagnostics, setMemoryGraphClusterDiagnostics] =
    useState<MemoryGraphClusterDiagnostics | null>(null);
  const [memoryRetrievalLogs, setMemoryRetrievalLogs] = useState<
    MemoryRetrievalLog[]
  >([]);
  const [selectedMemoryRetrievalId, setSelectedMemoryRetrievalId] = useState<
    string | null
  >(null);
  const [isLoadingMemoryRetrievals, setIsLoadingMemoryRetrievals] =
    useState(false);
  const [memoryRetrievalError, setMemoryRetrievalError] = useState<
    string | null
  >(null);
  const [memoryForgettingCandidates, setMemoryForgettingCandidates] = useState<
    MemoryForgettingCandidate[]
  >([]);
  const [memoryArchivedItems, setMemoryArchivedItems] = useState<
    MemoryForgettingCandidate[]
  >([]);
  const [selectedMemoryForgettingId, setSelectedMemoryForgettingId] = useState<
    string | null
  >(null);
  const [selectedMemoryArchivedId, setSelectedMemoryArchivedId] = useState<
    string | null
  >(null);
  const [isLoadingMemoryForgetting, setIsLoadingMemoryForgetting] =
    useState(false);
  const [memoryForgettingError, setMemoryForgettingError] = useState<
    string | null
  >(null);
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [isDeletingMemory, setIsDeletingMemory] = useState(false);
  const [deletingSessionsUserId, setDeletingSessionsUserId] = useState<
    string | null
  >(null);
  const [onboardingSettings, setOnboardingSettings] =
    useState<OnboardingSettings>(defaultOnboardingSettings);
  const [isSavingOnboardingSettings, setIsSavingOnboardingSettings] =
    useState(false);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user || !isAdminEmail(user.email)) {
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

  useEffect(() => {
    if (!memoryModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [memoryModal]);

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
      options:
        normalizeOptions(mission.options).length > 0
          ? normalizeOptions(mission.options)
          : [createEmptyOption()],
    });
  };

  const saveEdit = async (id: string) => {
    if (editFields.title?.trim()) {
      const clean = <T,>(v: T): T =>
        JSON.parse(
          JSON.stringify(v, (_, val) => (val === undefined ? null : val)),
        );
      await updateDoc(
        doc(db, "missions", id),
        clean({
          title: editFields.title.trim(),
          description: editFields.description?.trim() ?? "",
          device: editFields.device ?? "desktop",
          durationMinutes:
            (editFields.durationMinutes as number) > 0
              ? editFields.durationMinutes
              : null,
          options: normalizeOptions(
            editFields.options as MissionOption[],
          ).filter((option) => option.title.trim()),
        }),
      );
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
      participant.isAdmin = isAdminEmail(participant.email);
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
    const label =
      participant.displayName ?? participant.email ?? participant.id;
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
      : (missions.find((mission) => mission.id === missionId)?.title ??
        missionId);

  const getAdminToken = async () => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return null;
    return getIdToken(currentUser);
  };

  const fetchOnboardingStatuses = async (uids: string[]) => {
    const token = await getAdminToken();
    if (!token || uids.length === 0) {
      return {} as Record<
        string,
        { onboardingStatus: Participant["onboardingStatus"] }
      >;
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
      return {} as Record<
        string,
        { onboardingStatus: Participant["onboardingStatus"] }
      >;
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

  const deleteAllMemory = async (userId: string, version: string) => {
    if (!confirm(`v${version} 메모리를 전체 삭제할까요?`)) return;
    const token = await getAdminToken();
    if (!token) return;
    setIsDeletingMemory(true);
    try {
      const res = await fetch(
        `/api/admin/users/${userId}/memory?version=${encodeURIComponent(version)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
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
      setMemoryVersionTab(
        (counts["0.1.2"] ?? 0) > 0
          ? "0.1.2"
          : (counts["0.1.1"] ?? 0) > 0
            ? "0.1.1"
            : "0.1.0",
      );
      resetMemoryFilters();
      setMemoryViewTab("table");
      setMemoryClusterViewTab("graph");
      setMemoryGraphClusters([]);
      setSelectedMemoryClusterId(null);
      setMemoryClusterError(null);
      setMemoryGraphClusterDiagnostics(null);
      setMemoryRetrievalLogs([]);
      setSelectedMemoryRetrievalId(null);
      setMemoryRetrievalError(null);
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
          isAdminEmail(changes.email ?? prev?.email),
        missionIds: changes.missionIds ?? prev?.missionIds ?? [],
        sessionMissionIds:
          changes.sessionMissionIds ?? prev?.sessionMissionIds ?? [],
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
            isAdmin: isAdminEmail(data.email ?? existing?.email),
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
        upsertUser(userDoc.id, {
          missionIds: Array.from(
            new Set([...(existing?.missionIds ?? []), ...sessionMissionIds]),
          ),
          sessionMissionIds: Array.from(
            new Set([
              ...(existing?.sessionMissionIds ?? []),
              ...sessionMissionIds,
            ]),
          ),
        });
      }),
    );

    const rawUsers = Array.from(users.values());
    const statuses = await fetchOnboardingStatuses(
      rawUsers.map((user) => user.id),
    );
    const enrichedUsers = rawUsers.map((user) => ({
      ...user,
      isAdmin: isAdminEmail(user.email),
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
        options: options.map((option) =>
          option.id === id ? { ...option, ...changes } : option,
        ),
      };
    });
  };

  const addEditOption = () => {
    setEditFields((prev) => ({
      ...prev,
      options: [
        ...normalizeOptions(prev.options as MissionOption[]),
        createEmptyOption(),
      ],
    }));
  };

  const removeEditOption = (id: string) => {
    setEditFields((prev) => {
      const options = normalizeOptions(prev.options as MissionOption[]);
      return {
        ...prev,
        options:
          options.length <= 1
            ? options
            : options.filter((option) => option.id !== id),
      };
    });
  };

  const versionMemoryRows = useMemo(
    () =>
      memoryModal?.rows.filter(
        (row) => (row.version ?? "0.1.0") === memoryVersionTab,
      ) ?? [],
    [memoryModal?.rows, memoryVersionTab],
  );
  const memoryActionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          versionMemoryRows
            .map((row) => row.agentActionCategory ?? "")
            .filter(Boolean),
        ),
      ).sort(),
    [versionMemoryRows],
  );
  const visibleMemoryRows = useMemo(() => {
    const startTime = memoryStartDate
      ? new Date(`${memoryStartDate}T00:00:00`).getTime()
      : null;
    const endTime = memoryEndDate
      ? new Date(`${memoryEndDate}T23:59:59.999`).getTime()
      : null;
    const rows = versionMemoryRows.filter((row) => {
      const timestamp = Number(row.timestamp ?? 0);
      const hasSemantic = semanticItems(row).length > 0;
      if (memoryActionFilter !== "all") {
        if ((row.agentActionCategory ?? "") !== memoryActionFilter)
          return false;
      }
      if (memorySemanticFilter === "with" && !hasSemantic) return false;
      if (memorySemanticFilter === "without" && hasSemantic) return false;
      if (startTime != null && timestamp < startTime) return false;
      if (endTime != null && timestamp > endTime) return false;
      return true;
    });
    const direction = memorySortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (memorySortKey === "timestamp") {
        return (
          (Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0)) * direction
        );
      }
      if (memorySortKey === "semantic") {
        return (semanticItems(a).length - semanticItems(b).length) * direction;
      }
      if (
        memorySortKey === "retentionMax" ||
        memorySortKey === "retentionMin" ||
        memorySortKey === "retentionAvg"
      ) {
        const aValue = memoryWeightSortValue(a, memorySortKey);
        const bValue = memoryWeightSortValue(b, memorySortKey);
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        return (aValue - bValue) * direction;
      }
      return (
        (a.agentActionCategory ?? "").localeCompare(
          b.agentActionCategory ?? "",
        ) * direction
      );
    });
  }, [
    versionMemoryRows,
    memoryActionFilter,
    memorySemanticFilter,
    memoryStartDate,
    memoryEndDate,
    memorySortKey,
    memorySortDirection,
  ]);
  const clusterableMemoryItems = useMemo(
    () =>
      visibleMemoryRows
        .filter(
          (row) =>
            row.episode ||
            row.semantic ||
            row.input ||
            row.output ||
            (row.keyword ?? row.keywords ?? []).length > 0,
        )
        .map((row) => ({
          id: row.id,
          memoryId: row.id,
          semantic: row.semantic ?? "",
          episodic: row.episode ?? "",
          input: row.input ?? "",
          output: row.output ?? "",
          link: row.link ?? "",
          action: row.agentActionCategory ?? "",
          timestamp: row.timestamp ?? 0,
          keyword: row.keyword ?? row.keywords ?? [],
          keywords: row.keyword ?? row.keywords ?? [],
          row,
        })),
    [visibleMemoryRows],
  );
  const clusterableItemById = useMemo(
    () =>
      new Map(clusterableMemoryItems.map((item) => [item.id, item] as const)),
    [clusterableMemoryItems],
  );
  const activeMemoryClusters = memoryGraphClusters;
  const activeMemoryClusterDiagnostics = memoryGraphClusterDiagnostics;
  const selectedMemoryCluster =
    activeMemoryClusters.find(
      (cluster) => cluster.id === selectedMemoryClusterId,
    ) ??
    activeMemoryClusters[0] ??
    null;
  const selectedClusterItems = selectedMemoryCluster
    ? selectedMemoryCluster.itemIds
        .map((id) => clusterableItemById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const selectedMemoryRetrieval =
    memoryRetrievalLogs.find((log) => log.id === selectedMemoryRetrievalId) ??
    memoryRetrievalLogs[0] ??
    null;
  const selectedMemoryForgetting =
    memoryForgettingCandidates.find(
      (candidate) => candidate.id === selectedMemoryForgettingId,
    ) ??
    memoryForgettingCandidates[0] ??
    null;
  const selectedMemoryArchived =
    memoryArchivedItems.find((item) => item.id === selectedMemoryArchivedId) ??
    memoryArchivedItems[0] ??
    null;
  const clusterInputSignature = useMemo(() => {
    const rawSignature = clusterableMemoryItems
      .map((item) =>
        [
          item.id,
          item.action,
          item.keyword.join(","),
          item.episodic,
          item.semantic,
          item.input,
          item.output,
          item.link,
          item.timestamp,
        ].join(":"),
      )
      .join("|");
    return `${clusterableMemoryItems.length}-${stableHash(rawSignature)}`;
  }, [clusterableMemoryItems]);
  useEffect(() => {
    setSelectedMemoryClusterId(activeMemoryClusters[0]?.id ?? null);
  }, [activeMemoryClusters]);
  useEffect(() => {
    setMemoryGraphClusters([]);
    setSelectedMemoryClusterId(null);
    setMemoryClusterError(null);
    setMemoryGraphClusterDiagnostics(null);
    setIsLoadingMemoryClusters(false);
    if (!memoryModal || clusterableMemoryItems.length === 0) return;

    let cancelled = false;
    const loadSavedClusters = async () => {
      const token = await getAdminToken();
      if (!token) return;
      setIsLoadingMemoryClusters(true);
      try {
        const params = new URLSearchParams({
          version: memoryVersionTab,
          signature: clusterInputSignature,
        });
        const res = await fetch(
          `/api/admin/users/${encodeURIComponent(
            memoryModal.userId,
          )}/memory/clusters?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "클러스터 조회 실패");
        if (cancelled || !data?.cacheHit) return;
        const graphClusters = Array.isArray(data.graphClusters)
          ? data.graphClusters
          : [];
        setMemoryGraphClusters(graphClusters);
        setMemoryGraphClusterDiagnostics(
          parseMemoryGraphClusterDiagnostics(data.graphDiagnostics),
        );
        setSelectedMemoryClusterId(graphClusters[0]?.id ?? null);
      } catch (error) {
        if (cancelled) return;
        console.error("[admin] saved memory clusters load failed", error);
        setMemoryClusterError("저장된 클러스터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setIsLoadingMemoryClusters(false);
      }
    };

    loadSavedClusters();
    return () => {
      cancelled = true;
    };
  }, [
    clusterInputSignature,
    clusterableMemoryItems.length,
    memoryModal,
    memoryVersionTab,
  ]);
  useEffect(() => {
    setMemoryRetrievalError(null);
    if (!memoryModal || memoryViewTab !== "retrievals") return;
    let cancelled = false;
    const loadRetrievals = async () => {
      const token = await getAdminToken();
      if (!token) return;
      setIsLoadingMemoryRetrievals(true);
      try {
        const res = await fetch(
          `/api/admin/users/${encodeURIComponent(
            memoryModal.userId,
          )}/memory/retrievals`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(data?.error ?? "retrieval log load failed");
        if (cancelled) return;
        const retrievals = Array.isArray(data?.retrievals)
          ? (data.retrievals as MemoryRetrievalLog[])
          : [];
        setMemoryRetrievalLogs(retrievals);
        setSelectedMemoryRetrievalId((current) =>
          current && retrievals.some((log) => log.id === current)
            ? current
            : (retrievals[0]?.id ?? null),
        );
      } catch (error) {
        if (cancelled) return;
        console.error("[admin] memory retrieval logs load failed", error);
        setMemoryRetrievalError("Retrieval logs를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setIsLoadingMemoryRetrievals(false);
      }
    };
    loadRetrievals();
    return () => {
      cancelled = true;
    };
  }, [memoryModal, memoryViewTab]);

  useEffect(() => {
    setMemoryForgettingError(null);
    if (
      !memoryModal ||
      (memoryViewTab !== "forgetting" && memoryViewTab !== "archived")
    )
      return;
    let cancelled = false;
    const loadForgettingCandidates = async () => {
      const token = await getAdminToken();
      if (!token) return;
      setIsLoadingMemoryForgetting(true);
      try {
        const res = await fetch(
          `/api/admin/users/${encodeURIComponent(
            memoryModal.userId,
          )}/memory/forgetting`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error ?? "forgetting candidates load failed");
        }
        if (cancelled) return;
        const candidates = Array.isArray(data?.candidates)
          ? (data.candidates as MemoryForgettingCandidate[])
          : [];
        const archived = Array.isArray(data?.archived)
          ? (data.archived as MemoryForgettingCandidate[])
          : [];
        setMemoryForgettingCandidates(candidates);
        setMemoryArchivedItems(archived);
        setSelectedMemoryForgettingId((current) =>
          current && candidates.some((candidate) => candidate.id === current)
            ? current
            : (candidates[0]?.id ?? null),
        );
        setSelectedMemoryArchivedId((current) =>
          current && archived.some((item) => item.id === current)
            ? current
            : (archived[0]?.id ?? null),
        );
      } catch (error) {
        if (cancelled) return;
        console.error(
          "[admin] memory forgetting candidates load failed",
          error,
        );
        setMemoryForgettingError("Forgetting 후보를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setIsLoadingMemoryForgetting(false);
      }
    };
    loadForgettingCandidates();
    return () => {
      cancelled = true;
    };
  }, [memoryModal, memoryViewTab]);
  const resetMemoryFilters = () => {
    setMemoryActionFilter("all");
    setMemorySemanticFilter("all");
    setMemoryStartDate("");
    setMemoryEndDate("");
    setMemorySortKey("timestamp");
    setMemorySortDirection("desc");
  };

  const generateMemoryClusters = async () => {
    if (!memoryModal || clusterableMemoryItems.length === 0) return;
    const token = await getAdminToken();
    if (!token) return;
    setIsClusteringMemory(true);
    setMemoryClusterError(null);
    setMemoryGraphClusterDiagnostics(null);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(memoryModal.userId)}/memory/clusters`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            itemSignature: clusterInputSignature,
            memoryVersion: memoryVersionTab,
            items: clusterableMemoryItems.map((item) => ({
              id: item.id,
              action: item.action,
              keyword: item.keyword,
              episodic: item.episodic,
              semantic: item.semantic || undefined,
              input: item.input,
              output: item.output,
              link: item.link,
              timestamp: item.timestamp,
            })),
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "클러스터 생성 실패");
      const graphClusters = Array.isArray(data?.graphClusters)
        ? data.graphClusters
        : [];
      setMemoryGraphClusters(graphClusters);
      setMemoryGraphClusterDiagnostics(
        parseMemoryGraphClusterDiagnostics(data?.graphDiagnostics),
      );
      setSelectedMemoryClusterId(graphClusters[0]?.id ?? null);
      if (graphClusters.length === 0) {
        setMemoryClusterError("생성된 클러스터가 없습니다.");
      }
    } catch (error) {
      console.error("[admin] memory clustering failed", error);
      setMemoryClusterError("클러스터 생성에 실패했습니다.");
    } finally {
      setIsClusteringMemory(false);
    }
  };

  const copyMemoryClustersJson = async () => {
    if (!memoryModal || activeMemoryClusters.length === 0) return;
    const itemForExport = (id: string) => {
      const item = clusterableItemById.get(id);
      if (!item) return null;
      return {
        id: item.id,
        memoryId: item.memoryId,
        semantic: item.semantic,
        episode: item.episodic,
        input: item.input,
        action: item.action,
        timestamp: item.timestamp,
        missionId: item.row.source?.missionId ?? null,
        keywords: item.keywords,
      };
    };
    const payload = {
      exportedAt: new Date().toISOString(),
      userId: memoryModal.userId,
      userName: memoryModal.userName,
      memoryVersion: memoryVersionTab,
      filters: {
        startDate: memoryStartDate || null,
        endDate: memoryEndDate || null,
        action: memoryActionFilter,
        semantic: memorySemanticFilter,
        sortKey: memorySortKey,
        sortDirection: memorySortDirection,
      },
      sourceItemCount: clusterableMemoryItems.length,
      method: "similarity-graph",
      diagnostics: activeMemoryClusterDiagnostics,
      clusters: activeMemoryClusters.map((cluster) => ({
        ...cluster,
        items: cluster.itemIds.map(itemForExport).filter(Boolean),
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Memory modal */}
      {memoryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setMemoryModal(null)}
        >
          <div
            className="flex h-[calc(100vh-2rem)] w-full max-w-[95vw] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  유저 메모리
                </p>
                <p className="text-xs text-slate-400">{memoryModal.userName}</p>
                <p className="mt-1 text-xs text-slate-400">
                  v0.1.2 {memoryModal.counts["0.1.2"] ?? 0}개 · v0.1.1{" "}
                  {memoryModal.counts["0.1.1"] ?? 0}개 · v0.1.0{" "}
                  {memoryModal.counts["0.1.0"] ?? 0}개
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMemoryModal(null)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3 3l10 10M13 3L3 13"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="shrink-0 border-b border-slate-100 px-6 py-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {(
                    [
                      "table",
                      "clusters",
                      "retrievals",
                      "forgetting",
                      "archived",
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setMemoryViewTab(tab)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                        memoryViewTab === tab
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {tab === "table"
                        ? "Table"
                        : tab === "clusters"
                          ? "Clusters"
                          : tab === "retrievals"
                            ? "Retrievals"
                            : tab === "forgetting"
                              ? "Forgetting"
                              : "Archived"}
                    </button>
                  ))}
                </div>
                {(memoryViewTab === "table" ||
                  memoryViewTab === "clusters") && (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                    {(["0.1.2", "0.1.1", "0.1.0"] as const).map((version) => (
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
                )}
                {(memoryViewTab === "table" ||
                  memoryViewTab === "clusters") && (
                  <>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Start
                      <input
                        type="date"
                        value={memoryStartDate}
                        min={dateInputValue(
                          versionMemoryRows.at(-1)?.timestamp,
                        )}
                        max={
                          memoryEndDate ||
                          dateInputValue(versionMemoryRows[0]?.timestamp)
                        }
                        onChange={(e) => setMemoryStartDate(e.target.value)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-slate-700 outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      End
                      <input
                        type="date"
                        value={memoryEndDate}
                        min={
                          memoryStartDate ||
                          dateInputValue(versionMemoryRows.at(-1)?.timestamp)
                        }
                        max={dateInputValue(versionMemoryRows[0]?.timestamp)}
                        onChange={(e) => setMemoryEndDate(e.target.value)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-slate-700 outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Action
                      <select
                        value={memoryActionFilter}
                        onChange={(e) => setMemoryActionFilter(e.target.value)}
                        className="min-w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-slate-700 outline-none focus:border-slate-400"
                      >
                        <option value="all">All actions</option>
                        {memoryActionOptions.map((action) => (
                          <option key={action} value={action}>
                            {action}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Semantic
                      <select
                        value={memorySemanticFilter}
                        onChange={(e) =>
                          setMemorySemanticFilter(
                            e.target.value as SemanticFilter,
                          )
                        }
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-slate-700 outline-none focus:border-slate-400"
                      >
                        <option value="all">All</option>
                        <option value="with">With semantic</option>
                        <option value="without">No semantic</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Sort
                      <select
                        value={memorySortKey}
                        onChange={(e) =>
                          setMemorySortKey(e.target.value as MemorySortKey)
                        }
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-slate-700 outline-none focus:border-slate-400"
                      >
                        <option value="timestamp">Timestamp</option>
                        <option value="action">Action</option>
                        <option value="semantic">Semantic count</option>
                        <option value="retentionMax">Weight max</option>
                        <option value="retentionMin">Weight min</option>
                        <option value="retentionAvg">Weight avg</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setMemorySortDirection((prev) =>
                          prev === "desc" ? "asc" : "desc",
                        )
                      }
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      {memorySortDirection === "desc" ? "Desc" : "Asc"}
                    </button>
                    <button
                      type="button"
                      onClick={resetMemoryFilters}
                      className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-200"
                    >
                      Reset
                    </button>
                    <span className="ml-auto text-xs text-slate-400">
                      {visibleMemoryRows.length} / {versionMemoryRows.length}{" "}
                      rows
                    </span>
                  </>
                )}
                {memoryViewTab === "retrievals" && (
                  <span className="ml-auto text-xs text-slate-400">
                    {memoryRetrievalLogs.length} retrieval logs
                  </span>
                )}
                {memoryViewTab === "forgetting" && (
                  <span className="ml-auto text-xs text-slate-400">
                    {memoryForgettingCandidates.length} auto archived
                  </span>
                )}
                {memoryViewTab === "archived" && (
                  <span className="ml-auto text-xs text-slate-400">
                    {memoryArchivedItems.length} archived memories
                  </span>
                )}
              </div>
            </div>
            <div className="h-[calc(100vh-14rem)] min-h-80">
              {memoryViewTab === "table" ? (
                <div className="h-full overflow-y-auto overscroll-contain">
                  {visibleMemoryRows.length === 0 ? (
                    <p className="px-6 py-4 text-sm text-slate-400">
                      v{memoryVersionTab} 메모리 없음
                    </p>
                  ) : (
                    <table className="w-full min-w-240 border-separate border-spacing-0 text-left text-xs text-slate-600">
                      <thead className="sticky top-0 z-10 bg-white text-slate-400 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                        <tr>
                          {[
                            "Timestamp",
                            "Mission",
                            "Action",
                            "Input",
                            "Episode",
                            "Semantic",
                            "Weight",
                            "Keywords",
                          ].map((label) => (
                            <th
                              key={label}
                              className="border-b border-slate-100 px-3 py-2 font-semibold"
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMemoryRows.map((row) => {
                          const semantics = semanticItems(row);
                          const weights = memoryWeights(row);
                          return (
                            <tr
                              key={`${row.version ?? "unknown"}-${row.type}-${row.id}`}
                              className="align-top hover:bg-slate-50/60"
                            >
                              <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-slate-400">
                                {row.timestamp
                                  ? new Date(
                                      row.timestamp as number,
                                    ).toLocaleString("ko-KR", {
                                      month: "numeric",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "—"}
                              </td>
                              <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-xs text-slate-500">
                                {row.source?.missionId ?? "—"}
                              </td>
                              <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3">
                                {row.agentActionCategory ? (
                                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    {row.agentActionCategory}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                              <td className="max-w-64 wrap-anywhere border-b border-slate-100 px-3 py-3 text-slate-700">
                                {row.input ?? ""}
                              </td>
                              <td className="max-w-72 wrap-anywhere border-b border-slate-100 px-3 py-3 text-slate-600 italic">
                                {row.episode ?? ""}
                              </td>
                              <td className="max-w-80 wrap-anywhere border-b border-slate-100 px-3 py-3">
                                {semantics.length === 0 ? (
                                  <span className="text-slate-300">—</span>
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    {semantics.map((s: string, i: number) => (
                                      <span
                                        key={i}
                                        className="inline-block max-w-full wrap-anywhere rounded-lg bg-indigo-50 px-2.5 py-1 text-xs leading-snug text-indigo-700"
                                      >
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3">
                                {weights.length === 0 ? (
                                  <span className="text-slate-300">—</span>
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    {weights.map((weight, index) => (
                                      <span
                                        key={index}
                                        className="inline-block rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                                      >
                                        {formatScore(weight)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="max-w-48 wrap-anywhere border-b border-slate-100 px-3 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {(row.keywords ?? []).map(
                                    (kw: string, i: number) => (
                                      <span
                                        key={i}
                                        className="max-w-full wrap-anywhere rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
                                      >
                                        {kw}
                                      </span>
                                    ),
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : memoryViewTab === "retrievals" ? (
                <div className="grid h-full grid-cols-[minmax(260px,360px)_1fr] overflow-hidden">
                  <div className="h-full overflow-y-auto overscroll-contain border-r border-slate-100 bg-slate-50/60 p-3">
                    {memoryRetrievalError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                        {memoryRetrievalError}
                      </p>
                    )}
                    {isLoadingMemoryRetrievals ? (
                      <p className="px-2 py-3 text-xs text-slate-400">
                        Retrieval logs를 불러오는 중입니다.
                      </p>
                    ) : memoryRetrievalLogs.length === 0 ? (
                      <p className="px-2 py-3 text-xs leading-relaxed text-slate-400">
                        아직 retrieval log가 없습니다. 사용자가 채팅을 보내면
                        query와 검색된 memory가 여기에 기록됩니다.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {memoryRetrievalLogs.map((log) => (
                          <button
                            key={log.id}
                            type="button"
                            onClick={() => setSelectedMemoryRetrievalId(log.id)}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                              selectedMemoryRetrieval?.id === log.id
                                ? "border-slate-300 bg-white shadow-sm"
                                : "border-transparent bg-white/60 hover:border-slate-200 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-slate-800">
                                {log.query || "(empty query)"}
                              </p>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                                {log.retrieved.length} used
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                              <span>
                                {log.createdAt
                                  ? new Date(log.createdAt).toLocaleString(
                                      "ko-KR",
                                      {
                                        month: "numeric",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )
                                  : "—"}
                              </span>
                              {log.missionId && <span>{log.missionId}</span>}
                            </div>
                            <p className="mt-2 line-clamp-1 text-[11px] text-slate-400">
                              Top memory: {log.retrieved[0]?.semantic || "—"}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="h-full overflow-y-auto overscroll-contain p-5">
                    {isLoadingMemoryRetrievals ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                        Retrieval logs를 불러오는 중입니다.
                      </div>
                    ) : !selectedMemoryRetrieval ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                        선택된 retrieval log가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <section className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">
                                Memory used for this turn
                              </h3>
                              <p className="mt-1 text-sm text-slate-500">
                                The user message was embedded, compared with
                                saved semantic memories, and the closest matches
                                were sent to the agent.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                {selectedMemoryRetrieval.retrieved.length} used
                              </span>
                              {selectedMemoryRetrieval.missionId && (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                  {selectedMemoryRetrieval.missionId}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="grid gap-2 md:grid-cols-3">
                            <div className="rounded-xl bg-slate-50 px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                1. Query
                              </p>
                              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-700">
                                {selectedMemoryRetrieval.query || "—"}
                              </p>
                            </div>
                            <div className="rounded-xl bg-slate-50 px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                2. Search
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                Vector similarity over semantic memory, no LLM
                                ranking.
                              </p>
                            </div>
                            <div className="rounded-xl bg-slate-50 px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                3. Learning
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-slate-700">
                                Used memories are reinforced; nearby unused
                                candidates decay slightly.
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                            <span>
                              {selectedMemoryRetrieval.createdAt
                                ? new Date(
                                    selectedMemoryRetrieval.createdAt,
                                  ).toLocaleString("ko-KR")
                                : "—"}
                            </span>
                            {selectedMemoryRetrieval.missionId && (
                              <span>{selectedMemoryRetrieval.missionId}</span>
                            )}
                            {selectedMemoryRetrieval.queryEmbeddingModel && (
                              <span>
                                {selectedMemoryRetrieval.queryEmbeddingModel}
                              </span>
                            )}
                          </div>
                        </section>

                        <section>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            retrieved[]
                          </p>
                          <div className="space-y-3">
                            {selectedMemoryRetrieval.retrieved.map(
                              (item, index) => {
                                const delta =
                                  selectedMemoryRetrieval.scoreDeltas.find(
                                    (candidate) =>
                                      candidate.memoryId === item.memoryId &&
                                      candidate.semanticItemId ===
                                        item.semanticItemId,
                                  );
                                return (
                                  <div
                                    key={item.id}
                                    className="rounded-2xl border border-slate-100 bg-white p-4 text-xs shadow-sm"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                                        <span className="rounded-full bg-slate-900 px-2 py-0.5 font-semibold text-white">
                                          #{index + 1}
                                        </span>
                                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                                          similarity{" "}
                                          {formatScore(item.similarity)}
                                        </span>
                                        {item.semantic && (
                                          <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-600">
                                            semantic
                                          </span>
                                        )}
                                        {item.episode && (
                                          <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-600">
                                            episode
                                          </span>
                                        )}
                                        <span>
                                          weight{" "}
                                          {formatScore(item.weight)}
                                        </span>
                                        <span>
                                          retrievedCount {item.retrievedCount}
                                        </span>
                                        {item.source?.missionId && (
                                          <span>
                                            source.missionId{" "}
                                            {item.source.missionId}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <p className="mt-3 wrap-anywhere text-sm leading-relaxed text-slate-800">
                                      {item.semantic ||
                                        "(semantic item not found)"}
                                    </p>
                                    <details className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
                                      <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
                                        Fields
                                      </summary>
                                      <div className="mt-2 grid gap-2 text-[11px] text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
                                        <span>
                                          scoreDeltas[].weight{" "}
                                          {formatScore(delta?.weight)}
                                        </span>
                                        <span>
                                          scoreDeltas[].weightDelta{" "}
                                          {formatScore(delta?.weightDelta)}
                                        </span>
                                      </div>
                                      <p className="mt-2 wrap-anywhere text-[11px] text-slate-400">
                                        memoryId {item.memoryId} ·
                                        semanticItemId {item.semanticItemId}
                                      </p>
                                    </details>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </section>
                      </div>
                    )}
                  </div>
                </div>
              ) : memoryViewTab === "forgetting" ? (
                <div className="grid h-full grid-cols-[minmax(260px,360px)_1fr] overflow-hidden">
                  <div className="h-full overflow-y-auto overscroll-contain border-r border-slate-100 bg-slate-50/60 p-3">
                    {memoryForgettingError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                        {memoryForgettingError}
                      </p>
                    )}
                    {isLoadingMemoryForgetting ? (
                      <p className="px-2 py-3 text-xs text-slate-400">
                        Forgetting 후보를 자동 archive하는 중입니다.
                      </p>
                    ) : memoryForgettingCandidates.length === 0 ? (
                      <p className="px-2 py-3 text-xs leading-relaxed text-slate-400">
                        새로 자동 archive된 후보가 없습니다. 전체 archive
                        기록은 Archived 탭에서 확인할 수 있습니다.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {memoryForgettingCandidates.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() =>
                              setSelectedMemoryForgettingId(candidate.id)
                            }
                            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                              selectedMemoryForgetting?.id === candidate.id
                                ? "border-slate-300 bg-white shadow-sm"
                                : "border-transparent bg-white/60 hover:border-slate-200 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-slate-800">
                                {candidate.semantic}
                              </p>
                              <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                                {candidate.reason}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                              <span>
                                weight{" "}
                                {formatScore(candidate.weight)}
                              </span>
                              <span>
                                retrievedCount {candidate.retrievedCount}
                              </span>
                              {candidate.archivedAt && (
                                <span>
                                  archivedAt{" "}
                                  {new Date(
                                    candidate.archivedAt,
                                  ).toLocaleString("ko-KR")}
                                </span>
                              )}
                              {candidate.source?.missionId && (
                                <span>{candidate.source.missionId}</span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="h-full overflow-y-auto overscroll-contain p-5">
                    {isLoadingMemoryForgetting ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                        Forgetting 후보를 자동 archive하는 중입니다.
                      </div>
                    ) : !selectedMemoryForgetting ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                        새로 자동 archive된 후보가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <section className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">
                                Auto archived memory
                              </h3>
                              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                                Forgetting 기준에 걸린 semantic item을 자동
                                soft archive했습니다.
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
                              {selectedMemoryForgetting.reason}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                              weight{" "}
                              {formatScore(
                                selectedMemoryForgetting.weight,
                              )}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                              retrievedCount{" "}
                              {selectedMemoryForgetting.retrievedCount}
                            </span>
                            {selectedMemoryForgetting.archivedAt && (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                archivedAt{" "}
                                {new Date(
                                  selectedMemoryForgetting.archivedAt,
                                ).toLocaleString("ko-KR")}
                              </span>
                            )}
                          </div>
                          <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-600">
                            {selectedMemoryForgetting.reasonLabel}
                          </p>
                        </section>

                        <section>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Semantic
                          </p>
                          <p className="wrap-anywhere rounded-2xl border border-slate-100 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-sm">
                            {selectedMemoryForgetting.semantic}
                          </p>
                          {selectedMemoryForgetting.keywords &&
                            selectedMemoryForgetting.keywords.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1">
                                {selectedMemoryForgetting.keywords.map(
                                  (keyword) => (
                                    <span
                                      key={keyword}
                                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"
                                    >
                                      {keyword}
                                    </span>
                                  ),
                                )}
                              </div>
                            )}
                        </section>

                        {selectedMemoryForgetting.duplicate && (
                          <section>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Similar semantic kept
                            </p>
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs">
                              <div className="mb-2 flex flex-wrap gap-2 text-[11px] font-semibold text-emerald-700">
                                <span>
                                  Match{" "}
                                  {formatScore(
                                    selectedMemoryForgetting.duplicate
                                      .similarity,
                                  )}
                                </span>
                                <span>
                                  {selectedMemoryForgetting.duplicate.memoryId}:
                                  {
                                    selectedMemoryForgetting.duplicate
                                      .semanticItemId
                                  }
                                </span>
                              </div>
                              <p className="wrap-anywhere leading-relaxed text-emerald-900">
                                {selectedMemoryForgetting.duplicate.semantic}
                              </p>
                            </div>
                          </section>
                        )}

                        <details className="rounded-xl bg-slate-50 px-3 py-2">
                          <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
                            Technical details
                          </summary>
                          <div className="mt-2 grid gap-2 text-[11px] text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
                            <span>
                              archiveReason{" "}
                              {selectedMemoryForgetting.archiveReason ?? "—"}
                            </span>
                            <span>
                              last retrieved{" "}
                              {selectedMemoryForgetting.lastRetrievedAt
                                ? new Date(
                                    selectedMemoryForgetting.lastRetrievedAt,
                                  ).toLocaleDateString("ko-KR")
                                : "—"}
                            </span>
                          </div>
                          <p className="mt-2 wrap-anywhere text-[11px] text-slate-400">
                            {selectedMemoryForgetting.memoryId}:
                            {selectedMemoryForgetting.semanticItemId}
                          </p>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              ) : memoryViewTab === "archived" ? (
                <div className="grid h-full grid-cols-[minmax(260px,360px)_1fr] overflow-hidden">
                  <div className="h-full overflow-y-auto overscroll-contain border-r border-slate-100 bg-slate-50/60 p-3">
                    {memoryForgettingError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                        {memoryForgettingError}
                      </p>
                    )}
                    {isLoadingMemoryForgetting ? (
                      <p className="px-2 py-3 text-xs text-slate-400">
                        Archived memory를 불러오는 중입니다.
                      </p>
                    ) : memoryArchivedItems.length === 0 ? (
                      <p className="px-2 py-3 text-xs leading-relaxed text-slate-400">
                        archivedAt이 기록된 semantic item이 없습니다.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {memoryArchivedItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedMemoryArchivedId(item.id)}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                              selectedMemoryArchived?.id === item.id
                                ? "border-slate-300 bg-white shadow-sm"
                                : "border-transparent bg-white/60 hover:border-slate-200 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-slate-800">
                                {item.semantic}
                              </p>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                                {item.archiveReason ?? item.reason}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                              <span>
                                archivedAt{" "}
                                {item.archivedAt
                                  ? new Date(item.archivedAt).toLocaleString(
                                      "ko-KR",
                                    )
                                  : "—"}
                              </span>
                              <span>
                                weight{" "}
                                {formatScore(item.weight)}
                              </span>
                              {item.duplicate && (
                                <span>
                                  similarTo{" "}
                                  {formatScore(item.duplicate.similarity)}
                                </span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="h-full overflow-y-auto overscroll-contain p-5">
                    {isLoadingMemoryForgetting ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                        Archived memory를 불러오는 중입니다.
                      </div>
                    ) : !selectedMemoryArchived ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                        선택된 archived memory가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <section className="space-y-3">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">
                              Archived memory
                            </h3>
                            <p className="mt-1 max-w-2xl text-sm text-slate-500">
                              archivedAt이 있는 semantic item입니다. Retrieval
                              대상에서는 제외됩니다.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                              archiveReason{" "}
                              {selectedMemoryArchived.archiveReason ?? "—"}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                              archivedAt{" "}
                              {selectedMemoryArchived.archivedAt
                                ? new Date(
                                    selectedMemoryArchived.archivedAt,
                                  ).toLocaleString("ko-KR")
                                : "—"}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                              weight{" "}
                              {formatScore(
                                selectedMemoryArchived.weight,
                              )}
                            </span>
                          </div>
                        </section>

                        <section>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Semantic
                          </p>
                          <p className="wrap-anywhere rounded-2xl border border-slate-100 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-sm">
                            {selectedMemoryArchived.semantic}
                          </p>
                        </section>

                        {selectedMemoryArchived.duplicate && (
                          <section>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Similar memory kept
                            </p>
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs">
                              <div className="mb-2 flex flex-wrap gap-2 text-[11px] font-semibold text-emerald-700">
                                <span>
                                  Match{" "}
                                  {formatScore(
                                    selectedMemoryArchived.duplicate
                                      .similarity,
                                  )}
                                </span>
                                <span>
                                  {selectedMemoryArchived.duplicate.memoryId}:
                                  {
                                    selectedMemoryArchived.duplicate
                                      .semanticItemId
                                  }
                                </span>
                              </div>
                              {selectedMemoryArchived.duplicate.semantic && (
                                <p className="wrap-anywhere leading-relaxed text-emerald-900">
                                  {selectedMemoryArchived.duplicate.semantic}
                                </p>
                              )}
                              {selectedMemoryArchived.duplicate.episodic && (
                                <p className="mt-2 wrap-anywhere leading-relaxed text-emerald-800/80">
                                  {selectedMemoryArchived.duplicate.episodic}
                                </p>
                              )}
                            </div>
                          </section>
                        )}

                        <details className="rounded-xl bg-slate-50 px-3 py-2">
                          <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
                            Fields
                          </summary>
                          <div className="mt-2 grid gap-2 text-[11px] text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
                            <span>
                              retrievedCount{" "}
                              {selectedMemoryArchived.retrievedCount}
                            </span>
                            <span>
                              duplicateOf{" "}
                              {selectedMemoryArchived.duplicateOf ?? "—"}
                            </span>
                          </div>
                          <p className="mt-2 wrap-anywhere text-[11px] text-slate-400">
                            memoryId {selectedMemoryArchived.memoryId} ·
                            semanticItemId{" "}
                            {selectedMemoryArchived.semanticItemId}
                          </p>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid h-full grid-cols-[minmax(220px,320px)_1fr] overflow-hidden">
                  <div className="h-full overflow-y-auto overscroll-contain border-r border-slate-100 bg-slate-50/60">
                    <div className="border-b border-slate-100 bg-slate-50/95 p-4">
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={generateMemoryClusters}
                          disabled={
                            isLoadingMemoryClusters ||
                            isClusteringMemory ||
                            clusterableMemoryItems.length === 0
                          }
                          className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                        >
                          {isClusteringMemory
                            ? "Generating..."
                            : `Regenerate all (${clusterableMemoryItems.length})`}
                        </button>
                      </div>
                      <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
                        <button
                          type="button"
                          onClick={copyMemoryClustersJson}
                          disabled={activeMemoryClusters.length === 0}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Copy current JSON
                        </button>
                      </div>
                      {memoryClusterError && (
                        <p className="mt-2 text-xs text-red-500">
                          {memoryClusterError}
                        </p>
                      )}
                      {memoryGraphClusterDiagnostics?.graph && (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold text-slate-600">
                              Similarity Graph
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {memoryGraphClusterDiagnostics.actualClusterCount ??
                                memoryGraphClusterDiagnostics.graph
                                  .cappedCommunityCount}{" "}
                              communities
                            </p>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                            <span>
                              edges{" "}
                              {memoryGraphClusterDiagnostics.graph.edgeCount}
                            </span>
                            <span>
                              degree{" "}
                              {memoryGraphClusterDiagnostics.graph.averageDegree.toFixed(
                                2,
                              )}
                            </span>
                            <span>
                              raw{" "}
                              {
                                memoryGraphClusterDiagnostics.graph
                                  .rawCommunityCount
                              }{" "}
                              groups
                            </span>
                            <span>
                              singleton{" "}
                              {
                                memoryGraphClusterDiagnostics.graph
                                  .singletonCount
                              }
                            </span>
                            <span>
                              min sim{" "}
                              {memoryGraphClusterDiagnostics.graph.minSimilarity.toFixed(
                                2,
                              )}
                            </span>
                            <span>
                              strong{" "}
                              {memoryGraphClusterDiagnostics.graph.strongSimilarity.toFixed(
                                2,
                              )}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      {isLoadingMemoryClusters ? (
                        <p className="px-2 py-3 text-xs text-slate-400">
                          저장된 클러스터를 불러오는 중입니다.
                        </p>
                      ) : clusterableMemoryItems.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-slate-400">
                          현재 필터에 semantic memory가 없습니다.
                        </p>
                      ) : activeMemoryClusters.length === 0 ? (
                        <p className="px-2 py-3 text-xs leading-relaxed text-slate-400">
                          저장된 클러스터가 없습니다.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {activeMemoryClusters.map((cluster) => (
                            <button
                              key={cluster.id}
                              type="button"
                              onClick={() =>
                                setSelectedMemoryClusterId(cluster.id)
                              }
                              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                                selectedMemoryCluster?.id === cluster.id
                                  ? "border-slate-300 bg-white shadow-sm"
                                  : "border-transparent bg-white/60 hover:border-slate-200 hover:bg-white"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-800">
                                  {cluster.label}
                                </p>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                                  {cluster.count}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                                {cluster.summary}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3">
                      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                        {(["graph", "detail"] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setMemoryClusterViewTab(tab)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                              memoryClusterViewTab === tab
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-900"
                            }`}
                          >
                            {tab === "graph" ? "Graph" : "Detail"}
                          </button>
                        ))}
                      </div>
                      <span className="text-xs text-slate-400">
                        Similarity Graph · {activeMemoryClusters.length}{" "}
                        clusters · {clusterableMemoryItems.length} semantic
                        nodes
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
                      {isLoadingMemoryClusters ? (
                        <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                          저장된 클러스터를 불러오는 중입니다.
                        </div>
                      ) : !selectedMemoryCluster ? (
                        <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-400">
                          저장된 클러스터가 없으면 Regenerate를 눌러 새로 생성할
                          수 있습니다.
                        </div>
                      ) : memoryClusterViewTab === "graph" ? (
                        <div className="h-full min-h-128 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                          <MemoryClusterGraph
                            clusters={activeMemoryClusters}
                            items={clusterableMemoryItems}
                            selectedClusterId={selectedMemoryCluster.id}
                            onSelectCluster={setSelectedMemoryClusterId}
                            fill
                          />
                        </div>
                      ) : (
                        <div className="space-y-5">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-semibold text-slate-900">
                                {selectedMemoryCluster.label}
                              </h3>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                {selectedClusterItems.length} items
                              </span>
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
                              {selectedMemoryCluster.summary}
                            </p>
                            {selectedMemoryCluster.relatedActions.length >
                              0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {selectedMemoryCluster.relatedActions.map(
                                  (action) => (
                                    <span
                                      key={action}
                                      className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                                    >
                                      {action}
                                    </span>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                          {selectedMemoryCluster.representativeItems.length >
                            0 && (
                            <section>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Representative semantics
                              </p>
                              <div className="space-y-2">
                                {selectedMemoryCluster.representativeItems.map(
                                  (item, index) => (
                                    <p
                                      key={index}
                                      className="rounded-xl bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-700"
                                    >
                                      {item}
                                    </p>
                                  ),
                                )}
                              </div>
                            </section>
                          )}
                          <section>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Included memory items
                            </p>
                            <div className="space-y-3">
                              {selectedClusterItems.map((item) => (
                                <div
                                  key={item.id}
                                  className="rounded-2xl border border-slate-100 bg-white p-4 text-xs shadow-sm"
                                >
                                  <p className="wrap-anywhere text-sm leading-relaxed text-slate-800">
                                    {item.semantic}
                                  </p>
                                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                                    {item.timestamp ? (
                                      <span>
                                        {new Date(
                                          item.timestamp as number,
                                        ).toLocaleString("ko-KR", {
                                          month: "numeric",
                                          day: "numeric",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}
                                      </span>
                                    ) : null}
                                    {item.action ? (
                                      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                        {item.action}
                                      </span>
                                    ) : null}
                                    <span>
                                      {item.row.source?.missionId ?? "—"}
                                    </span>
                                  </div>
                                  {item.episodic && (
                                    <p className="mt-3 wrap-anywhere text-slate-500">
                                      {item.episodic}
                                    </p>
                                  )}
                                  {item.input && (
                                    <p className="mt-2 wrap-anywhere text-slate-400">
                                      Input: {item.input}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </section>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  if (visibleMemoryRows.length === 0) return;
                  const headers = [
                    "Timestamp",
                    "Mission",
                    "Action",
                    "Input",
                    "Episode",
                    "Semantic",
                    "Keywords",
                  ];
                  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
                  const rows = visibleMemoryRows.map((row) => {
                    const semantics = semanticItems(row).join(" | ");
                    return [
                      row.timestamp
                        ? new Date(row.timestamp as number).toLocaleString(
                            "ko-KR",
                          )
                        : "",
                      row.source?.missionId ?? "",
                      row.agentActionCategory ?? "",
                      row.input ?? "",
                      row.episode ?? "",
                      semantics,
                      (row.keywords ?? []).join(", "),
                    ]
                      .map(escape)
                      .join(",");
                  });
                  const csv = [headers.map(escape).join(","), ...rows].join(
                    "\n",
                  );
                  const blob = new Blob(["﻿" + csv], {
                    type: "text/csv;charset=utf-8;",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `memory_${memoryModal.userName}_v${memoryVersionTab}_${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="rounded-2xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
              >
                CSV 내보내기
              </button>
              <button
                type="button"
                onClick={() =>
                  deleteAllMemory(memoryModal.userId, memoryVersionTab)
                }
                disabled={isDeletingMemory}
                className="rounded-2xl bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
              >
                {isDeletingMemory
                  ? "삭제 중..."
                  : `v${memoryVersionTab} 메모리 삭제`}
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
              <h2 className="text-lg font-semibold text-slate-900">
                유저 목록
              </h2>
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
              {isLoadingUsers
                ? "유저 데이터를 불러오는 중입니다."
                : "아직 유저 데이터가 없습니다."}
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
                          <span
                            key={missionId}
                            className="inline-flex overflow-hidden rounded-full border border-slate-200 text-xs font-semibold"
                          >
                            <Link
                              href={`/main/${missionId}?viewAs=${user.id}`}
                              className="px-3 py-1 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                            >
                              {missionTitle(missionId)}
                            </Link>
                            <Link
                              href={`/main/${missionId}?viewAs=${user.id}&review=1`}
                              className="border-l border-slate-200 px-2.5 py-1 text-indigo-500 transition hover:bg-indigo-50 hover:text-indigo-700"
                            >
                              리뷰
                            </Link>
                          </span>
                        ))
                      )}
                    </div>

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
                                value={
                                  (editFields.durationMinutes as number) ?? 30
                                }
                                onChange={(e) =>
                                  setEditFields((p) => ({
                                    ...p,
                                    durationMinutes: Number(e.target.value),
                                  }))
                                }
                                className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-slate-400"
                              />
                              <span className="text-slate-400">
                                (0 = 제한 없음)
                              </span>
                            </div>
                            <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-slate-500">
                                  옵션
                                </p>
                                <button
                                  type="button"
                                  onClick={addEditOption}
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                                >
                                  + 옵션 추가
                                </button>
                              </div>
                              {normalizeOptions(
                                editFields.options as MissionOption[],
                              ).map((option, index) => (
                                <div
                                  key={option.id}
                                  className="space-y-2 rounded-xl border border-slate-100 bg-white p-3"
                                >
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold text-slate-400">
                                      옵션 {index + 1}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeEditOption(option.id)
                                      }
                                      className="text-xs text-red-400 hover:text-red-500"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                  <input
                                    value={option.title}
                                    onChange={(e) =>
                                      updateEditOption(option.id, {
                                        title: e.target.value,
                                      })
                                    }
                                    placeholder="옵션 제목"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                                  />
                                  <textarea
                                    value={option.description}
                                    onChange={(e) =>
                                      updateEditOption(option.id, {
                                        description: e.target.value,
                                      })
                                    }
                                    placeholder="옵션 설명"
                                    rows={2}
                                    className="w-full resize-none rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                                  />
                                  {/* Content — markdown */}
                                  <div className="space-y-1.5">
                                    <p className="text-xs font-semibold text-slate-400">
                                      콘텐츠 (마크다운)
                                    </p>
                                    <textarea
                                      value={option.content}
                                      onChange={(e) =>
                                        updateEditOption(option.id, {
                                          content: e.target.value,
                                        })
                                      }
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
                                {(mission.device ?? "desktop") === "desktop" ? (
                                  <>
                                    <MonitorIcon size={12} className="inline" />{" "}
                                    PC
                                  </>
                                ) : (
                                  <>
                                    <DeviceMobileIcon
                                      size={12}
                                      className="inline"
                                    />{" "}
                                    모바일
                                  </>
                                )}
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
                        <Link
                          href={`/main/${participantsMissionId}?viewAs=${p.id}&review=1`}
                          className="rounded-full px-2 py-1 text-[11px] font-semibold text-indigo-400 transition hover:bg-indigo-50 hover:text-indigo-700"
                          onClick={closeParticipants}
                          title="리뷰 보기"
                        >
                          리뷰
                        </Link>
                        <button
                          type="button"
                          onClick={() => deleteUserData(p)}
                          className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                          title={
                            p.isAdmin ? "관리자 기록 삭제" : "유저 데이터 삭제"
                          }
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
