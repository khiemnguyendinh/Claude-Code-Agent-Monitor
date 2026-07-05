import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Globe2,
  Loader2,
  RefreshCw,
  Send,
  Share2,
} from "lucide-react";
import { dashboardToken } from "../../lib/api";
import { useKadToast } from "../components/Toast";
import { KadButton, KadCard, KadEmptyState, KadFieldLabel, KadInput } from "../components/primitives";
import { StatusChip } from "../components/StatusChip";
import type { ChipKind } from "../components/StatusChip";
import { formatRelativeTime } from "../format";

type ConnectorType = "wordpress" | "facebook_page";
type ConnectorStatus = "not_configured" | "configured" | "connected" | "error";
type ActionStatus = "pending" | "approved" | "executing" | "completed" | "failed";

interface Connector {
  id: string;
  connector_type: ConnectorType;
  name: string;
  config: Record<string, unknown>;
  auth_status: ConnectorStatus;
  capabilities: string[];
  risk_level: "low" | "medium" | "high";
  last_health_check: string | null;
  status: "active" | "disabled";
  created_at: string;
}

interface Approval {
  id: string;
  status: "pending" | "approved" | "needs_changes" | "rejected";
  cooldown_until: string | null;
  title: string;
}

interface ConnectorAction {
  id: string;
  connector_id: string;
  task_id: string | null;
  approval_id: string | null;
  action_type: "draft" | "preview" | "publish" | "schedule" | "update" | "delete";
  content: {
    title?: string;
    body?: string;
    scheduled_at?: string | null;
  } | null;
  result: {
    preview_html?: string;
    mode?: string;
    copy_text?: string;
    checklist?: string[];
    code?: string;
    message?: string;
  } | null;
  status: ActionStatus;
  external_id: string | null;
  external_url: string | null;
  executed_at: string | null;
  created_at: string;
  connector?: Connector;
  approval?: Approval | null;
  task_title?: string | null;
}

const BASE = "/api/kad";

async function kadFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = dashboardToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { "x-dashboard-token": token } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code || `HTTP_${res.status}`;
    const message = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`${code}: ${message}`);
    (err as Error & { code?: string }).code = code;
    throw err;
  }
  return body as T;
}

function statusKind(status: ConnectorStatus | ActionStatus | Approval["status"]): ChipKind {
  if (status === "connected" || status === "completed" || status === "approved") return "done";
  if (status === "error" || status === "failed" || status === "rejected") return "error";
  if (status === "needs_changes") return "needs_changes";
  if (status === "pending" || status === "executing") return "pending";
  return "neutral";
}

function connectorLabel(type: ConnectorType) {
  return type === "wordpress" ? "WordPress" : "Facebook Page";
}

function canExecute(action: ConnectorAction) {
  return ["publish", "schedule"].includes(action.action_type) && action.status !== "completed";
}

function cooldownActive(a: Approval | null | undefined) {
  return Boolean(a?.cooldown_until && Date.now() < new Date(a.cooldown_until).getTime());
}

