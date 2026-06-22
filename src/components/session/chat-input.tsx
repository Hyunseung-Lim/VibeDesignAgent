"use client";

import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { useState } from "react";
import { ArrowUp, ImagePlus, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  matchesComposerSearch,
  type ChatComposerCommand,
  type ChatComposerMention,
} from "@/lib/session/chat-composer";

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
  styleImage: { dataUrl: string; name?: string } | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  inputText: string;
  composerCommand: ChatComposerCommand | null;
  composerMention: ChatComposerMention | null;
  commandOptions: ChatComposerCommand[];
  mentionOptions: ChatComposerMention[];
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
  onAttachStyleImage: (file: File) => void;
  onClearStyleImage: () => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onInputTextChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancelMockupGeneration: () => void;
  onCancelMessage: () => void;
  onSendMessage: () => void;
  onSelectComposerCommand: (command: ChatComposerCommand) => void;
  onClearComposerCommand: () => void;
  onSelectComposerMention: (mention: ChatComposerMention) => void;
  onClearComposerMention: () => void;
};

type ComposerTrigger = {
  mode: "command" | "mention";
  start: number;
  end: number;
  query: string;
};

function findComposerTrigger(value: string, caret: number): ComposerTrigger | null {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)([/@])([^\s/@]*)$/);
  if (!match || match.index === undefined) return null;
  const prefixLength = match[1]?.length ?? 0;
  const start = match.index + prefixLength;
  return {
    mode: match[2] === "/" ? "command" : "mention",
    start,
    end: caret,
    query: match[3] ?? "",
  };
}

