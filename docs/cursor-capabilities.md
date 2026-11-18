# Cursor yetenekleri — doğrulama raporu

**Doğrulama tarihi:** 2026-11-17  
**Cursor sürümü:** 3.27.22  
**Hesap beyanı:** Cursor Pro (legacy), On-Demand kapalı (kullanıcı doğrulamalı)

Bu belge pazarlama metni değildir. Desteklenen, koşullu ve desteklenmeyen özellikler ayrılmıştır. Kaynak URL’ler doğrulama anındaki resmi dokümantasyona aittir.

## Desteklenen (doğrulandı)

| Yetenek | Not | Kaynak |
|---------|-----|--------|
| Alt ajanlar (`.cursor/agents/*.md`) | `name`, `description`, `model`, `readonly`, `is_background`. İç içe en fazla 1 seviye. | [Subagents](https://cursor.com/docs/subagents) |
| Kurallar (`.cursor/rules/*.mdc`) | `description` / `globs` / `alwaysApply` | [Rules](https://cursor.com/docs/rules) |
| `AGENTS.md` | Kök ve iç içe dizinler | [Rules — AGENTS.md](https://cursor.com/docs/rules) |
| Hooks | `preToolUse`, `beforeShellExecution`, `beforeMCPExecution`, `subagentStart`/`Stop`, `beforeSubmitPrompt` vb. engelleyebilir. Windows’ta PowerShell üzerinden çalışır. Proje hook’ları bulut ajanlarında da çalışır. | [Hooks](https://cursor.com/docs/hooks) |
| Automations (UI) | Yalnızca [cursor.com/automations](https://cursor.com/automations) veya Agents Window. Repo dosyasıyla tanımlanamaz. Cloud Agent olarak faturalanır; modelin **maksimum bağlam penceresi** kullanılır (toggle yok). | [Automations](https://cursor.com/docs/cloud-agent/automations) |
| Cloud Agents API v1 | Ajan başlatma, SSE, kullanım; iptal: `POST /v1/agents/{id}/runs/{runId}/cancel` (kalıcı `CANCELLED`) | [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints) |
| Cursor SDK | Yerel/bulut ajanları programatik; plan kullanımından düşer | [TypeScript SDK](https://cursor.com/docs/sdk/typescript) |
| Legacy Pro paketi | Cursor Models + Other Models havuzları; Cloud Agents, Automations, Bugbot, SDK dahil (plan dokümanına göre) | [Legacy plans](https://cursor.com/docs/account/pricing/legacy-cursor-plans) |

## Koşullu / dikkat

| Konu | Durum |
|------|--------|
| On-Demand | Bireysel planda kullanıcı açmadıkça kapalı. Bulut ajanı ilk kullanımda harcama limiti sorabilir; On-Demand gerektiriyorsa açılmamalı. Doğrulama: [Spending](https://cursor.com/dashboard/spending). |
| Run Modes / Auto-review | Allowlist veya Auto-review. `.cursor/permissions.json` yalnızca Auto-review sınıflandırıcısını yönlendirir; **güvenlik sınırı değildir**. |
| Sandbox | `.cursor/sandbox.json` `readBoundary` gerçek sınırdır. Windows’ta WSL2 gerekir; yoksa komutlar sınıflandırıcıya/onaya düşer. |
| Bulut ajanları | Run Modes onayı sormaz; kanca, branch koruması ve dar yetki gerekir. |
| Alt ajan paralelliği | Cursor’da yerleşik eşzamanlılık sınırı yok; bu projede hook ile en fazla 2. |
| Max Mode (legacy istek planı) | Kapalıysa alt ajanlar `model` alanına bakılmaksızın Composer ile çalışabilir. |

## Desteklenmeyen / bu hesapta yok

| Yetenek | Durum | Kaynak |
|---------|--------|--------|
| Admin API | Yalnızca **Enterprise** ekipler | [Admin API](https://cursor.com/docs/account/teams/admin-api), [API Overview](https://cursor.com/docs/api) |
| Analytics API | Yalnızca **Enterprise** ekipler | [Analytics API](https://cursor.com/docs/account/teams/analytics-api) |
| Bireysel hesap kullanım API’si | Yok; havuz kullanımı manuel girilir / dashboard’dan bakılır | — |
| Automations’ı repo dosyasından tanımlama | Desteklenmez | [Automations](https://cursor.com/docs/cloud-agent/automations) |
| Cloud Agents API v1 webhook | Yok (“coming soon”); v0 legacy’de webhook var | [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints) |
| Kişisel hesapta otomasyonu API ile kapatma | Belgelenmiş API bulunamadı | — |

## Bu projede bilinçli olarak kapalı

- Cloud Agents API / SDK bağlantısı: `config/integrations.yaml` → `not_connected`
- Automations: `config/automations.yaml` → tümü `enabled: false`; `budget-policy.yaml` → `automations_enabled: false`
- Maliyet kapısı tamamlanmadan Cloud/Automations açılmaz → [automation-plan.md](automation-plan.md)

## SynapTech kullanımı

- Günlük iş: yerel IDE ajanları, `composer-2.5[fast=false]` (rutin) veya `inherit` (karar rolleri)
- Orkestrasyon: ana sohbet ajanı; alt ajanlar `.cursor/agents/`
- Engelleme: proje hook’ları (`.cursor/hooks/`) + kurallar; ayrıntı [security-policy.md](security-policy.md)

Bu dosya Cursor sürümü veya plan değişince yeniden doğrulanmalıdır.
