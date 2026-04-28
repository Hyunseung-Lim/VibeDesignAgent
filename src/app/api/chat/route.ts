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
  JSON format: {"title": "Deck Title", "slides": [{"title": "Slide Title", "content": "2-3 key points as plain text (newline-separated)", "imagePrompt": "Vivid visual description for AI image generation of this slide"}]}
  Include 5-6 slides: title/cover slide, problem/opportunity, solution/concept, key design decisions, mockup showcase, next steps.
  imagePrompt must be highly specific and visual: describe the background color/gradient, main visual elements (illustrations, icons, charts), text placement, color palette, and overall style. Example: "Clean white slide, large bold navy title 'The Problem' at top-left, split layout with a frustrated user illustration on left and three coral-accented pain point cards on right, minimal sans-serif typography".
- For anything else: plain text reply.

When editing a selected element, describe the change in [EDIT_MOCKUP: ...] targeting that specific element.
Always write surrounding text in the same language the user is using.`;

export async function POST(request: Request) {
  const { messages, mockupHtml, selectedElement, citedReferences, missionTitle, missionBrief, device } = await request.json();
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

  // Build messages, injecting cited reference images into the last user message via vision API
  type OAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
  const builtMessages: OAIMessage[] = [...messages];

  if (citedReferences?.length > 0) {
    const imageUrls: string[] = citedReferences
      .map((r: { imageUrl?: string }) => r.imageUrl)
      .filter(Boolean);
    const titles: string[] = citedReferences.map((r: { title: string }) => r.title);

    // Find last user message and upgrade it to multimodal content
    const lastUserIdx = builtMessages.findLastIndex((m: OAIMessage) => m.role === "user");
    if (lastUserIdx !== -1 && imageUrls.length > 0) {
      const originalContent = builtMessages[lastUserIdx].content as string;
      builtMessages[lastUserIdx] = {
        role: "user",
        content: [
          { type: "text", text: `[인용된 레퍼런스: ${titles.join(", ")}]\n\n${originalContent}` },
          ...imageUrls.map(url => ({
            type: "image_url" as const,
            image_url: { url, detail: "low" as const },
          })),
        ],
      };
    } else {
      // Fallback: no images, just prepend titles as text
      systemMessages.push({
        role: "system",
        content: `The user is citing these references for inspiration: ${titles.join(", ")}. Use them as design direction.`,
      });
    }
  }

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      ...systemMessages,
      ...builtMessages,
    ],
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          controller.enqueue(encoder.encode(delta));
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
