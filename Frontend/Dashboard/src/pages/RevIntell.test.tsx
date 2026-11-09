import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import api, { ApiError } from '@/lib/api';
import { RevStreamError, streamRevAnswer, type RevAnswerPayload, type RevStreamRequest } from '@/lib/revStream';
import RevIntell from './RevIntell';

const theme = vi.hoisted(() => ({ value: 'dark' }));
const answerView = vi.hoisted(() => vi.fn());
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
vi.mock('@/components/rev/RevAnswerView', () => ({ default: ({ payload, onOpenEvidence }: { payload: RevAnswerPayload; onOpenEvidence?: () => void }) => {
  answerView(payload);
  return <><p>{payload.text}</p><button onClick={onOpenEvidence}>Open evidence fixture</button></>;
} }));

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
function renderPage(path = '/dashboard/rev-intell', entries?: string[]) {
  return render(<MemoryRouter initialEntries={entries ?? [path]}>
    <LocationControls />
    <Routes><Route path="/dashboard/rev-intell/:conversationId?" element={<RevIntell />} /></Routes>
  </MemoryRouter>);
}
/** REV-RESUME-001: the bare route resumes the newest conversation, so tests
 *  that exercise the blank-slate flow (first send creates a thread) pin an
 *  empty history — the honest precondition for "no thread to resume". */
function noHistoryToResume() {
  replies.set('/rev/conversations', Promise.resolve(reply([])));
}
const title = (id: string) => new RegExp(`^Conversation ${id}\\b`);
// History lives only inside the modal drawer the menu button opens, so the
// helpers below drive that drawer exactly as a merchant would. historyReady
// leaves it open: the tests that assert on the list need it accessible, and
// the ones that go on to the thread call closeHistory() first, because a modal
// drawer correctly hides the workspace behind it from the accessibility tree.
// hidden:true because a drawer underneath a rename/delete dialog is mounted
// but aria-hidden, and must not be "opened" a second time.
const historyDialog = () => screen.queryByRole('dialog', { name: 'Conversation history', hidden: true });
function openHistory() {
  if (historyDialog()) return;
  const trigger = screen.getByRole('button', { name: 'Open conversation history' });
  act(() => trigger.focus());
  fireEvent.click(trigger);
}
async function closeHistory() {
  const drawer = historyDialog();
  if (!drawer) return;
  fireEvent.keyDown(drawer, { key: 'Escape' });
  await waitFor(() => expect(historyDialog()).not.toBeInTheDocument());
}
async function historyReady() {
  openHistory();
  await screen.findByRole('button', { name: title('A') });
  // Leave the page in the state a merchant continues from: the drawer closed.
  // Tests that assert on the list itself call openHistory() explicitly.
  await closeHistory();
}
async function select(id: string) {
  openHistory();
  fireEvent.click(screen.getByRole('button', { name: title(id) }));
  await waitFor(() => expect(historyDialog()).not.toBeInTheDocument());
}
async function clickNewConversation() {
  openHistory();
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  await waitFor(() => expect(historyDialog()).not.toBeInTheDocument());
}
async function searched(query: string) {
  openHistory();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations', hidden: true }), { target: { value: query } });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(`/rev/conversations?q=${query}`));
}
function send(text = 'Investigate revenue') {
  fireEvent.change(screen.getByPlaceholderText(/Ask (me|Rev)/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

beforeEach(() => {
  replies = new Map(); streams = [];
  answerView.mockClear();
  theme.value = 'dark';
  vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); vi.mocked(streamRevAnswer).mockReset();
  vi.mocked(api.delete).mockReset(); vi.mocked(api.patch).mockReset();
  vi.mocked(api.get).mockImplementation(path => {
    const pending = replies.get(path);
    if (pending) return pending;
    if (path.startsWith('/rev/conversations')) return Promise.resolve(reply(history));
    if (path.startsWith('/rev/conversation/')) return Promise.resolve(reply(thread(path.split('/').pop()!)));
    // The page also grounds its welcome suggestions in the merchant's real store
    // connection. Stubbing it keeps an unrelated request from satisfying
    // `waitFor(() => expect(api.get).toHaveBeenCalled())` before the debounced
    // history load has even been issued.
    if (path === '/stores') return Promise.resolve(reply({ stores: [] }));
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

describe('structured conversation rehydration', () => {
  it.each(['current object', 'current JSON', 'legacy object', 'legacy JSON'])('retains sections, evidence and comparison facts from %s', async format => {
    const sections = { situation: 'Stored situation', insight: 'Stored insight', implication: 'Stored implication', recommendation: 'Stored recommendation' };
    const content = {
      response_type: 'analysis', text: '', read_only: true,
      ...(format.startsWith('legacy') ? sections : { response: sections }),
      evidence: { items: [], comparison_items: [], validation: { valid: false, errors: ['missing_provenance'] } },
      facts: [{ text: 'Recorded fact', evidence_ids: [] }],
      comparison_facts: [{ text: 'Recorded comparison', evidence_ids: ['ev-prior'] }],
    };
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [
      { id: 'stored-user', role: 'user', content: { text: 'Stored question' }, created_at: '2026-11-02T12:00:00Z' },
      { id: 'stored-answer', role: 'rev', content: format.endsWith('JSON') ? JSON.stringify(content) : content, created_at: '2026-11-02T12:00:00Z' },
    ] })));
    renderPage('/dashboard/rev-intell/A');
    await waitFor(() => expect(answerView).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining(sections), comparison_facts: content.comparison_facts })));
    expect(screen.getAllByText('Stored question')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open evidence fixture' }));
    await screen.findByRole('heading', { name: 'Comparison facts' });
    expect(screen.getByText('Recorded comparison')).toBeInTheDocument();
    expect(screen.getByText('ev-prior')).toBeInTheDocument();
    expect(screen.getByText(/record unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Evidence unavailable.')).toBeInTheDocument();
  });
  it('normalises a legacy structured attachment response before rendering it', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 200, data: {
      success: true, conversation_id: 'ImageCreated', response_type: 'analysis', text: null,
      response: { situation: 'Attachment situation', insight: 'Attachment insight', implication: 'Attachment implication', recommendation: 'Attachment recommendation' },
    } });
    const view = renderPage();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['fixture'], 'fixture.png', { type: 'image/png' })] } });
    await screen.findByAltText('attachment'); send('Read this attachment');
    await waitFor(() => expect(answerView).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ situation: 'Attachment situation', insight: 'Attachment insight', implication: 'Attachment implication', recommendation: 'Attachment recommendation' }) })));
    expect(screen.getAllByText('Read this attachment')).toHaveLength(1);
    expect(streamRevAnswer).not.toHaveBeenCalled();
  });
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
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
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
    await clickNewConversation(); send('Unrelated question');
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
    // Before acceptance the retained draft and pending turn both contain the
    // question; acceptance removes the draft rather than duplicating the turn.
    expect(screen.getAllByText('Rejected question')).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    expect(streams).toHaveLength(0);
    expect(screen.getByLabelText('Question recovery')).toHaveTextContent('Attachments are not restored from history');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with text only' }));
    expect(streams).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(streams[0].request).toMatchObject({ findingId: findingOne, conversationId: 'A', message: 'Message from A' });
    expect(streams[0].request.reuseUserMessage).not.toBe(true);
    expect(screen.getAllByText('Message from A')).toHaveLength(3);
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
    expect(screen.getAllByText('Recoverable question')).toHaveLength(3);
    expect(screen.getByText('A supporting service did not respond. Verified information already shown remains available.')).toBeInTheDocument();
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
       ? 'A supporting service did not respond. Verified information already shown remains available.' : 'Rev is taking a moment. Please try again shortly.');
    fireEvent.click(screen.getByRole('button', { name: outcome === 'rejected' ? 'Try again' : 'Ask again' }));
    expect(screen.getByLabelText('Question recovery')).toHaveTextContent('Reattach the original image');
    if (outcome === 'successful' || outcome === 'acknowledged failure') {
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    } else {
      // Rejected/uncertain submissions preserve the original attachment for a
      // safe retry; an already accepted turn requires an explicit reattach.
      expect(screen.getByAltText('attachment')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    }
    if (outcome === 'successful' || outcome === 'acknowledged failure') {
      fireEvent.keyDown(screen.getByPlaceholderText(/Ask (me|Rev)/), { key: 'Enter' });
      expect(api.post).toHaveBeenCalledTimes(1);
    }
    expect(streamRevAnswer).not.toHaveBeenCalled();
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
  it('restores authoritative selected-finding context from persisted history and retains it on the next turn', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [{
      id: 'rev-selected', role: 'rev', created_at: '2026-11-02T12:00:00Z',
      content: { ...answer('A', 'Finding answer'), selected_finding: {
        contract_version: 'rev-selected-finding-v1', finding_id: findingOne,
        title: 'Persisted refund finding', lifecycle_state: 'stale_unreverified',
        current_validity: 'stale_unreverified', evidence_quality: 'stale',
      } },
    }] })));
    renderPage('/dashboard/rev-intell/A');
    await screen.findByRole('heading', { name: 'Persisted refund finding' });
    expect(screen.getByText(/Stale or historical finding/)).toBeInTheDocument();
    send('What should I do first?');
    expect(streams[0].request).toMatchObject({ conversationId: 'A', findingId: findingOne });
  });

  it('drops selected-finding context on an explicit topic change', async () => {
    await openFinding();
    send('Instead, how is inventory?');
    expect(streams[0].request.findingId).toBeUndefined();
    await act(async () => streams[0].result.resolve({ conversationId: null, completed: true }));
    await waitFor(() => expect(screen.getByLabelText('Current search')).toBeEmptyDOMElement());
    expect(screen.queryByRole('heading', { name: 'Revenue decline' })).not.toBeInTheDocument();
  });

  it.each(['new chat', 'conversation', 'another finding'])('ignores a late finding response after navigating to %s', async destination => {
    const pending = deferred<Reply>(); replies.set(`/rev/findings/${findingOne}`, pending.promise);
    replies.set(`/rev/findings/${findingTwo}`, Promise.resolve(findingReply(findingTwo, 'Orders decline')));
    renderPage(`/dashboard/rev-intell?finding=${findingOne}`); await historyReady();
    if (destination === 'new chat') await clickNewConversation();
    else if (destination === 'conversation') { await select('B'); await screen.findByText('Message from B'); }
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
    expect(screen.getAllByText('Second finding question')).toHaveLength(2);
  });
});

