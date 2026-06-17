import { BrainIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type MemoryClusterEmptyStateProps = {
  canGenerate: boolean;
  isRegenerating: boolean;
  onGenerate: () => void;
};

export function MemoryClusterEmptyState({
  canGenerate,
  isRegenerating,
  onGenerate,
}: MemoryClusterEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <BrainIcon size={36} className="text-muted-foreground/35" />
      <p className="text-sm font-medium text-muted-foreground">
        클러스터가 없어요
      </p>
      <p className="text-xs text-muted-foreground">
        기억을 분석해서 패턴을 묶어드릴게요.
      </p>
      {canGenerate ? (
        <Button
          type="button"
          onClick={onGenerate}
          disabled={isRegenerating}
          className="mt-2 rounded-full"
        >
          {isRegenerating ? "생성 중..." : "클러스터 생성하기"}
        </Button>
      ) : null}
    </div>
  );
}
