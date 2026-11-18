# Entegrasyonlar

**Hiçbir harici hesap bağlı değildir.** Bağlı olmayan kaynak için “veri yok” yazılır; uydurma metrik gösterilmez.  
Makine kaydı: `config/integrations.yaml`. Bu turda entegrasyon **etkinleştirilmez**.

## Uygulanmamış entegrasyonlar

| id | Ad | Durum | Faz | Amaç |
|----|-----|--------|-----|------|
| github | GitHub | not_connected | 4 | Branch, PR, check, olaylar |
| cursor-cloud-agents-api | Cloud Agents API v1 | not_connected | 4 | Ajan başlatma, SSE, iptal, kullanım |
| cursor-sdk | Cursor SDK | not_connected | 4 | Programatik yerel/bulut ajan |
| cursor-automations | Automations | not_configured | 5 | Zamanlanmış / olay tetikli bulut ajanları |
| cursor-usage | Hesap kullanımı | **unsupported** | — | Admin/Analytics API yalnızca Enterprise |
| google-search-console | GSC | not_connected | 5 | Arama / dizin (readonly OAuth) |
| google-analytics-4 | GA4 | not_connected | 5 | Trafik (readonly) |
| google-ads | Google Ads | not_connected | 5 | Performans; salt okuma ayrı kullanıcı düzeyi ile |
| meta-ads | Meta Ads | not_connected | 5 | `ads_read` |
| mssql | MSSQL Docker | not_installed | 3 | Görev motoru / olay / onay |

## Faz 4 E2E senaryosu (kabul; henüz çalıştırılmaz)

```text
Dashboard → API → Cursor Cloud Agent → GitHub test deposu → Dashboard
```

Geçme ölçütleri ([architecture.md](architecture.md) ile aynı):

1. Görev Dashboard UI’dan oluşturulur; DB’de gerçek kayıt.
2. `bc-` ajan kimliği oluşur; cursor.com/agents’ta görünür.
3. Yalnızca **test deposu**, `agent/*` branch, PR; main/master yazma ve merge yok.
4. Olay API’ye ulaşır; Dashboard PR, `FINISHED`, token’ı Gerçek etiketiyle gösterir.
5. Kill switch iptal senaryosu geçer.

Auth planı: GitHub App (dar yetki, önce test deposu); Cloud Agents API anahtarı yalnızca API sunucusunda.

## Webhook notu (Cloud Agents API)

- **v1:** Webhook yok (“coming soon”). Durum için SSE ve/veya **yoklama** gerekir.
- **v0 (legacy):** Webhook desteklenir; yeni entegrasyon tercihen v1 + poll olmalıdır.
- Kaynak: [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints).

GitHub tarafında Faz 4’te webhook veya poll seçilebilir; v1 Cursor API webhook’una dayanılamaz.

## İptal uç noktası

```http
POST /v1/agents/{id}/runs/{runId}/cancel
```

Kalıcı `CANCELLED`. Terminal run → `409 run_not_cancellable`. Kill switch Faz 4 etkisi için zorunlu.

## Prisma / MSSQL (Faz 3 altyapı kaydı)

| Paket / imaj | Sürüm |
|--------------|--------|
| prisma | 7.10.1 |
| @prisma/client | 7.10.1 |
| @prisma/adapter-mssql | 7.10.1 |
| SQL Server | 2022-latest (Docker, izole) |

Prisma 8 SQL Server desteklemez. `apps/api` ve `infra` bu turda oluşturulmaz.

## Açmadan önce

1. Kullanıcı onayı
2. Maliyet kapısı ([automation-plan.md](automation-plan.md))
3. Dar yetki (`planned_access` alanları)
4. Faz 3/4 kabul testleri geçmeden “entegrasyon tamam” denmez
