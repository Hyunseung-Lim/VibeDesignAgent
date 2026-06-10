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
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MemoryClusterList } from "@/components/memory/memory-cluster-list";
import { MemoryClusterSidePanel } from "@/components/memory/memory-cluster-side-panel";
import type { MemoryItem } from "@/components/memory/memory-cluster-types";

const MemoryClusterGraph = dynamic(() => import("./MemoryClusterGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-112 min-h-96 items-center justify-center rounded-2xl border border-border bg-card text-sm text-muted-foreground shadow-sm">
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
  completedSessionMissionIds: string[];
};

type AdminMemoryRow = {
  id: string;
  version?: string;
  type: "episodic" | "semantic" | "interaction" | string;
  sourceType?: string;
  memorySource?: string;
  input?: string;
  output?: string;
  originalInteractionContent?: string;
  link?: string | null;
  timestamp?: number;
  category?: string[];
  subcategory?: string[];
  keyword?: string[];
  keywords?: string[];
  embedding?: number[];
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
type MemoryVersionTab = "0.1.2";
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
type DestructiveAdminAction =
  | { type: "mission"; missionId: string; title: string }
  | {
      type: "participant-records";
      participant: Participant;
      missionId: string;
      label: string;
    }
  | { type: "all-memory"; userId: string; version: string }
  | { type: "sessions"; user: AdminUser; label: string };

type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
};

type ClusterGraphEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
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
  const [adminSection, setAdminSection] = useState<"users" | "missions">(
    "users",
  );
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
  const [memoryViewTab, setMemoryViewTab] =
    useState<MemoryViewTab>("clusters");
  const [memoryGraphClusters, setMemoryGraphClusters] = useState<
    MemoryCluster[]
  >([]);
  const [memoryGraphEdges, setMemoryGraphEdges] = useState<ClusterGraphEdge[]>(
    [],
  );
  const [selectedMemoryClusterId, setSelectedMemoryClusterId] = useState<
    string | null
  >(null);
  const [selectedAdminGraphMemoryId, setSelectedAdminGraphMemoryId] = useState<
    string | null
  >(null);
  const [isLoadingMemoryClusters, setIsLoadingMemoryClusters] = useState(false);
  const [isClusteringMemory, setIsClusteringMemory] = useState(false);
  const [memoryGraphGeneratedAt, setMemoryGraphGeneratedAt] = useState<number | null>(null);
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
  const [destructiveAction, setDestructiveAction] =
    useState<DestructiveAdminAction | null>(null);

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

  const requestDeleteMission = (mission: Mission) => {
    setDestructiveAction({
      type: "mission",
      missionId: mission.id,
      title: mission.title,
    });
  };

  const deleteMission = async (id: string) => {
    try {
      await deleteDoc(doc(db, "missions", id));
      toast.success("미션을 삭제했어요.");
    } catch (error) {
      console.error("[admin] mission delete failed", error);
      toast.error("미션 삭제에 실패했습니다.");
    }
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

  const requestDeleteUserData = (participant: Participant) => {
    const targetMissionId = participantsMissionId;
    if (!targetMissionId) {
      toast.error("삭제할 미션 정보가 없습니다.");
      return;
    }
    const label =
      participant.displayName ?? participant.email ?? participant.id;
    setDestructiveAction({
      type: "participant-records",
      participant,
      missionId: targetMissionId,
      label,
    });
  };

  const deleteUserData = async (participant: Participant, targetMissionId: string) => {
    try {
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) {
        toast.error("관리자 인증 정보가 없습니다. 다시 로그인해주세요.");
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
        toast.error(data?.error ?? "유저 데이터 삭제에 실패했습니다.");
        return;
      }
      const data = await res.json().catch(() => null);
      toast.success("미션 기록 삭제가 완료됐습니다.", {
        description: [
          `세션 ${data?.deletedSessionMissions ?? 0}개`,
          `참여 기록 ${data?.deletedParticipantRecords ?? 0}개`,
          `memoryDrafts ${data?.deletedMemoryDrafts ?? 0}개`,
          `reviewTurns ${data?.deletedReviewTurns ?? 0}개`,
        ].join(" · "),
      });
    } catch (error) {
      console.error("[admin] user delete failed", error);
      toast.error("유저 데이터 삭제 중 오류가 발생했습니다.");
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

  const onboardingBadge = (
    status?: Participant["onboardingStatus"],
  ): { label: string; variant: "success" | "warning" | "secondary" } => {
    if (status === "completed") {
      return { label: "온보딩 완료", variant: "success" };
    }
    if (status === "required") {
      return { label: "온보딩 필요", variant: "warning" };
    }
    return { label: "온보딩 확인 불가", variant: "secondary" };
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
      toast.error("관리자 인증 정보가 없습니다. 다시 로그인해주세요.");
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
      toast.success("온보딩 설정을 저장했어요.");
    } catch (error) {
      console.error("[admin] onboarding settings save failed", error);
      toast.error("온보딩 설정 저장에 실패했습니다.");
    } finally {
      setIsSavingOnboardingSettings(false);
    }
  };

  const deleteAllMemory = async (userId: string, version: string) => {
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
      toast.success(`v${version} 메모리를 삭제했어요.`);
    } catch (e) {
      console.error(e);
      toast.error("메모리 삭제에 실패했습니다.");
    } finally {
      setIsDeletingMemory(false);
    }
  };

  const deleteAdminMemory = async (memoryId: string) => {
    if (!memoryModal) return;
    const token = await getAdminToken();
    if (!token) return;
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(memoryModal.userId)}/memory?memoryId=${encodeURIComponent(memoryId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("삭제 실패");
      setMemoryModal((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.filter((r) => r.id !== memoryId),
            }
          : prev,
      );
      toast.success("메모리 항목을 삭제했어요.");
    } catch {
      toast.error("메모리 삭제에 실패했습니다.");
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
      setMemoryVersionTab("0.1.2");
      resetMemoryFilters();
      setMemoryViewTab("clusters");
      setMemoryGraphClusters([]);
      setMemoryGraphEdges([]);
      setSelectedMemoryClusterId(null);
      setSelectedAdminGraphMemoryId(null);
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
      console.error(e);
      toast.error("메모리를 불러오지 못했습니다.");
    } finally {
      setIsLoadingMemory(false);
    }
  };

  const requestBackupAndDeleteSessions = (user: AdminUser) => {
    const label = user.displayName ?? user.email ?? user.id;
    setDestructiveAction({ type: "sessions", user, label });
  };

  const backupAndDeleteSessions = async (user: AdminUser) => {
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
      toast.success("백업 후 세션 삭제가 완료됐습니다.", {
        description: [
          `세션 ${data.deletedSessionMissions ?? 0}개`,
          `참여 기록 ${data.deletedParticipantRecords ?? 0}개`,
          `Storage ${data.deletedStorageFiles ?? 0}개`,
        ].join(" · "),
      });
      await loadUsers();
    } catch (e) {
      console.error(e);
      toast.error("세션 백업/삭제에 실패했습니다.");
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
        completedSessionMissionIds:
          changes.completedSessionMissionIds ??
          prev?.completedSessionMissionIds ??
          [],
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
        const completedSessionMissionIds = (
          sessionMissionSnap?.docs ?? []
        )
          .filter(
            (missionDoc) =>
              (missionDoc.data() as Record<string, unknown>).status ===
              "completed",
          )
          .map((missionDoc) => missionDoc.id);
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
          completedSessionMissionIds: Array.from(
            new Set([
              ...(existing?.completedSessionMissionIds ?? []),
              ...completedSessionMissionIds,
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
        (row) => (row.version ?? "0.1.2") === memoryVersionTab,
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
          originalInteractionContent: row.originalInteractionContent ?? "",
          link: row.link ?? "",
          action: row.agentActionCategory ?? "",
          sourceType:
            row.sourceType ?? row.memorySource ?? row.type ?? "during_session",
          weight: row.weight ?? null,
          embedding: row.embedding,
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
  // Uses ALL rows across all schema versions — before_session profile memories use
  // schemaVersion "0.1.2-before-session" and would be excluded from versionMemoryRows,
  // but they ARE included in cluster itemIds (clustering routes don't version-filter).
  const allMemoryIdSet = useMemo(
    () => new Set((memoryModal?.rows ?? []).map((row) => row.id)),
    [memoryModal?.rows],
  );
  const adminClusterMemories = useMemo<MemoryItem[]>(
    () =>
      visibleMemoryRows.map((row) => ({
        id: row.id,
        episodic: row.episode ?? null,
        semantic: row.semantic ?? null,
        input: row.input ?? null,
        output: row.output ?? null,
        originalInteractionContent: row.originalInteractionContent ?? null,
        action: row.agentActionCategory ?? null,
        sourceType: row.sourceType ?? row.memorySource ?? row.type ?? "during_session",
        keywords: row.keyword ?? row.keywords ?? [],
        weight: row.weight ?? null,
        embedding: row.embedding,
        timestamp: row.timestamp ?? null,
        archivedAt:
          row.semanticItems?.find((item) => item.archivedAt)?.archivedAt ??
          null,
        archiveReason: null,
        source: row.source ?? null,
      })),
    [visibleMemoryRows],
  );
  const activeMemoryClusters = memoryGraphClusters;
  const activeMemoryGraphEdges = memoryGraphEdges;
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
    const rawSignature = [...clusterableMemoryItems]
      .sort((a, b) => a.id.localeCompare(b.id))
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
    setSelectedAdminGraphMemoryId(null);
  }, [activeMemoryClusters]);
  useEffect(() => {
    setMemoryGraphClusters([]);
    setMemoryGraphEdges([]);
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
          itemCount: String(clusterableMemoryItems.length),
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
        const graphEdges: ClusterGraphEdge[] = Array.isArray(data.graphEdges)
          ? data.graphEdges
          : [];
        setMemoryGraphClusters(graphClusters);
        setMemoryGraphEdges(graphEdges);
        setMemoryGraphClusterDiagnostics(
          parseMemoryGraphClusterDiagnostics(data.graphDiagnostics),
        );
        setMemoryGraphGeneratedAt(typeof data.generatedAt === "number" ? data.generatedAt : null);
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
              originalInteractionContent: item.originalInteractionContent,
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
      const graphEdges: ClusterGraphEdge[] = Array.isArray(data?.graphEdges)
        ? data.graphEdges
        : [];
      setMemoryGraphClusters(graphClusters);
      setMemoryGraphEdges(graphEdges);
      setMemoryGraphClusterDiagnostics(
        parseMemoryGraphClusterDiagnostics(data?.graphDiagnostics),
      );
      setMemoryGraphGeneratedAt(Date.now());
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
      edges: activeMemoryGraphEdges,
      clusters: activeMemoryClusters.map((cluster) => ({
        ...cluster,
        items: cluster.itemIds.map(itemForExport).filter(Boolean),
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  const destructiveDialogCopy = destructiveAction
    ? destructiveAction.type === "mission"
      ? {
          title: "미션을 삭제할까요?",
          description: `${destructiveAction.title} 미션이 목록에서 제거됩니다. 참여자 데이터와 연결된 세션은 이 작업에서 삭제하지 않습니다.`,
          actionLabel: "미션 삭제",
        }
      : destructiveAction.type === "participant-records"
        ? {
            title: "미션 기록을 삭제할까요?",
            description: `${destructiveAction.label} 사용자의 ${missionTitle(destructiveAction.missionId)} 기록만 삭제합니다. 해당 미션 세션과 하위 memoryDrafts/reviewTurns를 삭제하며, 유저 정보와 다른 미션 기록은 유지됩니다.`,
            actionLabel: "기록 삭제",
          }
        : destructiveAction.type === "all-memory"
          ? {
              title: "메모리를 전체 삭제할까요?",
              description: `선택한 사용자의 v${destructiveAction.version} 메모리를 전체 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
              actionLabel: "메모리 삭제",
            }
          : {
              title: "세션 데이터를 백업 후 삭제할까요?",
              description: `${destructiveAction.label}의 세션 데이터와 Storage 파일을 백업한 뒤 삭제합니다. 메모리 컬렉션은 삭제하지 않습니다.`,
              actionLabel: "백업 후 삭제",
            }
    : null;

  const runDestructiveAction = async () => {
    if (!destructiveAction) return;
    const action = destructiveAction;
    setDestructiveAction(null);
    if (action.type === "mission") {
      await deleteMission(action.missionId);
      return;
    }
    if (action.type === "participant-records") {
      await deleteUserData(action.participant, action.missionId);
      return;
    }
    if (action.type === "all-memory") {
      await deleteAllMemory(action.userId, action.version);
      return;
    }
    await backupAndDeleteSessions(action.user);
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-muted text-foreground">
      <AlertDialog
        open={Boolean(destructiveAction)}
        onOpenChange={(open) => {
          if (!open) setDestructiveAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {destructiveDialogCopy?.title ?? "삭제할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {destructiveDialogCopy?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void runDestructiveAction();
              }}
            >
              {destructiveDialogCopy?.actionLabel ?? "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Memory modal */}
      {memoryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setMemoryModal(null)}
        >
          <div
            className="flex h-[calc(100vh-2rem)] w-full max-w-[95vw] flex-col overflow-hidden rounded-3xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  유저 메모리
                </p>
                <p className="text-xs text-muted-foreground">{memoryModal.userName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  v0.1.2 {memoryModal.counts["0.1.2"] ?? 0}개
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isDeletingMemory}
                  onClick={() =>
                    setDestructiveAction({
                      type: "all-memory",
                      userId: memoryModal.userId,
                      version: "0.1.2",
                    })
                  }
                >
                  전체 삭제
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setMemoryModal(null)}
                  className="rounded-full text-muted-foreground"
                  aria-label="닫기"
                >
                  <XIcon size={16} />
                </Button>
              </div>
            </div>
            <div className="shrink-0 border-b border-border px-6 py-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="inline-flex rounded-lg border border-border bg-muted p-1">
                  <span className="rounded-md bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
                    Clusters
                  </span>
                </div>
                {(memoryViewTab === "table" ||
                  memoryViewTab === "clusters") && (
                  <div className="inline-flex rounded-lg border border-border bg-muted p-1">
                    {(["0.1.2"] as const).map((version) => (
                      <button
                        key={version}
                        type="button"
                        onClick={() => setMemoryVersionTab(version)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                          memoryVersionTab === version
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        v{version} ({memoryModal.counts[version] ?? 0})
                      </button>
                    ))}
                  </div>
                )}
                {(memoryViewTab === "table" ||
                  memoryViewTab === "clusters") && (
                  <>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Start
                      <Input
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
                        className="h-auto py-1.5 text-xs font-normal normal-case tracking-normal"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      End
                      <Input
                        type="date"
                        value={memoryEndDate}
                        min={
                          memoryStartDate ||
                          dateInputValue(versionMemoryRows.at(-1)?.timestamp)
                        }
                        max={dateInputValue(versionMemoryRows[0]?.timestamp)}
                        onChange={(e) => setMemoryEndDate(e.target.value)}
                        className="h-auto py-1.5 text-xs font-normal normal-case tracking-normal"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Action
                      <select
                        value={memoryActionFilter}
                        onChange={(e) => setMemoryActionFilter(e.target.value)}
                        className="min-w-40 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground outline-none focus-visible:border-ring"
                      >
                        <option value="all">All actions</option>
                        {memoryActionOptions.map((action) => (
                          <option key={action} value={action}>
                            {action}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Semantic
                      <select
                        value={memorySemanticFilter}
                        onChange={(e) =>
                          setMemorySemanticFilter(
                            e.target.value as SemanticFilter,
                          )
                        }
                        className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground outline-none focus-visible:border-ring"
                      >
                        <option value="all">All</option>
                        <option value="with">With semantic</option>
                        <option value="without">No semantic</option>
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={resetMemoryFilters}
                    >
                      Reset
                    </Button>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {visibleMemoryRows.length} / {versionMemoryRows.length}{" "}
                      semantic nodes
                    </span>
                  </>
                )}
                {memoryViewTab === "retrievals" && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {memoryRetrievalLogs.length} retrieval logs
                  </span>
                )}
                {memoryViewTab === "forgetting" && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {memoryForgettingCandidates.length} auto archived
                  </span>
                )}
                {memoryViewTab === "archived" && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {memoryArchivedItems.length} archived memories
                  </span>
                )}
              </div>
            </div>
            <div className="h-[calc(100vh-14rem)] min-h-80">
              {memoryViewTab === "table" ? (
                <div className="h-full overflow-y-auto overscroll-contain">
                  {visibleMemoryRows.length === 0 ? (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      v{memoryVersionTab} 메모리 없음
                    </p>
                  ) : (
                    <table className="w-full min-w-240 border-separate border-spacing-0 text-left text-xs text-muted-foreground">
                      <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[0_1px_0_0_rgba(226,232,240,1)]">
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
                              className="border-b border-border px-3 py-2 font-semibold"
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
                              className="align-top hover:bg-muted/60"
                            >
                              <td className="whitespace-nowrap border-b border-border px-3 py-3 text-muted-foreground">
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
                              <td className="whitespace-nowrap border-b border-border px-3 py-3 text-xs text-muted-foreground">
                                {row.source?.missionId ?? "—"}
                              </td>
                              <td className="whitespace-nowrap border-b border-border px-3 py-3">
                                {row.agentActionCategory ? (
                                  <Badge variant="warning" className="rounded-full">
                                    {row.agentActionCategory}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="max-w-64 wrap-anywhere border-b border-border px-3 py-3 text-foreground">
                                {row.input ?? ""}
                              </td>
                              <td className="max-w-72 wrap-anywhere border-b border-border px-3 py-3 text-muted-foreground italic">
                                {row.episode ?? ""}
                              </td>
                              <td className="max-w-80 wrap-anywhere border-b border-border px-3 py-3">
                                {semantics.length === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    {semantics.map((s: string, i: number) => (
                                      <Badge
                                        key={i}
                                        variant="outline"
                                        className="inline-block h-auto max-w-full wrap-anywhere rounded-lg whitespace-normal border-transparent bg-indigo-50 px-2.5 py-1 text-xs leading-snug text-indigo-700"
                                      >
                                        {s}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="whitespace-nowrap border-b border-border px-3 py-3">
                                {weights.length === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    {weights.map((weight, index) => (
                                      <Badge
                                        key={index}
                                        variant="secondary"
                                        className="inline-block h-auto rounded-lg"
                                      >
                                        {formatScore(weight)}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="max-w-48 wrap-anywhere border-b border-border px-3 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {(row.keywords ?? []).map(
                                    (kw: string, i: number) => (
                                      <Badge
                                        key={i}
                                        variant="secondary"
                                        className="h-auto max-w-full wrap-anywhere rounded-full whitespace-normal"
                                      >
                                        {kw}
                                      </Badge>
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
                  <div className="h-full overflow-y-auto overscroll-contain border-r border-border bg-muted/60 p-3">
                    {memoryRetrievalError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                        {memoryRetrievalError}
                      </p>
                    )}
                    {isLoadingMemoryRetrievals ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        Retrieval logs를 불러오는 중입니다.
                      </p>
                    ) : memoryRetrievalLogs.length === 0 ? (
                      <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
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
                                ? "border-border bg-card shadow-sm"
                                : "border-transparent bg-card/60 hover:border-border hover:bg-card"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-foreground">
                                {log.query || "(empty query)"}
                              </p>
                              <Badge variant="secondary" className="shrink-0 rounded-full">
                                {log.retrieved.length} used
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
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
                            <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground">
                              Top memory: {log.retrieved[0]?.semantic || "—"}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="h-full overflow-y-auto overscroll-contain p-5">
                    {isLoadingMemoryRetrievals ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
                        Retrieval logs를 불러오는 중입니다.
                      </div>
                    ) : !selectedMemoryRetrieval ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
                        선택된 retrieval log가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <section className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-semibold text-foreground">
                                Memory used for this turn
                              </h3>
                              <p className="mt-1 text-sm text-muted-foreground">
                                The user message was embedded, compared with
                                saved semantic memories, and the closest matches
                                were sent to the agent.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="success" className="rounded-full">
                                {selectedMemoryRetrieval.retrieved.length} used
                              </Badge>
                              {selectedMemoryRetrieval.missionId && (
                                <Badge variant="secondary" className="rounded-full">
                                  {selectedMemoryRetrieval.missionId}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="grid gap-2 md:grid-cols-3">
                            <div className="rounded-xl bg-muted px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                1. Query
                              </p>
                              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-foreground">
                                {selectedMemoryRetrieval.query || "—"}
                              </p>
                            </div>
                            <div className="rounded-xl bg-muted px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                2. Search
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-foreground">
                                Vector similarity over semantic memory, no LLM
                                ranking.
                              </p>
                            </div>
                            <div className="rounded-xl bg-muted px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                3. Learning
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-foreground">
                                Used memories are reinforced; nearby unused
                                candidates decay slightly.
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
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
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                                    className="rounded-2xl border border-border bg-card p-4 text-xs shadow-sm"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                        <Badge className="rounded-full">
                                          #{index + 1}
                                        </Badge>
                                        <Badge variant="success" className="rounded-full">
                                          similarity{" "}
                                          {formatScore(item.similarity)}
                                        </Badge>
                                        {item.semantic && (
                                          <Badge
                                            variant="outline"
                                            className="rounded-full border-transparent bg-violet-50 text-violet-600"
                                          >
                                            semantic
                                          </Badge>
                                        )}
                                        {item.episode && (
                                          <Badge
                                            variant="outline"
                                            className="rounded-full border-transparent bg-sky-50 text-sky-600"
                                          >
                                            episode
                                          </Badge>
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
                                    <p className="mt-3 wrap-anywhere text-sm leading-relaxed text-foreground">
                                      {item.semantic ||
                                        "(semantic item not found)"}
                                    </p>
                                    <details className="mt-3 rounded-xl bg-muted px-3 py-2">
                                      <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
                                        Fields
                                      </summary>
                                      <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                                        <span>
                                          scoreDeltas[].weight{" "}
                                          {formatScore(delta?.weight)}
                                        </span>
                                        <span>
                                          scoreDeltas[].weightDelta{" "}
                                          {formatScore(delta?.weightDelta)}
                                        </span>
                                      </div>
                                      <p className="mt-2 wrap-anywhere text-[11px] text-muted-foreground">
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
                  <div className="h-full overflow-y-auto overscroll-contain border-r border-border bg-muted/60 p-3">
                    {memoryForgettingError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                        {memoryForgettingError}
                      </p>
                    )}
                    {isLoadingMemoryForgetting ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        Forgetting 후보를 자동 archive하는 중입니다.
                      </p>
                    ) : memoryForgettingCandidates.length === 0 ? (
                      <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
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
                                ? "border-border bg-card shadow-sm"
                                : "border-transparent bg-card/60 hover:border-border hover:bg-card"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-foreground">
                                {candidate.semantic}
                              </p>
                              <Badge
                                variant="outline"
                                className="shrink-0 rounded-full border-transparent bg-rose-50 text-rose-600"
                              >
                                {candidate.reason}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
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
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
                        Forgetting 후보를 자동 archive하는 중입니다.
                      </div>
                    ) : !selectedMemoryForgetting ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
                        새로 자동 archive된 후보가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <section className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-semibold text-foreground">
                                Auto archived memory
                              </h3>
                              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                                Forgetting 기준에 걸린 semantic item을 자동
                                soft archive했습니다.
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              variant="outline"
                              className="rounded-full border-transparent bg-rose-50 text-rose-600"
                            >
                              {selectedMemoryForgetting.reason}
                            </Badge>
                            <Badge variant="secondary" className="rounded-full">
                              weight{" "}
                              {formatScore(
                                selectedMemoryForgetting.weight,
                              )}
                            </Badge>
                            <Badge variant="secondary" className="rounded-full">
                              retrievedCount{" "}
                              {selectedMemoryForgetting.retrievedCount}
                            </Badge>
                            {selectedMemoryForgetting.archivedAt && (
                              <Badge variant="secondary" className="rounded-full">
                                archivedAt{" "}
                                {new Date(
                                  selectedMemoryForgetting.archivedAt,
                                ).toLocaleString("ko-KR")}
                              </Badge>
                            )}
                          </div>
                          <p className="rounded-xl bg-muted px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                            {selectedMemoryForgetting.reasonLabel}
                          </p>
                        </section>

                        <section>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Semantic
                          </p>
                          <p className="wrap-anywhere rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground shadow-sm">
                            {selectedMemoryForgetting.semantic}
                          </p>
                          {selectedMemoryForgetting.keywords &&
                            selectedMemoryForgetting.keywords.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1">
                                {selectedMemoryForgetting.keywords.map(
                                  (keyword) => (
                                    <Badge
                                      key={keyword}
                                      variant="secondary"
                                      className="rounded-full"
                                    >
                                      {keyword}
                                    </Badge>
                                  ),
                                )}
                              </div>
                            )}
                        </section>

                        {selectedMemoryForgetting.duplicate && (
                          <section>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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

                        <details className="rounded-xl bg-muted px-3 py-2">
                          <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
                            Technical details
                          </summary>
                          <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
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
                          <p className="mt-2 wrap-anywhere text-[11px] text-muted-foreground">
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
                  <div className="h-full overflow-y-auto overscroll-contain border-r border-border bg-muted/60 p-3">
                    {memoryForgettingError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                        {memoryForgettingError}
                      </p>
                    )}
                    {isLoadingMemoryForgetting ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        Archived memory를 불러오는 중입니다.
                      </p>
                    ) : memoryArchivedItems.length === 0 ? (
                      <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
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
                                ? "border-border bg-card shadow-sm"
                                : "border-transparent bg-card/60 hover:border-border hover:bg-card"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-foreground">
                                {item.semantic}
                              </p>
                              <Badge variant="secondary" className="shrink-0 rounded-full">
                                {item.archiveReason ?? item.reason}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
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
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
                        Archived memory를 불러오는 중입니다.
                      </div>
                    ) : !selectedMemoryArchived ? (
                      <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
                        선택된 archived memory가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <section className="space-y-3">
                          <div>
                            <h3 className="text-lg font-semibold text-foreground">
                              Archived memory
                            </h3>
                            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                              archivedAt이 있는 semantic item입니다. Retrieval
                              대상에서는 제외됩니다.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="rounded-full">
                              archiveReason{" "}
                              {selectedMemoryArchived.archiveReason ?? "—"}
                            </Badge>
                            <Badge variant="secondary" className="rounded-full">
                              archivedAt{" "}
                              {selectedMemoryArchived.archivedAt
                                ? new Date(
                                    selectedMemoryArchived.archivedAt,
                                  ).toLocaleString("ko-KR")
                                : "—"}
                            </Badge>
                            <Badge variant="secondary" className="rounded-full">
                              weight{" "}
                              {formatScore(
                                selectedMemoryArchived.weight,
                              )}
                            </Badge>
                          </div>
                        </section>

                        <section>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Semantic
                          </p>
                          <p className="wrap-anywhere rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground shadow-sm">
                            {selectedMemoryArchived.semantic}
                          </p>
                        </section>

                        {selectedMemoryArchived.duplicate && (
                          <section>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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

                        <details className="rounded-xl bg-muted px-3 py-2">
                          <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
                            Fields
                          </summary>
                          <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                            <span>
                              retrievedCount{" "}
                              {selectedMemoryArchived.retrievedCount}
                            </span>
                            <span>
                              duplicateOf{" "}
                              {selectedMemoryArchived.duplicateOf ?? "—"}
                            </span>
                          </div>
                          <p className="mt-2 wrap-anywhere text-[11px] text-muted-foreground">
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
                <div className="flex h-full min-h-0 overflow-hidden">
                  <MemoryClusterList
                    clusters={activeMemoryClusters}
                    selectedClusterId={selectedMemoryClusterId}
                    generatedAt={memoryGraphGeneratedAt}
                    hasStaleCache={
                      activeMemoryClusters.flatMap((c) => c.itemIds).length > 0 &&
                      activeMemoryClusters
                        .flatMap((c) => c.itemIds)
                        .every((id) => !allMemoryIdSet.has(id))
                    }
                    isRegenerating={isClusteringMemory}
                    onSelectCluster={(id) => {
                      setSelectedMemoryClusterId(id);
                      setSelectedAdminGraphMemoryId(null);
                    }}
                    onRegenerate={generateMemoryClusters}
                  />
                  <div className="flex min-w-0 flex-1 overflow-hidden">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      {isLoadingMemoryClusters ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          클러스터를 불러오는 중입니다.
                        </div>
                      ) : activeMemoryClusters.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          재생성 버튼을 눌러 클러스터를 생성하세요.
                        </div>
                      ) : (
                        <MemoryClusterGraph
                          clusters={activeMemoryClusters}
                          items={clusterableMemoryItems}
                          edges={activeMemoryGraphEdges}
                          selectedClusterId={selectedMemoryClusterId}
                          selectedMemoryId={selectedAdminGraphMemoryId}
                          onSelectCluster={(clusterId) => {
                            setSelectedMemoryClusterId(clusterId);
                            setSelectedAdminGraphMemoryId(null);
                          }}
                          onSelectMemory={setSelectedAdminGraphMemoryId}
                          showInlineDetail={false}
                          fill
                        />
                      )}
                    </div>
                    <MemoryClusterSidePanel
                      cluster={selectedMemoryCluster}
                      items={selectedClusterItems}
                      memories={adminClusterMemories}
                      selectedMemoryId={selectedAdminGraphMemoryId}
                      onSelectMemory={setSelectedAdminGraphMemoryId}
                      onDeleteMemory={deleteAdminMemory}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end border-t border-border px-6 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMemoryModal(null)}
                className="rounded-2xl px-4 text-xs"
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="flex items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-4">
            <Link
              href="/lobby"
              className="text-sm text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeftIcon size={14} className="inline" /> 로비
            </Link>
            <h1 className="text-lg font-semibold text-foreground">
              관리자 페이지
            </h1>
          </div>
          <Link
            href="/admin/new"
            className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            + 새 미션
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10 lg:px-10">
        <Tabs
          value={adminSection}
          onValueChange={(value) =>
            setAdminSection(value === "missions" ? "missions" : "users")
          }
        >
          <TabsList variant="line">
            <TabsTrigger value="users">유저</TabsTrigger>
            <TabsTrigger value="missions">미션</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-8">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                유저 목록
              </h2>
              <p className="text-sm text-muted-foreground">
                미션 참여 기록과 세션 데이터를 유저별로 모아봅니다.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={loadUsers}
              disabled={isLoadingUsers}
              className="rounded-2xl px-4 text-sm"
            >
              {isLoadingUsers ? "불러오는 중..." : "새로고침"}
            </Button>
          </div>

          {adminUsers.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-3xl border border-dashed border-border bg-card text-sm text-muted-foreground">
              {isLoadingUsers
                ? "유저 데이터를 불러오는 중입니다."
                : "아직 유저 데이터가 없습니다."}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {adminUsers.map((user) => {
                const badge = onboardingBadge(user.onboardingStatus);
                const missionIds = Array.from(
                  new Set([
                    ...(user.onboardingStatus === "completed"
                      ? [ONBOARDING_MISSION_ID]
                      : []),
                    ...user.missionIds,
                  ]),
                );
                return (
                  <div
                    key={user.id}
                    className="rounded-3xl border border-border bg-card p-5 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                          {(user.displayName ?? user.email ?? "?")
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {user.displayName ?? user.email ?? user.id}
                          </p>
                          <Badge variant={badge.variant} className="rounded-full">
                            {badge.label}
                          </Badge>
                          {user.isAdmin && (
                            <Badge
                              variant="outline"
                              className="rounded-full border-transparent bg-indigo-50 text-indigo-700"
                            >
                              관리자
                            </Badge>
                          )}
                        </div>
                        {user.displayName && user.email && (
                          <p className="truncate text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {user.id}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {missionIds.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          연결된 미션 없음
                        </span>
                      ) : (
                        missionIds.map((missionId) => {
                          const isCompleted =
                            missionId === ONBOARDING_MISSION_ID
                              ? user.onboardingStatus === "completed"
                              : user.completedSessionMissionIds.includes(
                                  missionId,
                                );
                          return (
                            <span
                              key={missionId}
                              className="inline-flex overflow-hidden rounded-full border border-border text-xs font-semibold"
                            >
                              <Link
                                href={`/main/${missionId}?viewAs=${user.id}`}
                                className="px-3 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              >
                                {missionTitle(missionId)}
                              </Link>
                              {isCompleted && (
                                <Link
                                  href={`/main/${missionId}?viewAs=${user.id}&review=1`}
                                  className="border-l border-border px-2.5 py-1 text-indigo-500 transition hover:bg-indigo-50 hover:text-indigo-700"
                                >
                                  리뷰
                                </Link>
                              )}
                            </span>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => openMemoryTable(user)}
                        disabled={isLoadingMemory}
                        className="h-auto rounded-md px-3 py-1.5 text-[11px] font-semibold text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 hover:no-underline disabled:text-muted-foreground"
                      >
                        메모리 테이블 보기 →
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => requestBackupAndDeleteSessions(user)}
                        disabled={deletingSessionsUserId === user.id}
                        className="h-auto rounded-md px-3 py-1.5 text-[11px] font-semibold text-red-400 hover:bg-red-50 hover:text-red-600 hover:no-underline disabled:text-muted-foreground"
                      >
                        {deletingSessionsUserId === user.id
                          ? "백업/삭제 중..."
                          : "세션 백업 후 삭제"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
          </TabsContent>

          <TabsContent value="missions" className="space-y-8">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">미션 목록</h2>
            <span className="text-sm text-muted-foreground">{missions.length}개</span>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  온보딩 설정
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  유저 {adminUsers.length}명
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={openOnboardingParticipants}
                className="rounded-full text-muted-foreground"
                title="온보딩 유저 보기"
              >
                <UsersThreeIcon size={16} />
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-xs font-semibold text-muted-foreground">
                제한 시간
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={onboardingSettings.durationMinutes}
                    onChange={(e) =>
                      setOnboardingSettings((prev) => ({
                        ...prev,
                        durationMinutes: Number(e.target.value) || 20,
                      }))
                    }
                    className="w-24"
                  />
                  <span className="text-sm font-normal text-muted-foreground">분</span>
                </div>
              </label>
              <Button
                type="button"
                onClick={saveOnboardingSettings}
                disabled={isSavingOnboardingSettings}
                className="rounded-2xl px-5"
              >
                {isSavingOnboardingSettings ? "저장 중..." : "저장"}
              </Button>
            </div>
          </div>

          {missions.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-3xl border border-dashed border-border bg-card text-sm text-muted-foreground">
              아직 미션이 없습니다. 첫 미션을 만들어보세요.
            </div>
          ) : (
            <div className="space-y-3">
              {missions.map((mission) => {
                const isEditing = editingId === mission.id;

                return (
                  <div
                    key={mission.id}
                    className="rounded-3xl border border-border bg-card px-6 py-5 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-3">
                        {isEditing ? (
                          <>
                            <Input
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
                              className="text-sm font-semibold"
                            />
                            <Textarea
                              value={editFields.description ?? ""}
                              onChange={(e) =>
                                setEditFields((p) => ({
                                  ...p,
                                  description: e.target.value,
                                }))
                              }
                              placeholder="미션 설명 (선택)"
                              rows={2}
                              className="resize-none text-sm text-muted-foreground"
                            />
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border text-muted-foreground hover:bg-muted"
                                  }`}
                                >
                                  {d === "desktop" ? "PC" : "모바일"}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>제한 시간 (분)</span>
                              <Input
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
                                className="w-20 text-xs"
                              />
                              <span className="text-muted-foreground">
                                (0 = 제한 없음)
                              </span>
                            </div>
                            <div className="space-y-3 rounded-2xl border border-border bg-muted p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-muted-foreground">
                                  옵션
                                </p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={addEditOption}
                                  className="text-xs"
                                >
                                  + 옵션 추가
                                </Button>
                              </div>
                              {normalizeOptions(
                                editFields.options as MissionOption[],
                              ).map((option, index) => (
                                <div
                                  key={option.id}
                                  className="space-y-2 rounded-xl border border-border bg-card p-3"
                                >
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold text-muted-foreground">
                                      옵션 {index + 1}
                                    </p>
                                    <Button
                                      type="button"
                                      variant="link"
                                      onClick={() =>
                                        removeEditOption(option.id)
                                      }
                                      className="h-auto p-0 text-xs text-red-400 hover:text-red-500 hover:no-underline"
                                    >
                                      삭제
                                    </Button>
                                  </div>
                                  <Input
                                    value={option.title}
                                    onChange={(e) =>
                                      updateEditOption(option.id, {
                                        title: e.target.value,
                                      })
                                    }
                                    placeholder="옵션 제목"
                                    className="text-xs"
                                  />
                                  <Textarea
                                    value={option.description}
                                    onChange={(e) =>
                                      updateEditOption(option.id, {
                                        description: e.target.value,
                                      })
                                    }
                                    placeholder="옵션 설명"
                                    rows={2}
                                    className="resize-none text-xs"
                                  />
                                  {/* Content — markdown */}
                                  <div className="space-y-1.5">
                                    <p className="text-xs font-semibold text-muted-foreground">
                                      콘텐츠 (마크다운)
                                    </p>
                                    <Textarea
                                      value={option.content}
                                      onChange={(e) =>
                                        updateEditOption(option.id, {
                                          content: e.target.value,
                                        })
                                      }
                                      placeholder={"## 서비스 개요\n- ..."}
                                      rows={4}
                                      className="resize-y font-mono text-xs"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => saveEdit(mission.id)}
                                className="rounded-xl px-4 text-xs"
                              >
                                저장
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingId(null)}
                                className="rounded-xl px-4 text-xs"
                              >
                                취소
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-3">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {mission.title}
                              </p>
                              <Badge variant="secondary" className="shrink-0 rounded-full">
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
                              </Badge>
                            </div>
                            {mission.description && (
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {mission.description}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              옵션 {mission.options?.length ?? 0}개
                            </p>
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => openParticipants(mission.id)}
                            className="rounded-full text-muted-foreground"
                            title="참여자 보기"
                          >
                            <UsersThreeIcon size={16} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => startEdit(mission)}
                            className="rounded-full text-muted-foreground"
                            title="수정"
                          >
                            <PencilSimpleIcon size={16} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => requestDeleteMission(mission)}
                            className="rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-400"
                            title="삭제"
                          >
                            <XIcon size={16} />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
          </TabsContent>
        </Tabs>
      </div>

      {/* Participants modal */}
      {participantsMissionId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeParticipants}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-card p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                {missionTitle(participantsMissionId)} 참여자
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={closeParticipants}
                className="rounded-full text-muted-foreground"
              >
                ✕
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  아직 유저 데이터가 없습니다.
                </p>
              ) : (
                participants.map((p) => {
                  const badge = onboardingBadge(p.onboardingStatus);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3"
                    >
                      {p.photoURL ? (
                        <img
                          src={p.photoURL}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {(p.displayName ?? p.email ?? "?")
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {p.displayName ?? p.email ?? p.id}
                        </p>
                        {p.displayName && p.email && (
                          <p className="truncate text-xs text-muted-foreground">
                            {p.email}
                          </p>
                        )}
                        <Badge variant={badge.variant} className="mt-1 rounded-full">
                          {badge.label}
                        </Badge>
                        {p.isAdmin && (
                          <Badge
                            variant="outline"
                            className="ml-1 mt-1 rounded-full border-transparent bg-indigo-50 text-indigo-700"
                          >
                            관리자
                          </Badge>
                        )}
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <Link
                          href={`/main/${participantsMissionId}?viewAs=${p.id}`}
                          className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => requestDeleteUserData(p)}
                          className="rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-500"
                          title={
                            p.isAdmin ? "관리자 미션 기록 삭제" : "미션 기록 삭제"
                          }
                        >
                          <XIcon size={14} />
                        </Button>
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
