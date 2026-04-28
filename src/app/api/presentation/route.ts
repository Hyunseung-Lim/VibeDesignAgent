import OpenAI from "openai";

export const maxDuration = 120;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type SlideInput = {
  title: string;
  content: string;
  imagePrompt: string;
};

export async function POST(request: Request) {
  const { title, slides } = await request.json();

  if (!slides || !Array.isArray(slides) || slides.length === 0) {
    return Response.json({ error: "slides array required" }, { status: 400 });
  }

  const results = await Promise.allSettled(
    slides.map(async (slide: SlideInput) => {
      const prompt = `Presentation slide for "${title || "Pitch Deck"}". Slide: "${slide.title}". ${slide.imagePrompt}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await openai.images.generate({ model: "gpt-image-2", prompt, n: 1, size: "1536x1024", quality: "medium" } as any) as { data: Array<{ b64_json?: string; url?: string }> };

      const img = response.data[0];
      const imageUrl = img.b64_json
        ? `data:image/png;base64,${img.b64_json}`
        : (img.url ?? "");

      return { title: slide.title, content: slide.content, imageUrl };
    })
  );

  const generatedSlides = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { title: slides[i].title, content: slides[i].content, imageUrl: "" }
  );

  return Response.json({ slides: generatedSlides });
}
