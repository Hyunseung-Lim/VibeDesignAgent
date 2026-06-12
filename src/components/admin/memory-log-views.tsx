"use client";

// Admin memory log views: retrieval logs, auto-forgetting candidates, and
// archived memories. All three share a list(left) + detail(right) layout.

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export type MemoryRetrievalItem = {
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

export type MemoryRetrievalScoreDelta = {
  memoryId?: string;
  semanticItemId?: string | null;
  weight?: number;
  weightDelta?: number;
};

export type MemoryRetrievalLog = {
  id: string;
  query: string;
  missionId?: string | null;
  queryEmbeddingModel?: string;
  createdAt: number;
  retrieved: MemoryRetrievalItem[];
  scoreDeltas: MemoryRetrievalScoreDelta[];
};

export type MemoryForgettingCandidate = {
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

export function formatScore(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "—";
}

function ListDetailLayout({
  list,
  detail,
}: {
  list: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="grid h-full grid-cols-[minmax(260px,360px)_1fr] overflow-hidden">
      <div className="h-full overflow-y-auto overscroll-contain border-r border-border bg-muted/60 p-3">
        {list}
      </div>
      <div className="h-full overflow-y-auto overscroll-contain p-5">
        {detail}
      </div>
    </div>
  );
}

function ListErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500"
    >
      {message}
    </p>
  );
}

