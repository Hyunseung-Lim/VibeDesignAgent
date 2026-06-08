"use client";

import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { X } from "lucide-react";

export type ChatInputSelectedElement = {
  selector: string;
};

export type ChatInputReference = {
  id: string;
  title: string;
  imageUrl?: string;
};

type ChatInputProps = {
  readOnly: boolean;
  selectedElement: ChatInputSelectedElement | null;
  citedTexts: string[];
  selectedReferences: ChatInputReference[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  inputText: string;
  missionContextReady: boolean;
  generatingMockup: boolean;
  loading: boolean;
  generatingCurrentIdeaMockup: boolean;
  mockupOperation: string | null;
  onClearSelectedElement: () => void;
  onClearCitedTexts: () => void;
  onRemoveCitedText: (index: number) => void;
  onClearSelectedReferences: () => void;
  onRemoveSelectedReference: (id: string) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancelMockupGeneration: () => void;
  onCancelMessage: () => void;
  onSendMessage: () => void;
};

export function ChatInput({
  readOnly,
  selectedElement,
  citedTexts,
  selectedReferences,
  textareaRef,
  inputText,
  missionContextReady,
  generatingMockup,
  loading,
  generatingCurrentIdeaMockup,
  mockupOperation,
  onClearSelectedElement,
  onClearCitedTexts,
  onRemoveCitedText,
  onClearSelectedReferences,
  onRemoveSelectedReference,
  onInputChange,
  onKeyDown,
  onCancelMockupGeneration,
  onCancelMessage,
  onSendMessage,
}: ChatInputProps) {
  return (
    <div className="border-t border-slate-200 bg-white/95 p-4">
      {readOnly && (
        <div className="flex h-12 items-center justify-center rounded-2xl bg-amber-50 text-xs text-amber-600">
          읽기 전용 모드 — 채팅을 사용할 수 없습니다
        </div>
      )}

      {!readOnly && selectedElement && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-indigo-50 px-3 py-2 text-xs">
          <span className="font-medium text-indigo-600">
            선택된 요소:{" "}
            <code className="font-mono">{selectedElement.selector}</code>
          </span>
          <button
            type="button"
            onClick={onClearSelectedElement}
            className="text-indigo-400 hover:text-indigo-600"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {!readOnly && citedTexts.length > 0 && (
        <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-slate-600">
              텍스트 인용 ({citedTexts.length})
            </span>
            <button
              type="button"
              onClick={onClearCitedTexts}
              className="text-slate-400 hover:text-slate-600"
            >
              전체 해제
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {citedTexts.map((text, index) => (
              <span
                key={`${text}-${index}`}
                className="flex items-start gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600"
              >
                <span className="mt-0.5 shrink-0 text-slate-300">
                  &quot;
                </span>
                <span className="line-clamp-1 flex-1">{text}</span>
                <button
                  type="button"
                  onClick={() => onRemoveCitedText(index)}
                  className="shrink-0 text-slate-300 hover:text-slate-500"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {!readOnly && selectedReferences.length > 0 && (
        <div className="mb-2 rounded-xl bg-violet-50 px-3 py-2 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-violet-600">
              레퍼런스 인용 ({selectedReferences.length})
            </span>
            <button
              type="button"
              onClick={onClearSelectedReferences}
              className="text-violet-400 hover:text-violet-600"
            >
              전체 해제
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedReferences.map((reference) => (
              <span
                key={reference.id}
                className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-violet-700"
              >
                {reference.imageUrl && (
                  <img
                    src={reference.imageUrl}
                    alt=""
                    className="h-3.5 w-5 rounded object-cover"
                  />
                )}
                <span className="max-w-32 truncate">{reference.title}</span>
                <button
                  type="button"
                  onClick={() => onRemoveSelectedReference(reference.id)}
                  className="ml-0.5 text-violet-400 hover:text-violet-600"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="flex items-start gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            disabled={!missionContextReady}
            placeholder={
              missionContextReady
                ? "에이전트에게 메시지를 입력하세요..."
                : "미션 정보를 불러오는 중입니다..."
            }
            className="max-h-24 flex-1 resize-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
          {generatingMockup ? (
            <button
              type="button"
              onClick={onCancelMockupGeneration}
              className="flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
            >
              <span className="h-2 w-2 animate-spin rounded-full border border-white/60 border-t-transparent" />
              {generatingCurrentIdeaMockup
                ? `${mockupOperation === "edit" ? "수정" : "생성"} 취소`
                : "작업 취소"}
            </button>
          ) : loading ? (
            <button
              type="button"
              onClick={onCancelMessage}
              className="rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
            >
              중단
            </button>
          ) : (
            <button
              type="button"
              onClick={onSendMessage}
              disabled={!inputText.trim() || !missionContextReady}
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      )}
    </div>
  );
}
