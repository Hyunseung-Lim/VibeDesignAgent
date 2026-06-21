"use client";

import { Monitor, Smartphone } from "lucide-react";
import { SetupMissionSummaryCard } from "@/components/session/session-setup-cards";
import { SessionSetupStepper } from "@/components/session/session-setup-stepper";
import { Button } from "@/components/ui/button";

type MissionOptionDevice = "desktop" | "mobile";

export type SetupMissionOption = {
  id: string;
  title: string;
  description: string;
  content: string;
  device?: MissionOptionDevice;
  assetImages?: Array<{
    url: string;
    note?: string;
  }>;
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

function optionBrief(option: SetupMissionOption | null) {
  if (!option) return "";
  return [
    option.description,
    option.content ? `웹/앱에 들어가야 하는 콘텐츠:\n${option.content}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function MissionOptionSelection({
  options,
  activePreviewId,
  parentMissionTitle,
  parentMissionBrief,
  onboarding,
  missionDurationMinutes,
  onPreviewChange,
  onChooseOption,
}: MissionOptionSelectionProps) {
  const activeOption =
    options.find((option) => option.id === activePreviewId) ?? options[0];

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <SessionSetupStepper currentStep={1} hideProfileStep={onboarding} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
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
            <SetupMissionSummaryCard
              missionTitle={activeOption.title}
              missionBrief={optionBrief(activeOption)}
              parentMissionTitle={parentMissionTitle}
              parentMissionBrief={parentMissionBrief}
              activeOption={activeOption}
              showOption
              missionDurationMinutes={missionDurationMinutes}
            />
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-8 py-4">
        <div className="mx-auto max-w-3xl">
          <Button
            onClick={() => {
              if (activeOption) onChooseOption(activeOption);
            }}
            className="h-auto w-full rounded-2xl py-3.5 text-sm font-semibold"
          >
            다음
          </Button>
        </div>
      </div>
    </main>
  );
}
