export type MissionProgress = {
  hasActivity: boolean;
  timerStartedAt: number | null;
  status: string | null;
};

export type MissionProgressStatus = {
  label: "대기" | "준비중" | "진행중" | "시간 초과" | "완료";
  variant: "secondary" | "success" | "warning" | "destructive";
};

export function missionProgressFromSession(
  data: Record<string, unknown>,
): MissionProgress {
  const timerStartedAt =
    typeof data.timerStartedAt === "number" ? data.timerStartedAt : null;
  return {
    timerStartedAt,
    status: typeof data.status === "string" ? data.status : null,
    hasActivity: Boolean(
      data.selectedOptionId ||
      data.timerStartedAt ||
      (Array.isArray(data.messages) && data.messages.length > 0) ||
      (Array.isArray(data.ideas) && data.ideas.length > 0) ||
      (Array.isArray(data.artboards) && data.artboards.length > 0) ||
      (Array.isArray(data.references) && data.references.length > 0),
    ),
  };
}

export function deriveMissionProgressStatus(
  progress: MissionProgress | null | undefined,
  durationMinutes?: number,
  now = Date.now(),
): MissionProgressStatus {
  if (progress?.status === "completed") {
    return { label: "완료", variant: "success" };
  }
  if (!progress?.hasActivity) {
    return { label: "대기", variant: "secondary" };
  }
  if (!progress.timerStartedAt) {
    return { label: "준비중", variant: "secondary" };
  }
  if (
    durationMinutes &&
    now - progress.timerStartedAt >= durationMinutes * 60 * 1000
  ) {
    return { label: "시간 초과", variant: "destructive" };
  }
  return { label: "진행중", variant: "warning" };
}
