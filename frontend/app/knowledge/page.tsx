'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { RagAnswerResponse, VectorHit } from '@rag/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getApiBase } from '@/lib/api-base';

type Mode = 'quick' | 'deep';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  hits?: VectorHit[];
  ts: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}

const SUGGESTIONS = [
  '鸠摩智会什么武功？',
  '六脉神剑的威力如何？',
  '乔峰的降龙十八掌有多厉害？',
];

function groupByDate(list: Conversation[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups: { label: string; items: Conversation[] }[] = [];
  const todayArr: Conversation[] = [];
  const olderArr: Conversation[] = [];
  for (const c of list) {
    const d = new Date(c.createdAt);
    d.setHours(0, 0, 0, 0);
    (d.getTime() === today.getTime() ? todayArr : olderArr).push(c);
  }
  if (todayArr.length) groups.push({ label: '今天', items: todayArr });
  if (olderArr.length) groups.push({ label: '更早', items: olderArr });
  return groups;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SourcesPanel({ hits }: { hits: VectorHit[] }) {
  const [open, setOpen] = useState(false);
  if (!hits.length) return null;
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:border-teal-300 hover:text-teal-600">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 2.5C2 2.5 3.5 1.5 5.5 1.5C7.5 1.5 8 2.5 8 2.5V13.5C8 13.5 7 13 5.5 13C4 13 2 13.5 2 13.5V2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 2.5C14 2.5 12.5 1.5 10.5 1.5C8.5 1.5 8 2.5 8 2.5V13.5C8 13.5 9 13 10.5 13C12 13 14 13.5 14 13.5V2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>{hits.length} 个引用来源</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {hits.map((h, i) => (
            <div key={h.id || i} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 transition-colors hover:border-teal-200">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs font-medium text-gray-500">
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-teal-50 text-[10px] font-bold text-teal-600">{i + 1}</span>
                  {h.book_name ? <span className="truncate text-gray-600">《{h.book_name}》</span> : null}
                  <span>第 {h.chapter_num} 章</span>
                </span>
                <span className="rounded-full bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] text-teal-600">{h.score.toFixed(4)}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{h.contentPreview}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:300ms]" />
      <span className="ml-2 text-xs text-gray-400">正在检索知识库并生成回答...</span>
    </div>
  );
}

