"use client";

import type { RefObject } from "react";

type FinalDesignDevice = "desktop" | "mobile";

export type FinalDesignIdea = {
  id: string;
  title: string;
};

export type FinalDesignArtboard = {
  id: string;
  html: string;
  label: string;
  createdAt?: number;
  device: FinalDesignDevice;
  ideaId: string;
};

type FinalDesignSelectorProps = {
  sectionRef: RefObject<HTMLDivElement | null>;
  ideas: FinalDesignIdea[];
  artboards: FinalDesignArtboard[];
  finalArtboardId: string | null;
  readOnly: boolean;
  onSelect: (artboard: FinalDesignArtboard, idea: FinalDesignIdea) => void;
};

const DEVICE_SIZE: Record<FinalDesignDevice, { width: number; height: number }> =
  {
    desktop: { width: 1280, height: 900 },
    mobile: { width: 390, height: 844 },
  };

export function FinalDesignSelector({
  sectionRef,
  ideas,
  artboards,
  finalArtboardId,
  readOnly,
  onSelect,
}: FinalDesignSelectorProps) {
  return (
    <div
      ref={sectionRef}
      data-tour="final-design"
      className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6"
    >
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold text-slate-900">Final Design</p>
        {finalArtboardId && (
          <span className="text-xs font-medium text-emerald-600">선택됨</span>
        )}
      </div>

      {artboards.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
          목업을 생성하면 여기서 최종 디자인을 선택할 수 있습니다.
        </div>
      ) : (
        <div className="space-y-4">
          {ideas.map((idea) => {
            const boards = artboards.filter((board) => board.ideaId === idea.id);
            if (boards.length === 0) return null;

            return (
              <div key={idea.id} className="space-y-2">
                {ideas.length > 1 && (
                  <p className="text-xs font-medium text-slate-500">
                    {idea.title}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  {boards.map((board) => {
                    const isFinal = board.id === finalArtboardId;
                    const { width, height } = DEVICE_SIZE[board.device];
                    const thumbH = board.device === "mobile" ? 200 : 160;
                    const scale = thumbH / height;
                    const thumbW = Math.round(width * scale);

                    return (
                      <button
                        key={board.id}
                        type="button"
                        onClick={() => {
                          if (!readOnly) onSelect(board, idea);
                        }}
                        disabled={readOnly}
                        className={`relative overflow-hidden rounded-xl border-2 transition ${
                          isFinal
                            ? "border-emerald-500 ring-2 ring-emerald-200"
                            : "border-slate-200 hover:border-slate-400"
                        } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                        style={{ width: thumbW, height: thumbH }}
                        title={board.label}
                      >
                        {board.html ? (
                          <iframe
                            srcDoc={board.html}
                            sandbox="allow-scripts allow-same-origin"
                            scrolling="no"
                            className="pointer-events-none origin-top-left"
                            style={{
                              width,
                              height,
                              transform: `scale(${scale})`,
                              transformOrigin: "top left",
                            }}
                            title={board.label}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-slate-50 text-xs text-slate-400">
                            로딩 중...
                          </div>
                        )}

                        <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/40 to-transparent px-2 py-1.5">
                          <p className="truncate text-left text-xs text-white">
                            {board.label}
                          </p>
                        </div>

                        {isFinal && (
                          <div className="absolute left-0 right-0 top-2 flex justify-center">
                            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white shadow">
                              최종 선택
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
