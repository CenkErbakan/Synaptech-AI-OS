# Faz 5E — Zamanlanmış gerçek AI CEO entegrasyonu

Tarih: 2026-11-18  
Kapsam: **kod + mock test**  
**Canlı zamanlanmış LLM otomasyonu ETKİN DEĞİL** (`SCHEDULER_AI_CEO_MODE=off`).

## Özet

`AutonomousOperationsScheduler` artık yerel/mock ModelProvider ile entegre. Varsayılan `ceo_cycle` **deterministik** kalır. AI yolu ayrı politika bayrağıyla açılır; Owner onayı olmadan `local` çalıştırılmaz.

## Mimari

| Kanal | Tetik | `realAiExecution` |
|-------|--------|-------------------|
| Deterministik CEO | `SCHEDULER_AI_CEO_MODE=off` (varsayılan) | false |
| Mock AI CEO | `=mock` (test) | false |
| Yerel AI CEO | `=local` (ayrı onay) | true (Ollama) |

### Yeni / güncellenen parçalar

- `apps/api/src/ai/ai-ceo-scheduler.ts` — zamanlanmış plan → doğrulama → MSSQL görev + AgentMessage
- `apps/api/src/ai/plan-grounding.ts` — kanıt kontrolü (slug tek başına verified değil)
- `apps/api/src/ai/llm-call-guard.ts` — eşzamanlı 1 LLM lease + günlük üst sınır
- `apps/api/src/engines/autonomy-scheduler.ts` — `ceo_cycle` AI/deterministik ayrımı
- `apps/api/src/lib/env.ts` — `SCHEDULER_AI_CEO_MODE`, `SCHEDULER_AI_CEO_MAX_PER_DAY`
- Dashboard otonomi + CEO chat kanal etiketleri
- Growth hook: local erişilemezse `ready:false` (sessiz mock yok)

## Politika (varsayılan güvenli)

```env
SCHEDULER_AI_CEO_MODE=off
SCHEDULER_AI_CEO_MAX_PER_DAY=1
CLOUD_AGENT_LIVE_ENABLED=false
CURSOR_CLOUD_MODE=mock
```

- Günlük en fazla 1 (yapılandırılabilir, ≤24)
- Aynı anda 1 yerel LLM çağrısı (`llm:local:call` lease)
- Tick idempotency + `scheduler-ai-ceo:<suffix>` parent ile çift çağrı engeli
- Kill switch engeller
- Cloud Agent otomatik başlatılmaz
- Alt görevler `planned` kalır; AI çalışmadan tamamlandı sayılmaz
- Onay / kill switch / bütçe model tarafından değiştirilemez

## Grounding

- `projectSlug` + agent + priority + acceptanceCriteria zorunlu
- `evidenceHint`: UUID / `mssql:<Tablo>` / `goal:<key>` / `opportunity:<uuid>` gerçek kayıtla doğrulanır
- Zayıf kanıt → görev `unverified` (`blockedReason=unverified_evidence`)
- Yalnızca slug eşleşmesi verified sayılmaz

## Testler

```text
pnpm --filter @synaptech/api test
→ Test Files  11 passed (11)
→ Tests       62 passed (62)
```

Örtülen senaryolar (`faz5e-scheduler-ai.integration.test.ts`):

- Scheduler AI status ayrımı
- Mock plan → MSSQL parent/child + AgentMessage
- Aynı idempotency ikinci model çağrısı yok
- Kill switch
- Local URL bozuk → 503 (mock düşüş yok)
- Grounding: metin hint verified değil

## Dashboard

- Otonomi: `planner` / `schedulerAi` / günlük limit / AI CEO plan sayısı
- Görevlerde `plannerChannel` + `model`
- CEO Chat: `local_llm` vs deterministik/mock rozeti

## Bilinçli olarak yapılmayanlar

- `SCHEDULER_AI_CEO_MODE=local` açılmadı
- Yeni gerçek Ollama/scheduler modeli çalıştırılmadı (T-P5E-001 pilotu hariç geçmiş)
- Production / VPS / On-Demand / Cloud live yok

## Sonraki adım (Owner)

Canlı zamanlanmış yerel AI CEO için ayrı onay: `tasks/approvals/T-P5E-003-scheduler-local-ai-ceo.md`
