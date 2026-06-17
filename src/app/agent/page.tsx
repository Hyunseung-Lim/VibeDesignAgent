"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
const CLUSTER_VARIANTS = [
  {
    value: "semantic-only",
    label: "Semantic only",
    description: "해석 메모리만",
  },
  {
    value: "compact-context",
    label: "Semantic + Episode",
    description: "원문 로그 제외",
  },
  {
    value: "full-context",
    label: "Full context",
    description: "현재 기준",
  },
] as const;
type ClusterVariant = (typeof CLUSTER_VARIANTS)[number]["value"];

// Chronological rank for cumulative memory views. Mission ids are
// `mission-YYYYMMDD-HHmmss`, so plain string compare = time order. Onboarding is
// the base and always sorts first; unknown ids sort last.
function missionOrderKey(missionId: string | null | undefined) {
  if (missionId === ONBOARDING_MISSION_ID) return "";
  return missionId ?? "￿";
}

// A memory belongs to the cumulative set for the selected mission when it is the
// onboarding base, or was created in a mission at/before the selected one.
function isWithinCumulative(
  memoryMissionId: string | null | undefined,
  selectedMissionId: string,
) {
  if (memoryMissionId === ONBOARDING_MISSION_ID) return true;
  if (!memoryMissionId) return false;
  return missionOrderKey(memoryMissionId) <= missionOrderKey(selectedMissionId);
}

function sessionFilterLabel(missionId: string | null, missionTitle?: string) {
  if (!missionId) return "세션 외";
  return missionTitle ?? `${missionId.slice(0, 10)}…`;
}

function sessionFilterDate(timestamp: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  });
}

const MemoryClusterGraph = dynamic(
  () => import("@/components/memory/memory-cluster-graph"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-96 items-center justify-center bg-white text-sm text-slate-400">
        Graph view loading...
      </div>
    ),
  },
);