export function ChatInput({
  readOnly,
  selectedElement,
  citedTexts,
  selectedReferences,
  styleImage,
  textareaRef,
  inputText,
  composerCommand,
  composerMention,
  commandOptions,
  mentionOptions,
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
  onAttachStyleImage,
  onClearStyleImage,
  onInputChange,
  onInputTextChange,
  onKeyDown,
  onCancelMockupGeneration,
  onCancelMessage,
  onSendMessage,
  onSelectComposerCommand,
  onClearComposerCommand,
  onSelectComposerMention,
  onClearComposerMention,
}: ChatInputProps) {
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const filteredOptions = trigger
    ? trigger.mode === "command"
      ? commandOptions.filter((option) =>
          matchesComposerSearch(
            `${option.label} ${option.description}`,
            trigger.query,
          ),
        )
      : mentionOptions.filter((option) =>
          matchesComposerSearch(option.searchText, trigger.query),
        )
    : [];

  const closeSuggestions = () => {
    setTrigger(null);
    setActiveOptionIndex(0);
  };

  const selectOption = (index: number) => {
    if (!trigger) return;
    const option = filteredOptions[index];
    if (!option || ("disabledReason" in option && option.disabledReason)) return;
    const before = inputText.slice(0, trigger.start);
    const after = inputText.slice(trigger.end);
    onInputTextChange(`${before}${after}`.replace(/\s{2,}/g, " "));
    if (trigger.mode === "command") {
      onSelectComposerCommand(option as ChatComposerCommand);
    } else {
      onSelectComposerMention(option as ChatComposerMention);
    }
    closeSuggestions();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const openCommandPalette = () => {
    if (trigger?.mode === "command") {
      onInputTextChange(
        `${inputText.slice(0, trigger.start)}${inputText.slice(trigger.end)}`,
      );
      closeSuggestions();
      return;
    }
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? inputText.length;
    const separator = caret > 0 && !/\s/.test(inputText[caret - 1] ?? "") ? " " : "";
    const next = `${inputText.slice(0, caret)}${separator}/${inputText.slice(caret)}`;
    const start = caret + separator.length;
    onInputTextChange(next);
    setTrigger({ mode: "command", start, end: start + 1, query: "" });
    setActiveOptionIndex(0);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + 1, start + 1);
    }, 0);
  };
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

      {!readOnly && (composerCommand || composerMention) && (
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          {composerCommand && (
            <span className="flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 font-medium text-white">
              {composerCommand.label}
              <button
                type="button"
                onClick={onClearComposerCommand}
                aria-label={`${composerCommand.label} 해제`}
                className="text-white/60 hover:text-white"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {composerMention && (
            <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">
              @{composerMention.label}
              <button
                type="button"
                onClick={onClearComposerMention}
                aria-label={`${composerMention.label} 언급 해제`}
                className="text-indigo-400 hover:text-indigo-700"
              >
                <X size={12} />
              </button>
            </span>
          )}
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

      {!readOnly && styleImage && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
          <span className="flex items-center gap-2 font-medium text-slate-700">
            <img
              src={styleImage.dataUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded object-cover"
            />
            <span className="max-w-40 truncate">
              {styleImage.name || "스타일 참고 이미지"}
            </span>
          </span>
          <button
            type="button"
            onClick={onClearStyleImage}
            className="text-slate-400 hover:text-slate-600"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {!readOnly && (
        <div className="relative flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3 transition-colors focus-within:border-slate-400">
          {trigger && (
            <>
              <button
                type="button"
                aria-label="자동완성 닫기"
                onClick={closeSuggestions}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-[calc(100%-1rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {trigger.mode === "command"
                    ? "새로 만들기"
                    : "기존 항목 언급"}
                </p>
                {filteredOptions.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {filteredOptions.map((option, index) => {
                      const disabledReason =
                        "disabledReason" in option
                          ? option.disabledReason
                          : undefined;
                      return (
                        <button
                          key={
                            "id" in option && trigger.mode === "command"
                              ? option.id
                              : `${(option as ChatComposerMention).kind}-${(option as ChatComposerMention).ideaId}-${(option as ChatComposerMention).artifactId ?? "idea"}`
                          }
                          type="button"
                          disabled={Boolean(disabledReason)}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveOptionIndex(index)}
                          onClick={() => selectOption(index)}
                          className={cn(
                            "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left transition",
                            index === activeOptionIndex &&
                              !disabledReason &&
                              "bg-indigo-50",
                            disabledReason
                              ? "cursor-not-allowed text-slate-300"
                              : "text-slate-700 hover:bg-indigo-50",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {trigger.mode === "command"
                                ? (option as ChatComposerCommand).label
                                : (option as ChatComposerMention).label}
                            </span>
                            <span className="block truncate text-[11px] text-slate-400">
                              {trigger.mode === "command"
                                ? disabledReason ||
                                  (option as ChatComposerCommand).description
                                : (option as ChatComposerMention).kind === "idea"
                                  ? "시안"
                                  : "기존 산출물"}
                            </span>
                          </span>
                          {trigger.mode === "mention" &&
                            (option as ChatComposerMention).ideaId ===
                              mentionOptions[0]?.ideaId && (
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                                현재 시안
                              </span>
                            )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-3 py-4 text-center text-xs text-slate-400">
                    {trigger.mode === "mention"
                      ? "일치하는 기존 산출물이 없습니다. /로 새로 만들 수 있어요."
                      : "일치하는 명령이 없습니다."}
                  </p>
                )}
              </div>
            </>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(event) => {
              onInputChange(event);
              const caret = event.currentTarget.selectionStart;
              const nextTrigger = findComposerTrigger(
                event.currentTarget.value,
                caret,
              );
              setTrigger(nextTrigger);
              setActiveOptionIndex(0);
            }}
            onKeyDown={(event) => {
              if (
                trigger &&
                filteredOptions.length > 0 &&
                !event.nativeEvent.isComposing
              ) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveOptionIndex((index) =>
                    (index + 1) % filteredOptions.length,
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveOptionIndex((index) =>
                    (index - 1 + filteredOptions.length) %
                    filteredOptions.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  selectOption(activeOptionIndex);
                  return;
                }
              }
              if (trigger && event.key === "Escape") {
                event.preventDefault();
                closeSuggestions();
                return;
              }
              onKeyDown(event);
            }}
            onPaste={(event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              for (let i = 0; i < items.length; i += 1) {
                const item = items[i];
                if (item.kind === "file" && item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) {
                    event.preventDefault();
                    onAttachStyleImage(file);
                  }
                  break;
                }
              }
            }}
            disabled={!missionContextReady}
            placeholder={
              missionContextReady
                ? "/로 만들기 · @로 기존 항목 언급"
                : "미션 정보를 불러오는 중입니다..."
            }
            className="max-h-40 w-full resize-none bg-transparent px-1 text-sm text-slate-700 outline-none focus-visible:outline-none placeholder:text-slate-400"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                data-tour="chat-command-palette"
                title="새로 만들기 명령"
                onClick={openCommandPalette}
                disabled={!missionContextReady}
                className={cn(
                  "rounded-full font-mono text-lg text-slate-400 hover:text-slate-600",
                  trigger?.mode === "command" &&
                    "text-indigo-600 hover:bg-indigo-50 hover:text-indigo-600",
                )}
              >
                /
              </Button>
              <label
                title="스타일 참고 이미지 첨부 (이 이미지처럼 목업 생성)"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon" }),
                  "rounded-full",
                  styleImage
                    ? "text-slate-700"
                    : "text-slate-400 hover:text-slate-600",
                  !missionContextReady && "pointer-events-none opacity-40",
                )}
              >
                <ImagePlus size={18} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={!missionContextReady}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onAttachStyleImage(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {generatingMockup ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={onCancelMockupGeneration}
                className="rounded-full"
              >
                <Spinner className="size-3" />
                {generatingCurrentIdeaMockup
                  ? `${mockupOperation === "edit" ? "수정" : "생성"} 취소`
                  : "작업 취소"}
              </Button>
            ) : loading ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={onCancelMessage}
                className="rounded-full"
              >
                중단
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={onSendMessage}
                disabled={
                  (!inputText.trim() && !composerCommand) ||
                  !missionContextReady
                }
                aria-label="보내기"
                className="rounded-full"
              >
                <ArrowUp size={18} />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
