import type { AcceptanceVerification, AgentWorkResult, ToolEvidenceRecord } from "@synaptech/shared";

const DEFECT_CLAIM =
  /\b(bug|defect|vulnerability|güvenlik açığı|kritik hata|teknik borç|tech debt|broken|regress)/i;

const LINE_OR_CONFIG_EVIDENCE =
  /\b(satır|line|L)\s*\d+\b|\.(csproj|json|ya?ml|config|toml|xml|sln)\b|PackageReference|dependencies|scripts/i;

function blobOf(work: AgentWorkResult): string {
  return [work.summary, work.analysis, work.acceptanceNotes, ...work.recommendations, ...work.risks].join(
    "\n",
  );
}

function citedPaths(work: AgentWorkResult, evidence: ToolEvidenceRecord[]): string[] {
  const readPaths = evidence
    .filter((e) => e.kind === "repo_read" && e.path)
    .map((e) => e.path as string);
  const blob = blobOf(work);
  return readPaths.filter((p) => blob.includes(p));
}

function hasContentDigestRefs(work: AgentWorkResult, evidence: ToolEvidenceRecord[]): boolean {
  const digests = evidence
    .filter((e) => e.kind === "repo_read" && e.stdoutDigest)
    .map((e) => e.stdoutDigest as string);
  const blob = blobOf(work) + work.evidenceUsed.join("\n");
  return digests.some((d) => blob.includes(d) || work.evidenceUsed.some((u) => u.includes(d)));
}

/**
 * Model "test ettim / kod geliştirdim" demesi yeterli değil.
 * Kabul yalnızca bağımsız kanıtla true olabilir.
 */
