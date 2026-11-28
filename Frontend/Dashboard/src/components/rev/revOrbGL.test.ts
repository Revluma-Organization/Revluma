import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getRevOrbRenderer, prewarmRevOrb, resetRevOrbRendererForTests } from "./revOrbGL";

const COMPLETION_STATUS_KHR = 0x91b1;

function mockGL({ parallel = true, linkOk = true, highp = 23 } = {}) {
  const calls: string[] = [];
  const uniforms = new Map<string, unknown[]>();
  const status = { complete: !parallel };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, HIGH_FLOAT: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8,
    getShaderPrecisionFormat: () => ({ precision: highp }),
    getExtension: (name: string) => (parallel && name === "KHR_parallel_shader_compile" ? {} : null),
    createShader: () => ({}), shaderSource: vi.fn(), compileShader: vi.fn(),
    createProgram: () => ({}), attachShader: vi.fn(), bindAttribLocation: vi.fn(),
    linkProgram: () => calls.push("link"),
    getProgramParameter: (_p: unknown, name: number) => (name === COMPLETION_STATUS_KHR ? status.complete : linkOk),
    getProgramInfoLog: () => "boom",
    createBuffer: () => ({}), bindBuffer: vi.fn(), bufferData: vi.fn(), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    useProgram: () => calls.push("use"),
    getUniformLocation: (_p: unknown, name: string) => name,
    viewport: vi.fn(),
    uniform1f: (loc: string, v: number) => uniforms.set(loc, [v]),
    uniform2f: (loc: string, a: number, b: number) => uniforms.set(loc, [a, b]),
    drawArrays: () => calls.push("draw"),
  };
  return { gl, calls, uniforms, status };
}

const frame = { phase: 3, amoeba: 0.7, energy: 0.4, muted: 0, glow: 0.55, nucleus: [0.05, -0.02] as [number, number] };

describe("revOrbGL", () => {
  let context: ReturnType<typeof mockGL> | null;
  beforeEach(() => {
    resetRevOrbRendererForTests();
    context = null;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => (context ? context.gl : null) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns null without WebGL so callers show the still", () => {
    expect(getRevOrbRenderer()).toBeNull();
    expect(() => prewarmRevOrb()).not.toThrow();
  });

  it("returns null when the GPU lacks highp fragment precision", () => {
    context = mockGL({ highp: 0 });
    expect(getRevOrbRenderer()).toBeNull();
  });

  it("creates one shared renderer and waits for the parallel link before drawing", () => {
    context = mockGL({ parallel: true });
    const renderer = getRevOrbRenderer()!;
    expect(renderer).toBeTruthy();
    expect(getRevOrbRenderer()).toBe(renderer);
    expect(renderer.canvas.getAttribute("aria-hidden")).toBe("true");
    expect(renderer.ready()).toBe(false);
    expect(renderer.draw(frame)).toBe(false);
    context.status.complete = true;
    expect(renderer.ready()).toBe(true);
    expect(renderer.draw(frame)).toBe(true);
    expect(context.calls.filter((c) => c === "link")).toHaveLength(1);
    expect(context.uniforms.get("uAmoeba")).toEqual([0.7]);
    expect(context.uniforms.get("uNucleus")).toEqual([0.05, -0.02]);
  });

  it("caps the backing store and only resizes when the size changes", () => {
    context = mockGL({ parallel: false });
    const renderer = getRevOrbRenderer()!;
    renderer.resize(372, 2);
    expect(renderer.canvas.width).toBe(744);
    renderer.resize(600, 3);
    expect(renderer.canvas.width).toBe(768);
    renderer.draw(frame);
    expect(context.uniforms.get("uRes")).toEqual([768, 768]);
  });

  it("gives up cleanly when the shader fails to link", () => {
    context = mockGL({ parallel: false, linkOk: false });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const renderer = getRevOrbRenderer()!;
    expect(renderer.ready()).toBe(false);
    expect(renderer.lost()).toBe(true);
    expect(renderer.draw(frame)).toBe(false);
  });

  it("reports a lost context and recovers when it is restored", () => {
    context = mockGL({ parallel: false });
    const renderer = getRevOrbRenderer()!;
    expect(renderer.ready()).toBe(true);
    renderer.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(renderer.lost()).toBe(true);
    expect(renderer.draw(frame)).toBe(false);
    renderer.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(renderer.lost()).toBe(false);
    expect(renderer.draw(frame)).toBe(true);
  });

  it("prewarms once: compiles, links and draws a tiny frame ahead of the call", () => {
    context = mockGL({ parallel: false });
    prewarmRevOrb();
    prewarmRevOrb();
    expect(context.calls.filter((c) => c === "link")).toHaveLength(1);
    expect(context.calls).toContain("draw");
    expect(getRevOrbRenderer()!.canvas.width).toBe(8);
  });
});
