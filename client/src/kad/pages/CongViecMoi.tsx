/**
 * Màn Giao việc mới (`/cong-viec/moi`) dùng trực tiếp Run engine đang chạy
 * Claude Code thật. KAD chỉ bọc một lớp task/message để hệ thống có trạng
 * thái công việc và link ngược về run/session thật.
 */
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { BriefcaseBusiness, ShieldCheck } from "lucide-react";
import { RunWorkbench } from "../../pages/Run";
import type { RunStartArgs } from "../../lib/api";
import { kadApi } from "../api-client";
import { useKadToast } from "../components/Toast";

export function CongViecMoi() {
  const showToast = useKadToast();
  const [startedTaskId, setStartedTaskId] = useState<string | null>(null);

  const startRun = useCallback(
    async (args: RunStartArgs) => {
      const result = await kadApi.runTask.start({
        prompt: args.prompt,
        cwd: args.cwd,
        model: args.model,
        effort: args.effort,
        permissionMode: args.permissionMode || "plan",
        mode: args.mode || "conversation",
      });
      showToast({
        message: "Đã tạo công việc và bắt đầu Claude Code ở chế độ plan.",
        tone: "success",
      });
      setStartedTaskId(result.task.id);
      return result.run;
    },
    [showToast]
  );

  return (
    <div className="space-y-5 pb-10">
      <section className="rounded-xl border border-kad-border bg-kad-surface px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-kad-text-muted kad-caption">
              <BriefcaseBusiness className="w-4 h-4" />
              <span>Giao việc</span>
            </div>
            <h1 className="kad-display text-kad-text-strong mt-1">Giao việc cho Claude Code</h1>
            <p className="kad-body text-kad-text-muted mt-1 max-w-3xl">
              Mỗi lượt chạy sẽ tự tạo một task trong KAD, lưu lịch sử chat thật và đồng bộ trạng
              thái về Công việc. Mặc định dùng permission mode{" "}
              <span className="font-mono">plan</span>
              để Claude Code lập kế hoạch trước, không tự sửa file.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <ShieldCheck className="w-4 h-4" />
            <span>Run engine thật</span>
          </div>
        </div>
      </section>

      {startedTaskId && (
        <div className="rounded-lg border border-kad-border bg-kad-surface px-4 py-3 text-sm text-kad-text">
          Task đã được tạo.{" "}
          <Link
            to={`/cong-viec/${startedTaskId}`}
            className="text-kad-accent hover:underline font-medium"
          >
            Mở chi tiết công việc
          </Link>
          .
        </div>
      )}

      <RunWorkbench
        title="Giao việc"
        subtitle="Chat trực tiếp với Claude Code, có task KAD theo dõi phía sau."
        defaultMode="conversation"
        defaultPermissionMode="plan"
        showLimitations={false}
        startRun={startRun}
      />
    </div>
  );
}
