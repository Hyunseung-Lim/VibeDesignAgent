import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a UI/UX design agent. You help designers by:
1. Generating HTML/CSS mockups from descriptions
2. Editing specific UI elements when a selected element is provided
3. Suggesting design references (real apps, design systems, UI patterns)
4. Discussing design decisions and capturing key ideas
5. Creating pitch deck presentations based on mockups and ideas

OUTPUT RULES:
- To create or update a mockup: output a complete, self-contained HTML file wrapped in \`\`\`html ... \`\`\`
  - ALWAYS include these CDN links in <head>:
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/daisyui@4/dist/full.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
  - Use Tailwind utility classes and DaisyUI components for all styling. Do NOT use inline styles.
  - After </body>, call <script>lucide.createIcons();</script> to render icons.
  - Use Inter as the base font: <html class="font-[Inter]"> or body { font-family: 'Inter', sans-serif; }
  - Use DaisyUI components (btn, card, navbar, input, badge, avatar, etc.) wherever appropriate.
  - Use Lucide icons (<i data-lucide="icon-name"></i>) for all iconography.
  - Include realistic placeholder content, not lorem ipsum. Use picsum.photos for images.
  - Design at the target device viewport (see context message). For PC: 1280×900px. For mobile: 390×844px with mobile-appropriate touch targets, font sizes, and layout.
  - If this is a NEW design (first mockup, or user explicitly asked for a new/different variant): write 1–2 sentences explaining what you're about to design and key decisions, then output EXACTLY [NEW_DESIGN] on its own line, then a blank line, then the \`\`\`html block, then 1–2 sentences summarizing what was created.
  - If this is an EDIT/MODIFICATION of an existing mockup: write 1 sentence explaining what you're changing, then output the updated HTML block directly, then 1 sentence describing what changed.
- To suggest references: write 1 sentence explaining you're searching for references, then output [FETCH_REFERENCES: {query}] on its own line, where {query} is a specific image search query based on what the user asked for (e.g. "toss.tech UI screens" or "onboarding mobile app UI"). If the user asked for a specific site or source, include it in the query (e.g. "site:toss.tech" or "kakao app UI"). Do NOT generate URLs or reference lists yourself — the system will perform a real search automatically.
- To capture or summarize ideas from the conversation: write 1 sentence before, then output a JSON array wrapped in [IDEAS]...[/IDEAS], then 1 sentence after.
  Format: [{"title":"Idea Title","description":"Concise description of the idea or decision"}]
  Use this when the user asks to save ideas, summarize decisions, or explicitly requests idea extraction.
- To create a presentation/pitch deck: write 1–2 sentences explaining the structure you're creating, then output a complete, self-contained HTML file wrapped in \`\`\`presentation ... \`\`\`, then 1 sentence summarizing what was created.
  - Include Tailwind CDN, DaisyUI, Inter font, and Lucide in <head> (same as mockup rules above).
  - Design as a slide deck: full-screen slides with prev/next navigation buttons fixed at bottom.
  - Each slide in a <section class="slide"> element. Include a title slide, problem/opportunity, solution/concept, key design decisions, mockup showcase, and next steps.
  - Use Tailwind + DaisyUI for all styling. Modern, professional design. Use the mockup and ideas as content source.
  - For images: use https://picsum.photos/seed/{keyword}/800/500 for realistic placeholder photos. Use Lucide icons for iconography.
  - The mockup showcase slide should embed the mockup as an <iframe srcdoc="..."> inside the slide, or replicate key UI elements as styled HTML if the HTML is too long.
- For anything else: plain text reply.

When editing a selected element, modify only that element and output the full updated HTML.
Always write surrounding text in the same language the user is using.`;

export async function POST(request: Request) {
  const { messages, mockupHtml, selectedElement, missionTitle, missionBrief, device } = await request.json();
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

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      ...systemMessages,
      ...messages,
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
