import { CeoPlanSchema } from "@synaptech/shared";
import { createHash } from "node:crypto";

import { getPrisma } from "../db/prisma.js";
import { writeAudit } from "../engines/audit.js";
import { getKillSwitch } from "../engines/kill-switch.js";
import { killSwitchActive, integrationUnavailable } from "../lib/errors.js";
import { getEnv } from "../lib/env.js";
import { buildLocalCeoSafeContext } from "./local-ceo-context.js";
import { requireLocalModelProvider } from "./providers/registry.js";

export const LOCAL_CEO_PILOT_TAG = "pilot:local-ai-ceo";

/**
 * Yerel AI CEO pilotu — yalnızca LOCAL_AI_PILOT + MODEL_PROVIDER=local.
 * Cloud create yok. Sonuçlar açıkça pilot etiketiyle ayrılır.
 * Bağlantı yoksa mock üretmez.
 */
export async function runLocalCeoPilotEvaluation(input?: { chatMessage?: string }) {
  const env = getEnv();
  if (!env.LOCAL_AI_PILOT) {
    throw integrationUnavailable("LOCAL_AI_PILOT=true olmadan yerel CEO pilotu çalışmaz.");
  }
  if (env.CLOUD_AGENT_LIVE_ENABLED || env.CURSOR_CLOUD_MODE === "live") {
    throw integrationUnavailable("Pilot reddedildi: Cloud live açık olmamalı.");
  }

  const kill = await getKillSwitch();
  if (kill.enabled) throw killSwitchActive("Kill switch: yerel CEO pilotu yok.");

  const provider = await requireLocalModelProvider();
  const probe = await provider.probe();
  if (!probe.ok) {
    throw integrationUnavailable(`Yerel LLM probe başarısız; mock yok. ${probe.message}`);
  }
  const context = await buildLocalCeoSafeContext();
  const started = Date.now();

  const completion = await provider.generateCeoPlan({
    goals: context.goals.map((g) => ({
      goalKey: g.goalKey,
      projectSlug: g.projectSlug,
      title: g.title,
      dataSource: g.dataSource,
    })),
    opportunities: context.opportunities
      .filter((o) => o.status === "open" && o.verified)
      .slice(0, 8)
      .map((o) => ({
        id: o.id,
        title: o.title,
        projectSlug: o.projectSlug,
        evidenceRef: o.evidenceRef,
      })),
    openTaskCount: context.openTasks.length,
    instruction: [
      "Pilot değerlendirmesi: dört proje için yapılandırılmış şirket özeti ve görev planı.",
      `pilotTag=${LOCAL_CEO_PILOT_TAG}`,
      "Yalnızca verilen evidenceRef / dataSource alanlarına dayan.",
    ].join(" "),
  });

  const plan = CeoPlanSchema.parse({
    ...completion.parsedPlan,
    requiresOwnerApproval: true,
  });
  const durationMs = Date.now() - started;
  const contentSha = createHash("sha256").update(completion.content, "utf8").digest("hex");

  // Kanıt dayanıklılığı: görevlerdeki projectSlug bağlamda var mı?
  const knownProjects = new Set(context.projects.map((p) => p.slug));
  const groundedTasks = plan.tasks.filter((t) => knownProjects.has(t.projectSlug));
  const groundingRatio = plan.tasks.length ? groundedTasks.length / plan.tasks.length : 0;

  let chat:
    | {
        realAiExecution: boolean;
        modelId: string;
        reply: string;
        durationHint: string | undefined;
      }
    | undefined;
  if (input?.chatMessage) {
    const chatCompletion = await provider.chat({
      message: input.chatMessage,
      contextSummary: JSON.stringify({
        pilotTag: LOCAL_CEO_PILOT_TAG,
        projects: context.projects,
        goals: context.goals.slice(0, 8),
        openTaskCount: context.openTasks.length,
        killSwitchEnabled: context.killSwitchEnabled,
      }),
    });
    chat = {
      realAiExecution: chatCompletion.realAiExecution,
      modelId: chatCompletion.modelId,
      reply: chatCompletion.content,
      durationHint: chatCompletion.evidence.find((e) => e.ref.startsWith("durationMs:"))?.ref,
    };
  }

  await writeAudit({
    category: "autonomy",
    action: "ai.local_ceo_pilot",
    actorKind: "system",
    summary: `Yerel AI CEO pilot kaydı — model=${completion.modelId}, realAi=${completion.realAiExecution}`,
    metadata: {
      pilotTag: LOCAL_CEO_PILOT_TAG,
      modelId: completion.modelId,
      realAiExecution: completion.realAiExecution,
      durationMs,
      contentSha256: contentSha,
      jsonValid: true,
      groundingRatio,
      channel: "local_llm",
      deterministicSeparate: true,
      cloudLive: false,
    },
  });

  // Deterministik özet ayrı kayıt (karıştırılmaz)
  const deterministicSummary = {
    channel: "deterministic" as const,
    realAiExecution: false as const,
    projectCount: context.projects.length,
    goalCount: context.goals.length,
    openOpportunityCount: context.opportunities.filter((o) => o.status === "open").length,
    openTaskCount: context.openTasks.length,
    note: "Bu blok LLM çıktısı değildir; MSSQL sayımlarıdır.",
  };

  return {
    source: "api" as const,
    pilotTag: LOCAL_CEO_PILOT_TAG,
    realAiExecution: completion.realAiExecution === true,
    providerId: completion.providerId,
    modelId: completion.modelId,
    probeOk: true,
    probeMessage: probe.message,
    durationMs,
    contentSha256: contentSha,
    jsonValid: true,
    groundingRatio,
    plan,
    evidence: completion.evidence,
    deterministicSummary,
    chat: chat ?? null,
    cloudLive: false,
    onDemand: false,
    markedScope: "test_pilot_only",
  };
}

/** Pilot görevlerini production iş kuyruğundan ayırmak için etiket kontrolü */
export function isLocalCeoPilotOrigin(origin: string | null | undefined): boolean {
  return Boolean(origin && origin.includes(LOCAL_CEO_PILOT_TAG));
}

export async function countPilotTaggedArtifacts() {
  const prisma = getPrisma();
  const audits = await prisma.auditLog.count({
    where: { action: "ai.local_ceo_pilot" },
  });
  return { pilotAuditCount: audits };
}
