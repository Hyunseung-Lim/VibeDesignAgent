"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { ArrowLeftIcon, BrainIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MemoryClusterEmptyState } from "@/components/memory/memory-cluster-empty-state";
import { MemoryClusterList } from "@/components/memory/memory-cluster-list";
import { MemoryClusterSidePanel } from "@/components/memory/memory-cluster-side-panel";
import type {
  MemoryCluster,
  MemoryItem,
} from "@/components/memory/memory-cluster-types";

const MemoryClusterGraph = dynamic(() => import("@/app/admin/MemoryClusterGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-96 items-center justify-center bg-white text-sm text-slate-400">
      Graph view loading...
    </div>
  ),
});

export default function AgentMemoryPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<import("firebase/auth").User | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [clusters, setClusters] = useState<MemoryCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [clustersGeneratedAt, setClustersGeneratedAt] = useState<number | null>(null);

  const loadData = (user: import("firebase/auth").User) =>
    getIdToken(user).then((token) => {
      const headers = { Authorization: `Bearer ${token}` };
      return Promise.all([
        fetch("/api/memory/all", { headers }).then((r) => r.ok ? r.json() : null),
        fetch("/api/memory/clusters", { headers }).then((r) => r.ok ? r.json() : null),
      ]).then(([memData, clusterData]) => {
        const mems: MemoryItem[] = Array.isArray(memData?.memories) ? memData.memories : [];
        setMemories(mems);
        const cls: MemoryCluster[] = Array.isArray(clusterData?.clusters) ? clusterData.clusters : [];
        setClusters(cls);
        setSelectedClusterId(cls[0]?.id ?? null);
        setSelectedMemoryId(null);
        setClustersGeneratedAt(clusterData?.generatedAt ?? null);
      });
    });

  const handleRegenerate = async () => {
    if (!currentUser || isRegenerating) return;
    setIsRegenerating(true);
    try {
      const token = await getIdToken(currentUser);
      const res = await fetch("/api/memory/clusters", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "생성 실패");
      const cls: MemoryCluster[] = Array.isArray(data?.clusters) ? data.clusters : [];
      setClusters(cls);
      setSelectedClusterId(cls[0]?.id ?? null);
      setSelectedMemoryId(null);
      setClustersGeneratedAt(data?.generatedAt ?? null);
      toast.success("기억 클러스터를 다시 생성했어요.");
    } catch (err) {
      console.error("[agent] regenerate failed", err);
      toast.error(err instanceof Error ? err.message : "클러스터 생성에 실패했어요.");
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
      loadData(user).catch((err) => {
        console.error("[agent] load failed", err);
      }).finally(() => setLoading(false));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MemoryClusterGraph expects ClusterableMemoryItem shape
  const clusterItems = memories.map((m) => ({
    id: m.id,
    memoryId: m.id,
    semantic: m.semantic ?? "",
    episodic: m.episodic ?? "",
    input: m.input ?? "",
    output: m.output ?? "",
    action: m.action ?? "",
    sourceType: m.sourceType,
    weight: m.weight,
    embedding: m.embedding,
    timestamp: m.timestamp ?? 0,
    keyword: m.keywords,
    keywords: m.keywords,
    row: {
      source: m.source ?? undefined,
    },
  }));

  const clusterItemIdSet = new Set(clusterItems.map((i) => i.id));
  const totalClusterItemIds = clusters.flatMap((c) => c.itemIds);
  const matchedCount = totalClusterItemIds.filter((id) => clusterItemIdSet.has(id)).length;
  const hasStaleCache = totalClusterItemIds.length > 0 && matchedCount === 0;

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) ?? null;
  const selectedClusterItems = selectedCluster
    ? clusterItems.filter((item) => selectedCluster.itemIds.includes(item.id))
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
            onClick={() => router.push("/lobby")}
            className="rounded-full text-muted-foreground"
          >
            <ArrowLeftIcon size={18} />
          </Button>
          <BrainIcon size={18} className="text-violet-500" />
          <p className="text-base font-semibold text-foreground">에이전트 기억</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          불러오는 중...
        </div>
      ) : (
        clusters.length === 0 ? (
          <MemoryClusterEmptyState
            canGenerate={memories.length >= 3}
            isRegenerating={isRegenerating}
            onGenerate={handleRegenerate}
          />
        ) : (
          <div className="flex h-[calc(100vh-57px)] overflow-hidden">
            <MemoryClusterList
              clusters={clusters}
              selectedClusterId={selectedClusterId}
              generatedAt={clustersGeneratedAt}
              hasStaleCache={hasStaleCache}
              isRegenerating={isRegenerating}
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
                  items={clusterItems}
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
        )
      )}
    </div>
  );
}
