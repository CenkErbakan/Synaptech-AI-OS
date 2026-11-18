# Faz 3 — Teknik uygulama planı

**Durum hedefi:** Control Layer & Task Engine (otonomi kapalı).  
**Prisma:** `7.10.1` + `@prisma/adapter-mssql@7.10.1` (Prisma 8 yok).  
**DB:** SynapTech AI OS’ye özel SQL Server 2022 container (`synaptech-ai-os-mssql`, host `127.0.0.1:14333`).

## Mimari

```text
Dashboard (Gerçek) → Fastify :3101 → Shared domain → Prisma → MSSQL
                              ↘ Task Engine / Approval Engine / Audit
                              ↘ DispatchPort (Faz 4 stub; çağrı yok)
DEMO → yalnızca tarayıcı deposu (API yazmaz)
```

## Kill switch otoritesi

| Kaynak | Rol |
|--------|-----|
| MSSQL `SystemSettings.kill_switch` | API runtime otoritesi |
| `config/kill-switch.json` | Cursor hook’ları için ayna |

Owner API ile değiştirir → DB güncellenir → API süreci dosyayı senkronlar (ajan yazmaz). Okuma: API önce DB, yoksa dosya.

## Auth (yerel)

- `Authorization: Bearer <SYNAPTECH_OWNER_TOKEN>` → Owner
- `Authorization: Bearer <SYNAPTECH_SYSTEM_TOKEN>` → System
- İstemci `X-User-Id` / body `actor` kabul edilmez
- Production: oturum/OIDC ihtiyacı `docs/integrations.md` içinde belgelenir

## Görev / onay

- Tek durum makinesi: `@synaptech/shared` `task-machine`
- CEO görevi: `assignee=ceo`, `status=planned`, `dispatchState=awaiting_integration`
- Onay: sürüm bağlı; yürütme yok (`TrustedExecutor` arayüzü stub)
- Idempotency: `Idempotency-Key` + unique index

## Onay kapıları (bu tur)

- `db_migration`: yerel SynapTech MSSQL’e ilk migrate — `tasks/approvals/T-P3-001-db_migration.md`
- `config/system-status.yaml` korumalı: Owner manuel güncelleyecek (raporda)

## Yapılmayacaklar

Cursor Cloud/Automations, push, production, ücretli API, mevcut ürün kaynak kodu.
