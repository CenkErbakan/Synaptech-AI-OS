# T-P5E-006-retry — Canlı Docker+Ollama pilot sonucu

**Tarih:** 2026-11-18T02:56:21.510Z  
**Wall clock:** 17773 ms  
**LLM çağrıları:** 2 (Developer + Tester)  
**Image:** `node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee`

## Önce başarısız test

```json
{
  "ok": false,
  "exitCode": 1,
  "digest": "8c99b03ac06eb6ee",
  "backend": "docker",
  "command": "docker:node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee node --test /work/test/demo.test.js"
}
```

## Developer

- status: **done**
- realAi: true
- model: qwen2.5:14b
- durationMs: 5814
- acceptanceMet: true
- codeChangeApplied: true
- sandbox_diff: sandbox_diff files=1 digest=1084bf78c9f5c9ab fileDigests=src/demo.js:7c3666e1d4e5af9e->762c16d89d6c4d34
- diff preview: --- a/src/demo.js
+++ b/src/demo.js
-  return a;
+  return a + b;
-

## Tester

- status: **done**
- realAi: true
- model: qwen2.5:14b
- durationMs: 7781
- acceptanceMet: true
- command: docker:node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee node --test /work/test/demo.test.js
- exitCode: 0
- digest: 5b7a99d53de81df1

## AgentMessage

- developer→ceo [result]: Developer sonucu: src/demo.js dosyasında bir hata düzeltme önerisi sunuldu.
- developer→tester [handoff]: Sandbox hazır: diff=1084bf78c9f5c9ab files=src/demo.js
- tester→cto [result]: Tester sonucu: T-P5E-006-retry görevi için test planı oluşturuldu. Docker network=none içinde 'test/demo.test.js' dosyasının çalıştırılması planlanmıştır. 'pack

## Fixture / güvenlik

- Fixture kaynak `src/demo.js` değişmedi (yalnızca sandbox): **true**
- Cloud Agent: başlatılmadı
- Subify/Marivo/SynapTech ana kaynak: yazılmadı

## Pilot sonrası modlar

```json
{
  "localAgent": "off",
  "repoTools": "off",
  "sandbox": "off",
  "scheduler": "off",
  "cloudLive": false,
  "cursorMode": "mock"
}
```

Kanıt JSON: `reports/qa/faz-5e-tp5e006-retry-live-result.json`
