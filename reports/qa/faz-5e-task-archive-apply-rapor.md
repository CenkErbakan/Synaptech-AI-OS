# T-P5E-002 — Görev panosu arşivleme sonucu

Tarih: 2026-11-18  
Durum: **tamamlandı** (silme yok; soft-archive)

## Onay doğrulama

| Kaynak | SHA-256 | Sonuç |
|--------|---------|--------|
| `faz-5e-task-board-cleanup-dry-run.json` | `DBB7D4A543DFBAB3DCF565186326E454275C78648DD94B03F6254EEE31E6A3A5` | eşleşti |
| `faz-5e-task-board-cleanup-dry-run-rapor.md` | `52160377CDA5AA2BFDFCA0C4E6B1BF727D8126C90632A3369932DA8661B0EA40` | eşleşti |
| Arşivlenen ID adedi | 231 (unique) | onaylı küme |

Canlı Cloud run kontrolü: **0** (işlem öncesi).  
Scheduler lease: alındı → arşiv → bırakıldı.

## Önce / sonra (arşiv anı)

Kaynak: `reports/qa/faz-5e-task-archive-apply-result.json`

| Metrik | Önce | Sonra (transaction) |
|--------|------|---------------------|
| Toplam Task | 233 | 233 |
| Aktif (`archivedAt IS NULL`) | 233 | **2** |
| Arşivli | 0 | **231** |
| Silinen Task | — | **0** |

## Korunan görevler (değiştirilmedi)

| ID | Başlık | Status | archivedAt |
|----|--------|--------|------------|
| `8ca354e8-f25b-432d-acc5-73105f3e5a89` | T-P4B-001 Pilot: greet(name) TypeScript yardımcısı | `in_review` | null |
| `462490ee-bbf4-4ec3-b2ac-59e8134966ce` | AI CEO Chat + Ekip İletişimi | `planned` | null |

## Korunan veri (işlem sonrası doğrulama)

| Varlık | Durum |
|--------|--------|
| AgentRun / AgentMessage / Approval / AuditLog | silinmedi |
| Project | 4 (dokunulmadı) |
| SeoFinding / Lead | mevcut; silinmedi |
| Cloud live / On-Demand | açılmadı |
| Gerçek model çalıştırma | yok |

> Not: Arşivden hemen sonra çalışan regresyon testleri yeni görevler oluşturduğu için güncel aktif sayı > 2 olabilir. T-P5E-002 ile arşivlenen küme sabit **231** (`archivedReason` prefix `T-P5E-002`). Yeni görevler arşivlenmedi.

## Uygulanan teknik adımlar

1. Migration `20261118060000_task_archive_fields` (`archivedAt`, `archivedReason`)
2. Yedek: `reports/qa/backups/tp5e002-pre-archive-2026-11-18T00-44-47-471Z.json`
3. Transaction `updateMany` = 231 (silme yok)
4. API `GET /api/tasks` varsayılan: `archivedAt IS NULL`; `?archived=1` arşiv; `?archived=all` hepsi
5. Dashboard: “Arşivi göster” filtresi
6. CEO / Opportunity / Local CEO / Autonomy / Coordination / Growth / Execution adapter: arşivlenmiş görevleri aktif saymaz
7. Audit: `task.board_archive_tp5e002`

## Testler

```text
pnpm --filter @synaptech/api test
→ Test Files  10 passed (10)
→ Tests       56 passed (56)
```

## Geri alma

Runbook: `docs/ops/faz5e-task-archive-rollback.md`

Özet SQL:

```sql
UPDATE dbo.[Task]
SET archivedAt = NULL, archivedReason = NULL
WHERE archivedReason = N'T-P5E-002: DRY RUN onaylı test/simülasyon/mock panosu temizliği';
```

## Sınırlar (korundu)

- Production / VPS deploy yok
- Cloud live yok
- On-Demand Spending yok
- Gerçek model çalıştırma yok
