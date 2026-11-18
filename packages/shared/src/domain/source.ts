import { z } from "zod";

export const DATA_SOURCES = [
  "demo",
  "config",
  "cursor-hook",
  "repo-file",
  "manual",
  "not-connected",
  "unverifiable",
  "api",
] as const;

export type DataSource = (typeof DATA_SOURCES)[number];
export type RealSource = Exclude<DataSource, "demo">;

export const DataSourceSchema = z.enum(DATA_SOURCES);

export const SOURCE_LABELS: Record<DataSource, string> = {
  demo: "DEMO",
  config: "Yapılandırma",
  "cursor-hook": "Gerçek · Cursor",
  "repo-file": "Gerçek · Dosya",
  manual: "Manuel",
  "not-connected": "Bağlı değil",
  unverifiable: "Doğrulanamıyor",
  api: "Gerçek · API",
};

export interface Sourced {
  source: DataSource;
}

export class DataSourceMixError extends Error {
  readonly direction: "demo-in-real" | "real-in-demo";

  constructor(direction: "demo-in-real" | "real-in-demo", context: string, count: number) {
    super(
      direction === "demo-in-real"
        ? `DEMO verisi gerçek veri akışına karıştı (${context}): ${count} kayıt reddedildi.`
        : `Gerçek kayıt DEMO görünümüne karıştı (${context}): ${count} kayıt reddedildi.`,
    );
    this.name = "DataSourceMixError";
    this.direction = direction;
  }
}

export function isDemoRecord(record: Sourced): boolean {
  return record.source === "demo";
}

/** Gerçek görünümde kullanılır: tek bir DEMO kaydı bile varsa hata fırlatır. */
export function selectReal<T extends Sourced>(
  records: readonly T[],
  context = "gerçek veri",
): Array<T & { source: RealSource }> {
  const leaked = records.filter(isDemoRecord).length;
  if (leaked > 0) throw new DataSourceMixError("demo-in-real", context, leaked);
  return records as Array<T & { source: RealSource }>;
}

/** DEMO görünümünde kullanılır: DEMO olmayan kayıt varsa hata fırlatır. */
export function selectDemo<T extends Sourced>(
  records: readonly T[],
  context = "DEMO verisi",
): Array<T & { source: "demo" }> {
  const foreign = records.filter((record) => !isDemoRecord(record)).length;
  if (foreign > 0) throw new DataSourceMixError("real-in-demo", context, foreign);
  return records as Array<T & { source: "demo" }>;
}
