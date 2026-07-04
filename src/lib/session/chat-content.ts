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

// Note blocks ([CREATE_NOTE:] / [UPDATE_NOTE:]) are detected by structural
// scanning rather than regex, because the note body is freeform markdown that
// can contain `]`, `}`, newlines, and no trailing newline. A note is "complete"
// exactly when parseNoteBlock (in the session page) could extract it — i.e. a
// balanced closing `]`, or a balanced `{...}` JSON payload. Matching that
// condition keeps the chip ("작성 중" vs "노트 생성됨") in sync with whether the
// note was actually saved, which a regex kept getting wrong.
const NOTE_RULES = [
  {
    tag: "CREATE_NOTE",
    doneLabel: "Design Brief 생성됨",
    pendingLabel: "Design Brief 작성 중...",
    failedLabel: "Design Brief 작성 실패",
    failedMarker: "⚠️ Design Brief를 먼저 저장해야",
  },
  {
    tag: "UPDATE_NOTE",
    doneLabel: "Design Brief 수정됨",
    pendingLabel: "Design Brief 수정 중...",
  },
] as const;

const DESIGN_SPEC_RULE = {
  tag: "CREATE_DESIGN_SPEC",
  doneLabel: "디자인 스타일 추가됨",
  pendingLabel: "디자인 스타일 작성 중...",
  failedLabel: "디자인 스타일 작성 실패",
  failedMarker: "디자인 스타일을 저장하지 못했습니다.",
} as const;

function findNoteBlock(
  text: string,
  tag: string,
): { index: number; matchStr: string; done: boolean } | null {
  const opener = `[${tag}:`;
  const index = text.indexOf(opener);
  if (index === -1) return null;
  const inner = index + opener.length;

  // 1) Balanced closing `]` (matches extractPlainNoteContent's bracket scan).
  let depth = 1;
  for (let i = inner; i < text.length; i += 1) {
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        return { index, matchStr: text.slice(index, i + 1), done: true };
      }
    }
  }

  // 2) No closing `]` yet, but a balanced `{...}` payload means the note parser
  //    can already create it (matches extractJsonActionPayload's brace scan).
  const braceStart = text.indexOf("{", inner);
  if (braceStart !== -1) {
    let braceDepth = 0;
    let inString = false;
    let escaped = false;
    for (let i = braceStart; i < text.length; i += 1) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") braceDepth += 1;
      else if (char === "}") {
        braceDepth -= 1;
        if (braceDepth === 0) {
          return { index, matchStr: text.slice(index, i + 1), done: true };
        }
      }
    }
  }

  // 3) Still streaming / incomplete.
  return { index, matchStr: text.slice(index), done: false };
}

const BLOCK_RULES = [
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
];

export function processMessageContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let remaining = normalizeActionBlockAliases(content);

  while (remaining.length > 0) {
    let earliest: {
      index: number;
      matchStr: string;
      label: string;
      done: boolean;
      failedLabel?: string;
      failedMarker?: string;
    } | null = null;

    // Bracket/brace-balanced note blocks (CREATE_NOTE / UPDATE_NOTE).
    for (const rule of NOTE_RULES) {
      const found = findNoteBlock(remaining, rule.tag);
      if (found && (earliest === null || found.index < earliest.index)) {
        earliest = {
          index: found.index,
          matchStr: found.matchStr,
          label: found.done ? rule.doneLabel : rule.pendingLabel,
          done: found.done,
          failedLabel: (rule as { failedLabel?: string }).failedLabel,
          failedMarker: (rule as { failedMarker?: string }).failedMarker,
        };
      }
    }

    // Design style payloads have the same freeform JSON/markdown failure modes
    // as note payloads. A balanced JSON object is actionable even when the
    // model omits the trailing `]`, so keep the chip state aligned with the
    // runtime parser instead of leaving a permanent "작성 중" chip.
    const designSpec = findNoteBlock(remaining, DESIGN_SPEC_RULE.tag);
    if (
      designSpec &&
      (earliest === null || designSpec.index < earliest.index)
    ) {
      earliest = {
        index: designSpec.index,
        matchStr: designSpec.matchStr,
        label: designSpec.done
          ? DESIGN_SPEC_RULE.doneLabel
          : DESIGN_SPEC_RULE.pendingLabel,
        done: designSpec.done,
        failedLabel: DESIGN_SPEC_RULE.failedLabel,
        failedMarker: DESIGN_SPEC_RULE.failedMarker,
      };
    }

    // Regex-based blocks (mockup, references, web search).
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
  const referenceActionLabel =
    String.raw`(?:FETCH[\s_-]*REFERENCES?|REFERENCES?[\s_-]*(?:FETCH|SEARCH)|REFERENCE[\s_-]*SEARCH|레퍼런스\s*검색)`;
  const bracketedReferenceAction = new RegExp(
    String.raw`\[\s*${referenceActionLabel}\s*(?::\s*([\s\S]*?))?\]`,
    "gi",
  );
  const bareLineReferenceAction = new RegExp(
    String.raw`(^|\n)\s*${referenceActionLabel}\s*:\s*([^\n\[]+)`,
    "gi",
  );

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
    .replace(bracketedReferenceAction, (_match, query: string | undefined) => {
      const trimmed = query?.trim();
      return trimmed ? `[FETCH_REFERENCES: ${trimmed}]` : "[FETCH_REFERENCES]";
    })
    .replace(
      bareLineReferenceAction,
      (_match, prefix: string, query: string) =>
        `${prefix}[FETCH_REFERENCES: ${query.trim()}]`,
    );
}

export function cleanMessageContentForModel(content: string) {
  return normalizeActionBlockAliases(content)
    .replace(/\[CREATE_NOTE:\s*\{[\s\S]*?\}\]/g, "[Design Brief 생성]")
    .replace(/\[UPDATE_NOTE:\s*\{[\s\S]*?\}\]/g, "[Design Brief 수정]")
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
      /\[FETCH_REFERENCES(?::[^\]]+)?\]/gi,
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