export function verifyAcceptanceIndependently(input: {
  agentId: string;
  work: AgentWorkResult;
  evidence: ToolEvidenceRecord[];
  toolsEnabled: boolean;
}): AcceptanceVerification {
  const kinds = input.evidence.map((e) => e.kind);
  const hasRepoRead = kinds.includes("repo_read");
  const hasSandboxCmd = kinds.includes("sandbox_command");
  const sandboxCmd = input.evidence.find((e) => e.kind === "sandbox_command");
  const sandboxOk =
    Boolean(sandboxCmd) &&
    sandboxCmd!.exitCode === 0 &&
    Boolean(sandboxCmd!.command) &&
    Boolean(sandboxCmd!.stdoutDigest);
  const diffEv = input.evidence.find((e) => e.kind === "sandbox_diff");
  const hasDiff = Boolean(diffEv);
  const diffNonEmpty = Boolean(diffEv?.stdoutDigest && !/^(empty|0{8,})/i.test(diffEv.stdoutDigest));
  const hasPublicFetch = kinds.includes("public_fetch");
  const blocked =
    kinds.includes("blocked") && !hasRepoRead && !hasSandboxCmd && !hasDiff && !hasPublicFetch;

  const reasons: string[] = [];
  const required: string[] = [];
  let acceptanceMet = false;
  let codeChangeApplied = false;
  let findingCategory: AcceptanceVerification["findingCategory"] = "n/a";
  let modelAcceptanceIgnored = false;

  // Kod değişikliği iddiası: non-developer için her zaman false
  if (input.agentId !== "developer" && input.work.codeChangeApplied) {
    reasons.push("codeChangeApplied yalnızca developer sandbox_diff ile geçerli");
    codeChangeApplied = false;
  }

  if (input.agentId === "tester") {
    required.push("sandbox_command");
    modelAcceptanceIgnored = true;
    if (!hasSandboxCmd || !sandboxCmd?.command) {
      reasons.push("Tester: gerçek komut kaydı yok");
      acceptanceMet = false;
    } else if (sandboxCmd.exitCode !== 0) {
      reasons.push(`Tester: exitCode=${sandboxCmd.exitCode} — başarısız test done olmaz`);
      acceptanceMet = false;
    } else if (!sandboxCmd.stdoutDigest) {
      reasons.push("Tester: stdoutDigest yok — test sonucu kanıtlanamadı");
      acceptanceMet = false;
    } else {
      // Model acceptanceMet yok sayılır; yalnızca gerçek exit 0 + digest
      acceptanceMet = true;
      reasons.push(
        `Tester: bağımsız kanıt — command=${sandboxCmd.command} exit=0 digest=${sandboxCmd.stdoutDigest}`,
      );
      if (input.work.acceptanceMet === false) {
        reasons.push("Not: model acceptanceMet=false idi; kanıt geçtiği için true");
      }
    }
  } else if (input.agentId === "cto") {
    required.push("repo_read");
    const findingKind = input.work.findingKind ?? "none";
    findingCategory =
      findingKind === "structure_inspection" ||
      findingKind === "dependency_analysis" ||
      findingKind === "verified_defect"
        ? findingKind
        : "none";
    const cited = citedPaths(input.work, input.evidence);
    const claimsDefect = DEFECT_CLAIM.test(blobOf(input.work));

    if (!input.toolsEnabled || !hasRepoRead) {
      reasons.push("CTO: repo_read yok — kapsamlı denetim sayılmaz");
      acceptanceMet = false;
    } else if (cited.length < 2) {
      reasons.push("CTO: yapı incelemesi için bile ≥2 dosya yolu atfı gerekir; kabul false");
      acceptanceMet = false;
    } else if (findingKind === "structure_inspection" || findingKind === "dependency_analysis") {
      // Yapı/bağımlılık envanteri ≠ doğrulanmış teknik sorun çözümü
      if (claimsDefect && findingKind !== "verified_defect") {
        reasons.push(
          "CTO: teknik sorun/borç iddiası var ama findingKind=verified_defect değil — acceptanceMet false",
        );
        acceptanceMet = false;
      } else {
        // Envanter tamamlanmış sayılabilir; model iddiası tek başına yetmez → kanıt + kategori
        modelAcceptanceIgnored = true;
        acceptanceMet = true;
        reasons.push(
          `CTO: ${findingKind} kanıtlandı (repo_read + ${cited.length} yol); kapsamlı defect denetimi değil`,
        );
      }
    } else if (findingKind === "verified_defect") {
      const hasLineOrConfig = LINE_OR_CONFIG_EVIDENCE.test(blobOf(input.work));
      const hasDigest = hasContentDigestRefs(input.work, input.evidence);
      modelAcceptanceIgnored = true;
      if (!hasLineOrConfig && !hasDigest) {
        reasons.push(
          "CTO verified_defect: satır/yapılandırma veya içerik digest kanıtı yok — acceptanceMet false",
        );
        acceptanceMet = false;
      } else {
        acceptanceMet = true;
        reasons.push(
          `CTO verified_defect: yol atfı + ${hasLineOrConfig ? "satır/config" : ""} ${hasDigest ? "digest" : ""}`.trim(),
        );
      }
    } else {
      // findingKind none + sadece repo_read/yol → kapsamlı denetim sayılmaz
      reasons.push(
        "CTO: yalnızca repo_read + yol atfı kapsamlı teknik denetim değildir (findingKind=none)",
      );
      acceptanceMet = false;
      modelAcceptanceIgnored = true;
    }
  } else if (input.agentId === "developer") {
    required.push("sandbox_diff");
    modelAcceptanceIgnored = true;
    if (!hasDiff || !diffNonEmpty) {
      codeChangeApplied = false;
      acceptanceMet = false;
      reasons.push("Developer: sandbox diff yok — codeChangeApplied=false, acceptanceMet=false");
    } else {
      codeChangeApplied = true;
      acceptanceMet = true;
      reasons.push("Developer: bağımsız sandbox_diff kanıtı — codeChangeApplied=true");
    }
  } else if (
    input.agentId === "growth-lead" ||
    input.agentId === "seo-specialist" ||
    input.agentId === "content-manager" ||
    input.agentId === "ads-manager" ||
    input.agentId === "security"
  ) {
    // Taslak/analiz: yayın/harcama yok; yapısal şema + Owner bayrağı zorunlu.
    modelAcceptanceIgnored = true;
    const expectedDraft: Record<string, string> = {
      "growth-lead": "research_brief",
      "seo-specialist": "seo_findings",
      "content-manager": "content_draft",
      "ads-manager": "ads_campaign_draft",
      security: "security_risk_review",
    };
    const want = expectedDraft[input.agentId] ?? "none";
    const analysisOk = (input.work.analysis?.trim().length ?? 0) >= 80;
    const recOk = (input.work.recommendations?.length ?? 0) >= 1;
    const ownerFlag = input.work.requiresOwnerApproval !== false;
    const draftOk = input.work.draftKind === want || input.work.draftKind === "none";
    const forbid =
      /\b(yayınlandı|published|kampanya başlat|budget changed|müşteriye gönder|deploy ett|push ettim|merged)\b/i.test(
        blobOf(input.work),
      );
    const securityRiskOk =
      input.agentId !== "security" || (input.work.risks?.length ?? 0) >= 1;
    const securityRepoOk =
      input.agentId !== "security" ||
      (hasRepoRead && citedPaths(input.work, input.evidence).length >= 1);
    const growthFetchOk =
      input.agentId !== "growth-lead" ||
      input.evidence.some(
        (e) =>
          e.kind === "public_fetch" &&
          e.trusted === true &&
          Boolean(e.path) &&
          !/synaptech\.software|synaptech\.com|subify|marivo\.app/i.test(e.path ?? ""),
      );

    if (!analysisOk) {
      reasons.push(`${input.agentId}: analysis <80 karakter — taslak kabul değil`);
      acceptanceMet = false;
    } else if (!recOk) {
      reasons.push(`${input.agentId}: en az 1 recommendation gerekir`);
      acceptanceMet = false;
    } else if (!ownerFlag) {
      reasons.push(`${input.agentId}: requiresOwnerApproval false olamaz`);
      acceptanceMet = false;
    } else if (!draftOk && input.work.draftKind !== want) {
      reasons.push(`${input.agentId}: draftKind=${input.work.draftKind} beklenen=${want}`);
      acceptanceMet = false;
    } else if (forbid) {
      reasons.push(`${input.agentId}: yayın/harcama/ileti iddiası — acceptanceMet false`);
      acceptanceMet = false;
    } else if (!securityRiskOk) {
      reasons.push("security: en az 1 risk maddesi gerekir");
      acceptanceMet = false;
    } else if (input.agentId === "security" && !securityRepoOk) {
      reasons.push("security: repo_read + dosya yolu atfı yok — kaynaklı bulgu değil");
      acceptanceMet = false;
    } else if (input.agentId === "growth-lead" && !growthFetchOk) {
      reasons.push("growth-lead: dış public_fetch (kaynak URL) yok — lead kabul değil");
      acceptanceMet = false;
    } else {
      acceptanceMet = true;
      reasons.push(
        `${input.agentId}: doğrulanabilir taslak/analiz (draftKind=${input.work.draftKind || want}); yayın yok`,
      );
    }
    // draftKind none ama içerik yeterliyse kabul — doğrulayıcı draftKind'i not eder
    if (acceptanceMet && input.work.draftKind === "none") {
      reasons.push(`Not: draftKind none idi; rol varsayılanı ${want} kabul edildi`);
    }
  } else {
    if (input.work.acceptanceMet) {
      reasons.push("Rol için acceptanceMet düşürüldü (bağımsız kanıt yok)");
    }
    acceptanceMet = false;
    modelAcceptanceIgnored = true;
  }

  if (blocked) {
    acceptanceMet = false;
    reasons.push("Araçlar engelli/bağ doğrulanmadı");
  }

  if (acceptanceMet && required.some((r) => !kinds.includes(r as ToolEvidenceRecord["kind"]))) {
    acceptanceMet = false;
    reasons.push("required evidence eksik — fail-closed");
  }

  return {
    acceptanceMet,
    codeChangeApplied,
    reasons,
    requiredEvidenceKinds: required,
    presentEvidenceKinds: [...new Set(kinds)],
    findingCategory,
    modelAcceptanceIgnored,
  };
}