function ListStatusText({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function DetailPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ListItemButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
        selected
          ? "border-border bg-card shadow-sm"
          : "border-transparent bg-card/60 hover:border-border hover:bg-card"
      }`}
    >
      {children}
    </button>
  );
}

interface MemoryRetrievalsViewProps {
  logs: MemoryRetrievalLog[];
  selected: MemoryRetrievalLog | null;
  isLoading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}

export function MemoryRetrievalsView({
  logs,
  selected,
  isLoading,
  error,
  onSelect,
}: MemoryRetrievalsViewProps) {
  return (
    <ListDetailLayout
      list={
        <>
          <ListErrorNotice message={error} />
          {isLoading ? (
            <ListStatusText>Retrieval logs를 불러오는 중입니다.</ListStatusText>
          ) : logs.length === 0 ? (
            <ListStatusText>
              아직 retrieval log가 없습니다. 사용자가 채팅을 보내면 query와
              검색된 memory가 여기에 기록됩니다.
            </ListStatusText>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <ListItemButton
                  key={log.id}
                  selected={selected?.id === log.id}
                  onClick={() => onSelect(log.id)}
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
                        ? new Date(log.createdAt).toLocaleString("ko-KR", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                    {log.missionId && <span>{log.missionId}</span>}
                  </div>
                  <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground">
                    Top memory: {log.retrieved[0]?.semantic || "—"}
                  </p>
                </ListItemButton>
              ))}
            </div>
          )}
        </>
      }
      detail={
        isLoading ? (
          <DetailPlaceholder>
            Retrieval logs를 불러오는 중입니다.
          </DetailPlaceholder>
        ) : !selected ? (
          <DetailPlaceholder>선택된 retrieval log가 없습니다.</DetailPlaceholder>
        ) : (
          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Memory used for this turn
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The user message was embedded, compared with saved semantic
                    memories, and the closest matches were sent to the agent.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="success" className="rounded-full">
                    {selected.retrieved.length} used
                  </Badge>
                  {selected.missionId && (
                    <Badge variant="secondary" className="rounded-full">
                      {selected.missionId}
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
                    {selected.query || "—"}
                  </p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    2. Search
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground">
                    Vector similarity over semantic memory, no LLM ranking.
                  </p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    3. Learning
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground">
                    Used memories are reinforced; nearby unused candidates decay
                    slightly.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>
                  {selected.createdAt
                    ? new Date(selected.createdAt).toLocaleString("ko-KR")
                    : "—"}
                </span>
                {selected.missionId && <span>{selected.missionId}</span>}
                {selected.queryEmbeddingModel && (
                  <span>{selected.queryEmbeddingModel}</span>
                )}
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                retrieved[]
              </p>
              <div className="space-y-3">
                {selected.retrieved.map((item, index) => {
                  const delta = selected.scoreDeltas.find(
                    (candidate) =>
                      candidate.memoryId === item.memoryId &&
                      candidate.semanticItemId === item.semanticItemId,
                  );
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-border bg-card p-4 text-xs shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <Badge className="rounded-full">#{index + 1}</Badge>
                          <Badge variant="success" className="rounded-full">
                            similarity {formatScore(item.similarity)}
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
                          <span>weight {formatScore(item.weight)}</span>
                          <span>retrievedCount {item.retrievedCount}</span>
                          {item.source?.missionId && (
                            <span>source.missionId {item.source.missionId}</span>
                          )}
                        </div>
                      </div>
                      <p className="mt-3 wrap-anywhere text-sm leading-relaxed text-foreground">
                        {item.semantic || "(semantic item not found)"}
                      </p>
                      <details className="mt-3 rounded-xl bg-muted px-3 py-2">
                        <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
                          Fields
                        </summary>
                        <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                          <span>
                            scoreDeltas[].weight {formatScore(delta?.weight)}
                          </span>
                          <span>
                            scoreDeltas[].weightDelta{" "}
                            {formatScore(delta?.weightDelta)}
                          </span>
                        </div>
                        <p className="mt-2 wrap-anywhere text-[11px] text-muted-foreground">
                          memoryId {item.memoryId} · semanticItemId{" "}
                          {item.semanticItemId}
                        </p>
                      </details>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )
      }
    />
  );
}

interface MemoryForgettingViewProps {
  candidates: MemoryForgettingCandidate[];
  selected: MemoryForgettingCandidate | null;
  isLoading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}

export function MemoryForgettingView({
  candidates,
  selected,
  isLoading,
  error,
  onSelect,
}: MemoryForgettingViewProps) {
  return (
    <ListDetailLayout
      list={
        <>
          <ListErrorNotice message={error} />
          {isLoading ? (
            <ListStatusText>
              Forgetting 후보를 자동 archive하는 중입니다.
            </ListStatusText>
          ) : candidates.length === 0 ? (
            <ListStatusText>
              새로 자동 archive된 후보가 없습니다. 전체 archive 기록은 Archived
              탭에서 확인할 수 있습니다.
            </ListStatusText>
          ) : (
            <div className="space-y-2">
              {candidates.map((candidate) => (
                <ListItemButton
                  key={candidate.id}
                  selected={selected?.id === candidate.id}
                  onClick={() => onSelect(candidate.id)}
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
                    <span>weight {formatScore(candidate.weight)}</span>
                    <span>retrievedCount {candidate.retrievedCount}</span>
                    {candidate.archivedAt && (
                      <span>
                        archivedAt{" "}
                        {new Date(candidate.archivedAt).toLocaleString("ko-KR")}
                      </span>
                    )}
                    {candidate.source?.missionId && (
                      <span>{candidate.source.missionId}</span>
                    )}
                  </div>
                </ListItemButton>
              ))}
            </div>
          )}
        </>
      }
      detail={
        isLoading ? (
          <DetailPlaceholder>
            Forgetting 후보를 자동 archive하는 중입니다.
          </DetailPlaceholder>
        ) : !selected ? (
          <DetailPlaceholder>
            새로 자동 archive된 후보가 없습니다.
          </DetailPlaceholder>
        ) : (
          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Auto archived memory
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Forgetting 기준에 걸린 semantic item을 자동 soft
                    archive했습니다.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-transparent bg-rose-50 text-rose-600"
                >
                  {selected.reason}
                </Badge>
                <Badge variant="secondary" className="rounded-full">
                  weight {formatScore(selected.weight)}
                </Badge>
                <Badge variant="secondary" className="rounded-full">
                  retrievedCount {selected.retrievedCount}
                </Badge>
                {selected.archivedAt && (
                  <Badge variant="secondary" className="rounded-full">
                    archivedAt{" "}
                    {new Date(selected.archivedAt).toLocaleString("ko-KR")}
                  </Badge>
                )}
              </div>
              <p className="rounded-xl bg-muted px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                {selected.reasonLabel}
              </p>
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Semantic
              </p>
              <p className="wrap-anywhere rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground shadow-sm">
                {selected.semantic}
              </p>
              {selected.keywords && selected.keywords.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {selected.keywords.map((keyword) => (
                    <Badge
                      key={keyword}
                      variant="secondary"
                      className="rounded-full"
                    >
                      {keyword}
                    </Badge>
                  ))}
                </div>
              )}
            </section>

            {selected.duplicate && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Similar semantic kept
                </p>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs">
                  <div className="mb-2 flex flex-wrap gap-2 text-[11px] font-semibold text-emerald-700">
                    <span>Match {formatScore(selected.duplicate.similarity)}</span>
                    <span>
                      {selected.duplicate.memoryId}:
                      {selected.duplicate.semanticItemId}
                    </span>
                  </div>
                  <p className="wrap-anywhere leading-relaxed text-emerald-900">
                    {selected.duplicate.semantic}
                  </p>
                </div>
              </section>
            )}

            <details className="rounded-xl bg-muted px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">
                Technical details
              </summary>
              <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                <span>archiveReason {selected.archiveReason ?? "—"}</span>
                <span>
                  last retrieved{" "}
                  {selected.lastRetrievedAt
                    ? new Date(selected.lastRetrievedAt).toLocaleDateString(
                        "ko-KR",
                      )
                    : "—"}
                </span>
              </div>
              <p className="mt-2 wrap-anywhere text-[11px] text-muted-foreground">
                {selected.memoryId}:{selected.semanticItemId}
              </p>
            </details>
          </div>
        )
      }
    />
  );
}

interface MemoryArchivedViewProps {
  items: MemoryForgettingCandidate[];
  selected: MemoryForgettingCandidate | null;
  isLoading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}

export function MemoryArchivedView({
  items,
  selected,
  isLoading,
  error,
  onSelect,
}: MemoryArchivedViewProps) {
  return (
    <ListDetailLayout
      list={
        <>
          <ListErrorNotice message={error} />
          {isLoading ? (
            <ListStatusText>Archived memory를 불러오는 중입니다.</ListStatusText>
          ) : items.length === 0 ? (
            <ListStatusText>
              archivedAt이 기록된 semantic item이 없습니다.
            </ListStatusText>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <ListItemButton
                  key={item.id}
                  selected={selected?.id === item.id}
                  onClick={() => onSelect(item.id)}
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
                        ? new Date(item.archivedAt).toLocaleString("ko-KR")
                        : "—"}
                    </span>
                    <span>weight {formatScore(item.weight)}</span>
                    {item.duplicate && (
                      <span>
                        similarTo {formatScore(item.duplicate.similarity)}
                      </span>
                    )}
                  </div>
                </ListItemButton>
              ))}
            </div>
          )}
        </>
      }
      detail={
        isLoading ? (
          <DetailPlaceholder>
            Archived memory를 불러오는 중입니다.
          </DetailPlaceholder>
        ) : !selected ? (
          <DetailPlaceholder>선택된 archived memory가 없습니다.</DetailPlaceholder>
        ) : (
          <div className="space-y-5">
            <section className="space-y-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Archived memory
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  archivedAt이 있는 semantic item입니다. Retrieval 대상에서는
                  제외됩니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-full">
                  archiveReason {selected.archiveReason ?? "—"}
                </Badge>
                <Badge variant="secondary" className="rounded-full">
                  archivedAt{" "}
                  {selected.archivedAt
                    ? new Date(selected.archivedAt).toLocaleString("ko-KR")
                    : "—"}
                </Badge>
                <Badge variant="secondary" className="rounded-full">
                  weight {formatScore(selected.weight)}
                </Badge>
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Semantic
              </p>
              <p className="wrap-anywhere rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground shadow-sm">
                {selected.semantic}
              </p>
            </section>

            {selected.duplicate && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Similar memory kept
                </p>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs">
                  <div className="mb-2 flex flex-wrap gap-2 text-[11px] font-semibold text-emerald-700">
                    <span>Match {formatScore(selected.duplicate.similarity)}</span>
                    <span>
                      {selected.duplicate.memoryId}:
                      {selected.duplicate.semanticItemId}
                    </span>
                  </div>
                  {selected.duplicate.semantic && (
                    <p className="wrap-anywhere leading-relaxed text-emerald-900">
                      {selected.duplicate.semantic}
                    </p>
                  )}
                  {selected.duplicate.episodic && (
                    <p className="mt-2 wrap-anywhere leading-relaxed text-emerald-800/80">
                      {selected.duplicate.episodic}
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
                <span>retrievedCount {selected.retrievedCount}</span>
                <span>duplicateOf {selected.duplicateOf ?? "—"}</span>
              </div>
              <p className="mt-2 wrap-anywhere text-[11px] text-muted-foreground">
                memoryId {selected.memoryId} · semanticItemId{" "}
                {selected.semanticItemId}
              </p>
            </details>
          </div>
        )
      }
    />
  );
}
