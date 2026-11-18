# Güvenlik politikası

**Otonomi seviyesi:** Balanced (dengeli) — `config/permissions.yaml`  
**Sistem durumu:** Faz 2 MVP — gözlem + DEMO; otonom değil.

Bu dosya korumalı yoldadır (`.cursor/hooks` korumalı yollar listesinde). İçerik politika kaydıdır; ajanlar değiştiremez.

## Matris özeti

### Otomatik (`auto`)

| İşlem | Aktörler | Uygulama |
|-------|----------|----------|
| Görev oluşturma | user, ceo, cto, growth-lead | Alan modeli + kill switch (`packages/shared`); Faz 3’te API |
| Kod inceleme | cto, security | `readonly` alt ajan |
| İzinli branch’te geliştirme | developer | Guard: main/master commit/merge/rebase/reset reddi; korumalı yol ve workspace dışı yazma reddi |
| İzole test | tester, developer | Guard: deploy/bulut/uzak CLI reddi |
| PR hazırlama (yerel taslak) | developer | Guard: `git push` / `gh pr create` reddi (Faz 1–2) |
| Rapor / SEO analizi / blog taslağı / reklam önerisi | ilgili ajanlar | Readonly roller; yayın/reklam entegrasyonu yok; kanıtsız “tamamlandı” yasağı |

### Onay (`approval`)

Kullanıcı onayı zorunlu. Onay verilse bile ajan yürütmez; Faz 3’te güvenilir yürütücü (yoksa kullanıcı manuel).

| İşlem | Onay türü | Risk | Uygulama |
|-------|-----------|------|----------|
| Korumalı branch merge | `protected_branch_merge` | Yüksek | Guard merge reddi; Faz 4 branch protection |
| Production deploy | `production_deploy` | Kritik | Guard deploy/bulut CLI; prod kimlik bilgisi yok |
| DB migration | `db_migration` | Yüksek | Guard DB CLI (Faz 1–2) |
| Blog yayını | `blog_publish` | Orta | Yayın entegrasyonu yok; MCP allowlist |
| Reklam kampanya / bütçe | `ad_campaign_launch` / `ad_budget_change` | Yüksek | Hesap bağlı değil; ads-manager readonly |
| Müşteri / harici ileti | `customer_message` | Yüksek | Entegrasyon yok; MCP allowlist |
| Harcama | ilgili tür | Kritik | Ek AI API $0; On-Demand kapalı (beyan) |

Şablon: `tasks/templates/approval-request.md`. Onay sürüme bağlıdır (commit SHA veya içerik SHA-256).

### Yasak (`forbidden`)

| İşlem | Uygulama |
|-------|----------|
| Production veri silme | Guard yıkıcı SQL/DB CLI; prod erişimi yok |
| Gizli bilgi sızdırma | Guard secret dosya/ortam dökümü; `.cursorignore`; istem kalıbı |
| Politika değiştirme | Korumalı yollara yazma reddi |
| Sınırsız sunucu erişimi | ssh/scp, bulut CLI, yetki yükseltme reddi |
| Onaysız mali harcama | Ödeme/reklam entegrasyonu yok |
| Güvenlik mekanizmasını kapatma | hooks/policy/kurallar korumalı; `--no-verify` reddi |

## Kill switch — gerçek etkiler

Dosya: `config/kill-switch.json` (`enabled`). Yalnızca kullanıcı manuel değiştirir (Faz 2).

| Faz | Etki |
|-----|------|
| **Şimdi (hook)** | `enabled: true` → yeni alt ajan reddi; okuma dışı tüm araçlar reddi. Dashboard salt okunur gösterir. |
| **Faz 3 (API)** | Açıkken yeni görev / ajana gönderme → **HTTP 423**. Durum DB + hook dosyasına yazılır. |
| **Faz 4 (iptal API)** | Sistem run’ları `POST /v1/agents/{id}/runs/{runId}/cancel` → `CANCELLED`. Yerel SDK: `run.cancel()`. |

Zaman aşımı: varsayılan görev 60 dk (`budget-policy.yaml`). Yeniden deneme: en fazla 2.

## Katmanlar (güvenlik sınırı mı?)

| Katman | Rol |
|--------|-----|
| Hook’lar (`guard.mjs` + `policy.json`) | Gerçek engelleme (failClosed) |
| `readonly` alt ajanlar | Cursor dosya düzenlemeyi engeller |
| Kurallar (`.mdc`, `AGENTS.md`) | İstem düzeyinde; tek başına yeterli değil |
| `.cursor/permissions.json` (Auto-review) | Best-effort yönlendirme — **güvenlik sınırı değil** |
| `.cursor/sandbox.json` `readBoundary` | Sandbox içinde gerçek sınır; Windows’ta WSL2 gerekir |
| Faz 4 GitHub branch protection | Henüz yok |
| Faz 3 güvenilir yürütücü | Henüz yok |

## Bilinen sınırlamalar

1. **Kabuk kuralları regex tabanlıdır.** Obfuscated komutlarla aşılabilir. Bu yüzden çok katman kullanılır: readonly roller, Auto-review (best-effort), ileride branch protection ve yürütücü ayrımı.
2. **Windows PowerShell hook gecikmesi.** Her hook çağrısında PowerShell açılır; ek latency oluşur.
3. **Auto-review güvenlik sınırı değildir.** Allowlist boşsa veya WSL2 yoksa davranış sınıflandırıcıya/onaya düşer; bulut ajanları Run Modes onayı sormaz.
4. **Rol bazlı yazma alanı** araç çağrısında alt ajan kimliği belgelenmediği için hook ile güvenilir kısıtlanamaz; analiz rolleri `readonly` yapıldı.
5. **Özel alt ajan adının** `subagent_type` alanına yansıması canlı doğrulanmadı.
6. **Bulut VM** yerel kill-switch dosya değişikliğini görmez; Faz 4’te iptal API zorunlu.
7. Kişisel hesapta otomasyonu programatik kapatan belgelenmiş API bulunamadı.

## Manuel Cursor ayarları

- Approvals & Execution: Allowlist veya Auto-review; File-Deletion, External-File, Browser korumaları açık
- On-Demand kapalı: https://cursor.com/dashboard/spending
- PR Routing & Approval yönetilen ajanını açmayın

Ayrıntılı yetki listesi: `config/permissions.yaml`.
