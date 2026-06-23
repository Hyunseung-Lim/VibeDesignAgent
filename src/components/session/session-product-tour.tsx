"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { XIcon } from "lucide-react";

type TourStep = {
  target: string;
  fallbackTarget?: string;
  title: string;
  body: string;
  demo?: "drag-quote";
};

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type MeasuredRect = {
  key: string;
  rect: Rect;
};

type SessionProductTourProps = {
  open: boolean;
  hasIdeas: boolean;
  onOpenChange: (open: boolean) => void;
  onStepTargetChange?: (target: string) => void;
};

const EMPTY_IDEA_STEPS: TourStep[] = [
  {
    target: "mission-brief",
    title: "미션 설명",
    body: "왼쪽 상단에서 이번 미션의 목표, 대상 디바이스, 구체적인 요구사항을 확인합니다. 에이전트와 작업할 때 계속 기준이 되는 정보예요.",
  },
  {
    target: "content-panel",
    fallbackTarget: "mission-brief",
    title: "드래그해서 인용하기",
    body: "미션 설명, 레퍼런스, 시안 내용 등 이 왼쪽 패널 어디서든 텍스트를 마우스로 드래그해 선택하면 인용 버튼이 나타납니다. 누르면 그 문장이 채팅 입력에 텍스트 인용으로 담겨, 특정 부분을 콕 집어 에이전트에게 요청할 수 있어요.",
    demo: "drag-quote",
  },
  {
    target: "chat-panel",
    title: "채팅 공간",
    body: "오른쪽 채팅에서 에이전트에게 레퍼런스 탐색, 시안 작성, 디자인 스타일 정리, 목업 생성을 요청합니다. 선택한 레퍼런스나 화면 요소도 여기로 보낼 수 있어요.",
  },
  {
    target: "chat-command-palette",
    fallbackTarget: "chat-panel",
    title: "만들기 명령",
    body: "입력창의 / 버튼이나 키보드의 /로 새 시안, 디자인 스타일, 목업, 레퍼런스 검색 명령을 고를 수 있습니다. @를 입력하면 현재 세션에 이미 있는 시안과 산출물을 언급할 수 있어요.",
  },
  {
    target: "reference-section",
    title: "레퍼런스",
    body: "찾아온 레퍼런스는 여기 쌓입니다. 마음에 드는 레퍼런스를 선택한 뒤 채팅에 함께 보내면 시안과 디자인 스타일, 목업 방향에 반영할 수 있어요.",
  },
  {
    target: "idea-workspace",
    title: "시안 작업 공간",
    body: "에이전트가 만든 시안은 이 영역에 쌓입니다. 한 세션에서도 방향이 달라지면 여러 시안으로 나눠 비교할 수 있어요.",
  },
  {
    target: "idea-workspace",
    title: "시안의 구성",
    body: "각 시안은 Design Brief, Design Style, Mockup으로 구성됩니다. 먼저 에이전트에게 시안을 작성해달라고 요청하면 이 구조가 채워집니다.",
  },
  {
    target: "final-design",
    title: "Final Design",
    body: "목업을 만든 뒤에는 이 영역에서 최종 디자인을 선택합니다. 세션을 종료하기 전에 어떤 결과물을 최종안으로 남길지 정하는 단계예요.",
  },
  {
    target: "session-timer",
    fallbackTarget: "session-finish",
    title: "타이머",
    body: "상단 타이머로 남은 시간을 확인합니다.",
  },
  {
    target: "session-finish",
    title: "세션 종료",
    body: "작업을 마치면 세션 종료를 눌러 대화와 선택한 최종 디자인을 저장합니다. 목업이 있는데 Final Design을 선택하지 않으면 한 번 더 확인합니다.",
  },
  {
    target: "tutorial-button",
    fallbackTarget: "chat-panel",
    title: "튜토리얼 다시 보기",
    body: "작업 중 흐름이 헷갈리면 상단의 튜토리얼 버튼으로 이 안내를 다시 열 수 있습니다.",
  },
];