describe('conversation history reliability', () => {
  it('shows a recoverable failure instead of a false empty history and visibly retries', async () => {
    replies.set('/rev/conversations', Promise.reject(new Error('offline')));
    // Attach the failure to the mocked request without an unhandled rejection during debounce.
    replies.get('/rev/conversations')!.catch(() => {});
    renderPage(); openHistory();
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation history is unavailable');
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    const next = deferred<Reply>(); replies.set('/rev/conversations', next.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation history' }));
    expect(screen.getByText('Loading conversation history…')).toBeInTheDocument();
    await act(async () => next.resolve(reply([])));
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
    // One initial history load plus the one visible retry. Scoped to the history
    // path because the page also fetches store context on mount.
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/rev/conversations')).toHaveLength(2);
  });
  it('shows verified empty only after a successful empty response', async () => {
    const pending = deferred<Reply>(); replies.set('/rev/conversations', pending.promise);
    renderPage(); openHistory();
    expect(screen.getByText('Loading conversation history…')).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet.')).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/rev/conversations'));
    await act(async () => pending.resolve(reply([])));
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
  });
  it.each([reply([], false), reply(null)])('does not treat an unsuccessful or malformed envelope as empty: %#', async response => {
    replies.set('/rev/conversations', Promise.resolve(response));
    renderPage(); openHistory();
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
  it('provides accessible failure recovery inside the history drawer', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    renderPage(); openHistory();
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation history is unavailable');
    // One history surface exists, so exactly one retry control and one empty
    // state can ever be shown. Two of each was the bug: a rail and a drawer
    // rendering the same failure independently.
    expect(screen.getAllByRole('button', { name: 'Retry conversation history' })).toHaveLength(1);
    vi.mocked(api.get).mockResolvedValue(reply([]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversation history' }));
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
    expect(screen.getAllByText('No conversations yet.')).toHaveLength(1);
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
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation', hidden: true })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Delete', hidden: true }));
    } else {
      fireEvent.click(screen.getAllByRole('button', { name: 'Rename conversation', hidden: true })[0]);
      fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name', hidden: true }), { target: { value: 'Renamed A' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save', hidden: true }));
    }
    replies.set('/rev/conversations?q=latest', oldLatestSearch.promise);
    await searched('latest');
    replies.set('/rev/conversations?q=latest', refresh.promise);
    await act(async () => pendingMutation.resolve(reply(null)));

    // Queries with hidden:true simulate external updates while merchant interaction is correctly restricted.
    // An unrelated dialog and active thread must survive history reconciliation.
    if (mutation === 'delete') fireEvent.click(screen.getAllByRole('button', { name: 'Rename conversation', hidden: true })[0]);
    else fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation', hidden: true })[1]);
    const unrelatedDialog = mutation === 'delete' ? 'dialog' : 'alertdialog';
    await act(async () => { oldSearch.resolve(reply(history)); oldLatestSearch.resolve(reply(history)); });
    expect(screen.queryByRole('button', { name: title('A'), hidden: true })).not.toBeInTheDocument();
    if (mutation === 'rename') expect(screen.getByRole('button', { name: /^Renamed A\b/, hidden: true })).toBeInTheDocument();
    expect(screen.getByText('Loading conversation history…')).toBeInTheDocument();
    expect(screen.getByRole(unrelatedDialog)).toBeInTheDocument();
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/rev/conversations?q=latest')).toHaveLength(2);

    const updated = mutation === 'delete' ? [conversation('B')] : [{ ...conversation('A'), title: 'Renamed A' }, conversation('B')];
    if (outcome === 'failure') {
      await act(async () => refresh.reject(new Error('refresh unavailable')));
      expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent('Conversation history is unavailable');
      expect(screen.queryByRole('button', { name: title('A'), hidden: true })).not.toBeInTheDocument();
      if (mutation === 'rename') expect(screen.getByRole('button', { name: /^Renamed A\b/, hidden: true })).toBeInTheDocument();
      replies.set('/rev/conversations?q=latest', Promise.resolve(reply(updated)));
      fireEvent.click(screen.getByRole('button', { name: 'Retry conversation history', hidden: true }));
    } else await act(async () => refresh.resolve(reply(updated)));
    await waitFor(() => expect(screen.queryByText('Loading conversation history…')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert', { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByRole(unrelatedDialog)).toBeInTheDocument();
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/rev/conversations?q=latest');
  });
});

describe('URL-scoped conversation retrieval', () => {
  it('prevents delayed A from replacing B after rapid switching', async () => {
    const a = deferred<Reply>(); const b = deferred<Reply>();
    replies.set('/rev/conversation/A', a.promise); replies.set('/rev/conversation/B', b.promise);
    renderPage('/dashboard/rev-intell/A'); await historyReady(); await select('B');
    await act(async () => b.resolve(reply(thread('B'))));
    await act(async () => a.resolve(reply(thread('A'))));
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(screen.queryByText('Message from A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
  });
  it.each([new Error('offline'), new ApiError(404, 'not found'), new ApiError(403, 'forbidden')])('ignores stale A errors and keeps B loading: %#', async error => {
    const a = deferred<Reply>(); const b = deferred<Reply>();
    replies.set('/rev/conversation/A', a.promise); replies.set('/rev/conversation/B', b.promise);
    renderPage('/dashboard/rev-intell/A'); await historyReady(); await select('B');
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
    await clickNewConversation();
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
    expect(await screen.findByText('Message from A')).toBeInTheDocument(); await historyReady(); await select('B');
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
    renderPage('/dashboard/rev-intell/A'); await historyReady(); await select('B'); await screen.findByText('Message from B');
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' })); await screen.findByText('Message from A');
    openHistory();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward', hidden: true })); await screen.findByText('Message from B');
    await act(async () => pending.resolve(reply(null)));
    expect(screen.getByText('Message from B')).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
  });
});

describe('turn callbacks remain in their originating thread', () => {
  it.each(['resolve', 'reject'] as const)('ignores late stream metadata, frames and %s after switching to a newer turn', async completion => {
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Message from A'); await historyReady(); send('Question for A');
    const old = streams[0]; await select('B'); await screen.findByText('Message from B'); send('Question for B');
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
    noHistoryToResume();
    renderPage(); send();
    const old = streams[0]; await clickNewConversation();
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
    noHistoryToResume();
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
  it('ignores a late Ask again response after another conversation starts streaming', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [...thread('A').messages, { id: 'rev-A', role: 'rev', content: 'Old response', created_at: '2026-11-02T12:00:00Z' }] })));
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Old response'); await historyReady();
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with text only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await select('B'); await screen.findByText('Message from B'); send();
    await act(async () => { streams[0].request.handlers.onFinal?.(answer('A', 'Outdated retry')); streams[0].result.resolve({ conversationId: 'A', completed: true }); });
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
    await select('B'); await screen.findByText('Message from B'); send('Question for B');
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
    noHistoryToResume();
    const view = renderPage(); send(); const calls = vi.mocked(api.get).mock.calls.length;
    view.unmount();
    await act(async () => streams[0].result.resolve({ conversationId: 'Late', completed: true }));
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(streams[0].request.signal?.aborted).toBe(true);
  });
});

