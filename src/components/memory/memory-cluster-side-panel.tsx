import { useEffect, useRef } from "react";
import { AtSignIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  mentionMode?: boolean;
  onMentionCluster?: (cluster: MemoryCluster) => void;
  onMentionMemory?: (item: ClusterGraphItem) => void;
  getMissionLabel?: (missionId: string) => string;
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
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
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
  if (memory?.archivedAt || item.archivedAt) return true;
  if ((memory?.weight ?? item.weight) != null && (memory?.weight ?? item.weight)! <= 0) {
    return true;
  }
  return item.action?.split(" / ").includes("archived") ?? false;
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
  mentionMode = false,
  onMentionCluster,
  onMentionMemory,
  getMissionLabel = defaultMissionLabel,
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
  const selectedFallbackItem =
    selectedMemory && !items.some((item) => item.id === selectedMemory.id)
      ? clusterGraphItemFromMemory(selectedMemory)
      : null;
  const displayItems = selectedFallbackItem
    ? [selectedFallbackItem, ...items]
    : items;
  // Scroll the detail list to the item selected from the graph/node click.
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedMemoryId) return;
    selectedItemRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedMemoryId]);
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
                {displayItems.map((item) => {
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
                      <button
                        type="button"
                        onClick={() => {
                          onSelectMemory(item.id);
                          if (mentionMode) onMentionMemory?.(item);
                        }}
                        className={`w-full rounded-lg border p-3 text-left text-xs transition ${
                          selected
                            ? mentionMode
                              ? "border-amber-300 bg-amber-50 shadow-sm ring-2 ring-amber-100"
                              : inactive
                                ? "border-slate-200 bg-slate-50/70 shadow-sm ring-2 ring-slate-100"
                                : "border-slate-400 bg-slate-100 shadow-sm ring-2 ring-slate-200"
                            : mentionMode
                              ? "cursor-pointer border-amber-100 bg-amber-50/50 hover:border-amber-300 hover:bg-amber-50"
                              : inactive
                                ? "cursor-pointer border-slate-100 bg-slate-50/40 text-slate-400 hover:border-slate-200 hover:bg-slate-50/70"
                                : "cursor-pointer border-border bg-background hover:border-slate-300 hover:bg-muted/30"
                        }`}
                      >
                      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {isNewThisSession ? (
                            <span
                              className="size-2 shrink-0 rounded-full bg-green-500"
                              title="이번 세션에 생성됨"
                              aria-hidden="true"
                            />
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
                        {memory?.archivedAt || item.archivedAt ? (
                          <Badge
                            variant="secondary"
                            className="rounded-full border-slate-200 bg-slate-50 text-slate-400"
                          >
                            삭제됨
                          </Badge>
                        ) : null}
                        {!(memory?.archivedAt || item.archivedAt) &&
                        (memory?.weight ?? item.weight) != null &&
                        (memory?.weight ?? item.weight)! <= 0 ? (
                          <Badge
                            variant="secondary"
                            className="rounded-full border-slate-200 bg-slate-50 text-slate-400"
                          >
                            비활성
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <span
                          className={`mt-0.5 w-1 shrink-0 rounded-full ${
                            selected
                              ? "bg-slate-700"
                              : isNewThisSession
                                ? "bg-slate-900"
                                : "bg-transparent"
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
                        <div className="mt-3 space-y-3 select-text">
                          {item.semantic ? (
                            <MemoryField label="Semantic" value={item.semantic} />
                          ) : null}
                          {item.episodic ? (
                            <MemoryField label="Episodic" value={item.episodic} />
                          ) : null}
                          {originalInput ? (
                            <MemoryField
                              label="Original input"
                              value={originalInput}
                            />
                          ) : null}
                          {item.keywords.length > 0 ? (
                            <div className="rounded-lg border border-border bg-background px-3 py-2">
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
                          {weightLabel ? (
                            <div className="rounded-lg border border-border bg-background px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                  Weight
                                </p>
                                <p className="text-[10px] font-semibold tabular-nums text-slate-600">
                                  {weightLabel}
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>
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
    </aside>
  );
}
