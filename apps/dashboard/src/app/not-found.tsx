import Link from "next/link";

import { CircleHelp } from "lucide-react";

import { EmptyState } from "@/components/common/page-parts";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState icon={CircleHelp} title="Sayfa bulunamadı" description="Aradığınız bölüm veya proje kaydı mevcut değil.">
      <Button asChild size="sm" variant="outline">
        <Link href="/">Genel bakışa dön</Link>
      </Button>
    </EmptyState>
  );
}
