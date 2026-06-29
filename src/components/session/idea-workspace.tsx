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
  title?: string;
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
  title = "Design Workspace",
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
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-5 border-b border-slate-100 pb-4">
        <p className="text-base font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-xs text-slate-500">
          각 시안은 Design Brief, Design Style, Mockup으로 구성됩니다.
        </p>
      </div>

      {ideas.length > 0 && (
        <IdeaTabs
          ideas={ideas}
          activeIdeaId={activeIdeaId}
          readOnly={readOnly}
          onSwitch={onSwitchIdea}
          onDelete={onDeleteIdea}
        />
      )}

      <div className="flex gap-5">
        <div
          data-tour="idea-section-nav"
          className="sticky top-6 flex w-32 shrink-0 flex-col space-y-2 self-start text-sm text-slate-600"
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
                "rounded-xl border px-3 py-2 text-left text-xs font-medium transition",
                activeSectionId === section.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white hover:bg-slate-50",
              )}
            >
              {section.label}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 space-y-8">{children}</div>
      </div>
    </div>
  );
}
