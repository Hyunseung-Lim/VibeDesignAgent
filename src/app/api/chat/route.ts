import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a UI/UX design agent. You help designers by:
1. Generating HTML/CSS mockups from descriptions
2. Editing specific UI elements when a selected element is provided
3. Suggesting design references (real apps, design systems, UI patterns)
4. Discussing design decisions and capturing key ideas
5. Creating pitch deck presentations based on mockups and ideas

OUTPUT RULES:
- To create a NEW UI mockup: write 1–2 sentences explaining the concept and key design decisions. Then output [GENERATE_MOCKUP: {prompt}] on its own line. Then 1–2 sentences describing what will be created.
  - The prompt (write in English) should cover: target device, main layout and sections, key UI components, visual style and color direction, and any specific elements from cited references.
  - Example: [GENERATE_MOCKUP: Mobile onboarding screen with 3-step progress indicator at top, central illustration area, bold headline, subtitle text, and a prominent CTA button at bottom. Clean minimal style with indigo/white palette.]
- To EDIT/MODIFY the current mockup: write 1 sentence explaining what you're changing. Then output [EDIT_MOCKUP: {prompt}] on its own line. Then 1 sentence confirming what changed.
  - The prompt (write in English) should describe specifically what to change and how.
  - Example: [EDIT_MOCKUP: Change the primary button color to coral red, increase the font size of the headline to 28px, and add a subtle drop shadow to the card component.]
- IMPORTANT: Do NOT output HTML or code blocks for UI mockups — Stitch AI generates the visual design from the text prompt.
- To suggest references: write 1 sentence explaining you're searching for references, then output [FETCH_REFERENCES: {query}] on its own line, where {query} is a specific image search query based on what the user asked for (e.g. "toss.tech UI screens" or "onboarding mobile app UI"). If the user asked for a specific site or source, include it in the query (e.g. "site:toss.tech" or "kakao app UI"). Do NOT generate URLs or reference lists yourself — the system will perform a real search automatically.
- To create a presentation/pitch deck: write 1–2 sentences explaining the structure you're creating, then output a JSON structure wrapped in \`\`\`presentation\n{json}\n\`\`\`, then 1 sentence summarizing what was created.
  JSON format: {"title": "Deck Title", "slides": [{"title": "Slide Title", "content": "3-5 key points as plain text (newline-separated)", "imagePrompt": "Vivid visual description for AI image generation of this slide"}]}
  Generate exactly 1 slide that summarizes the entire pitch: title, core problem, solution, key design decisions, and next steps all on one compelling visual.
  imagePrompt must be highly specific and visual: describe the background color/gradient, main visual elements (illustrations, icons, charts), text placement, color palette, and overall style. Example: "Clean white slide, large bold navy title at top, split layout with problem/solution sections, coral accent colors, minimal sans-serif typography".
- When the user asks about a specific website, app, brand, or product — especially one visible in a reference image — use the web_search tool to look it up and provide accurate, up-to-date information.
- For anything else: plain text reply.

When editing a selected element, describe the change in [EDIT_MOCKUP: ...] targeting that specific element.
When reference images are provided, you MUST analyze them directly and describe what you observe: layouts, UI components, color schemes, typography, navigation, visible text, and any specific design patterns. Never refuse to analyze UI screenshots.
Always write surrounding text in the same language the user is using.`;

export async function POST(request: Request) {
  const { messages, mockupHtml, selectedElement, citedReferences, missionTitle, missionBrief, device, activeIdea } = await request.json();
  const deviceLabel = device === "mobile" ? "모바일 (390×844px)" : "PC (1280×900px)";

  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  systemMessages.push({
    role: "system",
    content: `Target device: ${deviceLabel}. Design all mockups for this device's viewport.`,
  });

  if (missionTitle || missionBrief) {
    systemMessages.push({
      role: "system",
      content: `Current mission context:\nTitle: ${missionTitle || "(없음)"}\nBrief: ${missionBrief || "(없음)"}`,
    });
  }

  if (activeIdea) {
    systemMessages.push({
      role: "system",
      content: `The user is currently working on this idea:\nTitle: ${activeIdea.title}\nContent: ${activeIdea.description || "(내용 없음)"}\n\nAll mockups and presentations generated in this conversation should be designed for this idea.`,
    });
  }

  if (mockupHtml) {
    systemMessages.push({
      role: "system",
      content: `Current mockup HTML:\n\`\`\`html\n${mockupHtml}\n\`\`\``,
    });
  }

  if (selectedElement) {
    systemMessages.push({
      role: "system",
      content: `The user has selected this element for editing:\nSelector: ${selectedElement.selector}\nHTML: ${selectedElement.outerHTML}`,
    });
  }

  // Build messages, injecting cited reference images into the last user message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builtMessages: any[] = [...messages];

  if (citedReferences?.length > 0) {
    const imageUrls: string[] = citedReferences
      .map((r: { imageUrl?: string }) => r.imageUrl)
      .filter(Boolean);
    const titles: string[] = citedReferences.map((r: { title: string }) => r.title);
    const refUrls: string[] = citedReferences.map((r: { title: string; url?: string }) => r.url).filter(Boolean) as string[];

    if (refUrls.length > 0) {
      systemMessages.push({
        role: "system",
        content: `The user has cited the following reference URLs. You MUST use web_search to visit each URL and read its actual content before answering — do not rely solely on the screenshot image:\n${refUrls.map((url, i) => `- ${titles[i] ?? url}: ${url}`).join("\n")}`,
      });
    }

    const lastUserIdx = builtMessages.findLastIndex((m: { role: string }) => m.role === "user");
    if (lastUserIdx !== -1 && imageUrls.length > 0) {
      // Fetch images server-side and convert to base64 so OpenAI can reliably access them
      const base64Results = await Promise.allSettled(
        imageUrls.map(async (url) => {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const buffer = await res.arrayBuffer();
          const ct = res.headers.get("content-type") || "image/jpeg";
          return `data:${ct};base64,${Buffer.from(buffer).toString("base64")}`;
        })
      );
      const dataUrls = base64Results
        .filter(r => r.status === "fulfilled")
        .map(r => (r as PromiseFulfilledResult<string>).value);

      const originalContent = builtMessages[lastUserIdx].content as string;
      builtMessages[lastUserIdx] = {
        role: "user",
        content: [
          { type: "input_text", text: `[인용된 레퍼런스: ${titles.join(", ")}]\n\n${originalContent}` },
          ...dataUrls.map(dataUrl => ({
            type: "input_image",
            image_url: dataUrl,
            detail: "high",
          })),
        ],
      };
    } else {
      systemMessages.push({
        role: "system",
        content: `The user is citing these references for inspiration: ${titles.join(", ")}. Use them as design direction.`,
      });
    }
  }

  const hasRefUrls = citedReferences?.some((r: { url?: string }) => r.url);

  const stream = await openai.responses.create({
    model: "gpt-4o",
    tools: [{ type: "web_search_preview" }],
    tool_choice: hasRefUrls ? "required" : "auto",
    input: [
      ...systemMessages,
      ...builtMessages,
    ] as Parameters<typeof openai.responses.create>[0]["input"],
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let webSearched = false;
      for await (const event of stream) {
        if (event.type === "response.web_search_call.searching" && !webSearched) {
          webSearched = true;
          controller.enqueue(encoder.encode("[WEB_SEARCHED]\n"));
        }
        if (event.type === "response.output_text.delta") {
          controller.enqueue(encoder.encode(event.delta));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
