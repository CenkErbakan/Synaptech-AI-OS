# Faz 5D — Güvenlik analizi (özet)

## Tehdit modeli (kısa)

| Risk | Azaltma |
|------|---------|
| Çift job çalıştırma | MSSQL `WorkerLease` + `idempotencyKey` unique |
| Worker çökmesi | Lease TTL dolunca başka worker alır; job durumu DB'de |
| Kill switch bypass | DB otoritesi; tick başında kontrol |
| Secret sızıntısı | Env; `.env*` sohbete/repola yazılmaz; config RO mount |
| Production müdahalesi | Ayrı compose project, portlar, volume, network |
| Ücretli AI / Cloud | `CLOUD_AGENT_LIVE_ENABLED=false`, mock mode |
| Ağ | Host bind `127.0.0.1`; staging'de ayrı network (plan) |

## Merkezi kill switch

- Owner `PATCH /api/system/kill-switch`
- Tüm worker'lar aynı DB'yi okur → yeni scheduled iş durur
- Cloud cancel sweep mevcut (live kapalıyken no-op)

## Bilinçli sınırlar (Faz 5D)

- Production VPS SSH / deploy yok
- Harici ücretli monitoring/SIEM yok (iskelet API hazır)
- Secret store (Vault vb.) yok — env tabanlı tasarım belgelendi

## Sonuç

İzole 7/24 iskeleti güvenlik temel kurallarıyla uyumlu tasarlandı. Gerçek VPS kurulumu Owner onayına bağlıdır.