describe('Phase 5.4 bounded pagination', () => {
  const firstHistory = () => Array.from({ length: 20 }, (_, i) => conversation(`H${i}`));
  const firstMessages = () => Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `Paged question ${i}`, created_at: '2026-11-02T12:00:00Z' }));
  it('loads only requested history pages, deduplicates overlap and prevents duplicate submissions', async () => {
    replies.set('/rev/conversations', Promise.resolve(reply(firstHistory())));
    const pending = deferred<Reply>(); replies.set('/rev/conversations?limit=20&offset=20', pending.promise);
    renderPage(); openHistory();
    const more = (await screen.findByText('Load more conversations')).closest('button')!;
    expect(api.get).not.toHaveBeenCalledWith('/rev/conversations?limit=20&offset=20');
    fireEvent.click(more); fireEvent.click(more);
    expect(more).toBeDisabled();
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.includes('offset=20'))).toHaveLength(1);
    await act(async () => pending.resolve(reply([conversation('H19'), conversation('H20')])));
    expect(screen.getAllByRole('button', { name: title('H19') })).toHaveLength(1);
    expect(screen.getByRole('button', { name: title('H20') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more conversations' })).not.toBeInTheDocument();
  });
  it('retries a failed search page with the same query and preserves already loaded results', async () => {
    replies.set('/rev/conversations?q=orders', Promise.resolve(reply(firstHistory())));
    const pending = deferred<Reply>(); replies.set('/rev/conversations?limit=20&offset=20&q=orders', pending.promise);
    renderPage(); await historyReady(); await searched('orders');
    fireEvent.click((await screen.findByText('Load more conversations')).closest('button')!);
    await act(async () => pending.reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('More conversations could not be loaded');
    expect(screen.getByText('Conversation H0').closest('button')!).toBeInTheDocument();
    replies.set('/rev/conversations?limit=20&offset=20&q=orders', Promise.resolve(reply([conversation('Extra')])));
    fireEvent.click(screen.getByRole('button', { name: 'Retry load more conversations' }));
    await screen.findByRole('button', { name: title('Extra') });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['resolve', 'reject'] as const)('ignores a history page %s after the search changes', async completion => {
    replies.set('/rev/conversations', Promise.resolve(reply(firstHistory())));
    const pending = deferred<Reply>(); replies.set('/rev/conversations?limit=20&offset=20', pending.promise);
    renderPage(); openHistory(); fireEvent.click((await screen.findByText('Load more conversations')).closest('button')!);
    replies.set('/rev/conversations?q=current', Promise.resolve(reply([conversation('Current')])));
    await searched('current'); await screen.findByRole('button', { name: title('Current') });
    await act(async () => completion === 'resolve' ? pending.resolve(reply([conversation('Outdated')])) : pending.reject(new Error('late')));
    expect(screen.queryByRole('button', { name: title('Outdated') })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['delete', 'rename'] as const)('invalidates a pending page after a successful %s', async mutation => {
    replies.set('/rev/conversations', Promise.resolve(reply(firstHistory())));
    const pending = deferred<Reply>(); replies.set('/rev/conversations?limit=20&offset=20', pending.promise);
    vi.mocked(api.delete).mockResolvedValue(reply(null)); vi.mocked(api.patch).mockResolvedValue(reply(null));
    renderPage(); openHistory(); fireEvent.click((await screen.findByText('Load more conversations')).closest('button')!);
    const updated = mutation === 'delete' ? firstHistory().slice(1) : firstHistory().map((item, i) => i ? item : { ...item, title: 'Changed title' });
    replies.set('/rev/conversations', Promise.resolve(reply(updated)));
    if (mutation === 'delete') {
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation' })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    } else {
      fireEvent.click(screen.getAllByRole('button', { name: 'Rename conversation' })[0]);
      fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), { target: { value: 'Changed title' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    }
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/rev/conversations')).toHaveLength(2));
    await act(async () => pending.resolve(reply(firstHistory())));
    // REV-RESUME-001: deleting the conversation you are viewing lands on New
    // chat, which closes the drawer by design — let it finish closing, then
    // reopen it and assert the LIVE list (an exiting drawer snapshot is not
    // the source of truth).
    if (mutation === 'delete') {
      await waitFor(() => expect(historyDialog()).not.toBeInTheDocument(), { timeout: 4000 });
      openHistory();
    }
    expect(screen.queryByText('Conversation H0')).not.toBeInTheDocument();
    if (mutation === 'rename') expect(screen.getByText('Changed title')).toBeInTheDocument();
  });
  it('loads subsequent chronological messages once, retries failures and blocks writing into a partial thread', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: firstMessages() })));
    const pending = deferred<Reply>(); replies.set('/rev/conversation/A?limit=50&offset=50', pending.promise);
    renderPage('/dashboard/rev-intell/A');
    const more = await screen.findByRole('button', { name: 'Load more messages' });
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toBeDisabled();
    send('Do not send into partial history'); expect(streamRevAnswer).not.toHaveBeenCalled();
    fireEvent.click(more); fireEvent.click(more);
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.includes('offset=50'))).toHaveLength(1);
    await act(async () => pending.reject(new Error('offline')));
    expect(screen.getByText('Paged question 0')).toBeInTheDocument();
    replies.set('/rev/conversation/A?limit=50&offset=50', Promise.resolve(reply({ messages: [firstMessages()[49], { ...firstMessages()[0], id: 'm50', content: 'Paged question 50' }] })));
    fireEvent.click(screen.getByRole('button', { name: 'Retry load more messages' }));
    await screen.findByText('Paged question 50');
    expect(screen.getAllByText('Paged question 49')).toHaveLength(1);
    expect(screen.getByText('Paged question 0').compareDocumentPosition(screen.getByText('Paged question 50')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    send('New question after all messages'); expect(streams[0].request.conversationId).toBe('A');
  });
  it.each(['New Chat', 'B'])('ignores pending message pages after navigation to %s', async destination => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: firstMessages() })));
    const pending = deferred<Reply>(); replies.set('/rev/conversation/A?limit=50&offset=50', pending.promise);
    renderPage('/dashboard/rev-intell/A'); fireEvent.click(await screen.findByRole('button', { name: 'Load more messages' }));
    await historyReady();
    if (destination === 'B') { await select('B'); await screen.findByText('Message from B'); }
    else await clickNewConversation();
    await act(async () => pending.resolve(reply({ messages: [{ ...firstMessages()[0], id: 'late', content: 'Outdated page message' }] })));
    expect(screen.queryByText('Outdated page message')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more messages' })).not.toBeInTheDocument();
    send('Current thread question'); expect(streams[0].request.conversationId).toBe(destination === 'B' ? 'B' : null);
  });
});

