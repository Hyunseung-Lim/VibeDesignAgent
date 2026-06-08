import { Badge } from "@/components/ui/badge";

export type MissionStatusVariant =
  | "secondary"
  | "success"
  | "warning"
  | "destructive";

export type MissionStatus = {
  label: string;
  variant: MissionStatusVariant;
};

export function StatusBadge({ status }: { status: MissionStatus }) {
  return <Badge variant={status.variant}>{status.label}</Badge>;
}
