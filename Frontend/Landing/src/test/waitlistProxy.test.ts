import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// The Vercel function behind /api/waitlist/application/* (api/waitlist/application.js).
const require = createRequire(import.meta.url);
const PROXY = resolve(__dirname, "../../../../api/waitlist/application.js");
const vercel = JSON.parse(readFileSync(resolve(__dirname, "../../../../vercel.json"), "utf8"));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

function load(): Handler {
  delete require.cache[PROXY];
  process.env.BACKEND_API_URL = "https://backend.test";
  return require(PROXY);
}

function call(handler: Handler, req: { method: string; path: string; headers?: Record<string, string>; body?: unknown }) {
  const out = { status: 0, headers: {} as Record<string, unknown>, body: undefined as unknown };
  const res = {
    setHeader: (name: string, value: unknown) => {
      out.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      out.status = code;
      return this;
    },
    json(payload: unknown) {
      out.body = payload;
      return this;
    },
  };
  return handler(
    { method: req.method, url: `/api/waitlist/application?path=${req.path}`, query: { path: req.path }, headers: req.headers ?? {}, body: req.body },
    res,
  ).then(() => out);
}

function upstream(status: number, body: unknown, setCookies: string[] = []) {
  const headers = new Headers({ "content-type": "application/json" });
  return {
    status,
    headers: Object.assign(headers, { getSetCookie: () => setCookies }),
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("waitlist application proxy", () => {
  it("is routed by vercel.json before anything else", () => {
    expect(vercel.rewrites[0]).toEqual({ source: "/api/waitlist/application/:path*", destination: "/api/waitlist/application?path=:path*" });
  });

  it("forwards only the application cookie, the idempotency key and the first client address", async () => {
    const fetchMock = vi.fn(async () => upstream(201, { success: true }, ["rv_wl_session=abc; Path=/api; HttpOnly; SameSite=Strict", "other=1; Path=/"]));
    vi.stubGlobal("fetch", fetchMock);
    const out = await call(load(), {
      method: "POST",
      path: "start",
      headers: {
        host: "revluma.vercel.app",
        origin: "https://revluma.vercel.app",
        cookie: "auth=secret; rv_wl_session=tok_123; theme=dark",
        "idempotency-key": "0f8b6c1e-6a7d-4f53-9a1c-2b0f6f0f2a11",
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        "x-forwarded-proto": "https",
      },
      body: { full_name: "Amina" },
    });
    expect(out.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://backend.test/api/v1/waitlist/application/start");
    expect(init.headers.Cookie).toBe("rv_wl_session=tok_123");
    expect(init.headers["Idempotency-Key"]).toBe("0f8b6c1e-6a7d-4f53-9a1c-2b0f6f0f2a11");
    expect(init.headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(init.headers).not.toHaveProperty("X-Forwarded-Proto");
    expect(out.headers["set-cookie"]).toEqual(["rv_wl_session=abc; Path=/api; HttpOnly; SameSite=Strict"]);
    expect(out.headers["cache-control"]).toBe("no-store");
  });

  it("rejects unknown actions, wrong methods and writes from other sites", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = load();
    expect((await call(handler, { method: "GET", path: "admin/stats" })).status).toBe(404);
    expect((await call(handler, { method: "GET", path: "../../users" })).status).toBe(404);
    const wrong = await call(handler, { method: "GET", path: "submit" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.allow).toBe("POST");
    const cross = await call(handler, { method: "POST", path: "submit", headers: { host: "revluma.vercel.app", origin: "https://evil.example" }, body: {} });
    expect(cross.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 with a safe message when the backend is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const out = await call(load(), { method: "GET", path: "resume" });
    expect(out.status).toBe(502);
    expect(out.body).toMatchObject({ success: false, code: "UPSTREAM_UNAVAILABLE" });
  });
});