const IDEA_STEPS: TourStep[] = [
  {
    target: "mission-brief",
    title: "미션 설명",
    body: "왼쪽 상단에서 이번 미션의 목표, 대상 디바이스, 구체적인 요구사항을 확인합니다. 에이전트와 작업할 때 계속 기준이 되는 정보예요.",
  },
  {
    target: "content-panel",
    fallbackTarget: "mission-brief",
    title: "드래그해서 인용하기",
    body: "미션 설명, 레퍼런스, 시안 내용 등 이 왼쪽 패널 어디서든 텍스트를 마우스로 드래그해 선택하면 인용 버튼이 나타납니다. 누르면 그 문장이 채팅 입력에 텍스트 인용으로 담겨, 특정 부분을 콕 집어 에이전트에게 요청할 수 있어요.",
    demo: "drag-quote",
  },
  {
    target: "chat-panel",
    title: "채팅 공간",
    body: "오른쪽 채팅에서 에이전트에게 레퍼런스 탐색, 시안 작성, 디자인 스타일 정리, 목업 생성을 요청합니다. 선택한 레퍼런스나 화면 요소도 여기로 보낼 수 있어요.",
  },
  {
    target: "chat-command-palette",
    fallbackTarget: "chat-panel",
    title: "만들기 명령",
    body: "입력창의 / 버튼이나 키보드의 /로 새 시안, 디자인 스타일, 목업, 레퍼런스 검색 명령을 고를 수 있습니다. @를 입력하면 현재 세션에 이미 있는 시안과 산출물을 언급할 수 있어요.",
  },
  {
    target: "reference-section",
    title: "레퍼런스",
    body: "찾아온 레퍼런스는 여기 쌓입니다. 마음에 드는 레퍼런스를 선택한 뒤 채팅에 함께 보내면 시안과 디자인 스타일, 목업 방향에 반영할 수 있어요.",
  },
  {
    target: "idea-workspace",
    title: "시안 작업 공간",
    body: "에이전트가 만든 시안은 이 영역에 쌓입니다. 한 세션에서도 방향이 달라지면 여러 시안으로 나눠 비교할 수 있어요.",
  },
  {
    target: "idea-tabs",
    title: "여러 시안 비교",
    body: "시안 1, 시안 2처럼 탭으로 전환합니다. 완전히 다른 방향을 요청하면 기존 시안을 덮지 않고 새 시안으로 분리할 수 있습니다.",
  },
  {
    target: "idea-section-nav",
    title: "시안 안의 3가지",
    body: "각 시안은 Design Brief, Design Style, Mockup 세 영역으로 나뉩니다. 왼쪽 버튼으로 현재 시안의 작업 기준과 결과물을 빠르게 오갈 수 있어요.",
  },
  {
    target: "idea-brief",
    title: "Design Brief",
    body: "페이지 목적, 정보 구조, 필수 요소가 정리되는 곳입니다. 목업을 만들기 전에 에이전트와 함께 기준을 맞추는 영역이에요.",
  },
  {
    target: "idea-style",
    title: "Design Style",
    body: "색, 타이포, 스케일, 레이아웃 무드, 레퍼런스에서 얻은 시각 규칙이 저장됩니다.",
  },
  {
    target: "idea-mockup",
    title: "Mockup",
    body: "Stitch가 만든 화면이 여기에 표시됩니다. 편집 버튼을 누르면 화면 요소를 선택할 수 있고, 선택한 요소를 인용해 채팅으로 보내면 더 정확하게 수정 요청할 수 있어요.",
  },
  {
    target: "final-design",
    title: "Final Design",
    body: "여러 시안과 목업 중 최종으로 남길 화면을 선택하는 곳입니다. 선택한 결과는 세션 종료 후 리뷰에서 확인할 수 있어요.",
  },
  {
    target: "session-timer",
    fallbackTarget: "session-finish",
    title: "타이머",
    body: "상단 타이머로 남은 시간을 확인합니다.",
  },
  {
    target: "session-finish",
    title: "세션 종료",
    body: "작업을 마치면 세션 종료를 눌러 대화와 선택한 최종 디자인을 저장합니다. 목업이 있는데 Final Design을 선택하지 않으면 한 번 더 확인합니다.",
  },
  {
    target: "tutorial-button",
    fallbackTarget: "chat-panel",
    title: "튜토리얼 다시 보기",
    body: "작업 중 흐름이 헷갈리면 상단의 튜토리얼 버튼으로 이 안내를 다시 열 수 있습니다.",
  },
];

