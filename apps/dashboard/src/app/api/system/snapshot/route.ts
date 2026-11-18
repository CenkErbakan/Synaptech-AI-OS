import { connection } from "next/server";

import { buildSystemSnapshot } from "@/server/snapshot";

export async function GET() {
  await connection();
  const snapshot = await buildSystemSnapshot(new Date());
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
