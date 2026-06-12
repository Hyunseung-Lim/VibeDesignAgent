// Chat message content parsing for the design session: splits assistant text
// into plain markdown parts and tool-action chips, and normalizes/cleans the
// custom [ACTION:...] blocks the agent emits.

export type ContentChip = {
  label: string;
  done: boolean;
  failed?: boolean;
  code?: string;
};
export type ContentPart =
  | { type: "text"; content: string }
  | { type: "chip"; chip: ContentChip };

const BLOCK_RULES = [
  {
    complete: /\[CREATE_NOTE:(?:\s*\{[\s\S]*?\}|[\s\S]*?\n)\]/,
    partial: /\[CREATE_NOTE:[\s\S]*$/,
    doneLabel: "노트 생성됨",
    pendingLabel: "노트 작성 중...",
    failedLabel: "노트 작성 실패",
    failedMarker: "⚠️ 노트를 먼저 저장해야",
  },
  {
    complete: /\[UPDATE_NOTE:(?:\s*\{[\s\S]*?\}|[\s\S]*?\n)\]/,
    partial: /\[UPDATE_NOTE:[\s\S]*$/,
    doneLabel: "노트 수정됨",
    pendingLabel: "노트 수정 중...",
  },
  {
    complete: /\[GENERATE_MOCKUP(?::[^\]]*)?\]/,
    partial: /\[GENERATE_MOCKUP:[\s\S]*$/,
    doneLabel: "새 목업 생성 요청",
    pendingLabel: "목업 설명 작성 중...",
    failedLabel: "목업 생성 불가",
    failedMarker: "⚠️ 디자인 스타일이 없어 목업을",
  },
  {
    complete: /\[EDIT_MOCKUP(?::[^\]]*)?\]/,
    partial: /\[EDIT_MOCKUP:[\s\S]*$/,
    doneLabel: "목업 수정 요청",
    pendingLabel: "수정 내용 작성 중...",
  },
  {
    complete: /\[FETCH_REFERENCES(?::[^\]]+)?\]/,
    partial: /\[FETCH_REFERENCES[\s\S]*$/,
    doneLabel: "레퍼런스 검색 요청됨",
    pendingLabel: "레퍼런스 검색 중...",
  },
  {
    complete: /\[WEB_SEARCHED\]/,
    partial: /\[WEB_SEARCHED\]/,
    doneLabel: "웹 검색 완료",
    pendingLabel: "웹 검색 중...",
  },
  {
    complete: /\[CREATE_DESIGN_SPEC:\s*\{[\s\S]*?\}\]/,
    partial: /\[CREATE_DESIGN_SPEC:[\s\S]*$/,
    doneLabel: "디자인 스타일 추가됨",
    pendingLabel: "디자인 스타일 작성 중...",
  },
];

export function processMessageContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    let earliest: {
      index: number;
      matchStr: string;
      label: string;
      done: boolean;
      failedLabel?: string;
      failedMarker?: string;
    } | null = null;

    for (const rule of BLOCK_RULES) {
      for (const [regex, done, label] of [
        [rule.complete, true, rule.doneLabel],
        [rule.partial, false, rule.pendingLabel],
      ] as [RegExp, boolean, string][]) {
        const m = remaining.match(regex);
        if (
          m &&
          m.index !== undefined &&
          (earliest === null || m.index < earliest.index)
        ) {
          earliest = {
            index: m.index,
            matchStr: m[0],
            label,
            done,
            failedLabel: (rule as { failedLabel?: string }).failedLabel,
            failedMarker: (rule as { failedMarker?: string }).failedMarker,
          };
        }
      }
    }

    if (!earliest) {
      if (remaining.trim())
        parts.push({ type: "text", content: remaining.trim() });
      break;
    }

    const before = remaining.slice(0, earliest.index).trim();
    if (before) parts.push({ type: "text", content: before });

    const afterChip = remaining.slice(earliest.index + earliest.matchStr.length);
    const failed = !!(
      earliest.failedLabel &&
      earliest.failedMarker &&
      (afterChip.includes(earliest.failedMarker) || content.includes(earliest.failedMarker))
    );

    // Extract code content from the matched block
    const codeMatch = earliest.matchStr.match(
      /```(?:html|presentation)\s*\n([\s\S]*?)(?:\n?\s*```|$)/,
    );
    const code = codeMatch ? codeMatch[1].trim() : earliest.matchStr;

    parts.push({
      type: "chip",
      chip: {
        label: failed ? (earliest.failedLabel as string) : earliest.label,
        done: failed || earliest.done,
        failed,
        code,
      },
    });
    remaining = afterChip;
  }

  return parts;
}

