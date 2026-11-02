// Rev Intelligence — server-sent event streaming client.
//
// The browser talks only to the Revluma Node gateway. This module owns SSE
// framing, cancellation and typed events so the workspace never renders an
// unvalidated provider payload directly.

import { getApiBaseUrl, getStreamingAuthHeaders } from "@/lib/api";

export type EvidenceStatus = "available" | "partial" | "unavailable" | "unsupported";

export interface EvidencePeriod {
  start: string;
  end: string;
  timezone?: string;
  semantics?: string;
  label?: string;
}

export interface EvidenceItem {
  id: string;
  metric: string;
  label: string;
  value: string | number | null;
  unit: "currency" | "count" | "ratio";
  currency: string | null;
  status: EvidenceStatus;
  period: EvidencePeriod;
  source: string;
  definition: string;
  coverage?: Record<string, unknown>;
  freshness?: { state?: string; as_of?: string | null; age_minutes?: number };
  limitations?: string[];
}

export interface InvestigationStep {
  id: string;
  tool: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  detail?: string | null;
}

export interface SpecialistsSummary {
  name: string;
  status: "success" | "partial" | "no_data" | "error";
  confidence?: number;
  fact_count?: number;
  signal_count?: number;
  warnings?: string[];
}

export interface RevFact {
  text: string;
  evidence_ids: string[];
  metric?: string;
  currency?: string | null;
  value?: unknown;
  unit?: string;
  status?: string;
}

export interface RevRecommendation {
  label: string;
  why: string;
  measure: string;
  executed: false;
  requires?: string;
  read_only?: boolean;
  evidence_ids?: string[];
}

export interface RevHypothesis {
  statement: string;
  status: "hypothesis";
  verified: false;
  confidence: number;
  basis_evidence_ids?: string[];
  note?: string;
}

export interface RevInvestigationMeta {
  id: string;
  question: string;
  intent: string;
  label?: string;
  status: string;
  period: EvidencePeriod & { compared_to?: { start: string; end: string; label?: string } };
  segment?: string | null;
  steps: InvestigationStep[];
  follow_ups: string[];
  tools_used?: string[];
  context_used?: Record<string, unknown>;
}

export interface RevAnswerPayload {
  contract_version?: string;
  success?: boolean;
  read_only: boolean;
  response_type: string;
  text: string;
  response?: {
    situation?: string;
    insight?: string;
    implication?: string;
    recommendation?: string;
    confidence?: { score: number; basis: string };
    actions?: Array<{ label: string; tool?: string | null; params?: Record<string, unknown> }>;
    warnings?: string[];
  } | null;
  investigation?: RevInvestigationMeta;
  evidence?: {
    schema_version?: string;
    generated_at?: string;
    items: EvidenceItem[];
    /** Previous-period items cited by comparison facts. */
    comparison_items?: EvidenceItem[];
    by_currency?: Record<string, { value: string | null; items: string[] }>;
    coverage?: Record<string, unknown>;
    freshness?: { state?: string; as_of?: string | null };
    limitations?: string[];
    validation?: { valid: boolean; errors: string[] };
  };
  facts?: RevFact[];
  comparison_facts?: RevFact[];
  hypotheses?: RevHypothesis[];
  unknowns?: string[];
  recommendations?: RevRecommendation[];
  specialists?: SpecialistsSummary[];
  warnings?: string[];
  conversation_id?: string;
  message_id?: string | null;
}

export type RevStreamName =
  | "accepted" | "meta" | "plan" | "step" | "evidence" | "final"
  | "error" | "cancelled";

export interface RevStreamHandlers {
  onAccepted?: (data: unknown) => void;
  onMeta?: (data: { conversation_id: string; correlation_id?: string }) => void;
  onPlan?: (data: {
    investigation_id?: string;
    intent?: string;
    label?: string;
    steps: InvestigationStep[];
    period?: EvidencePeriod;
  }) => void;
  onStep?: (step: InvestigationStep) => void;
  onEvidence?: (data: NonNullable<RevAnswerPayload["evidence"]>) => void;
  onFinal?: (data: RevAnswerPayload) => void;
}

