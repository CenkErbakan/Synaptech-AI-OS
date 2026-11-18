# Görev panosu temizliği — DRY RUN raporu (toplu arşiv YOK)

**Tarih:** 2026-11-18T00:40:00Z  
**Mod:** Salt okunur analiz  
**Kanıt JSON:** `reports/qa/faz-5e-task-board-cleanup-dry-run.json`  
**Script:** `apps/api/scripts/dry-run-task-archive.ts`

## Özet

| Metrik | Değer |
|--------|------:|
| Toplam görev | **233** |
| Korunacak | **2** |
| Arşiv adayı | **231** |
| Belirsiz (otomatik arşivlenmez) | **0** |
| Aktif live Cloud run | **0** (arşiv engeli yok) |

**Bu oturumda MSSQL’de toplu UPDATE/DELETE yapılmadı.** `archivedAt` alanı henüz şemada yok.

## Korunanlar (kesin)

| Görev | Durum | Proje | Gerekçe |
|-------|-------|-------|---------|
| T-P4B-001 Pilot: greet(name) TypeScript yardımcısı | **in_review** (değiştirilmedi) | synaptech | Gerçek Cloud pilot (`live` + `mock` run) |
| AI CEO Chat + Ekip İletişimi | planned | synaptech-ai-os | Owner panosu görevi |

## Arşiv adayları (sınıflandırma)

| Sınıf | Adet | Gerekçe |
|-------|-----:|---------|
| `archive_test_sim` | 203 | Deterministik koordinasyon zinciri / test-simülasyon imzası |
| `archive_growth_sim` | 16 | Faz 5C büyüme simülasyon zinciri |
| `archive_mock_cloud` | 12 | Yalnızca mock Cloud run bağlı (live yok) |
| `archive_auto_deterministic` | 0 | — |

Durum dağılımı (adaylar): done 116, backlog 47, planned 41, in_progress 26, failed 1.

Proje dağılımı (tüm görevler): synaptech 91, subify 74, synaptech-ai-os 66, marivo 2.

## Korunan diğer varlıklar (dokunulmaz plan)

- 4 `Project` kaydı
- `CompanyGoal`, gerçek `SeoFinding` / `Lead`
- `Approval`, `AuditLog`
- İlişkili `AgentMessage` / `AgentRun` / parent-subtask **silinmez** (yalnızca görev arşiv bayrağı)

## Mock reconciliation notu

9 adet mock run `stale_mock` / eski CREATING sonrası CANCELLED olarak listelendi. Live run’lara dokunulmadı. Toplu arşiv öncesi reconciliation pass önerilir (yazma yok bu DRY RUN’da).

## Uygulama planı (onay sonrası — henüz yapılmadı)

1. Migration: `Task.archivedAt`, `Task.archivedReason` (+ index)
2. Backup / transaction snapshot prosedürü
3. Scheduler lease altında arşiv (yeni görev yarışı yok)
4. Aktif live Cloud varsa abort
5. Kanban varsayılan: `archivedAt IS NULL`; filtre: `?archived=1`
6. Scheduler / CEO orchestrator arşivlenmişleri aktif saymaz
7. Geri alma: `archivedAt/Reason = null`

## Owner onayı

Toplu arşivleme için onay talebi: `tasks/approvals/T-P5E-002-task-board-archive.md`  
Onay **olmadan** arşiv uygulanmaz.
