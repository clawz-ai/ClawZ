import { Component, type ReactNode, type ErrorInfo } from "react";
import { appLog } from "../../lib/tauri";
import { XCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const detail = [
      `[ErrorBoundary] Uncaught render error`,
      `  name: ${error.name}`,
      `  message: ${error.message}`,
      `  componentStack: ${info.componentStack ?? "(none)"}`,
      `  stack: ${error.stack ?? "(none)"}`,
    ].join("\n");

    console.error(detail);
    appLog("error", detail);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center bg-[var(--bg-surface)]">
          <div className="flex w-[420px] flex-col items-center gap-4 rounded-2xl bg-[var(--bg-main)] p-8 shadow-lg">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E74C3C15]">
              <XCircle size={28} className="text-[var(--danger)]" />
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              页面渲染出错
            </h2>
            <p className="text-center text-sm text-[var(--text-secondary)]">
              {this.state.error?.message || "未知错误"}
            </p>
            <pre className="max-h-32 w-full overflow-auto rounded-lg bg-[var(--bg-surface)] p-3 font-mono text-[11px] text-[var(--text-secondary)]">
              {this.state.error?.stack?.slice(0, 500) || "No stack trace"}
            </pre>
            <button
              onClick={this.handleReload}
              className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <RefreshCw size={14} />
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
