"use client";

import { useState } from "react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MemoryCluster } from "./memory-cluster-types";
import { memoryClusterColor } from "./memory-cluster-colors";

const COLLAPSE_STORAGE_KEY = "memoryClusterList:review:collapsed";

function formatDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return null;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return null;
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function colorAlpha(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : hex;
}

type MemoryClusterListProps = {
  clusters: MemoryCluster[];
  selectedClusterId: string | null;
  generatedAt: number | null;
  hasStaleCache: boolean;
  isRegenerating: boolean;
  onSelectCluster: (id: string) => void;
  onRegenerate?: () => void;
  mentionMode?: boolean;
  onMentionCluster?: (cluster: MemoryCluster) => void;
  presentation?: "default" | "review";
  nodeCount?: number;
  edgeCount?: number;
  // Per-cluster count of nodes newly added in this session. Rendered as "+n"
  // next to the cluster; omitted when 0/undefined.
  addedCountByClusterId?: Record<string, number>;
};

export function MemoryClusterList({
  clusters,
  selectedClusterId,
  generatedAt,
  hasStaleCache,
  isRegenerating,
  onSelectCluster,
  onRegenerate,
  mentionMode = false,
  onMentionCluster,
  presentation = "default",
  nodeCount,
  edgeCount,
  addedCountByClusterId,
}: MemoryClusterListProps) {
  const reviewPresentation = presentation === "review";
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== "undefined" &&
    window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1",
  );

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  // Collapsed rail — keeps cluster navigation reachable without taking width.
  if (reviewPresentation && collapsed) {
    return (
      <aside className="flex min-h-0 w-12 shrink-0 flex-col items-center gap-2 overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar py-3 text-sidebar-foreground">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          className="size-8 shrink-0 cursor-pointer rounded-lg text-muted-foreground"
          aria-label="클러스터 목록 펼치기"
          title="클러스터 목록 펼치기"
        >
          <PanelLeftOpenIcon size={16} />
        </Button>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto py-1">
          {clusters.map((cluster, index) => {
            const selected = selectedClusterId === cluster.id;
            const color = memoryClusterColor(index);
            return (
              <button
                key={cluster.id}
                type="button"
                onClick={() => {
                  onSelectCluster(cluster.id);
                  if (mentionMode) onMentionCluster?.(cluster);
                }}
                title={`${cluster.label} (${cluster.count})`}
                className={cn(
                  "flex size-8 cursor-pointer items-center justify-center rounded-lg border text-xs font-bold text-white transition",
                  selected
                    ? "border-white/80 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.45)]"
                    : "border-transparent opacity-80 hover:opacity-100",
                )}
                style={{ backgroundColor: color }}
              >
                {cluster.count}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`flex min-h-0 shrink-0 flex-col gap-2 overflow-hidden p-3 ${
        reviewPresentation
          ? "w-64 rounded-2xl border border-sidebar-border bg-sidebar text-sidebar-foreground xl:w-72"
          : "w-44 border-r border-border bg-card xl:w-48"
      }`}
    >
      <div className="mb-1 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground">
              {clusters.length}개 클러스터
            </p>
            {nodeCount != null || edgeCount != null ? (
              <p className="mt-0.5 text-[10px] font-medium text-muted-foreground/60">
                {nodeCount ?? 0} nodes · {edgeCount ?? 0} edges
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {generatedAt ? (
              <p className="text-[10px] text-muted-foreground/70">
                {formatDate(generatedAt)}
              </p>
            ) : null}
            {reviewPresentation ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                className="size-6 shrink-0 cursor-pointer rounded-md text-muted-foreground"
                aria-label="클러스터 목록 접기"
                title="클러스터 목록 접기"
              >
                <PanelLeftCloseIcon size={14} />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground/60">
            클러스터 목록
          </span>
          {onRegenerate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              disabled={isRegenerating}
              className="h-7 cursor-pointer rounded-full px-2.5 text-[11px] disabled:cursor-not-allowed"
            >
              {isRegenerating ? "생성 중..." : "재생성"}
            </Button>
          )}
        </div>
      </div>
      {hasStaleCache ? (
        <p className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700">
          클러스터 캐시가 현재 기억과 일치하지 않습니다. 재생성을 실행해주세요.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {clusters.map((cluster, index) => {
          const selected = selectedClusterId === cluster.id;
          const color = memoryClusterColor(index);
          const addedCount = addedCountByClusterId?.[cluster.id] ?? 0;
          if (reviewPresentation) {
            return (
              <button
                key={cluster.id}
                type="button"
                onClick={() => {
                  onSelectCluster(cluster.id);
                  if (mentionMode) onMentionCluster?.(cluster);
                }}
                className={cn(
                  "relative flex min-h-[3.25rem] w-full cursor-pointer overflow-hidden rounded-lg border bg-background text-left transition hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-sidebar-ring focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 focus-visible:outline-none",
                  selected
                    ? mentionMode
                      ? "border-amber-300 bg-amber-50"
                      : "shadow-sm"
                    : mentionMode
                      ? "border-amber-100 hover:border-amber-300"
                      : "border-sidebar-border",
                )}
                style={
                  selected && !mentionMode
                    ? {
                        borderColor: colorAlpha(color, 0.42),
                        backgroundColor: colorAlpha(color, 0.06),
                      }
                    : undefined
                }
              >
                <span
                  className={cn(
                    "flex w-10 shrink-0 items-center justify-center text-[13px] font-bold text-white",
                    selected && !mentionMode ? "" : "opacity-80",
                  )}
                  style={{ backgroundColor: color }}
                >
                  {cluster.count}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
                  <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-[18px]">
                    {cluster.label}
                  </span>
                  {addedCount > 0 ? (
                    <span
                      className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700"
                      title={`이번 세션에 ${addedCount}개 노드 추가됨`}
                    >
                      +{addedCount}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          }
          return (
            <button
              key={cluster.id}
              type="button"
              onClick={() => {
                onSelectCluster(cluster.id);
                if (mentionMode) onMentionCluster?.(cluster);
              }}
              className={`w-full cursor-pointer rounded-md border px-2.5 py-2.5 text-left transition ${
                selected
                  ? mentionMode
                    ? "border-amber-300 bg-amber-50 shadow-sm ring-2 ring-amber-100"
                    : "border-slate-300 bg-slate-100 shadow-sm"
                  : mentionMode
                    ? "border-amber-100 bg-amber-50/60 hover:border-amber-300 hover:bg-amber-50"
                    : "border-transparent bg-muted/40 hover:border-border hover:bg-background"
              }`}
            >
              <div className="space-y-1">
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold leading-5 text-foreground">
                    {cluster.label}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="ml-4 rounded-full px-2 py-0 text-[10px]"
                >
                  {mentionMode ? "멘션 선택" : cluster.count}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
