import OpenAI from "openai";
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
  chatProfileMemoryPrompt,
  chatInteractionMemoryPrompt,
  chatDesignSpecPrompt,
  chatCitedTextsPrompt,
  chatActiveIdeaPrompt,
  chatCurrentRequestPrompt,
  chatMockupHtmlPrompt,
  chatSelectedElementPrompt,
  chatCitedRefsWithUrlPrompt,
  chatCitedRefsNoUrlPrompt,
  chatPlannerPrompt,
} from "@/lib/prompts";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function compactMemoryContext(memoryContext: unknown) {
  const context = memoryContext as
    | { episodic?: unknown[]; semantic?: unknown[] }
    | null
    | undefined;
  if (!context) return null;
  const compactItem = (item: unknown) => {
    const record = item as Record<string, unknown>;
    const isProfileInput = record.type === "profile_input";
    return {
      action: truncateText(record.action, 80),
      keyword: Array.isArray(record.keyword)
        ? record.keyword.map(String).slice(0, 8)
        : Array.isArray(record.keywords)
          ? record.keywords.map(String).slice(0, 8)
          : undefined,
      episodic: truncateText(record.episodic ?? record.episode, 500),
      semantic:
        typeof record.semantic === "string"
          ? truncateText(record.semantic, 500)
          : null,
      input: truncateText(record.input, 500),
      output: truncateText(record.output, 700),
      link: typeof record.link === "string" ? record.link : null,
      weight:
        !isProfileInput && typeof record.weight === "number"
          ? record.weight
          : undefined,
      weightDelta:
        !isProfileInput && typeof record.weightDelta === "number"
          ? record.weightDelta
          : undefined,
      similarity:
        typeof record.similarity === "number" ? record.similarity : undefined,
    };
  };
  const episodic = Array.isArray(context.episodic)
    ? context.episodic.slice(0, 8).map(compactItem)
    : [];
  const semantic = Array.isArray(context.semantic)
    ? context.semantic.slice(0, 8).map(compactItem)
    : [];
  return { episodic, semantic };
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
  profileMemory: boolean;
  interactionMemory: boolean;
  activeIdea: boolean;
  designSpec: boolean;
  mockupHtml: boolean;
  selectedElement: boolean;
  citedTexts: boolean;
  citedReferences: boolean;
  conversationHistory: "minimal" | "recent" | "full";
};

type ChatPlan = {
  intent: ChatPlanIntent;
  confidence: number;
  needs: ChatPlanNeeds;
  reason: string;
};

type BuiltChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function defaultChatPlan(overrides?: Partial<ChatPlan>): ChatPlan {
  return {
    intent: "answer",
    confidence: 0,
    needs: {
      mission: true,
      profileMemory: true,
      interactionMemory: true,
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

function parseChatPlan(text: string): ChatPlan | null {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const needs = parsed.needs as Record<string, unknown> | undefined;
    const intent = String(parsed.intent ?? "answer");
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
      needs: {
        mission: Boolean(needs?.mission),
        profileMemory: Boolean(needs?.profileMemory),
        interactionMemory: Boolean(needs?.interactionMemory),
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
        typeof parsed.reason === "string"
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
    return "Reading note rules...";
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
    ["activeIdea", "Reading current note..."],
    ["designSpec", "Reading design style..."],
    ["mockupHtml", "Reading current mockup..."],
    ["selectedElement", "Reading selected element..."],
    ["citedReferences", "Reading cited references..."],
    ["citedTexts", "Reading cited text..."],
    ["profileMemory", "Reading profile memory..."],
    ["interactionMemory", "Reading interaction memory..."],
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
) {
  const text = latestUserText.toLowerCase();
  const explicitDesignSpec =
    /(디자인\s*스타일|디자인스타일|스타일\s*가이드|디자인\s*시스템|design\s*spec|design\s*style|style\s*guide)/i.test(
      text,
    );
  const styleCreation =
    /스타일/i.test(text) &&
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
  } = await request.json();
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
  const semanticMemoryItems = Array.isArray(memoryContext?.semantic)
    ? memoryContext.semantic
    : [];
  const profileMemoryCount = semanticMemoryItems.filter(
    (item: unknown) =>
      item &&
      typeof item === "object" &&
      (item as Record<string, unknown>).type === "profile_input",
  ).length;
  const interactionMemoryCount = semanticMemoryItems.length - profileMemoryCount;
  const plannerInput = {
    latestUserText: truncateText(latestUserText, 1200),
    recentMessages: messageList.slice(-6).map(
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
      profileMemoryCount,
      interactionMemoryCount,
      device: device === "mobile" ? "mobile" : "desktop",
    },
    mission: {
      title: truncateText(missionTitle, 200),
      briefPreview: truncateText(missionBrief, 500),
    },
  };
  const { plan: rawPromptPlan, fallback: promptPlanFallback } =
    await createChatPlan(plannerInput);
  const promptPlan = forceIntentFromUserText(
    rawPromptPlan,
    latestUserText,
    Boolean(designSpec),
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
    if (promptPlanFallback) return true;
    if (promptPlanReliable) return Boolean(promptPlan.needs[key]);
    if (key === "mockupHtml") return lowConfidenceNeedsMockup;
    return true;
  };
  const selectedContextKeys = ["system", "device"];
  const markContext = (key: string) => {
    selectedContextKeys.push(key);
  };

  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_AGENT_BASE_PROMPT },
  ];
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
    const allItems: unknown[] = Array.isArray(memoryContext.semantic)
      ? memoryContext.semantic
      : [];
    const profileItems = allItems.filter(
      (item) =>
        item && typeof item === "object" &&
        (item as Record<string, unknown>).type === "profile_input",
    );
    const interactionItems = allItems.filter(
      (item) =>
        !item ||
        typeof item !== "object" ||
        (item as Record<string, unknown>).type !== "profile_input",
    );

    if (profileItems.length > 0) {
      markContext("profileMemory");
      const lines = profileItems
        .map((item) => {
          const r = item as Record<string, unknown>;
          return `- ${truncateText(r.input ?? r.episodic, 500)}`;
        })
        .join("\n");
      systemMessages.push({
        role: "system",
        content: chatProfileMemoryPrompt(lines),
      });
    }

    if (interactionItems.length > 0) {
      markContext("interactionMemory");
      const compactMemory = compactMemoryContext({
        ...memoryContext,
        semantic: interactionItems,
      });
      systemMessages.push({
        role: "system",
        content: chatInteractionMemoryPrompt(JSON.stringify(compactMemory)),
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
        citedTexts.map((t: string, i: number) => `[인용 ${i + 1}] ${truncateText(t, 1200)}`),
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
      content: chatCurrentRequestPrompt(latestUserText),
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

  const hasRefUrls = includedRefUrls.length > 0;
  const rawPromptInput = [...systemMessages, ...builtMessages] as Parameters<
    typeof openai.responses.create
  >[0]["input"];
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
  };

  const storeReviewTurn = async (meta: Record<string, unknown>) => {
    if (!canStoreReviewTurn || !user) return;
    try {
      const token = await getFirebaseAccessToken();
      const retrieved = Array.isArray(memoryContext?.semantic)
        ? memoryContext.semantic.map((item: unknown) => {
            const record = item as Record<string, unknown>;
            const isProfileInput = record.type === "profile_input";
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
              schemaVersion:
                typeof record.schemaVersion === "string"
                  ? record.schemaVersion
                  : null,
              weight:
                !isProfileInput && typeof record.weight === "number"
                  ? record.weight
                  : null,
              weightDelta:
                !isProfileInput && typeof record.weightDelta === "number"
                  ? record.weightDelta
                  : null,
              similarity:
                typeof record.similarity === "number" ? record.similarity : null,
              source:
                record.source && typeof record.source === "object"
                  ? record.source
                  : null,
            };
          })
        : [];
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

  let stream: Awaited<ReturnType<typeof openai.responses.create>>;
  try {
    stream = await openai.responses.create({
      model: "gpt-5.4",
      tools: [{ type: "web_search_preview" }],
      tool_choice: hasRefUrls ? "required" : "auto",
      input: rawPromptInput,
      stream: true,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "context_length_exceeded") {
      return new Response(
        "입력 내용이 너무 길어서 처리하지 못했습니다. 현재 시안/목업/대화 맥락을 줄인 뒤 다시 시도해주세요.",
        { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    throw error;
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let webSearched = false;
      let responseMeta: Record<string, unknown> = {
        model: "gpt-5.4",
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
          const typedEvent = event as {
            type: string;
            response?: {
              id?: string;
              model?: string;
              usage?: unknown;
            };
          };
          if (
            event.type === "response.web_search_call.searching" &&
            !webSearched
          ) {
            webSearched = true;
            responseMeta.webSearched = true;
            controller.enqueue(encoder.encode("[WEB_SEARCHED]\n"));
          }
          if (event.type === "response.output_text.delta") {
            controller.enqueue(encoder.encode(event.delta));
          }
          if (typedEvent.type === "response.completed" && typedEvent.response) {
            responseMeta = {
              ...responseMeta,
              requestId: typedEvent.response.id,
              model: typedEvent.response.model ?? responseMeta.model,
              usage: typedEvent.response.usage,
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
