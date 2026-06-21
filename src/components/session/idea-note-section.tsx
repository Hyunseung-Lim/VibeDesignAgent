"use client";

import type { RefObject } from "react";
import { ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";

type IdeaNoteSectionProps = {
  sectionRef: RefObject<HTMLElement | null>;
  description: string;
  expanded: boolean;
  onToggleExpanded: () => void;
};

export function IdeaNoteSection({
  sectionRef,
  description,
  expanded,
  onToggleExpanded,
}: IdeaNoteSectionProps) {
  return (
    <section
      ref={sectionRef}
      data-tour="idea-brief"
      className="space-y-3 scroll-mt-4"
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
        >
          <p className="text-base font-semibold text-slate-900">
            Design Brief <span className="text-slate-400">(디자인 브리프)</span>
          </p>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
            <ChevronDown
              size={14}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </span>
        </button>

        {expanded && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto border-t border-slate-100 px-5 py-4 text-sm text-slate-700">
          {description ? (
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="mb-1 text-base font-bold text-slate-900">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mb-1 mt-3 text-sm font-semibold text-slate-900">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mb-1 mt-2 text-sm font-medium text-slate-800">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-2 ml-4 list-decimal space-y-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="leading-relaxed">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-slate-900">
                    {children}
                  </strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-slate-600">{children}</em>
                ),
                code: ({ children }) => (
                  <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
                    {children}
                  </code>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="my-2 border-l-2 border-slate-300 pl-3 italic text-slate-500">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-3 border-slate-200" />,
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-500 underline underline-offset-2 hover:text-indigo-700"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {description}
            </ReactMarkdown>
          ) : (
            <p className="text-sm text-slate-400">
              아직 작성된 Design Brief가 없어요. 에이전트에게 시안 작성을
              요청해 보세요.
            </p>
          )}
          </div>
        )}
      </div>
    </section>
  );
}
