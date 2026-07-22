// missionProgressFromSession이 참조하는 스칼라 필드. runQuery projection으로
// 세션 문서의 messages/artboards 등 대형 배열을 내려받지 않기 위한 목록이다.
// 실데이터 검증 결과 hasActivity 판정은 이 스칼라만으로 전체 문서와 동일하다
// (세션 로드 시 selectedOptionId가 자동 저장되기 때문 — 15.297).
export const SESSION_PROGRESS_FIELDS = [
  "status",
  "timerStartedAt",
  "timerElapsedMs",
  "timerFirstStartedAt",
  "startedAt",
  "endedAt",
  "selectedOptionId",
];
