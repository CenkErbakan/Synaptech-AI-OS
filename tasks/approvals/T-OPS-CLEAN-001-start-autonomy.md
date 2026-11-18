---
title: "Onay talebi — yerel otonomi başlangıcı"
type: approval-request
project: synaptech
agent: orchestrator
date: "2026-11-18"
status: pending
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | ad_campaign_launch (en yakın şablon; asıl tür: yerel otonomi başlatma) |
| İsteyen ajan | orchestrator |
| Proje | synaptech |
| Görev kimliği | T-OPS-CLEAN-001 |
| Risk | Yüksek |

## Açıklama

`ops-2026-11-18-clean` epoch’unda kuyruk boş. Bu onay, DB kill switch’i kapatıp ScheduledJob’ları açarak **ilk gerçek CEO planının görev yazmasına** izin verir. Ajan onaylansa bile işlemi kendisi yapmaz.

## Değişiklik özeti

Owner (manuel, tek sefer):

1. `config/kill-switch.json` içinde `enabled: false` (ajan yazmaz).
2. `PATCH /api/system/kill-switch` `{ "enabled": false, "reason": "Owner clean-ops start" }`.
3. `permanentLocalAutonomy: true` (dış grant’ler false kalır).
4. ScheduledJob `daily-ceo-review` ve `local-agent-pass` → `enabled: true`. `growth-cycle` ve `run-reconciliation` kapalı kalabilir.
5. Tek Ollama CEO çağrısı beklenir; GitHub/e-posta/deploy/Cloud açılmaz.

## Bağlı sürüm

- Tür: git_commit
- Ref / yol: workspace HEAD
- Sürüm: `006e92cb51983ea8b4c2967517f73ac2bc8f762f`

Onay yalnızca bu sürüm için geçerlidir. İçerik veya commit değişirse yeni onay gerekir.

## Geri alma planı

- DB kill switch `enabled: true`
- Job `enabled: false`
- `permanentLocalAutonomy: false`
- MSSQL yedek: `reports/ops/mssql-backups/synaptech-pre-reset-2026-11-18T19-56-43-604Z.bak`

## Not

Onayı yalnızca kullanıcı verir. Onaylansa bile ajan yürütmez.

## Veri kaynakları

- Gerçek MSSQL + API preflight. DEMO yok.
