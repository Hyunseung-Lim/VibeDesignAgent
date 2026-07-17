import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useState,
} from "react";
import { CheckIcon } from "lucide-react";

type ReviewQuestion = {
  id: string;
  label: string;
  allowNone?: boolean;
  type?: "rating" | "memory-activity";
  placeholder?: string;
};

const NONE_ANSWER_TEXT = "없음";

// 기대대로 기억됨 / 잘못 기억됨 / 빠진 정보가 동시에 모두 "없음"일
// 수는 없다 — 셋 중 하나는 반드시 내용이 있어야 논리적으로 성립한다.
const NONE_CONFLICT_QUESTION_IDS = [
  "expected_memory_present",
  "wrong_or_unnecessary_memory",
  "missing_memory",
];

function reasonKey(questionId: string) {
  return `${questionId}_reason`;
}

const REVIEW_QUESTIONS: ReviewQuestion[] = [
  {
    id: "expected_memory_present",
    label:
      "메모리를 둘러보며, 기억하기를 기대했던 내용이 실제로 기억되어 있는지 확인해주세요. 어떤 내용들이 이에 해당하나요?",
    allowNone: true,
    placeholder: "어떤 내용인지 적어주세요",
  },
  {
    id: "wrong_or_unnecessary_memory",
    label:
      "반대로, 틀렸거나, 필요 없거나, 바란 것과 다르게 기억된 정보가 있나요? (어떻게 저장되었어야 하나요?)",
    allowNone: true,
    placeholder: "무엇이 어떻게 잘못 기억되어 있는지 적어주세요",
  },
  {
    id: "missing_memory",
    label:
      "혹시 기억되기를 바랐는데 없는 정보(또는 빠진 내용)가 있나요?",
    allowNone: true,
    placeholder: "어떤 정보가 빠져 있는지 적어주세요",
  },
  {
    id: "correction_preference",
    label:
      "위에서 메모리에 수정이나 추가가 필요하다고 답하셨다면, 이것이 어떤 방식으로 바로잡히기를 원하시나요? (앞서 언급한 정보 각각에 대해 답해주세요)",
    allowNone: true,
    placeholder:
      "예: 직접 고치고 싶다, 말해서 고치게 하고 싶다, 이후 작업을 보며 스스로 반영했으면 한다",
  },
  {
    id: "memory_activity_review",
    label:
      "메모리 중 비활성화하고 싶거나, 활성화하고 싶은 메모리를 설정해주세요.",
    type: "memory-activity",
  },
  {
    id: "overall_memory_accuracy",
    label:
      "지금까지 둘러본 메모리가 전반적으로 나를 정확하게 반영하고 있습니다.",
    type: "rating",
  },
  {
    id: "new_self_insight",
    label:
      "마지막으로, 메모리를 보면서 평소 미처 몰랐던 나의 취향이나 작업 습관을 새로 알게 된 것이 있나요?",
    allowNone: true,
    placeholder: "새로 알게 된 취향이나 작업 습관을 적어주세요",
  },
];

export type MemoryReviewMentionTarget = {
  eventId: number;
  id: string;
  type: "cluster" | "memory";
  label: string;
};

type MentionRequest = {
  questionId: string;
  cursor: number;
};

type MemoryReviewPanelProps = {
  mentionTarget: MemoryReviewMentionTarget | null;
  onMentionModeChange: (active: boolean) => void;
  onMentionFocus: (target: Omit<MemoryReviewMentionTarget, "eventId">) => void;
  initialAnswers?: MemoryReviewAnswers;
  introMemoryText?: string;
  startNumber?: number;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  submittedAt?: number | null;
  readOnly?: boolean;
  /** Admin view: show the Part 1 answers stored in initialAnswers above Part 2. */
  showPart1Summary?: boolean;
  onAnswersChange?: (answers: MemoryReviewAnswers) => void;
  onSubmitFeedback?: (answers: MemoryReviewAnswers) => Promise<boolean> | boolean;
  onSubmitted?: () => void;
};

