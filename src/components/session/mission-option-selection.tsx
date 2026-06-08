"use client";

import { Monitor, Smartphone } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { SessionSetupStepper } from "@/components/session/session-setup-stepper";

type MissionOptionDevice = "desktop" | "mobile";

export type SetupMissionOption = {
  id: string;
  title: string;
  description: string;
  content: string;
  device?: MissionOptionDevice;
};

type MissionOptionSelectionProps = {
  options: SetupMissionOption[];
  activePreviewId: string | null;
  parentMissionTitle: string;
  parentMissionBrief: string;
  device: MissionOptionDevice;
  onboarding: boolean;
  missionDurationMinutes?: number | null;
  onPreviewChange: (optionId: string) => void;
  onChooseOption: (option: SetupMissionOption) => void;
};

const optionMarkdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-2 mt-4 text-xl font-bold text-slate-900 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-2 mt-4 text-base font-semibold text-slate-900 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-800">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 ml-5 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 ml-5 list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-slate-600">{children}</em>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
      {children}
    </code>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-slate-300 pl-4 italic text-slate-500">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-slate-200" />,
};

function deviceBadge({
  onboarding,
  device,
}: {
  onboarding: boolean;
  device: MissionOptionDevice;
}) {
  if (onboarding) {
    return (
      <>
        <Monitor className="inline size-3" aria-hidden="true" /> PC ·{" "}
        <Smartphone className="inline size-3" aria-hidden="true" /> 모바일 선택
      </>
    );
  }
  if (device === "mobile") {
    return (
      <>
        <Smartphone className="inline size-3" aria-hidden="true" /> 모바일
      </>
    );
  }
  return (
    <>
      <Monitor className="inline size-3" aria-hidden="true" /> PC
    </>
  );
}

export function MissionOptionSelection({
  options,
  activePreviewId,
  parentMissionTitle,
  parentMissionBrief,
  device,
  onboarding,
  missionDurationMinutes,
  onPreviewChange,
  onChooseOption,
}: MissionOptionSelectionProps) {
  const activeOption =
    options.find((option) => option.id === activePreviewId) ?? options[0];

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <SessionSetupStepper currentStep={1} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
          {(parentMissionTitle || parentMissionBrief) && (
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  미션
                </p>
                <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                  {deviceBadge({ onboarding, device })}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                  {missionDurationMinutes
                    ? `제한 시간 ${missionDurationMinutes}분`
                    : "시간 제한 없음"}
                </span>
              </div>

              {parentMissionTitle && (
                <h2 className="mt-2 text-lg font-semibold text-slate-900">
                  {parentMissionTitle}
                </h2>
              )}
              {parentMissionBrief && (
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">
                  {parentMissionBrief}
                </p>
              )}
            </div>
          )}

          {options.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {options.map((option, index) => {
                const active =
                  activePreviewId === option.id || (!activePreviewId && index === 0);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onPreviewChange(option.id)}
                    className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {option.device === "mobile" ? (
                        <Smartphone className="size-3.5" aria-hidden="true" />
                      ) : option.device === "desktop" ? (
                        <Monitor className="size-3.5" aria-hidden="true" />
                      ) : null}
                      {option.title}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {activeOption && (
            <div className="space-y-6">
              {activeOption.description && (
                <p className="text-base leading-relaxed text-slate-500">
                  {activeOption.description}
                </p>
              )}

              {activeOption.content && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    콘텐츠
                  </p>
                  <div className="space-y-2 rounded-2xl border border-slate-100 bg-white px-6 py-5 text-sm text-slate-700">
                    <ReactMarkdown components={optionMarkdownComponents}>
                      {activeOption.content}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-8 py-4">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => {
              if (activeOption) onChooseOption(activeOption);
            }}
            className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            다음
          </button>
        </div>
      </div>
    </main>
  );
}