// Self-contained CSS demo for the drag-to-quote gesture: a selection highlight
// sweeps across a mock text line, then a "인용" pill pops up — looping. Teaches the
// interaction inside the popover without coupling to live DOM or external assets.
function DragQuoteDemo() {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-3 pb-4 pt-3">
      <div className="relative space-y-1.5">
        <div className="h-2 w-3/4 rounded bg-slate-200" />
        <div className="relative h-2.5 w-full overflow-visible rounded bg-slate-200">
          <div
            className="absolute inset-y-0 left-0 rounded bg-indigo-300/70"
            style={{ animation: "tourQuoteSweep 3s ease-in-out infinite" }}
          />
          <div
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-indigo-500"
            style={{ animation: "tourQuoteCursor 3s ease-in-out infinite" }}
          />
        </div>
        <div className="h-2 w-2/3 rounded bg-slate-200" />
        <div
          className="pointer-events-none absolute -bottom-3 right-1 rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white shadow"
          style={{ animation: "tourQuotePill 3s ease-in-out infinite" }}
        >
          + 인용
        </div>
      </div>
      <style>{`
        @keyframes tourQuoteSweep { 0%,8%{width:0%} 42%,100%{width:100%} }
        @keyframes tourQuoteCursor { 0%,8%{left:0%} 42%,100%{left:100%} }
        @keyframes tourQuotePill {
          0%,42%{opacity:0;transform:translateY(4px) scale(.9)}
          52%,90%{opacity:1;transform:translateY(0) scale(1)}
          100%{opacity:0;transform:translateY(4px) scale(.9)}
        }
      `}</style>
    </div>
  );
}

function findTourElement(target: string, fallbackTarget?: string) {
  return (
    document.querySelector<HTMLElement>(`[data-tour="${target}"]`) ??
    (fallbackTarget
      ? document.querySelector<HTMLElement>(`[data-tour="${fallbackTarget}"]`)
      : null) ??
    document.querySelector<HTMLElement>('[data-tour="idea-workspace"]')
  );
}

function getTargetRect(target: string, fallbackTarget?: string) {
  const element = findTourElement(target, fallbackTarget);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  return {
    top: Math.max(12, rect.top - 8),
    left: Math.max(12, rect.left - 8),
    width: Math.min(window.innerWidth - 24, rect.width + 16),
    height: Math.min(window.innerHeight - 24, rect.height + 16),
  };
}

