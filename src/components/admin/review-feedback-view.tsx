"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { isAdminEmail } from "@/lib/admin";
import {
  PART1_QUESTIONS,
  REVIEW_QUESTIONS,
  reasonKey,
} from "@/components/memory/memory-review-panel";

export type AdminReviewFeedbackRow = {
  uid: string;
  displayName: string | null;
  email: string | null;
  missionId: string;
  answers: Record<string, { text?: string; mentions?: unknown[] } | undefined>;
  memoryActivations?: {
    states?: Record<string, unknown>;
    events?: unknown[];
  } | null;
  // 변경된 메모리 id -> 본문 요약 (episodic 우선). 9번 문항 표시용.
  memorySummaries?: Record<string, string> | null;
  submittedAt: number | null;
  updatedAt: number | null;
};

type MemoryActivationEntry = {
  memoryId: string;
  active: boolean;
  reason: string | null;
  toggledAt: number | null;
};

function activationEntry(
  memoryId: string,
  value: unknown,
): MemoryActivationEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { active?: unknown; reason?: unknown; toggledAt?: unknown };
  if (typeof raw.active !== "boolean") return null;
  return {
    memoryId,
    active: raw.active,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason : null,
    toggledAt: typeof raw.toggledAt === "number" ? raw.toggledAt : null,
  };
}

// 메모리별 최종 토글 상태 (제출 시 실제 적용되는 것).
function activationStates(row: AdminReviewFeedbackRow) {
  return Object.entries(row.memoryActivations?.states ?? {})
    .flatMap(([memoryId, value]) => activationEntry(memoryId, value) ?? [])
    .sort((a, b) => (a.toggledAt ?? 0) - (b.toggledAt ?? 0));
}

// undo까지 포함한 토글 이력 전체 (시간순).
function activationEvents(row: AdminReviewFeedbackRow) {
  return (row.memoryActivations?.events ?? [])
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const raw = value as { memoryId?: unknown };
      return typeof raw.memoryId === "string"
        ? (activationEntry(raw.memoryId, value) ?? [])
        : [];
    })
    .sort((a, b) => (a.toggledAt ?? 0) - (b.toggledAt ?? 0));
}

type QuestionRow = {
  key: string;
  label: string;
  kind: "rating" | "text" | "reason";
  number?: number;
};

// Rating keys surfaced as compact badges on the card header.
const HEADER_RATINGS: { key: string; label: string }[] = [
  { key: "session_understanding", label: "이해" },
  { key: "design_preference_understanding", label: "취향" },
  { key: "memory_helpfulness", label: "도움" },
  { key: "overall_memory_accuracy", label: "정확" },
];

// Part 1 (intro) + Part 2 in the order participants answered them. Reason
// fields render indented under their rating question without a number.
function buildQuestionRows(): QuestionRow[] {
  const rows: QuestionRow[] = [];
  let number = 1;
  for (const question of PART1_QUESTIONS) {
    rows.push({
      key: question.key,
      label: question.label,
      kind: question.rating ? "rating" : "text",
      number: number++,
    });
  }
  for (const question of REVIEW_QUESTIONS) {
    rows.push({
      key: question.id,
      label: question.label,
      kind: question.type === "rating" ? "rating" : "text",
      number: number++,
    });
    if (question.type === "rating") {
      rows.push({ key: reasonKey(question.id), label: "이유", kind: "reason" });
    }
  }
  return rows;
}

function answerText(row: AdminReviewFeedbackRow, key: string) {
  return row.answers[key]?.text ?? "";
}

// 카드에서 한눈에 보여줄 주관식(자유입력 + rating 이유) 문항. 번호는 모달의
// 문항 번호와 일치하도록 rating 문항도 세면서 매긴다.
function buildCardTextRows(): QuestionRow[] {
  const rows: QuestionRow[] = [];
  let number = 1;
  for (const question of PART1_QUESTIONS) {
    const questionNumber = number++;
    if (!question.rating) {
      rows.push({
        key: question.key,
        label: question.label,
        kind: "text",
        number: questionNumber,
      });
    }
  }
  for (const question of REVIEW_QUESTIONS) {
    const questionNumber = number++;
    if (question.type === "rating") {
      rows.push({
        key: reasonKey(question.id),
        label: `${question.label} — 이유`,
        kind: "reason",
        number: questionNumber,
      });
    } else {
      rows.push({
        key: question.id,
        label: question.label,
        kind: "text",
        number: questionNumber,
      });
    }
  }
  return rows;
}

