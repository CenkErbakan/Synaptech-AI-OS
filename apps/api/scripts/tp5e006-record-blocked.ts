/**
 * T-P5E-006 — Owner onayını audit'e yazar; canlı pilot çalıştırmaz (izolasyon BLOCKED).
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const { writeAudit } = await import("../src/engines/audit.js");
  const { disconnectPrisma } = await import("../src/db/prisma.js");
  await writeAudit({
    category: "autonomy",
    action: "approval.owner_tp5e006",
    actorKind: "owner",
    summary:
      "T-P5E-006 Owner onayı alındı; canlı Developer/Tester fixture pilotu izolasyon kanıtı eksikliği nedeniyle BLOCKED.",
    metadata: {
      taskId: "T-P5E-006",
      type: "real_ai_provider_pilot",
      verdict: "BLOCKED",
      block: "sandbox_isolation_unproven",
      liveOllamaStarted: false,
      codeChangeApplied: false,
      cloudAllowed: false,
      reasons: [
        "child_process_chroot_or_container=false",
        "network_block=false",
        "package_json_scripts_can_be_arbitrary=true",
      ],
      preflight: "reports/qa/faz-5e-tp5e006-isolation-preflight.json",
    },
  });
  console.log(JSON.stringify({ ok: true, audited: true, liveStarted: false }, null, 2));
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
