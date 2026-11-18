import { createHash } from "node:crypto";

export type CeoJsonExtractKind =
  | "json"
  | "fence"
  | "empty"
  | "truncated"
  | "plaintext"
  | "unknown";

export type CeoJsonExtractResult = {
  kind: CeoJsonExtractKind;
  jsonText: string | null;
  contentLen: number;
  contentSha256: string;
  startsWithBrace: boolean;
  hasFence: boolean;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function stripFence(text: string): string | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!m?.[1]) return null;
  const inner = m[1].trim();
  return inner.length ? inner : null;
}

function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  const opens = (t.match(/\{/g) ?? []).length;
  const closes = (t.match(/\}/g) ?? []).length;
  return opens > closes || !t.endsWith("}");
}

/** Ham model metninden JSON ayıklar; düz metinden görev uydurmaz. */
export function extractCeoPlanJson(raw: string): CeoJsonExtractResult {
  const contentLen = raw.length;
  const contentSha256 = sha256(raw);
  const trimmed = raw.trim();
  const hasFence = /```/.test(raw);
  const startsWithBrace = trimmed.startsWith("{");
  const base = {
    contentLen,
    contentSha256,
    startsWithBrace,
    hasFence,
  };

  if (!trimmed) {
    return { ...base, kind: "empty", jsonText: null };
  }

  const fenced = stripFence(trimmed);
  if (fenced) {
    try {
      JSON.parse(fenced);
      return { ...base, kind: "fence", jsonText: fenced };
    } catch {
      if (looksTruncated(fenced)) {
        return { ...base, kind: "truncated", jsonText: null };
      }
      return { ...base, kind: "unknown", jsonText: null };
    }
  }

  if (startsWithBrace) {
    try {
      JSON.parse(trimmed);
      return { ...base, kind: "json", jsonText: trimmed };
    } catch {
      if (looksTruncated(trimmed)) {
        return { ...base, kind: "truncated", jsonText: null };
      }
      return { ...base, kind: "unknown", jsonText: null };
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(slice);
      return { ...base, kind: "json", jsonText: slice };
    } catch {
      return { ...base, kind: "unknown", jsonText: null };
    }
  }

  if (looksTruncated(trimmed)) {
    return { ...base, kind: "truncated", jsonText: null };
  }
  if (/^[A-Za-zÇĞİÖŞÜçğıöşü]/.test(trimmed)) {
    return { ...base, kind: "plaintext", jsonText: null };
  }
  return { ...base, kind: "unknown", jsonText: null };
}

export function errorCodeForExtract(kind: CeoJsonExtractKind): string {
  if (kind === "empty") return "local_llm_empty_response";
  if (kind === "truncated") return "local_llm_truncated_json";
  return "local_llm_invalid_json";
}

export function classifyPersistError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/too long for the column/i.test(msg) && /idempotency/i.test(msg)) {
    return "persist_idempotency_key_too_long";
  }
  return "persist_failed";
}
