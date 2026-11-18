---
title: "SynapTech AI OS — operasyonel hazırlık (dürüst durum)"
date: "2026-11-18"
liveAutonomy: false
tP5e009: blocked_until_utc_2026-11-19
mockTests: "44 passed (6 files)"
---

# Operasyonel hazırlık

Hedef: Cursor’a sürekli komut yazmadan iş bulan, dağıtan, kanıt üreten yerel AI şirketi. Bu turda **canlı sürekli otonomi, GitHub push/PR, müşteri ileti ve production yok.** T-P5E-009 UTC 19 öncesi kapalı durur.

## Şimdi çalışan parçalar

| Parça | Kanıt | Sınır |
|-------|--------|--------|
| 9 ajan rolü + capability matrix | mock test | Cloud ajanı değil |
| MSSQL Task / AgentMessage / AuditLog | API health `database.ok` | DEMO ile karıştırılmaz |
| Scheduler timer | `worker-Cenk-26988-5269abf2` `timerActive=true` | Modlar `off` iken deterministik job |
| Ollama `qwen2.5:14b` | tags (üretme yok bu tur) | PC kapalıysa durur; Cloud’a düşmez |
| Docker sandbox | önceki isolated testler | Yalnızca allow-list fixture |
| 24s pencere kodu | `autonomy-window.ts` SHA `544D67EE…7760B6` | MSSQL’de **aktif pencere yok** |
| CEO mock plan + grounding | `faz5e-scheduler-ai` geçti | Local CEO UTC 19’a kadar yok |
| Repo salt-okuma + bağımsız kabul | repository/acceptance testleri | Verified olmayan projede kod aracı yok |
| Growth Lead / SEO / Content / Ads şemaları | `Lead`, `SeoFinding`, taslak klasörleri | Yayın/harcama/ileti yok |
| Kill switch | `enabled: false`, kod fail-closed | Owner dosyası ajan yazmaz |
| On-Demand / Cloud live | kapalı | Ücretli API yok |
| Owner karar kuyruğu UI | `/onaylar` Gerçek: “Bekleyen Owner kararı yok” | Çalışan API sürecine yeni route restart sonrası tam bağlanır |

## Bu turda bağlanan (mock; canlı açılmadı)

- Boşta LLM: kuyruk tavanı ve “yeni kanıt yoksa CEO çağırma” (`local-ops-policy.ts`, scheduler’a takıldı).
- GitHub yazma adaptörü: `GITHUB_WRITE_MODE=off`; mock ağ/push/PR yok.
- Tek karar kuyruğu: `GET /api/owner/decision-queue` + Onay Merkezi.
- Local ajan: pencere yokken `MODE=local` olsa bile Ollama yok.
- Test: vitest 6 dosya / **44 geçti** (2026-11-18 18:06 yerel).

Dashboard Görev Panosu (Gerçek): Planlandı **93**, Çalışıyor **11**, Onay Bekliyor **0**. Kuyruk tavanı varsayılan 48. Bu, CEO’nun **yeni iş uydurmasını doğru biçimde keser**; mevcut kuyruk ajanların işidir.

## Hazır olmayan / eksik (dürüst)

1. **Kalıcı otonomi yok.** `config/system-status.yaml` hâlâ “otonom değil” (korumalı; ajan yazmaz). T-P5E-009 24s penceresi açılmadı.
2. **Ücretli kota vs yerel Qwen.** T-P5E-009 penceresi hâlâ CEO 2 / ajan 8 overlay kullanır. Kalıcı operasyonda günlük 2/8 zorunlu sınır olmaktan çıkar; bu **ayrı Owner onayı** ister. Şimdi eşzamanlı 1 LLM + kuyruk + backoff + idle var.
3. **GitHub App UNKNOWN.** Dört proje verified bağı Owner doğrulaması bekler. Marivo önceki testte verified değil. Push/Draft PR **kodda kapalı**.
4. **Developer gerçek repo yazımı** yalnızca izole sandbox; ana repo otomatik yazılmaz. Tester Docker fixture’a bağlı. Security diff tarama var; yayın kapısı Owner’da.
5. **Müşteri adayları:** `Lead` modeli (URL, şirket, sektör, sinyal, verified) duruyor; otomatik sürekli tarama + kalite eşiği canlı değil.
6. **SynapTech website SEO** kamu tarama altyapısı var; sürekli döngü kapalı.
7. **PC kapalı / API durunca** yerel AI durur; süre uzamaz (pencere duvar saati). Bunu dashboard’da “Cloud’a geçildi” diye göstermeyiz — gösterilecek metin: yerel çalışma yok.
8. **9 ajanın PR sütunu** boş kalır; yazma kapalı olduğu için bu doğru.
9. **Çalışan API süreci** bu oturumun yeni route’larını yüklemiş olmayabilir; karar kuyruğu UI boş listeyi gösterdi (404 yutulursa da boş). Owner restart (modlar hâlâ off) ile API güncellenir.
10. **Idle skip T-P5E-009 bundle SHA’sını bozdu** (`ai-ceo-scheduler.ts` değişti). `autonomy-window.ts` SHA aynı. 24s açılışta Owner yeni scheduler SHA’sını da onaylamalı.

## Kabul kriteri — bugün

| Kriter | Durum |
|--------|--------|
| Owner manuel görev oluşturmadan iş | Hayır — otonomi kapalı; panoda eski/backlog görevler var |
| Scheduler gerçek AI CEO | Hayır — UTC 18 + mod off |
| Ajan gerçek çıktı | Bu turda yok |
| Teknik kod/test kanıtı (canlı) | Yok; mock/fixture var |
| Büyüme kaynaklı sonuç (canlı) | Yok |
| Boşta gereksiz görev | Politika bağlandı; canlıda kanıtlanmadı |
| Önemli işlem Owner | Evet — gate + kuyruk |

Tek yetki listesi: `tasks/approvals/owner-operasyon-yetki-plani.md`.
