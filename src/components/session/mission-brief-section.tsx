"use client";

import { ChevronDown, Monitor, Smartphone } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";

type MissionBriefDevice = "desktop" | "mobile";

export type MissionBriefOption = {
  title: string;
  description?: string;
  content?: string;
  assetImages?: Array<{
    url: string;
    path?: string;
    note?: string;
  }>;
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
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="min-w-0 flex-1 text-base font-semibold text-slate-900">
              {title || (
                <span className="font-normal text-slate-400">
                  미션 제목 없음
                </span>
              )}
            </p>
            <Badge variant="outline" className="text-slate-600">
              {device === "mobile" ? (
                <>
                  <Smartphone className="size-3" aria-hidden="true" />
                  모바일 기준
                </>
              ) : (
                <>
                  <Monitor className="size-3" aria-hidden="true" />
                  PC 기준
                </>
              )}
            </Badge>
          </div>

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
            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/70">
              <button
                type="button"
                onClick={onToggleOption}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Selected Option
                  </p>
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {option.title}
                  </p>
                </div>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${
                      optionExpanded ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </span>
              </button>

              {optionExpanded && (
                <div className="space-y-4 border-t border-slate-100 bg-white px-4 py-3">
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
                  {(option.assetImages?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-500">
                        콘텐츠 이미지
                      </p>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        {option.assetImages?.map((image, index) => (
                          <a
                            key={image.path || image.url || index}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 transition hover:border-slate-200"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={image.url}
                              alt={image.note?.trim() || `미션 콘텐츠 이미지 ${index + 1}`}
                              className="aspect-square w-full object-cover"
                            />
                            {image.note?.trim() && (
                              <p className="line-clamp-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                                {image.note}
                              </p>
                            )}
                          </a>
                        ))}
                      </div>
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
