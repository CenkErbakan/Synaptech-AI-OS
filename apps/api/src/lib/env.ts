import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { z } from "zod";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
loadDotenv();

const boolFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return defaultValue;
  }, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3101),
  DATABASE_URL: z.string().min(1),
  SYNAPTECH_OWNER_TOKEN: z.string().min(24),
  SYNAPTECH_SYSTEM_TOKEN: z.string().min(24),
  SYNAPTECH_REPO_ROOT: z.string().default("../.."),
  KILL_SWITCH_FILE: z.string().default("config/kill-switch.json"),
  /** Cursor Cloud API anahtarı — yalnızca backend; asla log/audit/frontend'e yazılmaz. */
  CURSOR_API_KEY: z.string().optional(),
  CURSOR_API_BASE_URL: z.string().url().default("https://api.cursor.com"),
  /** Varsayılan false — gerçek ücretli Cloud Agent çalıştırma kapalı (Faz 4A). */
  CLOUD_AGENT_LIVE_ENABLED: boolFromEnv(false),
  /** mock | live — live yalnızca CLOUD_AGENT_LIVE_ENABLED ile birlikte anlamlı. */
  CURSOR_CLOUD_MODE: z.enum(["mock", "live"]).default("mock"),
  /** Virgülle ayrılmış izinli test repository URL'leri. */
  CLOUD_AGENT_ALLOWED_REPOS: z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }, z.array(z.string())),
  /**
   * Pilot base ref (yalnızca main|master). Üzerine yazılmaz;
   * Cursor workOnCurrentBranch=false ile cursor/ veya agent/ branch açar.
   * Pilot repo varsayılanı master.
   */
  CLOUD_AGENT_STARTING_REF: z
    .string()
    .default("master")
    .transform((v) => v.trim().toLowerCase())
    .refine((v) => v === "main" || v === "master", {
      message: "CLOUD_AGENT_STARTING_REF yalnızca main veya master olabilir",
    }),
  /** Owner On-Demand kapalı olduğunu manuel doğruladı mı. */
  CLOUD_ON_DEMAND_VERIFIED: boolFromEnv(false),
  /**
   * true ise kill switch yalnızca DB'ye yazılır; config/kill-switch.json dokunulmaz.
   * Entegrasyon testleri korumalı dosyayı kirletmesin diye.
   */
  KILL_SWITCH_SKIP_FILE_MIRROR: boolFromEnv(false),
  /** SynapTech kurumsal site — SEO/growth kamu taraması (Faz 5C). */
  SYNAPTECH_WEBSITE_URL: z.string().url().default("https://synaptech.software"),
  /**
   * Faz 5E ModelProvider seçimi.
   * none|mock = gerçek AI yok; local = Ollama-uyumlu (ücretli API değil).
   * Cursor Cloud bu alanın değeri değildir (kod ajanı ayrı kapı).
   */
  MODEL_PROVIDER: z.enum(["none", "mock", "local"]).default("mock"),
  LOCAL_LLM_BASE_URL: z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    return v;
  }, z.string().url().optional()),
  /** 16GB VRAM önerisi: qwen2.5:14b — Owner onayından sonra pull */
  LOCAL_LLM_MODEL: z.string().default("qwen2.5:14b"),
  /** Yerel AI CEO pilot bayrağı — true olmadan pilot endpoint çalışmaz */
  LOCAL_AI_PILOT: boolFromEnv(false),
  /**
   * Scheduler AI CEO modu (Faz 5E).
   * off = yalnızca deterministik (varsayılan; canlı LLM otomasyonu kapalı).
   * mock = test/entegrasyon için MockModelProvider (realAiExecution=false).
   * local = Ollama; erişilemezse hata (sessiz mock yok). Owner onayı olmadan local açılmaz.
   */
  SCHEDULER_AI_CEO_MODE: z.enum(["off", "mock", "local"]).default("off"),
  /** Yerel/mock scheduler CEO değerlendirmesi — UTC günde üst sınır */
  SCHEDULER_AI_CEO_MAX_PER_DAY: z.coerce.number().int().positive().max(24).default(1),
  /**
   * Yerel ajan yürütme (CEO dışı).
   * off = kapalı (varsayılan; sürekli otomasyon yok).
   * mock = test; local = Ollama (Owner onayı olmadan açılmaz).
   */
  LOCAL_AGENT_EXECUTION_MODE: z.enum(["off", "mock", "local"]).default("off"),
  /** Gerçek yerel model ajan çağrıları — UTC günde üst sınır (mock sayılmaz) */
  LOCAL_AGENT_EXECUTION_MAX_PER_DAY: z.coerce.number().int().positive().max(48).default(4),
  /**
   * Ajan repo araçları (RepositoryToolAdapter).
   * off = kapalı (varsayılan). mock = test. read_only = doğrulanmış bağ ile salt-okunur.
   * Owner onayı olmadan read_only açılmaz; yazma/push/PR yok.
   */
  AGENT_REPO_TOOLS_MODE: z.enum(["off", "mock", "read_only"]).default("off"),
  /**
   * İzole sandbox komutları. off|mock|isolated.
   * isolated yalnızca allow-list + temp kopya; ana dizin/production yok.
   */
  AGENT_SANDBOX_MODE: z.enum(["off", "mock", "isolated"]).default("off"),
  /**
   * Kontrollü otonomi tick (CEO sonrası ajan pass).
   * off = kapalı (varsayılan; sürekli otonomi YOK).
   * mock|local = ajan pass; continuousAutomation timer+üç kapı açıksa true türetilir.
   */
  CONTROLLED_AUTONOMY_MODE: z.enum(["off", "mock", "local"]).default("off"),
  /** Tek tick'te en fazla kaç ajan görevi (LLM sırayla; eşzamanlı 1). */
  LOCAL_AGENT_TICK_MAX: z.coerce.number().int().positive().max(4).default(2),
  /** Ajan başına UTC günlük gerçek/mock yürütme üst sınırı */
  LOCAL_AGENT_PER_AGENT_MAX_PER_DAY: z.coerce.number().int().positive().max(24).default(6),
  /** Başarısız görevde sınırlı retry; aşınca Owner escalation */
  CONTROLLED_AUTONOMY_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * GitHub yazma (push / Draft PR). off = kapalı (varsayılan). mock = ağ yok.
   * live bu turda yok; Owner dar onay + kimlik olmadan açılmaz.
   */
  GITHUB_WRITE_MODE: z.enum(["off", "mock", "live"]).default("off"),
  /** GitHub fine-grained token — sohbete yazılmaz. */
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_API_BASE_URL: z.string().url().default("https://api.github.com"),
  EMAIL_OUTREACH_MODE: z.enum(["off", "mock", "live"]).default("off"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Açık gerçek görev kuyruğu üst sınırı — aşıldığında CEO yeni iş uydurmaz. */
  LOCAL_OPS_OPEN_TASK_CAP: z.coerce.number().int().positive().max(200).default(48),
  /** CEO LLM çağrıları arası minimum süre (ms). Testte 0. */
  LOCAL_OPS_CEO_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(86_400_000).default(1_800_000),
  /**
   * true: T-P5E penceresi yokken günlük 2/8 pilot kotası uygulanmaz.
   * Eşzamanlı 1 LLM + kuyruk + idle + backoff kalır. Pencere açıksa pencere limitleri geçerli.
   */
  LOCAL_OPS_UNLIMITED_DAILY: boolFromEnv(true),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Ortam değişkenleri geçersiz: ${msg}`);
  }
  if (parsed.data.SYNAPTECH_OWNER_TOKEN === parsed.data.SYNAPTECH_SYSTEM_TOKEN) {
    throw new Error("SYNAPTECH_OWNER_TOKEN ile SYNAPTECH_SYSTEM_TOKEN farklı olmalı.");
  }
  cached = parsed.data;
  return cached;
}

/** Yalnızca testler — env önbelleğini temizler. */
export function resetEnvCacheForTests(): void {
  cached = null;
}

export function repoRoot(): string {
  const env = getEnv();
  return path.resolve(process.cwd(), env.SYNAPTECH_REPO_ROOT);
}
