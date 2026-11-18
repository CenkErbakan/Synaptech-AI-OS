const SECRET_PATTERNS = [
  /cursor[_-]?api[_-]?key/gi,
  /authorization\s*[:=]\s*["']?[\w.-]+/gi,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /key_[A-Za-z0-9]{8,}/g,
  /sk-[A-Za-z0-9]{10,}/g,
];

/** Hata / audit metinlerinden kimlik bilgisi sızıntısını azaltır. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return redactSecrets(error.message);
  return redactSecrets(String(error));
}

/** Prompt'a asla API anahtarı veya üretim sırları eklenmez. */
export function buildSafeCloudPrompt(parts: {
  taskId: string;
  title: string;
  description: string;
  projectSlug: string;
  agentRole: string;
}): string {
  return [
    `# SynapTech görev (güvenli prompt)`,
    `Task ID: ${parts.taskId}`,
    `Proje: ${parts.projectSlug}`,
    `Rol: ${parts.agentRole}`,
    ``,
    `## Başlık`,
    parts.title,
    ``,
    `## Açıklama`,
    parts.description,
    ``,
    `## Kurallar`,
    `- Yalnızca izinli test repository üzerinde çalış.`,
    `- main ve master korumalıdır: doğrudan commit, merge veya force-push yapma.`,
    `- Yalnızca cursor/ veya agent/ önekli ayrı bir branch'te çalış.`,
    `- Otomatik PR açma, merge veya deployment yapma (autoCreatePR=false).`,
    `- Production deploy, secret değiştirme veya workflow izin artırma yapma.`,
    `- Onay üretme veya Owner adına karar verme.`,
    `- Prompt içinde API anahtarı veya gizli bilgi arama/isteme.`,
  ].join("\n");
}
