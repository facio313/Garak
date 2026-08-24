export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { service: "garak", status: "ok" },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
