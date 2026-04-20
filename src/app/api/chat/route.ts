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
  - Use inline CSS only. Modern, clean design with good spacing and typography.
  - Include realistic placeholder content, not lorem ipsum.
  - If this is a NEW design (first mockup, or user explicitly asked for a new/different variant): add [NEW_DESIGN] on its own line immediately before the \`\`\`html block.
  - If this is an EDIT/MODIFICATION of an existing mockup (changing a header, color, element, layout tweak, etc.): do NOT add [NEW_DESIGN]. Just output the updated HTML directly.
- To suggest references: output a JSON array wrapped in [REFERENCES]...[/REFERENCES]
  Format: [{"title":"App Name","description":"Key design insight","tag":"Category","url":"https://www.appname.com"}]
  Always include the real homepage URL so a logo thumbnail can be fetched.
- To capture or summarize ideas from the conversation: output a JSON array wrapped in [IDEAS]...[/IDEAS]
  Format: [{"title":"Idea Title","description":"Concise description of the idea or decision"}]
  Use this when the user asks to save ideas, summarize decisions, or explicitly requests idea extraction.
- To create a presentation/pitch deck: output a complete, self-contained HTML file wrapped in \`\`\`presentation ... \`\`\`
  - Use inline CSS only. Design as a slide deck: full-screen slides with prev/next navigation buttons fixed at bottom.
  - Each slide in a <section class="slide"> element. Include a title slide, problem/opportunity, solution/concept, key design decisions, mockup showcase, and next steps.
  - Modern, professional design. Use the mockup and ideas as content source.
  - For images: use https://picsum.photos/seed/{keyword}/800/500 for realistic placeholder photos (replace {keyword} with a relevant word like "design", "team", "product"). Use inline SVG for icons and diagrams. Do NOT use placeholder.com or broken image URLs.
  - The mockup showcase slide should embed the mockup as an <iframe srcdoc="..."> inside the slide, or replicate key UI elements as styled HTML if the HTML is too long.
- For anything else: plain text reply.

When editing a selected element, modify only that element and output the full updated HTML.`;

export async function POST(request: Request) {
  const { messages, mockupHtml, selectedElement, missionTitle, missionBrief } = await request.json();

  const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

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
