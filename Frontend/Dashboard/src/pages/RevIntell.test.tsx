import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import api, { ApiError } from '@/lib/api';
import { RevStreamError, streamRevAnswer, type RevAnswerPayload, type RevStreamRequest } from '@/lib/revStream';
import RevIntell from './RevIntell';

const theme = vi.hoisted(() => ({ value: 'dark' }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { full_name: 'Test Owner' } }) }));
vi.mock('@/store', () => ({ useThemeStore: (select: (state: { theme: string }) => unknown) => select({ theme: theme.value }) }));
vi.mock('@/lib/api', () => {
  class FixtureApiError extends Error {
    constructor(public status: number, message: string, public body?: unknown) { super(message); }
  }
  const mockedApi = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return { api: mockedApi, default: mockedApi, ApiError: FixtureApiError };
});
vi.mock('@/lib/revStream', () => {
  class FixtureStreamError extends Error {
    constructor(public code: string, message: string, public status = 0) { super(message); }
  }
  return { streamRevAnswer: vi.fn(), RevStreamError: FixtureStreamError };
});
vi.mock('@/components/rev/RevAnswerView', () => ({ default: ({ payload }: { payload: RevAnswerPayload }) => <p>{payload.text}</p> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const reply = (data: unknown, success = true) => ({ ok: true, status: 200, data: { success, data } });
type Reply = ReturnType<typeof reply>;
const conversation = (id: string) => ({ id, title: `Conversation ${id}`, message_count: 1, last_activity_at: '2026-11-02T12:00:00Z' });
const history = ['A', 'B'].map(conversation);
const thread = (id: string) => ({ messages: [{ id: `message-${id}`, role: 'user', content: `Message from ${id}`, created_at: '2026-11-02T12:00:00Z' }] });
const answer = (id: string, text: string): RevAnswerPayload => ({ success: true, conversation_id: id, read_only: true, response_type: 'chat', text });
const turnReply = (data: RevAnswerPayload) => ({ ok: true, status: 200, data });
const findingOne = '11111111-1111-4111-8111-111111111111';
const findingTwo = '22222222-2222-4222-8222-222222222222';
const findingReply = (id = findingOne, title = 'Revenue decline') => reply({ finding: {
  id, title, description: 'Observed change in recorded revenue.', evidence: { private_marker: 'RAW_EVIDENCE_MUST_NOT_BE_SENT' },
} });
let replies: Map<string, Promise<Reply>>;
let streams: Array<{ request: RevStreamRequest; result: ReturnType<typeof deferred<{ conversationId: string | null; completed: boolean }>> }>;

function LocationControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <output aria-label="Current path">{location.pathname}</output>
    <output aria-label="Current search">{location.search}</output>
    <button onClick={() => navigate(`/dashboard/rev-intell?finding=${findingTwo}`)}>Open another finding</button>
    <button onClick={() => navigate(-1)}>Browser back</button>
    <button onClick={() => navigate(1)}>Browser forward</button>
  </>;
}
function renderPage(path = '/dashboard/rev-intell') {
  return render(<MemoryRouter initialEntries={[path]}>
    <LocationControls />
    <Routes><Route path="/dashboard/rev-intell/:conversationId?" element={<RevIntell />} /></Routes>
  </MemoryRouter>);
}
const title = (id: string) => new RegExp(`^Conversation ${id}\\b`);
async function historyReady() { await screen.findByRole('button', { name: title('A') }); }
function select(id: string) { fireEvent.click(screen.getByRole('button', { name: title(id) })); }
async function searched(query: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: query } });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(`/rev/conversations?q=${query}`));
}
function send(text = 'Investigate revenue') {
  fireEvent.change(screen.getByPlaceholderText(/Ask (me|Rev)/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

beforeEach(() => {
  replies = new Map(); streams = [];
  theme.value = 'dark';
  vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(streamRevAnswer).mockReset();
  vi.mocked(api.delete).mockReset(); vi.mocked(api.patch).mockReset();
  vi.mocked(api.get).mockImplementation(path => {
    const pending = replies.get(path);
    if (pending) return pending;
    if (path.startsWith('/rev/conversations')) return Promise.resolve(reply(history));
    if (path.startsWith('/rev/conversation/')) return Promise.resolve(reply(thread(path.split('/').pop()!)));
    throw new Error('Unexpected mocked API request.');
  });
  vi.mocked(streamRevAnswer).mockImplementation(request => {
    const result = deferred<{ conversationId: string | null; completed: boolean }>();
    streams.push({ request, result });
    return result.promise;
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network requests are forbidden in this suite.'); }));
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => {
  cleanup();
  await act(async () => { streams.forEach(stream => stream.result.resolve({ conversationId: null, completed: false })); });
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('finding investigation handoff', () => {
  async function openFinding() {
    replies.set(`/rev/findings/${findingOne}`, Promise.resolve(findingReply()));
    const view = renderPage(`/dashboard/rev-intell?finding=${findingOne}`);
    await screen.findByRole('heading', { name: 'Revenue decline' });
    return view;
  }
  async function finishFinding(text = 'Finding answer') {
    await act(async () => {
      streams[0].request.handlers.onMeta?.({ conversation_id: 'Created' });
      streams[0].request.handlers.onFinal?.(answer('Created', text));
      streams[0].result.resolve({ conversationId: 'Created', completed: true });
    });
  }
  it.each(['light', 'dark'])('loads finding context and an editable draft without sending or exposing evidence (%s)', async mode => {
    theme.value = mode;
    const pending = deferred<Reply>(); replies.set(`/rev/findings/${findingOne}`, pending.promise);
    renderPage(`/dashboard/rev-intell?finding=${findingOne}`);
    expect(screen.getByText('Loading finding details…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await act(async () => pending.resolve(findingReply()));
    expect(screen.getByRole('region', { name: 'Finding context' })).toHaveTextContent('Revenue decline');
    const draft = screen.getByPlaceholderText(/Ask (me|Rev)/);
    expect((draft as HTMLTextAreaElement).value).toContain('Revenue decline');
    expect((draft as HTMLTextAreaElement).value).not.toContain('RAW_EVIDENCE');
    expect(screen.getByText(/Rev will verify this finding/)).toBeInTheDocument();
    expect(streamRevAnswer).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
    send('My edited investigation question');
    expect(streams[0].request).toMatchObject({ message: 'My edited investigation question', findingId: findingOne });
  });
  it('preserves earlier finding answers when Ask again creates a new turn, then clears context for New Chat', async () => {
    await openFinding(); send('Edited finding question'); await finishFinding();
    expect(screen.getByLabelText('Current search')).toHaveTextContent(`?finding=${findingOne}`);
    expect(screen.getAllByText('Edited finding question')).toHaveLength(1);
    expect(screen.getAllByText('Finding answer')).toHaveLength(1);
    expect(api.get).not.toHaveBeenCalledWith('/rev/conversation/Created');
    expect(streams[0].request.signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ask again', exact: true }));
    expect(streams).toHaveLength(1);
    expect(screen.getByLabelText('Question recovery')).toHaveTextContent('creates a new question');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(streams[1].request).toMatchObject({ findingId: findingOne, conversationId: 'Created' });
    expect(streams[1].request.reuseUserMessage).not.toBe(true);
    await act(async () => {
      streams[1].request.handlers.onFinal?.(answer('Created', 'Regenerated finding answer'));
      streams[1].result.resolve({ conversationId: 'Created', completed: true });
    });
    expect(screen.getAllByText('Edited finding question')).toHaveLength(2);
    expect(screen.getAllByText('Finding answer')).toHaveLength(1);
    expect(screen.getAllByText('Regenerated finding answer')).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' })); send('Unrelated question');
    expect(streams[2].request.findingId).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'Finding context' })).not.toBeInTheDocument();
    expect(screen.queryByText('Edited finding question')).not.toBeInTheDocument();
  });
  it('forwards finding_id with the edited question through the attachment non-streaming path', async () => {
    vi.mocked(api.post).mockResolvedValue(turnReply(answer('ImageCreated', 'Image finding answer')));
    const view = await openFinding();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['fixture image'], 'fixture.png', { type: 'image/png' })] },
    });
    await screen.findByAltText('attachment'); send('Explain the finding with this image');
    await screen.findByText('Image finding answer');
    expect(api.post).toHaveBeenCalledWith('/rev/chat', expect.objectContaining({ finding_id: findingOne, message: 'Explain the finding with this image', image_media_type: 'image/png' }));
    expect(JSON.stringify(vi.mocked(api.post).mock.calls)).not.toContain('RAW_EVIDENCE');
    expect(streamRevAnswer).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current search')).toHaveTextContent(`?finding=${findingOne}`);
  });
  it.each([
    ['INVALID_FINDING_ID', 400], ['FINDING_NOT_FOUND', 404], ['FINDING_EVIDENCE_UNVERIFIED', 409],
  ] as const)('blocks sending when finding lookup rejects with %s and allows lookup retry', async (code, status) => {
    replies.set(`/rev/findings/${findingOne}`, Promise.resolve(findingReply()));
    // History also loads on mount; route finding failures explicitly rather than relying on effect order.
    vi.mocked(api.get).mockImplementation(path => path.startsWith('/rev/findings/')
      ? Promise.reject(new ApiError(status, 'Rejected', { error: { code } })) : Promise.resolve(reply(history)));
    renderPage(`/dashboard/rev-intell?finding=${findingOne}`);
    await screen.findByRole('button', { name: 'Retry finding' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(streamRevAnswer).not.toHaveBeenCalled();
    vi.mocked(api.get).mockImplementation(path => Promise.resolve(path.startsWith('/rev/findings/') ? findingReply() : reply(history)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry finding' }));
    await screen.findByRole('heading', { name: 'Revenue decline' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    send(); expect(streams[0].request.findingId).toBe(findingOne);
  });
  it('rejects an empty identifier without fetching finding details', async () => {
    renderPage('/dashboard/rev-intell?finding=');
    await screen.findByRole('button', { name: 'Retry finding' });
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith('/rev/findings/'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
  it.each(['stream rejection', 'failed final', 'attachment rejection'])('does not display a successful investigation after %s', async failure => {
    const view = await openFinding();
    if (failure === 'attachment rejection') {
      vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'Unverified', { error: { code: 'FINDING_EVIDENCE_UNVERIFIED' } }));
      fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'fixture.png', { type: 'image/png' })] } });
      await screen.findByAltText('attachment');
    }
    send('Check this finding');
    if (failure !== 'attachment rejection') await act(async () => {
      if (failure === 'stream rejection') streams[0].result.reject(new RevStreamError('FINDING_EVIDENCE_UNVERIFIED', 'Unverified', 409));
      else {
        streams[0].request.handlers.onFinal?.({ ...answer('Rejected', 'Unsupported success'), success: false, error: { code: 'FINDING_EVIDENCE_UNVERIFIED' } } as RevAnswerPayload);
        streams[0].result.resolve({ conversationId: 'Rejected', completed: true });
      }
    });
    await screen.findByRole('button', { name: 'Retry finding' });
    expect(screen.queryByText('Unsupported success')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
  it('retries a rejected finding turn with verification and without duplicating the local question', async () => {
    await openFinding(); send('Rejected question');
    await act(async () => streams[0].result.reject(new RevStreamError('FINDING_EVIDENCE_UNVERIFIED', 'Unverified', 409)));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry finding' }));
    await screen.findByRole('heading', { name: 'Revenue decline' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByLabelText('Question recovery')).toHaveTextContent('rejected before it was saved');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(streams[1].request).toMatchObject({ findingId: findingOne });
    expect(streams[1].request.reuseUserMessage).not.toBe(true);
    expect(screen.getAllByText('Rejected question')).toHaveLength(1);
    await act(async () => {
      streams[1].request.handlers.onFinal?.(answer('Recovered', 'Recovered finding answer'));
      streams[1].result.resolve({ conversationId: 'Recovered', completed: true });
    });
    expect(screen.getAllByText('Rejected question')).toHaveLength(1);
    expect(screen.getAllByText('Recovered finding answer')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
  it('prepares a distinct finding question from loaded history and discloses unavailable attachments', async () => {
    replies.set(`/rev/findings/${findingOne}`, Promise.resolve(findingReply()));
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [...thread('A').messages,
      { id: 'rev-A', role: 'rev', content: 'Previous finding answer', created_at: '2026-11-02T12:00:00Z' },
    ] })));
    renderPage(`/dashboard/rev-intell/A?finding=${findingOne}`);
    await screen.findByText('Previous finding answer'); await screen.findByRole('heading', { name: 'Revenue decline' });
    fireEvent.click(screen.getByRole('button', { name: 'Ask again', exact: true }));
    expect(streams).toHaveLength(0);
    expect(screen.getByLabelText('Question recovery')).toHaveTextContent('Attachments are not restored from history');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with text only' }));
    expect(streams).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(streams[0].request).toMatchObject({ findingId: findingOne, conversationId: 'A', message: 'Message from A' });
    expect(streams[0].request.reuseUserMessage).not.toBe(true);
    expect(screen.getAllByText('Message from A')).toHaveLength(2);
    expect(screen.getByText('Previous finding answer')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each([true, false])('keeps the earlier attempt when persistence is acknowledged or uncertain (acknowledged=%s)', async acknowledged => {
    await openFinding(); send('Recoverable question');
    await act(async () => {
      if (acknowledged) streams[0].request.handlers.onMeta?.({ conversation_id: 'Created' });
      streams[0].result.reject(new RevStreamError('INTELLIGENCE_UNAVAILABLE', 'Unavailable', 503));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    if (!acknowledged) expect(screen.getByLabelText('Question recovery')).toHaveTextContent('may have been saved');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(streams[1].request).toMatchObject({ findingId: findingOne });
    expect(streams[1].request.reuseUserMessage).not.toBe(true);
    expect(screen.getAllByText('Recoverable question')).toHaveLength(2);
    expect(screen.getByText('Rev is momentarily unavailable. Try again in a moment.')).toBeInTheDocument();
  });
  it('shows the same two distinct finding turns after reloading persisted history', async () => {
    const view = await openFinding(); send('Investigate this finding'); await finishFinding('First persisted answer');
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await act(async () => {
      streams[1].request.handlers.onFinal?.(answer('Created', 'Second persisted answer'));
      streams[1].result.resolve({ conversationId: 'Created', completed: true });
    });
    expect(screen.getAllByText('Investigate this finding')).toHaveLength(2);
    expect(screen.getAllByText('First persisted answer')).toHaveLength(1);
    expect(screen.getAllByText('Second persisted answer')).toHaveLength(1);
    expect(streams.every(({ request }) => request.findingId === findingOne && request.reuseUserMessage !== true)).toBe(true);
    replies.set('/rev/conversation/Created', Promise.resolve(reply({ messages: [
      { id: 'u1', role: 'user', content: { text: 'Investigate this finding' } },
      { id: 'r1', role: 'rev', content: answer('Created', 'First persisted answer') },
      { id: 'u2', role: 'user', content: { text: 'Investigate this finding' } },
      { id: 'r2', role: 'rev', content: answer('Created', 'Second persisted answer') },
    ].map(message => ({ ...message, created_at: '2026-11-02T12:00:00Z' })) })));
    view.unmount(); renderPage(`/dashboard/rev-intell/Created?finding=${findingOne}`);
    await screen.findByText('Second persisted answer');
    expect(screen.getAllByText('Investigate this finding')).toHaveLength(2);
    expect(screen.getAllByText('First persisted answer')).toHaveLength(1);
    expect(screen.getAllByText('Second persisted answer')).toHaveLength(1);
    expect(streams).toHaveLength(2);
  });
  it.each(['successful', 'rejected', 'uncertain', 'acknowledged failure'] as const)('requires reattachment before repeating an image-assisted %s finding turn', async outcome => {
    const view = await openFinding();
    if (outcome === 'successful') vi.mocked(api.post).mockResolvedValue(turnReply(answer('ImageCreated', 'Image finding answer')));
    else vi.mocked(api.post).mockRejectedValue(outcome === 'rejected'
      ? new ApiError(409, 'Unverified', { error: { code: 'FINDING_EVIDENCE_UNVERIFIED' } })
      : outcome === 'acknowledged failure'
        ? new ApiError(503, 'Unavailable', { conversation_id: 'ImageCreated', error: { code: 'INTELLIGENCE_UNAVAILABLE' } })
        : new Error('Network interrupted'));
    const attach = () => fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['fixture image'], 'fixture.png', { type: 'image/png' })] },
    });
    attach(); await screen.findByAltText('attachment'); send('Investigate using this image');
    if (outcome === 'rejected') {
      fireEvent.click(await screen.findByRole('button', { name: 'Retry finding' }));
      await screen.findByRole('heading', { name: 'Revenue decline' });
    } else if (outcome === 'successful') await screen.findByText('Image finding answer');
    else await screen.findByText(outcome === 'acknowledged failure'
      ? 'Rev is momentarily unavailable. Try again in a moment.' : 'Rev is taking a moment. Please try again shortly.');
    fireEvent.click(screen.getByRole('button', { name: outcome === 'rejected' ? 'Try again' : 'Ask again' }));
    expect(screen.getByLabelText('Question recovery')).toHaveTextContent('Reattach the original image');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText(/Ask (me|Rev)/), { key: 'Enter' });
    expect(api.post).toHaveBeenCalledTimes(1); expect(streamRevAnswer).not.toHaveBeenCalled();
    attach(); await screen.findByAltText('attachment');
    vi.mocked(api.post).mockResolvedValue(turnReply(answer('ImageCreated', 'Repeated image answer')));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Repeated image answer');
    expect(api.post).toHaveBeenCalledTimes(2);
    if (outcome === 'successful' || outcome === 'acknowledged failure') {
      expect(vi.mocked(api.post).mock.calls[1][1]).toMatchObject({ conversation_id: 'ImageCreated' });
    }
    for (const [path, body] of vi.mocked(api.post).mock.calls) {
      expect(path).toBe('/rev/chat');
      expect(body).toMatchObject({ finding_id: findingOne, message: 'Investigate using this image', image_media_type: 'image/png' });
      expect(body).not.toHaveProperty('reuse_user_message');
    }
    expect(screen.getAllByText('Investigate using this image')).toHaveLength(outcome === 'rejected' ? 1 : 2);
    if (outcome === 'successful') expect(screen.getByText('Image finding answer')).toBeInTheDocument();
    expect(streamRevAnswer).not.toHaveBeenCalled();
  });
  it('asks the selected earlier question again without replacing either answer or using the latest question', async () => {
    await openFinding(); send('First question'); await finishFinding('First answer');
    send('Different follow-up');
    await act(async () => {
      streams[1].request.handlers.onFinal?.(answer('Created', 'Follow-up answer'));
      streams[1].result.resolve({ conversationId: 'Created', completed: true });
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask again' })[0]);
    expect(screen.getByPlaceholderText(/Ask (me|Rev)/)).toHaveValue('First question');
    send('Edited first question');
    expect(streams[2].request).toMatchObject({ message: 'Edited first question', findingId: findingOne, conversationId: 'Created' });
    expect(streams.every(({ request }) => request.findingId === findingOne && request.reuseUserMessage !== true)).toBe(true);
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.getByText('Follow-up answer')).toBeInTheDocument();
  });
  it.each(['new chat', 'conversation', 'another finding'])('ignores a late finding response after navigating to %s', async destination => {
    const pending = deferred<Reply>(); replies.set(`/rev/findings/${findingOne}`, pending.promise);
    replies.set(`/rev/findings/${findingTwo}`, Promise.resolve(findingReply(findingTwo, 'Orders decline')));
    renderPage(`/dashboard/rev-intell?finding=${findingOne}`); await historyReady();
    if (destination === 'new chat') fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    else if (destination === 'conversation') { select('B'); await screen.findByText('Message from B'); }
    else { fireEvent.click(screen.getByRole('button', { name: 'Open another finding' })); await screen.findByRole('heading', { name: 'Orders decline' }); }
    await act(async () => pending.resolve(findingReply()));
    expect(screen.queryByRole('heading', { name: 'Revenue decline' })).not.toBeInTheDocument();
    send('Current question');
    expect(streams[0].request.findingId).toBe(destination === 'another finding' ? findingTwo : undefined);
  });
  it.each([true, false])('updates the association after an investigation and ignores old stream callbacks (completed=%s)', async completed => {
    await openFinding(); send('First finding question'); if (completed) await finishFinding();
    replies.set(`/rev/findings/${findingTwo}`, Promise.resolve(findingReply(findingTwo, 'Orders decline')));
    fireEvent.click(screen.getByRole('button', { name: 'Open another finding' }));
    await screen.findByRole('heading', { name: 'Orders decline' }); send('Second finding question');
    expect(streams[1].request.findingId).toBe(findingTwo);
    if (!completed) expect(streams[0].request.signal?.aborted).toBe(true);
    await act(async () => streams[0].request.handlers.onFinal?.(answer('Created', 'Late old finding answer')));
    expect(screen.queryByText('Late old finding answer')).not.toBeInTheDocument();
    expect(screen.queryByText('First finding question')).not.toBeInTheDocument();
    expect(screen.getAllByText('Second finding question')).toHaveLength(1);
  });
});

describe('conversation history reliability', () => {
  it('shows a recoverable failure instead of a false empty history and visibly retries', async () => {
    replies.set('/rev/conversations', Promise.reject(new Error('offline')));
    // Attach the failure to the mocked request without an unhandled rejection during debounce.
    replies.get('/rev/conversations')!.catch(() => {});
    renderPage();
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation history is unavailable');
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    const next = deferred<Reply>(); replies.set('/rev/conversations', next.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation history' }));
    expect(screen.getByText('Loading conversation history…')).toBeInTheDocument();
    await act(async () => next.resolve(reply([])));
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('shows verified empty only after a successful empty response', async () => {
    const pending = deferred<Reply>(); replies.set('/rev/conversations', pending.promise);
    renderPage();
    expect(screen.getByText('Loading conversation history…')).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await act(async () => pending.resolve(reply([])));
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
  });
  it.each([reply([], false), reply(null)])('does not treat an unsuccessful or malformed envelope as empty: %#', async response => {
    replies.set('/rev/conversations', Promise.resolve(response));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation history is unavailable');
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
  });
  it('preserves previously loaded history through a failed search and retry', async () => {
    renderPage(); await historyReady();
    const pending = deferred<Reply>(); replies.set('/rev/conversations?q=unavailable', pending.promise);
    await searched('unavailable');
    expect(screen.getByRole('button', { name: title('A') })).toBeInTheDocument();
    await act(async () => pending.reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('Conversation history is unavailable');
    expect(screen.getByText('Showing previously loaded conversations.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: title('A') })).toBeInTheDocument();
    replies.set('/rev/conversations?q=unavailable', Promise.resolve(reply([conversation('Recovered')])));
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation history' }));
    expect(await screen.findByRole('button', { name: title('Recovered') })).toBeInTheDocument();
  });
  it.each(['resolve', 'reject'] as const)('ignores out-of-order search %s after newer results', async completion => {
    renderPage(); await historyReady();
    const old = deferred<Reply>(); const current = deferred<Reply>();
    replies.set('/rev/conversations?q=old', old.promise); replies.set('/rev/conversations?q=new', current.promise);
    await searched('old'); await searched('new');
    await act(async () => current.resolve(reply([conversation('Newest')])));
    await act(async () => completion === 'resolve' ? old.resolve(reply([conversation('Outdated')])) : old.reject(new Error('late failure')));
    expect(screen.getByRole('button', { name: title('Newest') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: title('Outdated') })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('invalidates the old search immediately, before the newer debounce fires', async () => {
    renderPage(); await historyReady();
    const old = deferred<Reply>(); replies.set('/rev/conversations?q=old', old.promise);
    await searched('old');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'new' } });
    await act(async () => old.resolve(reply([conversation('Outdated')])));
    expect(screen.queryByRole('button', { name: title('Outdated') })).not.toBeInTheDocument();
    expect(screen.getByText('Loading conversation history…')).toBeInTheDocument();
  });
  it('provides the same accessible failure recovery in the mobile drawer', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    renderPage(); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation history' }));
    expect(screen.getAllByRole('button', { name: 'Retry conversation history' })).toHaveLength(2);
    vi.mocked(api.get).mockResolvedValue(reply([]));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry conversation history' })[1]);
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
    expect(screen.getAllByText('No conversations yet.')).toHaveLength(2);
  });
});

describe('history requests overlapping successful mutations', () => {
  it.each([
    ['delete', 'success'], ['delete', 'failure'],
    ['rename', 'success'], ['rename', 'failure'],
  ])('keeps a successful %s when older history completes and the refresh is a %s', async (mutation, outcome) => {
    const pendingMutation = deferred<Reply>();
    const oldSearch = deferred<Reply>(); const oldLatestSearch = deferred<Reply>(); const refresh = deferred<Reply>();
    if (mutation === 'delete') vi.mocked(api.delete).mockReturnValue(pendingMutation.promise);
    else vi.mocked(api.patch).mockReturnValue(pendingMutation.promise);
    renderPage('/dashboard/rev-intell/B'); await screen.findByText('Message from B'); await historyReady();
    replies.set('/rev/conversations?q=before', oldSearch.promise);
    await searched('before');
    if (mutation === 'delete') {
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation' })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    } else {
      fireEvent.click(screen.getAllByRole('button', { name: 'Rename conversation' })[0]);
      fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), { target: { value: 'Renamed A' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    }
    replies.set('/rev/conversations?q=latest', oldLatestSearch.promise);
    await searched('latest');
    replies.set('/rev/conversations?q=latest', refresh.promise);
    await act(async () => pendingMutation.resolve(reply(null)));

    // An unrelated dialog and active thread must survive history reconciliation.
    if (mutation === 'delete') fireEvent.click(screen.getAllByRole('button', { name: 'Rename conversation' })[0]);
    else fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation' })[1]);
    const unrelatedDialog = mutation === 'delete' ? 'dialog' : 'alertdialog';
    await act(async () => { oldSearch.resolve(reply(history)); oldLatestSearch.resolve(reply(history)); });
    expect(screen.queryByRole('button', { name: title('A') })).not.toBeInTheDocument();
    if (mutation === 'rename') expect(screen.getByRole('button', { name: /^Renamed A\b/ })).toBeInTheDocument();
    expect(screen.getByText('Loading conversation history…')).toBeInTheDocument();
    expect(screen.getByRole(unrelatedDialog)).toBeInTheDocument();
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/rev/conversations?q=latest')).toHaveLength(2);

    const updated = mutation === 'delete' ? [conversation('B')] : [{ ...conversation('A'), title: 'Renamed A' }, conversation('B')];
    if (outcome === 'failure') {
      await act(async () => refresh.reject(new Error('refresh unavailable')));
      expect(screen.getByRole('alert')).toHaveTextContent('Conversation history is unavailable');
      expect(screen.queryByRole('button', { name: title('A') })).not.toBeInTheDocument();
      if (mutation === 'rename') expect(screen.getByRole('button', { name: /^Renamed A\b/ })).toBeInTheDocument();
      replies.set('/rev/conversations?q=latest', Promise.resolve(reply(updated)));
      fireEvent.click(screen.getByRole('button', { name: 'Retry conversation history' }));
    } else await act(async () => refresh.resolve(reply(updated)));
    await waitFor(() => expect(screen.queryByText('Loading conversation history…')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole(unrelatedDialog)).toBeInTheDocument();
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/rev/conversations?q=latest');
  });
});

describe('URL-scoped conversation retrieval', () => {
  it('prevents delayed A from replacing B after rapid switching', async () => {
    const a = deferred<Reply>(); const b = deferred<Reply>();
    replies.set('/rev/conversation/A', a.promise); replies.set('/rev/conversation/B', b.promise);
    renderPage('/dashboard/rev-intell/A'); await historyReady(); select('B');
    await act(async () => b.resolve(reply(thread('B'))));
    await act(async () => a.resolve(reply(thread('A'))));
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(screen.queryByText('Message from A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
  });
  it.each([new Error('offline'), new ApiError(404, 'not found'), new ApiError(403, 'forbidden')])('ignores stale A errors and keeps B loading: %#', async error => {
    const a = deferred<Reply>(); const b = deferred<Reply>();
    replies.set('/rev/conversation/A', a.promise); replies.set('/rev/conversation/B', b.promise);
    renderPage('/dashboard/rev-intell/A'); await historyReady(); select('B');
    await act(async () => a.reject(error));
    expect(screen.getByText('Loading conversation...')).toBeInTheDocument();
    expect(screen.queryByText('Conversation not found')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => b.resolve(reply(thread('B'))));
    expect(screen.getByText('Message from B')).toBeInTheDocument();
  });
  it('keeps New Chat clear when a pending conversation completes', async () => {
    const pending = deferred<Reply>(); replies.set('/rev/conversation/A', pending.promise);
    renderPage('/dashboard/rev-intell/A'); await historyReady();
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await act(async () => pending.resolve(reply(thread('A'))));
    expect(screen.getByText('How can I help your revenue today?')).toBeInTheDocument();
    expect(screen.queryByText('Message from A')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading conversation...')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/);
  });
  it.each(['dark', 'light'])('recovers failed retrieval through Retry without changing its URL in %s mode', async mode => {
    theme.value = mode;
    vi.mocked(api.get).mockImplementation(path => path === '/rev/conversation/A' ? Promise.reject(new Error('offline')) : Promise.resolve(reply(history)));
    renderPage('/dashboard/rev-intell/A');
    expect(await screen.findByRole('alert')).toHaveTextContent('This conversation could not be loaded');
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    const pending = deferred<Reply>(); vi.mocked(api.get).mockImplementation(path => path === '/rev/conversation/A' ? pending.promise : Promise.resolve(reply(history)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation' }));
    expect(screen.getByText('Loading conversation...')).toBeInTheDocument();
    await act(async () => pending.resolve(reply(thread('A'))));
    expect(screen.getByText('Message from A')).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/A');
  });
  it.each([403, 404])('retains the safe unavailable response for HTTP %s', async status => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(status, 'unavailable'));
    renderPage('/dashboard/rev-intell/A');
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  });
  it('keeps direct links and browser back/forward as the source of truth', async () => {
    renderPage('/dashboard/rev-intell/A');
    expect(await screen.findByText('Message from A')).toBeInTheDocument(); await historyReady(); select('B');
    expect(await screen.findByText('Message from B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(await screen.findByText('Message from A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }));
    expect(await screen.findByText('Message from B')).toBeInTheDocument();
  });
  it('allows a verified empty conversation to receive its first message', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [] })));
    renderPage('/dashboard/rev-intell/A');
    expect(await screen.findByText('No messages in this conversation yet.')).toBeInTheDocument();
    send();
    expect(streamRevAnswer).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'A' }));
  });
  it('does not navigate away from B when deletion of A completes after browser navigation', async () => {
    const pending = deferred<Reply>(); vi.mocked(api.delete).mockReturnValue(pending.promise);
    renderPage('/dashboard/rev-intell/A'); await historyReady(); select('B'); await screen.findByText('Message from B');
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' })); await screen.findByText('Message from A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward' })); await screen.findByText('Message from B');
    await act(async () => pending.resolve(reply(null)));
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
  });
});

describe('turn callbacks remain in their originating thread', () => {
  it.each(['resolve', 'reject'] as const)('ignores late stream metadata, frames and %s after switching to a newer turn', async completion => {
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Message from A'); await historyReady(); send('Question for A');
    const old = streams[0]; select('B'); await screen.findByText('Message from B'); send('Question for B');
    expect(old.request.signal?.aborted).toBe(true);
    await act(async () => {
      old.request.handlers.onMeta?.({ conversation_id: 'Outdated' });
      old.request.handlers.onPlan?.({ steps: [{ id: 'old', tool: 'old', label: 'Outdated plan', status: 'running' }] });
      old.request.handlers.onStep?.({ id: 'old', tool: 'old', label: 'Outdated step', status: 'completed' });
      old.request.handlers.onEvidence?.({ items: [] });
      old.request.handlers.onFinal?.(answer('Outdated', 'Outdated answer'));
      if (completion === 'resolve') old.result.resolve({ conversationId: 'Outdated', completed: true });
      else old.result.reject(new Error('late stream failure'));
    });
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeInTheDocument();
    expect(screen.queryByText('Outdated answer')).not.toBeInTheDocument();
    await act(async () => {
      streams[1].request.handlers.onFinal?.(answer('B', 'Current answer'));
      streams[1].result.resolve({ conversationId: 'B', completed: true });
    });
    expect(screen.getByText('Current answer')).toBeInTheDocument();
  });
  it('protects New Chat while an initial stream has not yet created its conversation', async () => {
    renderPage(); send();
    const old = streams[0]; fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await act(async () => {
      old.request.handlers.onMeta?.({ conversation_id: 'Late' });
      old.request.handlers.onFinal?.(answer('Late', 'Late answer'));
      old.result.resolve({ conversationId: 'Late', completed: true });
    });
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/);
    expect(screen.getByText('How can I help your revenue today?')).toBeInTheDocument();
    expect(screen.queryByText('Late answer')).not.toBeInTheDocument();
  });
  it.each([true, false])('keeps the optimistic turn when its own conversation is created (metadata=%s)', async metadata => {
    renderPage(); send();
    await act(async () => {
      if (metadata) streams[0].request.handlers.onMeta?.({ conversation_id: 'Created' });
      streams[0].request.handlers.onFinal?.(answer('Created', 'Created answer'));
      streams[0].result.resolve({ conversationId: 'Created', completed: true });
    });
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/Created');
    expect(screen.getByText('Investigate revenue')).toBeInTheDocument();
    expect(screen.getByText('Created answer')).toBeInTheDocument();
    expect(streams[0].request.signal?.aborted).toBe(false);
    expect(api.get).not.toHaveBeenCalledWith('/rev/conversation/Created');
  });
  it('ignores late regeneration after another conversation starts streaming', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [...thread('A').messages, { id: 'rev-A', role: 'rev', content: 'Old response', created_at: '2026-11-02T12:00:00Z' }] })));
    const pending = deferred<ReturnType<typeof turnReply>>(); vi.mocked(api.post).mockReturnValue(pending.promise);
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Old response'); await historyReady();
    fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
    select('B'); await screen.findByText('Message from B'); send();
    await act(async () => pending.resolve(turnReply(answer('A', 'Outdated retry'))));
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeInTheDocument();
    expect(screen.queryByText('Outdated retry')).not.toBeInTheDocument();
  });
  it('ignores an attachment response after switching to a newer streaming turn', async () => {
    const pending = deferred<ReturnType<typeof turnReply>>(); vi.mocked(api.post).mockReturnValue(pending.promise);
    const view = renderPage('/dashboard/rev-intell/A'); await screen.findByText('Message from A'); await historyReady();
    const file = new File(['fixture image'], 'fixture.png', { type: 'image/png' });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByAltText('attachment'); send('Explain this image');
    expect(api.post).toHaveBeenCalledWith('/rev/chat', expect.objectContaining({ conversation_id: 'A' }));
    select('B'); await screen.findByText('Message from B'); send('Question for B');
    await act(async () => pending.resolve(turnReply(answer('ImageLate', 'Outdated image answer'))));
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
    expect(screen.queryByText('Outdated image answer')).not.toBeInTheDocument();
  });
  it('keeps an explicitly stopped turn cancelled when late frames arrive', async () => {
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Message from A'); await historyReady(); send();
    const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    await act(async () => {
      streams[0].request.handlers.onMeta?.({ conversation_id: 'Late' });
      streams[0].request.handlers.onFinal?.(answer('Late', 'Late answer'));
      streams[0].result.resolve({ conversationId: 'Late', completed: true });
    });
    expect(screen.getByText('Generation stopped.')).toBeInTheDocument();
    expect(screen.queryByText('Late answer')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/A');
  });
  it('refreshes the current search after completion rather than a captured older query', async () => {
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Message from A'); await historyReady(); send();
    await searched('current');
    await act(async () => {
      streams[0].request.handlers.onFinal?.(answer('A', 'Current answer'));
      streams[0].result.resolve({ conversationId: 'A', completed: true });
    });
    expect(api.get).toHaveBeenLastCalledWith('/rev/conversations?q=current');
  });
  it('does not refresh history when a stream finishes after unmount', async () => {
    const view = renderPage(); send(); const calls = vi.mocked(api.get).mock.calls.length;
    view.unmount();
    await act(async () => streams[0].result.resolve({ conversationId: 'Late', completed: true }));
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(streams[0].request.signal?.aborted).toBe(true);
  });
});
