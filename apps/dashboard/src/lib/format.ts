import { format, formatDistanceStrict } from "date-fns";
import { tr } from "date-fns/locale";

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "d MMM yyyy HH:mm", { locale: tr }) : "—";
}

export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "d MMM yyyy", { locale: tr }) : "—";
}

export function formatTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "HH:mm:ss", { locale: tr }) : "—";
}

export function formatRelative(value: string | null | undefined, now: Date): string {
  const date = toDate(value);
  return date ? formatDistanceStrict(date, now, { locale: tr, addSuffix: true }) : "—";
}

export function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
