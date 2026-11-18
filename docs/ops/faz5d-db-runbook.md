# Faz 5D — Veritabanı migration, yedekleme ve geri alma

**Kapsam:** Yalnızca izole Faz 5D veritabanı (`SynaptechAiOsFaz5d` / yerel geliştirme DB). Production Subify/SynapTech DB'lerine uygulanmaz.

## Migration

1. Yedek al (aşağıda).
2. `pnpm --filter @synaptech/api prisma migrate deploy`
3. Migration: `20261118050000_faz5d_worker_lease` → `WorkerLease`, `WorkerInstance`
4. Doğrula: `SELECT TOP 1 * FROM WorkerLease` (boş tablo OK)

## Yedekleme (MSSQL)

```powershell
# Örnek — izole instance; production'a yönlendirmeyin
sqlcmd -S 127.0.0.1,14334 -U sa -P "<password>" -C -Q "BACKUP DATABASE [SynaptechAiOsFaz5d] TO DISK=N'/var/opt/mssql/backup/faz5d-pre-migrate.bak' WITH INIT"
```

Container volume üzerinden host'a kopyalama Owner sorumluluğundadır.

## Rollback

1. Yeni migration sorunluysa: uygulamayı önceki image tag'e al (`restart`).
2. Şema geri alma: yedekten `RESTORE DATABASE` (Owner onayı; `db_migration` kapısı).
3. Lease tablolarını düşürmek gerekirse yalnızca izole DB'de:

```sql
-- YALNIZCA izole Faz5d DB
DROP TABLE IF EXISTS dbo.WorkerLease;
DROP TABLE IF EXISTS dbo.WorkerInstance;
-- Prisma migration history satırını da Owner denetiminde temizleyin
```

## Onay

Canlı/paylaşılan DB üzerinde migration = `db_migration` onay kapısı. Bu fazda yalnızca yerel/izole DB hedeflenir.
