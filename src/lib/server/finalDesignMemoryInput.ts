import OpenAI from "openai";
import { FINAL_DESIGN_INPUT_PROMPT } from "@/lib/prompts";
import type { FinalDesignEnrichmentPayload } from "@/lib/memory-final-design";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Per-board HTML budget. The chosen board gets the larger slice because its
// concrete features matter most; candidates only need enough markup to
// characterize copy/structure/style for the comparison.
const CHOSEN_HTML_LIMIT = 12000;
const CANDIDATE_HTML_LIMIT = 5000;
const MAX_BOARDS = 8;
const MAX_CHAT_TURNS = 16;
const CHAT_TURN_LIMIT = 800;

function compactHtml(html: string, limit: number) {
  return String(html ?? "").trim().slice(0, limit);
}

function deviceLabel(device: string) {
  return device === "mobile" ? "모바일" : "데스크톱";
}

function buildUserContent(payload: FinalDesignEnrichmentPayload): string | null {
  const boards = (payload.boards ?? []).filter((board) =>
    String(board?.html ?? "").trim(),
  );
  if (boards.length === 0) return null;

  // Chosen first, then remaining candidates, capped.
  const ordered = [
    ...boards.filter((board) => board.chosen),
    ...boards.filter((board) => !board.chosen),
  ].slice(0, MAX_BOARDS);

  const boardBlocks = ordered.map((board, index) => {
    const limit = board.chosen ? CHOSEN_HTML_LIMIT : CANDIDATE_HTML_LIMIT;
    const heading = `### 후보 ${index + 1}${board.chosen ? " (최종 선택)" : ""}`;
    return [
      heading,
      `시안: ${board.ideaTitle || "(제목 없음)"}`,
      `라벨: ${board.label || "(라벨 없음)"}`,
      `디바이스: ${deviceLabel(board.device)}`,
      `HTML:\n${compactHtml(board.html, limit)}`,
    ].join("\n");
  });

  const chat = (payload.chat ?? [])
    .filter((turn) => String(turn?.content ?? "").trim())
    .slice(-MAX_CHAT_TURNS)
    .map((turn) => {
      const speaker = turn.role === "assistant" ? "에이전트" : "사용자";
      return `${speaker}: ${String(turn.content).trim().slice(0, CHAT_TURN_LIMIT)}`;
    });

  return [
    "## 후보 목업",
    boardBlocks.join("\n\n"),
    "## 세션 채팅",
    chat.length > 0 ? chat.join("\n") : "(채팅 기록 없음)",
  ].join("\n\n");
}

/**
 * Run the final-design "input enrichment" LLM pass. Returns a rich, factual
 * Korean record (candidate comparison + chosen-board features + chat-revealed
 * preferences) to be used as the memory draft input. Best-effort: returns null
 * on missing data or failure so the caller can fall back to a simple input.
 */
export async function buildFinalDesignMemoryInput(
  payload: FinalDesignEnrichmentPayload,
): Promise<string | null> {
  const userContent = buildUserContent(payload);
  if (!userContent) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: FINAL_DESIGN_INPUT_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    return text || null;
  } catch (error) {
    console.warn(
      "[final-design] input enrichment failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
