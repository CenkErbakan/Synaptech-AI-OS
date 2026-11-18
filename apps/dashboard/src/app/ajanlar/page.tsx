import { connection } from "next/server";
import { Suspense } from "react";

import { LoadErrorNotice, PageHeader, ViewSkeleton } from "@/components/common/page-parts";
import { ModeView } from "@/components/mode/mode-view";
import { AgentsDemo } from "@/components/views/agents-demo";
import { AgentsRuntimePanel } from "@/components/views/agents-runtime-panel";
import { loadAgentDirectory } from "@/server/agents";

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Çalışanları"
        description="Tanım dosyası (Cursor modeli) ile MSSQL/API canlı runtime ayrılır. Sahte 'çalışıyor' yok; API yoksa bağlantı hatası gösterilir."
      />
      <ModeView
        real={
          <Suspense fallback={<ViewSkeleton />}>
            <AgentsReal />
          </Suspense>
        }
        demo={<AgentsDemo />}
      />
    </div>
  );
}

async function AgentsReal() {
  await connection();
  const directory = await loadAgentDirectory();
  if (!directory.ok) return <LoadErrorNotice path={directory.path} error={directory.error} />;
  return <AgentsRuntimePanel directory={directory.data} />;
}
