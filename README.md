# SynapTech AI OS

SynapTech için yazılım geliştirme ve dijital büyüme süreçlerini yöneten çoklu AI ajanlı şirket işletim sistemi.

## Durum

**Faz 3 Control Layer (kod): Fastify + Prisma 7.10.1 + yerel MSSQL. Sistem otonom değildir.**

| Alan | Değer |
|------|--------|
| Faz (kod) | 3 / 5 |
| Otonomi | kapalı |
| Cursor entegrasyonu | yok |
| GitHub | bağlı değil |
| Görev motoru | yerel MSSQL (`apps/api`) |
| Veritabanı | Docker `synaptech-ai-os-mssql` → `localhost:14333` |

`config/system-status.yaml` korumalıdır; Owner güncellemeden Dashboard şeridi eski faz etiketini gösterebilir. Faz 4 E2E geçmeden “otonom” denmez.

## Ne var / ne yok

**Var (Faz 1–2):**

- 9 alt ajan (`.cursor/agents/`) ve orkestrasyon kuralları
- Güvenlik kuralları, onay kapıları, bütçe/politika kayıtları (`config/`)
- Ortak alan modeli (`packages/shared`)
- Yerel Dashboard (gözlem + DEMO ayrımı)
- Çıktı klasörleri ve şablonlar (`tasks/`, `reports/`, `content/`, `marketing/`)

**Yok / kapalı:**

- Cursor Cloud Agents API ve SDK bağlantısı
- GitHub bağlantısı
- Görev motoru API’si ve MSSQL
- Automations (7 plan kaydı var; hepsi `enabled: false`)
- Harici büyüme hesapları (GSC, GA4, Ads)

## Yapı

```text
apps/dashboard/     Next.js 16 yönetim paneli (salt okuma + DEMO)
packages/shared/    Ortak alan modeli (görev makinesi, onay, kaynak ayrımı)
config/             Politika ve kayıtlar (korumalı)
docs/               Mimari, güvenlik, otomasyon, iş akışları
.cursor/agents/     Alt ajan tanımları
.cursor/rules/      Proje kuralları
tasks/ reports/ content/ marketing/   Ajan çıktıları ve şablonlar
```

## Çalıştırma

Gereksinimler: Node `>=24`, pnpm `>=11`.

```bash
pnpm install
copy .env.example .env   # Windows
pnpm db:up
pnpm --filter @synaptech/api exec prisma migrate deploy
pnpm --filter @synaptech/api exec tsx prisma/seed.ts
pnpm dev:api             # http://127.0.0.1:3101
pnpm dev                 # http://127.0.0.1:3100
```

Dashboard: [http://127.0.0.1:3100](http://127.0.0.1:3100) · API docs: [http://127.0.0.1:3101/api/docs](http://127.0.0.1:3101/api/docs)

| Komut | Açıklama |
|-------|----------|
| `pnpm typecheck` | Tip kontrolü |
| `pnpm lint` | Lint |
| `pnpm test` | Paket testleri + guard testleri |
| `pnpm build` | Dashboard derlemesi |
| `pnpm verify` | typecheck + lint + test + build |
| `pnpm db:up` | Yerel SynapTech MSSQL container |

## Gerçek vs DEMO

- **Gerçek (varsayılan):** Yalnızca repo yapılandırması, hook audit/durum dosyaları, ajan frontmatter’ı ve gerçek çıktı dosyaları. Bağlı olmayan kaynak için “veri yok” / boş durum gösterilir. DEMO kaydı karışmaz.
- **DEMO:** Tarayıcıdaki ayrı DEMO deposu. Amber çerçeve ve DEMO etiketi ile işaretlenir. Gerçek veriyle aynı listede birleştirilmez.

Uydurma trafik, harcama veya TBM metriği gösterilmez.

## Güvenlik sınırları (özet)

- `main`/`master` üzerinde commit, merge, rebase, reset yok; `git push` ve remote ekleme yok
- Production, deploy, bulut ve uzak sunucu erişimi yok
- Canlı yayın, müşteri mesajı, reklam başlatma/değiştirme, bütçe/harcama yok
- Gizli dosyalar sohbete taşınmaz
- Korumalı yollar ajanlarca değiştirilemez (`.cursor/**`, `AGENTS.md`, `config/**`, `docs/security-policy.md`, …)
- Kill switch (`config/kill-switch.json`): `enabled: true` iken okuma dışındaki araçlar reddedilir

Ayrıntı: [docs/security-policy.md](docs/security-policy.md).

## Faz 3 notu — Prisma + MSSQL

Görev motoru için planlanan yığın: **Fastify + Prisma 7.10.1 + `@prisma/adapter-mssql@7.10.1` + SQL Server 2022 (Docker, izole)**.

Prisma 8 (`latest` etiketi / RC) SQL Server desteklemez; kullanılmayacak. Bu turda `apps/api` ve `infra` oluşturulmaz.

## Manuel Cursor ayar kontrol listesi

Bunlar ajan tarafından otomatik uygulanmaz; kullanıcı doğrular:

1. **Settings → Agents → Approvals & Execution:** Allowlist veya Auto-review; File-Deletion, External-File ve Browser korumalarını açın.
2. [cursor.com/dashboard/spending](https://cursor.com/dashboard/spending): On-Demand kapalı olsun.
3. Cursor yönetimli **PR Routing & Approval** ajanını açmayın (düşük riskli değişiklikleri kendi onaylayabilir).
4. Cloud Agents / Automations açmadan önce [docs/automation-plan.md](docs/automation-plan.md) maliyet kapısını tamamlayın.

## Belgeler

| Dosya | Konu |
|-------|------|
| [docs/cursor-capabilities.md](docs/cursor-capabilities.md) | Doğrulanmış Cursor yetenekleri |
| [docs/architecture.md](docs/architecture.md) | Katmanlar, veri akışı, Faz 3–4 kabul |
| [docs/security-policy.md](docs/security-policy.md) | Otonomi matrisi, kill switch, sınırlamalar |
| [docs/automation-plan.md](docs/automation-plan.md) | 7 otomasyon (hepsi kapalı) |
| [docs/agent-workflows.md](docs/agent-workflows.md) | Yazılım / içerik / reklam akışları |
| [docs/integrations.md](docs/integrations.md) | Bağlı olmayan entegrasyonlar, Faz 4 E2E |

## Lisans / kapsam

Özel depo. Production deploy ve harici hesap bağlantısı bu fazın kapsamında değildir.
