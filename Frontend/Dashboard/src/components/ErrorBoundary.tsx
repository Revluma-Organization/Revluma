import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "2rem",
          color: "white",
          background: "#111",
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          position: "fixed",
          inset: 0,
          zIndex: 9999
        }}>
          <h2 style={{ color: "#ff6b6b", marginBottom: "1rem" }}>ERROR BOUNDARY</h2>
          <pre style={{ fontSize: "12px", lineHeight: "1.4" }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              background: "#333",
              color: "white",
              border: "1px solid #555",
              cursor: "pointer"
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
