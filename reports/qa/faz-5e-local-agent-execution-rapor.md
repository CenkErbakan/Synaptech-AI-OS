# Yerel ajan yürütme altyapısı (CEO dışı)

Tarih: 2026-11-18  
Kapsam: **uygulama + mock test**  
**Canlı ajan LLM kapalı** (`LOCAL_AGENT_EXECUTION_MODE=off`). Sürekli otomasyon yok.

## Gap kapatıldı

CEO görev atıyordu; CTO/Developer/… `ready` kalıyordu. Artık Owner tetikli / onaylı `runLocalAgentExecutionPass` ile aynı Ollama modeli **sırayla** ajan görevlerini işler.

## Bileşenler

| Parça | Rol |
|-------|-----|
| `ai/agent-roles.ts` | 8 rol: system prompt + yetki sınırları |
| `ai/local-agent-execution.ts` | Kuyruk, lease, şema, MSSQL yazma |
| `ModelProvider.executeAgentWork` | mock + local |
| `AgentWorkResultSchema` (shared) | acceptanceMet, codeChangeApplied |
| Env | `LOCAL_AGENT_EXECUTION_MODE=off\|mock\|local` |

## Güvenlik / politika

- Varsayılan **off**; scheduler’a sürekli job eklenmedi
- Max **1** eşzamanlı Ollama (`llm:local:call`)
- Görev başına lease (`task:exec:<id>`) — çift worker yok
- `archivedAt IS NULL` zorunlu
- Kill switch / Cloud live → dur
- `codeChangeApplied` zorla false (sandbox yok; öneri ≠ repo değişikliği)
- `acceptanceMet=false` → status `planned` (done değil)
- Self-handoff departman devri sayılmaz (`kind=result`, `isDepartmentHandoff=false`)
- Günlük limit: **gerçek** AI audit (`realAiExecution=true`); mock kotayı yakmaz (local modda)

## API

- `GET /api/ai/agents/execution-status` — pending / local_llm / mock_llm sayıları
- `POST /api/ai/agents/execute` — Owner; `{ limit, taskIds?, agentIds? }`

## Testler

```text
pnpm --filter @synaptech/api test
→ 12 files / 67 tests passed
```

`local-agent-execution.integration.test.ts`: status, CTO+Developer mock yazma, lease, local 503, kill switch.

## Bilinçli yapılmayanlar

- `LOCAL_AGENT_EXECUTION_MODE=local` açılmadı
- Yeni gerçek model çağrısı yok
- Cloud Agent / deploy / merge / reklam / blog / müşteri iletişimi yok

## Sonraki adım

Tek onay: `tasks/approvals/T-P5E-004-local-agent-cto-developer-pilot.md`  
Hedef: CTO + Developer için sınırlı gerçek Ollama yanıtı + MSSQL kanıt.
