import { useState } from "react";
import { ArrowUpRight, Check, ExternalLink, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type SessionReference = {
  id: string;
  title: string;
  description: string;
  rationale?: string;
  tag: string;
  url?: string;
  imageUrl?: string;
  referenceMode?: "style" | "product";
  searchProvider?: "openai-web";
  referencePurpose?: "visual_style" | "page_structure" | "content_components";
  referencePurposeLabel?: string;
};

type ReferenceCardProps = {
  reference: SessionReference;
  selected: boolean;
  readOnly?: boolean;
  onToggle: (reference: SessionReference) => void;
  onDelete: (reference: SessionReference) => void;
};

function purposeLabel(purpose?: SessionReference["referencePurpose"]) {
  if (purpose === "visual_style") return "비주얼";
  if (purpose === "page_structure") return "레이아웃";
  if (purpose === "content_components") return "컴포넌트";
  return null;
}

export function ReferenceCard({
  reference,
  selected,
  readOnly = false,
  onToggle,
  onDelete,
}: ReferenceCardProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const purpose =
    reference.referencePurposeLabel ?? purposeLabel(reference.referencePurpose);
  const showImage =
    Boolean(reference.imageUrl) && failedImageUrl !== reference.imageUrl;

  return (
    <article
      onClick={() => onToggle(reference)}
      className={cn(
        "group relative flex min-h-64 cursor-pointer flex-col overflow-hidden rounded-lg border bg-white transition",
        selected
          ? "border-slate-900 shadow-sm ring-2 ring-slate-900/10"
          : "border-border hover:border-slate-300 hover:shadow-sm",
      )}
      data-selected={selected ? "true" : "false"}
    >
      <div className="relative h-36 overflow-hidden border-b border-border bg-muted">
        {showImage ? (
          <img
            src={reference.imageUrl}
            alt={reference.title}
            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
            onError={() => setFailedImageUrl(reference.imageUrl ?? null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ArrowUpRight className="size-5" aria-hidden="true" />
          </div>
        )}
        {selected && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow-sm">
            <Check className="size-3" aria-hidden="true" />
            인용됨
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="space-y-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {reference.title}
          </h3>
          {(reference.rationale || reference.description) && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {reference.rationale || reference.description}
            </p>
          )}
        </div>

        <div className="mt-auto space-y-2">
          {purpose && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge variant="outline">{purpose}</Badge>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary" className="min-w-0 truncate">
              {reference.tag}
            </Badge>
            <div className="flex shrink-0 items-center gap-1">
              {reference.url && (
                <a
                  href={reference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label={`${reference.title} 새 탭에서 열기`}
                  title="새 탭에서 열기"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(reference);
                  }}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-rose-100 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`${reference.title} 삭제`}
                  title="삭제"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
