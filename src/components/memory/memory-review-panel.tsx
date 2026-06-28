import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

type ReviewQuestion = {
  id: string;
  group: "session" | "cluster";
  label: string;
};

const REVIEW_QUESTIONS: ReviewQuestion[] = [
  {
    id: "stored_correctly",
    group: "session",
    label: "이번 세션에서 저장되어야 할 정보가 메모리에 제대로 저장되었나요?",
  },
  {
    id: "unnecessary_memory",
    group: "session",
    label: "저장할 필요가 없는데도 저장된 정보가 있나요? 있다면 무엇인가요?",
  },
  {
    id: "missing_memory",
    group: "session",
    label: "저장되었어야 하는데 빠진 정보가 있나요? 있다면 무엇인가요?",
  },
  {
    id: "missing_signal",
    group: "session",
    label: "빠진 정보가 있다면, 에이전트가 그 정보를 어떻게 알 수 있어야 한다고 생각하나요?",
  },
  {
    id: "cluster_grouping",
    group: "cluster",
    label: "메모리 클러스터가 적절하게 묶였나요?",
  },
  {
    id: "cluster_summary",
    group: "cluster",
    label: "클러스터가 요약한 나에 대한 정보가 정확하고 적절한가요?",
  },
  {
    id: "implicit_insight",
    group: "cluster",
    label: "클러스터를 통해 평소 의식하지 못했던 암묵지 중 새롭게 알게 된 점이 있나요?",
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
  saveStatus?: "idle" | "saving" | "saved" | "error";
  submittedAt?: number | null;
  readOnly?: boolean;
  onAnswersChange?: (answers: MemoryReviewAnswers) => void;
  onSubmitFeedback?: (answers: MemoryReviewAnswers) => Promise<boolean> | boolean;
};

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
  saveStatus = "idle",
  submittedAt = null,
  readOnly = false,
  onAnswersChange,
  onSubmitFeedback,
}: MemoryReviewPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [mentionRequest, setMentionRequest] = useState<MentionRequest | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const sessionQuestions = useMemo(
    () => REVIEW_QUESTIONS.filter((question) => question.group === "session"),
    [],
  );
  const clusterQuestions = useMemo(
    () => REVIEW_QUESTIONS.filter((question) => question.group === "cluster"),
    [],
  );

  useEffect(() => {
    onMentionModeChange(Boolean(mentionRequest));
  }, [mentionRequest, onMentionModeChange]);

  const buildAnswersPayload = useCallback((): MemoryReviewAnswers => {
    return Object.fromEntries(
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
      }),
    );
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

    const nextAnswers = Object.fromEntries(
      REVIEW_QUESTIONS.map((question) => [
        question.id,
        initialAnswers[question.id]?.text ?? "",
      ]),
    );
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
    updateMentionRequest(questionId, value, cursor);
    emitAnswersChange();
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

  const renderReadOnlyQuestion = (question: ReviewQuestion) => (
    <div key={question.id} className="space-y-1.5">
      <span className="block text-xs font-medium leading-relaxed text-slate-700">
        {question.label}
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

  const renderQuestion = (question: ReviewQuestion) =>
    readOnly ? (
      renderReadOnlyQuestion(question)
    ) : (
    <div key={question.id} className="space-y-1.5">
      <span className="block text-xs font-medium leading-relaxed text-slate-700">
        {question.label}
      </span>
      <div
        ref={(element) => {
          editorRefs.current[question.id] = element;
        }}
        role="textbox"
        aria-label={question.label}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="@ 입력 후 왼쪽 메모리뷰에서 항목을 선택하세요"
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
        className={`min-h-20 wrap-anywhere whitespace-pre-wrap rounded-md border border-input bg-white px-3 py-2 text-xs leading-relaxed outline-none ring-offset-background empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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

  return (
    <aside className="m-3 ml-0 flex w-92 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl xl:w-96">
      <div className="border-b border-slate-200 px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Review
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-normal text-slate-950">
          메모리 리뷰하기
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <section className="space-y-3">
          <p className="text-xs font-semibold text-slate-900">
            세션별로 기억해야 할 정보
          </p>
          <div className="space-y-4">{sessionQuestions.map(renderQuestion)}</div>
        </section>

        <section className="mt-6 space-y-3">
          <p className="text-xs font-semibold text-slate-900">
            메모리 클러스터
          </p>
          <div className="space-y-4">{clusterQuestions.map(renderQuestion)}</div>
        </section>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
        <p className="text-[11px] text-slate-400">
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
            setIsSubmitting(true);
            try {
              await onSubmitFeedback(payload);
            } finally {
              setIsSubmitting(false);
            }
          }}
          disabled={!onSubmitFeedback || saveStatus === "saving" || isSubmitting}
          className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? "제출 중..." : "제출"}
        </button>
        )}
      </div>
    </aside>
  );
}
