"use client";

import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type SessionSetupStepperProps = {
  currentStep: 1 | 2 | 3;
  onBack?: () => void;
  hideProfileStep?: boolean;
};

const STEPS = [
  { id: 1, label: "미션 선택" },
  { id: 2, label: "정보 입력" },
  { id: 3, label: "세션 시작" },
] as const;

export function SessionSetupStepper({
  currentStep,
  onBack,
  hideProfileStep = false,
}: SessionSetupStepperProps) {
  const steps = hideProfileStep
    ? STEPS.filter((step) => step.id !== 2)
    : STEPS;
  return (
    <div className="border-b border-slate-100 bg-white px-8 py-4">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mr-1 flex shrink-0 items-center gap-1 text-sm text-slate-400 transition hover:text-slate-700"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            이전
          </button>
        )}

        {steps.map((step, index) => {
          const active = step.id === currentStep;
          const complete = step.id < currentStep;
          return (
            <div key={step.id} className="contents">
              {index > 0 && (
                <div
                  className={cn(
                    "h-px flex-1",
                    step.id <= currentStep ? "bg-slate-900" : "bg-slate-200",
                  )}
                />
              )}
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    active
                      ? "bg-slate-900 text-white"
                      : complete
                        ? "bg-slate-300 text-white"
                        : "border-2 border-slate-200 text-slate-300",
                  )}
                >
                  {index + 1}
                </div>
                <span
                  className={cn(
                    "text-sm",
                    active
                      ? "font-semibold text-slate-900"
                      : complete
                        ? "text-slate-400"
                        : "text-slate-300",
                  )}
                >
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
