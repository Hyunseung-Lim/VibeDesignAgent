"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const [participantFilter, setParticipantFilter] = useState("all");
  const participantNumberOf = (uid: string) =>
    participantNumberByUid?.[uid] ?? null;
  const numberedLabel = (row: AdminReviewFeedbackRow) => {
    const number = participantNumberOf(row.uid);
    return `${number != null ? `P${number} · ` : ""}${participantLabel(row)}`;
  };
  const [submittedOnly, setSubmittedOnly] = useState(false);
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
    (row) =>
      (participantFilter === "all" || row.uid === participantFilter) &&
      (!submittedOnly || row.submittedAt != null),
  );

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={participantFilter} onValueChange={setParticipantFilter}>
          <SelectTrigger className="w-56 rounded-xl text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 참가자</SelectItem>
            {participants.map((participant) => (
              <SelectItem key={participant.uid} value={participant.uid}>
                {participant.label}
                {participant.isAdmin ? " · 관리자" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={submittedOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setSubmittedOnly((value) => !value)}
          className="rounded-xl text-xs"
        >
          제출됨만
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          {filteredRows.length}건
        </p>
      </div>

      {filteredRows.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-3xl border border-dashed border-border bg-card text-sm text-muted-foreground">
          조건에 맞는 리뷰 답변이 없습니다.
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
                    .filter((question) => question.text);
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
                          className="mt-2.5 grid w-full cursor-pointer gap-x-5 gap-y-2 border-t border-border/60 pt-2.5 text-left sm:grid-cols-2"
                        >
                          {textAnswers.map((question) => (
                            <span key={question.key} className="min-w-0">
                              <span
                                className="block truncate text-[10px] font-medium text-muted-foreground/70"
                                title={question.label}
                              >
                                {question.number != null
                                  ? `${question.number}. `
                                  : ""}
                                {question.label}
                              </span>
                              <span className="line-clamp-2 text-xs leading-relaxed text-foreground/90">
                                {question.text}
                              </span>
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
