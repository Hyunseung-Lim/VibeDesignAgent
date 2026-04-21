import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: Request) {
  const { missionTitle, missionBrief } = await request.json();

  if (!missionTitle && !missionBrief) {
    return Response.json({ error: "missionTitle or missionBrief required" }, { status: 400 });
  }

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a senior UX researcher. Given a design mission, suggest 4–6 real apps or products that have well-known, relevant UI patterns the designer should study.

Return ONLY a raw JSON array — no markdown fences, no explanation, no wrapper object:
[
  {
    "title": "App Name — Screen or Flow Name",
    "description": "이 앱의 어떤 부분이 이 미션에 참고할 만한지 한 줄 (한국어, 40자 이내)",
    "tag": "UI pattern keyword",
    "url": "https://www.appname.com"
  }
]

Rules:
- Only include apps you are highly confident exist and are relevant
- Prefer apps with publicly accessible UX
- Include a mix of global and Korean apps when relevant
- URL should be the app's main page or a well-known feature page — do not fabricate deep links`,
        },
        {
          role: "user",
          content: `Mission title: ${missionTitle ?? ""}\nMission brief: ${missionBrief ?? ""}`,
        },
      ],
    });

    const text = res.choices[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return Response.json({ references: [] });
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return Response.json({ references: [] });

    const references = arr.map(
      (r: { title: string; description: string; tag: string; url: string }, i: number) => ({
        id: `ref-${Date.now()}-${i}`,
        title: r.title ?? "",
        description: r.description ?? "",
        tag: r.tag ?? "",
        url: r.url ?? "",
      }),
    );

    return Response.json({ references });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
