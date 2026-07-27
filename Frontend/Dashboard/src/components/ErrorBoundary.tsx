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

  componentDidMount() {
    window.addEventListener("popstate", this.handleRouteChange);
    window.addEventListener("hashchange", this.handleRouteChange);
  }

  componentWillUnmount() {
    window.removeEventListener("popstate", this.handleRouteChange);
    window.removeEventListener("hashchange", this.handleRouteChange);
  }

  handleRouteChange = () => {
    if (this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  };

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
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "0.5rem 1rem",
                background: "#333",
                color: "white",
                border: "1px solid #555",
                cursor: "pointer"
              }}
            >
              Reload
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.history.back();
              }}
              style={{
                padding: "0.5rem 1rem",
                background: "#007FFF",
                color: "white",
                border: "1px solid #007FFF",
                cursor: "pointer"
              }}
            >
              Go Back
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