describe('Phase 5.4 interaction and honest capabilities', () => {
  it('focuses and traps the rename dialog, restricts the background and restores focus on Escape', async () => {
    renderPage(); await historyReady(); openHistory();
    const trigger = screen.getAllByRole('button', { name: 'Rename conversation' })[0]; trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Rename conversation' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Conversation name' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'New conversation' })).not.toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save' }); save.focus(); fireEvent.keyDown(save, { key: 'Tab' });
    expect(screen.getByRole('textbox', { name: 'Conversation name' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    // The rename dialog closes; the history drawer stays open underneath it,
    // which is where focus returns to the row that launched the rename.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename conversation' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(api.patch).not.toHaveBeenCalled();
  });
  it('provides the delete dialog with keyboard cancellation and a safe initial focus', async () => {
    renderPage(); await historyReady(); openHistory();
    const trigger = screen.getAllByRole('button', { name: 'Delete conversation' })[0]; trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete conversation?' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus()); expect(api.delete).not.toHaveBeenCalled();
  });
  it('focuses evidence and restores its trigger on Escape', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [{ id: 'answer', role: 'rev', content: { text: 'Evidence answer', response_type: 'analysis', evidence: { items: [] } }, created_at: '2026-11-02T12:00:00Z' }] })));
    renderPage('/dashboard/rev-intell/A'); const trigger = await screen.findByRole('button', { name: 'Open evidence fixture' });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Investigation evidence' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close evidence' })).toHaveFocus());
    expect(screen.queryByRole('textbox', { name: 'Message Rev' })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('supports mobile history search, selected state and Escape with focus restoration', async () => {
    renderPage('/dashboard/rev-intell/A'); await historyReady();
    const trigger = screen.getByRole('button', { name: 'Open conversation history' });
    openHistory();
    const drawer = screen.getByRole('dialog', { name: 'Conversation history' });
    expect(within(drawer).getByRole('button', { name: title('A') })).toHaveAttribute('aria-current', 'page');
    replies.set('/rev/conversations?q=mobile', Promise.resolve(reply([conversation('Mobile')])));
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'mobile' } });
    await within(drawer).findByRole('button', { name: title('Mobile') });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it.each(['application/pdf', 'video/mp4', 'image/svg+xml'])('rejects unsupported %s files without sending placeholder messages', async type => {
    const view = renderPage();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['fixture'], 'unsupported', { type })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('not supported');
    expect(api.post).not.toHaveBeenCalled(); expect(streamRevAnswer).not.toHaveBeenCalled();
  });
  it('rejects oversized images and exposes voice and calls as unavailable', () => {
    const view = renderPage(); const file = new File(['fixture'], 'large.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(screen.getByRole('alert')).toHaveTextContent('under 5 MB');
    expect(screen.getByRole('button', { name: 'Voice messages unavailable in this release' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Audio calls unavailable in this release' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled(); expect(streamRevAnswer).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)('announces clipboard %s only after the browser result', async completion => {
    const pending = deferred<void>(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => pending.promise) } });
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [{ id: 'r', role: 'rev', content: 'Copy this answer', created_at: '2026-11-02T12:00:00Z' }] })));
    renderPage('/dashboard/rev-intell/A'); fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    await act(async () => completion === 'resolve' ? pending.resolve() : pending.reject(new Error('denied')));
    if (completion === 'resolve') expect(screen.getByText('Copied')).toHaveAttribute('role', 'status');
    else { expect(screen.getByRole('alert')).toHaveTextContent('could not be copied'); expect(screen.queryByText('Copied')).not.toBeInTheDocument(); }
  });
  it('keeps a persisted non-finding answer when Ask again sends a distinct turn', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [...thread('A').messages, { id: 'r', role: 'rev', content: 'Original persisted answer', created_at: '2026-11-02T12:00:00Z' }] })));
    renderPage('/dashboard/rev-intell/A'); fireEvent.click(await screen.findByRole('button', { name: 'Ask again' }));
    expect(streamRevAnswer).not.toHaveBeenCalled();
    expect(screen.getByText('Original persisted answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with text only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(streams[0].request).toMatchObject({ message: 'Message from A', conversationId: 'A' });
    expect(streams[0].request.findingId).toBeUndefined(); expect(streams[0].request.reuseUserMessage).not.toBe(true);
    await act(async () => { streams[0].request.handlers.onFinal?.(answer('A', 'Distinct answer')); streams[0].result.resolve({ conversationId: 'A', completed: true }); });
    expect(screen.getByText('Original persisted answer')).toBeInTheDocument(); expect(screen.getByText('Distinct answer')).toBeInTheDocument();
    expect(screen.getAllByText('Message from A')).toHaveLength(2); expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Phase 5.4 follow-up mobile modal stack', () => {
  it.each(['Rename', 'Delete'] as const)('opens %s from mobile history with one interactive modal and restores focus through both layers', async action => {
    renderPage('/dashboard/rev-intell/A'); await historyReady();
    const historyTrigger = screen.getByRole('button', { name: 'Open conversation history' });
    openHistory();
    const drawer = screen.getByRole('dialog', { name: 'Conversation history' });
    const actions = within(drawer).getAllByRole('button', { name: action === 'Rename' ? 'Rename conversation' : 'Delete conversation' })[0];
    act(() => actions.focus()); fireEvent.click(actions);
    const role = action === 'Rename' ? 'dialog' : 'alertdialog';
    const dialog = await screen.findByRole(role, { name: action === 'Rename' ? 'Rename conversation' : 'Delete conversation?' });
    const first = action === 'Rename' ? within(dialog).getByRole('textbox', { name: 'Conversation name' }) : within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(first).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Conversation history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const last = within(dialog).getByRole('button', { name: action === 'Rename' ? 'Save' : 'Delete' });
    act(() => last.focus()); fireEvent.keyDown(last, { key: 'Tab' }); expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole(role, { name: action === 'Rename' ? 'Rename conversation' : 'Delete conversation?' })).not.toBeInTheDocument());
    await screen.findByRole('dialog', { name: 'Conversation history' });
    await waitFor(() => expect(actions).toHaveFocus());
    fireEvent.keyDown(actions, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(historyTrigger).toHaveFocus());
    expect(api.patch).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
  });
});

describe('Phase 5.4 follow-up long history', () => {
  const page = (offset: number) => Array.from({ length: 50 }, (_, i) => ({ id: `long-${offset + i}`, role: 'user', content: `Long history message ${offset + i}`, created_at: '2026-11-02T12:00:00Z' }));
  it('retrieves all three 50-message pages in order, retries safely and enables sending only at the verified end', async () => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: page(0) })));
    const second = deferred<Reply>(); replies.set('/rev/conversation/A?limit=50&offset=50', second.promise);
    replies.set('/rev/conversation/A?limit=50&offset=100', Promise.resolve(reply({ messages: page(100) })));
    replies.set('/rev/conversation/A?limit=50&offset=150', Promise.resolve(reply({ messages: [] })));
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Long history message 49');
    expect(screen.getByText(/Load the remaining messages before continuing/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toBeDisabled();
    fireEvent.click(screen.getByText('Load more messages').closest('button')!);
    await act(async () => second.reject(new Error('temporary failure')));
    expect(screen.getByRole('alert')).toHaveTextContent('More messages could not be loaded');
    expect(screen.getAllByText(/^Long history message \d+$/)).toHaveLength(50);
    replies.set('/rev/conversation/A?limit=50&offset=50', Promise.resolve(reply({ messages: page(50) })));
    fireEvent.click(screen.getByLabelText('Retry load more messages'));
    await screen.findByText('Long history message 99');
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toBeDisabled();
    fireEvent.click(screen.getByText('Load more messages').closest('button')!);
    await screen.findByText('Long history message 149');
    expect(screen.getAllByText(/^Long history message \d+$/).map(node => node.textContent)).toEqual(Array.from({ length: 150 }, (_, i) => `Long history message ${i}`));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByText('Load more messages').closest('button')!);
    await waitFor(() => expect(screen.queryByText('Load more messages')).not.toBeInTheDocument());
    expect(screen.queryByText(/Load the remaining messages before continuing/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message Rev' })).toBeEnabled();
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.startsWith('/rev/conversation/A')).map(([path]) => path)).toEqual([
      '/rev/conversation/A', '/rev/conversation/A?limit=50&offset=50', '/rev/conversation/A?limit=50&offset=50', '/rev/conversation/A?limit=50&offset=100', '/rev/conversation/A?limit=50&offset=150',
    ]);
    send('Continue after complete history'); expect(streams[0].request.conversationId).toBe('A');
  });
  it.each(['resolve', 'reject'] as const)('ignores a late third-page %s after navigation', async completion => {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: page(0) })));
    replies.set('/rev/conversation/A?limit=50&offset=50', Promise.resolve(reply({ messages: page(50) })));
    const third = deferred<Reply>(); replies.set('/rev/conversation/A?limit=50&offset=100', third.promise);
    renderPage('/dashboard/rev-intell/A'); await screen.findByText('Long history message 49');
    fireEvent.click(screen.getByText('Load more messages').closest('button')!); await screen.findByText('Long history message 99');
    fireEvent.click(screen.getByText('Load more messages').closest('button')!);
    await historyReady(); await select('B'); await screen.findByText('Message from B'); send('Current question');
    await act(async () => completion === 'resolve' ? third.resolve(reply({ messages: page(100) })) : third.reject(new Error('late failure')));
    expect(screen.queryByText(/^Long history message/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Load more messages')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/B');
  });
});

