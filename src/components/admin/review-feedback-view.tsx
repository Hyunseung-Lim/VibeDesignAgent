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
  submittedAt: number | null;
  updatedAt: number | null;
};

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

function previewText(row: AdminReviewFeedbackRow) {
  const preferred = answerText(row, "future_memory_freeform").trim();
  if (preferred) return preferred;
  for (const question of REVIEW_QUESTIONS) {
    if (question.type) continue;
    const text = answerText(row, question.id).trim();
    if (text) return text;
  }
  return "";
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewFeedbackView({
  rows,
  missionTitle,
}: {
  rows: AdminReviewFeedbackRow[];
  missionTitle: (missionId: string) => string;
}) {
  const questionRows = useMemo(() => buildQuestionRows(), []);
  const [participantFilter, setParticipantFilter] = useState("all");
  const [submittedOnly, setSubmittedOnly] = useState(false);
  const [detailRow, setDetailRow] = useState<AdminReviewFeedbackRow | null>(null);

  const participants = useMemo(() => {
    const byUid = new Map<string, string>();
    for (const row of rows) {
      if (!byUid.has(row.uid)) byUid.set(row.uid, participantLabel(row));
    }
    return Array.from(byUid, ([uid, label]) => ({ uid, label }));
  }, [rows]);

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
          {byUser.map((userRows) => (
            <div key={userRows[0].uid} className="space-y-2">
              <p className="text-sm font-semibold text-foreground">
                {participantLabel(userRows[0])}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  세션 리뷰 {userRows.length}건
                </span>
              </p>
              <div className="grid gap-2">
                {userRows.map((row) => {
                  const preview = previewText(row);
                  return (
                    <div
                      key={`${row.uid}:${row.missionId}`}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition hover:border-ring/40"
                    >
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
                        {preview && (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {preview}
                          </p>
                        )}
                      </button>
                      <HeaderRatingBadges row={row} />
                      <Badge
                        variant={row.submittedAt ? "default" : "secondary"}
                        className="shrink-0 rounded-full"
                      >
                        {row.submittedAt ? "제출됨" : "임시저장"}
                      </Badge>
                      <SessionLink row={row} />
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
