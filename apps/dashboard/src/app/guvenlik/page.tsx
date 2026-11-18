import { auditCategoryLabel } from "@synaptech/shared";
import { connection } from "next/server";
import { Suspense } from "react";

import { LoadErrorNotice, PageHeader, SectionTitle, ViewSkeleton } from "@/components/common/page-parts";
import { SourceBadge } from "@/components/common/source-badge";
import { ModeView } from "@/components/mode/mode-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { loadPermissions } from "@/server/config";
import { buildSystemSnapshot } from "@/server/snapshot";

export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Güvenlik"
        description="Kill switch salt okunurdur. Politika matrisi ve guard retleri gerçek kayıtlardan gelir."
      />
      <ModeView
        real={
          <Suspense fallback={<ViewSkeleton />}>
            <SecurityReal />
          </Suspense>
        }
        demo={
          <Alert>
            <AlertTitle>DEMO modunda güvenlik paneli</AlertTitle>
            <AlertDescription>
              Kill switch, politika ve guard retleri gerçek kaynaklardır. DEMO kayıtlarla karıştırılmaz; Gerçek moda geçin.
            </AlertDescription>
          </Alert>
        }
      />
    </div>
  );
}

async function SecurityReal() {
  await connection();
  const [permissions, snapshot] = await Promise.all([loadPermissions(), buildSystemSnapshot(new Date())]);

  const denies = snapshot.audit.events.filter((event) => event.decision === "deny" || event.decision === "error");

  return (
    <div className="space-y-4">
      {!permissions.ok ? <LoadErrorNotice path={permissions.path} error={permissions.error} /> : null}
      {!snapshot.killSwitch.ok ? (
        <LoadErrorNotice path={snapshot.killSwitch.path} error={snapshot.killSwitch.error} />
      ) : null}

      <Card>
        <CardHeader>
          <SectionTitle title="Kill switch" sources={["api", "config"]} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {snapshot.killSwitch.ok && snapshot.killSwitch.data.enabled ? "AÇIK" : "kapalı"}
            </Badge>
            <SourceBadge source="config" />
          </div>
          <p className="text-muted-foreground">
            Operasyon otoritesi API/DB (fail-safe OR). <code>config/kill-switch.json</code> Cursor hook&apos;ları içindir;
            ajan yazmaz. Çelişkide otonomi kapalı kalır.
          </p>
          {snapshot.killSwitch.ok && snapshot.killSwitch.data.conflict ? (
            <p className="text-destructive">
              Çelişki: DB={String(snapshot.killSwitch.data.dbEnabled)} / dosya=
              {String(snapshot.killSwitch.data.fileEnabled)}. Fail-safe AÇIK.
            </p>
          ) : null}
          {snapshot.killSwitch.ok && snapshot.killSwitch.data.reason ? (
            <p>Gerekçe: {snapshot.killSwitch.data.reason}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Guard durumu" sources={["repo-file", "cursor-hook"]} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>hooks.json: {snapshot.guard.hooksInstalled ? "var" : "yok"}</p>
          <p>Mod: {snapshot.guard.mode}</p>
          <p>Olaylar: {snapshot.guard.events.join(", ") || "—"}</p>
          {snapshot.guard.policy ? (
            <p>
              Eşzamanlı alt ajan sınırı: {snapshot.guard.policy.subagents.maxConcurrent} · oturum başlatma sınırı:{" "}
              {snapshot.guard.policy.subagents.maxLaunchesPerConversation}
            </p>
          ) : (
            <p className="text-warning">policy.json okunamadı: {snapshot.guard.policyError}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Politika matrisi" sources={["config"]} />
        </CardHeader>
        <CardContent>
          {permissions.ok ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>İşlem</TableHead>
                  <TableHead>Seviye</TableHead>
                  <TableHead>Uygulayan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.data.actions.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell className="font-medium">{action.label}</TableCell>
                    <TableCell>{permissions.data.levels[action.level] ?? action.level}</TableCell>
                    <TableCell className="max-w-md text-xs text-muted-foreground">
                      {action.enforced_by.join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Son guard retleri" sources={["cursor-hook"]} />
        </CardHeader>
        <CardContent className="space-y-2">
          {denies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ret kaydı yok.</p>
          ) : (
            denies.slice(0, 20).map((event) => (
              <div key={`${event.ts}-${event.event}-${event.reason ?? ""}`} className="rounded-lg border border-destructive/30 px-3 py-2 text-sm">
                <p className="font-medium">
                  {event.event} · {auditCategoryLabel(event.category)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(event.ts)} · {event.target ?? "—"}
                </p>
                {event.reason ? <p className="mt-1 text-xs">{event.reason}</p> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle title="Önerilen Cursor ayarları" sources={["manual"]} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Settings → Agents → Approvals &amp; Execution: Allowlist veya Auto-review.</p>
          <p>File-Deletion, External-File ve Browser korumalarını açın.</p>
          <p>
            On-Demand&apos;in kapalı olduğunu{" "}
            <a className="text-primary underline" href="https://cursor.com/dashboard/spending" target="_blank" rel="noreferrer">
              spending
            </a>{" "}
            ekranından doğrulayın.
          </p>
          <p>&quot;PR Routing &amp; Approval&quot; yönetilen ajanını açmayın.</p>
        </CardContent>
      </Card>
    </div>
  );
}
