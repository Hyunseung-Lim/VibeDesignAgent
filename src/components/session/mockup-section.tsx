"use client";

import type { ReactNode, RefObject } from "react";
import { MockupCanvasToolbar } from "@/components/session/mockup-canvas-toolbar";
import { Spinner } from "@/components/ui/spinner";

export type MockupSectionSelectedElement = {
  selector: string;
};

export type MockupSectionArtboard = {
  html: string;
  label: string;
};

type MockupSectionProps = {
  sectionRef: RefObject<HTMLElement | null>;
  hasArtboards: boolean;
  editMode: boolean;
  selectedElement: MockupSectionSelectedElement | null;
  canvasScale: number;
  activeArtboard: MockupSectionArtboard | null | undefined;
  shouldRenderCanvas: boolean;
  expanded: boolean;
  generating: boolean;
  mockupOperation: string | null;
  readOnly: boolean;
  canvas: ReactNode;
  onToggleEditMode: () => void;
  onClearSelectedElement: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onExport: () => void;
  onExpand: () => void;
  onCancelGeneration: () => void;
};

export function MockupSection({
  sectionRef,
  hasArtboards,
  editMode,
  selectedElement,
  canvasScale,
  activeArtboard,
  shouldRenderCanvas,
  expanded,
  generating,
  mockupOperation,
  readOnly,
  canvas,
  onToggleEditMode,
  onClearSelectedElement,
  onFit,
  onZoomIn,
  onZoomOut,
  onExport,
  onExpand,
  onCancelGeneration,
}: MockupSectionProps) {
  return (
    <section
      ref={sectionRef}
      data-tour="idea-mockup"
      className="space-y-3 scroll-mt-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold text-slate-900">Mockup</p>
        {hasArtboards && (
          <MockupCanvasToolbar
            editMode={editMode}
            selectedElement={selectedElement}
            canvasScale={canvasScale}
            activeArtboard={activeArtboard}
            onToggleEditMode={onToggleEditMode}
            onClearSelectedElement={onClearSelectedElement}
            onFit={onFit}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onExport={onExport}
            onExpand={onExpand}
          />
        )}
      </div>

      {shouldRenderCanvas ? (
        expanded ? (
          <div className="flex h-64 items-center justify-center rounded-2xl bg-[#1a1a1a] text-xs text-white/40">
            확대 보기 중...
          </div>
        ) : (
          canvas
        )
      ) : (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-400">
          {generating ? (
            <>
              <Spinner className="size-7 text-slate-500" />
              <p className="text-slate-500">
                Stitch로 목업 {mockupOperation === "edit" ? "수정" : "생성"} 중...
              </p>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onCancelGeneration}
                  className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
                >
                  취소
                </button>
              )}
            </>
          ) : (
            <p>{'에이전트에게 "목업 만들어줘"라고 말하면 여기에 표시됩니다.'}</p>
          )}
        </div>
      )}
    </section>
  );
}