export interface RevStreamRequest {
  message: string;
  conversationId?: string | null;
  findingId?: string | null;
  reuseUserMessage?: boolean;
  signal?: AbortSignal;
  handlers: RevStreamHandlers;
}

export class RevStreamError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "RevStreamError";
    this.code = code;
    this.status = status;
  }
}

export function createSseParser(onEvent: (event: string, data: unknown) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      if (!chunk) return;
      buffer += chunk;
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    },
    flush() {
      const remaining = buffer;
      buffer = "";
      parseFrame(remaining);
    },
  };

  function parseFrame(raw: string) {
    if (!raw || !raw.trim()) return;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    onEvent(event, parsed);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Open a streaming investigation. Resolves when the server closes the stream.
 * Cancellation is signalled through `signal` (the Stop button aborts it).
 */
export async function streamRevAnswer({
  message, conversationId, findingId, reuseUserMessage, signal, handlers,
}: RevStreamRequest): Promise<{ conversationId: string | null; completed: boolean }> {
  const authHeaders = await getStreamingAuthHeaders();
  const response = await fetch(`${getApiBaseUrl()}/rev/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders,
    },
    credentials: "include",
    signal,
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(findingId ? { finding_id: findingId } : {}),
      ...(reuseUserMessage ? { reuse_user_message: true } : {}),
    }),
  });

  if (!response.ok) {
    let code = "STREAM_START_FAILED";
    let detail = "Rev could not start this response. Please try again.";
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) detail = body.error.message;
    } catch {
      // keep defaults
    }
    throw new RevStreamError(code, detail, response.status);
  }
  if (!response.body) {
    throw new RevStreamError("STREAM_UNSUPPORTED", "Streaming is not available in this browser.", 0);
  }

  let resolvedConversationId = conversationId ?? null;
  let completed = false;
  let streamError: RevStreamError | null = null;

  const parser = createSseParser((event, raw) => {
    const data = isRecord(raw) ? raw : {};
    switch (event as RevStreamName) {
      case "accepted":
        handlers.onAccepted?.(data);
        break;
      case "meta":
        if (typeof data.conversation_id === "string") {
          resolvedConversationId = data.conversation_id;
          handlers.onMeta?.({
            conversation_id: data.conversation_id,
            correlation_id: typeof data.correlation_id === "string" ? data.correlation_id : undefined,
          });
        }
        break;
      case "plan":
        handlers.onPlan?.({
          investigation_id: typeof data.investigation_id === "string" ? data.investigation_id : undefined,
          intent: typeof data.intent === "string" ? data.intent : undefined,
          label: typeof data.label === "string" ? data.label : undefined,
          steps: Array.isArray(data.steps) ? (data.steps as InvestigationStep[]) : [],
          period: isRecord(data.period) ? (data.period as unknown as EvidencePeriod) : undefined,
        });
        break;
      case "step":
        if (typeof data.tool === "string") {
          handlers.onStep?.({
            id: typeof data.id === "string" ? data.id : String(data.tool),
            tool: String(data.tool),
            label: typeof data.label === "string" ? data.label : String(data.tool).replace(/_/g, " "),
            status: (["pending", "running", "completed", "failed"].includes(String(data.status))
              ? String(data.status)
              : "running") as InvestigationStep["status"],
            detail: typeof data.detail === "string" ? data.detail : null,
          });
        }
        break;
      case "evidence":
        handlers.onEvidence?.(data as unknown as NonNullable<RevAnswerPayload["evidence"]>);
        break;
      case "final": {
        const payload = data as unknown as RevAnswerPayload;
        if (typeof payload.conversation_id === "string") {
          resolvedConversationId = payload.conversation_id;
        }
        completed = payload.success !== false;
        handlers.onFinal?.(payload);
        break;
      }
      case "error":
        streamError = new RevStreamError(
          typeof data.code === "string" ? data.code : "STREAM_FAILED",
          typeof data.message === "string" ? data.message : "Rev could not complete this response.",
        );
        break;
      case "cancelled":
        if (typeof data.conversation_id === "string") {
          resolvedConversationId = data.conversation_id;
        }
        break;
      default:
        break;
    }
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return { conversationId: resolvedConversationId, completed: false };
    }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }

  if (streamError) throw streamError;
  return { conversationId: resolvedConversationId, completed };
}
