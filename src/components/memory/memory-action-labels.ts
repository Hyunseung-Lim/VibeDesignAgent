const hiddenActionTokens = new Set([
  "promoted",
  "referenced",
  "archived",
  "presentation_create",
]);

const actionLabels: Record<string, string> = {
  agent_response: "대화",
  references_fetch: "레퍼런스 검색",
  reference_cite: "레퍼런스 선택",
  reference_delete: "레퍼런스 삭제",
  note_create: "시안 생성",
  note_update: "시안 수정",
  note_delete: "시안 삭제",
  design_spec_create: "디자인 스타일 작성",
  design_spec_edit: "디자인 스타일 수정",
  mockup_generate: "목업 생성",
  mockup_edit: "목업 수정",
  mockup_delete: "목업 삭제",
  final_design_select: "최종 디자인 선택",
  style_image_preference: "첨부 이미지 스타일",
};

export function memoryActionLabel(action: string) {
  return actionLabels[action] ?? action.replaceAll("_", " ");
}

export function visibleMemoryActionLabels(action: string | null | undefined) {
  return (action ?? "")
    .split(" / ")
    .map((token) => token.trim())
    .filter((token) => token && !hiddenActionTokens.has(token))
    .map(memoryActionLabel);
}
