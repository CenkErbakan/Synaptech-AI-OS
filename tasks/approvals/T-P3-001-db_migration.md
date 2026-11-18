---
title: "Onay talebi — Yerel SynapTech AI OS MSSQL ilk migration"
type: approval-request
project: synaptech
agent: developer
date: "2026-11-17"
status: applied-local-under-master-prompt
---

# Onay talebi

## Zorunlu alanlar

| Alan | Değer |
|------|--------|
| Tür | db_migration |
| İsteyen ajan | developer (orkestratör) |
| Proje | synaptech |
| Görev kimliği | T-P3-001 |
| Risk | Orta |

## Açıklama

Faz 3 Task Engine için yalnızca **yerel** Docker SQL Server 2022 (`synaptech-ai-os-mssql`, host `127.0.0.1:14333`, DB `SynaptechAiOs`) üzerinde Prisma ilk migration uygulanacak. Production yok; mevcut SQLEXPRESS / diğer proje DB’lerine dokunulmaz.

## Değişiklik özeti

- `apps/api/prisma/schema.prisma` ile Users, Agents, Projects, Tasks, TaskEvents, TaskAssignments, Approvals, ApprovalEvents, AgentRuns, AuditLogs, SystemSettings, IntegrationConnections tabloları
- Named volume: `synaptech_ai_os_mssql_data`
- Seed: 9 ajan + 3 proje + owner kullanıcı

## Bağlı sürüm

- Tür: content_sha256
- Ref / yol: `docs/phase-3-implementation.md` (+ migration SQL üretildikten sonra migration dosyası hash’i rapora eklenecek)
- Sürüm (plan): `1C691AAE333107365B4C659D20FC698863FFE98257532F3E9B2F5D925EB4EF02`
- Migration SQL SHA-256: `70D7D340A84904C308A30AB189B11C0AE599DD951D524F378FA6669E6A3BFE2A` (`20261117161352_init_phase3`)

Yerel SynapTech Docker DB’ye master prompt kabul kriterleri kapsamında uygulandı. Production yok.

## Geri alma planı

- `docker compose down -v` ile SynapTech volume silinir (yalnızca bu projenin named volume’u)
- Diğer Docker / SQL örneklerine dokunulmaz

## Not

Faz 3 master prompt kabul kriterleri yerel MSSQL + e2e gerektirir. Onay verilirse migrate’i kullanıcı veya güvenilir yerel süreç uygular; production migration yok.

## Veri kaynakları

- Gerçek dosya / plan hash — DEMO yok.
