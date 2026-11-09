import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api, { ApiError } from '@/lib/api';
import { RevStreamError, streamRevAnswer, type RevStreamRequest } from '@/lib/revStream';
import RevIntell from './RevIntell';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { full_name: 'Test Owner' } }) }));
vi.mock('@/store', () => ({ useThemeStore: (select: (state: { theme: string }) => unknown) => select({ theme: 'dark' }) }));
vi.mock('@/lib/api', () => {
  class FixtureApiError extends Error {
    constructor(public status: number, message: string, public body?: unknown) { super(message); }
  }
  const mocked = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return { api: mocked, default: mocked, ApiError: FixtureApiError };
});
vi.mock('@/lib/revStream', () => {
  class FixtureStreamError extends Error {
    constructor(public code: string, message: string, public status = 0) { super(message); }
  }
  return { streamRevAnswer: vi.fn(), RevStreamError: FixtureStreamError };
});
vi.mock('@/components/rev/RevAnswerView', () => ({ default: ({ payload }: { payload: { text: string } }) => <p>{payload.text}</p> }));

type Result = { conversationId: string | null; completed: boolean };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const streams: Array<{ request: RevStreamRequest; result: ReturnType<typeof deferred<Result>> }> = [];
function renderPage() {
  return render(<MemoryRouter initialEntries={['/dashboard/rev-intell']}><Routes><Route path='/dashboard/rev-intell/:conversationId?' element={<RevIntell />} /></Routes></MemoryRouter>);
}
function typeQuestion(text = 'Investigate revenue') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Rev' }), { target: { value: text } });
}
function clickSend() { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); }
async function accept(index = 0, id = 'accepted-conversation') {
  await act(async () => streams[index].request.handlers.onMeta?.({ conversation_id: id, correlation_id: streams[index].request.requestId }));
}
async function finish(index = 0, id = 'accepted-conversation', text = 'Persisted answer') {
  await act(async () => {
    streams[index].request.handlers.onFinal?.({ success: true, conversation_id: id, read_only: true, response_type: 'analysis', text });
    streams[index].result.resolve({ conversationId: id, completed: true });
  });
}