export default function KnowledgePage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, loading]);

  useEffect(() => { inputRef.current?.focus(); }, [activeId]);

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  function createConversation(firstQuery: string): Conversation {
    const c: Conversation = {
      id: crypto.randomUUID(),
      title: firstQuery.slice(0, 20) + (firstQuery.length > 20 ? '...' : ''),
      messages: [],
      createdAt: Date.now(),
    };
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    return c;
  }

  function deleteConversation(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function pushMessage(convId: string, msg: ChatMessage) {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg] } : c)),
    );
  }

  async function handleSubmit(prefill?: string) {
    const q = (prefill ?? input).trim();
    if (!q || loading) return;

    let conv = active;
    if (!conv) conv = createConversation(q);

    pushMessage(conv.id, { role: 'user', content: q, ts: Date.now() });
    setInput('');
    setError(null);
    setLoading(true);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const topK = mode === 'quick' ? 3 : 8;

    try {
      const res = await fetch(`${getApiBase()}/rag/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, topK }),
      });
      const json = (await res.json()) as RagAnswerResponse & { message?: string | string[]; error?: string };
      if (!res.ok) {
        const errMsg = Array.isArray(json.message) ? json.message.join('; ') : json.message;
        throw new Error(errMsg || json.error || res.statusText);
      }
      pushMessage(conv.id, { role: 'assistant', content: json.answer, hits: json.hits, ts: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const groups = groupByDate(conversations);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800">
      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-gray-200 bg-teal-600 text-white transition-all duration-300 ${sidebarOpen ? 'w-56' : 'w-0 overflow-hidden'}`}>
        <div className="flex items-center justify-between px-3 py-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 1L9.5 6.5L15 8L9.5 9.5L8 15L6.5 9.5L1 8L6.5 6.5L8 1Z" fill="currentColor" /></svg>
            武侠知识问答
          </span>
          <button type="button" onClick={() => setSidebarOpen(false)} className="rounded p-0.5 hover:bg-white/10">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" /><line x1="6.5" y1="2.5" x2="6.5" y2="15.5" stroke="currentColor" strokeWidth="1.3" /></svg>
          </button>
        </div>
        <div className="px-3 pb-3">
          <button type="button" onClick={() => { setActiveId(null); setError(null); }} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/15 py-2 text-sm font-medium transition-colors hover:bg-white/25">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            开启新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 text-sm">
          {groups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-white/50">{g.label}</p>
              {g.items.map((c) => (
                <div key={c.id} className={`group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 transition-colors ${activeId === c.id ? 'bg-white/20' : 'hover:bg-white/10'}`} onClick={() => { setActiveId(c.id); setError(null); }}>
                  <span className="truncate text-[13px]">{c.title}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }} className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-100">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        {!sidebarOpen && (
          <div className="flex items-center border-b border-gray-200 px-4 py-2">
            <button type="button" onClick={() => setSidebarOpen(true)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-teal-600">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" /><line x1="6.5" y1="2.5" x2="6.5" y2="15.5" stroke="currentColor" strokeWidth="1.3" /></svg>
            </button>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center px-4">
              <h1 className="text-2xl font-bold text-gray-800">武侠世界智能问答</h1>
              <p className="mt-2 text-sm text-gray-500">基于武侠小说知识库，输入问题即可检索相关内容</p>

              <div className="mt-6 flex overflow-hidden rounded-full border border-gray-200 bg-white text-sm">
                <button type="button" onClick={() => setMode('quick')} className={`px-5 py-1.5 font-medium transition-colors ${mode === 'quick' ? 'bg-teal-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>快速问答</button>
                <button type="button" onClick={() => setMode('deep')} className={`px-5 py-1.5 font-medium transition-colors ${mode === 'deep' ? 'bg-teal-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>深度分析</button>
              </div>
              <p className="mt-2 text-xs text-gray-400">{mode === 'quick' ? '快速检索知识库，3-5 秒响应（支持多轮追问）' : '扩大检索范围，更详尽的分析回答'}</p>

              <div className="mt-6 w-full max-w-xl">
                <div className="relative rounded-xl border border-gray-200 bg-white shadow-sm">
                  <textarea ref={inputRef} value={input} onChange={(e) => { setInput(e.target.value); autoResize(e.target); }} onKeyDown={handleKeyDown} placeholder="输入你的问题，例如：乔峰的降龙十八掌有多厉害？" rows={3} className="w-full resize-none rounded-xl bg-transparent px-4 pt-3 pb-10 text-sm text-gray-700 outline-none placeholder:text-gray-400" />
                  <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-gray-400">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      支持自然语言检索
                    </span>
                    <button type="button" onClick={() => void handleSubmit()} disabled={loading || !input.trim()} className="rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-40">提问</button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void handleSubmit(s)} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500 transition-colors hover:border-teal-300 hover:text-teal-600">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6">
              {messages.map((msg, i) => (
                <div key={`${msg.ts}-${i}`} className="mb-5">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-teal-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">{msg.content}</div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L9.5 6.5L15 8L9.5 9.5L8 15L6.5 9.5L1 8L6.5 6.5L8 1Z" fill="currentColor" /></svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="prose prose-sm max-w-none text-gray-700 prose-headings:text-gray-800 prose-p:leading-relaxed prose-strong:text-gray-900 prose-code:rounded prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-teal-700">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                        {msg.hits && <SourcesPanel hits={msg.hits} />}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="mb-5 flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L9.5 6.5L15 8L9.5 9.5L8 15L6.5 9.5L1 8L6.5 6.5L8 1Z" fill="currentColor" /></svg>
                  </div>
                  <TypingIndicator />
                </div>
              )}

              {error && (
                <div className="mb-5 ml-10 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>
              )}
            </div>
          )}
        </div>

        {messages.length > 0 && (
          <div className="border-t border-gray-200 bg-white px-4 py-3">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <div className="relative flex-1">
                <textarea ref={messages.length > 0 ? inputRef : undefined} value={input} onChange={(e) => { setInput(e.target.value); autoResize(e.target); }} onKeyDown={handleKeyDown} placeholder="继续提问..." rows={1} className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 pr-11 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-teal-400 focus:bg-white" />
                <button type="button" onClick={() => void handleSubmit()} disabled={loading || !input.trim()} className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-white transition-colors hover:bg-teal-500 disabled:bg-gray-300 disabled:text-gray-400">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M3.5 10H16.5M16.5 10L10 3.5M16.5 10L10 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>
            <p className="mx-auto mt-1 max-w-3xl text-center text-[10px] text-gray-400">Enter 发送 · Shift+Enter 换行 · 当前模式：{mode === 'quick' ? '快速问答' : '深度分析'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
