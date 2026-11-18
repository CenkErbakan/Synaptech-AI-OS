"use client";

import { OctagonX } from "lucide-react";

import { EmptyState } from "@/components/common/page-parts";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <EmptyState
      icon={OctagonX}
      title="Bu bölüm yüklenemedi"
      description={`Hata: ${message}. Yerel dosyalar (config/, .synaptech/) okunurken sorun oluşmuş olabilir.`}
    >
      <Button size="sm" variant="outline" onClick={() => retry()}>
        Tekrar dene
      </Button>
    </EmptyState>
  );
}