beforeEach(() => {
  streams.length = 0;
  vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(streamRevAnswer).mockReset();
  vi.mocked(api.get).mockImplementation(path => {
    if (path === '/stores') return Promise.resolve({ ok: true, status: 200, data: { success: true, data: { stores: [] } } });
    if (path === '/rev/conversations') return Promise.resolve({ ok: true, status: 200, data: { success: true, data: [] } });
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
  vi.mocked(streamRevAnswer).mockImplementation(request => {
    const result = deferred<Result>(); streams.push({ request, result }); return result.promise;
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => {
  cleanup();
  await act(async () => streams.forEach(stream => stream.result.resolve({ conversationId: null, completed: false })));
  vi.restoreAllMocks();
});

describe('Task 223 acceptance-safe submission', () => {
  it('keeps the question in the composer before backend acceptance', async () => {
    renderPage(); typeQuestion('Preserve this exact question'); clickSend();
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue('Preserve this exact question');
    await accept(); expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue('');
    await finish();
  });

  it('clears on a valid final response even when its meta frame was lost', async () => {
    renderPage(); typeQuestion('Accepted final'); clickSend();
    await finish(); expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue('');
  });

  it('sends a UUID correlation identifier with the raw edited question', async () => {
    renderPage(); typeQuestion('  Exact edited question  '); clickSend();
    expect(streams[0].request.message).toBe('Exact edited question');
    expect(streams[0].request.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await finish();
  });

  it('prevents double-click from preparing a second investigation', async () => {
    renderPage(); typeQuestion();
    const button = screen.getByRole('button', { name: 'Send message' });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    expect(streamRevAnswer).toHaveBeenCalledTimes(1); await finish();
  });

  it('prevents Enter plus click from preparing duplicate work', async () => {
    renderPage(); typeQuestion();
    const button = screen.getByRole('button', { name: 'Send message' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message Rev' }), { key: 'Enter' }); fireEvent.click(button);
    expect(streamRevAnswer).toHaveBeenCalledTimes(1); await finish();
  });

  it('reuses the same request ID after an uncertain pre-acceptance network failure', async () => {
    renderPage(); typeQuestion('Retry without duplication'); clickSend();
    const requestId = streams[0].request.requestId;
    await act(async () => streams[0].result.reject(new TypeError('Network request failed')));
    clickSend();
    expect(streams).toHaveLength(2);
    expect(streams[1].request.requestId).toBe(requestId);
    await finish(1);
  });

  it('uses distinct request IDs for intentionally distinct follow-up turns', async () => {
    renderPage(); typeQuestion('First'); clickSend(); await accept(); await finish();
    typeQuestion('Second'); clickSend();
    expect(streams[1].request.requestId).not.toBe(streams[0].request.requestId);
    await finish(1);
  });

  for (const [status, code] of [[401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [429, 'RATE_LIMIT_EXCEEDED'], [500, 'STREAM_START_FAILED'], [503, 'INTELLIGENCE_UNAVAILABLE']] as const) {
    it(`preserves the draft after pre-acceptance HTTP ${status}`, async () => {
      renderPage(); typeQuestion(`Question for ${status}`); clickSend();
      await act(async () => streams[0].result.reject(new RevStreamError(code, 'Submission failed', status)));
      expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue(`Question for ${status}`);
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    });
  }

  it('preserves the exact draft after a network rejection', async () => {
    renderPage(); typeQuestion('Network question'); clickSend();
    await act(async () => streams[0].result.reject(new TypeError('Network request failed')));
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue('Network question');
    expect(screen.queryByText('Persisted answer')).not.toBeInTheDocument();
  });

  it('preserves the question after malformed completion before acceptance', async () => {
    renderPage(); typeQuestion('Malformed response question'); clickSend();
    await act(async () => streams[0].result.reject(new RevStreamError('MALFORMED_RESPONSE', 'Incomplete response')));
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue('Malformed response question');
    expect(screen.queryByText('Persisted answer')).not.toBeInTheDocument();
  });

  it('keeps an accepted question in its thread after processing failure', async () => {
    renderPage(); typeQuestion('Accepted but failed'); clickSend(); await accept();
    await act(async () => streams[0].result.reject(new RevStreamError('INTELLIGENCE_TIMEOUT', 'Timed out')));
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue('');
    expect(screen.getAllByText('Accepted but failed')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeEnabled();
  });

  it('does not submit whitespace or expose a false loading state', () => {
    renderPage(); typeQuestion(' \n\t ');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(streamRevAnswer).not.toHaveBeenCalled();
  });

  it('does not truncate oversized client input', () => {
    renderPage(); const question = 'a'.repeat(2001); typeQuestion(question); clickSend();
    expect(streamRevAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toHaveValue(question);
  });

  it('retains an image after a pre-acceptance JSON failure', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(503, 'Unavailable', { error: { code: 'INTELLIGENCE_UNAVAILABLE' } }));
    const view = renderPage();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'proof.png', { type: 'image/png' })] } });
    await screen.findByAltText('attachment'); typeQuestion('Inspect this'); clickSend();
    await screen.findByText('Rev is momentarily unavailable. Try again in a moment.');
    expect(screen.getByAltText('attachment')).toBeInTheDocument();
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  for (const width of [320, 375, 430, 600, 768, 1024, 1280, 1440, 1920]) {
    it(`keeps the workspace composer and keyboard controls available at ${width}px`, () => {
      window.innerWidth = width;
      const view = renderPage();
      const input = screen.getByRole('textbox', { name: 'Message Rev' });
      const sendButton = screen.getByRole('button', { name: 'Send message' });
      expect(input).toBeInTheDocument(); expect(sendButton).toBeInTheDocument();
      expect(input).toBeEnabled(); expect(sendButton).toBeDisabled();
      expect(view.container.querySelector('.rev-workspace')).toHaveClass('overflow-hidden');
      expect(sendButton).toHaveClass('h-11', 'w-11');
      expect(input).toHaveAttribute('maxlength', '2000');
    });
  }

  it('clears an image only after accepted JSON response', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 200, data: { success: true, conversation_id: 'image-conversation', read_only: true, response_type: 'analysis', text: 'Image answer' } });
    const view = renderPage();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'proof.png', { type: 'image/png' })] } });
    await screen.findByAltText('attachment'); typeQuestion('Inspect this'); clickSend();
    await screen.findByText('Image answer'); await waitFor(() => expect(screen.queryByAltText('attachment')).not.toBeInTheDocument());
  });
});
