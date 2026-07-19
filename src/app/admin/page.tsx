"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
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
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import {
  AdminUserCard,
  type AdminUser,
  type Participant,
} from "@/components/admin/admin-user-card";
import { missionProgressFromSession } from "@/lib/mission-progress";
import {
  MemoryRetrievalsView,
  formatScore,
  type MemoryRetrievalLog,
} from "@/components/admin/memory-log-views";
import {
  ReviewFeedbackView,
  type AdminReviewFeedbackRow,
} from "@/components/admin/review-feedback-view";
import { MemoryClusterList } from "@/components/memory/memory-cluster-list";
import { MemoryClusterSidePanel } from "@/components/memory/memory-cluster-side-panel";
import type { MemoryItem } from "@/components/memory/memory-cluster-types";

const MemoryClusterGraph = dynamic(
  () => import("@/components/memory/memory-cluster-graph"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-112 min-h-96 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm text-muted-foreground shadow-sm">
        <Spinner />
        Graph view loading...
      </div>
    ),
  },
);

const ONBOARDING_MISSION_ID = "onboarding";

type Device = "desktop" | "mobile";

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
  source?: { missionId?: string; draftId?: string; sourceText?: string };
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
  | "retrievals";
type DestructiveAdminAction = {
  type: "all-memory";
  userId: string;
  version: string;
};

type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
  colorIndex?: number;
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

type AssetImage = {
  url: string;
  path: string;
  note?: string;
};

