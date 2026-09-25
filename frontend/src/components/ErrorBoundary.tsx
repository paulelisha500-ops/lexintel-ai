import React from "react";

interface State {
  error: Error | null;
}

/** Last line of defence: a rendering error shows a recoverable screen instead of a blank page. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; compact?: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("LexIntel UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const ar = document.documentElement.lang === "ar";
    return (
      <div className={this.props.compact ? "p-6" : "grid min-h-[60vh] place-items-center p-6"}>
        <div className="surface max-w-lg p-8 text-center">
          <h1 className="font-heading text-xl font-bold">
            {ar ? "حدث خطأ غير متوقع في هذه الصفحة" : "Something went wrong on this page"}
          </h1>
          <p className="mt-2 text-sm muted">
            {ar
              ? "لم تُفقد أي بيانات محفوظة. يمكنك المحاولة مرة أخرى أو العودة إلى الصفحة الرئيسية."
              : "No saved data was lost. You can try again or go back to the start."}
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-aeblack-50 p-3 text-start text-xs">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex justify-center gap-2">
            <button className="aegov-btn btn-sm" onClick={() => this.setState({ error: null })}>
              {ar ? "إعادة المحاولة" : "Try again"}
            </button>
            <a className="aegov-btn btn-outline btn-sm" href="/">
              {ar ? "الصفحة الرئيسية" : "Home"}
            </a>
          </div>
        </div>
      </div>
    );
  }
}
