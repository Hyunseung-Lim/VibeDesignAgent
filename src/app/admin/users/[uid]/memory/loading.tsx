import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background text-muted-foreground"
      role="status"
      aria-label="불러오는 중"
    >
      <Spinner className="size-5" />
    </div>
  );
}
