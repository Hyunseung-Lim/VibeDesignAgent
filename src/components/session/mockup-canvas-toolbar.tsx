import {
  Download,
  Expand,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type MockupToolbarArtboard = {
  html: string;
  label: string;
};

export type MockupToolbarSelectedElement = {
  selector: string;
};

type MockupCanvasToolbarProps = {
  editMode: boolean;
  selectedElement: MockupToolbarSelectedElement | null;
  canvasScale: number;
  activeArtboard: MockupToolbarArtboard | null | undefined;
  onToggleEditMode: () => void;
  onClearSelectedElement: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onExport: () => void;
  onExpand: () => void;
};

function ToolbarIconButton({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={label}
          className={cn("bg-white", className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function MockupCanvasToolbar({
  editMode,
  selectedElement,
  canvasScale,
  activeArtboard,
  onToggleEditMode,
  onClearSelectedElement,
  onFit,
  onZoomIn,
  onZoomOut,
  onExport,
  onExpand,
}: MockupCanvasToolbarProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editMode && selectedElement && (
          <div className="flex max-w-56 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
            <MousePointer2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{selectedElement.selector}</span>
            <button
              type="button"
              onClick={onClearSelectedElement}
              className="ml-0.5 rounded p-0.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
              aria-label="선택 해제"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </div>
        )}

        <Button
          type="button"
          variant={editMode ? "secondary" : "outline"}
          size="sm"
          onClick={onToggleEditMode}
          data-tour="mockup-edit-button"
          className={cn(
            "bg-white",
            editMode && "border-slate-300 bg-slate-100 text-slate-900",
          )}
          aria-pressed={editMode}
        >
          <SquareDashedMousePointer className="size-3.5" aria-hidden="true" />
          {editMode ? "선택 종료" : "영역 선택"}
        </Button>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-1">
          <ToolbarIconButton label="캔버스 맞춤" onClick={onFit}>
            <Maximize2 className="size-3.5" aria-hidden="true" />
          </ToolbarIconButton>
          <ToolbarIconButton label="확대" onClick={onZoomIn}>
            <Plus className="size-3.5" aria-hidden="true" />
          </ToolbarIconButton>
          <ToolbarIconButton label="축소" onClick={onZoomOut}>
            <Minus className="size-3.5" aria-hidden="true" />
          </ToolbarIconButton>
          <span className="min-w-10 px-1 text-center text-xs font-medium text-muted-foreground">
            {Math.round(canvasScale * 100)}%
          </span>
        </div>

        <ToolbarIconButton
          label="HTML 내보내기"
          onClick={onExport}
          disabled={!activeArtboard?.html}
        >
          <Download className="size-3.5" aria-hidden="true" />
        </ToolbarIconButton>

        <ToolbarIconButton label="확대 보기" onClick={onExpand}>
          <Expand className="size-3.5" aria-hidden="true" />
        </ToolbarIconButton>
      </div>
    </TooltipProvider>
  );
}
