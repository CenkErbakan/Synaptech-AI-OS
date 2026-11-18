# Faz 5E — Real AI Autonomy: Fizibilite, Mimari ve Güvenli Test Raporu

**Tarih:** 2026-11-18  
**Durum:** Mimari + mock/yerel entegrasyon hazır. **Canlı pilot yok.**  
**Önemli:** Bu rapor **“Faz 5E tamamlandı / gerçek AI otonom çalışıyor” iddiası taşımaz.** Gerçek AI yürütmesi ayrıca doğrulanmadan faz tamamlanmış sayılmaz (`faz5eCompleteClaim: false`).

---

## 1. Cursor Cloud Agents API fizibilitesi

### Desteklenen işlemler (resmi docs)

Kaynak: [Cursor APIs Overview](https://cursor.com/docs/api), [Cloud Agents API endpoints](https://cursor.com/docs/cloud-agent/api/endpoints)

| Yetenek | Cloud Agents API | SynapTech kullanım |
|---------|------------------|--------------------|
| Repo üzerinde kod ajanı oluşturma / run | Evet (`POST /v1/agents`) | Coding worker (Developer/Tester) — **ayrı kapı** |
| Run durum / iptal / usage (token) | Evet | Adapter’da mevcut (mock/live) |
| Artifacts, PR, branch | Evet | Pilot politikası ile sınırlı |
| Standalone chat / completions | **Hayır** | CEO sohbeti için **uygun değil** |
| Hesap kalan kullanım (bireysel Pro) | **Yok** (Admin/Analytics = Enterprise) | `remainingUsageKnown: false` |

Resmi ifade: Cloud Agents API ve SDK’lar **agent workflow** çalıştırır; **standalone model-inference veya chat-completions API değildir.**

### Cursor Pro + maliyet sınırları

- `config/budget-policy.yaml`: On-Demand **disabled** (kullanıcı beyanı); `cloud_agents_enabled: false`; `cost_gate.status: not_started`.
- Programatik kalan kota **bilinmiyor** → **tahminle otomatik izin verilmez.**
- Sonuç: **Cloud auto-dispatch kapalı** (`evaluateCloudBudgetGate`). Live create, onay + maliyet kapısı olmadan **reddedilir** (`assertCloudCreateAllowed`).

### ModelProvider olarak uygun mu?

**Hayır.** Cloud Agents = kod ajanı. CEO plan/sohbet için `ModelProvider` ayrıdır. Cloud’u CEO chat gibi göstermek yasaklandı (`cursorCloud.isModelProvider: false`).

---

## 2. Yerel LLM alternatifi

| Madde | Değerlendirme |
|-------|----------------|
| Aday | Ollama-uyumlu HTTP (`LOCAL_LLM_BASE_URL`, örn. `http://127.0.0.1:11434`) |
| Ücretli harici API | Yok |
| Kalite | Modele bağlı (ör. llama3.2); CEO planı için orta; karmaşık kod için Cloud coding daha uygun |
| Kaynak maliyeti | Yerel RAM/VRAM/CPU; ağ ücreti yok; kota bilinmez (`remainingUsageKnown: false`) |
| Varsayılan | Kapalı; `MODEL_PROVIDER=local` + çalışan Ollama gerekir; yoksa mock’a düşer |

---

## 3. Uygulanan mimari

```
Scheduler / Owner API
    → ModelProvider (mock | local | none)
    → CEO plan JSON (CeoPlanSchema)
    → doğrulanmış görev / zincir (MSSQL)
    → worker (deterministik veya ileride onaylı coding)
    → kanıt (test|url|file|commit|mssql|audit)
    → Dashboard (API)

Cloud coding ≠ ModelProvider
    → yalnızca cloud_agent_run onayı + cost gate sonrası (şimdilik gate bloklar)
```

### Kanallar (ayrık)

| Kanal | Anlam |
|-------|--------|
| `deterministic` | LLM yok |
| `mock_llm` | Mock provider; `realAiExecution=false` |
| `local_llm` | Yerel model; gerçek AI ancak probe+çıktı ile |
| `cloud_coding` | Cursor Cloud kod ajanı; chat değil |

Gerçek çalışma olmadan görev **gerçek AI ile tamamlanmış sayılmaz**.

---

## 4. Teslimat dosyaları

- `packages/shared/src/domain/model-provider.ts` — şema + yetenekler
- `apps/api/src/ai/model-provider.ts`, `providers/mock|local|registry.ts`
- `apps/api/src/ai/budget-gate.ts`, `execution-adapter.ts`
- `apps/api/src/modules/ai/routes.ts` — `/api/ai/status`, `/api/ai/ceo/pipeline`, `/api/ai/growth-hooks`
- CEO chat → ModelProvider (`answerCeoChat`)
- Stale mock temizliği + görev `dispatchState` düzeltmesi
- Fırsat birikimi tavanı (≥3 açık/proje → yeni yok)
- Cloud live create cost gate

---

## 5. Test kanıtı

```text
pnpm --filter @synaptech/api typecheck  → OK
pnpm --filter @synaptech/api test       → 10 dosya / 55 test geçti
```

Mock kabul akışı doğrulandı:

1. `/api/ai/status` → Cloud ≠ ModelProvider, autoDispatch=false, faz5eCompleteClaim=false  
2. `/api/ai/ceo/pipeline` (mock) → plan schema, `realAiExecution=false`  
3. CEO chat → mock etiketi  
4. Growth hooks → publish/müşteri iletişimi kapalı  
5. 5A–5D regresyon suite’leri geçti  

**Yapılmayanlar:** gerçek Cloud Agent, On-Demand, ücretli API, allow-list, VPS deploy, Automations, canlı yayın.

---

## 6. Owner onayları (canlı / gerçek provider öncesi)

| Onay | Gerekçe |
|------|---------|
| `T-P5E-001` gerçek provider pilotu | Local Ollama veya (ayrı) Cloud coding pilot — maliyet ölçümü |
| Mevcut `cloud_agent_run` + cost gate | Live Cloud create; kalan kullanım bilinmeden otomatik yok |
| On-Demand kapalı doğrulaması | Dashboard spending — manuel |

Taslak: `tasks/approvals/T-P5E-001-real-provider-pilot.md`

### Bağlı içerik SHA-256

| Dosya | SHA-256 |
|-------|---------|
| `apps/api/src/ai/execution-adapter.ts` | `9EEA3AE52A7D4C85DB992286F3989DD5E6BE0745A412FE115AEAF88D4D3FE085` |
| `apps/api/src/ai/budget-gate.ts` | `FA328B4544B7980D7098F3E5A6243974A00B0618FA885929AB7F9C1459D6A92E` |
| `packages/shared/src/domain/model-provider.ts` | `C82862D28CBBF4CE2BA153E6E8BB4B2697943FAEEA5CB688AF5F7038F72AA278` |

---

## 7. Sonuç ve durma noktası

- Fizibilite net: **CEO LLM ≠ Cloud Agents API**  
- Mock pipeline güvenli test edildi  
- Cloud auto-dispatch ve limitsiz create **kapalı**  
- **Canlı pilot öncesinde duruldu**  
- Gerçek AI doğrulanmadan **Faz 5E tamamlandı denmez**
