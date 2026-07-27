import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSignIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PowerOffIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type {
  ClusterGraphItem,
  MemoryCluster,
  MemoryItem,
} from "./memory-cluster-types";
import {
  hasPreferenceSignal,
  hasPreferenceSignalAction,
  preferenceSignalLabel,
  visibleMemoryActionLabels,
} from "./memory-action-labels";

type MemoryClusterSidePanelProps = {
  cluster: MemoryCluster | null;
  items: ClusterGraphItem[];
  memories: MemoryItem[];
  selectedMemoryId: string | null;
  onSelectMemory: (memoryId: string) => void;
  onDeleteMemory?: (memoryId: string) => void;
  onSetMemoryActive?: (
    memoryId: string,
    active: boolean,
    reason?: string,
  ) => Promise<boolean> | boolean;
  mentionMode?: boolean;
  onMentionCluster?: (cluster: MemoryCluster) => void;
  onMentionMemory?: (item: ClusterGraphItem) => void;
  getMissionLabel?: (missionId: string) => string;
  /**
   * 비활성 그룹의 사유 필터 chip 노출 여부. /agent와 admin 사용자 메모리
   * 페이지 전용(연구 관측) — 세션 리뷰 overlay에서는 켜지 않는다.
   */
  showInactiveReasonFilter?: boolean;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWeight(weight: number | null | undefined) {
  if (weight == null || !Number.isFinite(weight)) return null;
  return `${Math.round(weight * 100)}%`;
}

function sourceLabel(sourceType: string | null | undefined) {
  if (sourceType === "before_session") {
    return "세션 전";
  }
  if (sourceType === "during_session") {
    return "세션 중";
  }
  return "출처 없음";
}

function sourceBadgeClass(sourceType: string | null | undefined) {
  if (sourceType === "before_session") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (sourceType === "during_session") {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function defaultMissionLabel(missionId: string) {
  if (missionId === "onboarding") return "온보딩";
  return `미션 ${missionId.slice(0, 10)}`;
}

function MemoryField({
  label,
  value,
  boxClassName = "border-border bg-background",
}: {
  label: string;
  value: string;
  boxClassName?: string;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${boxClassName}`}>
      <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <p className="wrap-anywhere whitespace-pre-line text-xs leading-relaxed text-foreground">
        {value}
      </p>
    </div>
  );
}

function beforeSessionSourceText(item: ClusterGraphItem) {
  return (item.row.source?.sourceText ?? "").trim();
}

// The genuine user input only - stored input is sometimes prefixed with
// "user input:" or carries action/reference wrappers. Strip those so the card
// headline shows just what the user typed.
function userInputText(item: ClusterGraphItem) {
  const sourceText = beforeSessionSourceText(item);
  if (sourceText) return sourceText;
  const raw = (item.input || "").trim().replace(/^user input:\s*/i, "").trim();
  return raw || item.episodic || item.semantic || item.id;
}

function isFinalDesignSelection(item: ClusterGraphItem) {
  return (
    item.action?.split(" / ").includes("final_design_select") ||
    item.id.startsWith("during-session-") &&
      item.id.includes("final-design-selection-") ||
    item.memoryId.includes("final-design-selection-")
  );
}

function finalDesignHeadline(item: ClusterGraphItem) {
  const firstLine = userInputText(item)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "최종디자인 시안 확정";
  return firstLine
    .replace(/^최종\s+디자인\s+확정\s*:/, "최종디자인 시안 확정:")
    .replace(/\s+[·•]\s+/g, " * ");
}

function memoryHeadlineText(item: ClusterGraphItem) {
  return isFinalDesignSelection(item) ? finalDesignHeadline(item) : userInputText(item);
}

function originalInputText(item: ClusterGraphItem) {
  const raw = (item.input || "").trim().replace(/^user input:\s*/i, "").trim();
  return raw || beforeSessionSourceText(item);
}

function missionIdFor(item: ClusterGraphItem, memory: MemoryItem | null) {
  return (
    item.row.source?.missionId ??
    memory?.source?.missionId ??
    null
  );
}

function isInactiveMemoryItem(
  item: ClusterGraphItem,
  memory: MemoryItem | null,
) {
  if (item.inactive) return true;
  if (memory?.archivedAt || item.archivedAt) return true;
  if ((memory?.weight ?? item.weight) != null && (memory?.weight ?? item.weight)! <= 0) {
    return true;
  }
  return item.action?.split(" / ").includes("archived") ?? false;
}

// 비활성 사유 분류. 카드의 "비활성 이유" 라벨과 비활성 그룹의 사유 필터가 같은
// 판정을 공유하도록 key를 먼저 뽑는다: 사용자 직접 비활성화(user_disabled) >
// 세션 종료 시 auto-duplicate 등 아카이브(archivedAt 기록) > idle decay weight 0.
type InactiveReasonKey = "similar_archived" | "weight_zero" | "user_disabled";

// 필터 chip 순서는 비활성 그룹 설명 문구(유사 메모리 정리, weight 0 도달,
// 사용자 설정)와 맞춘다.
const INACTIVE_REASON_FILTERS: { key: InactiveReasonKey; label: string }[] = [
  { key: "similar_archived", label: "유사 메모리 정리" },
  { key: "weight_zero", label: "weight 0 도달" },
  { key: "user_disabled", label: "사용자 비활성화" },
];

function inactiveReasonKeyFor(
  item: ClusterGraphItem,
  memory: MemoryItem | null,
): InactiveReasonKey {
  if ((memory?.inactiveReason ?? item.inactiveReason) === "user_disabled") {
    return "user_disabled";
  }
  if (
    memory?.archivedAt ||
    item.archivedAt ||
    (item.action?.split(" / ").includes("archived") ?? false)
  ) {
    return "similar_archived";
  }
  return "weight_zero";
}

function inactiveReasonLabel(
  item: ClusterGraphItem,
  memory: MemoryItem | null,
) {
  const key = inactiveReasonKeyFor(item, memory);
  if (key === "user_disabled") {
    const inactiveReasonDetail =
      memory?.inactiveReasonDetail ?? item.inactiveReasonDetail;
    return inactiveReasonDetail
      ? `사용자가 직접 비활성화함 · ${inactiveReasonDetail}`
      : "사용자가 직접 비활성화함";
  }
  if (key === "similar_archived") return "유사 메모리 존재";
  return "weight 0 도달";
}

function clusterGraphItemFromMemory(memory: MemoryItem): ClusterGraphItem {
  return {
    id: memory.id,
    memoryId: memory.id,
    semantic: memory.semantic ?? "",
    episodic: memory.episodic ?? "",
    input: memory.input ?? "",
    output: memory.output ?? "",
    originalInteractionContent: memory.originalInteractionContent ?? "",
    action: memory.action ?? "",
    preferenceSignal: memory.preferenceSignal,
    sourceType: memory.sourceType,
    weight: memory.weight,
    embedding: memory.embedding,
    timestamp: memory.timestamp ?? 0,
    archivedAt: memory.archivedAt,
    archiveReason: memory.archiveReason,
    inactiveReason: memory.inactiveReason,
    inactiveReasonDetail: memory.inactiveReasonDetail,
    keyword: memory.keywords,
    keywords: memory.keywords,
    row: {
      source: memory.source ?? undefined,
    },
  };
}

export function MemoryClusterSidePanel({
  cluster,
  items,
  memories,
  selectedMemoryId,
  onSelectMemory,
  onDeleteMemory,
  onSetMemoryActive,
  mentionMode = false,
  onMentionCluster,
  onMentionMemory,
  getMissionLabel = defaultMissionLabel,
  showInactiveReasonFilter = false,
}: MemoryClusterSidePanelProps) {
  const relatedActionLabels = visibleMemoryActionLabels(
    cluster?.relatedActions.join(" / "),
  );
  const hasRelatedPreferenceSignal = hasPreferenceSignalAction(
    cluster?.relatedActions.join(" / "),
  );
  const selectedMemory =
    selectedMemoryId != null
      ? memories.find((candidate) => candidate.id === selectedMemoryId) ?? null
      : null;
  const selectedFallbackItem = useMemo(
    () =>
      selectedMemory && !items.some((item) => item.id === selectedMemory.id)
        ? clusterGraphItemFromMemory(selectedMemory)
        : null,
    [selectedMemory, items],
  );
  const displayItems = useMemo(
    () => (selectedFallbackItem ? [selectedFallbackItem, ...items] : items),
    [selectedFallbackItem, items],
  );
  const isInactiveGroup = cluster?.id === "session-inactive";
  // 사유 필터는 /agent·admin 관측 화면에서만 켠다 (세션 리뷰 overlay 제외).
  const inactiveReasonFilterEnabled = isInactiveGroup && showInactiveReasonFilter;
  const memoryById = useMemo(
    () => new Map(memories.map((memory) => [memory.id, memory])),
    [memories],
  );
  // 비활성 그룹 전용 사유 필터. 그룹을 벗어나면 초기화한다.
  const [inactiveReasonFilter, setInactiveReasonFilter] =
    useState<InactiveReasonKey | null>(null);
  useEffect(() => {
    setInactiveReasonFilter(null);
  }, [cluster?.id]);
  const inactiveReasonCounts = useMemo(() => {
    const counts: Record<InactiveReasonKey, number> = {
      similar_archived: 0,
      weight_zero: 0,
      user_disabled: 0,
    };
    if (!inactiveReasonFilterEnabled) return counts;
    for (const item of displayItems) {
      const memory = memoryById.get(item.id) ?? null;
      if (!isInactiveMemoryItem(item, memory)) continue;
      counts[inactiveReasonKeyFor(item, memory)] += 1;
    }
    return counts;
  }, [displayItems, inactiveReasonFilterEnabled, memoryById]);
  const visibleItems = useMemo(() => {
    if (!inactiveReasonFilterEnabled || !inactiveReasonFilter) return displayItems;
    return displayItems.filter((item) => {
      const memory = memoryById.get(item.id) ?? null;
      // 활성 fallback 카드(선택된 메모리)는 사유 필터 대상이 아니다.
      if (!isInactiveMemoryItem(item, memory)) return true;
      return inactiveReasonKeyFor(item, memory) === inactiveReasonFilter;
    });
  }, [displayItems, inactiveReasonFilter, inactiveReasonFilterEnabled, memoryById]);
  // 그래프 노드 클릭 등으로 새로 선택된 메모리가 현재 사유 필터에 걸러져
  // 목록에서 안 보이면, 선택이 이긴다 — 필터를 해제해 카드를 노출한다.
  // (chip 클릭은 selectedMemoryId를 바꾸지 않으므로 여기 걸리지 않는다.)
  const prevSelectedMemoryIdRef = useRef(selectedMemoryId);
  useEffect(() => {
    const previous = prevSelectedMemoryIdRef.current;
    prevSelectedMemoryIdRef.current = selectedMemoryId;
    if (!selectedMemoryId || selectedMemoryId === previous) return;
    if (!inactiveReasonFilter) return;
    const selectedItem = displayItems.find(
      (item) => item.id === selectedMemoryId,
    );
    if (!selectedItem) return;
    const memory = memoryById.get(selectedMemoryId) ?? null;
    if (
      isInactiveMemoryItem(selectedItem, memory) &&
      inactiveReasonKeyFor(selectedItem, memory) !== inactiveReasonFilter
    ) {
      setInactiveReasonFilter(null);
    }
  }, [selectedMemoryId, inactiveReasonFilter, displayItems, memoryById]);
  // Original input / Keyword boxes are collapsed by default per memory card.
  const [expandedInputIds, setExpandedInputIds] = useState<Set<string>>(
    new Set(),
  );
  const [deactivationMemoryId, setDeactivationMemoryId] = useState<string | null>(
    null,
  );
  const [deactivationReason, setDeactivationReason] = useState("");
  const [changingMemoryId, setChangingMemoryId] = useState<string | null>(null);
  const toggleInputDetails = (id: string) => {
    setExpandedInputIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const changeMemoryActiveState = async (
    memoryId: string,
    active: boolean,
    reason?: string,
  ) => {
    if (!onSetMemoryActive || changingMemoryId) return false;
    setChangingMemoryId(memoryId);
    try {
      return await onSetMemoryActive(memoryId, active, reason);
    } finally {
      setChangingMemoryId(null);
    }
  };
  const submitDeactivation = async () => {
    const reason = deactivationReason.trim();
    if (!deactivationMemoryId || !reason) return;
    const changed = await changeMemoryActiveState(
      deactivationMemoryId,
      false,
      reason,
    );
    if (!changed) return;
    setDeactivationMemoryId(null);
    setDeactivationReason("");
  };
  // Scroll the detail list to the item selected from the graph/node click.
  // inactiveReasonFilter dep: 선택이 필터를 해제한 다음 렌더에서 카드가 생기므로
  // 그때 한 번 더 스크롤을 시도한다.
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedMemoryId) return;
    selectedItemRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedMemoryId, inactiveReasonFilter]);
  return (
    <aside className="flex w-88 shrink-0 flex-col border-r border-border bg-card xl:w-96">
      <div className="border-b border-border px-5 py-4">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          Detail panel
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
            {cluster?.label ?? (selectedFallbackItem ? "선택된 메모리" : "클러스터를 선택하세요")}
          </h2>
          {cluster || selectedFallbackItem ? (
            <Badge variant="secondary" className="rounded-full">
              {displayItems.length}
            </Badge>
          ) : null}
        </div>
        {cluster ? (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {cluster.summary}
          </p>
        ) : selectedFallbackItem ? (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            이 메모리는 현재 클러스터 cache에 포함되지 않았지만 상세 정보는 확인할 수 있습니다.
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            왼쪽 목록이나 그래프의 점을 선택하면 상세가 여기에 표시됩니다.
          </p>
        )}
        {inactiveReasonFilterEnabled && displayItems.length > 0 ? (
          <div
            className="mt-3 flex flex-wrap gap-1.5"
            role="group"
            aria-label="비활성 사유 필터"
          >
            <button
              type="button"
              onClick={() => setInactiveReasonFilter(null)}
              aria-pressed={inactiveReasonFilter == null}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                inactiveReasonFilter == null
                  ? "border-slate-700 bg-slate-700 text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              전체{" "}
              <span className="tabular-nums">{displayItems.length}</span>
            </button>
            {INACTIVE_REASON_FILTERS.map(({ key, label }) => {
              const count = inactiveReasonCounts[key];
              const active = inactiveReasonFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={count === 0}
                  onClick={() =>
                    setInactiveReasonFilter((current) =>
                      current === key ? null : key,
                    )
                  }
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    active
                      ? "cursor-pointer border-slate-700 bg-slate-700 text-white"
                      : count === 0
                        ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                        : "cursor-pointer border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {label} <span className="tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {cluster && mentionMode ? (
          <button
            type="button"
            onClick={() => onMentionCluster?.(cluster)}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100"
          >
            <AtSignIcon size={12} />
            이 클러스터 멘션
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
        {cluster || displayItems.length > 0 ? (
          <div className="space-y-5">
            {cluster && (relatedActionLabels.length > 0 || hasRelatedPreferenceSignal) ? (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  관련 작업
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {relatedActionLabels.map((label) => (
                    <Badge
                      key={label}
                      variant="warning"
                      className="rounded-full border-amber-200 bg-amber-50"
                    >
                      {label}
                    </Badge>
                  ))}
                  {hasRelatedPreferenceSignal ? (
                    <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50">
                      {preferenceSignalLabel}
                    </Badge>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {cluster ? "Included memory items" : "Selected memory"}
              </p>
              <div className="space-y-2">
                {isInactiveGroup && displayItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                    비활성 메모리가 없습니다.
                  </p>
                ) : null}
                {inactiveReasonFilterEnabled &&
                displayItems.length > 0 &&
                visibleItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                    해당 이유로 비활성화된 메모리가 없습니다.
                  </p>
                ) : null}
                {visibleItems.map((item) => {
                  const selected = item.id === selectedMemoryId;
                  const memory =
                    memories.find((candidate) => candidate.id === item.id) ??
                    null;
                  const inactive = isInactiveMemoryItem(item, memory);
                  const weightLabel = formatWeight(item.weight);
                  const isNewThisSession =
                    item.action?.split(" / ").includes("promoted") ?? false;
                  const missionId = missionIdFor(item, memory);
                  const missionLabel = missionId
                    ? getMissionLabel(missionId)
                    : "미션 출처 없음";
                  const actionLabels = visibleMemoryActionLabels(item.action);
                  const hasPreferenceSignalBadge = hasPreferenceSignal(
                    item.action,
                    memory?.preferenceSignal ?? item.preferenceSignal,
                  );
                  const originalInput = originalInputText(item);
                  return (
                    <div
                      key={item.id}
                      ref={selected ? selectedItemRef : null}
                      className="group relative scroll-mt-2"
                    >
                      {onDeleteMemory ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteMemory(item.id);
                          }}
                          className="absolute right-2 top-2 z-10 hidden cursor-pointer rounded-full p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500 group-hover:flex"
                          aria-label="메모리 삭제"
                        >
                          <Trash2Icon size={12} />
                        </button>
                      ) : null}
                      {selected && onSetMemoryActive ? (
                        inactive ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void changeMemoryActiveState(item.id, true);
                            }}
                            disabled={changingMemoryId === item.id}
                            className="absolute right-2 top-2 z-10 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RotateCcwIcon size={13} aria-hidden="true" />
                            {changingMemoryId === item.id
                              ? "활성화 중..."
                              : "활성화"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeactivationMemoryId(item.id);
                              setDeactivationReason("");
                            }}
                            disabled={changingMemoryId === item.id}
                            className="absolute right-2 top-2 z-10 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-500 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <PowerOffIcon size={13} aria-hidden="true" />
                            비활성화
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          onSelectMemory(item.id);
                          if (mentionMode) onMentionMemory?.(item);
                        }}
                        className={`w-full rounded-lg border px-3 pb-3 text-left text-xs transition ${
                          selected && onSetMemoryActive ? "pt-12" : "pt-3"
                        } ${
                          selected
                            ? mentionMode
                              ? "border-amber-300 bg-amber-50 shadow-sm ring-2 ring-amber-100"
                              : inactive
                                ? "border-slate-200 bg-slate-50/70 shadow-sm ring-2 ring-slate-100"
                                : isNewThisSession
                                  ? "border-indigo-400 bg-indigo-100 shadow-sm ring-2 ring-indigo-200"
                                  : "border-slate-400 bg-slate-100 shadow-sm ring-2 ring-slate-200"
                            : mentionMode
                              ? "cursor-pointer border-amber-100 bg-amber-50/50 hover:border-amber-300 hover:bg-amber-50"
                              : inactive
                                ? "cursor-pointer border-slate-100 bg-slate-50/40 text-slate-400 hover:border-slate-200 hover:bg-slate-50/70"
                                : isNewThisSession
                                  ? "cursor-pointer border-indigo-100 bg-indigo-50/60 hover:border-indigo-300 hover:bg-indigo-50"
                                  : "cursor-pointer border-border bg-background hover:border-slate-300 hover:bg-muted/30"
                        }`}
                      >
                      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {isNewThisSession ? (
                            <span
                              className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700"
                              title="이번 세션에 생성됨"
                            >
                              NEW
                            </span>
                          ) : null}
                          <span className="min-w-0 truncate font-medium text-slate-500">
                            {missionLabel}
                          </span>
                        </span>
                        {item.timestamp ? (
                          <span className="shrink-0 tabular-nums">
                            {formatDate(item.timestamp)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className={`rounded-full ${sourceBadgeClass(item.sourceType)}`}
                        >
                          {sourceLabel(item.sourceType)}
                        </Badge>
                        {actionLabels.map((label) => (
                          <Badge
                            key={label}
                            variant="warning"
                            className="rounded-full border-amber-200 bg-amber-50"
                          >
                            {label}
                          </Badge>
                        ))}
                        {hasPreferenceSignalBadge ? (
                          <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50">
                            {preferenceSignalLabel}
                          </Badge>
                        ) : null}
                        {inactive ? (
                          <Badge
                            variant="secondary"
                            className="rounded-full border-slate-200 bg-slate-50 text-slate-400"
                          >
                            비활성
                          </Badge>
                        ) : null}
                        {item.pendingActivation ? (
                          <Badge
                            variant="secondary"
                            className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
                          >
                            제출 시 반영
                          </Badge>
                        ) : null}
                        {weightLabel ? (
                          <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tabular-nums text-slate-400">
                            weight {weightLabel}
                          </span>
                        ) : null}
                      </div>
                      {inactive ? (
                        <p className="mb-2 text-[11px] leading-snug text-slate-400">
                          비활성 이유: {inactiveReasonLabel(item, memory)}
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <span
                          className={`mt-0.5 w-1 shrink-0 rounded-full ${
                            selected
                              ? isNewThisSession
                                ? "bg-indigo-600"
                                : "bg-slate-700"
                              : isNewThisSession
                                ? "bg-indigo-400"
                                : inactive
                                  ? "bg-slate-200"
                                  : "bg-slate-300"
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p
                                className={`min-w-0 whitespace-pre-line leading-relaxed ${
                                  selected
                                    ? "wrap-anywhere select-text font-semibold text-slate-950"
                                    : inactive
                                      ? "line-clamp-2 text-slate-400"
                                      : "line-clamp-2 text-foreground"
                                }`}
                              >
                                {memoryHeadlineText(item)}
                              </p>
                            </div>
                            {selected ? (
                              <span className="sr-only">
                                {mentionMode ? "멘션 선택됨" : "선택됨"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {selected ? (
                        (() => {
                          // Inner detail boxes follow the card tone: NEW cards
                          // are light indigo, so plain white boxes look off.
                          const detailBoxClass =
                            isNewThisSession && !mentionMode && !inactive
                              ? "border-indigo-200/70 bg-white/70"
                              : "border-border bg-background";
                          const showInputDetails = expandedInputIds.has(
                            item.id,
                          );
                          const hasInputDetails = Boolean(
                            originalInput || item.keywords.length > 0,
                          );
                          return (
                        <div className="mt-3 space-y-3 select-text">
                          {item.semantic ? (
                            <MemoryField
                              label="Semantic"
                              value={item.semantic}
                              boxClassName={detailBoxClass}
                            />
                          ) : null}
                          {item.episodic ? (
                            <MemoryField
                              label="Episodic"
                              value={item.episodic}
                              boxClassName={detailBoxClass}
                            />
                          ) : null}
                          {hasInputDetails ? (
                            // The whole card is a <button>, so the toggle is a
                            // span[role=button] to avoid nested buttons.
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleInputDetails(item.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ")
                                  return;
                                event.preventDefault();
                                event.stopPropagation();
                                toggleInputDetails(item.id);
                              }}
                              className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-slate-400 transition hover:text-slate-600"
                            >
                              {showInputDetails ? (
                                <ChevronUpIcon size={12} aria-hidden="true" />
                              ) : (
                                <ChevronDownIcon size={12} aria-hidden="true" />
                              )}
                              {showInputDetails
                                ? "원문·키워드 접기"
                                : "원문·키워드 보기"}
                            </span>
                          ) : null}
                          {showInputDetails && originalInput ? (
                            <MemoryField
                              label="Original input"
                              value={originalInput}
                              boxClassName={detailBoxClass}
                            />
                          ) : null}
                          {showInputDetails && item.keywords.length > 0 ? (
                            <div
                              className={`rounded-lg border px-3 py-2 ${detailBoxClass}`}
                            >
                              <p className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                                Keyword
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {item.keywords.map((keyword) => (
                                  <Badge
                                    key={keyword}
                                    variant="secondary"
                                    className="rounded-full"
                                  >
                                    {keyword}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                          );
                        })()
                      ) : null}
                    </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
      </div>
      <Dialog
        open={Boolean(deactivationMemoryId)}
        onOpenChange={(open) => {
          if (open || changingMemoryId) return;
          setDeactivationMemoryId(null);
          setDeactivationReason("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>메모리 비활성화</DialogTitle>
            <DialogDescription>
              비활성화 이유를 입력해주세요. 이 메모리는 다시 활성화할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={deactivationReason}
            onChange={(event) => setDeactivationReason(event.target.value)}
            maxLength={1000}
            placeholder="비활성화 이유"
            className="min-h-24 resize-none"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setDeactivationMemoryId(null);
                setDeactivationReason("");
              }}
              disabled={Boolean(changingMemoryId)}
              className="h-9 cursor-pointer rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void submitDeactivation()}
              disabled={!deactivationReason.trim() || Boolean(changingMemoryId)}
              className="h-9 cursor-pointer rounded-md bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {changingMemoryId ? "처리 중..." : "비활성화"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