// 답변별 보기 문항 목록: 1~11 번호를 매기고 rating 문항은 이유 key를 붙인다.
type QuestionViewRow = QuestionRow & { reasonAnswerKey?: string };

function buildQuestionViewRows(): QuestionViewRow[] {
  const rows: QuestionViewRow[] = [];
  let number = 1;
  for (const question of PART1_QUESTIONS) {
    rows.push({
      key: question.key,
      label: question.label,
      kind: question.rating ? "rating" : "text",
      number: number++,
    });
  }
  for (const question of REVIEW_QUESTIONS) {
    rows.push({
      key: question.id,
      label: question.label,
      kind: question.type === "rating" ? "rating" : "text",
      number: number++,
      reasonAnswerKey:
        question.type === "rating" ? reasonKey(question.id) : undefined,
    });
  }
  return rows;
}

// 참가자의 리뷰를 세션 진행 순서(제출/저장 시각 오름차순)로 정렬한다.
function sortRowsBySessionOrder(rows: AdminReviewFeedbackRow[]) {
  return [...rows].sort(
    (a, b) =>
      (a.submittedAt ?? a.updatedAt ?? 0) - (b.submittedAt ?? b.updatedAt ?? 0),
  );
}

function sessionHref(row: AdminReviewFeedbackRow) {
  return `/main/${encodeURIComponent(row.missionId)}?viewAs=${encodeURIComponent(row.uid)}`;
}

function participantLabel(row: AdminReviewFeedbackRow) {
  return row.displayName ?? row.email ?? row.uid;
}

