/**
 * API layer for the Founding Merchants application. Every call goes to the
 * site's own /api/waitlist/application proxy (same origin), so the HttpOnly
 * resume cookie stays first-party and is never visible to this code.
 */
import type { Answers, StepNumber } from "./schema";

export type ApplicationStatus = "in_progress" | "submitted" | "reviewed" | "accepted" | "rejected";

export type Application = {
  status: ApplicationStatus;
  current_step: 1 | 2 | 3 | 4;
  submitted_at: string | null;
  updated_at: string | null;
  referred: boolean;
  queue_position: number | null;
  referral_code: string | null;
  answers: Answers;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly step: number | null;
  readonly application: Application | null;
  constructor(status: number, body: Record<string, unknown> | null, fallback: string) {
    super(typeof body?.error === "string" ? body.error : fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : status === 0 ? "NETWORK" : "HTTP_" + status;
    this.fields = body?.fields && typeof body.fields === "object" ? (body.fields as Record<string, string>) : {};
    this.step = typeof body?.step === "number" ? body.step : null;
    const data = body?.data as { application?: Application } | undefined;
    this.application = data?.application ?? null;
  }
  /** Worth retrying: the request may not have reached the server or the server hiccuped. */
  get transient() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export const BASE = "/api/waitlist/application";
const TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 900;

type Options = { idempotencyKey?: string; retries?: number; timeoutMs?: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function once(method: string, action: string, body: unknown, options: Options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}/${action}`, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    if (!response.ok || json?.success === false) throw new ApiError(response.status, json, "Something went wrong. Please try again.");
    return json ?? {};
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, null, "We couldn't reach Revluma. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

/** One request with a timeout, retried on transient failures (only for idempotent calls). */
export async function request(method: string, action: string, body?: unknown, options: Options = {}) {
  const retries = options.retries ?? 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await once(method, action, body, options);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.transient || attempt >= retries) throw error;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

const application = (json: Record<string, unknown>) => ((json.data as { application?: Application | null })?.application ?? null) as Application | null;

export const waitlistApi = {
  async resume() {
    return application(await request("GET", "resume", undefined, { retries: 2 }));
  },
  /** First save. The key makes a retried or doubled request return the same application. */
  async start(payload: Record<string, unknown>, idempotencyKey: string) {
    return application(await request("POST", "start", payload, { idempotencyKey, retries: 1 })) as Application;
  },
  async saveStep(step: StepNumber, payload: Record<string, unknown>) {
    return application(await request("PUT", `steps/${step}`, payload, { retries: 1 })) as Application;
  },
  async submit() {
    return application(await request("POST", "submit", {}, { retries: 1 })) as Application;
  },
  async requestCode(email: string) {
    await request("POST", "resume/request-code", { email });
  },
  async verifyCode(email: string, code: string) {
    return application(await request("POST", "resume/verify-code", { email, code })) as Application;
  },
  async endSession() {
    await request("DELETE", "session");
  },
};

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