describe('Phase 5.4 follow-up answer copying', () => {
  async function openAnswer(content: unknown) {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [{ id: 'copy-answer', role: 'rev', content, created_at: '2026-11-02T12:00:00Z' }] })));
    renderPage('/dashboard/rev-intell/A');
    const button = await screen.findByRole('button', { name: 'Copy' });
    return { writeText, button };
  }
  it('copies a plain text response unchanged', async () => {
    const { writeText, button } = await openAnswer('A plain explanation.'); await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledWith('A plain explanation.');
  });
  it.each(['current object', 'current JSON', 'legacy object', 'legacy JSON'])('copies all narrative sections from a %s response without internal fields', async format => {
    const sections = { situation: 'Recorded situation.', insight: 'Supported insight.', implication: 'Possible implication.', recommendation: 'Suggested review.' };
    const content = { response_type: 'analysis', text: 'An introductory explanation.', ...(format.startsWith('current') ? { response: sections } : sections), evidence: { internal_marker: 'PRIVATE_EVIDENCE' }, conversation_id: 'INTERNAL_CONVERSATION', meta: { private: 'INTERNAL_META' } };
    const { writeText, button } = await openAnswer(format.endsWith('JSON') ? JSON.stringify(content) : content);
    await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledWith('An introductory explanation.\n\nSituation\nRecorded situation.\n\nInsight\nSupported insight.\n\nImplication\nPossible implication.\n\nRecommendation\nSuggested review.');
    expect(writeText.mock.calls[0][0]).not.toMatch(/PRIVATE_EVIDENCE|INTERNAL_|response_type/);
  });
  it('omits missing and malformed optional fields without inventing sections', async () => {
    const { writeText, button } = await openAnswer({ response_type: 'analysis', response: { insight: 'Only a supplied insight.', situation: null, implication: 42 } });
    await act(async () => { fireEvent.click(button); }); expect(writeText).toHaveBeenCalledWith('Insight\nOnly a supplied insight.');
  });
  it('preserves complete text without duplicating sections already covered by it', async () => {
    const text = '## Situation\nRecorded result.\n\n## Insight\nRecorded explanation.';
    const { writeText, button } = await openAnswer({ text, response: { situation: 'Recorded result.', insight: 'Recorded explanation.' } });
    await act(async () => { fireEvent.click(button); }); expect(writeText).toHaveBeenCalledWith(text);
  });
  it('keeps visible facts, hypotheses, limits, warnings and recommendations while excluding raw evidence', async () => {
    const { writeText, button } = await openAnswer({ text: 'Answer body.', facts: [{ text: 'Recorded fact.', evidence_ids: ['PRIVATE_ID'] }], comparison_facts: [{ text: 'Comparison fact.' }], hypotheses: [{ statement: 'A possible explanation.', internal: 'PRIVATE_HYPOTHESIS' }], unknowns: ['Missing records.'], warnings: ['Limited coverage.'], recommendations: [{ label: 'Review the segment.', why: 'It changed.', measure: 'Compare recorded orders.', tool: 'PRIVATE_TOOL' }], evidence: { private: 'RAW_JSON' } });
    await act(async () => { fireEvent.click(button); }); const copied = writeText.mock.calls[0][0];
    for (const text of ['Answer body.', 'Facts', 'Recorded fact.', 'Comparison fact.', 'Hypotheses — not verified', 'A possible explanation.', 'Unknowns and limits', 'Missing records.', 'Limited coverage.', 'Review the segment.', 'It changed.', 'Compare recorded orders.', 'nothing was changed or sent']) expect(copied).toContain(text);
    expect(copied).not.toMatch(/PRIVATE_|RAW_JSON|evidence_ids/);
  });
});

