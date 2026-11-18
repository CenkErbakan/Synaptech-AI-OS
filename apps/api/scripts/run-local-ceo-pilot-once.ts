/**
 * T-P5E-001 — tek seferlik yerel AI CEO pilotu (otomatik görev oluşturmaz).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

const CONTROL = "http://127.0.0.1:3100/api/control/ai/local-ceo/pilot";
const OUT = path.resolve(process.cwd(), "../../reports/qa/faz-5e-local-ceo-pilot-result.json");

const body = {
  chatMessage:
    "Şirketin mevcut durumuna göre en kritik üç öncelikli görevi ve her birinin gerekçesini kısa Türkçe yaz. Cloud live, On-Demand, müşteri iletişimi veya production deploy önerme.",
};

async function main() {
  const started = Date.now();
  const res = await fetch(CONTROL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: true, raw: text.slice(0, 4000) };
  }
  const envelope = {
    httpStatus: res.status,
    wallClockMs: Date.now() - started,
    result: json,
  };
  writeFileSync(OUT, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  const r = json as Record<string, unknown>;
  console.log(
    JSON.stringify(
      {
        httpStatus: res.status,
        wallClockMs: envelope.wallClockMs,
        realAiExecution: r.realAiExecution,
        modelId: r.modelId,
        jsonValid: r.jsonValid,
        groundingRatio: r.groundingRatio,
        durationMs: r.durationMs,
        error: (r as { error?: { message?: string } }).error?.message,
      },
      null,
      2,
    ),
  );
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