export default function AgentMemoryPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<
    import("firebase/auth").User | null
  >(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [clusters, setClusters] = useState<MemoryCluster[]>([]);
  const [clusterEdges, setClusterEdges] = useState<ClusterGraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingClusters, setIsLoadingClusters] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [clusterVariant, setClusterVariant] =
    useState<ClusterVariant>("full-context");
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    null,
  );
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(
    null,
  );
  const [missionTitleById, setMissionTitleById] = useState<
    Record<string, string>
  >({});
  const [clustersGeneratedAt, setClustersGeneratedAt] = useState<number | null>(
    null,
  );

  const applyClusterData = (clusterData: {
    clusters?: unknown;
    edges?: unknown;
    generatedAt?: unknown;
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
  };

  const loadClusters = (
    user: import("firebase/auth").User,
    variant: ClusterVariant,
  ) =>
    getIdToken(user)
      .then((token) =>
        fetch(`/api/memory/clusters?variant=${variant}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then((r) => (r.ok ? r.json() : null))
      .then(applyClusterData);

  const loadData = (user: import("firebase/auth").User, variant: ClusterVariant) =>
    getIdToken(user).then((token) => {
      const headers = { Authorization: `Bearer ${token}` };
      return Promise.all([
        fetch("/api/memory/all", { headers }).then((r) =>
          r.ok ? r.json() : null,
        ),
        fetch(`/api/memory/clusters?variant=${variant}`, { headers }).then(
          (r) => (r.ok ? r.json() : null),
        ),
      ]).then(([memData, clusterData]) => {
        const mems: MemoryItem[] = Array.isArray(memData?.memories)
          ? memData.memories
          : [];
        setMemories(mems);
        applyClusterData(clusterData);
      });
    });

  const handleSelectClusterVariant = async (variant: ClusterVariant) => {
    if (clusterVariant === variant) return;
    setClusterVariant(variant);
    if (!currentUser) return;
    setIsLoadingClusters(true);
    try {
      await loadClusters(currentUser, variant);
    } catch (err) {
      console.error("[agent] cluster variant load failed", err);
      toast.error("클러스터를 불러오지 못했어요.");
    } finally {
      setIsLoadingClusters(false);
    }
  };

  const handleRegenerate = async () => {
    if (!currentUser || isRegenerating) return;
    setIsRegenerating(true);
    try {
      const token = await getIdToken(currentUser);
      const res = await fetch("/api/memory/clusters", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ variant: clusterVariant }),
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
      setCurrentUser(user);
      setLoading(true);
      loadData(user, clusterVariant)
        .catch((err) => {
          console.error("[agent] load failed", err);
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
  const clusterItems = memories.map((m) => ({
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
    keyword: m.keywords,
    keywords: m.keywords,
    interpretationConfidence: m.interpretationConfidence ?? null,
    row: {
      source: m.source ?? undefined,
    },
  }));

  const clusterItemIdSet = new Set(clusterItems.map((i) => i.id));
  const totalClusterItemIds = clusters.flatMap((c) => c.itemIds);
  const matchedCount = totalClusterItemIds.filter((id) =>
    clusterItemIdSet.has(id),
  ).length;
  const hasStaleCache = totalClusterItemIds.length > 0 && matchedCount === 0;

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
  // (onboarding base + prior missions). "전체"(null) shows all; the no-session
  // bucket stays exact since those memories have no comparable mission.
  const filteredClusterItems = !selectedSessionKey
    ? clusterItems
    : selectedSessionKey === NO_SESSION_KEY
      ? clusterItems.filter((item) => !item.row.source?.missionId)
      : clusterItems.filter((item) =>
          isWithinCumulative(item.row.source?.missionId, selectedSessionKey),
        );

  // Narrow the cluster list (left panel) to clusters that still have at least
  // one item within the selected session, with counts adjusted to match.
  const filteredClusters = useMemo(() => {
    if (!selectedSessionKey) return clusters;
    const idSet = new Set(filteredClusterItems.map((item) => item.id));
    return clusters
      .map((cluster) => {
        const itemIds = cluster.itemIds.filter((id) => idSet.has(id));
        return { ...cluster, itemIds, count: itemIds.length };
      })
      .filter((cluster) => cluster.itemIds.length > 0);
  }, [clusters, filteredClusterItems, selectedSessionKey]);

  // Keep the selected cluster valid whenever the session filter narrows the list.
  useEffect(() => {
    setSelectedClusterId((current) =>
      filteredClusters.length === 0
        ? null
        : current && filteredClusters.some((c) => c.id === current)
          ? current
          : filteredClusters[0].id,
    );
  }, [filteredClusters]);

  const handleSelectSession = (key: string | null) => {
    setSelectedSessionKey(key);
    setSelectedMemoryId(null);
  };

  const selectedCluster =
    filteredClusters.find((c) => c.id === selectedClusterId) ?? null;
  const selectedClusterItems = selectedCluster
    ? filteredClusterItems.filter((item) =>
        selectedCluster.itemIds.includes(item.id),
      )
    : [];

  const clusterVariantControls = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground">
          클러스터링 입력 비교
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          같은 기억을 어떤 텍스트로 임베딩할지 바꿔봅니다.
        </p>
      </div>
      <div className="flex rounded-lg border border-border bg-muted/40 p-1">
        {CLUSTER_VARIANTS.map((variant) => {
          const selected = clusterVariant === variant.value;
          return (
            <button
              key={variant.value}
              type="button"
              onClick={() => handleSelectClusterVariant(variant.value)}
              disabled={isLoadingClusters || isRegenerating}
              className={cn(
                "min-w-32 rounded-md px-3 py-1.5 text-left transition",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="block text-xs font-semibold">
                {variant.label}
              </span>
              <span className="block text-[10px] leading-tight opacity-70">
                {variant.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="flex items-center gap-3 px-6 py-4 lg:px-10">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => router.push("/lobby")}
            className="rounded-full text-muted-foreground"
            aria-label="로비로 돌아가기"
          >
            <ArrowLeftIcon size={18} />
          </Button>

          <p className="text-base font-semibold text-foreground">
            에이전트 기억
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          불러오는 중...
        </div>
      ) : isLoadingClusters ? (
        <div>
          {clusterVariantControls}
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            클러스터를 불러오는 중...
          </div>
        </div>
      ) : clusters.length === 0 ? (
        <div>
          {clusterVariantControls}
          <MemoryClusterEmptyState
            canGenerate={memories.length >= 3}
            isRegenerating={isRegenerating}
            onGenerate={handleRegenerate}
          />
        </div>
      ) : (
        <div className="flex h-[calc(100vh-57px)] flex-col overflow-hidden">
          {clusterVariantControls}
          {sessionFilterOptions.length > 1 ? (
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-4 py-2.5">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                세션<span className="ml-1 normal-case text-[10px] font-normal opacity-70">(이전까지 누적)</span>
              </span>
              <button
                type="button"
                onClick={() => handleSelectSession(null)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs transition",
                  selectedSessionKey === null
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-border bg-white text-muted-foreground hover:bg-muted",
                )}
              >
                전체
                <span className="ml-1.5 opacity-70">{memories.length}</span>
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
                      "shrink-0 rounded-full border px-3 py-1 text-xs transition",
                      selectedSessionKey === option.key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-border bg-white text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {sessionFilterLabel(option.missionId, title)}
                    {date && <span className="ml-1.5 opacity-70">{date}</span>}
                    <span className="ml-1.5 opacity-70">{option.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <MemoryClusterList
              clusters={filteredClusters}
              selectedClusterId={selectedClusterId}
              generatedAt={clustersGeneratedAt}
              hasStaleCache={hasStaleCache}
              isRegenerating={isRegenerating || isLoadingClusters}
              onSelectCluster={(clusterId) => {
                setSelectedClusterId(clusterId);
                setSelectedMemoryId(null);
              }}
              onRegenerate={handleRegenerate}
            />

            <div className="flex min-w-0 flex-1 overflow-hidden">
              <div className="min-w-0 flex-1 overflow-hidden">
                <MemoryClusterGraph
                  clusters={clusters}
                  items={filteredClusterItems}
                  edges={clusterEdges}
                  selectedClusterId={selectedClusterId}
                  selectedMemoryId={selectedMemoryId}
                  onSelectCluster={setSelectedClusterId}
                  onSelectMemory={setSelectedMemoryId}
                  showInlineDetail={false}
                  fill
                />
              </div>
              <MemoryClusterSidePanel
                cluster={selectedCluster}
                items={selectedClusterItems}
                memories={memories}
                selectedMemoryId={selectedMemoryId}
                onSelectMemory={setSelectedMemoryId}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
