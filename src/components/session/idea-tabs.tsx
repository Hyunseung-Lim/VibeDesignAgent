import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SessionIdeaTab = {
  id: string;
  title: string;
};

type IdeaTabsProps = {
  ideas: SessionIdeaTab[];
  activeIdeaId: string | null;
  readOnly?: boolean;
  onSwitch: (ideaId: string) => void;
  onDelete: (ideaId: string) => void;
};

export function IdeaTabs({
  ideas,
  activeIdeaId,
  readOnly = false,
  onSwitch,
  onDelete,
}: IdeaTabsProps) {
  return (
    <div
      data-tour="idea-tabs"
      className="flex gap-2 overflow-x-auto pb-4 mb-6 border-b border-slate-100"
    >
      {ideas.map((idea) => {
        const active = activeIdeaId === idea.id;
        return (
          <div
            key={idea.id}
            className={cn(
              "group shrink-0 flex items-center gap-1 rounded-xl border px-3 py-2 text-sm transition",
              active
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            <button type="button" onClick={() => onSwitch(idea.id)}>
              {idea.title}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(idea.id);
                }}
                className={cn(
                  "ml-1 rounded-md p-0.5 opacity-0 transition-opacity group-hover:opacity-100",
                  active ? "hover:bg-white/20" : "hover:bg-slate-200",
                )}
                aria-label={`${idea.title} 시안 삭제`}
                title="시안 삭제"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
