"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";
import { isAdminEmail } from "@/lib/admin";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MemoryClusterEmptyState } from "@/components/memory/memory-cluster-empty-state";
import { MemoryClusterList } from "@/components/memory/memory-cluster-list";
import { MemoryClusterSidePanel } from "@/components/memory/memory-cluster-side-panel";
import type {
  ClusterGraphEdge,
  MemoryCluster,
  MemoryItem,
} from "@/components/memory/memory-cluster-types";

const NO_SESSION_KEY = "__no_session__";
const ONBOARDING_MISSION_ID = "onboarding";

// A memory belongs to the cumulative set for the selected mission when it is the
// onboarding base, or was created in a mission at/before the selected one in the
// user's randomized missionOrder. When missionOrder is missing, fall back to the
// selected mission only so the view does not invent a chronology.
function isWithinCumulative(
  memoryMissionId: string | null | undefined,
  selectedMissionId: string,
  missionOrder: string[],
) {
  if (memoryMissionId === ONBOARDING_MISSION_ID) return true;
  if (!memoryMissionId) return false;
  const selectedIndex = missionOrder.indexOf(selectedMissionId);
  if (selectedIndex === -1) return memoryMissionId === selectedMissionId;
  const memoryIndex = missionOrder.indexOf(memoryMissionId);
  if (memoryIndex === -1) return false;
  return memoryIndex <= selectedIndex;
}

function sessionFilterLabel(missionId: string | null, missionTitle?: string) {
  if (!missionId) return "세션 외";
  if (missionId === ONBOARDING_MISSION_ID) return "온보딩";
  return missionTitle ?? `${missionId.slice(0, 10)}…`;
}

function sessionFilterDate(timestamp: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  });
}

function isInactiveMemory(memory: MemoryItem) {
  return (
    Boolean(memory.archivedAt) ||
    (memory.weight != null && memory.weight <= 0)
  );
}

// 세션 종료 시 동결된 미션별 after snapshot. 세션 칩과 전체 탭은 이걸 그대로
// 렌더해 세션 리뷰 overlay와 같은 클러스터를 보여준다.
type AfterClusterSnapshot = {
  missionId: string;
  itemIds: string[];
  clusters: MemoryCluster[];
  edges: ClusterGraphEdge[];
  generatedAt: number | null;
};

function parseAfterSnapshots(
  value: unknown,
): Record<string, AfterClusterSnapshot> {
  if (!Array.isArray(value)) return {};
  const result: Record<string, AfterClusterSnapshot> = {};
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const data = raw as Record<string, unknown>;
    const missionId =
      typeof data.missionId === "string" && data.missionId.trim()
        ? data.missionId.trim()
        : null;
    const clusters: MemoryCluster[] = Array.isArray(data.graphClusters)
      ? (data.graphClusters as MemoryCluster[])
      : [];
    if (!missionId || clusters.length === 0) continue;
    result[missionId] = {
      missionId,
      itemIds: Array.isArray(data.itemIds)
        ? data.itemIds.map(String).filter(Boolean)
        : [],
      clusters,
      edges: Array.isArray(data.graphEdges)
        ? (data.graphEdges as ClusterGraphEdge[])
        : [],
      generatedAt:
        typeof data.generatedAt === "number" ? data.generatedAt : null,
    };
  }
  return result;
}

const MemoryClusterGraph = dynamic(
  () => import("@/components/memory/memory-cluster-graph"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-96 items-center justify-center gap-2 bg-white text-sm text-slate-400">
        <Spinner />
        Graph view loading...
      </div>
    ),
  },
);

type MemoryClusterPageProps = {
  targetUserId?: string;
  backHref?: string;
};

