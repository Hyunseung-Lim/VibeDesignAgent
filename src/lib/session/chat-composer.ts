export type ChatComposerCommandId =
  | "create_idea"
  | "create_blank_idea"
  | "create_design_style"
  | "generate_mockup"
  | "fetch_references";

export type ChatComposerCommand = {
  id: ChatComposerCommandId;
  label: string;
  description: string;
  defaultPrompt: string;
  disabledReason?: string;
};

export type ChatComposerMentionKind =
  | "idea"
  | "design_brief"
  | "design_style"
  | "mockup";

export type ChatComposerMention = {
  kind: ChatComposerMentionKind;
  ideaId: string;
  artifactId?: string;
  label: string;
  searchText: string;
};

export const CHAT_COMPOSER_COMMANDS: ChatComposerCommand[] = [
  {
    id: "create_blank_idea",
    label: "/새시안추가",
    description: "빈 새 시안 추가",
    defaultPrompt: "새 빈 시안을 추가해줘",
  },
  {
    id: "create_idea",
    label: "/디자인브리프작성",
    description: "현재 시안의 Design Brief 작성",
    defaultPrompt: "현재 시안의 Design Brief를 작성해줘",
  },
  {
    id: "create_design_style",
    label: "/디자인스타일작성",
    description: "현재 시안의 Design Style 작성",
    defaultPrompt: "현재 시안의 Design Style을 작성해줘",
  },
  {
    id: "generate_mockup",
    label: "/목업생성",
    description: "현재 시안의 한 페이지 목업 만들기",
    defaultPrompt: "현재 시안의 목업을 생성해줘",
  },
  {
    id: "fetch_references",
    label: "/레퍼런스검색",
    description: "새로운 레퍼런스 찾기",
    defaultPrompt: "현재 미션에 어울리는 레퍼런스를 찾아줘",
  },
];

export function normalizeComposerSearch(value: string) {
  return value.replace(/[\s·_-]+/g, "").toLowerCase();
}

export function matchesComposerSearch(
  optionText: string,
  rawQuery: string,
) {
  const query = normalizeComposerSearch(rawQuery);
  return !query || normalizeComposerSearch(optionText).includes(query);
}