export function KetNoi() {
  const toast = useKadToast();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [actions, setActions] = useState<ConnectorAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [manualUrls, setManualUrls] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      const [connRows, actionRows] = await Promise.all([
        kadFetch<Connector[]>("/connectors"),
        kadFetch<ConnectorAction[]>("/connector-actions?limit=100"),
      ]);
      setConnectors(connRows);
      setActions(actionRows);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Không tải được kết nối." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byType = useMemo(
    () => new Map(connectors.map((c) => [c.connector_type, c] as const)),
    [connectors]
  );

  async function createDefault(type: ConnectorType) {
    setBusy(`create-${type}`);
    try {
      await kadFetch<Connector>("/connectors", {
        method: "POST",
        body: JSON.stringify({
          connector_type: type,
          name: connectorLabel(type),
          config:
            type === "wordpress"
              ? {
                  site_url_env: "KAD_WORDPRESS_URL",
                  username_env: "KAD_WORDPRESS_USERNAME",
                  app_password_env: "KAD_WORDPRESS_APP_PASSWORD",
                }
              : { page_name: "Facebook Page", mode: "manual_handoff" },
        }),
      });
      toast({ message: `Đã tạo connector ${connectorLabel(type)}.` });
      await refresh();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Không tạo được connector." });
    } finally {
      setBusy(null);
    }
  }

  async function healthCheck(connector: Connector) {
    setBusy(`health-${connector.id}`);
    try {
      await kadFetch(`/connectors/${encodeURIComponent(connector.id)}/health-check`, {
        method: "POST",
      });
      toast({ message: "Health check hoàn tất." });
      await refresh();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Health check lỗi." });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function execute(action: ConnectorAction) {
    setBusy(`execute-${action.id}`);
    try {
      await kadFetch(`/connector-actions/${encodeURIComponent(action.id)}/execute`, {
        method: "POST",
        body: JSON.stringify({ manual_external_url: manualUrls[action.id] || undefined }),
      });
      toast({ message: "Action đã hoàn tất." });
      await refresh();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Action bị chặn." });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function copy(action: ConnectorAction) {
    const text = action.result?.copy_text || action.content?.body || "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast({ message: "Đã copy nội dung." });
  }

  if (loading) {
    return (
      <KadCard>
        <KadEmptyState icon={Loader2} message="Đang tải kết nối…" />
      </KadCard>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="kad-title text-kad-text-strong">Kết nối</h1>
          <p className="kad-body text-kad-text-muted mt-1">
            Connector publish và hàng đợi hành động cần duyệt.
          </p>
        </div>
        <KadButton variant="secondary" size="row" icon={RefreshCw} onClick={refresh}>
          Tải lại
        </KadButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConnectorCard
          type="wordpress"
          connector={byType.get("wordpress")}
          busy={busy}
          onCreate={createDefault}
          onHealth={healthCheck}
        />
        <ConnectorCard
          type="facebook_page"
          connector={byType.get("facebook_page")}
          busy={busy}
          onCreate={createDefault}
          onHealth={healthCheck}
        />
      </div>

      <KadCard>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="kad-heading text-kad-text-strong">Hàng đợi connector</h2>
          <span className="kad-caption text-kad-text-muted">{actions.length} action</span>
        </div>
        {actions.length === 0 ? (
          <KadEmptyState icon={Send} message="Chưa có action connector." />
        ) : (
          <div className="divide-y divide-kad-border">
            {actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                busy={busy === `execute-${action.id}`}
                manualUrl={manualUrls[action.id] || ""}
                onManualUrl={(value) => setManualUrls((prev) => ({ ...prev, [action.id]: value }))}
                onExecute={() => execute(action)}
                onCopy={() => copy(action)}
              />
            ))}
          </div>
        )}
      </KadCard>
    </div>
  );
}