function rectsEqual(a: Rect, b: Rect) {
  return (
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

function rectSignature(rect: Rect | null) {
  return rect
    ? `${Math.round(rect.top)}:${Math.round(rect.left)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
    : "none";
}

function popoverStyle(rect: Rect | null): CSSProperties {
  if (!rect) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const width = 360;
  const gap = 16;
  const rightSpace = window.innerWidth - (rect.left + rect.width);
  const leftSpace = rect.left;
  const fitsRight = rightSpace >= width + gap;
  const fitsLeft = leftSpace >= width + gap;
  const left = fitsRight
    ? rect.left + rect.width + gap
    : fitsLeft
      ? rect.left - width - gap
      : Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
  const top =
    fitsRight || fitsLeft
      ? Math.min(
          Math.max(16, rect.top + rect.height / 2 - 110),
          window.innerHeight - 260,
        )
      : rect.top + rect.height + gap < window.innerHeight - 240
        ? rect.top + rect.height + gap
        : Math.max(16, rect.top - 240);

  return { left, top, width };
}

export function SessionProductTour({
  open,
  hasIdeas,
  onOpenChange,
  onStepTargetChange,
}: SessionProductTourProps) {
  const steps = useMemo(
    () => (hasIdeas ? IDEA_STEPS : EMPTY_IDEA_STEPS),
    [hasIdeas],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [measuredRect, setMeasuredRect] = useState<MeasuredRect | null>(null);
  const currentStepIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[currentStepIndex];
  const stepKey = `${currentStepIndex}:${step.target}:${step.fallbackTarget ?? ""}`;
  const rect = measuredRect?.rect ?? null;
  const isLast = currentStepIndex >= steps.length - 1;

  const measure = useCallback(() => {
    if (!open) return;
    const nextRect = getTargetRect(step.target, step.fallbackTarget);
    setMeasuredRect((prev) => {
      if (!nextRect) return prev?.key === stepKey ? prev : null;
      if (prev && prev.key === stepKey && rectsEqual(prev.rect, nextRect)) {
        return prev;
      }
      return { key: stepKey, rect: nextRect };
    });
  }, [open, step.fallbackTarget, step.target, stepKey]);

  useEffect(() => {
    if (!open) return;
    onStepTargetChange?.(step.target);
  }, [onStepTargetChange, open, step.target]);

  // Scroll the target into view and re-measure until its rect settles. Two
  // async layout changes race on the first step: the parent collapses the
  // option panel (in response to onStepTargetChange) and scrollIntoView. If we
  // scroll before the panel collapses, the scroll is computed against the taller
  // pre-collapse layout and over-scrolls — pushing mission-brief partly above the
  // viewport so its clamped rect spills down over the reference section. So we
  // first poll until the layout settles, THEN scroll, THEN settle again.
  useEffect(() => {
    if (!open) return;

    let raf = 0;
    let scrolled = false;
    let stableFrames = 0;
    let prevSignature = "__init__";
    const start = performance.now();

    const tick = () => {
      measure();
      const signature = rectSignature(
        getTargetRect(step.target, step.fallbackTarget),
      );
      stableFrames = signature === prevSignature ? stableFrames + 1 : 0;
      prevSignature = signature;
      const elapsed = performance.now() - start;

      if (!scrolled) {
        // Wait for the post-collapse layout to settle before scrolling.
        if (stableFrames >= 2 || elapsed > 400) {
          findTourElement(step.target, step.fallbackTarget)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          scrolled = true;
          stableFrames = 0;
          prevSignature = "__scrolling__";
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      if (stableFrames >= 3 || elapsed > 1400) return;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [measure, open, step.fallbackTarget, step.target, stepKey]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, open]);

  if (!open) return null;

  const close = () => {
    setStepIndex(0);
    setMeasuredRect(null);
    onOpenChange(false);
  };

  return (
    <div className="fixed inset-0 z-80">
      {rect ? (
        <>
          <div
            className="fixed left-0 right-0 top-0 bg-slate-950/55"
            style={{ height: rect.top }}
          />
          <div
            className="fixed left-0 bg-slate-950/55"
            style={{ top: rect.top, width: rect.left, height: rect.height }}
          />
          <div
            className="fixed right-0 bg-slate-950/55"
            style={{
              top: rect.top,
              left: rect.left + rect.width,
              height: rect.height,
            }}
          />
          <div
            className="fixed bottom-0 left-0 right-0 bg-slate-950/55"
            style={{ top: rect.top + rect.height }}
          />
          <div
            className="pointer-events-none fixed rounded-2xl border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.02),0_24px_60px_rgba(15,23,42,0.22)]"
            style={rect}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-slate-950/55" />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-tour-title"
        className="fixed rounded-2xl bg-white text-slate-950 shadow-2xl shadow-slate-950/25 ring-1 ring-slate-900/10"
        style={popoverStyle(rect)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-slate-400">
              {currentStepIndex + 1} of {steps.length}
            </p>
            <h2 id="session-tour-title" className="mt-1 text-lg font-semibold">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="튜토리얼 닫기"
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="px-5 py-4">
          {step.demo === "drag-quote" && <DragQuoteDemo />}
          <p className="text-sm leading-6 text-slate-600">{step.body}</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={close}
            className="text-sm font-semibold text-slate-400 transition hover:text-slate-700"
          >
            건너뛰기
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStepIndex((index) => Math.max(0, index - 1));
              }}
              disabled={currentStepIndex === 0}
              className="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              onClick={() => {
                if (isLast) {
                  close();
                } else {
                  setStepIndex((index) =>
                    Math.min(steps.length - 1, index + 1),
                  );
                }
              }}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              {isLast ? "완료" : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