type MissionOption = {
  id: string;
  title: string;
  description: string;
  content: string;
  assetImages?: AssetImage[];
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

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [reviewFeedbackRows, setReviewFeedbackRows] = useState<
    AdminReviewFeedbackRow[]
  >([]);
  const [isLoadingReviewFeedback, setIsLoadingReviewFeedback] = useState(false);
  const [reviewFeedbackError, setReviewFeedbackError] = useState<string | null>(
    null,
  );
  const [missions, setMissions] = useState<Mission[]>([]);
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
  const [memoryViewTab, setMemoryViewTab] = useState<MemoryViewTab>("clusters");
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
  const [memoryGraphGeneratedAt, setMemoryGraphGeneratedAt] = useState<
    number | null
  >(null);
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
  const [isDeletingMemory, setIsDeletingMemory] = useState(false);
  const [onboardingSettings, setOnboardingSettings] =
    useState<OnboardingSettings>(defaultOnboardingSettings);
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
        {
          onboardingStatus: Participant["onboardingStatus"];
          stitchApiGroup?: Participant["stitchApiGroup"];
        }
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
        {
          onboardingStatus: Participant["onboardingStatus"];
          stitchApiGroup?: Participant["stitchApiGroup"];
        }
      >;
    }
    const data = (await res.json()) as {
      statuses?: Record<
        string,
        {
          onboardingStatus: Participant["onboardingStatus"];
          stitchApiGroup?: Participant["stitchApiGroup"];
        }
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
        stitchApiGroup:
          changes.stitchApiGroup ?? prev?.stitchApiGroup,
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
        missionOrder: changes.missionOrder ?? prev?.missionOrder ?? [],
        missionProgressById:
          changes.missionProgressById ?? prev?.missionProgressById ?? {},
        memoryReviewSubmittedByMissionId:
          changes.memoryReviewSubmittedByMissionId ??
          prev?.memoryReviewSubmittedByMissionId ??
          {},
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
        stitchApiGroup: user.stitchApiGroup,
        isAdmin: user.isAdmin,
        missionOrder: user.missionOrder,
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

    // Session progress + review submission come from a single aggregated
    // endpoint. The server reads sessions/{uid}/missions with a scalar-field
    // projection, so the multi-MB messages/artboards arrays never leave
    // Firestore (previously the client SDK downloaded every session doc in
    // full — ~9MB for 16 users).
    const progressToken = await getAdminToken();
    const progressResponse = progressToken
      ? await fetch("/api/admin/users/progress", {
          headers: { Authorization: `Bearer ${progressToken}` },
        }).catch(() => null)
      : null;
    const progressByUid = (
      progressResponse?.ok ? await progressResponse.json().catch(() => null) : null
    )?.progress as Record<
      string,
      {
        missions?: Record<string, Record<string, unknown>>;
        reviewSubmittedAt?: Record<string, number | null>;
      }
    > | null;
    for (const [sessionUserId, entry] of Object.entries(progressByUid ?? {})) {
      const missionsById = entry.missions ?? {};
      const sessionMissionIds = Object.keys(missionsById);
      if (sessionMissionIds.length === 0 && !entry.reviewSubmittedAt) continue;
      const existing = users.get(sessionUserId);
      const missionProgressById = Object.fromEntries(
        sessionMissionIds.map((sessionMissionId) => [
          sessionMissionId,
          missionProgressFromSession(missionsById[sessionMissionId] ?? {}),
        ]),
      );
      const completedSessionMissionIds = sessionMissionIds.filter(
        (sessionMissionId) =>
          missionsById[sessionMissionId]?.status === "completed",
      );
      upsertUser(sessionUserId, {
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
        missionProgressById: {
          ...(existing?.missionProgressById ?? {}),
          ...missionProgressById,
        },
        memoryReviewSubmittedByMissionId: {
          ...(existing?.memoryReviewSubmittedByMissionId ?? {}),
          ...(entry.reviewSubmittedAt ?? {}),
        },
      });
    }

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

  const loadReviewFeedback = async () => {
    setIsLoadingReviewFeedback(true);
    setReviewFeedbackError(null);
    try {
      const token = await getAdminToken();
      if (!token) throw new Error("no_token");
      const response = await fetch("/api/admin/review-feedback", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`load_failed_${response.status}`);
      const data = (await response.json()) as {
        rows?: AdminReviewFeedbackRow[];
      };
      setReviewFeedbackRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setReviewFeedbackError("리뷰 답변을 불러오지 못했습니다.");
    } finally {
      setIsLoadingReviewFeedback(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    loadReviewFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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
          archivedAt:
            row.semanticItems?.find((item) => item.archivedAt)?.archivedAt ??
            null,
          archiveReason: null,
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
        sourceType:
          row.sourceType ?? row.memorySource ?? row.type ?? "during_session",
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
        setMemoryGraphGeneratedAt(
          typeof data.generatedAt === "number" ? data.generatedAt : null,
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
    ? {
        title: "메모리를 전체 삭제할까요?",
        description: `선택한 사용자의 v${destructiveAction.version} 메모리를 전체 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
        actionLabel: "메모리 삭제",
      }
    : null;

  const runDestructiveAction = async () => {
    if (!destructiveAction) return;
    const action = destructiveAction;
    setDestructiveAction(null);
    if (action.type === "all-memory") {
      await deleteAllMemory(action.userId, action.version);
    }
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
                <p className="text-xs text-muted-foreground">
                  {memoryModal.userName}
                </p>
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
              </div>
            </div>
            <div className="h-[calc(100vh-14rem)] min-h-80">
              {memoryViewTab === "table" ? (
                <div className="h-full overflow-y-auto overscroll-contain">
                  <AdminDataTable
                    rows={visibleMemoryRows}
                    rowKey={(row) =>
                      `${row.version ?? "unknown"}-${row.type}-${row.id}`
                    }
                    emptyMessage={`v${memoryVersionTab} 메모리 없음`}
                    tableClassName="min-w-240"
                    columns={[
                      {
                        key: "timestamp",
                        label: "Timestamp",
                        cellClassName:
                          "whitespace-nowrap text-muted-foreground",
                        render: (row) =>
                          row.timestamp
                            ? new Date(row.timestamp as number).toLocaleString(
                                "ko-KR",
                                {
                                  month: "numeric",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )
                            : "—",
                      },
                      {
                        key: "mission",
                        label: "Mission",
                        cellClassName:
                          "whitespace-nowrap text-xs text-muted-foreground",
                        render: (row) => row.source?.missionId ?? "—",
                      },
                      {
                        key: "action",
                        label: "Action",
                        cellClassName: "whitespace-nowrap",
                        render: (row) =>
                          row.agentActionCategory ? (
                            <Badge variant="warning" className="rounded-full">
                              {row.agentActionCategory}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          ),
                      },
                      {
                        key: "input",
                        label: "Input",
                        cellClassName: "max-w-64 wrap-anywhere text-foreground",
                        render: (row) => row.input ?? "",
                      },
                      {
                        key: "episode",
                        label: "Episode",
                        cellClassName:
                          "max-w-72 wrap-anywhere text-muted-foreground italic",
                        render: (row) => row.episode ?? "",
                      },
                      {
                        key: "semantic",
                        label: "Semantic",
                        cellClassName: "max-w-80 wrap-anywhere",
                        render: (row) => {
                          const semantics = semanticItems(row);
                          return semantics.length === 0 ? (
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
                          );
                        },
                      },
                      {
                        key: "weight",
                        label: "Weight",
                        cellClassName: "whitespace-nowrap",
                        render: (row) => {
                          const weights = memoryWeights(row);
                          return weights.length === 0 ? (
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
                          );
                        },
                      },
                      {
                        key: "keywords",
                        label: "Keywords",
                        cellClassName: "max-w-48 wrap-anywhere",
                        render: (row) => (
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
                        ),
                      },
                    ]}
                  />
                </div>
              ) : memoryViewTab === "retrievals" ? (
                <MemoryRetrievalsView
                  logs={memoryRetrievalLogs}
                  selected={selectedMemoryRetrieval}
                  isLoading={isLoadingMemoryRetrievals}
                  error={memoryRetrievalError}
                  onSelect={setSelectedMemoryRetrievalId}
                />
              ) : (
                <div className="flex h-full min-h-0 overflow-hidden">
                  <MemoryClusterList
                    clusters={activeMemoryClusters}
                    selectedClusterId={selectedMemoryClusterId}
                    generatedAt={memoryGraphGeneratedAt}
                    hasStaleCache={
                      activeMemoryClusters.flatMap((c) => c.itemIds).length >
                        0 &&
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
                        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Spinner />
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
                      getMissionLabel={missionTitle}
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
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10 lg:px-10">
        <Tabs defaultValue="users">
          <TabsList variant="line">
            <TabsTrigger value="users">유저</TabsTrigger>
            <TabsTrigger value="reviews">리뷰 답변</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="space-y-4 pt-6">
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
                  {isLoadingUsers ? (
                    <>
                      <Spinner className="size-3.5" />
                      불러오는 중...
                    </>
                  ) : (
                    "새로고침"
                  )}
                </Button>
              </div>

              {adminUsers.length === 0 ? (
                <div className="flex h-32 items-center justify-center gap-2 rounded-3xl border border-dashed border-border bg-card text-sm text-muted-foreground">
                  {isLoadingUsers ? (
                    <>
                      <Spinner />
                      유저 데이터를 불러오는 중입니다.
                    </>
                  ) : (
                    "아직 유저 데이터가 없습니다."
                  )}
                </div>
              ) : (
                <div className="grid gap-3">
                  {adminUsers.map((user) => (
                    <AdminUserCard
                      key={user.id}
                      user={user}
                      onboardingMissionId={ONBOARDING_MISSION_ID}
                      missionTitle={missionTitle}
                      missionDurationMinutes={(missionId) =>
                        missionId === ONBOARDING_MISSION_ID
                          ? onboardingSettings.durationMinutes
                          : missions.find((mission) => mission.id === missionId)
                              ?.durationMinutes ?? undefined
                      }
                    />
                  ))}
                </div>
              )}
          </TabsContent>

          <TabsContent value="reviews" className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                메모리 리뷰 답변
              </h2>
              <p className="text-sm text-muted-foreground">
                참가자들이 세션 리뷰(파트1·파트2)에서 제출한 답변을 세션별로
                모아봅니다.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={loadReviewFeedback}
              disabled={isLoadingReviewFeedback}
              className="rounded-2xl px-4 text-sm"
            >
              {isLoadingReviewFeedback ? (
                <>
                  <Spinner className="size-3.5" />
                  불러오는 중...
                </>
              ) : (
                "새로고침"
              )}
            </Button>
          </div>

          {reviewFeedbackError ? (
            <div className="flex h-32 items-center justify-center rounded-3xl border border-dashed border-border bg-card text-sm text-destructive">
              {reviewFeedbackError}
            </div>
          ) : reviewFeedbackRows.length === 0 ? (
            <div className="flex h-32 items-center justify-center gap-2 rounded-3xl border border-dashed border-border bg-card text-sm text-muted-foreground">
              {isLoadingReviewFeedback ? (
                <>
                  <Spinner />
                  리뷰 답변을 불러오는 중입니다.
                </>
              ) : (
                "아직 제출된 리뷰 답변이 없습니다."
              )}
            </div>
          ) : (
            <ReviewFeedbackView
              rows={reviewFeedbackRows}
              missionTitle={missionTitle}
            />
          )}
          </TabsContent>
        </Tabs>

      </div>

    </div>
  );
}
