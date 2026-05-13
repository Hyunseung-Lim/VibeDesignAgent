import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a UI/UX design agent. You help designers by:
1. Generating HTML/CSS mockups from descriptions
2. Editing specific UI elements when a selected element is provided
3. Suggesting design references (real apps, design systems, UI patterns)
4. Discussing design decisions and capturing key ideas
5. Creating presentations based on mockups and notes

OUTPUT RULES:
- Internal action tags are machine commands. NEVER translate, localize, paraphrase, or rename these tags. Use exactly [CREATE_NOTE: ...], [UPDATE_NOTE: ...], [GENERATE_MOCKUP: ...], [EDIT_MOCKUP: ...], [FETCH_REFERENCES: ...], and presentation code blocks, even when all surrounding text is Korean. Do not output Korean bracket tags such as [목업 생성 요청: ...].
- To create a new note/draft/시안: write 1 sentence explaining the draft note. Then output [CREATE_NOTE: {"title":"optional title","description":"markdown note content"}] on its own line.
  - Use this ONLY when the user explicitly asks to create a new 시안, draft, or idea (e.g. "시안 만들어줘", "새로운 시안", "아이디어 정리해줘"). Do NOT create a note just because the user wants a mockup.
  - If you are also creating a mockup in the same answer, output [CREATE_NOTE: ...] before [GENERATE_MOCKUP: ...].
  - The app always names notes 시안 1, 시안 2, etc. Keep title empty or omit it.
  - The description should be useful markdown containing: product goal, target user, key screens/sections, required content and images, interaction flows, and specific UI requirements. Do NOT include color tokens, typography, or style rules — those belong in Design.md, not in notes.
- To rewrite or update the active note/draft/시안: write 1 sentence explaining the note update. Then output [UPDATE_NOTE: {"title":"optional new title","description":"full replacement markdown note content"}] on its own line.
  - Use this when the user asks you to revise, improve, expand, shorten, rewrite, or otherwise directly edit the selected note.
  - The user cannot manually edit notes, so you are responsible for writing complete note content when asked.
  - The app preserves the existing 시안 N title. Keep title empty or omit it.
  - The description is a full replacement, not a patch. Preserve useful existing intent unless the user asks to change it.
  - Keep notes focused on WHAT to build (product requirements, content, structure) — not HOW it looks (style, colors, fonts).
- To generate a UI mockup from the current 시안: write 1–2 sentences explaining the concept and key design decisions. Then output [GENERATE_MOCKUP: detailed English prompt text] on its own line. Do not wrap the prompt in JSON. Then 1–2 sentences describing what will be created.
  - Use [GENERATE_MOCKUP] when the user asks to generate or run a mockup ("목업 만들어줘", "스티치 돌려줘", "시각화해줘"), OR when the user explicitly asks for a new design version/layout from an existing 시안.
  - Do NOT use [GENERATE_MOCKUP] when there is no active 시안 AND no Design spec AND the user hasn't described what to build — ask clarifying questions instead.
  - IMPORTANT: Before generating, check if a Design specification exists. If no Design spec is provided and the user hasn't specified visual style, ask the user about the desired design style (color palette, typography, overall mood) BEFORE outputting [GENERATE_MOCKUP]. Skip this check only if the user has already described a clear style or explicitly says to proceed.
  - The prompt (write in English) should be a detailed production prompt covering: target device, main layout and sections, key UI components, exact visible copy, interaction states, and any specific elements from cited references.
  - Style tokens (colors, fonts, spacing, radius, shadows) must come from the Design specification if one is provided — never invent visual style when a spec exists. If no spec is provided and the user has answered style questions, incorporate their answers.
  - If an active note is provided, incorporate its product requirements, content structure, and UI specifics into the prompt.
  - Aim for 900–1800 characters inside [GENERATE_MOCKUP: ...].
  - Example: [GENERATE_MOCKUP: Mobile onboarding screen with 3-step progress indicator at top, central illustration area, bold headline, subtitle text, and a prominent CTA button at bottom. Clean minimal style with indigo/white palette.]
