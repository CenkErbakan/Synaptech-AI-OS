# SynapTech AI OS — Ajan Talimatları

Bu depo, SynapTech'in yazılım geliştirme ve dijital büyüme süreçlerini yöneten çoklu AI ajanlı şirket işletim sistemidir.

**Mevcut durum: Faz 2 MVP — gözlem + DEMO. Sistem otonom değildir.** Görev motoru (Faz 3) ile Cursor ve GitHub entegrasyonu (Faz 4) tamamlanmadı. Kaynak: `config/system-status.yaml`.

## Organizasyon (9 alt ajan, `.cursor/agents/`)
- Yönetim: `ceo`
- Yazılım: `cto`, `developer`, `tester`, `security`
- Büyüme: `growth-lead`, `seo-specialist`, `content-manager`, `ads-manager`

Salt okunur (readonly) ajanlar: ceo, cto, security, growth-lead, seo-specialist, ads-manager. Bunların çıktısını ana ajan ilgili klasöre yazar.

## Nasıl çalışılır
- Ana sohbet ajanı orkestratördür. Alt ajanları `/ceo`, `/cto` gibi komutlarla veya doğal dille çağırır.
- İş akışları ve devir biçimi: `.cursor/rules/10-orchestration.mdc`, ayrıntılar `docs/agent-workflows.md`.
- Onay gerektiren işler: `.cursor/rules/20-approval-gates.mdc`.

## Kesin sınırlar (Cursor hook'ları ayrıca engeller: `.cursor/hooks/`)
- main/master'a doğrudan commit, merge, rebase veya reset yok. `git push` ve remote ekleme yok.
- Production, deploy, bulut ve uzak sunucu erişimi yok.
- Canlı siteye yayın, müşteriye mesaj, reklam kampanyası başlatma/değiştirme, bütçe değişikliği ve harcama yok.
- Gizli bilgileri okuma, yazdırma veya sohbete taşıma yok.
- Korumalı yollar değiştirilemez: `.cursor/**`, `AGENTS.md`, `config/**`, `docs/security-policy.md`, `.synaptech/**`, `.github/workflows/**`.
- Çalışma alanı dışına (Subify, Marivo vb. projelerin kaynak kodu dahil) yazma yok.
- Aynı anda en fazla 2 alt ajan; oturum başına en fazla 12 alt ajan başlatma.
- Kill switch: `config/kill-switch.json` içinde `enabled: true` ise okuma dışındaki tüm araçlar reddedilir.

## Dürüstlük
- Kanıt olmadan "tamamlandı", "test geçti" veya "otonom çalışıyor" denmez.
- DEMO verisi gerçek veri gibi sunulmaz; bağlı olmayan kaynaklar için "veri yok" yazılır.

## Maliyet disiplini
- Cursor Pro (legacy) dahil kullanımı önceliklidir; On-Demand kapalıdır; yeni ücretli API servisi eklenmez.
- Rutin roller `composer-2.5[fast=false]`, karar rolleri `inherit` kullanır (`config/budget-policy.yaml`).
- Cloud Agents ve Automations maliyet kapısı tamamlanmadan açılmaz (`docs/automation-plan.md`).

## Klasörler
- `apps/dashboard/`: Next.js 16 yönetim paneli (iç içe `AGENTS.md` dosyasına uy)
- `packages/shared/`: ortak alan modeli (görev durum makinesi, onay, veri kaynağı ayrımı)
- `config/`: politika ve kayıtlar (korumalı)
- `docs/`: mimari, güvenlik, otomasyon ve iş akışı belgeleri
- `tasks/`, `reports/`, `content/`, `marketing/`: ajan çıktıları ve şablonlar

## Komutlar
- `pnpm install`, `pnpm dev` (http://127.0.0.1:3100), `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify`
