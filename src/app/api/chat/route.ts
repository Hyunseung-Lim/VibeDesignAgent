import OpenAI from "openai";
import { isAdminEmail } from "@/lib/admin";
import {
  getFirebaseAccessToken,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  CHAT_AGENT_BASE_PROMPT,
  chatActionInstructionPrompt,
  chatDevicePrompt,
  chatMissionPrompt,
  chatRetrievedMemoryPrompt,
  chatDesignSpecPrompt,
  chatCitedTextsPrompt,
  chatActiveIdeaPrompt,
  chatCurrentRequestPrompt,
  chatMockupHtmlPrompt,
  chatSelectedElementPrompt,
  chatCitedRefsWithUrlPrompt,
  chatCitedRefsNoUrlPrompt,
  chatReferencePreferencePrompt,
  chatPlannerPrompt,
} from "@/lib/prompts";
import type { ChatComposerCommandId } from "@/lib/session/chat-composer";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
type ChatResponseProvider = "openai" | "anthropic";

function normalizeChatResponseProvider(value: unknown): ChatResponseProvider {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "anthropic"
    ? "anthropic"
    : "openai";
}

const DEFAULT_CHAT_RESPONSE_PROVIDER = normalizeChatResponseProvider(
  process.env.CHAT_RESPONSE_PROVIDER ?? process.env.LLM_PROVIDER ?? "openai",
);
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-5.4";
const ANTHROPIC_CHAT_MODEL =
  process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-4-6";
const ANTHROPIC_API_VERSION =
  process.env.ANTHROPIC_API_VERSION ?? "2023-06-01";

type PromptSanitization = {
  removedApiKeys: number;
  removedAuthTokens: number;
  removedBase64Images: number;
  replacedHtmlBlocks: number;
  replacedFields: Array<{
    path: string;
    originalLength: number;
    replacement: string;
    reason: string;
  }>;
};

function truncateText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value : "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[truncated]`;
}

