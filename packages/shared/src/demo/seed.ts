import type { ActivityEvent } from "../domain/activity";
import type { AgentId } from "../domain/agents";
import { APPROVAL_TYPE_LABELS, type ApprovalRequest } from "../domain/approvals";
import type { DemoGrowthData } from "../domain/growth";
import {
  DEFAULT_TASK_TIMEOUT_MINUTES,
  type Actor,
  type Priority,
  type Task,
  type TaskEvent,
  type TaskStatus,
  type TaskTestResult,
} from "../domain/tasks";

export const DEMO_DATASET_VERSION = 1;

export interface DemoProjectDetails {
  slug: string;
  goals: string[];
  risks: string[];
}

export interface DemoDataset {
  version: typeof DEMO_DATASET_VERSION;
  generatedAt: string;
  tasks: Task[];
  approvals: ApprovalRequest[];
  /** Görev geçmişi dışındaki olaylar; görev olayları `taskHistoryToActivity` ile türetilir. */
  activity: ActivityEvent[];
  growth: DemoGrowthData;
  projectDetails: DemoProjectDetails[];
}

interface DemoStep {
  ago: number;
  actor: Actor;
  type: TaskEvent["type"];
  message: string;
  from?: TaskStatus;
  to?: TaskStatus;
}

interface DemoTaskDefinition {
  id: string;
  title: string;
  description: string;
  project: string;
  assignee: AgentId;
  priority: Priority;
  status: TaskStatus;
  paused?: boolean;
  startedAgo?: number;
  finishedAgo?: number;
  attempts?: number;
  tests?: Omit<TaskTestResult, "at"> & { ago?: number };
  branch?: string;
  model?: string;
  approvalId?: string;
  steps: DemoStep[];
}

const user: Actor = { kind: "user" };
const system: Actor = { kind: "system" };
const agent = (agentId: AgentId): Actor => ({ kind: "agent", agentId });