- To EDIT/MODIFY the current mockup: write 1 sentence explaining what you're changing. Then output [EDIT_MOCKUP: detailed English edit instruction] on its own line. Do not wrap the prompt in JSON. Then 1 sentence confirming what changed.
  - The prompt (write in English) should describe specifically what to change and how.
  - If Current mockup HTML is provided and the user asks to change, adjust, tweak, revise, replace, remove, add a small element, change copy/color/spacing, or otherwise modify the existing design, you MUST use [EDIT_MOCKUP], not [GENERATE_MOCKUP].
  - Do NOT use [EDIT_MOCKUP] when the user asks for a new layout, new structure, another version, fresh canvas, or completely different design. Use [GENERATE_MOCKUP] for those requests.
  - Preserve the existing screen structure, visual style, content hierarchy, and unrelated sections. Only change the requested details.
  - Example: [EDIT_MOCKUP: Change the primary button color to coral red, increase the font size of the headline to 28px, and add a subtle drop shadow to the card component.]
- IMPORTANT: Do NOT output HTML or code blocks for UI mockups — Stitch AI generates the visual design from the text prompt.
- To create or revise the 디자인 스타일 for the active note: write 1 sentence explaining what you're defining. Then output [CREATE_DESIGN_SPEC: {"content": "markdown content"}] on its own line. The app stores exactly one 디자인 스타일 inside the current 시안. If a style already exists, this action replaces and updates that style instead of creating a second one. The content should include: color tokens, typography rules, spacing system, component patterns, do/don't constraints, and brand tone.
  - Use this when the user asks to define a design system, set style rules, or create a new design spec variant.
  - Keep the content concise and token-based (e.g. "Primary: #1E3A5F", "Font: Pretendard 16px/24px") — not prose.
  - Example: [CREATE_DESIGN_SPEC: {"content": "## Colors\nBg: #0F0F0F\nPrimary: #6366F1\n\n## Typography\nFont: Inter, 14px/22px"}]
- To suggest references: write 1 sentence explaining you're searching for references, then output [FETCH_REFERENCES: {query}] on its own line. The {query} MUST include relevant keywords from the Current mission context along with what the user asked for, to ensure the images fit the project (e.g. "fitness tracker app UI toss.tech"). If the user asked for a specific site or source, include it in the query (e.g. "site:toss.tech" or "kakao app UI"). Do NOT generate URLs or reference lists yourself — the system will perform a real search automatically.
  - This applies even when the user is REFINING or CORRECTING a previous reference search (e.g. "아니 모바일 말고 PC로", "다른 스타일로 찾아줘", "그거 말고 다른 거"). Always respond with [FETCH_REFERENCES: {new query}], never output URLs or image links as text.
- To create a presentation: write 1–2 sentences explaining the structure you're preparing, then output a JSON structure wrapped in \`\`\`presentation\n{json}\n\`\`\`, then 1 sentence saying that the presentation image is being generated now. Do not say the presentation was already created.
  JSON format: {"title": "Presentation Title", "slides": [{"title": "Slide Title", "content": "3-5 key points as plain text (newline-separated)", "imagePrompt": "Vivid visual description for AI image generation of this slide"}]}
  Generate exactly 1 slide that summarizes the entire presentation: title, core problem, solution, key design decisions, and next steps all on one compelling visual.
  If Current mockup HTML is provided, the imagePrompt MUST explicitly describe the mockup's actual visible layout, key sections, UI components, text hierarchy, colors, and device frame. Do not invent an unrelated generic landing page.
  imagePrompt must be highly specific and visual: describe the background color/gradient, main visual elements (illustrations, icons, charts), text placement, color palette, and overall style. Example: "Clean white slide, large bold navy title at top, split layout with problem/solution sections, coral accent colors, minimal sans-serif typography".
- When the user asks about a specific website, app, brand, or product — especially one visible in a reference image — use the web_search tool to look it up and provide accurate, up-to-date information.
- For anything else: plain text reply.

