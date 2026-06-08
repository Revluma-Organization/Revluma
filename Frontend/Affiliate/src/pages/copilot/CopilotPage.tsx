import { useState, useRef, useEffect } from 'react';
import * as api from '../../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hey there! I\'m your Revluma Copilot. I can help you craft marketing copy, brainstorm campaign ideas, or analyze your referral performance. What would you like help with?', timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMsg: Message = { role: 'user', content: input.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/affiliate/copilot/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response ?? 'No response', timestamp: new Date() }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I couldn\'t process that request. Please try again.', timestamp: new Date() }]);
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Copilot</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
        AI-powered marketing assistant
      </p>

      <div style={{
        flex: 1, overflowY: 'auto', background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)', borderRadius: 10, padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12,
      }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
              background: m.role === 'user' ? 'var(--color-brand)' : 'var(--color-bg-active)',
              color: m.role === 'user' ? '#fff' : 'var(--color-text)',
              flexShrink: 0,
            }}>
              {m.role === 'user' ? 'U' : 'C'}
            </div>
            <div style={{
              maxWidth: '70%', padding: '10px 14px', borderRadius: 10,
              background: m.role === 'user' ? 'var(--color-brand)' : 'var(--color-bg)',
              color: m.role === 'user' ? '#fff' : 'var(--color-text)',
              fontSize: 12, lineHeight: 1.5,
              borderTopRightRadius: m.role === 'user' ? 2 : 10,
              borderTopLeftRadius: m.role === 'user' ? 10 : 2,
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, paddingLeft: 4 }}>
            <div style={{ display: 'flex', gap: 3 }}>
              <span style={{ animation: 'pulse 1.2s infinite' }}>.</span>
              <span style={{ animation: 'pulse 1.2s infinite 0.2s' }}>.</span>
              <span style={{ animation: 'pulse 1.2s infinite 0.4s' }}>.</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about campaigns, copy, or strategy..."
          rows={2}
          style={{
            flex: 1, padding: '10px 14px', background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text)',
            fontSize: 12, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
          }}
        />
        <button onClick={handleSend} disabled={!input.trim() || sending} style={{
          padding: '10px 20px', background: !input.trim() ? 'var(--color-border)' : 'var(--color-brand)',
          border: 'none', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', alignSelf: 'flex-end', opacity: sending ? 0.7 : 1,
        }}>
          Send
        </button>
      </div>
    </div>
  );
}
