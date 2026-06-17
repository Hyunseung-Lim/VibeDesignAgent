import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

// Shared loading spinner. Always-visible SVG rotation (lucide Loader2), so it
// never silently fails like border-based spinners can. Control size and color
// via className: size-* for size, text-* for color (uses currentColor).
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2Icon
      className={cn("size-4 animate-spin", className)}
      aria-hidden="true"
    />
  );
}