// Part 1 (오늘 세션 돌아보기) answer keys — same contract as
// MEMORY_REVIEW_INTRO_KEYS in /main/[missionId].
const PART1_QUESTIONS: { key: string; label: string; rating: boolean }[] = [
  {
    key: "session_understanding",
    label: "에이전트가 내 작업 방식을 잘 이해하고 있다고 느꼈다",
    rating: true,
  },
  {
    key: "design_preference_understanding",
    label: "에이전트가 내 디자인 취향과 선호를 잘 이해하고 있다고 느꼈다",
    rating: true,
  },
  {
    key: "memory_helpfulness",
    label: "에이전트의 메모리 덕분에 협업이 더 수월했다",
    rating: true,
  },
  {
    key: "future_memory_freeform",
    label: "앞으로 기억해 주었으면 하는 것",
    rating: false,
  },
];

export type MemoryReviewMention = {
  type: "cluster" | "memory";
  id: string;
  label: string;
  start: number;
  end: number;
};

export type MemoryReviewAnswer = {
  text: string;
  mentions: MemoryReviewMention[];
};

export type MemoryReviewAnswers = Record<string, MemoryReviewAnswer>;

function mentionText(target: MemoryReviewMentionTarget) {
  const label = target.label.replace(/\s+/g, " ").trim().slice(0, 64);
  return `@${target.type}(${label})`;
}

function pendingMention(value: string, cursor: number) {
  return value.slice(0, cursor).match(/(^|\s)@[\w가-힣-]*$/);
}

const MENTION_PATTERN = /@(cluster|memory)\(([^)]*)\)/g;
const MENTION_CLASS =
  "rounded-sm bg-amber-50 px-0.5 font-semibold text-amber-800 underline decoration-amber-300 underline-offset-2";

function getEditableText(element: HTMLElement) {
  return element.innerText.replace(/\n$/, "");
}

function caretOffset(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.endContainer, range.endOffset);
  return prefix.toString().length;
}

