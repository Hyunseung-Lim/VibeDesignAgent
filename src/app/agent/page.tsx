"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { ArrowLeftIcon, BrainIcon } from "@phosphor-icons/react";
import MemoryClusterGraph from "@/app/admin/MemoryClusterGraph";

type MemoryItem = {
  id: string;
  episodic: string | null;
  semantic: string | null;
  action: string | null;
  keywords: string[];
  weight: number | null;
  timestamp: number | null;
  archivedAt: number | null;
  archiveReason: string | null;
};

type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
};

const ACTION_LABELS: Record<string, string> = {
  agent_response: "대화",
  note_create: "시안 생성",
  note_update: "시안 수정",
  mockup_generate: "목업 생성",
  mockup_edit: "목업 편집",
  reference_fetch: "레퍼런스 탐색",
  design_spec_create: "디자인 스타일",
  note_delete: "시안 삭제",
  mockup_delete: "목업 삭제",
  reference_cite: "레퍼런스 인용",
  reference_delete: "레퍼런스 삭제",
};

function actionLabel(action: string | null) {
  return ACTION_LABELS[action ?? ""] ?? action ?? "기타";
}

function formatDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ClusterPanelTab = "graph" | "detail";

export default function AgentMemoryPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<import("firebase/auth").User | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [clusters, setClusters] = useState<MemoryCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [clusterPanelTab, setClusterPanelTab] = useState<ClusterPanelTab>("graph");
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
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
      setClustersGeneratedAt(data?.generatedAt ?? null);
    } catch (err) {
      console.error("[agent] regenerate failed", err);
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
    input: "",
    action: m.action ?? "",
    timestamp: m.timestamp ?? 0,
    keyword: m.keywords,
    keywords: m.keywords,
  }));

  const clusterItemIdSet = new Set(clusterItems.map((i) => i.id));
  const totalClusterItemIds = clusters.flatMap((c) => c.itemIds);
  const matchedCount = totalClusterItemIds.filter((id) => clusterItemIdSet.has(id)).length;

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) ?? null;
  const selectedClusterItems = selectedCluster
    ? clusterItems.filter((item) => selectedCluster.itemIds.includes(item.id))
    : [];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-6 py-4 lg:px-10">
          <button
            type="button"
            onClick={() => router.push("/lobby")}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowLeftIcon size={18} />
          </button>
          <BrainIcon size={18} className="text-violet-500" />
          <p className="text-base font-semibold text-slate-900">에이전트 기억</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-slate-400">
          불러오는 중…
        </div>
      ) : (
        clusters.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <BrainIcon size={36} className="text-slate-200" />
            <p className="text-sm font-medium text-slate-400">클러스터가 없어요</p>
            <p className="text-xs text-slate-400">기억을 분석해서 패턴을 묶어드릴게요.</p>
            {memories.length >= 3 && (
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="mt-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                {isRegenerating ? "생성 중…" : "클러스터 생성하기"}
              </button>
            )}
          </div>
        ) : (
          <div className="flex h-[calc(100vh-57px)] overflow-hidden">
            {/* Left: cluster list */}
            <div className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-slate-200 bg-white p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-500">
                  {clusters.length}개 클러스터
                </p>
                <div className="flex items-center gap-2">
                  {clustersGeneratedAt && (
                    <p className="text-[10px] text-slate-300">{formatDate(clustersGeneratedAt)}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={isRegenerating}
                    className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-40"
                  >
                    {isRegenerating ? "생성 중…" : "재생성"}
                  </button>
                </div>
              </div>
              {totalClusterItemIds.length > 0 && matchedCount === 0 && (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700">
                  클러스터 캐시가 현재 기억과 일치하지 않습니다. 관리자 페이지에서 Regenerate를 실행해주세요.
                </p>
              )}
              {clusters.map((cluster) => (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() => setSelectedClusterId(cluster.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selectedClusterId === cluster.id
                      ? "border-slate-300 bg-white shadow-sm"
                      : "border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{cluster.label}</p>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      {cluster.count}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {cluster.summary}
                  </p>
                </button>
              ))}
            </div>

            {/* Right: graph / detail */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Panel tab bar */}
              <div className="flex shrink-0 border-b border-slate-200 bg-white">
                {(["graph", "detail"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setClusterPanelTab(tab)}
                    className={`flex-1 py-3 text-sm font-medium transition ${
                      clusterPanelTab === tab
                        ? "border-b-2 border-slate-900 text-slate-900"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    {tab === "graph" ? "그래프" : "상세"}
                  </button>
                ))}
              </div>

              {clusterPanelTab === "graph" ? (
                <div className="flex-1 overflow-hidden">
                  <MemoryClusterGraph
                    clusters={clusters}
                    items={clusterItems}
                    selectedClusterId={selectedClusterId}
                    onSelectCluster={setSelectedClusterId}
                    fill
                  />
                </div>
              ) : selectedCluster ? (
                <div className="flex-1 overflow-y-auto overscroll-contain p-5">
                  <div className="space-y-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">
                          {selectedCluster.label}
                        </h3>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                          {selectedClusterItems.length} items
                        </span>
                      </div>
                      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
                        {selectedCluster.summary}
                      </p>
                      {selectedCluster.relatedActions.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {selectedCluster.relatedActions.map((action) => (
                            <span
                              key={action}
                              className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                            >
                              {actionLabel(action)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedCluster.representativeItems.length > 0 && (
                      <section>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Representative semantics
                        </p>
                        <div className="space-y-2">
                          {selectedCluster.representativeItems.map(
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
                        {selectedClusterItems.map((item) => {
                          const mem = memories.find((m) => m.id === item.id);
                          return (
                            <div
                              key={item.id}
                              className="rounded-2xl border border-slate-100 bg-white p-4 text-xs shadow-sm"
                            >
                              <p className="wrap-anywhere text-sm leading-relaxed text-slate-800">
                                {item.semantic || item.episodic}
                              </p>
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                                {item.timestamp ? (
                                  <span>
                                    {new Date(item.timestamp).toLocaleString(
                                      "ko-KR",
                                      {
                                        month: "numeric",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )}
                                  </span>
                                ) : null}
                                {item.action ? (
                                  <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                    {actionLabel(item.action)}
                                  </span>
                                ) : null}
                                {item.keyword.slice(0, 3).map((kw) => (
                                  <span
                                    key={kw}
                                    className="rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5"
                                  >
                                    {kw}
                                  </span>
                                ))}
                                {mem?.archivedAt ? (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                                    보관됨
                                  </span>
                                ) : null}
                              </div>
                              {item.episodic && item.semantic && (
                                <p className="mt-3 wrap-anywhere text-slate-500">
                                  {item.episodic}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )
      )}
    </div>
  );
}
