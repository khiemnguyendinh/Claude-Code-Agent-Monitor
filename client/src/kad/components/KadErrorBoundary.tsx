/**
 * Phase 7 hardening — React error boundary for KAD screens. React only
 * supports catching render-time errors via a class component's
 * getDerivedStateFromError/componentDidCatch (no hook equivalent), so this
 * stays a class despite the rest of the KAD UI being function components.
 * Reuses the same red-block styling as `KadErrorBlock` (data-fetch errors)
 * so a render crash reads as "one more error state", not a broken app shell.
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { KadButton } from "./primitives";

interface Props {
  children: ReactNode;
  /** Optional label for the crashed area, e.g. "Bảng công việc" — shown in the fallback. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class KadErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[kad] render error caught by KadErrorBoundary:", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-[#fceaea] px-6 py-10 text-center">
          <span className="kad-heading text-[#c22f35]">
            {this.props.label ? `${this.props.label} gặp lỗi hiển thị.` : "Có lỗi khi hiển thị màn này."}
          </span>
          <span className="kad-body text-[#c22f35]/80 max-w-md">
            {this.state.error.message || "Lỗi không xác định."}
          </span>
          <div className="flex items-center gap-2">
            <KadButton variant="secondary" size="row" onClick={this.handleRetry}>
              Thử lại
            </KadButton>
            <KadButton variant="secondary" size="row" onClick={() => window.location.reload()}>
              Tải lại trang
            </KadButton>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
