# T-P5E-006 — BLOCKED

Tarih: 2026-11-18  
Verdict: **BLOCKED**  
Canlı Developer/Tester Ollama pilotu: **başlatılmadı**

## Neden

Owner kuralı: dosya sistemi, süreç ve ağ izolasyonu kanıtlanamıyorsa canlı test çalıştırma.

| Katman | Durum | Kanıt |
|--------|--------|------|
| Patch path jail / secret copy skip | var | sandbox-patch + materialize |
| Sandbox yolu OS temp, ana repo/Subify/Marivo/SynapTech ile örtüşmez | kanıtlandı | preflight `pathIsolation` |
| Child process chroot/container | **yok** | spawn düz OS süreci |
| Ağ engeli | **yok** | child dışarı çıkabilir |
| `package.json` scripts keyfi komut riski | **var** | `npm_test`/`pnpm_test` script’e bağlı |

Blok kodu: `sandbox_isolation_unproven`

## Geçen ön kontroller

- Bağlı SHA-256: 4/4 eşleşti
- Kill switch: kapalı
- Cloud live: kapalı · On-Demand verified: false · Scheduler AI: off
- Ollama: `qwen2.5:14b` erişilebilir (kullanılmadı)
- Fixture dışı repo otomatik seçilmedi

## Yapılmayanlar

- Gerçek Ollama Developer/Tester çağrısı yok
- Patch / sandbox_diff / test yürütmesi yok
- Subify/Marivo/SynapTech yazma, push, PR, Cloud, production yok
- T-P5E-004/005 kayıtlarına dokunulmadı
- Hiçbir görev `done` yapılmadı

## Audit / kapatma

- Audit: `approval.owner_tp5e006` (verdict=BLOCKED, liveOllamaStarted=false)
- Modlar: `AGENT_REPO_TOOLS_MODE=off`, `AGENT_SANDBOX_MODE=off`, `LOCAL_AGENT_EXECUTION_MODE=off`, scheduler off, cloud mock

## Kanıt dosyaları

- `reports/qa/faz-5e-tp5e006-isolation-preflight.json`
- Bu rapor

## Sonraki adım (Owner)

Canlı fixture pilotu için en azından: child process FS jail (container/job), ağ kesme ve allow-list’te yalnızca sabit `node --test <dosya>` (proje script’siz) kanıtlanmalı. Yeni izolasyon sürümü + yeni onay SHA’sı gerekir.
