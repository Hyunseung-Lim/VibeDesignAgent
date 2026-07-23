"use client";

import type { MutableRefObject, ReactNode } from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
  ArrowUp,
  FileText,
  ImageIcon,
  ImagePlus,
  LinkIcon,
  MousePointer2,
  X,
} from "lucide-react";
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
  tag?: string;
};

export type ChatInputHandle = {
  focus: () => void;
};

type ChatInputProps = {
  readOnly: boolean;
  selectedElements: ChatInputSelectedElement[];
  citedTexts: string[];
  selectedReferences: ChatInputReference[];
  styleImages: { dataUrl: string; name?: string }[];
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
  onRemoveStyleImage: (index: number) => void;
  onInputTextChange: (value: string) => void;
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

function commandToken(command: ChatComposerCommand) {
  return command.label;
}

function mentionToken(mention: ChatComposerMention) {
  return `@${mention.label}`;
}

type ComposerAttachmentProps = {
  tone?: "slate" | "indigo" | "violet";
  icon?: ReactNode;
  imageUrl?: string;
  title: string;
  description?: string;
  onRemove: () => void;
};

function ComposerAttachment({
  tone = "slate",
  icon,
  imageUrl,
  title,
  description,
  onRemove,
}: ComposerAttachmentProps) {
  const toneClass =
    tone === "indigo"
      ? "border-indigo-100 bg-indigo-50/70 text-indigo-700"
      : tone === "violet"
        ? "border-violet-100 bg-violet-50/70 text-violet-700"
        : "border-slate-200 bg-white text-slate-700";
  const mediaClass =
    tone === "indigo"
      ? "bg-indigo-100 text-indigo-600"
      : tone === "violet"
        ? "bg-violet-100 text-violet-600"
        : "bg-slate-100 text-slate-500";

  return (
    <div
      className={cn(
        "group/attachment flex min-w-48 max-w-64 items-center gap-2 rounded-lg border px-2 py-1.5 shadow-sm",
        toneClass,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="size-8 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            mediaClass,
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold leading-4">
          {title}
        </span>
        {description ? (
          <span className="block truncate text-[11px] leading-4 opacity-70">
            {description}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex size-6 shrink-0 items-center justify-center rounded-md opacity-55 transition hover:bg-black/5 hover:opacity-100"
        aria-label={`${title} 제거`}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

type TokenSegment = {
  text: string;
  kind: "plain" | "command" | "mention";
};

const COMMAND_TOKEN_STYLE = "color:#4338ca;font-weight:700;";
const MENTION_TOKEN_STYLE = "color:#0369a1;font-weight:700;";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenSegments(
  value: string,
  commandOptions: ChatComposerCommand[],
  mentionOptions: ChatComposerMention[],
): TokenSegment[] {
  if (!value) return [];
  const tokens = [
    ...commandOptions.map((command) => ({
      text: commandToken(command),
      kind: "command" as const,
    })),
    ...mentionOptions.map((mention) => ({
      text: mentionToken(mention),
      kind: "mention" as const,
    })),
  ]
    .filter((token) => token.text)
    .sort((a, b) => b.text.length - a.text.length);
  if (tokens.length === 0) return [{ text: value, kind: "plain" }];

  const pattern = new RegExp(tokens.map((token) => escapeRegExp(token.text)).join("|"), "g");
  const segments: TokenSegment[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const matchText = match[0];
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({ text: value.slice(lastIndex, matchIndex), kind: "plain" });
    }
    const token = tokens.find((item) => item.text === matchText);
    segments.push({ text: matchText, kind: token?.kind ?? "plain" });
    lastIndex = matchIndex + matchText.length;
  }
  if (lastIndex < value.length) {
    segments.push({ text: value.slice(lastIndex), kind: "plain" });
  }
  return segments;
}

function segmentStyle(kind: TokenSegment["kind"]) {
  if (kind === "command") return COMMAND_TOKEN_STYLE;
  if (kind === "mention") return MENTION_TOKEN_STYLE;
  return "";
}

// Shift+Enter inserts LineBreakNodes, so every helper that walks the
// editor's inline content must treat a line break as a 1-character item —
// counting only text nodes drops newlines from offsets and comparisons,
// which snapped the caret back before the line break after Shift+Enter.
type ExpectedInline =
  | { type: "text"; text: string; style: string }
  | { type: "linebreak" };

function expectedInlineNodes(segments: TokenSegment[]): ExpectedInline[] {
  const expected: ExpectedInline[] = [];
  for (const segment of segments) {
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) expected.push({ type: "linebreak" });
      if (part)
        expected.push({
          type: "text",
          text: part,
          style: segmentStyle(segment.kind),
        });
    });
  }
  return expected;
}

function inlineNodeSize(node: LexicalNode) {
  if ($isLineBreakNode(node)) return 1;
  if ($isTextNode(node)) return node.getTextContentSize();
  return 0;
}

function editorSegmentsMatch(segments: TokenSegment[]) {
  const blocks = $getRoot().getChildren();
  if (blocks.length !== 1) return false;
  const block = blocks[0];
  if (!$isElementNode(block)) return false;
  const children = block.getChildren();
  const expected = expectedInlineNodes(segments);
  if (expected.length === 0) {
    return (
      children.length === 1 &&
      $isTextNode(children[0]) &&
      children[0].getTextContent() === ""
    );
  }
  if (children.length !== expected.length) return false;
  return children.every((child, index) => {
    const item = expected[index];
    if (item.type === "linebreak") return $isLineBreakNode(child);
    return (
      $isTextNode(child) &&
      child.getTextContent() === item.text &&
      child.getStyle() === item.style
    );
  });
}

function currentSelectionOffset() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  let offset = 0;
  for (const block of $getRoot().getChildren()) {
    if (!$isElementNode(block)) continue;
    const children = block.getChildren();
    // Element-point selection (e.g. the caret right after a line break):
    // anchor.offset is a child index inside the block.
    if (anchor.type === "element" && block.getKey() === anchorNode.getKey()) {
      for (let i = 0; i < Math.min(anchor.offset, children.length); i += 1) {
        offset += inlineNodeSize(children[i]);
      }
      return offset;
    }
    for (const child of children) {
      if (child.getKey() === anchorNode.getKey()) {
        return offset + anchor.offset;
      }
      offset += inlineNodeSize(child);
    }
  }
  return offset;
}

function selectTextOffset(offset: number) {
  const root = $getRoot();
  const block = root.getFirstChild();
  if (!$isElementNode(block)) {
    root.selectEnd();
    return;
  }
  let remaining = Math.max(0, offset);
  const children = block.getChildren();
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if ($isTextNode(child)) {
      const size = child.getTextContentSize();
      if (remaining <= size) {
        child.select(remaining, remaining);
        return;
      }
      remaining -= size;
    } else if ($isLineBreakNode(child)) {
      if (remaining === 0) {
        block.select(i, i);
        return;
      }
      remaining -= 1;
      if (remaining === 0) {
        // Right after this line break. If a text node follows, the loop
        // places the caret at its offset 0; otherwise use an element point.
        const next = children[i + 1];
        if (!next || !$isTextNode(next)) {
          block.select(i + 1, i + 1);
          return;
        }
      }
    }
  }
  block.selectEnd();
}

function editorSelectionOffset(editor: LexicalEditor, fallback: number) {
  let offset = fallback;
  editor.getEditorState().read(() => {
    offset = currentSelectionOffset() ?? fallback;
  });
  return offset;
}

function replaceEditorText(
  value: string,
  commandOptions: ChatComposerCommand[],
  mentionOptions: ChatComposerMention[],
  selectionOffset: number | null,
) {
  const root = $getRoot();
  const segments = tokenSegments(value, commandOptions, mentionOptions);
  if (editorSegmentsMatch(segments)) return;
  root.clear();
  const paragraph = $createParagraphNode();
  const expected = expectedInlineNodes(segments);
  if (expected.length === 0) {
    paragraph.append($createTextNode(""));
  } else {
    for (const item of expected) {
      if (item.type === "linebreak") {
        paragraph.append($createLineBreakNode());
        continue;
      }
      const node = $createTextNode(item.text);
      if (item.style) node.setStyle(item.style);
      paragraph.append(node);
    }
  }
  root.append(paragraph);
  if (selectionOffset != null) selectTextOffset(selectionOffset);
}

function updateTriggerFromEditor(
  text: string,
  setTrigger: (trigger: ComposerTrigger | null) => void,
  setActiveOptionIndex: (index: number | ((index: number) => number)) => void,
) {
  const offset = currentSelectionOffset();
  const nextTrigger = offset == null ? null : findComposerTrigger(text, offset);
  setTrigger(nextTrigger);
  setActiveOptionIndex(0);
}

type LexicalChatEditorProps = {
  value: string;
  placeholder: string;
  disabled: boolean;
  commandOptions: ChatComposerCommand[];
  mentionOptions: ChatComposerMention[];
  trigger: ComposerTrigger | null;
  filteredOptionsLength: number;
  pendingSelectionOffsetRef: MutableRefObject<number | null>;
  editorRef: MutableRefObject<LexicalEditor | null>;
  onTextChange: (value: string) => void;
  onTriggerChange: (trigger: ComposerTrigger | null) => void;
  onActiveOptionIndexChange: (index: number | ((index: number) => number)) => void;
  onSelectActiveOption: () => void;
  onCloseSuggestions: () => void;
  onAttachStyleImage: (file: File) => void;
  onSendMessage: () => void;
};

function LexicalChatEditor({
  value,
  placeholder,
  disabled,
  commandOptions,
  mentionOptions,
  trigger,
  filteredOptionsLength,
  pendingSelectionOffsetRef,
  editorRef,
  onTextChange,
  onTriggerChange,
  onActiveOptionIndexChange,
  onSelectActiveOption,
  onCloseSuggestions,
  onAttachStyleImage,
  onSendMessage,
}: LexicalChatEditorProps) {
  const [editor] = useLexicalComposerContext();
  const composingRef = useRef(false);
  const lastTextRef = useRef(value);

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor, editorRef]);

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (composingRef.current) return;
    editor.update(() => {
      const selectionOffset =
        pendingSelectionOffsetRef.current ?? currentSelectionOffset();
      pendingSelectionOffsetRef.current = null;
      replaceEditorText(value, commandOptions, mentionOptions, selectionOffset);
    });
  }, [commandOptions, editor, mentionOptions, pendingSelectionOffsetRef, value]);

  useEffect(
    () =>
      editor.registerCommand<KeyboardEvent>(
        KEY_DOWN_COMMAND,
        (event) => {
          if (
            trigger &&
            filteredOptionsLength > 0 &&
            !event.isComposing
          ) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onActiveOptionIndexChange(
                (index) => (index + 1) % filteredOptionsLength,
              );
              return true;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onActiveOptionIndexChange(
                (index) =>
                  (index - 1 + filteredOptionsLength) % filteredOptionsLength,
              );
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              onSelectActiveOption();
              return true;
            }
          }
          if (trigger && event.key === "Escape") {
            event.preventDefault();
            onCloseSuggestions();
            return true;
          }
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            onSendMessage();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [
      editor,
      filteredOptionsLength,
      onActiveOptionIndexChange,
      onCloseSuggestions,
      onSelectActiveOption,
      onSendMessage,
      trigger,
    ],
  );

  useEffect(
    () =>
      editor.registerCommand<ClipboardEvent>(
        PASTE_COMMAND,
        (event) => {
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            if (item.kind === "file" && item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) {
                event.preventDefault();
                onAttachStyleImage(file);
                return true;
              }
            }
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, onAttachStyleImage],
  );

  return (
    <>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="채팅 입력"
            className={cn(
              "max-h-40 min-h-6 w-full overflow-y-auto whitespace-pre-wrap break-words px-1 text-sm leading-6 text-slate-700 caret-slate-700 outline-none selection:bg-sky-200/50 empty:before:pointer-events-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]",
              disabled && "pointer-events-none opacity-60",
            )}
            data-placeholder={placeholder}
            spellCheck={false}
            autoCorrect="off"
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
              editor.update(() => {
                const text = $getRoot().getTextContent();
                updateTriggerFromEditor(
                  text,
                  onTriggerChange,
                  onActiveOptionIndexChange,
                );
                replaceEditorText(
                  text,
                  commandOptions,
                  mentionOptions,
                  currentSelectionOffset(),
                );
              });
            }}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin
        onChange={(editorState) => {
          editorState.read(() => {
            const text = $getRoot().getTextContent();
            if (text !== lastTextRef.current) {
              lastTextRef.current = text;
              onTextChange(text);
            }
            if (!composingRef.current) {
              updateTriggerFromEditor(
                text,
                onTriggerChange,
                onActiveOptionIndexChange,
              );
            }
          });
        }}
      />
    </>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
  readOnly,
  selectedElements,
  citedTexts,
  selectedReferences,
  styleImages,
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
  onRemoveStyleImage,
  onInputTextChange,
  onCancelMockupGeneration,
  onCancelMessage,
  onSendMessage,
  onSelectComposerCommand,
  onClearComposerCommand,
  onSelectComposerMention,
  onClearComposerMention,
},
  ref,
) {
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const editorRef = useRef<LexicalEditor | null>(null);
  const pendingSelectionOffsetRef = useRef<number | null>(null);
  const lexicalConfig = useMemo(
    () => ({
      namespace: "VdaChatInput",
      onError(error: Error) {
        throw error;
      },
    }),
    [],
  );
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
  const hasAttachments =
    selectedElements.length > 0 ||
    citedTexts.length > 0 ||
    selectedReferences.length > 0 ||
    styleImages.length > 0;

  const closeSuggestions = () => {
    setTrigger(null);
    setActiveOptionIndex(0);
  };

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus();
      },
    }),
    [],
  );

  const selectOption = (index: number) => {
    if (!trigger) return;
    const option = filteredOptions[index];
    if (!option || ("disabledReason" in option && option.disabledReason)) return;
    const before = inputText.slice(0, trigger.start);
    const after = inputText.slice(trigger.end);
    const token =
      trigger.mode === "command"
        ? commandToken(option as ChatComposerCommand)
        : mentionToken(option as ChatComposerMention);
    const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
    const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
    const next = `${before}${needsSpaceBefore ? " " : ""}${token}${
      needsSpaceAfter ? " " : ""
    }${after}`.replace(/\s{2,}/g, " ");
    onInputTextChange(next);
    if (trigger.mode === "command") {
      onSelectComposerCommand(option as ChatComposerCommand);
    } else {
      onSelectComposerMention(option as ChatComposerMention);
    }
    const caret = Math.min(
      before.length + (needsSpaceBefore ? 1 : 0) + token.length + 1,
      next.length,
    );
    pendingSelectionOffsetRef.current = caret;
    closeSuggestions();
    window.setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
  };

  const openCommandPalette = () => {
    if (trigger?.mode === "command") {
      onInputTextChange(
        `${inputText.slice(0, trigger.start)}${inputText.slice(trigger.end)}`,
      );
      pendingSelectionOffsetRef.current = trigger.start;
      closeSuggestions();
      window.setTimeout(() => editorRef.current?.focus(), 0);
      return;
    }
    const caret = editorRef.current
      ? editorSelectionOffset(editorRef.current, inputText.length)
      : inputText.length;
    const separator = caret > 0 && !/\s/.test(inputText[caret - 1] ?? "") ? " " : "";
    const next = `${inputText.slice(0, caret)}${separator}/${inputText.slice(caret)}`;
    const start = caret + separator.length;
    onInputTextChange(next);
    pendingSelectionOffsetRef.current = start + 1;
    setTrigger({ mode: "command", start, end: start + 1, query: "" });
    setActiveOptionIndex(0);
    window.setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
  };
  return (
    <div className="shrink-0 border-t border-slate-200 bg-white/95 p-4">
      {readOnly && (
        <div className="flex h-12 items-center justify-center rounded-2xl bg-amber-50 text-xs text-amber-600">
          읽기 전용 모드 — 채팅을 사용할 수 없습니다
        </div>
      )}

      {!readOnly && hasAttachments && (
        <div className="mb-2 overflow-x-auto pb-1">
          <div className="flex w-max items-center gap-2">
            {selectedElements.map((element, index) => (
              <ComposerAttachment
                key={`${element.selector}-${index}`}
                tone="indigo"
                icon={<MousePointer2 className="size-4" />}
                title={
                  selectedElements.length > 1
                    ? `선택된 요소 ${index + 1}/${selectedElements.length}`
                    : "선택된 요소"
                }
                description={element.selector}
                onRemove={onClearSelectedElement}
              />
            ))}
            {citedTexts.map((text, index) => (
              <ComposerAttachment
                key={`${text}-${index}`}
                icon={<FileText className="size-4" />}
                title="텍스트 인용"
                description={text}
                onRemove={() => onRemoveCitedText(index)}
              />
            ))}
            {selectedReferences.map((reference) => (
              <ComposerAttachment
                key={reference.id}
                tone="violet"
                icon={<LinkIcon className="size-4" />}
                imageUrl={reference.imageUrl}
                title={reference.tag === "미션 이미지" ? "이미지 인용" : "레퍼런스 인용"}
                description={reference.title}
                onRemove={() => onRemoveSelectedReference(reference.id)}
              />
            ))}
            {styleImages.map((styleImage, index) => (
              <ComposerAttachment
                key={`${index}-${styleImage.name ?? "image"}`}
                imageUrl={styleImage.dataUrl}
                icon={<ImageIcon className="size-4" />}
                title="스타일 참고 이미지"
                description={styleImage.name || "첨부 이미지"}
                onRemove={() => onRemoveStyleImage(index)}
              />
            ))}
            {citedTexts.length > 1 && (
              <button
                type="button"
                onClick={onClearCitedTexts}
                className="h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
              >
                텍스트 전체 해제
              </button>
            )}
            {selectedReferences.length > 1 && (
              <button
                type="button"
                onClick={onClearSelectedReferences}
                className="h-9 shrink-0 rounded-lg border border-violet-100 bg-violet-50/70 px-2.5 text-[11px] font-semibold text-violet-400 transition hover:bg-violet-50 hover:text-violet-600"
              >
                레퍼런스 전체 해제
              </button>
            )}
          </div>
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
          <div className="relative">
            <LexicalComposer initialConfig={lexicalConfig}>
              <LexicalChatEditor
                value={inputText}
                placeholder={
                  missionContextReady
                    ? "/로 만들기 · @로 기존 항목 언급"
                    : "미션 정보를 불러오는 중입니다..."
                }
                disabled={!missionContextReady}
                commandOptions={commandOptions}
                mentionOptions={mentionOptions}
                trigger={trigger}
                filteredOptionsLength={filteredOptions.length}
                pendingSelectionOffsetRef={pendingSelectionOffsetRef}
                editorRef={editorRef}
                onTextChange={(value) => {
                  onInputTextChange(value);
                  if (composerCommand && !value.includes(commandToken(composerCommand))) {
                    onClearComposerCommand();
                  }
                  if (composerMention && !value.includes(mentionToken(composerMention))) {
                    onClearComposerMention();
                  }
                }}
                onTriggerChange={setTrigger}
                onActiveOptionIndexChange={setActiveOptionIndex}
                onSelectActiveOption={() => selectOption(activeOptionIndex)}
                onCloseSuggestions={closeSuggestions}
                onAttachStyleImage={onAttachStyleImage}
                onSendMessage={onSendMessage}
              />
            </LexicalComposer>
          </div>
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
                title="스타일 참고 이미지 첨부 (최대 3장, 이 이미지처럼 목업 생성)"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon" }),
                  "rounded-full",
                  styleImages.length > 0
                    ? "text-slate-700"
                    : "text-slate-400 hover:text-slate-600",
                  !missionContextReady && "pointer-events-none opacity-40",
                )}
              >
                <ImagePlus size={18} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  disabled={!missionContextReady}
                  onChange={(event) => {
                    // 장수 제한/크기 검증은 onAttachStyleImage가 수행한다.
                    for (const file of Array.from(event.target.files ?? [])) {
                      onAttachStyleImage(file);
                    }
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
});
