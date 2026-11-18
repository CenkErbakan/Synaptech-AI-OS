---
title: "Onay talebi — production_deploy (Faz 5D izole VPS)"
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
| Tür | production_deploy |
| İsteyen ajan | orchestrator (Faz 5D) |
| Proje | synaptech |
| Görev kimliği | T-P5D-001 |
| Risk | Yüksek |

## Açıklama

İzole staging/VPS üzerinde `docker-compose.faz5d.yml` ile API + worker + MSSQL kurulumu. Mevcut production SynapTech/Subify/NPM/port/DB’lere dokunulmaz; ayrı compose project ve portlar zorunlu.

## Değişiklik özeti

- Yeni izole Docker stack (14334/3111/3112)
- Worker otomatik restart (`unless-stopped`)
- Cloud live kapalı

## Bağlı sürüm

- Tür: content_sha256
- Ref / yol: `docker-compose.faz5d.yml`
- Sürüm: `9350D966145B4E818F62E0AA6677190969B68C0A76C088B5757F40CF2C53BC59`

Onay yalnızca bu sürüm için geçerlidir. İçerik değişirse yeni onay gerekir.

## Geri alma planı

- `docker compose -f docker-compose.faz5d.yml down`
- Volume silme yalnızca Owner kararıyla
- Mevcut production stack’e geri dönüş gerekmez (dokunulmadığı için)

## Not

Onayı yalnızca kullanıcı verir. Onaylansa bile ajan SSH/deploy yapmaz; kullanıcı manuel uygular. Bu fazda SSH kurulumu yapılmadı.