function memoryContextItems(memoryContext: unknown) {
  const context = memoryContext as
    | { episodic?: unknown[]; previous?: unknown[]; semantic?: unknown[] }
    | null
    | undefined;
  if (!context) return [];
  const seen = new Set<string>();
  return [
    ...(Array.isArray(context.previous) ? context.previous : []),
    ...(Array.isArray(context.episodic) ? context.episodic : []),
    ...(Array.isArray(context.semantic) ? context.semantic : []),
  ].filter((item, index) => {
    const record = item as Record<string, unknown>;
    const keyParts = [
      record.type,
      record.memoryId,
      record.semanticItemId,
      record.id,
    ]
      .filter((value) => value != null && value !== "")
      .map(String);
    const key = keyParts.length > 0 ? keyParts.join(":") : `item:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactMemoryContext(memoryContext: unknown) {
  const context = memoryContext as
    | { episodic?: unknown[]; previous?: unknown[]; semantic?: unknown[] }
    | null
    | undefined;
  if (!context) return null;
  const items = memoryContextItems(context);
  const compactMemoryOrigin = (record: Record<string, unknown>) => {
    const beforeSessionScope =
      typeof record.beforeSessionScope === "string" &&
      record.beforeSessionScope.trim()
        ? record.beforeSessionScope.trim()
        : null;
    if (!beforeSessionScope) return {};
    const sourceMissionId =
      typeof record.sourceMissionId === "string" && record.sourceMissionId.trim()
        ? record.sourceMissionId.trim()
        : null;
    return {
      ...(beforeSessionScope ? { beforeSessionScope } : {}),
      ...(sourceMissionId ? { sourceMissionId } : {}),
    };
  };
  const compactEpisodic = (item: unknown) => {
    const record = item as Record<string, unknown>;
    return {
      episodic: truncateText(record.episodic ?? record.episode, 500),
      ...compactMemoryOrigin(record),
    };
  };
  const compactSemantic = (item: unknown) => {
    const record = item as Record<string, unknown>;
    return {
      semantic: truncateText(record.semantic, 500),
      ...compactMemoryOrigin(record),
    };
  };
  const episodic = items
    .filter((item) => {
      const record = item as Record<string, unknown>;
      return Boolean(truncateText(record.episodic ?? record.episode, 500));
    })
    .slice(0, 10)
    .map(compactEpisodic);
  const semantic = items
    .filter((item) => {
      const record = item as Record<string, unknown>;
      return typeof record.semantic === "string" && record.semantic.trim();
    })
    .slice(0, 10)
    .map(compactSemantic);
  return { episodic, semantic };
}

function memorySimilaritySignal(similarity: unknown) {
  const score = typeof similarity === "number" ? similarity : NaN;
  if (!Number.isFinite(score)) return "mid";
  if (score >= 0.48) return "high";
  if (score <= 0.39) return "low";
  return "mid";
}

function compactPlannerSemanticMemories(memoryItems: unknown[]) {
  return memoryItems
    .map((item) => {
      const record = item as Record<string, unknown>;
      const semantic =
        typeof record.semantic === "string" ? record.semantic.trim() : "";
      if (!semantic) return null;
      const similarity =
        typeof record.similarity === "number" &&
        Number.isFinite(record.similarity)
          ? Number(record.similarity.toFixed(4))
          : null;
      return {
        semantic: truncateText(semantic, 500),
        similarity,
        signal: memorySimilaritySignal(similarity),
      };
    })
    .filter((item): item is {
      semantic: string;
      similarity: number | null;
      signal: string;
    } => Boolean(item))
    .slice(0, 5);
}

function createPromptSanitization(): PromptSanitization {
  return {
    removedApiKeys: 0,
    removedAuthTokens: 0,
    removedBase64Images: 0,
    replacedHtmlBlocks: 0,
    replacedFields: [],
  };
}

function sanitizePromptString(
  value: string,
  path: string,
  sanitization: PromptSanitization,
) {
  let next = value;
  const originalLength = value.length;
  const htmlFencePattern = /```html[\s\S]*?```/gi;
  if (htmlFencePattern.test(next)) {
    htmlFencePattern.lastIndex = 0;
    next = next.replace(htmlFencePattern, () => {
      sanitization.replacedHtmlBlocks += 1;
      return "```html\n[html 코드]\n```";
    });
  }
  if (/<\/?[a-z][\s\S]*?>/i.test(next)) {
    sanitization.replacedHtmlBlocks += 1;
    next = "[html 코드]";
  }
  const base64Pattern = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
  next = next.replace(base64Pattern, () => {
    sanitization.removedBase64Images += 1;
    return "[base64 image removed]";
  });
  const apiKeyPattern = /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/g;
  next = next.replace(apiKeyPattern, () => {
    sanitization.removedApiKeys += 1;
    return "[api key removed]";
  });
  const authPattern =
    /\b(?:Bearer\s+[A-Za-z0-9._~+/-]+=*|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;
  next = next.replace(authPattern, () => {
    sanitization.removedAuthTokens += 1;
    return "[auth token removed]";
  });
  if (next !== value) {
    sanitization.replacedFields.push({
      path,
      originalLength,
      replacement: "[sanitized]",
      reason: "sensitive-or-heavy-content",
    });
  }
  return next;
}

function sanitizeRawPrompt(value: unknown, path = "rawPrompt") {
  const sanitization = createPromptSanitization();
  const visit = (item: unknown, currentPath: string): unknown => {
    if (typeof item === "string") {
      return sanitizePromptString(item, currentPath, sanitization);
    }
    if (Array.isArray(item)) {
      return item.map((child, index) => visit(child, `${currentPath}[${index}]`));
    }
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, child]) => [
          key,
          visit(child, `${currentPath}.${key}`),
        ]),
      );
    }
    return item;
  };
  return {
    rawPrompt: visit(value, path),
    rawPromptSanitization: sanitization,
  };
}

function compactReferences(references: unknown) {
  return Array.isArray(references)
    ? references.slice(0, 8).map((reference) => {
        const record = reference as Record<string, unknown>;
        return {
          id: typeof record.id === "string" ? record.id : undefined,
          title: truncateText(record.title, 200),
          url: typeof record.url === "string" ? record.url : undefined,
          imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : undefined,
        };
      })
    : undefined;
}

const CHAT_PLAN_INTENTS = new Set([
  "answer",
  "create_note",
  "update_note",
  "generate_mockup",
  "edit_mockup",
  "fetch_references",
  "create_design_spec",
  "presentation",
  "clarify",
]);

const MEMORY_RELEVANCE_LEVELS = new Set(["light", "medium", "strong"]);

type ChatPlanIntent =
  | "answer"
  | "create_note"
  | "update_note"
  | "generate_mockup"
  | "edit_mockup"
  | "fetch_references"
  | "create_design_spec"
  | "presentation"
  | "clarify";

type ChatPlanNeeds = {
  mission: boolean;
  activeIdea: boolean;
  designSpec: boolean;
  mockupHtml: boolean;
  selectedElement: boolean;
  citedTexts: boolean;
  citedReferences: boolean;
  conversationHistory: "minimal" | "recent" | "full";
};

type MemoryRelevance = "light" | "medium" | "strong";

type ChatPlan = {
  intent: ChatPlanIntent;
  confidence: number;
  memoryRelevance: MemoryRelevance;
  needs: ChatPlanNeeds;
  reason: string;
};

const CHAT_COMPOSER_COMMAND_IDS = new Set<ChatComposerCommandId>([
  "create_idea",
  "create_design_style",
  "generate_mockup",
  "fetch_references",
]);

function normalizeRequestedCommand(value: unknown): ChatComposerCommandId | null {
  if (!value || typeof value !== "object") return null;
  const id = String((value as Record<string, unknown>).id ?? "");
  return CHAT_COMPOSER_COMMAND_IDS.has(id as ChatComposerCommandId)
    ? (id as ChatComposerCommandId)
    : null;
}

const CHAT_COMPOSER_MENTION_KINDS = new Set([
  "idea",
  "design_brief",
  "design_style",
  "mockup",
]);

function normalizeMentionIdentifier(value: unknown) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 200);
}

function forceRequestedCommand(
  plan: ChatPlan,
  command: ChatComposerCommandId | null,
  citedTextCount: number,
): ChatPlan {
  if (!command) return plan;
  const intentByCommand: Record<ChatComposerCommandId, ChatPlanIntent> = {
    create_idea: "create_note",
    create_design_style: "create_design_spec",
    generate_mockup: "generate_mockup",
    fetch_references: "fetch_references",
  };
  const intent = intentByCommand[command];
  return {
    ...plan,
    intent,
    confidence: 1,
    needs: {
      ...plan.needs,
      mission: true,
      activeIdea: command !== "create_idea" && command !== "fetch_references",
      designSpec: command === "generate_mockup",
      mockupHtml: false,
      selectedElement: false,
      citedTexts: citedTextCount > 0 || plan.needs.citedTexts,
      conversationHistory: "recent",
    },
    reason: `Explicit composer command: ${command}`,
  };
}

type BuiltChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatProviderStreamEvent =
  | { type: "delta"; text: string }
  | { type: "web_search" }
  | { type: "completed"; meta: Record<string, unknown> };

function defaultChatPlan(overrides?: Partial<ChatPlan>): ChatPlan {
  return {
    intent: "answer",
    confidence: 0,
    memoryRelevance: "medium",
    needs: {
      mission: true,
      activeIdea: true,
      designSpec: true,
      mockupHtml: true,
      selectedElement: true,
      citedTexts: true,
      citedReferences: true,
      conversationHistory: "recent",
    },
    reason: "fallback",
    ...overrides,
  };
}

function responseText(response: unknown) {
  let text = "";
  const output = (
    response as {
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    }
  ).output;
  for (const item of output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" || content.type === "text") {
        text += content.text ?? "";
      }
    }
  }
  return text;
}

function anthropicMessages(input: BuiltChatMessage[]) {
  const system = input
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const message of input) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const previous = messages[messages.length - 1];
    if (previous?.role === role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      messages.push({ role, content: message.content });
    }
  }

  if (messages[0]?.role === "assistant") {
    messages.unshift({
      role: "user",
      content: "Continue the conversation using the system instructions.",
    });
  }
  if (messages.length === 0) {
    messages.push({
      role: "user",
      content: "Respond using the system instructions.",
    });
  }

  return { system, messages };
}

async function* createOpenAIChatStream(
  input: BuiltChatMessage[],
  hasRefUrls: boolean,
  allowWebSearch: boolean,
): AsyncGenerator<ChatProviderStreamEvent> {
  const stream = await openai.responses.create({
    model: OPENAI_CHAT_MODEL,
    // On a pure reference-search turn web search is disabled so the model
    // cannot search and describe a site that differs from the cards produced
    // by /api/references. Cited-URL turns still need it (allowWebSearch=true).
    ...(allowWebSearch
      ? {
          tools: [{ type: "web_search_preview" as const }],
          tool_choice: hasRefUrls ? ("required" as const) : ("auto" as const),
        }
      : {}),
    input,
    stream: true,
  });

  for await (const event of stream) {
    const typedEvent = event as {
      type: string;
      delta?: string;
      response?: {
        id?: string;
        model?: string;
        usage?: unknown;
      };
    };
    if (typedEvent.type === "response.web_search_call.searching") {
      yield { type: "web_search" };
    }
    if (typedEvent.type === "response.output_text.delta") {
      yield { type: "delta", text: typedEvent.delta ?? "" };
    }
    if (typedEvent.type === "response.completed" && typedEvent.response) {
      yield {
        type: "completed",
        meta: {
          requestId: typedEvent.response.id,
          model: typedEvent.response.model ?? OPENAI_CHAT_MODEL,
          usage: typedEvent.response.usage,
        },
      };
    }
  }
}

async function* createAnthropicChatStream(
  input: BuiltChatMessage[],
): AsyncGenerator<ChatProviderStreamEvent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when CHAT_RESPONSE_PROVIDER=anthropic");
  }

  const { system, messages } = anthropicMessages(input);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_CHAT_MODEL,
      max_tokens: 4096,
      stream: true,
      system,
      messages,
    }),
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Anthropic chat request failed (${response.status}): ${errorText || response.statusText}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let requestId: string | undefined;
  let usage: unknown;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const dataLine = rawEvent
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice("data:".length).trim();
      if (!data || data === "[DONE]") continue;

      const parsed = JSON.parse(data) as {
        type?: string;
        message?: { id?: string; usage?: unknown };
        delta?: { type?: string; text?: string };
        usage?: unknown;
        error?: { message?: string };
      };
      if (parsed.type === "error") {
        throw new Error(parsed.error?.message ?? "Anthropic stream error");
      }
      if (parsed.type === "message_start") {
        requestId = parsed.message?.id;
        usage = parsed.message?.usage;
      }
      if (
        parsed.type === "content_block_delta" &&
        parsed.delta?.type === "text_delta"
      ) {
        yield { type: "delta", text: parsed.delta.text ?? "" };
      }
      if (parsed.type === "message_delta" && parsed.usage) {
        usage = parsed.usage;
      }
      if (parsed.type === "message_stop") {
        yield {
          type: "completed",
          meta: {
            requestId,
            model: ANTHROPIC_CHAT_MODEL,
            usage,
          },
        };
      }
    }
  }
}

function createChatResponseStream(
  input: BuiltChatMessage[],
  hasRefUrls: boolean,
  provider: ChatResponseProvider,
  allowWebSearch: boolean,
) {
  return provider === "anthropic"
    ? createAnthropicChatStream(input)
    : createOpenAIChatStream(input, hasRefUrls, allowWebSearch);
}

function parseChatPlan(text: string): ChatPlan | null {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const needs = parsed.needs as Record<string, unknown> | undefined;
    const intent = String(parsed.intent ?? "answer");
    const rawMemoryRelevance = String(
      parsed.memoryRelevance ?? parsed.memoryRelavance ?? "medium",
    );
    const conversationHistory = String(
      needs?.conversationHistory ?? "recent",
    );
    return {
      intent: CHAT_PLAN_INTENTS.has(intent)
        ? (intent as ChatPlanIntent)
        : "answer",
      confidence:
        typeof parsed.confidence === "number" &&
        Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
      memoryRelevance: MEMORY_RELEVANCE_LEVELS.has(rawMemoryRelevance)
        ? (rawMemoryRelevance as MemoryRelevance)
        : "medium",
      needs: {
        mission: Boolean(needs?.mission),
        activeIdea: Boolean(needs?.activeIdea),
        designSpec: Boolean(needs?.designSpec),
        mockupHtml: Boolean(needs?.mockupHtml),
        selectedElement: Boolean(needs?.selectedElement),
        citedTexts: Boolean(needs?.citedTexts),
        citedReferences: Boolean(needs?.citedReferences),
        conversationHistory:
          conversationHistory === "minimal" ||
          conversationHistory === "full" ||
          conversationHistory === "recent"
            ? conversationHistory
            : "recent",
      },
      reason:
        typeof parsed.analysis === "string"
          ? truncateText(parsed.analysis, 300)
          : typeof parsed.reason === "string"
          ? truncateText(parsed.reason, 300)
          : "",
    };
  } catch {
    return null;
  }
}

function promptStatusLabel(plan: ChatPlan, fallback: boolean) {
  if (fallback && plan.intent === "answer") return "";
  if (plan.intent === "create_note" || plan.intent === "update_note") {
    return "Reading design brief rules...";
  }
  if (plan.intent === "generate_mockup") return "Reading mockup generation rules...";
  if (plan.intent === "edit_mockup") return "Reading mockup edit rules...";
  if (plan.intent === "fetch_references") return "Reading reference search rules...";
  if (plan.intent === "create_design_spec") return "Reading design style rules...";
  if (plan.intent === "presentation") return "Reading presentation rules...";
  return "";
}

function promptPhaseLabels(
  plan: ChatPlan,
  fallback: boolean,
  selectedContextKeys: string[],
) {
  const phases: string[] = [];
  const ruleLabel = promptStatusLabel(plan, fallback);
  if (ruleLabel) phases.push(ruleLabel);
  const contextLabels: Array<[string, string]> = [
    ["mission", "Reading mission context..."],
    ["missionPreview", "Reading mission summary..."],
    ["activeIdea", "Reading current design brief..."],
    ["designSpec", "Reading design style..."],
    ["mockupHtml", "Reading current mockup..."],
    ["selectedElement", "Reading selected element..."],
    ["citedReferences", "Reading cited references..."],
    ["citedTexts", "Reading cited text..."],
    ["retrievedMemory", "Reading retrieved memory..."],
  ];
  for (const [key, label] of contextLabels) {
    if (selectedContextKeys.includes(key)) phases.push(label);
  }
  phases.push("Writing response...");
  return Array.from(new Set(phases));
}

function forceIntentFromUserText(
  plan: ChatPlan,
  latestUserText: string,
  hasDesignSpec: boolean,
  hasMockupHtml: boolean,
  hasSelectedElement: boolean,
  citedReferenceCount: number,
  citedTextCount: number,
) {
  const text = latestUserText.toLowerCase();

  // A request to FIND/SEARCH references is a reference search even when it
  // mentions design style — searching wins over authoring a design spec. Forcing
  // fetch_references here applies the reference-turn protections (web search off,
  // no prose narration) so the reply cannot describe sites that differ from the
  // actual cards. Mirrors the client isReferenceSearchRequest heuristic.
  const referenceSearch =
    /(레퍼런스|참고\s*(?:자료|이미지|사이트|앱|화면)?|벤치마크|inspiration|reference)s?\s*(찾|검색|추천|보여|골라|추가|모아|뽑|줘)|(?:찾|검색|추천|보여|골라|추가|모아|뽑).{0,12}(레퍼런스|참고\s*(?:자료|이미지|사이트|앱|화면)?|벤치마크|inspiration|reference)s?/i.test(
      text,
    ) ||
    /(레퍼런스|참고\s*(?:자료|이미지|사이트|앱|화면)?|벤치마크|reference)s?(?:\s*(?:섹션|패널|목록|리스트))?\s*[에로]?\s*(?:추가|넣)/i.test(
      text,
    );
  if (referenceSearch) {
    return {
      ...plan,
      intent: "fetch_references" as const,
      confidence: Math.max(plan.confidence, 0.9),
      needs: {
        ...plan.needs,
        mission: true,
        activeIdea: false,
        designSpec: false,
        mockupHtml: false,
        selectedElement: false,
        citedTexts: citedTextCount > 0 || plan.needs.citedTexts,
        conversationHistory: plan.needs.conversationHistory ?? "minimal",
      },
      reason: `${plan.reason ? `${plan.reason} ` : ""}Forced fetch_references because the user asked to find references.`,
    };
  }

  const selectedElementEditRequest =
    hasMockupHtml &&
    hasSelectedElement &&
    /(edit|modify|change|revise|resize|move|remove|delete|replace|make|bigger|smaller|larger|shorter|wider|narrower|darker|lighter|수정|변경|바꿔|바꾸|고쳐|편집|키워|크게|줄여|작게|넓게|좁게|진하게|연하게|밝게|어둡게|옮겨|이동|올려|내려|왼쪽|오른쪽|위로|아래로|삭제|제거|없애|빼|추가|넣어|교체|대체|색|컬러|폰트|문구|텍스트|카피|간격|여백|정렬|모서리|둥글|버튼|이미지|아이콘)/i.test(
      text,
    ) &&
    !/(?:뭐야|무엇|어떤|왜|가능|충분|해도\s*돼|can\s+i|should\s+i|what|why|how)/i.test(
      text,
    );
  if (selectedElementEditRequest) {
    return {
      ...plan,
      intent: "edit_mockup" as const,
      confidence: Math.max(plan.confidence, 0.9),
      needs: {
        ...plan.needs,
        mission: true,
        activeIdea: true,
        designSpec: true,
        mockupHtml: true,
        selectedElement: true,
        conversationHistory: plan.needs.conversationHistory ?? "recent",
      },
      reason: `${plan.reason ? `${plan.reason} ` : ""}Forced edit_mockup because a selected element exists and the user requested a targeted visual or copy change.`,
    };
  }

  const styleRemakeGenerateRequest =
    hasDesignSpec &&
    (citedReferenceCount > 0 ||
      /(레퍼런스|참고|reference|스타일|느낌|무드|톤|방향|style|mood|direction)/i.test(
        text,
      )) &&
    /(아예\s*(새|새로운|다른)|다른\s*(스타일|느낌|무드|톤|방향|레퍼런스)|새로운\s*(스타일|느낌|무드|톤|방향|버전|시안)|새\s*(버전|시안|디자인|목업)|다시\s*(만들|생성|제작)|새로\s*(만들|생성|제작)|레퍼런스\s*(처럼|기반|따라|맞춰).{0,20}(만들|생성|제작)|완전(히)?\s*(새|다른)|remake|recreate|regenerate|redo|new\s+(version|design|mockup|style|mood|direction)|different\s+(style|mood|direction)|based\s+on\s+(this|the)\s+reference)/i.test(
      text,
    );
  if (styleRemakeGenerateRequest) {
    return {
      ...plan,
      intent: "generate_mockup" as const,
      confidence: Math.max(plan.confidence, 0.9),
      needs: {
        ...plan.needs,
        mission: true,
        activeIdea: true,
        designSpec: true,
        mockupHtml: false,
        selectedElement: false,
        citedReferences: citedReferenceCount > 0,
        conversationHistory: plan.needs.conversationHistory ?? "recent",
      },
      reason: `${plan.reason ? `${plan.reason} ` : ""}Forced generate_mockup because the user asked to remake as a new style/reference direction; the client will fork a new idea.`,
    };
  }

  const explicitDesignSpec =
    /(디자인\s*스타일|디자인스타일|스타일\s*가이드|디자인\s*시스템|비주얼\s*스타일|시각\s*스타일|visual\s*style|visual\s*style\s*notes|design\s*spec|design\s*style|style\s*guide|design\s*system)/i.test(
      text,
    );
  const styleCreation =
    /(스타일|색|컬러|color|colour|타이포|typography|폰트|font|무드|mood|톤|tone|ui\s*style|브랜드\s*톤|brand\s*tone|avoid|피해야|하지\s*말|레퍼런스\s*섹션|style\s*section)/i.test(
      text,
    ) &&
    /(만들|작성|정의|정리|설계|생성|제안|추천|잡아|세팅|정해|create|define|make|generate)/i.test(
      text,
    ) &&
    !/(목업|mockup|화면|시각화|stitch|스티치)/i.test(text);

  if (!explicitDesignSpec && !styleCreation) return plan;

  return {
    ...plan,
    intent: "create_design_spec" as const,
    confidence: Math.max(plan.confidence, 0.9),
    needs: {
      ...plan.needs,
      mission: true,
      activeIdea: true,
      designSpec: hasDesignSpec,
      mockupHtml: false,
      selectedElement: false,
      conversationHistory: plan.needs.conversationHistory ?? "recent",
    },
    reason: `${plan.reason ? `${plan.reason} ` : ""}Forced create_design_spec because the user explicitly requested design style rules.`,
  };
}

async function createChatPlan(input: Record<string, unknown>) {
  try {
    const response = await openai.responses.create({
      model: "gpt-5.4",
      input: [
        {
          role: "system",
          content: chatPlannerPrompt(JSON.stringify(input)),
        },
      ],
    });
    const plan = parseChatPlan(responseText(response));
    if (!plan) {
      return {
        plan: defaultChatPlan({ reason: "planner parse failure" }),
        fallback: true,
      };
    }
    return { plan, fallback: false };
  } catch (error) {
    console.warn("[api/chat] prompt planner failed", error);
    return {
      plan: defaultChatPlan({ reason: "planner request failure" }),
      fallback: true,
    };
  }
}


export async function POST(request: Request) {
  const user = await verifyFirebaseIdToken(request).catch(() => null);
  const {
    messages,
    mockupHtml,
    selectedElement,
    citedReferences,
    missionTitle,
    missionBrief,
    device,
    activeIdea,
    memoryContext,
    designSpec,
    citedTexts,
    review,
    responseProvider,
    referencePreferenceContext,
    requestedCommand,
    mentionedArtifact,
  } = await request.json();
  const requestedCommandId = normalizeRequestedCommand(requestedCommand);
  const mentionRecord =
    mentionedArtifact && typeof mentionedArtifact === "object"
      ? (mentionedArtifact as Record<string, unknown>)
      : null;
  const mentionKind = String(mentionRecord?.kind ?? "");
  const mentionIdeaId = normalizeMentionIdentifier(mentionRecord?.ideaId);
  const normalizedMention =
    mentionRecord &&
    mentionIdeaId &&
    CHAT_COMPOSER_MENTION_KINDS.has(mentionKind)
      ? {
          kind: mentionKind,
          ideaId: mentionIdeaId,
          artifactId: normalizeMentionIdentifier(mentionRecord.artifactId),
          label: truncateText(mentionRecord.label, 200).replace(/[\r\n]+/g, " "),
        }
      : null;
  const reviewConfig = (review && typeof review === "object"
    ? review
    : null) as {
    missionId?: unknown;
    turnId?: unknown;
    userMessageId?: unknown;
    assistantMessageId?: unknown;
    query?: unknown;
  } | null;
  const reviewMissionId = String(reviewConfig?.missionId ?? "").trim();
  const reviewTurnId = String(
    reviewConfig?.turnId ?? reviewConfig?.assistantMessageId ?? "",
  ).trim();
  const canStoreReviewTurn = Boolean(user && reviewMissionId && reviewTurnId);
  const selectedResponseProvider =
    user && isAdminEmail(user.email)
      ? normalizeChatResponseProvider(responseProvider ?? DEFAULT_CHAT_RESPONSE_PROVIDER)
      : DEFAULT_CHAT_RESPONSE_PROVIDER;
  const deviceLabel =
    device === "mobile" ? "모바일 (390×844px)" : "PC (1280×900px)";
  const messageList = Array.isArray(messages) ? messages : [];
  const latestUserMessage = [...messageList]
    .reverse()
    .find((message: { role?: string }) => message.role === "user");
  const latestUserText =
    typeof latestUserMessage?.content === "string"
      ? latestUserMessage.content.trim()
      : "";
  const memoryItems = memoryContextItems(memoryContext);
  const plannerInput = {
    latestUserText: truncateText(latestUserText, 1200),
    recentMessages: messageList.slice(-3).map(
      (message: { role?: string; content?: string }) => ({
        role: message.role,
        content: truncateText(message.content, 700),
      }),
    ),
    uiState: {
      hasMockupHtml: Boolean(mockupHtml),
      hasSelectedElement: Boolean(selectedElement),
      citedReferenceCount: Array.isArray(citedReferences)
        ? citedReferences.length
        : 0,
      citedTextCount: Array.isArray(citedTexts) ? citedTexts.length : 0,
      hasActiveIdea: Boolean(activeIdea),
      hasDesignSpec: Boolean(designSpec),
      retrievedMemoryCount: memoryItems.length,
      device: device === "mobile" ? "mobile" : "desktop",
    },
    semanticMemories: compactPlannerSemanticMemories(memoryItems),
    mission: {
      title: truncateText(missionTitle, 200),
      briefPreview: truncateText(missionBrief, 500),
    },
    requestedCommand: requestedCommandId,
    mentionedArtifact: normalizedMention,
  };
  const { plan: rawPromptPlan, fallback: promptPlanFallback } =
    await createChatPlan(plannerInput);
  const promptPlan = forceRequestedCommand(
    forceIntentFromUserText(
      rawPromptPlan,
      latestUserText,
      Boolean(designSpec),
      Boolean(mockupHtml),
      Boolean(selectedElement),
      Array.isArray(citedReferences) ? citedReferences.length : 0,
      Array.isArray(citedTexts) ? citedTexts.length : 0,
    ),
    requestedCommandId,
    Array.isArray(citedTexts) ? citedTexts.length : 0,
  );
  const promptPlanReliable =
    !promptPlanFallback && promptPlan.confidence >= 0.55;
  const lowerLatestUserText = latestUserText.toLowerCase();
  const lowConfidenceNeedsMockup =
    Boolean(selectedElement) ||
    /(edit|modify|change|revise|presentation|mockup|html|수정|변경|바꿔|고쳐|편집|발표|목업|화면|현재)/i.test(
      lowerLatestUserText,
    );
  const shouldIncludePlannedContext = (key: keyof ChatPlanNeeds) => {
    if (key === "selectedElement" && selectedElement) return true;
    if (key === "mockupHtml" && selectedElement) return true;
    if (
      key === "citedTexts" &&
      Array.isArray(citedTexts) &&
      citedTexts.length > 0
    )
      return true;
    if (promptPlanFallback) return true;
    if (promptPlanReliable) return Boolean(promptPlan.needs[key]);
    if (key === "mockupHtml") return lowConfidenceNeedsMockup;
    return true;
  };
  const selectedContextKeys = ["system", "device"];
  const markContext = (key: string) => {
    selectedContextKeys.push(key);
  };

  const systemMessages: BuiltChatMessage[] = [
    { role: "system", content: CHAT_AGENT_BASE_PROMPT },
  ];
  if (requestedCommandId) {
    markContext("requestedCommand");
    systemMessages.push({
      role: "system",
      content: `The user explicitly selected the composer command ${requestedCommandId}. Execute the mapped action for this turn. Do not reinterpret it as a different intent.`,
    });
  }
  if (normalizedMention?.ideaId) {
    markContext("mentionedArtifact");
    const mentionTargetLabel: Record<string, string> = {
      idea: "the mentioned idea (시안)",
      design_brief: "the mentioned Design Brief",
      design_style: "the mentioned Design Style",
      mockup: "the mentioned Mockup",
    };
    const target = mentionTargetLabel[normalizedMention.kind] ?? "the mentioned artifact";
    systemMessages.push({
      role: "system",
      content: `The user explicitly mentioned an existing workspace artifact. Kind: ${normalizedMention.kind}; ideaId: ${normalizedMention.ideaId}; artifactId: ${normalizedMention.artifactId || "(none)"}. The client has already aligned activeIdea to this target. Treat the structured target as authoritative. Scope this turn to ${target}: work on that artifact itself and prefer the matching action for its kind. Do not branch into other artifacts or run unrelated actions (for example, generating a Design Style or Mockup when the user mentioned the Design Brief) unless the user explicitly asks for them this turn.`,
    });
  }
  markContext("actionInstruction");
  systemMessages.push({
    role: "system",
    content: chatActionInstructionPrompt(
      promptPlan.intent,
      promptPlanFallback || !promptPlanReliable,
    ),
  });

  systemMessages.push({
    role: "system",
    content: chatDevicePrompt(deviceLabel),
  });

  if (missionTitle || missionBrief) {
    markContext(
      shouldIncludePlannedContext("mission") ? "mission" : "missionPreview",
    );
    systemMessages.push({
      role: "system",
      content: chatMissionPrompt(
        truncateText(missionTitle || "(없음)", 300),
        truncateText(
          missionBrief || "(없음)",
          shouldIncludePlannedContext("mission") ? 1800 : 350,
        ),
      ),
    });
  }

  if (memoryContext) {
    const compactMemory = compactMemoryContext(memoryContext);
    if (
      compactMemory &&
      (compactMemory.episodic.length > 0 || compactMemory.semantic.length > 0)
    ) {
      markContext("retrievedMemory");
      systemMessages.push({
        role: "system",
        content: chatRetrievedMemoryPrompt(
          JSON.stringify(compactMemory),
          promptPlan.memoryRelevance,
        ),
      });
    }
  }

  if (designSpec && shouldIncludePlannedContext("designSpec")) {
    markContext("designSpec");
    systemMessages.push({
      role: "system",
      content: chatDesignSpecPrompt(truncateText(designSpec, 2500)),
    });
  }

  if (
    Array.isArray(citedTexts) &&
    citedTexts.length > 0 &&
    shouldIncludePlannedContext("citedTexts")
  ) {
    markContext("citedTexts");
    systemMessages.push({
      role: "system",
      content: chatCitedTextsPrompt(
        citedTexts.map((text: string) => truncateText(text, 1200)),
      ),
    });
  }

  if (activeIdea && shouldIncludePlannedContext("activeIdea")) {
    markContext("activeIdea");
    systemMessages.push({
      role: "system",
      content: chatActiveIdeaPrompt(
        truncateText(activeIdea.title, 200),
        truncateText(activeIdea.description || "(내용 없음)", 3000),
      ),
    });
  }

  if (latestUserText) {
    markContext("currentRequest");
    systemMessages.push({
      role: "system",
      content: chatCurrentRequestPrompt(),
    });
  }

  if (mockupHtml && shouldIncludePlannedContext("mockupHtml")) {
    markContext("mockupHtml");
    systemMessages.push({
      role: "system",
      content: chatMockupHtmlPrompt(truncateText(mockupHtml, 12000)),
    });
  }

  if (selectedElement && shouldIncludePlannedContext("selectedElement")) {
    markContext("selectedElement");
    systemMessages.push({
      role: "system",
      content: chatSelectedElementPrompt(
        selectedElement.selector,
        truncateText(selectedElement.outerHTML, 3000),
        {
          textContent:
            typeof selectedElement.textContent === "string"
              ? truncateText(selectedElement.textContent, 1000)
              : undefined,
          xpath:
            typeof selectedElement.xpath === "string"
              ? selectedElement.xpath
              : undefined,
          boundingRect:
            selectedElement.boundingRect &&
            typeof selectedElement.boundingRect === "object"
              ? selectedElement.boundingRect
              : undefined,
          viewport:
            selectedElement.viewport && typeof selectedElement.viewport === "object"
              ? selectedElement.viewport
              : undefined,
        },
      ),
    });
  }

  // Build messages, injecting cited reference images into the last user message
  const conversationHistoryMode = promptPlanFallback
    ? "recent"
    : promptPlan.needs.conversationHistory;
  const conversationHistoryLimit =
    conversationHistoryMode === "minimal"
      ? 4
      : conversationHistoryMode === "full"
        ? 20
        : 12;
  markContext(`conversationHistory:${conversationHistoryMode}`);
  const builtMessages: BuiltChatMessage[] = messageList
    .slice(-conversationHistoryLimit)
    .flatMap((message: { role?: string; content?: string }) => {
      if (
        message.role !== "system" &&
        message.role !== "user" &&
        message.role !== "assistant"
      ) {
        return [];
      }
      return [
        {
          role: message.role,
          content: truncateText(message.content, 6000),
        },
      ];
    });

  let includedRefUrls: string[] = [];
  if (
    citedReferences?.length > 0 &&
    shouldIncludePlannedContext("citedReferences")
  ) {
    markContext("citedReferences");
    const titles: string[] = citedReferences.map(
      (r: { title: string }) => r.title,
    );
    const refUrls: string[] = citedReferences
      .map((r: { title: string; url?: string }) => r.url)
      .filter(Boolean) as string[];
    includedRefUrls = refUrls;

    if (refUrls.length > 0) {
      systemMessages.push({
        role: "system",
        content: chatCitedRefsWithUrlPrompt(titles, refUrls),
      });
    } else {
      systemMessages.push({
        role: "system",
        content: chatCitedRefsNoUrlPrompt(titles),
      });
    }

    const lastUserIdx = builtMessages.findLastIndex(
      (m: { role: string }) => m.role === "user",
    );
    if (lastUserIdx !== -1) {
      const originalContent = builtMessages[lastUserIdx].content as string;
      builtMessages[lastUserIdx] = {
        role: "user",
        content: `[인용된 레퍼런스: ${titles.join(", ")}]\n\n${originalContent}`,
      };
    }
  }

  const refPref = referencePreferenceContext as {
    cited?: unknown[];
    kept?: unknown[];
    deleted?: unknown[];
  } | null | undefined;
  if (
    refPref &&
    ((refPref.cited?.length ?? 0) > 0 ||
      (refPref.kept?.length ?? 0) > 0 ||
      (refPref.deleted?.length ?? 0) > 0)
  ) {
    markContext("referencePreference");
    systemMessages.push({
      role: "system",
      content: chatReferencePreferencePrompt(
        refPref as Parameters<typeof chatReferencePreferencePrompt>[0],
      ),
    });
  }

  const hasRefUrls = includedRefUrls.length > 0;
  const rawPromptInput = [...systemMessages, ...builtMessages];
  const { rawPrompt, rawPromptSanitization } =
    sanitizeRawPrompt(rawPromptInput);
  const promptCompact = {
    promptPlan,
    promptPlanFallback,
    selectedContextKeys,
    missionBrief: typeof missionBrief === "string" ? missionBrief : undefined,
    activeIdea: activeIdea
      ? {
          title: truncateText(activeIdea.title, 200),
          description: truncateText(activeIdea.description, 3000),
        }
      : undefined,
    citedTexts: Array.isArray(citedTexts)
      ? citedTexts.map((text: unknown) => truncateText(text, 1200))
      : undefined,
    citedReferences: compactReferences(citedReferences),
    requestedCommand: requestedCommandId,
    mentionedArtifact: normalizedMention,
  };

  const storeReviewTurn = async (meta: Record<string, unknown>) => {
    if (!canStoreReviewTurn || !user) return;
    try {
      const token = await getFirebaseAccessToken();
      const retrieved = memoryContextItems(memoryContext).map((item: unknown) => {
            const record = item as Record<string, unknown>;
            return {
              memoryId: String(record.memoryId ?? record.id ?? ""),
              type: typeof record.type === "string" ? record.type : "memory",
              action:
                typeof record.action === "string"
                  ? truncateText(record.action, 120)
                  : "",
              keyword: Array.isArray(record.keyword)
                ? record.keyword.map(String).slice(0, 12)
                : [],
              episodic: truncateText(record.episodic ?? record.episode, 700),
              semantic:
                typeof record.semantic === "string"
                  ? truncateText(record.semantic, 700)
                  : null,
              input: truncateText(record.input, 700),
              output: truncateText(record.output, 900),
              link: typeof record.link === "string" ? record.link : null,
              embeddingSource:
                typeof record.embeddingSource === "string"
                  ? record.embeddingSource
                  : null,
              sourceMissionId:
                typeof record.sourceMissionId === "string"
                  ? record.sourceMissionId
                  : null,
              beforeSessionScope:
                typeof record.beforeSessionScope === "string"
                  ? record.beforeSessionScope
                  : null,
              schemaVersion:
                typeof record.schemaVersion === "string"
                  ? record.schemaVersion
                  : null,
              weight:
                typeof record.weight === "number"
                  ? record.weight
                  : null,
              weightDelta:
                typeof record.weightDelta === "number"
                  ? record.weightDelta
                  : null,
              similarity:
                typeof record.similarity === "number" ? record.similarity : null,
              source:
                record.source && typeof record.source === "object"
                  ? record.source
                  : null,
            };
          });
      await patchFirestoreDocument(
        `sessions/${user.localId}/missions/${encodeURIComponent(reviewMissionId)}/reviewTurns/${encodeURIComponent(reviewTurnId)}`,
        {
          userMessageId: String(reviewConfig?.userMessageId ?? ""),
          createdAt: Date.now(),
          query: truncateText(reviewConfig?.query, 1200),
          retrieved,
          promptCompact,
          promptPlan,
          promptPlanFallback,
          selectedContextKeys,
          rawPromptActual: rawPromptInput,
          rawPrompt,
          rawPromptSanitization,
          rawResponseMeta: meta,
        },
        token,
      );
    } catch (error) {
      console.warn("[api/chat] failed to store review turn", error);
    }
  };

  // Pure reference-search turns (no cited URLs to visit) disable web search so
  // the reply cannot describe a site different from the cards /api/references
  // returns afterward. See B fix for the card↔chat sync issue.
  const allowWebSearch = !(
    promptPlan.intent === "fetch_references" && !hasRefUrls
  );
  const stream = createChatResponseStream(
    rawPromptInput,
    hasRefUrls,
    selectedResponseProvider,
    allowWebSearch,
  );

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let webSearched = false;
      let responseMeta: Record<string, unknown> = {
        provider: selectedResponseProvider,
        model:
          selectedResponseProvider === "anthropic"
            ? ANTHROPIC_CHAT_MODEL
            : OPENAI_CHAT_MODEL,
        webSearched: false,
      };
      try {
        const phaseLabels = promptPhaseLabels(
          promptPlan,
          promptPlanFallback,
          selectedContextKeys,
        );
        for (const phaseLabel of phaseLabels) {
          controller.enqueue(
            encoder.encode(`[CHAT_PHASE: ${phaseLabel}]\n`),
          );
        }
        for await (const event of stream) {
          if (event.type === "web_search" && !webSearched) {
            webSearched = true;
            responseMeta.webSearched = true;
            controller.enqueue(encoder.encode("[WEB_SEARCHED]\n"));
          }
          if (event.type === "delta") {
            controller.enqueue(encoder.encode(event.text));
          }
          if (event.type === "completed") {
            responseMeta = {
              ...responseMeta,
              ...event.meta,
            };
          }
        }
      } catch (error) {
        const code =
          typeof error === "object" && error && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        responseMeta = {
          ...responseMeta,
          error:
            error instanceof Error
              ? { message: error.message, code }
              : { message: String(error), code },
        };
        controller.enqueue(
          encoder.encode(
            code === "context_length_exceeded"
              ? "입력 내용이 너무 길어서 처리하지 못했습니다. 현재 시안/목업/대화 맥락을 줄인 뒤 다시 시도해주세요."
              : "응답 생성 중 오류가 발생했습니다. 다시 시도해주세요.",
          ),
        );
      } finally {
        await storeReviewTurn(responseMeta);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
