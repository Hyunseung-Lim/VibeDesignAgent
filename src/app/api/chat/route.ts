import OpenAI from "openai";
import {
  getFirebaseAccessToken,
  patchFirestoreDocument,
  verifyFirebaseIdToken,
} from "@/lib/server/firebaseAdminRest";
import {
  CHAT_SYSTEM_PROMPT,
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
        typeof record.weight === "number" ? record.weight : undefined,
      weightDelta:
        typeof record.weightDelta === "number" ? record.weightDelta : undefined,
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

  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
  ];

  systemMessages.push({
    role: "system",
    content: chatDevicePrompt(deviceLabel),
  });

  if (missionTitle || missionBrief) {
    systemMessages.push({
      role: "system",
      content: chatMissionPrompt(
        truncateText(missionTitle || "(없음)", 300),
        truncateText(missionBrief || "(없음)", 1800),
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

  if (designSpec) {
    systemMessages.push({
      role: "system",
      content: chatDesignSpecPrompt(truncateText(designSpec, 2500)),
    });
  }

  if (Array.isArray(citedTexts) && citedTexts.length > 0) {
    systemMessages.push({
      role: "system",
      content: chatCitedTextsPrompt(
        citedTexts.map((t: string, i: number) => `[인용 ${i + 1}] ${truncateText(t, 1200)}`),
      ),
    });
  }

  if (activeIdea) {
    systemMessages.push({
      role: "system",
      content: chatActiveIdeaPrompt(
        truncateText(activeIdea.title, 200),
        truncateText(activeIdea.description || "(내용 없음)", 3000),
      ),
    });
  }

  const latestUserMessage = [...messages]
    .reverse()
    .find((message: { role?: string }) => message.role === "user");
  const latestUserText =
    typeof latestUserMessage?.content === "string"
      ? latestUserMessage.content.trim()
      : "";
  if (latestUserText) {
    systemMessages.push({
      role: "system",
      content: chatCurrentRequestPrompt(latestUserText),
    });
  }

  if (mockupHtml) {
    systemMessages.push({
      role: "system",
      content: chatMockupHtmlPrompt(truncateText(mockupHtml, 12000)),
    });
  }

  if (selectedElement) {
    systemMessages.push({
      role: "system",
      content: chatSelectedElementPrompt(
        selectedElement.selector,
        truncateText(selectedElement.outerHTML, 3000),
      ),
    });
  }

  // Build messages, injecting cited reference images into the last user message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builtMessages: any[] = Array.isArray(messages)
    ? messages.slice(-12).map((message: { role?: string; content?: string }) => ({
        role: message.role,
        content: truncateText(message.content, 6000),
      }))
    : [];

  if (citedReferences?.length > 0) {
    const titles: string[] = citedReferences.map(
      (r: { title: string }) => r.title,
    );
    const refUrls: string[] = citedReferences
      .map((r: { title: string; url?: string }) => r.url)
      .filter(Boolean) as string[];

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

  const hasRefUrls = citedReferences?.some((r: { url?: string }) => r.url);
  const rawPromptInput = [...systemMessages, ...builtMessages] as Parameters<
    typeof openai.responses.create
  >[0]["input"];
  const { rawPrompt, rawPromptSanitization } =
    sanitizeRawPrompt(rawPromptInput);
  const promptCompact = {
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
            return {
              memoryId: String(record.memoryId ?? record.id ?? ""),
              episodic: truncateText(record.episodic ?? record.episode, 700),
              semantic:
                typeof record.semantic === "string"
                  ? truncateText(record.semantic, 700)
                  : null,
              weight:
                typeof record.weight === "number" ? record.weight : null,
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
