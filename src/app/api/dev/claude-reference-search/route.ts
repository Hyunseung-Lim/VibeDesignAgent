const ANTHROPIC_API_VERSION =
  process.env.ANTHROPIC_API_VERSION ?? "2023-06-01";
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-4-6";

function sanitizeInput(value: unknown, maxLength = 3000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function extractJsonArray(text: string) {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseReferences(text: string) {
  const arrayText = extractJsonArray(text);
  if (!arrayText) return [];
  try {
    const parsed = JSON.parse(arrayText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function responseText(response: unknown) {
  return (
    (response as { content?: Array<{ type?: string; text?: string }> }).content ??
    []
  )
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function debugContent(response: unknown) {
  const content =
    (response as {
      content?: Array<{
        type?: string;
        name?: string;
        input?: unknown;
        content?: Array<{ type?: string; title?: string; url?: string }>;
        text?: string;
      }>;
    }).content ?? [];
  return content.map((block) => {
    if (block.type === "server_tool_use") {
      return {
        type: block.type,
        name: block.name,
        input: block.input,
      };
    }
    if (block.type === "web_search_tool_result") {
      return {
        type: block.type,
        results: (block.content ?? []).map((result) => ({
          title: result.title,
          url: result.url,
        })),
      };
    }
    if (block.type === "text") {
      return {
        type: block.type,
        text: block.text,
      };
    }
    return { type: block.type };
  });
}

function ensureEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_CLAUDE_REFERENCE_TEST === "1"
  );
}

export async function GET() {
  return Response.json(
    {
      error:
        "This internal test endpoint only runs searches with POST. Open /dev-claude-reference-search.html or send a POST JSON body.",
      method: "POST",
      exampleBody: {
        query: "soft pastel mood tracking wellness app landing page",
        missionTitle: "Daymood",
        missionBrief: "감정 기록 정서 케어 랜딩페이지",
        mode: "style",
        maxResults: 5,
      },
    },
    { status: 405 },
  );
}

export async function OPTIONS() {
  return Response.json(
    { ok: true, methods: ["GET", "POST", "OPTIONS"] },
    {
      headers: {
        Allow: "GET, POST, OPTIONS",
      },
    },
  );
}

export async function POST(request: Request) {
  if (!ensureEnabled()) {
    return Response.json(
      { error: "Dev Claude reference test is disabled." },
      { status: 404 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 },
    );
  }

  let body: {
    query?: unknown;
    missionTitle?: unknown;
    missionBrief?: unknown;
    mode?: unknown;
    maxResults?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = sanitizeInput(body.query, 1000);
  const missionTitle = sanitizeInput(body.missionTitle, 500);
  const missionBrief = sanitizeInput(body.missionBrief, 2000);
  const mode = sanitizeInput(body.mode, 20) === "product" ? "product" : "style";
  const maxResults = Math.min(
    Math.max(Number(body.maxResults) || 5, 1),
    8,
  );

  if (!query && !missionTitle && !missionBrief) {
    return Response.json(
      { error: "query, missionTitle, or missionBrief is required." },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        tools: [
          {
            type: "web_search_20260318",
            name: "web_search",
            max_uses: 5,
          },
        ],
        system: [
          "You are testing Claude web search for a UI/UX reference search pipeline.",
          "Use web search to find live, inspectable UI/UX references.",
          mode === "style"
            ? "Prioritize image-rich visual style references, portfolios, landing pages, app screenshots, and design galleries."
            : "Prioritize official product pages, app pages, landing pages, design systems, concrete case studies, and reputable design articles.",
          "Avoid stock image sites, social posts, generic search/tag/topic pages, thin listicles, and template marketplaces.",
          "Return ONLY a JSON array with this shape: [{\"url\":\"...\",\"title\":\"...\",\"description\":\"...\",\"rationale\":\"...\",\"source\":\"...\"}].",
          "Descriptions and rationales must be short Korean phrases.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              `Mode: ${mode}`,
              `Max results: ${maxResults}`,
              `Mission title: ${missionTitle}`,
              `Mission brief: ${missionBrief}`,
              `Search query: ${query}`,
            ].join("\n"),
          },
        ],
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Anthropic request timed out after 90 seconds."
        : error instanceof Error
          ? error.message
          : "Anthropic request failed before receiving a response.";
    return Response.json({ error: message }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  let raw: unknown;
  try {
    raw = rawText ? JSON.parse(rawText) : { error: "Empty response body." };
  } catch {
    raw = { error: rawText || "Non-JSON response body." };
  }

  if (!response.ok) {
    return Response.json(
      {
        error: `Anthropic request failed (${response.status}).`,
        raw,
      },
      { status: response.status },
    );
  }

  const text = responseText(raw);
  return Response.json({
    model: ANTHROPIC_MODEL,
    mode,
    query,
    references: parseReferences(text).slice(0, maxResults),
    text,
    debugContent: debugContent(raw),
  });
}
