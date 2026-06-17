"use client";

import { useEffect } from "react";
import { XIcon } from "lucide-react";

interface PromptViewerProps {
  turnId: string;
  rawPrompt: unknown;
  rawPromptSanitization?: unknown;
  rawResponseMeta?: unknown;
  onClose: () => void;
}

function stringifyPromptJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "null";
}

/** Admin-only modal that shows the sanitized raw prompt sent for a chat turn. */
export function PromptViewer({
  turnId,
  rawPrompt,
  rawPromptSanitization,
  rawResponseMeta,
  onClose,
}: PromptViewerProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-900/25">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Raw prompt</p>
            <p className="mt-0.5 text-xs text-slate-400">turn {turnId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="raw prompt 닫기"
          >
            <XIcon size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                Sanitized raw prompt
              </p>
              <pre className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                {stringifyPromptJson(rawPrompt)}
              </pre>
            </section>
            {rawPromptSanitization != null && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                  Sanitization
                </p>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
                  {stringifyPromptJson(rawPromptSanitization)}
                </pre>
              </section>
            )}
            {rawResponseMeta != null && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                  Response meta
                </p>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
                  {stringifyPromptJson(rawResponseMeta)}
                </pre>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
