"use client";

import type { RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";

type IdeaNoteSectionProps = {
  sectionRef: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  expanded: boolean;
  onToggleExpanded: () => void;
};

export function IdeaNoteSection({
  sectionRef,
  title,
  description,
  expanded,
  onToggleExpanded,
}: IdeaNoteSectionProps) {
  return (
    <section ref={sectionRef} className="space-y-4 scroll-mt-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {title}
          </p>
          <p className="text-base font-semibold text-slate-900">
            Design Brief
          </p>
        </div>
      </div>

      <div className="relative rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div
          className={`space-y-2 px-5 pb-14 pt-5 text-sm text-slate-700 ${
            expanded ? "max-h-[60vh] overflow-y-auto" : "max-h-64 overflow-hidden"
          }`}
        >
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
            <p className="text-slate-400">
              에이전트가 아직 Design Brief를 작성하지 않았습니다.
            </p>
          )}
        </div>

        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-white via-white to-transparent" />
        )}
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm transition hover:bg-slate-50"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? "접기" : "펼치기"}
          </button>
        </div>
      </div>
    </section>
  );
}
