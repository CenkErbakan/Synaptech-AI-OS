# T-P5E-006 — Docker sandbox izolasyon raporu

**Tarih:** 2026-11-18  
**Verdict:** İzolasyon altyapısı **HAZIR** (integration testler geçti)  
**Canlı Ollama Developer/Tester:** **başlatılmadı** (Owner yeni onayı bekleniyor)

Eski BLOCKED kaydı değiştirilmedi: `tasks/approvals/T-P5E-006-developer-tester-sandbox-pilot.md`  
Yeni retry onayı: `tasks/approvals/T-P5E-006-retry-docker-isolation.md`

## Docker kurulum durumu

| Öğe | Değer |
|-----|--------|
| Docker Desktop | 4.91.0 (çalışıyor) |
| Engine | 29.8.0 linux/amd64 |
| Context | desktop-linux |
| Otomatik kurulum | yapılmadı (zaten vardı) |
| Pinned image | `node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee` |

## Container izolasyon kontrolleri

Sabit backend runner (`sandbox-docker.ts`); model Docker bayrağı/mount seçemez.

| Kontrol | Sonuç |
|---------|--------|
| `network=none` | kanıtlandı (inspect + TCP probe) |
| Root filesystem read-only | kanıtlandı |
| Non-root `1000:1000` | kanıtlandı |
| `--cap-drop ALL` | kanıtlandı |
| `no-new-privileges` | kanıtlandı |
| Memory / CPU / PID limit | 256m / 0.5 / 64 (probe: 64m / 0.25 / 32) |
| Privileged / host net / host PID / docker.sock | yasak; argüman listesinde yok |
| Host fallback | yok (`docker_unavailable_no_host_fallback`) |
| Mount | yalnızca sandbox temp → `/work:ro` + `/tmp` tmpfs |

## Ağ engelleme kanıtı

`proveNetworkBlocked`: container içinden `fetch('http://1.1.1.1')` → **BLOCKED**, `REACHED` yok. Test geçti.

## Host dosya erişimi engelleme kanıtı

`proveHostFsBlocked`: docker.sock, `/host`, `/mnt/c/Users` yok; UID≠0; host canary dosyası bozulmadı. Test geçti.  
`.env` materialize sırasında kopyalanmaz.

## Fail → patch → pass

| Adım | Sonuç |
|------|--------|
| Bozuk `add` + Docker `node --test test/demo.test.js` | exit ≠ 0 |
| Patch `src/demo.js` (yalnızca sandbox kopya) | `sandbox_diff` + before/after digests |
| Aynı komut tekrar | exit=0, stdout digest, test sayısı ≥ 1 |
| Fixture/source SHA | değişmedi |
| `pnpm_test` izole | reddedildi |
| Allow-list dışı test yolu | reddedildi |

## Test sayısı

`pnpm --filter @synaptech/api exec vitest run tests/sandbox-docker-isolation.integration.test.ts tests/sandbox-dev-tester.unit.test.ts`

- **9/9 geçti** (7 Docker izolasyon + 2 mevcut fixture/CTO birim)

## Değişen kaynak dosyalar

| Dosya | Not |
|-------|-----|
| `apps/api/src/ai/repo/sandbox-docker.ts` | **yeni** — Docker runner |
| `apps/api/src/ai/repo/sandbox-runner.ts` | izole yol Docker zorunlu |
| `apps/api/src/ai/repo/sandbox-patch.ts` | before/after digests |
| `apps/api/src/ai/local-agent-execution.ts` | scripts yok; `node_test` + Docker |
| `apps/api/src/ai/repo/repository-tool-adapter.ts` | `requireDockerIsolation` |
| `apps/api/src/modules/ai/routes.ts` | allow-list `isolatedAllowed` |
| `apps/api/tests/sandbox-docker-isolation.integration.test.ts` | **yeni** |

Subify / Marivo / SynapTech / AI OS production kaynak kodu **değiştirilmedi**.

## Yeni onay SHA-256

| Dosya | SHA-256 |
|-------|---------|
| sandbox-docker.ts | `1A9A5BB95F09552E16649133FCDF9BAEE9A16C8D69DD506A73D91C916C671F96` |
| sandbox-runner.ts | `CA4227FC056BA7B1D255039C5CD1F84A35434B14801414FD152BDA363808DA98` |
| sandbox-patch.ts | `7B9025BAF93F1565CDFCE3F7B65FE68DC32BD9B49671B521FF1F7DAAAA9982B6` |
| local-agent-execution.ts | `B994200B26F145F10437FE0EE3EDB2D521DB7AB5C63E88121B5B499AE7947C5A` |
| repository-tool-adapter.ts | `5FB5763BB513AD8609515CCF0501A5B01AD6630EEBCAB124186F15198BBDE90B` |
| acceptance-verifier.ts | `7BC4B9919A9987BD672A7ABBFAF828F1CCCC896A122D91F16E81BFECB053A0EE` (aynı) |

## Kalan güvenlik riskleri

1. **Docker daemon yetkisi:** Backend’in Docker’a erişimi yüksek yetkidir; ajanlara Docker CLI verilmez, yalnızca sabit `runIsolatedNodeTest` parametreleri kullanılır.
2. **Bind mount host yolu:** Temp sandbox Windows yolu mount edilir; yanlış kök seçilirse risk — materialize yalnızca OS temp + allow-list kopya.
3. **Image supply chain:** Digest pin var; yeniden pull/Owner onayı olmadan tag kayması önlenir, registry güveni hâlâ dış bağımlılık.
4. **Allow-list dar:** Şu an yalnızca `test/demo.test.js`; başka fixture için allow-list genişletmesi + yeni SHA onayı gerekir.
5. **Windows Docker VM:** İzolasyon Linux VM içindedir; Desktop yanlış paylaşımı Owner makinesinde ayrı risk yüzeyi oluşturabilir.

## Durdurma noktası

Kod + testler tamam. **Canlı Ollama pilotu Owner’ın `T-P5E-006-retry-docker-isolation` onayı olmadan başlatılmayacak.**
