import { Component, type ReactNode } from "react";
import { WORKFLOW_KEY } from "./workflow";

// The persisted workflow is rehydrated at boot; a blob the restore guards miss would otherwise
// crash the render on every reload with no way out short of devtools. This boundary is that way
// out: it names the error and offers to drop the saved workflow and start clean.

type Props = { children: ReactNode; reload?: () => void };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => {
    try {
      localStorage.removeItem(WORKFLOW_KEY);
    } catch {
      // Site data disabled: nothing was persisted, so there is nothing to reset.
    }
    (this.props.reload ?? (() => window.location.reload()))();
  };

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <h1 className="text-sm font-semibold text-ink">Something broke while rendering</h1>
        <p className="max-w-xl text-center font-mono text-xs text-muted">
          {this.state.error.message}
        </p>
        <p className="max-w-xl text-center text-xs text-muted">
          This can be caused by a corrupted saved workflow. Resetting discards the invoice, edits
          and send state saved in this browser — presets and settings are unaffected.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker"
        >
          Reset saved workflow and reload
        </button>
      </div>
    );
  }
}
