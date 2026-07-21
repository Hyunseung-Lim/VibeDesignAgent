export type MissionProgress = {
  hasActivity: boolean;
  timerStartedAt: number | null;
  // 일시정지 누적 모델(15.326)의 확정 누적 경과. legacy 문서·합성 fallback은
  // 없을 수 있다(optional) — 소비처는 ?? 0으로 읽는다.
  timerElapsedMs?: number | null;
  endedAt: number | null;
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
    typeof data.timerStartedAt === "number"
      ? data.timerStartedAt
      : typeof data.startedAt === "number"
        ? data.startedAt
        : null;
  const endedAt = typeof data.endedAt === "number" ? data.endedAt : null;
  return {
    timerStartedAt,
    timerElapsedMs:
      typeof data.timerElapsedMs === "number" ? data.timerElapsedMs : null,
    endedAt,
    status: typeof data.status === "string" ? data.status : null,
    hasActivity: Boolean(
      data.selectedOptionId ||
      data.timerStartedAt ||
      data.startedAt ||
      (typeof data.timerElapsedMs === "number" && data.timerElapsedMs > 0) ||
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
  const timerHasStarted = Boolean(
    progress.timerStartedAt || (progress.timerElapsedMs ?? 0) > 0,
  );
  if (!timerHasStarted) {
    return { label: "준비중", variant: "secondary" };
  }
  // 일시정지 누적 모델(15.326): 총 경과 = 누적 + 열려 있는 구간. 일시정지
  // 상태(timerStartedAt null)면 경과가 얼지만 진행중 표시는 유지된다.
  // legacy 문서(누적 없음)는 기존처럼 벽시계 경과로 계산된다.
  const elapsedMs =
    (progress.timerElapsedMs ?? 0) +
    (progress.timerStartedAt ? Math.max(0, now - progress.timerStartedAt) : 0);
  if (durationMinutes && elapsedMs >= durationMinutes * 60 * 1000) {
    return { label: "시간 초과", variant: "destructive" };
  }
  return { label: "진행중", variant: "warning" };
}