export function extractChatPhases(content: string) {
  const phases: string[] = [];
  const visibleText = content
    .replace(
      /\[PROMPT_STATUS:\s*([^\]]+)\]\n?/g,
      (_match, label: string) => {
        phases.push(label.trim());
        return "";
      },
    )
    .replace(
      /\[CHAT_PHASE:\s*([^\]]+)\]\n?/g,
      (_match, label: string) => {
        phases.push(label.trim());
        return "";
      },
    )
    .replace(/\[(?:PROMPT_STATUS|CHAT_PHASE):[\s\S]*$/, "");
  return {
    visibleText,
    phases: Array.from(new Set(phases.filter(Boolean))),
  };
}

export function splitPendingMockupCompletionText(content: string) {
  const match = content.match(/\[(?:GENERATE|EDIT)_MOCKUP:\s*[\s\S]*?\]/);
  if (!match || match.index === undefined) {
    return { visibleText: content, completionText: "" };
  }

  const blockEnd = match.index + match[0].length;
  const completionText = content.slice(blockEnd).trim();
  if (!completionText) return { visibleText: content, completionText: "" };

  return {
    visibleText: content.slice(0, blockEnd).trimEnd(),
    completionText,
  };
}

export function normalizeActionBlockAliases(content: string) {
  return content
    .replace(/\[(?:목업\s*)?생성\s*요청\s*\]/g, "[GENERATE_MOCKUP: ]")
    .replace(
      /\[(?:목업\s*)?생성\s*요청\s*:\s*([\s\S]*?)\]/g,
      "[GENERATE_MOCKUP: $1]",
    )
    .replace(/\[목업\s*생성\s*:\s*([\s\S]*?)\]/g, "[GENERATE_MOCKUP: $1]")
    .replace(/\[(?:목업\s*)?수정\s*요청\s*\]/g, "[EDIT_MOCKUP: ]")
    .replace(
      /\[(?:목업\s*)?수정\s*요청\s*:\s*([\s\S]*?)\]/g,
      "[EDIT_MOCKUP: $1]",
    )
    .replace(/\[목업\s*수정\s*:\s*([\s\S]*?)\]/g, "[EDIT_MOCKUP: $1]")
    .replace(/\[레퍼런스\s*검색\s*:\s*([\s\S]*?)\]/g, "[FETCH_REFERENCES: $1]");
}

export function cleanMessageContentForModel(content: string) {
  return content
    .replace(/\[CREATE_NOTE:\s*\{[\s\S]*?\}\]/g, "[노트 생성]")
    .replace(/\[UPDATE_NOTE:\s*\{[\s\S]*?\}\]/g, "[노트 수정]")
    .replace(
      /\[GENERATE_MOCKUP:[\s\S]*?\]/g,
      "이전 액션: mockup generation requested.",
    )
    .replace(/\[EDIT_MOCKUP:[\s\S]*?\]/g, "이전 액션: mockup edit requested.")
    .replace(
      /```presentation\s*\n[\s\S]*?\n?\s*```/g,
      "이전 액션: presentation requested.",
    )
    .replace(
      /\[FETCH_REFERENCES(?::[^\]]+)?\]/g,
      "이전 액션: reference search requested.",
    )
    .replace(
      /### 레퍼런스 선택 이유[\s\S]*?(?=\n### |\n```|\n\[|$)/g,
      (match) => {
        const trimmed = match.trim();
        return trimmed.length <= 600
          ? trimmed
          : trimmed.slice(0, 600) + "\n\n[이하 reference preference context로 압축됨]";
      },
    )
    .replace(/\[WEB_SEARCHED\]/g, "이전 액션: web search completed.")
    .replace(/\[CREATE_DESIGN_SPEC:\s*\{[\s\S]*?\}\]/g, "[디자인 스타일 추가]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
