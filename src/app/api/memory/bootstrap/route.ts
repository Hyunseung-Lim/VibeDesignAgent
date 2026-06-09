export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      error: "removed",
      replacement: "/api/memory/retrieve",
    },
    {
      status: 410,
      headers: {
        "X-VDA-Replacement": "/api/memory/retrieve",
      },
    },
  );
}