function setCaretOffset(element: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;

  let remaining = offset;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const textLength = node.textContent?.length ?? 0;
    if (remaining <= textLength) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= textLength;
    node = walker.nextNode();
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mentionHtml(value: string) {
  let html = "";
  let lastIndex = 0;

  for (const match of value.matchAll(MENTION_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;
    html += escapeHtml(value.slice(lastIndex, index));
    html += `<span role="button" tabindex="0" contenteditable="false" data-mention-token="${escapeHtml(token)}" class="${MENTION_CLASS}">${escapeHtml(token)}</span>`;
    lastIndex = index + token.length;
  }

  html += escapeHtml(value.slice(lastIndex));
  return html;
}

export function MemoryReviewPanel({
  mentionTarget,
  onMentionModeChange,
  onMentionFocus,
  initialAnswers,
  introMemoryText = "",
  startNumber = 1,
  saveStatus = "idle",
  submittedAt = null,
  readOnly = false,
  showPart1Summary = false,
  onAnswersChange,
  onSubmitFeedback,
  onSubmitted,
}: MemoryReviewPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [noneSelected, setNoneSelected] = useState<Record<string, boolean>>({});
  const [mentionRequest, setMentionRequest] = useState<MentionRequest | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmitPayload, setPendingSubmitPayload] =
    useState<MemoryReviewAnswers | null>(null);
  const [, setCompletionRevision] = useState(0);
  const [handledMentionEventId, setHandledMentionEventId] = useState(0);
  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const answersRef = useRef<Record<string, string>>({});
  const mentionTargetsRef = useRef<
    Record<string, Record<string, Omit<MemoryReviewMentionTarget, "eventId">>>
  >({});
  const activeQuestionIdRef = useRef<string | null>(null);
  const caretByQuestionRef = useRef<Record<string, number>>({});
  const hydratedAnswersKeyRef = useRef("");
  const renderedAnswersRef = useRef<Record<string, string>>({});
  const trimmedIntroMemoryText = introMemoryText.trim();

  useEffect(() => {
    onMentionModeChange(Boolean(mentionRequest));
  }, [mentionRequest, onMentionModeChange]);

  const allQuestionsAnswered = REVIEW_QUESTIONS.every(
    (question) =>
      answersRef.current[question.id]?.trim() &&
      (question.type !== "rating" ||
        answersRef.current[reasonKey(question.id)]?.trim()),
  );
  const allNoneConflict = NONE_CONFLICT_QUESTION_IDS.every(
    (id) => answersRef.current[id]?.trim() === NONE_ANSWER_TEXT,
  );
  const noneConflictNumbers = NONE_CONFLICT_QUESTION_IDS.map(
    (id) =>
      startNumber + REVIEW_QUESTIONS.findIndex((question) => question.id === id),
  ).join("·");

  const submitPendingFeedback = async () => {
    if (!pendingSubmitPayload || !onSubmitFeedback) return;
    setIsSubmitting(true);
    try {
      const submitted = await onSubmitFeedback(pendingSubmitPayload);
      if (submitted) {
        setPendingSubmitPayload(null);
        onSubmitted?.();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildAnswersPayload = useCallback((): MemoryReviewAnswers => {
    const entries: (readonly [string, MemoryReviewAnswer])[] =
      REVIEW_QUESTIONS.map((question) => {
        const text = answersRef.current[question.id] ?? "";
        const targets = mentionTargetsRef.current[question.id] ?? {};
        const mentions: MemoryReviewMention[] = [];
        for (const match of text.matchAll(MENTION_PATTERN)) {
          const token = match[0];
          const start = match.index ?? 0;
          const target = targets[token];
          if (!target) continue;
          mentions.push({
            type: target.type,
            id: target.id,
            label: target.label,
            start,
            end: start + token.length,
          });
        }
        return [question.id, { text, mentions }] as const;
      });
    for (const question of REVIEW_QUESTIONS) {
      if (question.type !== "rating") continue;
      const key = reasonKey(question.id);
      entries.push([key, { text: answersRef.current[key] ?? "", mentions: [] }]);
    }
    return Object.fromEntries(entries);
  }, []);

  const emitAnswersChange = useCallback(() => {
    onAnswersChange?.(buildAnswersPayload());
  }, [buildAnswersPayload, onAnswersChange]);

  const collectEditorAnswers = useCallback(() => {
    for (const question of REVIEW_QUESTIONS) {
      const element = editorRefs.current[question.id];
      if (!element) continue;
      answersRef.current = {
        ...answersRef.current,
        [question.id]: getEditableText(element),
      };
    }
    return buildAnswersPayload();
  }, [buildAnswersPayload]);

  useEffect(() => {
    if (!initialAnswers) return;
    const nextHydrationKey = JSON.stringify(initialAnswers);
    if (hydratedAnswersKeyRef.current === nextHydrationKey) return;
    if (JSON.stringify(buildAnswersPayload()) === nextHydrationKey) {
      hydratedAnswersKeyRef.current = nextHydrationKey;
      return;
    }

    const nextAnswers: Record<string, string> = Object.fromEntries(
      REVIEW_QUESTIONS.map((question) => [
        question.id,
        initialAnswers[question.id]?.text ?? "",
      ]),
    );
    for (const question of REVIEW_QUESTIONS) {
      if (question.type !== "rating") continue;
      const key = reasonKey(question.id);
      nextAnswers[key] = initialAnswers[key]?.text ?? "";
    }
    const nextTargets = Object.fromEntries(
      REVIEW_QUESTIONS.map((question) => {
        const answer = initialAnswers[question.id];
        const targets = Object.fromEntries(
          (answer?.mentions ?? []).map((mention) => [
            answer?.text.slice(mention.start, mention.end) ?? "",
            {
              id: mention.id,
              type: mention.type,
              label: mention.label,
            },
          ]),
        );
        return [question.id, targets];
      }),
    );
    answersRef.current = nextAnswers;
    mentionTargetsRef.current = nextTargets;
    hydratedAnswersKeyRef.current = nextHydrationKey;
    setNoneSelected(
      Object.fromEntries(
        REVIEW_QUESTIONS.filter((question) => question.allowNone).map(
          (question) => [
            question.id,
            (nextAnswers[question.id] ?? "").trim() === NONE_ANSWER_TEXT,
          ],
        ),
      ),
    );
    // Apply synchronously. A deferred setAnswers (setTimeout) would be cancelled
    // by this effect's cleanup under React StrictMode's setup→cleanup→setup
    // double-invoke, while hydratedAnswersKeyRef is already set — so the second
    // setup bails and the editors never receive the loaded text.
    setAnswers(nextAnswers);
  }, [buildAnswersPayload, initialAnswers]);

  useLayoutEffect(() => {
    for (const question of REVIEW_QUESTIONS) {
      const value = answers[question.id] ?? "";
      if (renderedAnswersRef.current[question.id] === value) continue;
      const element = editorRefs.current[question.id];
      if (!element) continue;
      element.innerHTML = mentionHtml(value);
      renderedAnswersRef.current[question.id] = value;
    }

    const questionId = activeQuestionIdRef.current;
    if (!questionId) return;
    const element = editorRefs.current[questionId];
    const offset = caretByQuestionRef.current[questionId];
    if (!element || offset == null) return;
    setCaretOffset(element, Math.min(offset, getEditableText(element).length));
  }, [answers]);

  useEffect(() => {
    if (!mentionRequest || !mentionTarget) return;
    if (mentionTarget.eventId === handledMentionEventId) return;
    const token = mentionText(mentionTarget);

    const timeoutId = window.setTimeout(() => {
      const value = answersRef.current[mentionRequest.questionId] ?? "";
      const cursor = Math.min(mentionRequest.cursor, value.length);
      const beforeCursor = value.slice(0, cursor);
      const afterCursor = value.slice(cursor);
      const match = pendingMention(value, cursor);
      let nextValue: string;

      if (!match) {
        nextValue = `${beforeCursor}${
          beforeCursor && !beforeCursor.endsWith(" ") ? " " : ""
        }${token} ${afterCursor}`;
        caretByQuestionRef.current[mentionRequest.questionId] =
          nextValue.indexOf(token, beforeCursor.length) + token.length + 1;
      } else {
        const start = beforeCursor.length - match[0].trimStart().length;
        nextValue = `${beforeCursor.slice(0, start)}${token} ${afterCursor}`;
        caretByQuestionRef.current[mentionRequest.questionId] =
          start + token.length + 1;
      }

      answersRef.current = {
        ...answersRef.current,
        [mentionRequest.questionId]: nextValue,
      };
      mentionTargetsRef.current = {
        ...mentionTargetsRef.current,
        [mentionRequest.questionId]: {
          ...(mentionTargetsRef.current[mentionRequest.questionId] ?? {}),
          [token]: {
            id: mentionTarget.id,
            type: mentionTarget.type,
            label: mentionTarget.label,
          },
        },
      };
      setAnswers((current) => ({
        ...current,
        [mentionRequest.questionId]: nextValue,
      }));
      emitAnswersChange();
      activeQuestionIdRef.current = mentionRequest.questionId;
      setHandledMentionEventId(mentionTarget.eventId);
      setMentionRequest(null);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [emitAnswersChange, handledMentionEventId, mentionRequest, mentionTarget]);

  const updateMentionRequest = (
    questionId: string,
    value: string,
    cursor: number | null,
  ) => {
    if (cursor != null && pendingMention(value, cursor)) {
      setMentionRequest({ questionId, cursor });
    } else if (mentionRequest?.questionId === questionId) {
      setMentionRequest(null);
    }
  };

  const updateAnswerFromEditor = (questionId: string, element: HTMLElement) => {
    const value = getEditableText(element);
    const cursor = caretOffset(element);
    activeQuestionIdRef.current = questionId;
    if (cursor != null) caretByQuestionRef.current[questionId] = cursor;
    answersRef.current = {
      ...answersRef.current,
      [questionId]: value,
    };
    setCompletionRevision((current) => current + 1);
    updateMentionRequest(questionId, value, cursor);
    emitAnswersChange();
  };

  const toggleNoneAnswer = (questionId: string) => {
    const nextNone = !noneSelected[questionId];
    const nextValue = nextNone ? NONE_ANSWER_TEXT : "";
    setNoneSelected((current) => ({ ...current, [questionId]: nextNone }));
    answersRef.current = {
      ...answersRef.current,
      [questionId]: nextValue,
    };
    setAnswers((current) => ({ ...current, [questionId]: nextValue }));
    if (mentionRequest?.questionId === questionId) setMentionRequest(null);
    if (activeQuestionIdRef.current === questionId) {
      activeQuestionIdRef.current = null;
    }
    setCompletionRevision((current) => current + 1);
    emitAnswersChange();
  };

  const selectRating = (questionId: string, score: number) => {
    const nextValue = String(score);
    answersRef.current = {
      ...answersRef.current,
      [questionId]: nextValue,
    };
    setAnswers((current) => ({ ...current, [questionId]: nextValue }));
    setCompletionRevision((current) => current + 1);
    emitAnswersChange();
  };

  const toggleMemoryActivityReview = (questionId: string) => {
    const nextValue = answersRef.current[questionId]?.trim()
      ? ""
      : "확인 완료";
    answersRef.current = {
      ...answersRef.current,
      [questionId]: nextValue,
    };
    setAnswers((current) => ({ ...current, [questionId]: nextValue }));
    setCompletionRevision((current) => current + 1);
    emitAnswersChange();
  };

  const updateRatingReason = (questionId: string, value: string) => {
    const key = reasonKey(questionId);
    answersRef.current = {
      ...answersRef.current,
      [key]: value,
    };
    setAnswers((current) => ({ ...current, [key]: value }));
    emitAnswersChange();
  };

  const renderRatingReason = (question: ReviewQuestion) => {
    const key = reasonKey(question.id);
    const value = answers[key] ?? "";
    if (readOnly) {
      return value.trim() ? (
        <p className="wrap-anywhere whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          {value}
        </p>
      ) : null;
    }
    return (
      <textarea
        value={value}
        onChange={(event) => updateRatingReason(question.id, event.target.value)}
        placeholder="점수를 준 이유를 함께 적어주세요"
        className="min-h-16 w-full resize-none wrap-anywhere rounded-md border border-input bg-white px-3 py-2 text-xs leading-relaxed outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    );
  };

  const focusMentionToken = (questionId: string, token: string) => {
    const match = token.match(/^@(cluster|memory)\((.*)\)$/);
    const target = mentionTargetsRef.current[questionId]?.[token] ?? {
      id: token,
      type: match?.[1] === "cluster" ? "cluster" : "memory",
      label: match?.[2] ?? token,
    };
    onMentionFocus(target);
  };

  const renderRatingRow = (questionId: string) => {
    const selected = Number(answers[questionId] ?? "");
    return (
      <div className="space-y-2.5">
        <div className="flex justify-between gap-2">
          {Array.from({ length: 7 }, (_, index) => index + 1).map((score) => (
            <button
              key={score}
              type="button"
              disabled={readOnly}
              aria-pressed={selected === score}
              aria-label={`${score}점`}
              onClick={() => selectRating(questionId, score)}
              className={`h-9 w-9 rounded-full border text-sm font-semibold transition ${
                selected === score
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-950"
              } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
            >
              {score}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 text-[11px] font-medium leading-tight text-slate-500">
          <span>1 전혀 아니다</span>
          <span className="text-center">4 보통</span>
          <span className="text-right">7 매우 그렇다</span>
        </div>
      </div>
    );
  };

  const renderReadOnlyQuestion = (question: ReviewQuestion, index: number) =>
    question.type === "rating" ? (
      <div key={question.id} className="space-y-2">
        <span className="block text-sm font-medium leading-relaxed text-slate-700">
          {startNumber + index}. {question.label}
        </span>
        {renderRatingRow(question.id)}
        {renderRatingReason(question)}
      </div>
    ) : question.type === "memory-activity" ? (
      <div key={question.id} className="space-y-1.5">
        <span className="block text-sm font-medium leading-relaxed text-slate-700">
          {startNumber + index}. {question.label}
        </span>
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <CheckIcon size={13} aria-hidden="true" />
          {answers[question.id]?.trim() || "응답 없음"}
        </p>
      </div>
    ) : (
    <div key={question.id} className="space-y-1.5">
      <span className="block text-sm font-medium leading-relaxed text-slate-700">
        {startNumber + index}. {question.label}
      </span>
      <div
        ref={(element) => {
          editorRefs.current[question.id] = element;
        }}
        aria-label={question.label}
        data-placeholder="응답 없음"
        onClick={(event) => {
          const mentionElement = (event.target as HTMLElement).closest(
            "[data-mention-token]",
          );
          if (!mentionElement) return;
          event.preventDefault();
          event.stopPropagation();
          const token = mentionElement.getAttribute("data-mention-token");
          if (token) focusMentionToken(question.id, token);
        }}
        className="wrap-anywhere whitespace-pre-wrap text-xs leading-relaxed text-slate-700 empty:before:text-slate-300 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );

  const renderQuestion = (question: ReviewQuestion, index: number) => {
    if (readOnly) return renderReadOnlyQuestion(question, index);
    if (question.type === "memory-activity") {
      const reviewed = Boolean(answers[question.id]?.trim());
      return (
        <div key={question.id} className="space-y-2">
          <span className="block text-sm font-medium leading-relaxed text-slate-700">
            {startNumber + index}. {question.label}
          </span>
          <button
            type="button"
            aria-pressed={reviewed}
            onClick={() => toggleMemoryActivityReview(question.id)}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition ${
              reviewed
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-800"
            }`}
          >
            <CheckIcon size={13} aria-hidden="true" />
            상태 확인 완료
          </button>
        </div>
      );
    }
    if (question.type === "rating") {
      return (
        <div key={question.id} className="space-y-2">
          <span className="block text-sm font-medium leading-relaxed text-slate-700">
            {startNumber + index}. {question.label}
          </span>
          {renderRatingRow(question.id)}
          {renderRatingReason(question)}
        </div>
      );
    }
    const isNone = Boolean(question.allowNone && noneSelected[question.id]);
    return (
    <div key={question.id} className="space-y-1.5">
      <span className="block text-sm font-medium leading-relaxed text-slate-700">
        {startNumber + index}. {question.label}
      </span>
      {question.allowNone ? (
        <button
          type="button"
          aria-pressed={isNone}
          onClick={() => toggleNoneAnswer(question.id)}
          className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
            isNone
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-800"
          }`}
        >
          없음
        </button>
      ) : null}
      <div
        ref={(element) => {
          editorRefs.current[question.id] = element;
        }}
        role="textbox"
        aria-label={question.label}
        aria-multiline="true"
        aria-disabled={isNone}
        contentEditable={!isNone}
        suppressContentEditableWarning
        data-placeholder={question.placeholder ?? ""}
        onInput={(event) =>
          updateAnswerFromEditor(question.id, event.currentTarget)
        }
        onFocus={() => {
          activeQuestionIdRef.current = question.id;
        }}
        onClick={(event) => {
          const mentionElement = (event.target as HTMLElement).closest(
            "[data-mention-token]",
          );
          if (!mentionElement) return;
          event.preventDefault();
          event.stopPropagation();
          const token = mentionElement.getAttribute("data-mention-token");
          if (token) focusMentionToken(question.id, token);
        }}
        onBlur={() => {
          const element = editorRefs.current[question.id];
          if (element) updateAnswerFromEditor(question.id, element);
          if (activeQuestionIdRef.current === question.id) {
            activeQuestionIdRef.current = null;
          }
        }}
        onMouseUp={(event) =>
          updateMentionRequest(
            question.id,
            getEditableText(event.currentTarget),
            caretOffset(event.currentTarget),
          )
        }
        onKeyUp={(event) =>
          updateMentionRequest(
            question.id,
            getEditableText(event.currentTarget),
            caretOffset(event.currentTarget),
          )
        }
        onKeyDown={(event) => {
          const mentionElement = (event.target as HTMLElement).closest(
            "[data-mention-token]",
          );
          if (
            mentionElement &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            event.stopPropagation();
            const token = mentionElement.getAttribute("data-mention-token");
            if (token) focusMentionToken(question.id, token);
            return;
          }
          if (event.key === "Escape" && mentionRequest) {
            event.preventDefault();
            setMentionRequest(null);
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            document.execCommand("insertLineBreak");
          }
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        className={`min-h-20 wrap-anywhere whitespace-pre-wrap rounded-md border border-input px-3 py-2 text-xs leading-relaxed outline-none ring-offset-background empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          isNone
            ? "pointer-events-none bg-slate-100 text-slate-400"
            : "bg-white"
        } ${
          mentionRequest?.questionId === question.id
            ? "border-amber-200 ring-2 ring-amber-100"
            : ""
        }`}
      />
      {mentionRequest?.questionId === question.id ? (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700">
          왼쪽 메모리뷰에서 언급할 클러스터나 메모리를 선택하세요. Esc로 취소할 수 있습니다.
        </p>
      ) : null}
    </div>
    );
  };

  const part1Answers = PART1_QUESTIONS.map((question) => ({
    ...question,
    text: initialAnswers?.[question.key]?.text?.trim() ?? "",
  })).filter((question) => question.text);

  return (
    <aside className="relative m-3 ml-0 flex w-92 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl xl:w-96">
      {showPart1Summary && part1Answers.length > 0 ? (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Review Part 1 · 오늘 세션 돌아보기
          </p>
          <dl className="mt-2 space-y-1.5">
            {part1Answers.map((question) => (
              <div key={question.key} className="text-xs leading-relaxed">
                <dt className="font-medium text-slate-500">{question.label}</dt>
                <dd
                  className={
                    question.rating
                      ? "font-semibold text-slate-800"
                      : "wrap-anywhere whitespace-pre-wrap text-slate-700"
                  }
                >
                  {question.rating ? `${question.text} / 7` : question.text}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <div className="border-b border-slate-200 px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Review Part 2
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-normal text-slate-950">
          메모리 리뷰하기
        </h2>
        {trimmedIntroMemoryText ? (
          <div className="mt-2 space-y-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                기억해 주었으면 한 내용
              </p>
              <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-800">
                {trimmedIntroMemoryText}
              </p>
            </div>
            <p className="text-sm font-medium leading-relaxed text-slate-600">
              입력해주신 기억할 정보와 실제로 저장된 정보를 비교해서 아래 질문에
              답해주세요.{" "}
              <span className="text-slate-400">
                (@ 입력 후 왼쪽 메모리뷰에서 항목을 선택해 언급할 수 있어요)
              </span>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">
            4번에서 적은 답변과 실제로 저장된 정보를 비교해서 아래 질문에
            답해주세요.{" "}
            <span className="text-slate-400">
              (@ 입력 후 왼쪽 메모리뷰에서 항목을 선택해 언급할 수 있어요)
            </span>
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="space-y-4">{REVIEW_QUESTIONS.map(renderQuestion)}</div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
        <p
          className={`min-w-0 text-[11px] ${
            !readOnly && allNoneConflict ? "font-semibold text-rose-500" : "text-slate-400"
          }`}
        >
          {readOnly
            ? submittedAt
              ? "제출 완료 (읽기 전용)"
              : "읽기 전용"
            : saveStatus === "saving"
              ? "저장 중..."
            : saveStatus === "error"
                ? "저장 실패"
                : submittedAt
                  ? "제출 완료"
                  : allNoneConflict
                    ? `${noneConflictNumbers}번이 모두 없음일 수는 없어요. 하나 이상 작성해주세요.`
                  : !allQuestionsAnswered
                    ? "모든 항목 입력 후 제출할 수 있습니다."
                  : saveStatus === "saved"
                    ? "저장됨"
                    : "Draft"}
        </p>
        {readOnly ? null : (
        <button
          type="button"
          onClick={async () => {
            const payload = collectEditorAnswers();
            onAnswersChange?.(payload);
            if (!onSubmitFeedback) return;
            if (
              !REVIEW_QUESTIONS.every(
                (question) =>
                  payload[question.id]?.text.trim() &&
                  (question.type !== "rating" ||
                    payload[reasonKey(question.id)]?.text.trim()),
              )
            ) {
              return;
            }
            if (
              NONE_CONFLICT_QUESTION_IDS.every(
                (id) => payload[id]?.text.trim() === NONE_ANSWER_TEXT,
              )
            ) {
              return;
            }
            setPendingSubmitPayload(payload);
          }}
          disabled={
            !onSubmitFeedback ||
            !allQuestionsAnswered ||
            allNoneConflict ||
            saveStatus === "saving" ||
            isSubmitting
          }
          className="cursor-pointer rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? "제출 중..." : "제출"}
        </button>
        )}
      </div>
      {pendingSubmitPayload && !readOnly ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-review-submit-title"
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3
              id="memory-review-submit-title"
              className="text-base font-semibold text-slate-950"
            >
              제출 완료하겠습니까?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              제출하면 리뷰가 완료 상태로 저장되고 로비로 이동합니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSubmitPayload(null)}
                disabled={isSubmitting}
                className="cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitPendingFeedback}
                disabled={isSubmitting || saveStatus === "saving"}
                className="cursor-pointer rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? "제출 중..." : "제출"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
