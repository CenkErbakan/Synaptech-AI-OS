---
title: "Onay talebi — <tür>"
type: approval-request
project: synaptech
agent: developer
date: "YYYY-MM-DD"
status: pending
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | protected_branch_merge \| production_deploy \| db_migration \| blog_publish \| ad_campaign_launch \| ad_budget_change \| customer_message |
| İsteyen ajan | |
| Proje | synaptech \| subify \| marivo |
| Görev kimliği | |
| Risk | Düşük \| Orta \| Yüksek \| Kritik |

## Açıklama

(Ne isteniyor, neden.)

## Değişiklik özeti

-

## Bağlı sürüm

- Tür: git_commit | content_sha256 | payload_sha256
- Ref / yol:
- Sürüm (commit SHA veya `Get-FileHash -Algorithm SHA256`):

Onay yalnızca bu sürüm için geçerlidir. İçerik veya commit değişirse yeni onay gerekir.

## Geri alma planı

-

## Not

Onayı yalnızca kullanıcı verir. Onaylansa bile ajan yürütmez; Faz 3’te güvenilir yürütücü (şimdi manuel uygulama).

## Veri kaynakları

- Gerçek dosya / commit — DEMO yok.
