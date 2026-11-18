---
title: "Onay talebi — db_migration (Faz 5D WorkerLease)"
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
| Tür | db_migration |
| İsteyen ajan | orchestrator (Faz 5D) |
| Proje | synaptech |
| Görev kimliği | T-P5D-002 |
| Risk | Orta |

## Açıklama

İzole Faz 5D MSSQL veritabanında `WorkerLease` ve `WorkerInstance` tablolarını oluşturan migration’ın uygulanması. Production Subify/SynapTech DB’lerine uygulanmaz.

## Değişiklik özeti

- Migration: `20261118050000_faz5d_worker_lease`
- Tablolar: `WorkerLease`, `WorkerInstance`

## Bağlı sürüm

- Tür: content_sha256
- Ref / yol: `apps/api/prisma/migrations/20261118050000_faz5d_worker_lease/migration.sql`
- Sürüm: `A4006FD369B7373B3A3EE5EC36AF4392523BF525E1B4AEE015C8A3E363EBC782`

## Geri alma planı

- Önce BACKUP (bkz. `docs/ops/faz5d-db-runbook.md`)
- Gerekirse RESTORE veya izole DB’de tablo DROP (Owner denetiminde)

## Not

Yerel geliştirme DB’sine migration bu oturumda uygulandı (kanıt: `prisma migrate deploy`). Uzak/izole VPS için ayrı onay + manuel uygulama gerekir.