function formatDateTime(value: number | null) {
  if (!value) return null;
  return new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionLink({
  row,
  onClick,
}: {
  row: AdminReviewFeedbackRow;
  onClick?: (event: React.MouseEvent) => void;
}) {
  return (
    <Link
      href={sessionHref(row)}
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
    >
      세션 보기
      <ArrowUpRightIcon size={12} />
    </Link>
  );
}

function AnswerValue({ kind, text }: { kind: QuestionRow["kind"]; text: string }) {
  if (!text.trim()) {
    return <span className="text-muted-foreground/60">미응답</span>;
  }
  if (kind === "rating") {
    return (
      <span className="inline-flex items-baseline gap-1 font-semibold text-foreground">
        {text}
        <span className="text-[10px] font-normal text-muted-foreground">/ 7</span>
      </span>
    );
  }
  return <span className="whitespace-pre-wrap text-foreground">{text}</span>;
}

// 9번(메모리 체크) 표시: "확인 완료" 텍스트 대신, 실제로 어떤 메모리가
// 활성/비활성됐고 참가자가 적은 사유가 무엇인지 보여준다. 카드가 button으로
// 감싸이는 곳에서도 쓰므로 span 기반 마크업만 사용한다.
function ActivationChanges({ row }: { row: AdminReviewFeedbackRow }) {
  const states = activationStates(row);
  if (states.length === 0) return null;
  return (
    <span className="grid gap-1.5">
      {states.map((entry) => (
        <span
          key={entry.memoryId}
          className="block rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
        >
          <span className="flex items-start gap-1.5">
            <Badge
              variant="secondary"
              className={cn(
                "mt-px shrink-0 rounded-full",
                entry.active
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-rose-200 bg-rose-50 text-rose-700",
              )}
            >
              {entry.active ? "재활성화" : "비활성화"}
            </Badge>
            <span className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90">
              {row.memorySummaries?.[entry.memoryId] ?? entry.memoryId}
            </span>
          </span>
          {entry.reason ? (
            <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
              사유: {entry.reason}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

// Likert(1~7) 답변을 세션 순서대로 보여주는 10칸 미니 그래프. 참가자당
// 최대 10세션(온보딩 + 미션 9)이므로 칸은 항상 10개를 그리고, 아직 진행하지
// 않은 세션 칸은 비워 둔다.
const RATING_GRAPH_SLOTS = 10;

function RatingSessionGraph({
  rows,
  answerKey,
  missionTitle,
}: {
  rows: AdminReviewFeedbackRow[];
  answerKey: string;
  missionTitle: (missionId: string) => string;
}) {
  const slotCount = Math.max(RATING_GRAPH_SLOTS, rows.length);
  return (
    <div className="flex items-end gap-1">
      {Array.from({ length: slotCount }, (_, index) => {
        const row = rows[index] ?? null;
        const raw = row ? answerText(row, answerKey).trim() : "";
        const score = raw ? Number(raw) : null;
        const valid =
          score != null && Number.isFinite(score) && score >= 1 && score <= 7;
        return (
          <div
            key={row ? `${row.uid}:${row.missionId}` : `empty-${index}`}
            title={
              row
                ? `${index + 1}. ${missionTitle(row.missionId)} · ${valid ? `${score} / 7` : "미응답"}`
                : `${index + 1}번째 세션 (미진행)`
            }
            className="flex w-8 flex-col items-center gap-0.5"
          >
            <span
              className={cn(
                "text-[10px] font-semibold tabular-nums",
                valid ? "text-foreground" : "text-muted-foreground/40",
              )}
            >
              {valid ? score : row ? "–" : "·"}
            </span>
            <div
              className={cn(
                "flex h-12 w-full items-end overflow-hidden rounded-md",
                row
                  ? "border border-border bg-muted/40"
                  : "border border-dashed border-border/70 bg-transparent",
              )}
            >
              {valid ? (
                <div
                  className="w-full rounded-t-[3px] bg-slate-700"
                  style={{ height: `${(score / 7) * 100}%` }}
                />
              ) : null}
            </div>
            <span className="text-[9px] tabular-nums text-muted-foreground/60">
              {index + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 전체 참가자 보기의 Likert 문항: 참가자별 그래프를 나열하지 않고 세션
// 순번별 전체 평균 그래프 하나만 보여준다 (15.341). 슬롯 구성과 시각 언어는
// RatingSessionGraph와 동일하고, 값 라벨만 평균(소수 1자리)이다.
function AverageRatingSessionGraph({
  userGroups,
  answerKey,
}: {
  userGroups: AdminReviewFeedbackRow[][];
  answerKey: string;
}) {
  const slotCount = Math.max(
    RATING_GRAPH_SLOTS,
    ...userGroups.map((group) => group.length),
    0,
  );
  const slots = Array.from({ length: slotCount }, (_, index) => {
    const scores = userGroups.flatMap((group) => {
      const row = group[index];
      if (!row) return [];
      const score = Number(answerText(row, answerKey).trim());
      return Number.isFinite(score) && score >= 1 && score <= 7 ? [score] : [];
    });
    const average =
      scores.length > 0
        ? scores.reduce((sum, value) => sum + value, 0) / scores.length
        : null;
    return { average, count: scores.length };
  });
  const answeredSlots = slots.filter((slot) => slot.average != null);
  const totalCount = answeredSlots.reduce((sum, slot) => sum + slot.count, 0);
  const overallAverage =
    totalCount > 0
      ? answeredSlots.reduce(
          (sum, slot) => sum + (slot.average ?? 0) * slot.count,
          0,
        ) / totalCount
      : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-1">
        {slots.map((slot, index) => (
          <div
            key={index}
            title={
              slot.average != null
                ? `${index + 1}번째 세션 · 평균 ${slot.average.toFixed(1)} / 7 · 응답 ${slot.count}명`
                : `${index + 1}번째 세션 · 응답 없음`
            }
            className="flex w-8 flex-col items-center gap-0.5"
          >
            <span
              className={cn(
                "text-[10px] font-semibold tabular-nums",
                slot.average != null
                  ? "text-foreground"
                  : "text-muted-foreground/40",
              )}
            >
              {slot.average != null ? slot.average.toFixed(1) : "·"}
            </span>
            <div
              className={cn(
                "flex h-12 w-full items-end overflow-hidden rounded-md",
                slot.average != null
                  ? "border border-border bg-muted/40"
                  : "border border-dashed border-border/70 bg-transparent",
              )}
            >
              {slot.average != null ? (
                <div
                  className="w-full rounded-t-[3px] bg-slate-700"
                  style={{ height: `${(slot.average / 7) * 100}%` }}
                />
              ) : null}
            </div>
            <span className="text-[9px] tabular-nums text-muted-foreground/60">
              {index + 1}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        전체 참가자 평균 · 세션 순번별
        {overallAverage != null
          ? ` · 전체 평균 ${overallAverage.toFixed(1)} / 7 · 응답 ${totalCount}건`
          : ""}
      </p>
    </div>
  );
}

// 답변별 보기의 세션 순번 칩. 미션명을 · 구분자에서 줄바꿈하고, 고정 폭
// 컬럼에서 오른쪽 끝을 맞춰 답변 시작 위치가 세로로 정렬되게 한다.
function SessionOrderChip({ index, title }: { index: number; title: string }) {
  const parts = title
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <span className="flex w-44 shrink-0 justify-end">
      <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-right text-[10px] font-medium leading-snug text-muted-foreground">
        <span className="tabular-nums">{index + 1}.</span>{" "}
        {parts[0] ?? title}
        {parts.slice(1).map((part) => (
          <span key={part} className="block">
            {part}
          </span>
        ))}
      </span>
    </span>
  );
}

function HeaderRatingBadges({ row }: { row: AdminReviewFeedbackRow }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {HEADER_RATINGS.map(({ key, label }) => {
        const value = answerText(row, key).trim();
        return (
          <span
            key={key}
            className={cn(
              "inline-flex items-baseline gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px]",
              value ? "text-foreground" : "text-muted-foreground/50",
            )}
          >
            {label}
            <span className="font-semibold">{value || "–"}</span>
          </span>
        );
      })}
    </div>
  );
}

function ReviewFeedbackDetail({
  row,
  missionTitle,
  questionRows,
  onClose,
}: {
  row: AdminReviewFeedbackRow;
  missionTitle: (missionId: string) => string;
  questionRows: QuestionRow[];
  onClose: () => void;
}) {
  const knownKeys = new Set(questionRows.map((question) => question.key));
  const extraKeys = Object.keys(row.answers).filter(
    (key) => !knownKeys.has(key) && answerText(row, key).trim(),
  );
  const states = activationStates(row);
  const events = activationEvents(row);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4 text-left">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">
                {missionTitle(row.missionId)}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {participantLabel(row)}
                {row.updatedAt ? ` · ${formatDateTime(row.updatedAt)}` : ""}
                {row.submittedAt ? " · 제출됨" : " · 임시저장"}
              </p>
            </div>
            <SessionLink row={row} />
          </div>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
          {questionRows.map((question) => (
            <div
              key={question.key}
              className={cn(
                "grid gap-1 text-sm",
                question.kind === "reason" && "pl-5",
              )}
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                {question.number != null ? `${question.number}. ` : ""}
                {question.label}
              </p>
              <AnswerValue kind={question.kind} text={answerText(row, question.key)} />
            </div>
          ))}
          {extraKeys.map((key) => (
            <div key={key} className="grid gap-1 text-sm">
              <p className="text-xs leading-relaxed text-muted-foreground">{key}</p>
              <AnswerValue kind="text" text={answerText(row, key)} />
            </div>
          ))}
          {states.length > 0 || events.length > 0 ? (
            <div className="grid gap-2 border-t border-border pt-4 text-sm">
              <p className="text-xs font-semibold text-muted-foreground">
                메모리 활성/비활성 변경
                <span className="ml-1 font-normal">
                  {row.submittedAt ? "· 제출 시 적용됨" : "· 제출 전 staging"}
                </span>
              </p>
              {states.length === 0 ? (
                <p className="text-xs text-muted-foreground/70">
                  토글 후 모두 되돌려서 적용된 변경은 없습니다.
                </p>
              ) : (
                states.map((entry) => (
                  <div
                    key={entry.memoryId}
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "shrink-0 rounded-full",
                          entry.active
                            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                            : "border-rose-200 bg-rose-50 text-rose-700",
                        )}
                      >
                        {entry.active ? "재활성화" : "비활성화"}
                      </Badge>
                      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                        {entry.memoryId}
                      </span>
                      {entry.toggledAt ? (
                        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {formatDateTime(entry.toggledAt)}
                        </span>
                      ) : null}
                    </div>
                    {entry.reason ? (
                      <p className="mt-1 text-xs leading-relaxed text-foreground">
                        사유: {entry.reason}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
              {events.length > states.length ? (
                <div className="grid gap-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    토글 이력 {events.length}회 (되돌림 포함)
                  </p>
                  {events.map((event, index) => (
                    <p
                      key={`${event.memoryId}:${event.toggledAt ?? index}`}
                      className="truncate text-[11px] text-muted-foreground"
                    >
                      {event.toggledAt ? `${formatDateTime(event.toggledAt)} · ` : ""}
                      {event.active ? "활성화" : "비활성화"}
                      <span className="font-mono"> · {event.memoryId}</span>
                      {event.reason ? ` · ${event.reason}` : ""}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewFeedbackView({
  rows,
  missionTitle,
  participantNumberByUid,
}: {
  rows: AdminReviewFeedbackRow[];
  missionTitle: (missionId: string) => string;
  // 들어온 순서 기반 참가자 번호(P1, P2, ...). 관리자 페이지 표시 전용.
  participantNumberByUid?: Record<string, number | null | undefined>;
}) {
  const questionRows = useMemo(() => buildQuestionRows(), []);
  const cardTextRows = useMemo(() => buildCardTextRows(), []);
  const questionViewRows = useMemo(() => buildQuestionViewRows(), []);
  const [participantFilter, setParticipantFilter] = useState("all");
  const participantNumberOf = (uid: string) =>
    participantNumberByUid?.[uid] ?? null;
  const numberedLabel = (row: AdminReviewFeedbackRow) => {
    const number = participantNumberOf(row.uid);
    return `${number != null ? `P${number} · ` : ""}${participantLabel(row)}`;
  };
  // 세션별(사용자 → 세션 카드) / 답변별(문항 → 참가자 → 세션 순 답변) 보기.
  const [viewMode, setViewMode] = useState<"session" | "question">("session");
  const [detailRow, setDetailRow] = useState<AdminReviewFeedbackRow | null>(null);

  const participants = useMemo(() => {
    const byUid = new Map<string, { label: string; isAdmin: boolean }>();
    for (const row of rows) {
      if (!byUid.has(row.uid)) {
        byUid.set(row.uid, {
          label: numberedLabel(row),
          isAdmin: isAdminEmail(row.email),
        });
      }
    }
    // 드롭다운은 P번호 오름차순, 관리자 계정은 참가자 뒤로 정렬한다.
    return Array.from(byUid, ([uid, entry]) => ({ uid, ...entry })).sort(
      (a, b) =>
        Number(a.isAdmin) - Number(b.isAdmin) ||
        (participantNumberOf(a.uid) ?? Number.MAX_SAFE_INTEGER) -
          (participantNumberOf(b.uid) ?? Number.MAX_SAFE_INTEGER) ||
        a.label.localeCompare(b.label),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, participantNumberByUid]);

  const filteredRows = rows.filter(
    (row) => participantFilter === "all" || row.uid === participantFilter,
  );
  // 특정 참가자 보기에서는 카드 답변을 자르지 않고 전문을 보여준다 —
  // 인터뷰 중 한 사람의 리뷰를 모달 없이 통으로 읽기 위한 모드.
  const expandAnswers = participantFilter !== "all";

  const byUser = useMemo(() => {
    const groups = new Map<string, AdminReviewFeedbackRow[]>();
    for (const row of filteredRows) {
      const group = groups.get(row.uid) ?? [];
      group.push(row);
      groups.set(row.uid, group);
    }
    return Array.from(groups.values());
  }, [filteredRows]);
  // 참가자 그룹을 P번호 순(P1 상단)으로 먼저, 관리자 계정 그룹은 하단 구분선
  // 아래 별도 섹션으로.
  const participantGroups = byUser
    .filter((userRows) => !isAdminEmail(userRows[0].email))
    .sort(
      (a, b) =>
        (participantNumberOf(a[0].uid) ?? Number.MAX_SAFE_INTEGER) -
        (participantNumberOf(b[0].uid) ?? Number.MAX_SAFE_INTEGER),
    );
  const adminGroups = byUser.filter((userRows) =>
    isAdminEmail(userRows[0].email),
  );
  // 답변별 보기용: 관리자 계정은 아예 제외하고(15.341), 같은 참가자 순서에
  // 각 그룹 내부는 세션 진행 순서로.
  const questionUserGroups = participantGroups.map(sortRowsBySessionOrder);
  const questionRowCount = questionUserGroups.reduce(
    (sum, group) => sum + group.length,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={participantFilter} onValueChange={setParticipantFilter}>
          <SelectTrigger className="w-56 rounded-xl text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 참가자</SelectItem>
            {participants
              .filter(
                (participant) =>
                  viewMode !== "question" || !participant.isAdmin,
              )
              .map((participant) => (
                <SelectItem key={participant.uid} value={participant.uid}>
                  {participant.label}
                  {participant.isAdmin ? " · 관리자" : ""}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <div className="flex items-center rounded-xl border border-border bg-card p-0.5">
          {(
            [
              ["session", "세션별"],
              ["question", "답변별"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setViewMode(mode);
                // 답변별 보기는 관리자를 제외하므로, 관리자가 선택된 채
                // 전환하면 전체 참가자로 되돌린다 (15.341).
                if (
                  mode === "question" &&
                  participants.some(
                    (participant) =>
                      participant.uid === participantFilter &&
                      participant.isAdmin,
                  )
                ) {
                  setParticipantFilter("all");
                }
              }}
              aria-pressed={viewMode === mode}
              className={cn(
                "cursor-pointer rounded-[10px] px-3 py-1.5 text-xs font-semibold transition",
                viewMode === mode
                  ? "bg-slate-700 text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {viewMode === "question" ? questionRowCount : filteredRows.length}건
        </p>
      </div>

      {(viewMode === "question"
        ? questionRowCount === 0
        : filteredRows.length === 0) ? (
        <div className="flex h-24 items-center justify-center rounded-3xl border border-dashed border-border bg-card text-sm text-muted-foreground">
          조건에 맞는 리뷰 답변이 없습니다.
        </div>
      ) : viewMode === "question" ? (
        <div className="space-y-4">
          {questionViewRows.map((question) => (
            <div
              key={question.key}
              className="rounded-2xl border border-border bg-card px-4 py-3.5"
            >
              <p className="text-xs font-semibold leading-relaxed text-muted-foreground">
                {question.number != null ? `${question.number}. ` : ""}
                {question.label}
              </p>
              <div className="mt-3 space-y-4">
                {question.kind === "rating" && participantFilter === "all" ? (
                  <AverageRatingSessionGraph
                    userGroups={questionUserGroups}
                    answerKey={question.key}
                  />
                ) : (
                  questionUserGroups.map((userRows) => (
                  <div key={userRows[0].uid} className="space-y-1.5">
                    {questionUserGroups.length > 1 ? (
                      <p className="text-xs font-semibold text-foreground">
                        {numberedLabel(userRows[0])}
                      </p>
                    ) : null}
                    {question.kind === "rating" ? (
                      <div className="space-y-2">
                        <RatingSessionGraph
                          rows={userRows}
                          answerKey={question.key}
                          missionTitle={missionTitle}
                        />
                        {question.reasonAnswerKey
                          ? userRows.map((row, sessionIndex) => {
                              const reason = answerText(
                                row,
                                question.reasonAnswerKey!,
                              ).trim();
                              if (!reason) return null;
                              return (
                                <div
                                  key={`${row.uid}:${row.missionId}`}
                                  className="flex items-start gap-2"
                                >
                                  <SessionOrderChip
                                    index={sessionIndex}
                                    title={missionTitle(row.missionId)}
                                  />
                                  <p className="min-w-0 flex-1 whitespace-pre-line text-xs leading-relaxed text-foreground/90">
                                    {reason}
                                  </p>
                                </div>
                              );
                            })
                          : null}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {userRows.map((row, sessionIndex) => {
                          const isMemoryCheck =
                            question.key === "memory_activity_review";
                          const text = answerText(row, question.key).trim();
                          const changeCount = isMemoryCheck
                            ? activationStates(row).length
                            : 0;
                          if (!text && changeCount === 0) return null;
                          return (
                            <div
                              key={`${row.uid}:${row.missionId}`}
                              className="flex items-start gap-2"
                            >
                              <SessionOrderChip
                                index={sessionIndex}
                                title={missionTitle(row.missionId)}
                              />
                              <div className="min-w-0 flex-1">
                                {isMemoryCheck && changeCount > 0 ? (
                                  <ActivationChanges row={row} />
                                ) : (
                                  <p className="whitespace-pre-line text-xs leading-relaxed text-foreground/90">
                                    {text}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {[...participantGroups, ...adminGroups].map((userRows) => (
            <div key={userRows[0].uid} className="space-y-2">
              {userRows === adminGroups[0] ? (
                <div className="flex items-center gap-3 pb-3 pt-1">
                  <div className="h-px flex-1 bg-border" />
                  <p className="text-xs font-semibold text-muted-foreground">
                    관리자 {adminGroups.length}
                  </p>
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <p className="text-sm font-semibold text-foreground">
                {numberedLabel(userRows[0])}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  세션 리뷰 {userRows.length}건
                </span>
              </p>
              <div className="grid gap-2">
                {userRows.map((row) => {
                  const activationCount = activationStates(row).length;
                  const textAnswers = cardTextRows
                    .map((question) => ({
                      ...question,
                      text: answerText(row, question.key).trim(),
                    }))
                    .filter(
                      (question) =>
                        question.text ||
                        // 9번은 텍스트가 비어도 실제 메모리 변경이 있으면 표시.
                        (question.key === "memory_activity_review" &&
                          activationCount > 0),
                    );
                  return (
                    <div
                      key={`${row.uid}:${row.missionId}`}
                      className="rounded-2xl border border-border bg-card px-4 py-3 transition hover:border-ring/40"
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setDetailRow(row)}
                          className="min-w-0 flex-1 cursor-pointer text-left"
                        >
                          <p className="truncate text-sm font-semibold text-foreground">
                            {missionTitle(row.missionId)}
                            {row.updatedAt && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {formatDateTime(row.updatedAt)}
                              </span>
                            )}
                          </p>
                        </button>
                        <HeaderRatingBadges row={row} />
                        {activationCount > 0 ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0 rounded-full border-violet-200 bg-violet-50 text-violet-700"
                          >
                            메모리 변경 {activationCount}
                          </Badge>
                        ) : null}
                        <Badge
                          variant={row.submittedAt ? "default" : "secondary"}
                          className="shrink-0 rounded-full"
                        >
                          {row.submittedAt ? "제출됨" : "임시저장"}
                        </Badge>
                        <SessionLink row={row} />
                      </div>
                      {textAnswers.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setDetailRow(row)}
                          className={cn(
                            "mt-2.5 grid w-full cursor-pointer gap-x-5 border-t border-border/60 pt-2.5 text-left",
                            expandAnswers
                              ? "gap-y-3"
                              : "gap-y-2 sm:grid-cols-2",
                          )}
                        >
                          {textAnswers.map((question) => (
                            <span key={question.key} className="min-w-0">
                              <span
                                className={cn(
                                  "block text-[10px] font-medium text-muted-foreground/70",
                                  !expandAnswers && "truncate",
                                )}
                                title={question.label}
                              >
                                {question.number != null
                                  ? `${question.number}. `
                                  : ""}
                                {question.label}
                              </span>
                              {question.key === "memory_activity_review" &&
                              activationCount > 0 ? (
                                <ActivationChanges row={row} />
                              ) : (
                                <span
                                  className={cn(
                                    "text-xs leading-relaxed text-foreground/90",
                                    expandAnswers
                                      ? "block whitespace-pre-line"
                                      : "line-clamp-2",
                                  )}
                                >
                                  {question.text}
                                </span>
                              )}
                            </span>
                          ))}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {detailRow && (
        <ReviewFeedbackDetail
          row={detailRow}
          missionTitle={missionTitle}
          questionRows={questionRows}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