function ConnectorCard({
  type,
  connector,
  busy,
  onCreate,
  onHealth,
}: {
  type: ConnectorType;
  connector?: Connector;
  busy: string | null;
  onCreate: (type: ConnectorType) => void;
  onHealth: (connector: Connector) => void;
}) {
  const Icon = type === "wordpress" ? Globe2 : Share2;
  return (
    <KadCard className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-9 h-9 rounded-lg bg-kad-surface-2 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-kad-primary" />
          </span>
          <div className="min-w-0">
            <h2 className="kad-heading text-kad-text-strong">{connectorLabel(type)}</h2>
            <p className="kad-caption text-kad-text-muted mt-1">
              {type === "wordpress"
                ? "REST API + Application Password qua env."
                : "Manual handoff sau khi được duyệt."}
            </p>
          </div>
        </div>
        {connector && <StatusChip kind={statusKind(connector.auth_status)} label={connector.auth_status} />}
      </div>

      {!connector ? (
        <KadButton
          variant="primary"
          size="row"
          onClick={() => onCreate(type)}
          loading={busy === `create-${type}`}
        >
          Tạo connector
        </KadButton>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <InfoCell label="Trạng thái" value={connector.status} />
            <InfoCell
              label="Health check"
              value={
                connector.last_health_check
                  ? formatRelativeTime(connector.last_health_check)
                  : "Chưa chạy"
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {connector.capabilities.map((c) => (
              <span
                key={c}
                className="kad-caption rounded-md bg-kad-surface-2 text-kad-text-muted px-2 py-1"
              >
                {c}
              </span>
            ))}
          </div>
          <KadButton
            variant="secondary"
            size="row"
            icon={RefreshCw}
            onClick={() => onHealth(connector)}
            loading={busy === `health-${connector.id}`}
          >
            Health check
          </KadButton>
        </div>
      )}
    </KadCard>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-kad-surface-2 px-3 py-2">
      <p className="kad-caption text-kad-text-faint">{label}</p>
      <p className="kad-body text-kad-text truncate mt-0.5">{value}</p>
    </div>
  );
}

function ActionRow({
  action,
  busy,
  manualUrl,
  onManualUrl,
  onExecute,
  onCopy,
}: {
  action: ConnectorAction;
  busy: boolean;
  manualUrl: string;
  onManualUrl: (value: string) => void;
  onExecute: () => void;
  onCopy: () => void;
}) {
  const connector = action.connector;
  const isFacebook = connector?.connector_type === "facebook_page";
  const activeCooldown = cooldownActive(action.approval);
  const executable = canExecute(action);
  const executeLabel = isFacebook ? "Đánh dấu đã đăng" : "Publish";

  return (
    <div className="py-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="kad-heading text-kad-text-strong">{action.content?.title || action.action_type}</span>
            <StatusChip kind={statusKind(action.status)} label={action.status} />
            {action.approval && <StatusChip kind={statusKind(action.approval.status)} label={action.approval.status} />}
          </div>
          <p className="kad-caption text-kad-text-muted mt-1">
            {connector ? connectorLabel(connector.connector_type) : "Connector"} ·{" "}
            {action.task_title || action.task_id || "Không gắn task"} ·{" "}
            {formatRelativeTime(action.created_at)}
          </p>
        </div>
        {action.external_url && (
          <a
            href={action.external_url}
            target="_blank"
            rel="noreferrer"
            className="kad-label text-kad-accent hover:underline inline-flex items-center gap-1 flex-shrink-0"
          >
            Mở URL <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {action.result?.preview_html && (
        <div
          className="rounded-lg border border-kad-border bg-white px-4 py-3 kad-body text-kad-text max-h-[220px] overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: action.result.preview_html }}
        />
      )}

      {isFacebook && executable && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
          <div className="rounded-lg bg-kad-surface-2 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="kad-label text-kad-text">Nội dung đăng tay</span>
              <KadButton variant="ghost" size="row" icon={ClipboardCopy} onClick={onCopy}>
                Copy
              </KadButton>
            </div>
            <pre className="kad-body text-kad-text-muted whitespace-pre-wrap max-h-[180px] overflow-y-auto">
              {action.content?.body || ""}
            </pre>
          </div>
          <div>
            <KadFieldLabel>URL bài đã đăng</KadFieldLabel>
            <KadInput
              value={manualUrl}
              onChange={(e) => onManualUrl(e.target.value)}
              placeholder="https://facebook.com/..."
            />
          </div>
        </div>
      )}

      {action.result?.mode === "manual_handoff" && action.result.checklist && (
        <div className="rounded-lg bg-kad-surface-2 p-3">
          <p className="kad-label text-kad-text mb-2">Checklist handoff</p>
          <ul className="space-y-1">
            {action.result.checklist.map((item) => (
              <li key={item} className="kad-body text-kad-text-muted flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-kad-success flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeCooldown && (
        <p className="kad-caption text-kad-warning flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Cooldown đến {new Date(action.approval?.cooldown_until || "").toLocaleString("vi-VN")}.
        </p>
      )}

      {action.result?.code && (
        <p className="kad-caption text-kad-danger">
          {action.result.code}: {action.result.message}
        </p>
      )}

      {executable && (
        <KadButton variant="primary" size="row" icon={Send} onClick={onExecute} loading={busy}>
          {executeLabel}
        </KadButton>
      )}
    </div>
  );
}
