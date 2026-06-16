"use client";

import { Monitor, Smartphone } from "lucide-react";
import ReactMarkdown from "react-markdown";

type MissionBriefDevice = "desktop" | "mobile";

export type MissionBriefOption = {
  title: string;
  description?: string;
  content?: string;
};

type MissionBriefSectionProps = {
  title: string;
  brief: string;
  option: MissionBriefOption | null;
  device: MissionBriefDevice;
  optionExpanded: boolean;
  onToggleOption: () => void;
};

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-1 mt-3 text-base font-bold text-slate-900 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-1 mt-3 text-sm font-semibold text-slate-900 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 mt-2 text-sm font-medium text-slate-800">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
      {children}
    </code>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-slate-300 pl-3 italic text-slate-500">
      {children}
    </blockquote>
  ),
};

export function MissionBriefSection({
  title,
  brief,
  option,
  device,
  optionExpanded,
  onToggleOption,
}: MissionBriefSectionProps) {
  return (
    <div
      data-tour="mission-brief"
      className="rounded-3xl border border-slate-200 bg-white p-6"
    >
      <div className="flex items-center justify-between">
        <p className="text-xl font-semibold text-slate-900">Mission</p>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
            {device === "mobile" ? (
              <>
                <Smartphone className="mr-1 inline size-3" aria-hidden="true" />
                모바일
              </>
            ) : (
              <>
                <Monitor className="mr-1 inline size-3" aria-hidden="true" />
                PC
              </>
            )}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-3">
          <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900">
            {title || (
              <span className="font-normal text-slate-400">미션 제목 없음</span>
            )}
          </p>

          {brief ? (
            <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p className="mb-1 text-xs font-semibold text-slate-500">
                전체 미션 브리핑
              </p>
              <ReactMarkdown components={markdownComponents}>{brief}</ReactMarkdown>
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-400">
              전체 미션 브리핑 없음
            </p>
          )}
        </div>

        {option && (
          <div className="border-t border-slate-100 pt-4">
            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
              <button
                type="button"
                onClick={onToggleOption}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-slate-50"
              >
                <span className="text-sm font-semibold text-slate-800">
                  선택된 옵션: {option.title}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {optionExpanded ? "▲" : "▼"}
                </span>
              </button>

              {optionExpanded && (
                <div className="space-y-4 border-t border-slate-100 px-4 py-3">
                  {option.description && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                      {option.description}
                    </p>
                  )}
                  {option.content && (
                    <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <ReactMarkdown components={markdownComponents}>
                        {option.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