export function createDemoDataset(now: Date): DemoDataset {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  const buildTask = (definition: DemoTaskDefinition): Task => {
    const history: TaskEvent[] = definition.steps.map((step, index) => ({
      id: `${definition.id}-e${index + 1}`,
      at: at(step.ago),
      actor: step.actor,
      type: step.type,
      message: step.message,
      fromStatus: step.from,
      toStatus: step.to,
    }));
    const first = definition.steps[0];
    const last = definition.steps[definition.steps.length - 1];
    return {
      id: definition.id,
      source: "demo",
      title: definition.title,
      description: definition.description,
      projectSlug: definition.project,
      assignee: definition.assignee,
      priority: definition.priority,
      status: definition.status,
      paused: definition.paused ?? false,
      createdAt: at(first?.ago ?? 0),
      updatedAt: at(last?.ago ?? 0),
      startedAt: definition.startedAgo === undefined ? undefined : at(definition.startedAgo),
      finishedAt: definition.finishedAgo === undefined ? undefined : at(definition.finishedAgo),
      attempts: definition.attempts ?? 0,
      timeoutMinutes: DEFAULT_TASK_TIMEOUT_MINUTES,
      tests: definition.tests
        ? {
            status: definition.tests.status,
            summary: definition.tests.summary,
            at: definition.tests.ago === undefined ? undefined : at(definition.tests.ago),
          }
        : undefined,
      git: definition.branch ? { branch: definition.branch } : undefined,
      model: definition.model,
      approvalId: definition.approvalId,
      dispatchState: "not_applicable",
      history,
    };
  };

  const created = (ago: number, by: Actor, to: TaskStatus = "backlog"): DemoStep => ({
    ago,
    actor: by,
    type: "created",
    message: `Görev oluşturuldu (${to === "backlog" ? "Backlog" : "Planlandı"}).`,
    to,
  });
  const planned = (ago: number, by: Actor): DemoStep => ({
    ago,
    actor: by,
    type: "planned",
    message: "Görev planlandı.",
    from: "backlog",
    to: "planned",
  });
  const moved = (ago: number, by: Actor, from: TaskStatus, to: TaskStatus, note?: string): DemoStep => ({
    ago,
    actor: by,
    type: "status_changed",
    message: note ? `Durum değişti. ${note}` : "Durum değişti.",
    from,
    to,
  });

  const tasks: Task[] = [
    buildTask({
      id: "T-1001",
      title: "Blog sayfaları için meta açıklama denetimi",
      description: "Blog listeleme ve detay sayfalarında eksik veya tekrarlanan meta açıklamaları tespit et.",
      project: "synaptech",
      assignee: "seo-specialist",
      priority: "medium",
      status: "in_progress",
      paused: true,
      startedAgo: 300,
      model: "composer-2.5[fast=false]",
      steps: [
        created(2880, agent("ceo")),
        planned(2800, agent("ceo")),
        moved(300, agent("seo-specialist"), "planned", "in_progress"),
        { ago: 120, actor: user, type: "paused", message: "Görev durduruldu: Kampanya dönemi bitene kadar beklesin." },
      ],
    }),
    buildTask({
      id: "T-1002",
      title: "Ana sayfa Core Web Vitals iyileştirme planı",
      description: "LCP ve CLS sorunlarının kök nedenlerini çıkar, adım adım teknik plan hazırla.",
      project: "synaptech",
      assignee: "cto",
      priority: "high",
      status: "planned",
      steps: [created(1440, agent("ceo")), planned(1400, agent("ceo"))],
    }),
    buildTask({
      id: "T-1003",
      title: "İletişim formu doğrulama hatasının düzeltilmesi",
      description: "Boş e-posta alanıyla gönderilen formun sunucuda hata vermesini düzelt.",
      project: "synaptech",
      assignee: "tester",
      priority: "high",
      status: "testing",
      startedAgo: 600,
      branch: "agent/T-1003-form-dogrulama",
      model: "inherit",
      tests: { status: "not_run", summary: "Testler henüz çalıştırılmadı." },
      steps: [
        created(1300, agent("ceo")),
        planned(1250, agent("cto")),
        moved(600, agent("developer"), "planned", "in_progress"),
        moved(90, agent("developer"), "in_progress", "testing", "Doğrulama için Tester'a devredildi."),
      ],
    }),
    buildTask({
      id: "T-1004",
      title: "Form doğrulama regresyon testleri",
      description: "İletişim formu için boş alan, geçersiz e-posta ve uzun mesaj senaryolarını test et.",
      project: "synaptech",
      assignee: "tester",
      priority: "medium",
      status: "done",
      startedAgo: 400,
      finishedAgo: 200,
      model: "composer-2.5[fast=false]",
      tests: { status: "passed", summary: "18/18 test geçti.", ago: 205 },
      steps: [
        created(1200, agent("cto"), "planned"),
        moved(400, agent("tester"), "planned", "in_progress"),
        moved(260, agent("tester"), "in_progress", "in_review"),
        moved(200, agent("tester"), "in_review", "done", "Kabul kriterleri karşılandı."),
      ],
    }),
    buildTask({
      id: "T-1005",
      title: "Kasım içerik takvimi (TR/EN)",
      description: "Dört haftalık Türkçe ve İngilizce blog takvimi; mevcut blog otomasyonuyla çakışma kontrolü dahil.",
      project: "synaptech",
      assignee: "content-manager",
      priority: "medium",
      status: "in_review",
      startedAgo: 900,
      model: "composer-2.5[fast=false]",
      steps: [
        created(2000, agent("growth-lead")),
        planned(1900, agent("growth-lead")),
        moved(900, agent("content-manager"), "planned", "in_progress"),
        moved(150, agent("content-manager"), "in_progress", "in_review", "SEO kontrolü bekleniyor."),
      ],
    }),
    buildTask({
      id: "T-1006",
      title: "\"Yapay zekâ ile iş süreçleri otomasyonu\" blog taslağı",
      description: "Türkçe taslak; SEO kontrolünden geçti, yayın için kullanıcı onayı bekliyor.",
      project: "synaptech",
      assignee: "content-manager",
      priority: "medium",
      status: "awaiting_approval",
      startedAgo: 1700,
      model: "composer-2.5[fast=false]",
      approvalId: "A-2004",
      steps: [
        created(3000, agent("growth-lead")),
        planned(2950, agent("growth-lead")),
        moved(1700, agent("content-manager"), "planned", "in_progress"),
        moved(800, agent("content-manager"), "in_progress", "in_review"),
        moved(240, agent("content-manager"), "in_review", "awaiting_approval", "Yayın onayı istendi."),
      ],
    }),
    buildTask({
      id: "T-1007",
      title: "Bağımlılık güvenlik taraması",
      description: "Kilit dosyasındaki paketlerin bilinen açık ve lisans kontrolü.",
      project: "synaptech",
      assignee: "security",
      priority: "high",
      status: "done",
      startedAgo: 180,
      finishedAgo: 90,
      model: "inherit",
      steps: [
        created(500, agent("cto"), "planned"),
        moved(180, agent("security"), "planned", "in_progress"),
        moved(100, agent("security"), "in_progress", "in_review"),
        moved(90, agent("security"), "in_review", "done", "Bir orta seviye bulgu raporlandı."),
      ],
    }),
    buildTask({
      id: "T-1008",
      title: "Footer bağlantı düzeltmeleri",
      description: "Kırık iki footer bağlantısını düzelt; değişiklik main'e merge için onay bekliyor.",
      project: "synaptech",
      assignee: "developer",
      priority: "low",
      status: "awaiting_approval",
      startedAgo: 700,
      branch: "agent/T-1008-footer",
      model: "inherit",
      approvalId: "A-2001",
      tests: { status: "passed", summary: "Bağlantı testleri geçti.", ago: 320 },
      steps: [
        created(1000, agent("cto"), "planned"),
        moved(700, agent("developer"), "planned", "in_progress"),
        moved(330, agent("developer"), "in_progress", "in_review", "CTO incelemesi: UYGUN."),
        moved(300, agent("developer"), "in_review", "awaiting_approval", "Korumalı branch merge onayı istendi."),
      ],
    }),
    buildTask({
      id: "T-1009",
      title: "Haftalık şirket raporu (46. hafta)",
      description: "Departman çıktıları, riskler ve gelecek hafta öncelikleri.",
      project: "synaptech",
      assignee: "ceo",
      priority: "medium",
      status: "done",
      startedAgo: 1600,
      finishedAgo: 1500,
      model: "composer-2.5[fast=false]",
      steps: [
        created(1700, user, "planned"),
        moved(1600, agent("ceo"), "planned", "in_progress"),
        moved(1520, agent("ceo"), "in_progress", "in_review"),
        moved(1500, agent("ceo"), "in_review", "done"),
      ],
    }),
    buildTask({
      id: "T-1010",
      title: "Kasım hedeflerinin önceliklendirilmesi",
      description: "Üç projenin açık işlerini etki ve aciliyete göre sırala.",
      project: "synaptech",
      assignee: "ceo",
      priority: "high",
      status: "in_progress",
      startedAgo: 40,
      model: "composer-2.5[fast=false]",
      steps: [created(60, user, "planned"), moved(40, agent("ceo"), "planned", "in_progress")],
    }),
    buildTask({
      id: "T-2001",
      title: "Abonelik yenileme hatırlatma e-postası metni",
      description: "Yenileme tarihinden 7 gün önce gönderilecek bilgilendirme metni.",
      project: "subify",
      assignee: "growth-lead",
      priority: "medium",
      status: "in_review",
      startedAgo: 1100,
      model: "composer-2.5[fast=false]",
      approvalId: "A-2007",
      steps: [
        created(1400, agent("ceo"), "planned"),
        moved(1100, agent("growth-lead"), "planned", "in_progress"),
        moved(600, agent("growth-lead"), "in_progress", "in_review"),
        moved(500, agent("growth-lead"), "in_review", "awaiting_approval", "Müşteriye ileti onayı istendi."),
        moved(180, system, "awaiting_approval", "in_review", "Kullanıcı reddetti; metin yeniden düzenlenecek."),
      ],
    }),
    buildTask({
      id: "T-2002",
      title: "Ödeme sayfası birim testleri",
      description: "Kupon kodu, vergi hesabı ve para birimi biçimlendirme senaryoları.",
      project: "subify",
      assignee: "tester",
      priority: "high",
      status: "failed",
      startedAgo: 260,
      finishedAgo: 70,
      attempts: 1,
      model: "composer-2.5[fast=false]",
      tests: { status: "failed", summary: "3 test başarısız: kupon kodu doğrulaması.", ago: 72 },
      steps: [
        created(900, agent("cto"), "planned"),
        moved(800, agent("tester"), "planned", "in_progress"),
        moved(500, agent("tester"), "in_progress", "failed", "İlk denemede testler başarısız."),
        { ago: 400, actor: user, type: "restarted", message: "Görev yeniden başlatıldı (deneme 1/2).", from: "failed", to: "planned" },
        moved(260, agent("tester"), "planned", "in_progress"),
        moved(70, agent("tester"), "in_progress", "failed", "Kupon doğrulama testleri hâlâ başarısız."),
      ],
    }),
    buildTask({
      id: "T-2003",
      title: "API hız sınırlama (rate limit) tasarımı",
      description: "Kimlik doğrulama uç noktaları için hız sınırlama yaklaşımlarının karşılaştırılması.",
      project: "subify",
      assignee: "cto",
      priority: "high",
      status: "in_review",
      startedAgo: 480,
      model: "inherit",
      steps: [
        created(720, agent("ceo"), "planned"),
        moved(480, agent("cto"), "planned", "in_progress"),
        moved(60, agent("cto"), "in_progress", "in_review", "Security görüşü bekleniyor."),
      ],
    }),
    buildTask({
      id: "T-2004",
      title: "Abonelik tablosu için indeks migration'ı",
      description: "Yenileme sorgularını hızlandırmak için birleşik indeks; Faz 3 veritabanında uygulanacak.",
      project: "subify",
      assignee: "developer",
      priority: "high",
      status: "awaiting_approval",
      startedAgo: 640,
      branch: "agent/T-2004-abonelik-indeks",
      model: "inherit",
      approvalId: "A-2003",
      tests: { status: "passed", summary: "Migration yerel test veritabanında doğrulandı.", ago: 260 },
      steps: [
        created(860, agent("cto"), "planned"),
        moved(640, agent("developer"), "planned", "in_progress"),
        moved(300, agent("developer"), "in_progress", "in_review"),
        moved(250, agent("developer"), "in_review", "awaiting_approval", "Veritabanı migration onayı istendi."),
      ],
    }),
    buildTask({
      id: "T-2005",
      title: "v1.4 sürümünün production'a alınması",
      description: "Testleri geçen v1.4 sürümünün yayına alınması; production deploy onayı gerekiyor.",
      project: "subify",
      assignee: "cto",
      priority: "critical",
      status: "awaiting_approval",
      startedAgo: 200,
      model: "inherit",
      approvalId: "A-2002",
      steps: [
        created(320, agent("ceo"), "planned"),
        moved(200, agent("cto"), "planned", "in_progress"),
        moved(130, agent("cto"), "in_progress", "awaiting_approval", "Production deploy onayı istendi."),
      ],
    }),
    buildTask({
      id: "T-3001",
      title: "Rakip analizi: ilk 5 rakip",
      description: "Herkese açık kaynaklarla konumlandırma, fiyat sayfası ve içerik stratejisi karşılaştırması.",
      project: "marivo",
      assignee: "growth-lead",
      priority: "medium",
      status: "backlog",
      steps: [created(2200, agent("ceo"))],
    }),
    buildTask({
      id: "T-3002",
      title: "Google Ads arama kampanyası taslağı",
      description: "Marka dışı arama kampanyası yapısı, anahtar kelime grupları ve reklam metinleri.",
      project: "marivo",
      assignee: "ads-manager",
      priority: "high",
      status: "awaiting_approval",
      startedAgo: 1000,
      model: "composer-2.5[fast=false]",
      approvalId: "A-2005",
      steps: [
        created(1300, agent("growth-lead"), "planned"),
        moved(1000, agent("ads-manager"), "planned", "in_progress"),
        moved(420, agent("ads-manager"), "in_progress", "in_review"),
        moved(350, agent("ads-manager"), "in_review", "awaiting_approval", "Kampanya başlatma onayı istendi."),
      ],
    }),
    buildTask({
      id: "T-3003",
      title: "Meta Ads bütçe dağılımı önerisi",
      description: "Kampanyalar arası bütçe payının yeniden dağıtılması önerisi.",
      project: "marivo",
      assignee: "ads-manager",
      priority: "medium",
      status: "awaiting_approval",
      startedAgo: 900,
      model: "composer-2.5[fast=false]",
      approvalId: "A-2006",
      steps: [
        created(1250, agent("growth-lead"), "planned"),
        moved(900, agent("ads-manager"), "planned", "in_progress"),
        moved(520, agent("ads-manager"), "in_progress", "awaiting_approval", "Bütçe değişikliği onayı istendi."),
      ],
    }),
    buildTask({
      id: "T-3004",
      title: "Landing page başlık önerileri",
      description: "Ana açılış sayfası için arama niyetine uygun başlık ve alt başlık alternatifleri.",
      project: "marivo",
      assignee: "seo-specialist",
      priority: "low",
      status: "backlog",
      steps: [created(3100, agent("growth-lead"))],
    }),
    buildTask({
      id: "T-3005",
      title: "Eski kampanya kreatiflerinin arşivlenmesi",
      description: "Kullanılmayan reklam görsellerinin listelenmesi.",
      project: "marivo",
      assignee: "ads-manager",
      priority: "low",
      status: "cancelled",
      finishedAgo: 1800,
      steps: [
        created(2500, agent("growth-lead")),
        { ago: 1800, actor: user, type: "cancelled", message: "Görev iptal edildi: Öncelik kalmadı.", from: "backlog", to: "cancelled" },
      ],
    }),
    buildTask({
      id: "T-3006",
      title: "Marivo sitemap.xml doğrulaması",
      description: "Sitemap'teki URL'lerin erişilebilirliği ve kanonik tutarlılığı.",
      project: "marivo",
      assignee: "seo-specialist",
      priority: "medium",
      status: "failed",
      startedAgo: 75,
      finishedAgo: 30,
      model: "composer-2.5[fast=false]",
      steps: [
        created(400, agent("growth-lead"), "planned"),
        moved(75, agent("seo-specialist"), "planned", "in_progress"),
        moved(30, agent("seo-specialist"), "in_progress", "failed", "Site yanıt vermedi; denetim tamamlanamadı."),
      ],
    }),
  ];

  const approval = (definition: Omit<ApprovalRequest, "source" | "executor">): ApprovalRequest => ({
    ...definition,
    source: "demo",
    executor: "trusted-executor",
  });

  const approvals: ApprovalRequest[] = [
    approval({
      id: "A-2001",
      type: "protected_branch_merge",
      requestedBy: "developer",
      projectSlug: "synaptech",
      taskId: "T-1008",
      title: "agent/T-1008-footer → main",
      description: "Footer'daki iki kırık bağlantının düzeltmesi main branch'e alınacak.",
      changeSummary: "2 dosya değişti: footer bileşeni ve bağlantı testi.",
      risk: "medium",
      subject: { kind: "git_commit", ref: "agent/T-1008-footer", version: "sha:4f2c9a1e7b3d55c0a9e1" },
      currentVersion: "sha:4f2c9a1e7b3d55c0a9e1",
      status: "approved",
      decision: { by: "user", at: at(45), decision: "approved", note: "İnceleme uygun.", boundVersion: "sha:4f2c9a1e7b3d55c0a9e1" },
      createdAt: at(300),
    }),
    approval({
      id: "A-2002",
      type: "production_deploy",
      requestedBy: "cto",
      projectSlug: "subify",
      taskId: "T-2005",
      title: "Subify v1.4 production deploy",
      description: "Testleri geçen v1.4 sürümü production ortamına alınacak.",
      changeSummary: "Abonelik yenileme akışı, fatura PDF düzeltmesi ve bağımlılık güncellemeleri.",
      risk: "critical",
      subject: { kind: "git_commit", ref: "release/v1.4", version: "sha:9b81c07d2e4fa6613c2d" },
      currentVersion: "sha:9b81c07d2e4fa6613c2d",
      status: "pending",
      createdAt: at(130),
    }),
    approval({
      id: "A-2003",
      type: "db_migration",
      requestedBy: "developer",
      projectSlug: "subify",
      taskId: "T-2004",
      title: "Abonelik tablosuna birleşik indeks",
      description: "Yenileme sorguları için (status, renew_at) indeksi eklenecek.",
      changeSummary: "1 migration dosyası; geri alma: indeksin kaldırılması.",
      risk: "high",
      subject: {
        kind: "content_sha256",
        ref: "apps/api/prisma/migrations/20261116_abonelik_indeks/migration.sql",
        version: "sha256:2c7e19ab04d3f85e61b0",
      },
      currentVersion: "sha256:2c7e19ab04d3f85e61b0",
      status: "pending",
      createdAt: at(250),
    }),
    approval({
      id: "A-2004",
      type: "blog_publish",
      requestedBy: "content-manager",
      projectSlug: "synaptech",
      taskId: "T-1006",
      title: "\"Yapay zekâ ile iş süreçleri otomasyonu\" yazısının yayını",
      description: "SEO kontrolünden geçen Türkçe taslağın blogda yayımlanması.",
      changeSummary: "1 yeni yazı (TR); mükerrerlik kontrolü yapıldı.",
      risk: "medium",
      subject: {
        kind: "content_sha256",
        ref: "content/blog/drafts/tr/yapay-zeka-is-surecleri.md",
        version: "sha256:71f0de3a9c5b2e8840aa",
      },
      currentVersion: "sha256:71f0de3a9c5b2e8840aa",
      status: "pending",
      createdAt: at(240),
    }),
    approval({
      id: "A-2005",
      type: "ad_campaign_launch",
      requestedBy: "ads-manager",
      projectSlug: "marivo",
      taskId: "T-3002",
      title: "Google Ads marka dışı arama kampanyası",
      description: "Yeni arama kampanyasının başlatılması.",
      changeSummary: "1 kampanya, 3 reklam grubu, 6 reklam metni (taslak).",
      risk: "high",
      subject: {
        kind: "payload_sha256",
        ref: "marketing/ads/proposals/marivo-arama-kampanyasi.md",
        version: "sha256:b4093e6c1d7a22f5e90c",
      },
      currentVersion: "sha256:b4093e6c1d7a22f5e90c",
      status: "pending",
      createdAt: at(350),
    }),
    approval({
      id: "A-2006",
      type: "ad_budget_change",
      requestedBy: "ads-manager",
      projectSlug: "marivo",
      taskId: "T-3003",
      title: "Meta Ads kampanyalar arası bütçe dağılımı",
      description: "Bütçe payının bilinirlik kampanyasından yeniden hedefleme kampanyasına kaydırılması.",
      changeSummary: "Onaydan sonra öneri güncellendi; onaylanan sürüm artık geçerli değil.",
      risk: "high",
      subject: {
        kind: "payload_sha256",
        ref: "marketing/ads/proposals/marivo-meta-butce.md",
        version: "sha256:5a6c8e01f3b7d4429e17",
      },
      currentVersion: "sha256:e81d4b0c92a7f6635b08",
      status: "approved",
      decision: {
        by: "user",
        at: at(400),
        decision: "approved",
        boundVersion: "sha256:5a6c8e01f3b7d4429e17",
      },
      createdAt: at(520),
    }),
    approval({
      id: "A-2007",
      type: "customer_message",
      requestedBy: "growth-lead",
      projectSlug: "subify",
      taskId: "T-2001",
      title: "Abonelik yenileme hatırlatma e-postası",
      description: "Aboneliği 7 gün içinde yenilenecek müşterilere bilgilendirme e-postası.",
      changeSummary: "1 e-posta şablonu (TR).",
      risk: "high",
      subject: {
        kind: "content_sha256",
        ref: "marketing/email/subify-yenileme-hatirlatma.md",
        version: "sha256:0d5f7a93c1e6b28d4f30",
      },
      currentVersion: "sha256:0d5f7a93c1e6b28d4f30",
      status: "rejected",
      decision: {
        by: "user",
        at: at(180),
        decision: "rejected",
        note: "Ton satış odaklı; bilgilendirici olmalı.",
        boundVersion: "sha256:0d5f7a93c1e6b28d4f30",
      },
      createdAt: at(500),
    }),
    approval({
      id: "A-2008",
      type: "cloud_agent_run",
      requestedBy: "ceo",
      projectSlug: "synaptech",
      taskId: "T-1001",
      title: "Cursor Cloud Agent çalıştırma (DEMO)",
      description: "İzole test repository üzerinde tek Cloud run. DEMO — gerçek ücretli çağrı yok.",
      changeSummary: "Görev T-1001 için cloud_agent_run onayı.",
      risk: "high",
      subject: {
        kind: "payload_sha256",
        ref: "task:T-1001",
        version: "sha256:cloud-demo-version-001",
      },
      currentVersion: "sha256:cloud-demo-version-001",
      status: "pending",
      createdAt: at(40),
    }),
  ];

  const activity: ActivityEvent[] = [
    ...approvals.map<ActivityEvent>((request) => ({
      id: `${request.id}:requested`,
      source: "demo",
      at: request.createdAt,
      kind: "approval",
      severity: request.risk === "critical" ? "warning" : "info",
      actorLabel: request.requestedBy,
      agentId: request.requestedBy,
      title: `Onay talebi: ${APPROVAL_TYPE_LABELS[request.type]}`,
      detail: request.title,
      projectSlug: request.projectSlug,
      taskId: request.taskId,
    })),
    ...approvals
      .filter((request) => request.decision)
      .map<ActivityEvent>((request) => ({
        id: `${request.id}:decided`,
        source: "demo",
        at: request.decision?.at ?? request.createdAt,
        kind: "approval",
        severity: "info",
        actorLabel: "Kullanıcı",
        title: request.decision?.decision === "approved" ? "Kullanıcı onayladı" : "Kullanıcı reddetti",
        detail: request.title,
        projectSlug: request.projectSlug,
        taskId: request.taskId,
      })),
    {
      id: "A-2006:invalidated",
      source: "demo",
      at: at(380),
      kind: "approval",
      severity: "warning",
      actorLabel: "Sistem",
      title: "Onay geçersiz: bağlı sürüm değişti",
      detail: "Meta Ads bütçe önerisi onaydan sonra güncellendi; yeni sürüm için yeni onay gerekir.",
      projectSlug: "marivo",
      taskId: "T-3003",
    },
    {
      id: "SEC-1",
      source: "demo",
      at: at(92),
      kind: "security",
      severity: "warning",
      actorLabel: "security",
      agentId: "security",
      title: "Orta seviye bağımlılık bulgusu",
      detail: "Bir geliştirme bağımlılığında bilinen açık; yükseltme önerildi.",
      projectSlug: "synaptech",
      taskId: "T-1007",
    },
    {
      id: "SEC-2",
      source: "demo",
      at: at(55),
      kind: "security",
      severity: "warning",
      actorLabel: "Guard",
      title: "Kabuk komutu reddedildi (git push)",
      detail: "Örnek senaryo: push Faz 1-2'de yasak.",
    },
  ];

  const growth: DemoGrowthData = {
    seoTasks: [
      { id: "SEO-1", source: "demo", title: "Blog listeleme sayfasında eksik meta açıklamalar", page: "/blog", impact: "high", status: "in_progress" },
      { id: "SEO-2", source: "demo", title: "robots.txt içinde gereksiz engellenen /assets yolu", page: "/robots.txt", impact: "medium", status: "proposed" },
      { id: "SEO-3", source: "demo", title: "sitemap.xml'de yönlendirme dönen URL'ler", page: "/sitemap.xml", impact: "medium", status: "planned" },
      { id: "SEO-4", source: "demo", title: "Hizmet sayfalarında hreflang (TR/EN) eksikliği", page: "/hizmetler", impact: "high", status: "proposed" },
      { id: "SEO-5", source: "demo", title: "Ürün sayfasında birden fazla h1 başlığı", page: "/urunler", impact: "low", status: "done" },
    ],
    keywordIdeas: [
      { id: "KW-1", source: "demo", keyword: "yapay zeka destekli yazılım geliştirme", lang: "tr", intent: "bilgi", note: "Hacim verisi yok: Search Console bağlı değil." },
      { id: "KW-2", source: "demo", keyword: "kurumsal yazılım otomasyonu", lang: "tr", intent: "satın alma", note: "Hacim verisi yok: Search Console bağlı değil." },
      { id: "KW-3", source: "demo", keyword: "ai agent development company", lang: "en", intent: "satın alma", note: "Hacim verisi yok: Search Console bağlı değil." },
      { id: "KW-4", source: "demo", keyword: "abonelik yönetim yazılımı", lang: "tr", intent: "karşılaştırma", note: "Subify için; hacim verisi yok." },
      { id: "KW-5", source: "demo", keyword: "custom software development turkey", lang: "en", intent: "karşılaştırma", note: "Hacim verisi yok: Search Console bağlı değil." },
    ],
    calendar: [
      { id: "CAL-1", source: "demo", week: "2026-W48", topic: "Yapay zekâ ile iş süreçleri otomasyonu", lang: "tr", owner: "content-manager", status: "in_review" },
      { id: "CAL-2", source: "demo", week: "2026-W49", topic: "How AI agents change software delivery", lang: "en", owner: "content-manager", status: "drafting" },
      { id: "CAL-3", source: "demo", week: "2026-W50", topic: "Kurumsal projelerde test otomasyonu", lang: "tr", owner: "content-manager", status: "planned" },
      { id: "CAL-4", source: "demo", week: "2026-W51", topic: "Choosing a subscription management stack", lang: "en", owner: "content-manager", status: "planned" },
    ],
    drafts: [
      { id: "DR-1", source: "demo", title: "Yapay zekâ ile iş süreçleri otomasyonu", lang: "tr", metaTitle: "Yapay Zekâ ile İş Süreçleri Otomasyonu | SynapTech", metaDescription: "Yapay zekâ destekli otomasyonun iş süreçlerinde nerede değer ürettiğini ve nasıl başlanacağını anlatıyoruz.", seoReview: "passed", publishApproval: "pending" },
      { id: "DR-2", source: "demo", title: "How AI agents change software delivery", lang: "en", metaTitle: "How AI Agents Change Software Delivery | SynapTech", metaDescription: "A practical look at where AI agents help software teams and where human review stays essential.", seoReview: "pending", publishApproval: "pending" },
      { id: "DR-3", source: "demo", title: "Kurumsal projelerde test otomasyonu", lang: "tr", metaTitle: "Kurumsal Projelerde Test Otomasyonu Rehberi", metaDescription: "Test otomasyonuna geçişte öncelikler, araç seçimi ve sık yapılan hatalar.", seoReview: "changes_requested", publishApproval: "pending" },
    ],
    campaignProposals: [
      { id: "CMP-1", source: "demo", platform: "google_ads", name: "Marivo · Marka dışı arama", objective: "Nitelikli potansiyel müşteri", audience: "Türkiye, karar verici rolleri", status: "awaiting_approval" },
      { id: "CMP-2", source: "demo", platform: "meta_ads", name: "Marivo · Yeniden hedefleme", objective: "Site ziyaretçilerini geri kazanma", audience: "Son 30 gün site ziyaretçileri", status: "draft" },
    ],
    adCopies: [
      { id: "AD-1", source: "demo", platform: "google_ads", headline: "İşinize Özel Yazılım Çözümleri", description: "İhtiyacınızı analiz edip ölçeklenebilir çözümler geliştiriyoruz.", status: "in_review" },
      { id: "AD-2", source: "demo", platform: "google_ads", headline: "Süreçlerinizi Otomatikleştirin", description: "Tekrarlayan işleri azaltın, ekibinizi değer üreten işlere odaklayın.", status: "draft" },
      { id: "AD-3", source: "demo", platform: "meta_ads", headline: "Projenizi Birlikte Planlayalım", description: "Ücretsiz keşif görüşmesiyle yol haritanızı çıkaralım.", status: "draft" },
    ],
    budgetSuggestions: [
      { id: "BUD-1", source: "demo", platform: "meta_ads", suggestion: "Bilinirlik kampanyasındaki payın bir kısmının yeniden hedeflemeye kaydırılması", rationale: "Gerçek performans verisi bağlı olmadığından tutar önerilmez; karar kullanıcıya aittir.", status: "awaiting_approval" },
      { id: "BUD-2", source: "demo", platform: "google_ads", suggestion: "Marka aramalarının ayrı kampanyada izlenmesi", rationale: "Ölçüm netliği için yapısal öneri; harcama değişikliği içermez.", status: "proposal" },
    ],
  };

  const projectDetails: DemoProjectDetails[] = [
    {
      slug: "synaptech",
      goals: ["Organik görünürlüğü artırmak", "Teklif talebi formunu güvenilir hâle getirmek", "TR/EN içerik düzenini oturtmak"],
      risks: ["Mevcut blog otomasyonuyla mükerrer içerik", "Ana sayfa performans sorunları"],
    },
    {
      slug: "subify",
      goals: ["Abonelik yenileme oranını iyileştirmek", "Ödeme akışını test kapsamına almak"],
      risks: ["Production deploy öncesi eksik testler", "Veritabanı migration kaynaklı kesinti"],
    },
    {
      slug: "marivo",
      goals: ["İlk ücretli edinme kanalını test etmek", "Rakiplere göre konumlandırmayı netleştirmek"],
      risks: ["Reklam verisi bağlı olmadan bütçe kararı", "Sitemap ve dizinleme sorunları"],
    },
    {
      slug: "synaptech-ai-os",
      goals: ["Görev motorunu güvenilir işletmek", "Cloud Agent kapılarını denetimli tutmak"],
      risks: ["Ücretli Cloud run’ların kontrolsüz açılması", "Allow-list dışına repo sızması"],
    },
  ];

  return {
    version: DEMO_DATASET_VERSION,
    generatedAt: now.toISOString(),
    tasks,
    approvals,
    activity,
    growth,
    projectDetails,
  };
}
