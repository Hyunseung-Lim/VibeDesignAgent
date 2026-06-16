"use client";

import type { ReactNode, RefObject } from "react";
import { IdeaTabs, type SessionIdeaTab } from "@/components/session/idea-tabs";
import { cn } from "@/lib/utils";

export type IdeaWorkspaceSection = {
  id: string;
  label: string;
  ref: RefObject<HTMLElement | null>;
};

type IdeaWorkspaceProps = {
  ideas: SessionIdeaTab[];
  activeIdeaId: string | null;
  activeSectionId: string;
  readOnly: boolean;
  sections: IdeaWorkspaceSection[];
  children: ReactNode;
  onSwitchIdea: (ideaId: string) => void;
  onDeleteIdea: (ideaId: string) => void;
  onSelectSection: (sectionId: string) => void;
};

export function IdeaWorkspace({
  ideas,
  activeIdeaId,
  activeSectionId,
  readOnly,
  sections,
  children,
  onSwitchIdea,
  onDeleteIdea,
  onSelectSection,
}: IdeaWorkspaceProps) {
  return (
    <div
      data-tour="idea-workspace"
      className="rounded-3xl border border-slate-200 bg-white p-6"
    >
      {ideas.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-400">
          <p>에이전트에게 시안을 작성해달라고 요청하세요.</p>
        </div>
      ) : (
        <>
          <IdeaTabs
            ideas={ideas}
            activeIdeaId={activeIdeaId}
            readOnly={readOnly}
            onSwitch={onSwitchIdea}
            onDelete={onDeleteIdea}
          />

          <div className="flex gap-4">
            <div
              data-tour="idea-section-nav"
              className="sticky top-4 flex flex-col space-y-2 self-start text-sm text-slate-600"
            >
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    onSelectSection(section.id);
                    setTimeout(
                      () =>
                        section.ref.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        }),
                      0,
                    );
                  }}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-left transition",
                    activeSectionId === section.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                >
                  {section.label}
                </button>
              ))}
            </div>

            <div className="min-w-0 flex-1 space-y-10">{children}</div>
          </div>
        </>
      )}
    </div>
  );
}