export function MemoryClusterPage({
  targetUserId,
  backHref = "/lobby",
}: MemoryClusterPageProps = {}) {
  const router = useRouter();
  const targetPath = targetUserId
    ? `/api/admin/users/${encodeURIComponent(targetUserId)}/memory`
    : "/api/memory";
  const memoryEndpoint = targetUserId
    ? `${targetPath}?includeInactive=1`
    : `${targetPath}/all?includeInactive=1`;
  const clustersEndpoint = `${targetPath}/clusters`;
  const [currentUser, setCurrentUser] = useState<
    import("firebase/auth").User | null
  >(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [clusters, setClusters] = useState<MemoryCluster[]>([]);
  const [clusterEdges, setClusterEdges] = useState<ClusterGraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null,
  );
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(
    null,
  );
  const [showInactiveMemories, setShowInactiveMemories] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [subjectName, setSubjectName] = useState<string | null>(null);
  const [missionTitleById, setMissionTitleById] = useState<
    Record<string, string>
  >({});
  const [missionOrder, setMissionOrder] = useState<string[]>([]);
  const [clustersGeneratedAt, setClustersGeneratedAt] = useState<number | null>(
    null,
  );
  const [afterSnapshots, setAfterSnapshots] = useState<
    Record<string, AfterClusterSnapshot>
  >({});
  const [lastAfterMissionId, setLastAfterMissionId] = useState<string | null>(
    null,
  );

  const applyClusterData = (clusterData: {
    clusters?: unknown;
    edges?: unknown;
    generatedAt?: unknown;
    afterSnapshots?: unknown;
    lastAfterMissionId?: unknown;
  } | null) => {
    const cls: MemoryCluster[] = Array.isArray(clusterData?.clusters)
      ? clusterData.clusters
      : [];
    const edges: ClusterGraphEdge[] = Array.isArray(clusterData?.edges)
      ? clusterData.edges
      : [];
    setClusters(cls);
    setClusterEdges(edges);
    setSelectedClusterId(cls[0]?.id ?? null);
    setSelectedMemoryId(null);
    setSelectedSessionKey(null);
    setClustersGeneratedAt(
      typeof clusterData?.generatedAt === "number"
        ? clusterData.generatedAt
        : null,
    );
    setAfterSnapshots(parseAfterSnapshots(clusterData?.afterSnapshots));
    setLastAfterMissionId(
      typeof clusterData?.lastAfterMissionId === "string" &&
        clusterData.lastAfterMissionId.trim()
        ? clusterData.lastAfterMissionId.trim()
        : null,
    );
  };

  // 로드 실패를 빈 데이터로 오인 표시하지 않도록 !ok 응답은 reject하고,
  // cold route/transient 오류는 1회 재시도로 흡수한다.
  const fetchJsonWithRetry = async (
    url: string,
    headers: Record<string, string>,
  ) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers });
        if (res.ok) return res.json();
        if (attempt === 1) throw new Error(`${url} failed: ${res.status}`);
      } catch (error) {
        if (attempt === 1) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`${url} failed`);
  };

  const loadData = (user: import("firebase/auth").User) =>
    getIdToken(user).then((token) => {
      const headers = { Authorization: `Bearer ${token}` };
      return Promise.all([
        fetchJsonWithRetry(memoryEndpoint, headers),
        fetchJsonWithRetry(clustersEndpoint, headers),
      ]).then(([memData, clusterData]) => {
        const mems: MemoryItem[] = Array.isArray(memData?.memories)
          ? memData.memories
          : [];
        setMemories(mems);
        setMissionOrder(
          Array.isArray(memData?.missionOrder)
            ? memData.missionOrder.map(String)
            : [],
        );
        setSubjectName(
          typeof memData?.displayName === "string" && memData.displayName.trim()
            ? memData.displayName.trim()
            : targetUserId
              ? null
              : (user.displayName ?? null),
        );
        applyClusterData(clusterData);
        setLoadError(false);
      });
    });

  const handleRetryLoad = () => {
    if (!currentUser || loading) return;
    setLoading(true);
    setLoadError(false);
    loadData(currentUser)
      .catch((err) => {
        console.error("[agent] reload failed", err);
        setLoadError(true);
        toast.error("메모리 데이터를 불러오지 못했어요.");
      })
      .finally(() => setLoading(false));
  };

  const handleRegenerate = async () => {
    if (!currentUser || isRegenerating) return;
    setIsRegenerating(true);
    try {
      const token = await getIdToken(currentUser);
      const res = await fetch(clustersEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "생성 실패");
      const cls: MemoryCluster[] = Array.isArray(data?.clusters)
        ? data.clusters
        : [];
      const edges: ClusterGraphEdge[] = Array.isArray(data?.edges)
        ? data.edges
        : [];
      setClusters(cls);
      setClusterEdges(edges);
      setSelectedClusterId(cls[0]?.id ?? null);
      setSelectedMemoryId(null);
      setClustersGeneratedAt(data?.generatedAt ?? null);
      toast.success("기억 클러스터를 다시 생성했어요.");
    } catch (err) {
      console.error("[agent] regenerate failed", err);
      toast.error(
        err instanceof Error ? err.message : "클러스터 생성에 실패했어요.",
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }
      if (targetUserId && !isAdminEmail(user.email)) {
        router.replace("/lobby");
        return;
      }
      setCurrentUser(user);
      setLoading(true);
      loadData(user)
        .catch((err) => {
          console.error("[agent] load failed", err);
          setLoadError(true);
        })
        .finally(() => setLoading(false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mission titles for the session filter labels (global `missions` collection).
  useEffect(() => {
    getDocs(collection(db, "missions"))
      .then((snap) => {
        setMissionTitleById(
          Object.fromEntries(
            snap.docs.map((d) => [d.id, String(d.data()?.title ?? d.id)]),
          ),
        );
      })
      .catch((err) => {
        console.error("[agent] failed to load mission titles", err);
      });
  }, []);

  // In cumulative view, "new" = memories created in the selected mission itself
  // (not the carried-over onboarding/prior base). Tag those with a "promoted"
  // token so the shared graph ring + side-panel badge highlight them. "전체"(null)
  // and the no-session bucket have no single selected mission, so nothing is new.
  const highlightMissionId =
    selectedSessionKey && selectedSessionKey !== NO_SESSION_KEY
      ? selectedSessionKey
      : null;

  // MemoryClusterGraph expects ClusterableMemoryItem shape
  const clusterItems = useMemo(
    () =>
      memories.map((m) => ({
        id: m.id,
        memoryId: m.id,
        semantic: m.semantic ?? "",
        episodic: m.episodic ?? "",
        input: m.input ?? "",
        output: m.output ?? "",
        action:
          highlightMissionId && m.source?.missionId === highlightMissionId
            ? [m.action, "promoted"].filter(Boolean).join(" / ")
            : (m.action ?? ""),
        sourceType: m.sourceType,
        weight: m.weight,
        embedding: m.embedding,
        timestamp: m.timestamp ?? 0,
        archivedAt: m.archivedAt ?? null,
        archiveReason: m.archiveReason ?? null,
        inactive: isInactiveMemory(m),
        inactiveReason: m.inactiveReason ?? null,
        inactiveReasonDetail: m.inactiveReasonDetail ?? null,
        keyword: m.keywords,
        keywords: m.keywords,
        row: {
          source: m.source ?? undefined,
        },
      })),
    [highlightMissionId, memories],
  );

  // 세션 칩과 전체 탭에서 렌더할 동결 after snapshot. 전체(null)는 마지막 완료
  // 세션의 snapshot을 그대로 쓴다 — +N 하이라이트만 없는 완전판. 세션 외 버킷과
  // snapshot이 없는 미션만 기존 최신 캐시 node 필터로 폴백한다.
  const activeSnapshot = useMemo(() => {
    if (selectedSessionKey === NO_SESSION_KEY) return null;
    const missionKey = selectedSessionKey ?? lastAfterMissionId;
    return missionKey ? (afterSnapshots[missionKey] ?? null) : null;
  }, [afterSnapshots, lastAfterMissionId, selectedSessionKey]);
  const sourceClusters = activeSnapshot ? activeSnapshot.clusters : clusters;
  const sourceClusterEdges = activeSnapshot
    ? activeSnapshot.edges
    : clusterEdges;

  const clusterItemIdSet = new Set(
    clusterItems.filter((item) => !item.inactive).map((item) => item.id),
  );
  const totalClusterItemIds = clusters.flatMap((c) => c.itemIds);
  const matchedCount = totalClusterItemIds.filter((id) =>
    clusterItemIdSet.has(id),
  ).length;
  const hasStaleCache =
    !activeSnapshot && totalClusterItemIds.length > 0 && matchedCount === 0;

  // Group memories by the session (mission) they were generated in, so the
  // graph/list/detail views can be narrowed down to a single session's nodes.
  const sessionFilterOptions = useMemo(() => {
    const groups = new Map<
      string,
      { missionId: string | null; count: number; latestTimestamp: number }
    >();
    memories.forEach((memory) => {
      const missionId = memory.source?.missionId ?? null;
      const key = missionId ?? NO_SESSION_KEY;
      const existing = groups.get(key);
      const timestamp = memory.timestamp ?? 0;
      if (existing) {
        existing.count += 1;
        existing.latestTimestamp = Math.max(
          existing.latestTimestamp,
          timestamp,
        );
      } else {
        groups.set(key, { missionId, count: 1, latestTimestamp: timestamp });
      }
    });
    return Array.from(groups.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  }, [memories]);

  // Cumulative: selecting a mission shows that mission plus every earlier one
  // (onboarding base + prior missions). The no-session bucket stays exact since
  // those memories have no comparable mission. "전체"(null) follows the last
  // completed mission's snapshot scope when one exists, so it is identical to
  // that session's view; without a snapshot it falls back to all memories.
  const sessionFilteredClusterItems = useMemo(() => {
    if (selectedSessionKey === NO_SESSION_KEY) {
      return clusterItems.filter((item) => !item.row.source?.missionId);
    }
    const scopeMissionId = selectedSessionKey ?? activeSnapshot?.missionId ?? null;
    const scoped = scopeMissionId
      ? clusterItems.filter((item) =>
          isWithinCumulative(
            item.row.source?.missionId,
            scopeMissionId,
            missionOrder,
          ),
        )
      : clusterItems;
    if (!activeSnapshot) return scoped;
    // 동결 snapshot 뷰의 노드 가시성은 리뷰 overlay와 동일: snapshot 멤버이거나
    // 현재 비활성(비활성 그룹 표시용)인 메모리만 남긴다. snapshot 이후 상태가
    // 바뀐 메모리(예: 나중에 재활성화)는 여기서 제외되어 리뷰와 같은 화면이 된다.
    const snapshotItemIds = new Set(activeSnapshot.itemIds);
    return scoped.filter(
      (item) => snapshotItemIds.has(item.id) || item.inactive,
    );
  }, [activeSnapshot, clusterItems, missionOrder, selectedSessionKey]);

  const inactiveFilteredItems = useMemo(
    () => sessionFilteredClusterItems.filter((item) => item.inactive),
    [sessionFilteredClusterItems],
  );
  const inactiveMemoryIdSet = useMemo(
    () => new Set(inactiveFilteredItems.map((item) => item.id)),
    [inactiveFilteredItems],
  );
  const filteredClusterItems = useMemo(
    () =>
      showInactiveMemories
        ? sessionFilteredClusterItems
        : sessionFilteredClusterItems.filter((item) => !item.inactive),
    [sessionFilteredClusterItems, showInactiveMemories],
  );

  // Narrow the cluster list (left panel) to clusters that still have at least
  // one item within the selected session, with counts adjusted to match. The
  // cluster source is the frozen snapshot when one is active, so membership and
  // boundaries match the session review; the latest cache is fallback only.
  const filteredClusters = useMemo(() => {
    const idSet = new Set(
      sessionFilteredClusterItems
        .filter((item) => !item.inactive)
        .map((item) => item.id),
    );
    return sourceClusters
      .map((cluster) => {
        const itemIds = cluster.itemIds.filter((id) => idSet.has(id));
        return { ...cluster, itemIds, count: itemIds.length };
      })
      .filter((cluster) => cluster.itemIds.length > 0);
  }, [sourceClusters, sessionFilteredClusterItems]);
  const filteredClusterEdges = useMemo(() => {
    const idSet = new Set(filteredClusterItems.map((item) => item.id));
    return sourceClusterEdges.filter(
      (edge) =>
        idSet.has(edge.sourceId) &&
        idSet.has(edge.targetId) &&
        !inactiveMemoryIdSet.has(edge.sourceId) &&
        !inactiveMemoryIdSet.has(edge.targetId),
    );
  }, [sourceClusterEdges, filteredClusterItems, inactiveMemoryIdSet]);

  const inactiveCluster = useMemo<MemoryCluster>(
    () => ({
      id: "session-inactive",
      label: "비활성 메모리",
      summary:
        "유사 메모리 정리, weight 0 도달, 사용자 설정으로 비활성화된 메모리 모음입니다. 클러스터로 묶이지 않습니다.",
      count: showInactiveMemories ? inactiveFilteredItems.length : 0,
      relatedActions: [],
      itemIds: showInactiveMemories
        ? inactiveFilteredItems.map((item) => item.id)
        : [],
      representativeItems: [],
      hideArea: true,
    }),
    [inactiveFilteredItems, showInactiveMemories],
  );
  const graphClusters = useMemo(
    () => [...filteredClusters, inactiveCluster],
    [filteredClusters, inactiveCluster],
  );

  // Per-cluster count of notes newly created in the selected session tab. "new"
  // matches the graph's "promoted" ring: memories authored in the selected
  // mission itself (highlightMissionId), not the carried-over base. "전체"/no-
  // session tabs have no single mission, so every cluster shows nothing.
  const addedCountByClusterId = useMemo(() => {
    const result: Record<string, number> = {};
    if (!highlightMissionId) return result;
    const newMemoryIdSet = new Set(
      memories
        .filter((memory) => memory.source?.missionId === highlightMissionId)
        .map((memory) => memory.id),
    );
    if (newMemoryIdSet.size === 0) return result;
    for (const cluster of filteredClusters) {
      const added = cluster.itemIds.filter((id) =>
        newMemoryIdSet.has(id),
      ).length;
      if (added > 0) result[cluster.id] = added;
    }
    return result;
  }, [filteredClusters, memories, highlightMissionId]);

  // Keep the selected cluster valid whenever the session filter narrows the list.
  useEffect(() => {
    setSelectedClusterId((current) =>
      graphClusters.length === 0
        ? null
        : current && graphClusters.some((c) => c.id === current)
          ? current
          : graphClusters[0].id,
    );
  }, [graphClusters]);

  const handleSelectSession = (key: string | null) => {
    setSelectedSessionKey(key);
    setSelectedMemoryId(null);
  };

  const selectedCluster =
    graphClusters.find((c) => c.id === selectedClusterId) ?? null;
  const selectedClusterItems = selectedCluster
    ? filteredClusterItems.filter((item) =>
        selectedCluster.itemIds.includes(item.id),
      )
    : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="flex items-center gap-3 px-6 py-4 lg:px-10">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => router.push(backHref)}
            className="cursor-pointer rounded-full text-muted-foreground"
            aria-label="로비로 돌아가기"
          >
            <ArrowLeftIcon size={18} />
          </Button>

          <p className="min-w-0 truncate text-base font-semibold text-foreground">
            {subjectName ? `${subjectName}의 메모리` : "전체 메모리 데이터"}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Spinner />
          불러오는 중...
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <p className="text-sm text-muted-foreground">
            메모리 데이터를 불러오지 못했습니다. 일시적인 서버 오류일 수
            있어요.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetryLoad}
            className="cursor-pointer rounded-full px-4"
          >
            다시 시도
          </Button>
        </div>
      ) : clusters.length === 0 &&
        Object.keys(afterSnapshots).length === 0 &&
        inactiveFilteredItems.length === 0 ? (
        <div>
          <MemoryClusterEmptyState
            canGenerate={
              memories.filter((memory) => !isInactiveMemory(memory)).length >= 3
            }
            isRegenerating={isRegenerating}
            onGenerate={handleRegenerate}
          />
        </div>
      ) : (
        <div className="flex h-[calc(100vh-57px)] flex-col overflow-hidden">
          {sessionFilterOptions.length > 1 ? (
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-4 py-2.5">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                세션
              </span>
              <button
                type="button"
                onClick={() => handleSelectSession(null)}
                className={cn(
                  "shrink-0 cursor-pointer rounded-full border px-3 py-1 text-xs transition",
                  selectedSessionKey === null
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-border bg-white text-muted-foreground hover:bg-muted",
                )}
              >
                전체
                <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full border border-current/40 px-1.5 text-[10px] leading-4 tabular-nums opacity-80">
                  {memories.length}
                </span>
              </button>
              {sessionFilterOptions.map((option) => {
                const title = option.missionId
                  ? missionTitleById[option.missionId]
                  : undefined;
                const date = sessionFilterDate(option.latestTimestamp);
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleSelectSession(option.key)}
                    title={option.missionId ?? "세션 정보가 없는 기억"}
                    className={cn(
                      "shrink-0 cursor-pointer rounded-full border px-3 py-1 text-xs transition",
                      selectedSessionKey === option.key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-border bg-white text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {sessionFilterLabel(option.missionId, title)}
                    {date && <span className="ml-1.5 opacity-70">{date}</span>}
                    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full border border-current/40 px-1.5 text-[10px] leading-4 tabular-nums opacity-80">
                      {option.count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
            <MemoryClusterList
              clusters={filteredClusters}
              selectedClusterId={selectedClusterId}
              generatedAt={
                activeSnapshot ? activeSnapshot.generatedAt : clustersGeneratedAt
              }
              hasStaleCache={hasStaleCache}
              isRegenerating={isRegenerating}
              onSelectCluster={(clusterId) => {
                setSelectedClusterId(clusterId);
                setSelectedMemoryId(null);
              }}
              presentation="review"
              nodeCount={filteredClusterItems.length}
              edgeCount={filteredClusterEdges.length}
              addedCountByClusterId={addedCountByClusterId}
              inactiveMemoryCount={inactiveFilteredItems.length}
              inactiveMemoriesSelected={
                selectedClusterId === "session-inactive"
              }
              showInactiveMemories={showInactiveMemories}
              onSelectInactiveMemories={() => {
                setShowInactiveMemories(true);
                setSelectedClusterId("session-inactive");
                setSelectedMemoryId(null);
              }}
              onToggleInactiveMemories={() => {
                const next = !showInactiveMemories;
                setShowInactiveMemories(next);
                if (!next && selectedClusterId === "session-inactive") {
                  setSelectedClusterId(filteredClusters[0]?.id ?? null);
                  setSelectedMemoryId(null);
                }
              }}
            />

            <div className="flex min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <MemoryClusterSidePanel
                cluster={selectedCluster}
                items={selectedClusterItems}
                memories={memories}
                selectedMemoryId={selectedMemoryId}
                onSelectMemory={setSelectedMemoryId}
                getMissionLabel={(missionId) =>
                  sessionFilterLabel(missionId, missionTitleById[missionId])
                }
              />
              <div className="min-w-0 flex-1 overflow-hidden">
                <MemoryClusterGraph
                  clusters={graphClusters}
                  items={filteredClusterItems}
                  edges={filteredClusterEdges}
                  selectedClusterId={selectedClusterId}
                  selectedMemoryId={selectedMemoryId}
                  onSelectCluster={setSelectedClusterId}
                  onSelectMemory={(memoryId) => {
                    setSelectedMemoryId(memoryId);
                    if (inactiveMemoryIdSet.has(memoryId)) {
                      setSelectedClusterId("session-inactive");
                    }
                  }}
                  getMissionLabel={(missionId) =>
                    sessionFilterLabel(missionId, missionTitleById[missionId])
                  }
                  showInlineDetail={false}
                  fill
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentMemoryPage() {
  return <MemoryClusterPage />;
}