describe('Phase 5.4 follow-up clipboard attempt ownership', () => {
  async function openCopy() {
    replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [{ id: 'copy-answer', role: 'rev', content: 'Copyable answer.', created_at: '2026-11-02T12:00:00Z' }] })));
    const writeText = vi.fn<() => Promise<void>>();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const view = renderPage('/dashboard/rev-intell/A');
    const button = await screen.findByRole('button', { name: 'Copy' });
    return { writeText, button, view };
  }
  it.each(['resolve', 'reject'] as const)('ignores an older %s after the latest copy has completed', async oldCompletion => {
    const { writeText, button } = await openCopy();
    const old = deferred<void>(), latest = deferred<void>(); writeText.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    fireEvent.click(button); fireEvent.click(button);
    await act(async () => oldCompletion === 'resolve' ? latest.reject(new Error('current denied')) : latest.resolve());
    await act(async () => oldCompletion === 'resolve' ? old.resolve() : old.reject(new Error('old denied')));
    if (oldCompletion === 'resolve') {
      expect(screen.getByRole('alert')).toHaveTextContent('could not be copied'); expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    } else {
      expect(screen.getByText('Copied')).toHaveAttribute('role', 'status'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  });
  it.each(['success', 'failure'])('clears previous %s feedback immediately when another copy starts', async previous => {
    const { writeText, button } = await openCopy(); const first = deferred<void>(), second = deferred<void>();
    writeText.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    fireEvent.click(button); await act(async () => previous === 'success' ? first.resolve() : first.reject(new Error('denied')));
    expect(previous === 'success' ? screen.getByText('Copied') : screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByText('Copied')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => second.resolve()); expect(screen.getByText('Copied')).toBeInTheDocument();
  });
  it.each(['resolve', 'reject'] as const)('ignores a clipboard %s after unmount without scheduling feedback', async completion => {
    const { writeText, button, view } = await openCopy(); const pending = deferred<void>(); writeText.mockReturnValue(pending.promise);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    fireEvent.click(button); view.unmount();
    const scheduled = timer.mock.calls.filter(([, delay]) => delay === 2000).length;
    await act(async () => completion === 'resolve' ? pending.resolve() : pending.reject(new Error('late denial')));
    expect(timer.mock.calls.filter(([, delay]) => delay === 2000)).toHaveLength(scheduled);
    expect(screen.queryByText('Copied')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['resolve', 'reject'] as const)('ignores a clipboard %s after switching conversations', async completion => {
    const { writeText, button } = await openCopy(); const pending = deferred<void>(); writeText.mockReturnValue(pending.promise);
    fireEvent.click(button); await historyReady(); await select('B'); await screen.findByText('Message from B');
    await act(async () => completion === 'resolve' ? pending.resolve() : pending.reject(new Error('late denial')));
    expect(screen.queryByText('Copied')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('prevents an earlier success timer from clearing current feedback', async () => {
    const { writeText, button } = await openCopy(); writeText.mockResolvedValue();
    const timer = vi.spyOn(globalThis, 'setTimeout');
    fireEvent.click(button); await screen.findByText('Copied');
    const oldTimer = timer.mock.calls.find(([, delay]) => delay === 2000)![0];
    fireEvent.click(button); await screen.findByText('Copied');
    act(() => { if (typeof oldTimer === 'function') oldTimer(); });
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});

describe('stream scroll discipline (ChatGPT-UI study §6)', () => {
  it('reveals a back-to-latest pill after scrolling away and rejoins the stream on click', async () => {
    renderPage('/dashboard/rev-intell/A');
    await screen.findByText('Message from A');
    const box = screen.getByTestId('rev-scroll-box');
    let scrollTop = 0;
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => scrollTop });
    const spy = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;

    // Pinned at the bottom of a short thread: no pill in the a11y tree.
    expect(screen.queryByRole('button', { name: 'Back to latest message' })).toBeNull();

    // Scroll far away (distance 800px > 160px threshold): the pill appears.
    fireEvent.scroll(box);
    const pill = screen.getByRole('button', { name: 'Back to latest message' });

    // One click rejoins the live stream and hides the pill again.
    const before = spy.mock.calls.length;
    fireEvent.click(pill);
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByRole('button', { name: 'Back to latest message' })).toBeNull();

    // Back at the bottom (distance 0): still hidden, auto-follow re-armed.
    scrollTop = 800;
    fireEvent.scroll(box);
    expect(screen.queryByRole('button', { name: 'Back to latest message' })).toBeNull();

    // Hysteresis: a small overscroll (distance 100px, between 80 and 160)
    // must not flicker the pill back on.
    scrollTop = 700;
    fireEvent.scroll(box);
    expect(screen.queryByRole('button', { name: 'Back to latest message' })).toBeNull();
  });
});

describe('answer feedback and read-aloud (ChatGPT-UI study §5)', () => {
  const ratedThread = (feedbackRating?: string) => reply({ messages: [
    { id: 'stored-user', role: 'user', content: { text: 'Stored question' }, created_at: '2026-11-02T12:00:00Z' },
    { id: 'stored-rev', role: 'rev', content: answer('A', 'Stored answer'), created_at: '2026-11-02T12:00:05Z',
      ...(feedbackRating ? { feedback_rating: feedbackRating } : {}) },
  ] });

  async function openThread(feedbackRating?: string) {
    replies.set('/rev/conversation/A', Promise.resolve(ratedThread(feedbackRating)));
    renderPage('/dashboard/rev-intell/A');
    await screen.findByText('Stored answer');
  }

  it('posts an up rating under the persisted message id', async () => {
    vi.mocked(api.post).mockResolvedValue(reply(null));
    await openThread();
    const thumb = screen.getByRole('button', { name: 'Helpful' });
    expect(thumb).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(thumb);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rev/message-feedback', { message_id: 'stored-rev', rating: 'up' }));
    await waitFor(() => expect(thumb).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('rehydrates the stored rating and clears it when the active thumb is clicked again', async () => {
    vi.mocked(api.post).mockResolvedValue(reply(null));
    await openThread('up');
    const thumb = screen.getByRole('button', { name: 'Helpful' });
    expect(thumb).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(thumb);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rev/message-feedback', { message_id: 'stored-rev', rating: null }));
    await waitFor(() => expect(thumb).toHaveAttribute('aria-pressed', 'false'));
  });

  it('switches sides when the other thumb is clicked', async () => {
    vi.mocked(api.post).mockResolvedValue(reply(null));
    await openThread('up');
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rev/message-feedback', { message_id: 'stored-rev', rating: 'down' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('reverts the optimistic state honestly when the backend write fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('RATE_LIMITED'));
    await openThread();
    const thumb = screen.getByRole('button', { name: 'Helpful' });
    fireEvent.click(thumb);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rev/message-feedback', { message_id: 'stored-rev', rating: 'up' }));
    await waitFor(() => expect(thumb).toHaveAttribute('aria-pressed', 'false'));
  });

  it('shows no thumbs on merchant turns', async () => {
    await openThread();
    expect(screen.getAllByRole('button', { name: 'Helpful' })).toHaveLength(1);
  });

  it('offers no Read aloud button where the platform cannot speak', async () => {
    await openThread();
    expect(screen.queryByRole('button', { name: /Read aloud|Stop reading aloud/ })).toBeNull();
  });

  it('reads the answer aloud and stops on a second click where speech is supported', async () => {
    class Utterance {
      text: string; onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    const speak = vi.fn();
    const cancel = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak, cancel } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    try {
      await openThread();
      fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
      expect(speak.mock.calls[0][0]).toBeInstanceOf(Utterance);
      expect((speak.mock.calls[0][0] as Utterance).text).toContain('Stored answer');
      fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud' }));
      await waitFor(() => expect(cancel).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Read aloud' })).toBeTruthy();
    } finally {
      delete (window as unknown as Record<string, unknown>).speechSynthesis;
      delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
    }
  });
});

describe('landing continuity (REV-RESUME-001)', () => {
  it('resumes the most recent conversation on the bare route', async () => {
    renderPage();
    await screen.findByText('Message from A');
    await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/A'));
  });

  it('keeps the browser Back button pointing at where the merchant came from', async () => {
    renderPage('/dashboard/rev-intell', ['/', '/dashboard/rev-intell']);
    await screen.findByText('Message from A');
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/$/));
  });

  it('honours an explicit New conversation choice until the next send', async () => {
    renderPage();
    await screen.findByText('Message from A');
    await clickNewConversation();
    expect(screen.queryByText('Message from A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/);
    send('Fresh question');
    await act(async () => {
      streams[0].request.handlers.onMeta?.({ conversation_id: 'New1' });
      streams[0].request.handlers.onFinal?.(answer('New1', 'Fresh answer'));
      streams[0].result.resolve({ conversationId: 'New1', completed: true });
    });
    await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent('/dashboard/rev-intell/New1'));
    expect(screen.queryByText('Message from A')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh answer')).toBeInTheDocument();
  });

  it('shows the welcome experience when there is no history to resume', async () => {
    noHistoryToResume();
    renderPage();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/rev/conversations'));
    await screen.findByText('How can I help your revenue today?');
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/);
  });

  it('never resumes from a failed history load', async () => {
    // Pre-handled so the debounced consumer's 250ms gap does not surface as
    // an unhandled rejection; loadConversations still sees the failure.
    const rejected = Promise.reject(new Error('history down'));
    rejected.catch(() => {});
    replies.set('/rev/conversations', rejected);
    renderPage();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/rev/conversations'));
    await screen.findByText('How can I help your revenue today?');
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/);
  });
});

// Task 222 (original 295–299) — question-input lifecycle, submission control,
// no-store conversation, and title fallback. These extend the existing suite
// (which already covers history/switching/stale-response/pagination) with the
// scenarios the audit found under-covered or newly fixed (oversized input).
describe('Task 222 — question input lifecycle and submission control', () => {
  it('declares the authoritative maxLength on the question field', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/Ask (me|Rev)/)).toHaveAttribute('maxlength', '2000');
  });

  it('lets a question reach the 2000-char bound and submit it unchanged (no silent truncation)', async () => {
    noHistoryToResume();
    renderPage();
    const atBound = 'x'.repeat(2000);
    fireEvent.change(screen.getByPlaceholderText(/Ask (me|Rev)/), { target: { value: atBound } });
    // Exactly at the bound the question is still valid: a live count, no "shorten" warning.
    expect(screen.getByText(/^2000 \/ 2000$/)).toBeInTheDocument();
    expect(screen.queryByText(/shorten to send/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
    expect(streamRevAnswer).toHaveBeenCalledWith(expect.objectContaining({ message: atBound }));
  });

  it('refuses to submit an over-length question and preserves the input (nothing fabricated)', async () => {
    noHistoryToResume();
    renderPage();
    const over = 'x'.repeat(2500);
    const field = screen.getByPlaceholderText(/Ask (me|Rev)/);
    fireEvent.change(field, { target: { value: over } });
    expect(screen.getByText(/2500 \/ 2000 — shorten to send/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await act(async () => {});
    // The guard rejects it: no request is issued and no placeholder/message is added.
    expect(streamRevAnswer).not.toHaveBeenCalled();
    // The over-length input is preserved (not cleared), still flagged over the bound.
    expect(screen.getByText(/shorten to send/)).toBeInTheDocument();
  });

  it('exposes a 44px accessible send control and submits on Enter', async () => {
    noHistoryToResume();
    renderPage();
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    // Touch-target contract: the send control meets the 44px floor (was 32px) the
    // codebase applies to its other conversation controls.
    expect(sendButton.className).toMatch(/h-11 w-11/);
    expect(sendButton).toBeDisabled();
    const field = screen.getByPlaceholderText(/Ask (me|Rev)/);
    fireEvent.change(field, { target: { value: 'Check my refund trend' } });
    expect(sendButton).toBeEnabled();
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
  });

  it('lets a merchant with no connected store start a conversation without fabricating store context', async () => {
    noHistoryToResume();
    replies.set('/stores', Promise.resolve(reply({ stores: [] })));
    renderPage();
    send('Why did revenue dip last week?');
    await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
    const request = streams[0].request;
    expect(request.message).toBe('Why did revenue dip last week?');
    expect(request.findingId).toBeUndefined();
    expect(request.conversationId).toBeFalsy();
  });

  it('shows an "Untitled conversation" fallback for a conversation with no persisted title', async () => {
    replies.set('/rev/conversations', Promise.resolve(reply([{ id: 'A', title: null, message_count: 1, last_activity_at: '2026-11-02T12:00:00Z' }])));
    renderPage();
    openHistory();
    expect(await screen.findByRole('button', { name: /Untitled conversation/ })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 224 — Rev Intelligence conversation experience (original Tasks 305–311).
// Integration layer on top of the revError classifier (see revError.test.ts):
// verifies the page surfaces truthful, distinct, non-leaking messages; offers
// retry only where recoverable; carries Command Center finding context with an
// honest independent-conversation escape; and announces state changes in a
// single polite/assertive live region.
// ─────────────────────────────────────────────────────────────────────────────

describe('Task 224 — Rev Intelligence conversation experience (305–311)', () => {
  // Fresh, empty workspace so a send always starts a new turn with no history to
  // resume (REV-RESUME-001) and no conversation load competing with the turn.
  function freshSend(text = 'Why did revenue dip last week?') {
    noHistoryToResume();
    renderPage();
    send(text);
  }
  const rejectTurn = async (error: unknown) => {
    await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
    await act(async () => { streams[0].result.reject(error as Error); });
  };
  const structuredReject = async (code: string) => {
    await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
    await act(async () => {
      streams[0].request.handlers.onFinal?.({ success: false, error: { code } } as unknown as RevAnswerPayload);
      streams[0].result.resolve({ conversationId: null, completed: true });
    });
  };
  // Local finding-handoff helper (the earlier describe's openFinding is scoped out).
  async function openFinding() {
    replies.set(`/rev/findings/${findingOne}`, Promise.resolve(findingReply()));
    const view = renderPage(`/dashboard/rev-intell?finding=${findingOne}`);
    await screen.findByRole('heading', { name: 'Revenue decline' });
    return view;
  }
  // Non-finding failures persist as "unknown", so the retry control is labelled
  // "Ask again" (re-ask); only a pre-save finding rejection is "not-persisted" and
  // labelled "Try again" (recover in place). Both re-send the same question.
  const retryButton = () => screen.queryByRole('button', { name: /try again|ask again/i });
  // Count how many user-message BUBBLES in the thread contain `text`. Task 223's
  // draft-preserving submission (acceptDraft clears the input only once the server
  // persists) keeps the question in the input too after a pre-persistence failure,
  // so a plain text match would see the bubble AND the input. The user bubble's
  // gradient class is unique to the thread bubble (the input is a <textarea>), so
  // this counts thread copies only — the right signal for "preserved / not duplicated".
  const threadQuestionCount = (text: string) =>
    screen.getAllByText(text, { selector: '[class*="rounded-tr-md"]', exact: true }).length;

  // Task 226 made the shared workspace language (cleanError → explainWorkspaceError)
  // the single source of truth for a failure's wording; these are its exact strings.
  // A few codes (INTELLIGENCE_AUTH_FAILED, *_NOT_CONFIGURED, NOTHING_TO_RETRY,
  // STREAM_START_FAILED) are not individually worded by the shared classifier and
  // therefore surface the generic 500 message — the recovery decision (retryable,
  // in revError.ts) still distinguishes them, which 306 locks in.
  const T = {
      unavailable: 'A supporting service did not respond. Verified information already shown remains available.',
      invalidResponse: 'Nothing has been marked complete. Try again; contact support if this continues.',
      rateLimited: 'Wait a moment before trying again. Existing information remains available.',
      readOnly: 'Ask Rev to explain or recommend next steps. It cannot change your store.',
      unsupported: 'The connected store does not provide the information needed for this request.',
      unauthorized: 'Sign in again to continue. Revluma has not changed your store connection.',
      forbidden: 'Reconnect Shopify or ask a workspace owner to review your access.',
      notFound: 'It may have been removed or replaced. Return to the workspace and choose a current item.',
      validation: 'Revluma couldn’t accept the information provided. No new operation was started.',
      // A plain transport/network error (no code, no HTTP status) uses the long-
      // standing closed fallback the page keeps for that case (not cleanError's body).
      network: 'Rev is taking a moment. Please try again shortly.',
      failed: 'No success is assumed. Try again or review the affected connection.',
      findingUnverified: 'Revluma hasn’t verified this finding’s evidence yet, so Rev won’t treat it as fact.',
      // Rev-specific overrides Task 226 keeps in cleanError (they take precedence
      // over the shared classifier's common.body for these exact codes).
      authFailed: 'Rev Intelligence isn’t available right now. Your store connection has not been changed; try again shortly.',
      notConfigured: 'Rev Intelligence is being set up. Check back shortly.',
      nothingToRetry: 'There is no earlier answer to retry yet.',
      streamStartFailed: 'Rev couldn’t start this answer. Your question is preserved; try again.',
      streamUnsupported: 'This browser can’t receive Rev’s live answer. Use a current browser and try again.',
  };

  describe('305 — truthful, distinct, non-leaking error surfaces', () => {
    it.each([
      ['INTELLIGENCE_TIMEOUT', T.unavailable],
      ['INTELLIGENCE_UNAVAILABLE', T.unavailable],
      ['INTELLIGENCE_INVALID_RESPONSE', T.invalidResponse],
      ['INTELLIGENCE_AUTH_FAILED', T.authFailed],
      ['INTELLIGENCE_NOT_CONFIGURED', T.notConfigured],
      ['RATE_LIMITED', T.rateLimited],
      ['READ_ONLY', T.readOnly],
      ['NOTHING_TO_RETRY', T.nothingToRetry],
      ['STREAM_START_FAILED', T.streamStartFailed],
      ['STREAM_UNSUPPORTED', T.streamUnsupported],
      ['UNAUTHORIZED', T.unauthorized],
      ['VALIDATION_ERROR', T.validation],
    ] as const)('maps the structured code %s to its closed, truthful message', async (code, message) => {
      freshSend();
      await structuredReject(code);
      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it.each([
      [400, T.validation],
      [401, T.unauthorized],
      [403, T.forbidden],
      [404, T.notFound],
      [409, T.failed],
      [422, T.validation],
      [429, T.rateLimited],
      [500, T.failed],
      [502, T.unavailable],
      [503, T.unavailable],
      [504, T.unavailable],
    ] as const)('maps raw HTTP %s to a distinct closed message (no backend text)', async (status, message) => {
      freshSend();
      await rejectTurn(new ApiError(status, 'raw', { error: { message: `internal-${status}-detail` } }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByText(`internal-${status}-detail`)).not.toBeInTheDocument();
    });

    it('maps a network-level connection failure to the connection message', async () => {
      freshSend();
      await rejectTurn(new Error('socket closed'));
      expect(await screen.findByText(T.network)).toBeInTheDocument();
    });

    it('never leaks SQL, provider, stack, or credential text into the surfaced message', async () => {
      freshSend();
      await rejectTurn(new ApiError(500, 'boom', {
        error: { message: 'SQLSTATE[42S02]: relation "rev_turns" does not exist; at provider.call() token=sk_live_SECRET stack=Trace' },
      }));
      const region = await screen.findByText(T.failed);
      expect(region).toBeInTheDocument();
      for (const needle of ['SQLSTATE', 'rev_turns', 'sk_live', 'provider.call', 'Trace', 'boom']) {
        expect(screen.queryByText(new RegExp(needle))).not.toBeInTheDocument();
      }
    });

    it('preserves the merchant\'s question and any prior content when a turn fails', async () => {
      replies.set('/rev/conversations', Promise.resolve(reply([conversation('A')])));
      replies.set('/rev/conversation/A', Promise.resolve(reply({ messages: [
        { id: 'u1', role: 'user', content: 'Earlier question', created_at: '2026-11-02T12:00:00Z' },
        { id: 'r1', role: 'rev', content: 'Earlier answer', created_at: '2026-11-02T12:00:05Z' },
      ] })));
      renderPage('/dashboard/rev-intell/A');
      await screen.findByText('Earlier answer');
      send('Follow-up that will fail');
      await rejectTurn(new ApiError(503, 'Unavailable', {}));
      expect(await screen.findByText(T.unavailable)).toBeInTheDocument();
      // The failed turn keeps the question in the thread (it may also remain in the
      // input draft — Task 223's draft-preserving submission only clears the input
      // once the server persists, and this turn failed before that). Nothing prior is dropped.
      expect(threadQuestionCount('Follow-up that will fail')).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Earlier question')).toBeInTheDocument();
      expect(screen.getByText('Earlier answer')).toBeInTheDocument();
    });

    it('does not fabricate a success (no answer text) when a turn fails', async () => {
      freshSend();
      await rejectTurn(new ApiError(500, 'boom', {}));
      await screen.findByText(T.failed);
      expect(answerView).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: /answer|situation|recommendation/i })).not.toBeInTheDocument();
    });
  });

  describe('306 — recoverable retry (bounded, honest, no auto-retry)', () => {
    it('offers a manual retry for a transient 5xx failure', async () => {
      freshSend();
      await rejectTurn(new ApiError(500, 'boom', {}));
      await screen.findByText(T.failed);
      expect(retryButton()).not.toBeNull();
      expect(retryButton()).toBeEnabled();
    });

    it('offers a manual retry for a rate limit (retryable once the window passes)', async () => {
      freshSend();
      await rejectTurn(new ApiError(429, 'slow down', {}));
      await screen.findByText(T.rateLimited);
      expect(retryButton()).not.toBeNull();
    });

    it.each([[401, T.unauthorized], [403, T.forbidden], [422, T.validation]] as const)
      ('offers no futile retry for the permanent %s failure', async (status, message) => {
        freshSend();
        await rejectTurn(new ApiError(status, 'raw', {}));
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      });

    it('offers a recover-in-place retry for a finding rejection (fix and re-send)', async () => {
      await openFinding();
      send('Rejected question');
      await rejectTurn(new RevStreamError('FINDING_EVIDENCE_UNVERIFIED', 'Unverified', 409));
      await waitFor(() => expect(screen.getAllByText(T.findingUnverified).length).toBeGreaterThan(0));
      expect(retryButton()).not.toBeNull();
    });

    it('respects a server Retry-After by disabling the retry with an honest countdown', async () => {
      freshSend();
      await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
      const err = new ApiError(429, 'slow down', {});
      (err as ApiError & { retryAfter: string | null }).retryAfter = '2';
      await act(async () => { streams[0].result.reject(err); });
      await screen.findByText(T.rateLimited);
      // The retry is offered but bounded: disabled, and its accessible name
      // announces the wait ("Retry in 2 seconds") while the visible text counts down.
      const button = screen.getByRole('button', { name: 'Retry in 2 seconds' });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Ask again in 2s');
    });

    it('re-sends the identical question on retry without duplicating it in the thread', async () => {
      // A pre-save (recover-in-place) rejection reuses the existing question, so
      // the re-send must not add a second copy of it.
      await openFinding();
      send('The same follow-up');
      await rejectTurn(new RevStreamError('FINDING_EVIDENCE_UNVERIFIED', 'Unverified', 409));
      // Exactly one copy in the thread. The input may still hold the draft (Task 223's
      // draft-preserving submission clears the input only once the server persists),
      // so count thread bubbles rather than every text match.
      await waitFor(() => expect(threadQuestionCount('The same follow-up')).toBe(1));
      // The rejection also flags the finding; re-fetching clears that flag so the
      // recovered question can be sent. Retry then prepares; Send confirms.
      fireEvent.click(await screen.findByRole('button', { name: 'Retry finding' }));
      await screen.findByRole('heading', { name: 'Revenue decline' });
      fireEvent.click(retryButton()!);
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(2));
      expect(streams[1].request.message).toBe('The same follow-up');
      await act(async () => {
        streams[1].request.handlers.onMeta?.({ conversation_id: 'C' });
        streams[1].request.handlers.onFinal?.(answer('C', 'Recovered answer'));
        streams[1].result.resolve({ conversationId: 'C', completed: true });
      });
      expect(screen.getAllByText('The same follow-up')).toHaveLength(1);
      expect(screen.getByText('Recovered answer')).toBeInTheDocument();
    });

    it('does not auto-retry: a failed turn stays failed until the merchant acts', async () => {
      freshSend();
      await rejectTurn(new ApiError(500, 'boom', {}));
      await screen.findByText(T.failed);
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      // No second request was issued on its own.
      expect(streamRevAnswer).toHaveBeenCalledTimes(1);
    });
  });

  describe('311 — single polite/assertive live region', () => {
    it('announces a new submission in a polite status region', () => {
      freshSend();
      const region = screen.getByTestId('rev-status-region');
      expect(region).toHaveTextContent('Sending your question.');
      expect(region).toHaveAttribute('role', 'status');
    });

    it('announces acceptance once the server acknowledges the message', async () => {
      freshSend();
      await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
      await act(async () => { streams[0].request.handlers.onMeta?.({ conversation_id: 'C1' }); });
      expect(screen.getByTestId('rev-status-region')).toHaveTextContent('Your message was received.');
    });

    it('announces completion when the answer is ready', async () => {
      freshSend();
      await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
      await act(async () => {
        streams[0].request.handlers.onMeta?.({ conversation_id: 'C1' });
        streams[0].request.handlers.onFinal?.(answer('C1', 'The answer'));
        streams[0].result.resolve({ conversationId: 'C1', completed: true });
      });
      expect(screen.getByTestId('rev-status-region')).toHaveTextContent('Your answer is ready.');
    });

    it('announces the finding handoff with the finding subject', async () => {
      await openFinding();
      expect(screen.getByTestId('rev-status-region')).toHaveTextContent('Investigating: Revenue decline.');
    });

    it('announces a retry of a recovered question distinctly from a fresh send', async () => {
      await openFinding();
      send('Rejected question');
      await rejectTurn(new RevStreamError('FINDING_EVIDENCE_UNVERIFIED', 'Unverified', 409));
      await waitFor(() => expect(screen.getAllByText(T.findingUnverified).length).toBeGreaterThan(0));
      // Retry the rejected finding, then prepare and confirm the recovered question.
      fireEvent.click(await screen.findByRole('button', { name: 'Retry finding' }));
      await screen.findByRole('heading', { name: 'Revenue decline' });
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      expect(screen.getByTestId('rev-status-region')).toHaveTextContent('Retrying your question.');
    });

    it('keeps exactly one live region (never duplicates an announcement)', () => {
      freshSend();
      expect(screen.getAllByTestId('rev-status-region')).toHaveLength(1);
    });

    it('hides the live region while the history drawer owns focus', async () => {
      noHistoryToResume();
      renderPage('/dashboard/rev-intell/A');
      replies.set('/rev/conversation/A', Promise.resolve(reply(thread('A'))));
      // Wait for the load to announce, then open the drawer.
      await screen.findByText('Message from A');
      openHistory();
      await screen.findByRole('dialog', { name: 'Conversation history' });
      expect(screen.queryByTestId('rev-status-region')).not.toBeInTheDocument();
      // Closing the drawer restores the region.
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Conversation history' }), { key: 'Escape' });
      await waitFor(() => expect(historyDialog()).not.toBeInTheDocument());
      expect(screen.getByTestId('rev-status-region')).toBeInTheDocument();
    });
  });

  describe('307 — Command Center context handoff + independent conversation', () => {
    it('carries the finding context (finding id) into the first turn', async () => {
      await openFinding();
      send('Investigate this');
      await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
      expect(streams[0].request.findingId).toBe(findingOne);
    });

    it('surfaces the finding subject and its revalidation caveat without leaking raw evidence', async () => {
      await openFinding();
      expect(screen.getByRole('heading', { name: 'Revenue decline' })).toBeInTheDocument();
      expect(screen.getByText(/Rev will revalidate it before offering current advice/)).toBeInTheDocument();
      expect(screen.queryByText('RAW_EVIDENCE_MUST_NOT_BE_SENT')).not.toBeInTheDocument();
    });

    it('pre-fills an editable investigation draft grounded in the finding', async () => {
      await openFinding();
      await waitFor(() => expect((screen.getByPlaceholderText(/Ask (me|Rev)/) as HTMLTextAreaElement).value).toMatch(/Help me investigate this finding: Revenue decline/));
    });

    it('offers an explicit independent-conversation escape in the finding banner', async () => {
      await openFinding();
      expect(screen.getByRole('button', { name: /Start a separate conversation/ })).toBeInTheDocument();
    });

    it('starting a separate conversation drops the inherited finding context and routing', async () => {
      await openFinding();
      fireEvent.click(screen.getByRole('button', { name: /Start a separate conversation/ }));
      await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/));
      expect(screen.queryByRole('heading', { name: 'Revenue decline' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Start a separate conversation/ })).not.toBeInTheDocument();
    });

    it('an independent conversation does not inherit the finding id', async () => {
      await openFinding();
      fireEvent.click(screen.getByRole('button', { name: /Start a separate conversation/ }));
      await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/dashboard\/rev-intell$/));
      send('Unrelated question');
      await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
      expect(streams[0].request.findingId).toBeUndefined();
    });
  });

  describe('310 — keyboard operation', () => {
    it('submits on Enter but not on Shift+Enter (Task 222 contract)', async () => {
      noHistoryToResume();
      renderPage();
      const field = screen.getByPlaceholderText(/Ask (me|Rev)/);
      fireEvent.change(field, { target: { value: 'Revenue question' } });
      fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
      expect(streamRevAnswer).not.toHaveBeenCalled();
      fireEvent.keyDown(field, { key: 'Enter' });
      await waitFor(() => expect(streamRevAnswer).toHaveBeenCalledTimes(1));
    });

    it('closes the conversation-history drawer on Escape and restores focus to the trigger', async () => {
      noHistoryToResume();
      renderPage('/dashboard/rev-intell/A');
      await screen.findByText('Message from A');
      openHistory();
      const drawer = await screen.findByRole('dialog', { name: 'Conversation history' });
      fireEvent.keyDown(drawer, { key: 'Escape' });
      await waitFor(() => expect(historyDialog()).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open conversation history' })).toHaveFocus());
    });

    it('keeps a failed-turn retry reachable by keyboard (focusable, not excluded)', async () => {
      freshSend();
      await rejectTurn(new ApiError(500, 'boom', {}));
      await screen.findByText(T.failed);
      const button = retryButton()!;
      expect(button).not.toHaveAttribute('tabindex', '-1');
      button.focus();
      expect(button).toHaveFocus();
    });
  });

  describe('308/309 — responsive structure', () => {
    it('clips the workspace to the viewport so it cannot scroll horizontally', () => {
      renderPage();
      const ws = document.querySelector('.rev-workspace');
      expect(ws).toBeTruthy();
      expect(ws!.className).toMatch(/overflow-hidden/);
    });

    it('keeps the message stream in its own scroll region separate from the composer', () => {
      renderPage();
      expect(screen.getByTestId('rev-scroll-box').className).toMatch(/overflow-y-auto/);
    });

    it('exposes an accessible history control for narrow viewports', () => {
      renderPage();
      expect(screen.getByRole('button', { name: 'Open conversation history' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('stacks the history drawer above the workspace (z-order) when open', () => {
      renderPage();
      openHistory();
      const overlay = Array.from(document.querySelectorAll('div')).find(d => typeof d.className === 'string' && d.className.includes('z-[170]'));
      expect(overlay).toBeTruthy();
    });

    it('keeps the composer (question field + send control) present in the layout', () => {
      renderPage();
      expect(screen.getByPlaceholderText(/Ask (me|Rev)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    });
  });
});
