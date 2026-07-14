import OpenAI from "openai";
import {
  LOCAL_DOCUMENT_EDIT_PROMPT,
  LOCAL_ELEMENT_EDIT_PROMPT,
  localDocumentEditUserPrompt,
  localElementEditUserPrompt,
} from "@/lib/prompts";

export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// A selected element bigger than this is a section-level rewrite, not a
// targeted element edit — send those through the regular mockup edit path.
const MAX_ELEMENT_HTML_LENGTH = 40_000;
// Whole-document edits are only used for synthetic artboards; observed Stitch
// and OpenAI-fallback mockups are 17k-35k chars, so this is generous headroom.
const MAX_DOCUMENT_HTML_LENGTH = 150_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stripSelectionMarkers(html: string) {
  return html
    .replace(/\sdata-vda-selected=(?:"true"|'true')/g, "")
    .replace(/\sdata-vda-hovered=(?:"true"|'true')/g, "");
}

function stripMarkdownHtmlFence(content: string) {
  return content
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeForComparison(html: string) {
  return html.replace(/\s+/g, " ").trim();
}

export async function POST(request: Request) {
  const {
    userRequest,
    editInstruction,
    element,
    html,
    device,
    designStyleContent,
  } = (await request.json()) as {
    userRequest?: string;
    editInstruction?: string;
    element?: {
      selector?: string;
      outerHTML?: string;
    } | null;
    html?: string | null;
    device?: string;
    designStyleContent?: string | null;
  };

  const elementHtml =
    typeof element?.outerHTML === "string"
      ? stripSelectionMarkers(element.outerHTML).trim()
      : "";
  const documentHtml =
    !elementHtml && typeof html === "string"
      ? stripSelectionMarkers(html).trim()
      : "";
  if (!userRequest?.trim() || (!elementHtml && !documentHtml)) {
    return Response.json(
      { error: "userRequest and element.outerHTML or html are required" },
      { status: 400 },
    );
  }
  if (elementHtml && elementHtml.length > MAX_ELEMENT_HTML_LENGTH) {
    return Response.json(
      {
        error: `Selected element HTML is too large for a local edit (${elementHtml.length} chars).`,
        code: "local-edit-element-too-large",
      },
      { status: 413 },
    );
  }
  if (documentHtml && documentHtml.length > MAX_DOCUMENT_HTML_LENGTH) {
    return Response.json(
      {
        error: `Mockup HTML is too large for a local document edit (${documentHtml.length} chars).`,
        code: "local-edit-document-too-large",
      },
      { status: 413 },
    );
  }
  const deviceLabel =
    device === "mobile" ? "mobile app screen" : "desktop website";

  if (documentHtml) {
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_LOCAL_EDIT_MODEL ?? "gpt-5.4-mini",
        messages: [
          { role: "system", content: LOCAL_DOCUMENT_EDIT_PROMPT },
          {
            role: "user",
            content: localDocumentEditUserPrompt({
              userRequest,
              editInstruction: editInstruction ?? undefined,
              deviceLabel,
              designStyleContent: designStyleContent ?? undefined,
              documentHtml,
            }),
          },
        ],
      });
      // Unlike the element mode, script tags stay: the mockup document itself
      // carries the Tailwind CDN script it needs to render.
      const updatedHtml = stripMarkdownHtmlFence(
        completion.choices[0]?.message?.content ?? "",
      );
      if (
        !updatedHtml.startsWith("<") ||
        !/(<body\b|<main\b|<section\b|<div\b)/i.test(updatedHtml)
      ) {
        console.warn(
          "[local-edit] document model returned non-HTML output:",
          updatedHtml.slice(0, 300),
        );
        return Response.json(
          {
            error: "Local edit model did not return a usable HTML document.",
            code: "local-edit-invalid-output",
          },
          { status: 502 },
        );
      }
      if (
        normalizeForComparison(updatedHtml) ===
        normalizeForComparison(documentHtml)
      ) {
        return Response.json(
          {
            error: "Local edit produced no change for the mockup document.",
            code: "local-edit-unchanged",
          },
          { status: 409 },
        );
      }
      console.log(
        "[local-edit] document rewritten:",
        JSON.stringify({
          inputLength: documentHtml.length,
          outputLength: updatedHtml.length,
        }),
      );
      return Response.json({ documentHtml: updatedHtml });
    } catch (err) {
      console.error("[local-edit] document error:", errorMessage(err));
      return Response.json({ error: errorMessage(err) }, { status: 500 });
    }
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_LOCAL_EDIT_MODEL ?? "gpt-5.4-mini",
      messages: [
        { role: "system", content: LOCAL_ELEMENT_EDIT_PROMPT },
        {
          role: "user",
          content: localElementEditUserPrompt({
            userRequest,
            editInstruction: editInstruction ?? undefined,
            deviceLabel,
            designStyleContent: designStyleContent ?? undefined,
            selector: element?.selector,
            elementHtml,
          }),
        },
      ],
    });
    const replacementHtml = stripMarkdownHtmlFence(
      completion.choices[0]?.message?.content ?? "",
    )
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .trim();

    if (!replacementHtml.startsWith("<") || !replacementHtml.endsWith(">")) {
      console.warn(
        "[local-edit] model returned non-HTML output:",
        replacementHtml.slice(0, 300),
      );
      return Response.json(
        {
          error: "Local edit model did not return usable element HTML.",
          code: "local-edit-invalid-output",
        },
        { status: 502 },
      );
    }
    if (
      normalizeForComparison(replacementHtml) ===
      normalizeForComparison(elementHtml)
    ) {
      return Response.json(
        {
          error: "Local edit produced no change for the selected element.",
          code: "local-edit-unchanged",
        },
        { status: 409 },
      );
    }
    console.log(
      "[local-edit] element rewritten:",
      JSON.stringify({
        inputLength: elementHtml.length,
        outputLength: replacementHtml.length,
        selector: element?.selector ?? null,
      }),
    );
    return Response.json({ replacementHtml });
  } catch (err) {
    console.error("[local-edit] error:", errorMessage(err));
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