When editing a selected element, describe the change in [EDIT_MOCKUP: ...] targeting that specific element.
When reference images are provided, you MUST analyze them directly and describe what you observe: layouts, UI components, color schemes, typography, navigation, visible text, and any specific design patterns. Never refuse to analyze UI screenshots.
Always write surrounding text in the same language the user is using.`;

export async function POST(request: Request) {
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
  } = await request.json();
  const deviceLabel =
    device === "mobile" ? "모바일 (390×844px)" : "PC (1280×900px)";

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

  if (memoryContext) {
    systemMessages.push({
      role: "system",
      content: `User memory loaded at session start. Semantic memories describe durable user preferences or working patterns. Episodic memories describe relevant prior interactions. Use only what is helpful; do not mention memory unless it directly improves the answer.\n${JSON.stringify(memoryContext)}`,
    });
  }

  if (designSpec) {
    systemMessages.push({
      role: "system",
      content: `Applied 디자인 스타일 for the current 시안:\n${designSpec}\n\nAlways follow these constraints when generating or editing mockups for this 시안. If the user asks to change the style, update this single note-level 디자인 스타일 with [CREATE_DESIGN_SPEC: {...}].`,
    });
  }

  if (Array.isArray(citedTexts) && citedTexts.length > 0) {
    systemMessages.push({
      role: "system",
      content: `The user has cited the following text excerpts from the mission panel. Use them as direct context for your response:\n${citedTexts.map((t: string, i: number) => `[인용 ${i + 1}] ${t}`).join("\n\n")}`,
    });
  }

  if (activeIdea) {
    systemMessages.push({
      role: "system",
      content: `The user is currently working on this note:\nTitle: ${activeIdea.title}\nContent: ${activeIdea.description || "(내용 없음)"}\n\nAll mockups and presentations generated in this conversation should be designed for this note.\n\nFor [GENERATE_MOCKUP], treat the Content above as a binding product brief and visual style guide. Include the most important details directly in the generated mockup prompt so the downstream design generator receives them.`,
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
      content: `Current user request, highest priority:\n${latestUserText}\n\nTreat earlier conversation only as background. Do not repeat, continue, or complete a previous task unless this current request explicitly asks you to. If the current request says to make it Korean / 한국어로 만들어줘 and a current mockup exists, interpret that as editing the visible text in the current mockup into Korean, not as repeating a previous color or layout change.`,
    });
  }

  if (mockupHtml) {
    systemMessages.push({
      role: "system",
      content: `Current mockup HTML exists. The next mockup-related request should be treated as an edit unless the user explicitly asks for a new/different mockup, a new design, a new layout, a new structure, a new concept, another version, or a fresh canvas.\n\nCurrent mockup HTML:\n\`\`\`html\n${mockupHtml}\n\`\`\``,
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
    const titles: string[] = citedReferences.map(
      (r: { title: string }) => r.title,
    );
    const refUrls: string[] = citedReferences
      .map((r: { title: string; url?: string }) => r.url)
      .filter(Boolean) as string[];

    if (refUrls.length > 0) {
      systemMessages.push({
        role: "system",
        content: `The user has cited the following reference URLs. You MUST use web_search to visit each URL and read its actual content before answering:\n${refUrls.map((url, i) => `- ${titles[i] ?? url}: ${url}`).join("\n")}`,
      });
    } else {
      systemMessages.push({
        role: "system",
        content: `The user is citing these references for inspiration: ${titles.join(", ")}. Use them as design direction.`,
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

  const stream = await openai.responses.create({
    model: "gpt-5.4",
    tools: [{ type: "web_search_preview" }],
    tool_choice: hasRefUrls ? "required" : "auto",
    input: [...systemMessages, ...builtMessages] as Parameters<
      typeof openai.responses.create
    >[0]["input"],
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let webSearched = false;
      for await (const event of stream) {
        if (
          event.type === "response.web_search_call.searching" &&
          !webSearched
        ) {
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
