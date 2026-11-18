# T-P5E-002 — Görev arşivi geri alma

Kayıtlar silinmedi. Geri alma yalnızca `archivedAt` / `archivedReason` temizler.

## Koşullar

- Yedek: `reports/qa/backups/tp5e002-pre-archive-*.json`
- Onaylı ID listesi: `reports/qa/faz-5e-task-archive-ids.json` (231 id)

## SQL (izole / yerel MSSQL)

```sql
-- Yalnızca T-P5E-002 ile arşivlenenler
UPDATE dbo.[Task]
SET archivedAt = NULL,
    archivedReason = NULL
WHERE archivedReason = N'T-P5E-002: DRY RUN onaylı test/simülasyon/mock panosu temizliği';
```

## Doğrulama

```sql
SELECT COUNT(*) AS active FROM dbo.[Task] WHERE archivedAt IS NULL;
SELECT COUNT(*) AS archived FROM dbo.[Task] WHERE archivedAt IS NOT NULL;
-- Korunanlar
SELECT id, title, status, archivedAt FROM dbo.[Task]
WHERE id IN (
  '8ca354e8-f25b-432d-acc5-73105f3e5a89',
  '462490ee-bbf4-4ec3-b2ac-59e8134966ce'
);
```

## Not

AgentRun / AgentMessage / Approval / AuditLog dokunulmaz. Cloud live açılmaz.
