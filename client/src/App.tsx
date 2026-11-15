import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import {
  ArrowUp, Check, ChevronRight, Code2,
  Eye, FileImage, FilePlus2, Files, FileText, FolderOpen, FolderPlus, LoaderCircle, MessageSquareText,
  Moon, Paperclip, PanelLeft, PanelLeftClose, Plus, Save, Sparkles, Square, Sun, Trash2,
  X,
} from 'lucide-react';
import FileTree, { LanguageIcon, languageForPath } from './components/FileTree';
import { ChatIcon } from './components/ChatIcon';
import MarkdownView from './components/MarkdownView';
import LoadingScreen from './components/LoadingScreen';
import { ToolCallTile, ToolDetailsModal } from './components/ToolCallTile';
import { api, streamAgent, chatBySlug } from './lib/api';
import type { AgentEvent, ChatMessage, ChatSummary, ContextStats, FileNode, Project, TerminalJob, ToolRun, UploadedAttachment } from './types';

const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const imagePattern = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i;
const MAX_ATTACHMENTS = 50;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const formatBytes = (bytes: number) => bytes === 0 ? '0 B' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const relativeTime = (value: string) => {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

type DialogState = { kind: 'project'; mode: 'create' | 'rename' } | { kind: 'path'; mode: 'file' | 'folder' } | { kind: 'delete-project'; project: Project } | { kind: 'delete-path'; node: FileNode } | null;
type PendingNavigation = { kind: 'project'; project: Project | null } | { kind: 'file'; path: string };
type ImageState = { src: string; label: string } | null;
type ThemeMode = 'dark' | 'light';
type TerminalNotice = Pick<TerminalJob, 'jobId' | 'command' | 'status' | 'exitCode' | 'signal'> & { stdout?: string; stderr?: string };

const readTheme = (): ThemeMode => {
  try { return window.localStorage.getItem('ledger-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
};

const MODEL_CONTEXT_TOKENS = 1_000_000;
const formatCompactNumber = (value: number) => {
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${Math.max(0, Math.round(value))}`;
};

function ContextRing({ used, total }: { used: number; total: number }) {
  const radius = 10;
  const stroke = 3;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const ratio = Math.max(0, Math.min(1, total > 0 ? used / total : 0));
  const offset = circumference - ratio * circumference;
  return (
    <svg
      className="context-ring"
      height={radius * 2}
      width={radius * 2}
      viewBox={`0 0 ${radius * 2} ${radius * 2}`}
      aria-hidden="true"
    >
      <circle className="context-ring-track" strokeWidth={stroke} r={normalizedRadius} cx={radius} cy={radius} />
      <circle
        className="context-ring-progress"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
      />
    </svg>
  );
}

function toolResultPayload(tool: ToolRun) {
  if (tool.error) return JSON.stringify({ ok: false, error: String(tool.error).slice(0, 4_000) });
  if (tool.result !== undefined) {
    const raw = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result);
    return JSON.stringify({ ok: true, result: raw.length > 12_000 ? raw.slice(0, 12_000) + '\n[truncated]' : tool.result });
  }
  return JSON.stringify({ ok: tool.status === 'success', status: tool.status });
}

function messagesForContext(message: ChatMessage): Record<string, unknown>[] {
  if (message.role === 'user') {
    const mapped: Record<string, unknown> = { role: 'user', content: message.content || '' };
    if (message.attachments?.length) mapped.attachmentIds = message.attachments.map((attachment) => attachment.id);
    return message.content || message.attachments?.length ? [mapped] : [];
  }

  if (message.role === 'system') {
    const mapped: Record<string, unknown> = { role: 'system', content: message.content || '' };
    if (message.meta) mapped.meta = message.meta;
    return [mapped];
  }

  if (message.role === 'assistant') {
    if (message.tools?.length) {
      const tool_calls = message.tools.map((tool) => ({
        id: tool.id,
        type: 'function',
        function: {
          name: tool.name,
          arguments: JSON.stringify(tool.arguments ?? {}),
        },
      }));
      const items: Record<string, unknown>[] = [{
        role: 'assistant',
        content: message.content || '',
        tool_calls,
      }];
      for (const tool of message.tools) {
        if (tool.status === 'running' || tool.status === 'approval') continue;
        items.push({
          role: 'tool',
          tool_call_id: tool.id,
          content: toolResultPayload(tool),
        });
      }
      return items;
    }
    return message.content ? [{ role: 'assistant', content: message.content }] : [];
  }

  return [];
}

function buildContextMessages(messages: ChatMessage[]) {
  const expanded = messages.flatMap(messagesForContext);
  // Keep a bounded window while preserving assistant/tool call pairs when possible.
  return expanded.slice(-80);
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><img src="/ledger-ai-mark.svg" alt="" /></span>;
}

function ModalFrame({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-head"><div><div className="dialog-title-row"><BrandMark small /><h2>{title}</h2></div>{description && <p>{description}</p>}</div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></header>
        {children}
      </section>
    </div>
  );
}

function ImageModal({ image, onClose }: { image: ImageState; onClose: () => void }) {
  if (!image) return null;
  return (
    <div className="overlay image-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="image-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
        <header className="image-dialog-head"><div><span className="eyebrow">IMAGE PREVIEW</span><strong>{image.label}</strong></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close image preview"><X size={18} /></button></header>
        <div className="image-stage"><img src={image.src} alt={image.label} /></div>
      </section>
    </div>
  );
}

function FileIconButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return <button type="button" className="icon-button" title={title} aria-label={title} onClick={onClick}>{children}</button>;
}

const MessageRow = memo(function MessageRow({
  message,
  projectId,
  onImageOpen,
  onOpenFile,
  onToolClick,
}: {
  message: ChatMessage;
  projectId?: string | null;
  onImageOpen: (src: string, label: string) => void;
  onOpenFile: (path: string) => void | Promise<void>;
  onToolClick: (tool: ToolRun) => void;
}) {
  if (message.role === 'system' || message.hidden) return null;
  return (
    <article className={`message-row ${message.role}`}>
      {message.role === 'assistant' && <div className="assistant-avatar"><BrandMark small /></div>}
      <div className={`message-body ${message.role === 'user' ? 'user-body' : 'assistant-body'}`}>
        {message.content && <MarkdownView content={message.content} projectId={projectId} onImageOpen={onImageOpen} onOpenFile={onOpenFile} />}
        {message.role === 'user' && message.attachments && message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <button key={attachment.id} type="button" className="message-attachment" disabled={!attachment.imageMimeType} title={attachment.imageMimeType ? 'Open image preview' : attachment.name} onClick={() => onImageOpen(api.uploadPreviewUrl(attachment.id), attachment.name)}>{attachment.imageMimeType ? <FileImage size={13} /> : <FileText size={13} />}<span>{attachment.name}</span><small>{formatBytes(attachment.size)}</small></button>)}</div>}
        {message.tools?.map((tool) => <ToolCallTile key={tool.id} tool={tool} onClick={onToolClick} />)}
      </div>
    </article>
  );
});

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [logoHovered, setLogoHovered] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [projectsReady, setProjectsReady] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [composerProjectsOpen, setComposerProjectsOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [view, setView] = useState<'chat' | 'file'>('chat');
  const [markdownPreview, setMarkdownPreview] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [oldestLoadedId, setOldestLoadedId] = useState<string | null>(null);
  // Guards against duplicate / re-fetching the same chunk.
  const lastFetchedOldestIdRef = useRef<string | null>(null);
  const scrollThrottleRef = useRef<number | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [visionMode, setVisionMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const sendMessageRef = useRef<(value?: string, options?: { preserveComposer?: boolean; baseMessages?: ChatMessage[]; auto?: boolean }) => Promise<void>>(async () => {});
  const triggerSystemRef = useRef<(content: string, meta: Record<string, unknown>, baseMessages?: ChatMessage[]) => Promise<void>>(async () => {});
  const [dialog, setDialog] = useState<DialogState>(null);
  const [image, setImage] = useState<ImageState>(null);
  const [toolDetails, setToolDetails] = useState<ToolRun | null>(null);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdDialogName, setCreatedDialogName] = useState('');
  const [pathDialogName, setPathDialogName] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnSequenceRef = useRef(0);
  const toolsByIdRef = useRef(new Map<string, ToolRun>());
  const terminalJobsRef = useRef(new Map<string, string | null>());
  const notifiedJobsRef = useRef(new Set<string>());
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;
  const restoredChatRef = useRef(false);
  const pendingSaveRef = useRef<{ chatId: string; messages: ChatMessage[] } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const dirty = activePath !== null && fileContent !== savedContent;
  const projectRef = useRef(project);
  projectRef.current = project;
  const editorSnapshotRef = useRef({ projectId: project?.id || null, path: activePath, dirty });
  editorSnapshotRef.current = { projectId: project?.id || null, path: activePath, dirty };

  const cancelAgentTurn = () => {
    turnSequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setUploading(false);
    setBusy(false);
  };

  const makeTerminalNotification = useCallback((job: TerminalNotice): ToolRun => {
    const detail = job.signal || (job.exitCode === null ? 'no exit code' : `exit ${job.exitCode}`);
    return {
      id: `notify-${job.jobId}`,
      name: 'notification',
      arguments: {
        kind: 'background_job',
        title: `Background command ${job.status}`,
        command: job.command,
        detail,
        jobId: job.jobId,
      },
      status: job.status === 'completed' ? 'success' : 'error',
      result: {
        jobId: job.jobId,
        command: job.command,
        cwd: '.',
        status: job.status,
        background: true,
        exitCode: job.exitCode,
        signal: job.signal,
        stdout: job.stdout || '',
        stderr: job.stderr || '',
        detail,
      },
      output: { stdout: job.stdout || '', stderr: job.stderr || '' },
      error: job.status === 'completed' ? undefined : `Background command ${job.status}`,
    };
  }, []);

  const finalizeTerminalToolByJobId = useCallback((job: TerminalNotice): boolean => {
    let found = false;
    setMessages((current) => current.map((message) => {
      if (!message.tools?.length) return message;
      let changed = false;
      const tools = message.tools.map((tool) => {
        const result = tool.result as { jobId?: string } | undefined;
        if (tool.name !== 'terminal' || result?.jobId !== job.jobId) return tool;
        found = true;
        changed = true;
        const next: ToolRun = {
          ...tool,
          status: job.status === 'completed' ? 'success' : 'error',
          result: {
            ...(tool.result as Record<string, unknown> | undefined),
            jobId: job.jobId,
            command: job.command,
            status: job.status,
            background: true,
            exitCode: job.exitCode,
            signal: job.signal,
            stdout: job.stdout || tool.output?.stdout || '',
            stderr: job.stderr || tool.output?.stderr || '',
          },
          output: { stdout: job.stdout || tool.output?.stdout || '', stderr: job.stderr || tool.output?.stderr || '' },
          error: job.status === 'completed' ? undefined : `Background command ${job.status}`,
        };
        toolsByIdRef.current.set(tool.id, next);
        setToolDetails((currentDetail) => currentDetail?.id === tool.id ? next : currentDetail);
        return next;
      });
      return changed ? { ...message, tools } : message;
    }));
    return found;
  }, []);

  const notifyTerminalJob = useCallback((job: TerminalNotice, chatId: string | null, options: { addTile?: boolean; triggerAgent?: boolean } = {}) => {
    if (notifiedJobsRef.current.has(job.jobId)) return;
    notifiedJobsRef.current.add(job.jobId);
    terminalJobsRef.current.delete(job.jobId);
    const detail = job.signal || (job.exitCode === null ? 'no exit code' : `exit ${job.exitCode}`);
    setToast(`Background command ${job.status}`);
    const isActiveChat = !chatId || chatId === activeChatIdRef.current;
    if (!isActiveChat) return;

    const originalUpdated = finalizeTerminalToolByJobId(job);
    let nextMessages = messagesRef.current;
    const shouldAddTile = options.addTile ?? !originalUpdated;
    if (shouldAddTile) {
      const tool = makeTerminalNotification(job);
      toolsByIdRef.current.set(tool.id, tool);
      const noticeMessage: ChatMessage = { id: id(), role: 'assistant', content: '', tools: [tool] };
      nextMessages = [...nextMessages, noticeMessage];
      setMessages(nextMessages);
    }

    if (options.triggerAgent && !busyRef.current) {
      const prompt = `Background job finished.\nStatus: ${job.status}\nCommand: ${job.command}\nResult: ${detail}\nJob ID: ${job.jobId}`;
      const meta = {
        type: 'background_job',
        event: 'background_job_finished',
        jobId: job.jobId,
        status: job.status,
        command: job.command,
        result: detail,
        exitCode: job.exitCode ?? null,
        signal: job.signal ?? null,
        stdout: (job.stdout || '').slice(-4000),
        stderr: (job.stderr || '').slice(-4000),
      };
      void triggerSystemRef.current(prompt, meta, nextMessages);
    }
  }, [finalizeTerminalToolByJobId, makeTerminalNotification]);

  const onTerminalJobLiveUpdate = useCallback((jobId: string, update: { stdout?: string; stderr?: string; status?: string; exitCode?: number | null; signal?: string | null }) => {
    if (!update.status || update.status === 'running') return;
    let command = `job ${jobId}`;
    for (const tool of toolsByIdRef.current.values()) {
      const result = tool.result as { jobId?: string; command?: string } | undefined;
      if (result?.jobId === jobId) { command = result.command || command; break; }
    }
    notifyTerminalJob({
      jobId,
      command,
      status: update.status as TerminalNotice['status'],
      exitCode: update.exitCode ?? null,
      signal: update.signal ?? null,
      stdout: update.stdout,
      stderr: update.stderr,
    }, terminalJobsRef.current.get(jobId) ?? activeChatIdRef.current, { triggerAgent: !busyRef.current });
  }, [notifyTerminalJob]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const ids = [...terminalJobsRef.current.keys()];
      if (!ids.length) return;
      void api.terminalJobs(ids, { includeOutput: true }).then(({ jobs }) => {
        for (const job of jobs) {
          if (job.status === 'running') continue;
          notifyTerminalJob(job, terminalJobsRef.current.get(job.jobId) ?? null, { triggerAgent: true });
        }
      }).catch(() => { /* The next poll retries. */ });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [notifyTerminalJob]);

  useEffect(() => {
    let active = true;
    void api.terminalJobs(undefined, { activeOnly: true }).then(({ jobs }) => {
      if (!active) return;
      for (const job of jobs) {
        if (job.status === 'running' && !terminalJobsRef.current.has(job.jobId)) {
          terminalJobsRef.current.set(job.jobId, activeChatIdRef.current);
        }
      }
    }).catch(() => { /* Terminal may be disabled. */ });
    return () => { active = false; };
  }, []);

  const refreshProjects = useCallback(async () => {
    const next = await api.projects();
    setProjects(next);
    setProject((current) => {
      if (!current) return null;
      const existing = next.find((item) => item.id === current.id) || null;
      if (existing) localStorage.setItem('ledger-active-project', existing.id);
      else localStorage.removeItem('ledger-active-project');
      return existing;
    });
  }, []);

  const refreshTree = useCallback(async (projectId: string) => {
    setTreeLoading(true);
    try { setTree(await api.tree(projectId)); }
    catch (error) { setToast((error as Error).message); setTree([]); }
    finally { setTreeLoading(false); }
  }, []);

  const refreshChats = useCallback(async () => {
    // Fast path: hydrate from cache first for instant render.
    try {
      const cached = window.localStorage.getItem('ledger-chats-cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length) setChats(parsed);
      }
    } catch { /* ignore cache errors */ }
    const next = await api.chats();
    setChats(next);
    try { window.localStorage.setItem('ledger-chats-cache', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }, []);

  const flushChatSave = useCallback(async () => {
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending) return;
    try {
      await api.saveChat(pending.chatId, { messages: pending.messages });
      await refreshChats();
    } catch { /* The conversation stays usable even if a save fails. */ }
  }, [refreshChats]);

  const persistChat = useCallback((chatId: string, nextMessages: ChatMessage[]) => {
    pendingSaveRef.current = { chatId, messages: nextMessages };
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void flushChatSave(); }, 450);
  }, [flushChatSave]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#EBE7DC' : '#202A2F');
    try { window.localStorage.setItem('ledger-theme', theme); } catch { /* Theme remains usable without storage. */ }
  }, [theme]);

  // Independent batch loading states for skeleton placeholders.
  // Defaults are FALSE: on first visit we render the welcome empty state
  // immediately; skeletons only appear while a fetch is in flight.
  const [chatListLoading, setChatListLoading] = useState(false);
  const [chatWindowLoading, setChatWindowLoading] = useState(false);
  const [composerLoading, setComposerLoading] = useState(false);
  // Top-level boot loading: show the modern LoadingScreen until core data is ready.
  const [appBooting, setAppBooting] = useState(true);
  const [appBootCompleting, setAppBootCompleting] = useState(false);
  const bootStartRef = useRef<number>(Date.now());

  // Sidebar fetch (brief skeleton flash only).
  useEffect(() => {
    setChatListLoading(true);
    void refreshChats()
      .catch((error) => setToast(`Could not load conversations: ${(error as Error).message}`))
      .finally(() => setChatListLoading(false));
  }, [refreshChats]);

  useEffect(() => {
    void refreshProjects()
      .catch((error) => setToast(`Could not load projects: ${(error as Error).message}`))
      .finally(() => setProjectsReady(true));
  }, [refreshProjects]);

  // Top-level boot: hide LoadingScreen once core data is ready (or 1.2s max).
  // On repeat visits with cached data, disappear quickly.
  // Minimum display time: 700ms so the animation is actually visible.
  useEffect(() => {
    let cancelled = false;
    const cached = (() => { try { return !!window.localStorage.getItem('ledger-chats-cache'); } catch { return false; } })();
    const minDisplay = cached ? 350 : 700;
    const maxWait = cached ? 900 : 2000;
    const tryComplete = () => {
      if (cancelled) return;
      const elapsed = Date.now() - bootStartRef.current;
      const remaining = Math.max(0, minDisplay - elapsed);
      window.setTimeout(() => {
        if (cancelled) return;
        setAppBootCompleting(true);
        window.setTimeout(() => { if (!cancelled) setAppBooting(false); }, 420);
      }, remaining);
    };
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      tryComplete();
    }, maxWait);
    // Complete early once both chats and projects are ready.
    if (chatListLoading === false && projectsReady) {
      window.clearTimeout(timer);
      tryComplete();
      return () => { cancelled = true; };
    }
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [chatListLoading, projectsReady]);

  // Load older messages lazily when scrolling up near the top.
  // Segmented by data size: fetch a chunk capped by total bytes, render
  // immediately, preserve scroll position, and guard against duplicates.
  const SEGMENT_BYTE_BUDGET = 64 * 1024; // 64 KB per segment
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || !oldestLoadedId || !activeChatIdRef.current) return;
    // Guard: don't re-fetch the same chunk.
    if (lastFetchedOldestIdRef.current === oldestLoadedId) return;
    lastFetchedOldestIdRef.current = oldestLoadedId;
    const chatId = activeChatIdRef.current;
    const beforeId = oldestLoadedId;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevScrollHeight = el ? el.scrollHeight : 0;
    const prevScrollTop = el ? el.scrollTop : 0;
    try {
      const fetchPromise = api.chat(chatId, { limit: 50, before: beforeId });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Segment load timed out (5s).')), 5000)
      );
      const record = await Promise.race([fetchPromise, timeoutPromise]);
      const older = record.messages || [];
      if (older.length > 0) {
        // Cap segment by data size: trim from the front (oldest) if too big.
        let segment = older;
        let bytes = 0;
        const sized: typeof older = [];
        // Walk from newest-of-older (last in `older`) backward to oldest.
        for (let i = older.length - 1; i >= 0; i--) {
          const m = older[i];
          const mBytes = (m.content?.length || 0) * 2 + (m.tools?.length || 0) * 512;
          if (bytes + mBytes > SEGMENT_BYTE_BUDGET && sized.length > 0) break;
          bytes += mBytes;
          sized.unshift(m);
        }
        if (sized.length === 0) sized.push(older[older.length - 1]);
        segment = sized;
        setMessages((current) => [...segment, ...current]);
        setOldestLoadedId(segment[0]?.id || older[0]?.id || null);
        setHasMoreOlder(Boolean(record._pagination?.hasMore));
      } else {
        setHasMoreOlder(false);
      }
    } catch (error) {
      // Reset guard so a retry is possible.
      lastFetchedOldestIdRef.current = null;
      setToast((error as Error).message);
    } finally {
      setLoadingOlder(false);
      // Preserve scroll position after prepend (run on next frame).
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node || prevScrollHeight === 0) return;
        const delta = node.scrollHeight - prevScrollHeight;
        node.scrollTop = prevScrollTop + delta;
      });
    }
  }, [loadingOlder, hasMoreOlder, oldestLoadedId]);

  // Debounced, lazy scroll handler: only fetch when far up AND idle.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (scrollThrottleRef.current !== null) return;
      scrollThrottleRef.current = window.setTimeout(() => {
        scrollThrottleRef.current = null;
        const node = scrollRef.current;
        if (!node) return;
        // Lazy: only fetch when scrolled near the top.
        if (node.scrollTop <= 120 && hasMoreOlder && !loadingOlder && oldestLoadedId) {
          void loadOlderMessages();
        }
      }, 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (scrollThrottleRef.current !== null) {
        clearTimeout(scrollThrottleRef.current);
        scrollThrottleRef.current = null;
      }
    };
  }, [hasMoreOlder, loadingOlder, oldestLoadedId, loadOlderMessages]);

  // Maintain scroll position when older messages are prepended.
  const prevScrollHeightRef = useRef<number>(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (loadingOlder) {
      prevScrollHeightRef.current = el.scrollHeight;
      return;
    }
    if (prevScrollHeightRef.current > 0 && el.scrollHeight > prevScrollHeightRef.current) {
      const delta = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop = delta;
      prevScrollHeightRef.current = 0;
    }
  }, [loadingOlder]);

  useEffect(() => {
    if (!activeChatId || messages.length === 0) return;
    persistChat(activeChatId, messages);
  }, [messages, activeChatId, persistChat]);

  useEffect(() => () => { void flushChatSave(); }, [flushChatSave]);

  useEffect(() => {
    if (!project) {
      localStorage.removeItem('ledger-active-project');
      setTree([]);
      setActivePath(null);
      setView('chat');
      setActiveFolder('');
      return;
    }
    localStorage.setItem('ledger-active-project', project.id);
    setActivePath(null);
    setView('chat');
    setActiveFolder('');
    void refreshTree(project.id);
  }, [project?.id, refreshTree]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (composerMenuRef.current && !composerMenuRef.current.contains(event.target as Node)) {
        setComposerMenuOpen(false);
        setComposerProjectsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);


  const clearConversation = () => {
    setMessages([]);
    setHasMoreOlder(false);
    setLoadingOlder(false);
    setOldestLoadedId(null);
    lastFetchedOldestIdRef.current = null;
    setContextStats(null);
    setActiveChatId(null);
    activeChatIdRef.current = null;
    localStorage.removeItem('ledger-active-chat');
  };

  const openChat = useCallback(async (chatId: string, slug?: string | null) => {
    if (activeChatIdRef.current === chatId) { setView('chat'); return; }
    cancelAgentTurn();
    await flushChatSave();
    // Show chat-pane skeleton only while Segment 1 loads.
    setChatWindowLoading(true);
    setMessages([]);
    setHasMoreOlder(false);
    setOldestLoadedId(null);
    lastFetchedOldestIdRef.current = null;
    try {
      // Segment 1: fetch newest messages (data-size capped on the server side
      // via limit; we request a generous window so the newest chunk renders
      // immediately). Wrapped in a 5s budget.
      const fetchPromise = api.chat(chatId, { limit: 50 });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Chat load timed out (5s).')), 5000)
      );
      const record = await Promise.race([fetchPromise, timeoutPromise]);
      setActiveChatId(record.id);
      activeChatIdRef.current = record.id;
      setMessages(record.messages || []);
      setHasMoreOlder(Boolean(record._pagination?.hasMore));
      setOldestLoadedId((record.messages || [])[0]?.id || null);
      setView('chat');
      setActivePath(null);
      localStorage.setItem('ledger-active-chat', record.id);
      // Auto-close sidebar after opening a chat.
      setSidebarExpanded(false);
      if (slug) {
        window.history.pushState({ slug }, '', `/c/${slug}`);
      }
    } catch (error) { setToast((error as Error).message); }
    finally {
      setChatWindowLoading(false);
      setComposerLoading(false);
    }
  }, [flushChatSave]);


  // Auto-open on load disabled — chats open only when clicked

  // Open chat from URL slug on load (e.g. /c/IqUgfifYfRPaMjKwI2wcRb)
  useEffect(() => {
    const slugMatch = window.location.pathname.match(/^\/c\/([0-9a-z]{22})$/);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    (async () => {
      try {
        const { id } = await api.chatBySlug(slug);
        await openChat(id, slug);
      } catch { /* Slug not found — ignore, show empty state */ }
    })();
  }, [openChat]);

  const startNewChat = () => {
    cancelAgentTurn();
    void flushChatSave();
    clearConversation();
    setView('chat');
    setDraft('');
    // Open empty state and close sidebar (mobile + desktop for a clean slate).
    setSidebarExpanded(false);
  };

  const removeChat = async (chat: ChatSummary) => {
    try {
      await api.deleteChat(chat.id);
      setChats((current) => current.filter((item) => item.id !== chat.id));
      if (activeChatIdRef.current === chat.id) clearConversation();
      setToast('Conversation deleted');
    } catch (error) { setToast((error as Error).message); }
  };

  const projectNameFor = (projectId: string | null) => (projectId && projects.find((item) => item.id === projectId)?.name) || 'No project';

  const selectProject = (next: Project | null) => {
    setComposerMenuOpen(false);
    setComposerProjectsOpen(false);
    const target = project?.id && next?.id === project.id ? null : next;
    if ((project?.id || null) === (target?.id || null)) return;
    cancelAgentTurn();
    if (dirty && activePath) {
      setPendingNavigation({ kind: 'project', project: target });
      return;
    }
    void flushChatSave();
    projectRef.current = target;
    setProject(target);
    clearConversation();
  };

  const handleProjectSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (dialog?.kind !== 'project') return;
      if (dialog.mode === 'create') {
        cancelAgentTurn();
        const created = await api.createProject(createdDialogName);
        setProjects((current) => [...current, created]);
        setDialog(null);
        setCreatedDialogName('');
        setToast(`Created ${created.name} in Project/${created.id}. Select it from Projects when you want to open it.`);
      } else if (project) {
        cancelAgentTurn();
        if (dirty && activePath) {
          await api.saveFile(project.id, activePath, fileContent);
          setSavedContent(fileContent);
          await refreshTree(project.id);
        }
        const renamed = await api.renameProject(project.id, createdDialogName);
        setProjects((current) => current.map((item) => item.id === project.id ? renamed : item));
        projectRef.current = renamed;
        setProject(renamed);
        setDialog(null);
        setToast(`Project renamed to ${renamed.name}`);
      }
    } catch (error) { setToast((error as Error).message); }
  };

  const handlePathSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project || dialog?.kind !== 'path') return;
    const name = pathDialogName.trim().replace(/^\/+|\/+$/g, '');
    if (!name) return;
    const path = activeFolder ? `${activeFolder}/${name}` : name;
    try {
      if (dialog.mode === 'file') {
        await api.createFile(project.id, path, '');
        await refreshTree(project.id);
        await openFile(path);
        setToast(`Created ${path}`);
      } else {
        await api.createFolder(project.id, path);
        await refreshTree(project.id);
        setActiveFolder(path);
        setToast(`Created folder ${path}`);
      }
      setDialog(null);
      setPathDialogName('');
    } catch (error) { setToast((error as Error).message); }
  };

  const confirmDelete = async () => {
    if (!dialog || pendingDelete) return;
    cancelAgentTurn();
    setPendingDelete(true);
    try {
      if (dialog.kind === 'delete-project') {
        await api.deleteProject(dialog.project.id);
        setProjects((current) => current.filter((item) => item.id !== dialog.project.id));
        if (project?.id === dialog.project.id) {
          projectRef.current = null;
          setProject(null);
          clearConversation();
        }
        setToast(`Deleted ${dialog.project.name}`);
      } else if (dialog.kind === 'delete-path' && project) {
        await api.deletePath(project.id, dialog.node.path);
        if (activePath && (activePath === dialog.node.path || activePath.startsWith(`${dialog.node.path}/`))) {
          setActivePath(null); setFileContent(''); setSavedContent(''); setView('chat');
        }
        await refreshTree(project.id);
        setToast(`Deleted ${dialog.node.path}`);
      }
      setDialog(null);
    } catch (error) { setToast((error as Error).message); }
    finally { setPendingDelete(false); }
  };

  const loadFile = useCallback(async (path: string) => {
    const currentProject = projectRef.current;
    if (!currentProject) return;
    if (imagePattern.test(path)) {
      setImage({ src: api.assetUrl(currentProject.id, path), label: path.split('/').pop() || path });
      return;
    }
    try {
      const file = await api.readFile(currentProject.id, path);
      if (projectRef.current?.id !== currentProject.id) return;
      setActivePath(path);
      setFileContent(file.content);
      setSavedContent(file.content);
      setMarkdownPreview(/\.mdx?$/i.test(path));
      setView('file');
    } catch (error) { setToast((error as Error).message); }
  }, []);

  const openFile = useCallback(async (path: string) => {
    const proj = projectRef.current;
    if (!proj) return;
    if (imagePattern.test(path)) {
      setImage({ src: api.assetUrl(proj.id, path), label: path.split('/').pop() || path });
      return;
    }
    const editor = editorSnapshotRef.current;
    if (path === editor.path) { setView('file'); return; }
    if (editor.dirty && editor.path && path !== editor.path) {
      cancelAgentTurn();
      setPendingNavigation({ kind: 'file', path });
      return;
    }
    await loadFile(path);
  }, [loadFile]);

  const onToolClick = useCallback((tool: ToolRun) => setToolDetails(tool), []);

  const resolvePendingNavigation = async (saveChanges: boolean) => {
    if (!pendingNavigation) return;
    try {
      if (saveChanges && dirty && project && activePath) {
        await api.saveFile(project.id, activePath, fileContent);
        setSavedContent(fileContent);
        await refreshTree(project.id);
      }
      const navigation = pendingNavigation;
      setPendingNavigation(null);
      cancelAgentTurn();
      if (navigation.kind === 'project') {
        projectRef.current = navigation.project;
        setProject(navigation.project);
        clearConversation();
      } else await loadFile(navigation.path);
    } catch (error) { setToast((error as Error).message); }
  };

  const saveActiveFile = useCallback(async () => {
    if (!project || !activePath || !dirty || saving) return;
    setSaving(true);
    try {
      await api.saveFile(project.id, activePath, fileContent);
      setSavedContent(fileContent);
      await refreshTree(project.id);
      setToast('Saved to the project workspace');
    } catch (error) { setToast((error as Error).message); }
    finally { setSaving(false); }
  }, [project, activePath, dirty, saving, fileContent, refreshTree]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setImage(null); setToolDetails(null); setDialog(null); setComposerMenuOpen(false); setComposerProjectsOpen(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && view === 'file' && dirty) {
        event.preventDefault(); void saveActiveFile();
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [view, dirty, saveActiveFile]);

  const updateAfterTool = async (tool: ToolRun, result: unknown) => {
    const data = result as { project?: Project | null; previousId?: string; deleted?: boolean; selected?: boolean } | undefined;
    if (tool.name === 'create_project' && data?.project) {
      setProjects((current) => [...current.filter((item) => item.id !== data.project!.id), data.project!]);
    } else if (tool.name === 'select_project' && data?.project) {
      setProjects((current) => [...current.filter((item) => item.id !== data.project!.id), data.project!]);
      projectRef.current = data.project;
      setProject(data.project);
    } else if (tool.name === 'unselect_project') {
      projectRef.current = null;
      setProject(null);
    } else if (tool.name === 'rename_project' && data?.project) {
      const previousId = data.project.previousId || String(tool.arguments.project_id || '');
      setProjects((current) => current.map((item) => item.id === previousId ? data.project! : item));
      if (projectRef.current?.id === previousId) { projectRef.current = data.project; setProject(data.project); }
    } else if (tool.name === 'delete_project' && data?.project) {
      setProjects((current) => current.filter((item) => item.id !== data.project!.id));
      if (projectRef.current?.id === data.project.id) { projectRef.current = null; setProject(null); }
    }
    const currentId = projectRef.current?.id;
    if (currentId) {
      await refreshTree(currentId);
      const editor = editorSnapshotRef.current;
      const toolPath = typeof tool.arguments.path === 'string' ? tool.arguments.path : '';
      if (tool.name === 'delete_path' && editor.projectId === currentId && editor.path && (editor.path === toolPath || editor.path.startsWith(`${toolPath}/`))) {
        setActivePath(null); setFileContent(''); setSavedContent(''); setView('chat');
      } else if (editor.projectId === currentId && editor.path && ['create_file', 'update_file', 'write', 'edit'].includes(tool.name) && toolPath === editor.path) {
        if (editorSnapshotRef.current.dirty) setToast('Ledger changed this file on disk. Your unsaved editor draft was kept.');
        else {
          const file = await api.readFile(currentId, editor.path).catch(() => null);
          if (file) { setFileContent(file.content); setSavedContent(file.content); }
        }
      }
    }
  };

  const handleAgentEvent = (event: AgentEvent) => {
    if (event.type === 'tool_start') {
      const tool: ToolRun = { ...event.tool, status: 'running' };
      toolsByIdRef.current.set(tool.id, tool);
      setMessages((current) => [...current, { id: id(), role: 'assistant', content: '', tools: [tool] }]);
    } else if (event.type === 'approval_required') {
      const previous = toolsByIdRef.current.get(event.id);
      const waiting: ToolRun = { id: event.id, name: event.name, arguments: event.arguments, ...previous, status: 'approval', approvalId: event.approvalId };
      toolsByIdRef.current.set(event.id, waiting);
      setMessages((current) => current.map((message) => ({ ...message, tools: message.tools?.map((tool) => tool.id === event.id ? waiting : tool) })));
      setToolDetails((current) => current?.id === event.id ? waiting : current);
    } else if (event.type === 'tool_result') {
      const previous = toolsByIdRef.current.get(event.id);
      const result = event.result as { jobId?: string; background?: boolean; status?: string } | undefined;
      const stillRunning = event.ok && previous?.name === 'terminal' && result?.background === true && (result.status === 'running' || !result.status);
      const found = previous ? { ...previous, status: stillRunning ? 'running' as const : event.ok ? 'success' as const : 'error' as const, result: event.result, error: event.error } : undefined;
      if (found) toolsByIdRef.current.set(event.id, found);
      setMessages((current) => current.map((message) => ({
        ...message,
        tools: message.tools?.map((tool) => tool.id === event.id ? (found || tool) : tool),
      })));
      if (found) setToolDetails((current) => current?.id === event.id ? found : current);
      if (found?.status === 'success') void updateAfterTool(found, event.result);
      if (found?.name === 'terminal' && result?.background && result.jobId) {
        terminalJobsRef.current.set(result.jobId, activeChatIdRef.current);
      }
    } else if (event.type === 'tool_output') {
      const previous = toolsByIdRef.current.get(event.id);
      if (!previous) return;
      const output = previous.output || { stdout: '', stderr: '' };
      const next: ToolRun = { ...previous, output: { ...output, [event.stream]: (output[event.stream] + event.chunk).slice(-160_000) } };
      toolsByIdRef.current.set(event.id, next);
      setMessages((current) => current.map((message) => ({ ...message, tools: message.tools?.map((tool) => tool.id === event.id ? next : tool) })));
      setToolDetails((current) => current?.id === event.id ? next : current);
    } else if (event.type === 'terminal_exit') {
      const previous = toolsByIdRef.current.get(event.id);
      if (previous) {
        const found: ToolRun = {
          ...previous,
          status: event.status === 'completed' ? 'success' : 'error',
          result: {
            ...(previous.result as Record<string, unknown> | undefined),
            jobId: event.jobId,
            command: event.command,
            status: event.status,
            background: true,
            exitCode: event.exitCode,
            signal: event.signal,
            stdout: event.stdout || '',
            stderr: event.stderr || '',
          },
          output: { stdout: event.stdout || previous.output?.stdout || '', stderr: event.stderr || previous.output?.stderr || '' },
          error: event.status === 'completed' ? undefined : `Background command ${event.status}`,
        };
        toolsByIdRef.current.set(event.id, found);
        setMessages((current) => current.map((message) => ({ ...message, tools: message.tools?.map((tool) => tool.id === event.id ? found : tool) })));
        setToolDetails((current) => current?.id === event.id ? found : current);
      }
      const chatId = terminalJobsRef.current.get(event.jobId) ?? activeChatIdRef.current;
      notifyTerminalJob(event, chatId, { triggerAgent: !busyRef.current });
    } else if (event.type === 'context') {
      setContextStats(event.stats);
      console.log('[ledger-context]', event.stats);
    } else if (event.type === 'assistant') {
      setMessages((current) => [...current, { id: id(), role: 'assistant', content: event.content }]);
    } else {
      setMessages((current) => [...current, { id: id(), role: 'assistant', content: `**Agent issue**\n\n${event.message}` }]);
    }
  };

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    if (!selected.length) return;
    const remaining = Math.max(0, MAX_ATTACHMENTS - pendingFiles.length);
    const accepted = selected.slice(0, remaining).filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
    if (accepted.length) setPendingFiles((current) => [...current, ...accepted].slice(0, MAX_ATTACHMENTS));
    if (selected.some((file) => file.size > MAX_ATTACHMENT_BYTES)) setToast('Each attachment must be 10 MB or smaller.');
    else if (selected.length > remaining) setToast('You can attach up to 50 files to one message.');
  };

  const triggerSystemMessage = async (content: string, meta: Record<string, unknown>, baseMessages?: ChatMessage[]) => {
    const base = baseMessages ?? messagesRef.current;
    if (busyRef.current) return;
    setBusy(true);
    setUploading(false);
    const turnId = ++turnSequenceRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!activeChatIdRef.current) {
        try {
          const created = await api.createChat({ projectId: projectRef.current?.id || null });
          activeChatIdRef.current = created.id;
          setActiveChatId(created.id);
          localStorage.setItem('ledger-active-chat', created.id);
          void refreshChats();
        } catch { /* continue without persisted chat */ }
      }
      if (turnSequenceRef.current !== turnId) return;
      const systemMsg: ChatMessage = { id: id(), role: 'system', content, meta: meta as any, hidden: true };
      const nextMessages = [...base, systemMsg];
      setMessages(nextMessages);
      const context = buildContextMessages(nextMessages);
      await streamAgent(projectRef.current?.id || null, context, (event) => { if (turnSequenceRef.current === turnId) handleAgentEvent(event); }, controller.signal, { vision: false });
    } catch (error) {
      if (turnSequenceRef.current === turnId && (error as Error).name !== 'AbortError') {
        const message = (error as Error).message;
        setMessages((current) => [...current, { id: id(), role: 'assistant', content: `**I couldn’t finish that background update.**\n\n${message}` }]);
      }
    } finally {
      if (turnSequenceRef.current === turnId) { abortRef.current = null; setBusy(false); setUploading(false); }
    }
  };
  triggerSystemRef.current = triggerSystemMessage;

  const sendMessage = async (value?: string, options: { preserveComposer?: boolean; baseMessages?: ChatMessage[]; auto?: boolean } = {}) => {
    const preserveComposer = options.preserveComposer === true;
    const baseMessages = options.baseMessages ?? messagesRef.current;
    const text = (value ?? (preserveComposer ? '' : draft)).trim();
    const files = value === undefined && !preserveComposer ? pendingFiles : [];
    if ((!text && files.length === 0) || busy) return;
    setBusy(true);
    setUploading(files.length > 0);
    const turnId = ++turnSequenceRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    let userMessageAdded = false;
    try {
      const needsChat = !activeChatIdRef.current;
      const metaText = text || files.map((file) => file.name).join(', ');
      const existingChatId = activeChatIdRef.current;
      const priorUserCount = baseMessages.filter((message) => message.role === 'user').length;
      const shouldRetitle = !options.auto && !needsChat && priorUserCount === 1 && baseMessages.some((message) => message.role === 'assistant');
      const firstPrompt = baseMessages.find((message) => message.role === 'user')?.content || '';
      const firstResponse = baseMessages
        .filter((message) => message.role === 'assistant' && message.content.trim())
        .map((message) => message.content.trim())
        .join('\n\n')
        .slice(0, 4_000);
      const currentChat = existingChatId ? chats.find((chat) => chat.id === existingChatId) : undefined;
      const metaRequest = options.auto || !metaText
        ? null
        : needsChat
          ? { text: metaText, projectName: projectRef.current?.name }
          : shouldRetitle
            ? { firstPrompt: firstPrompt || metaText, firstResponse, secondPrompt: metaText, projectName: projectRef.current?.name, currentTitle: currentChat?.title, currentIcon: currentChat?.icon }
            : null;
      // Fetch uploads and title metadata in parallel, but don't let the title
      // namer agent block chat creation: race meta with a short budget so the
      // first message is sent immediately.
      const metaPromise = metaRequest
        ? api.chatMeta(metaRequest).catch(() => null)
        : Promise.resolve(null);
      const metaBudget = new Promise<null>((resolve) => setTimeout(() => resolve(null), 400));
      const [attachments, meta] = await Promise.all([
        files.length ? api.uploadFiles(files, controller.signal) : Promise.resolve([] as UploadedAttachment[]),
        Promise.race([metaPromise, metaBudget]),
      ]);
      // If meta didn't resolve in time, update the title in the background.
      if (metaRequest && meta === null) {
        void metaPromise.then((lateMeta) => {
          if (!lateMeta?.title) return;
          const cid = activeChatIdRef.current;
          if (!cid) return;
          void api.saveChat(cid, { title: lateMeta.title, icon: lateMeta.icon }).then(() => refreshChats()).catch(() => {});
        });
      }
      if (files.length && attachments.length !== files.length) throw new Error('Some selected files could not be uploaded. Try attaching them again.');
      if (turnSequenceRef.current !== turnId) {
        await Promise.allSettled(attachments.map((attachment) => api.deleteUpload(attachment.id)));
        return;
      }
      if (needsChat) {
        try {
          const created = await api.createChat({ title: meta?.title, icon: meta?.icon, projectId: projectRef.current?.id || null });
          activeChatIdRef.current = created.id;
          setActiveChatId(created.id);
          localStorage.setItem('ledger-active-chat', created.id);
          void refreshChats();
        } catch { /* The turn can continue even when history cannot be saved. */ }
      } else if (shouldRetitle && existingChatId && meta?.title) {
        void api.saveChat(existingChatId, { title: meta.title, icon: meta.icon }).then(() => refreshChats()).catch(() => { /* Title refinement is best-effort. */ });
      }
      if (turnSequenceRef.current !== turnId) return;
      const nextUser: ChatMessage = { id: id(), role: 'user', content: text, attachments };
      const nextMessages = [...baseMessages, nextUser];
      setMessages(nextMessages);
      if (!preserveComposer) {
        setDraft('');
        if (files.length) setPendingFiles([]);
      }
      userMessageAdded = true;
      const context = buildContextMessages(nextMessages);
      setUploading(false);
      await streamAgent(projectRef.current?.id || null, context, (event) => { if (turnSequenceRef.current === turnId) handleAgentEvent(event); }, controller.signal, { vision: visionMode });
    } catch (error) {
      if (turnSequenceRef.current === turnId && (error as Error).name !== 'AbortError') {
        const message = (error as Error).message;
        if (userMessageAdded) setMessages((current) => [...current, { id: id(), role: 'assistant', content: `**I couldn’t finish that turn.**\n\n${message}\n\nYour message is still in the conversation—try again when you’re ready.` }]);
        else setToast(message);
      }
    } finally {
      if (turnSequenceRef.current === turnId) { abortRef.current = null; setBusy(false); setUploading(false); }
    }
  };
  sendMessageRef.current = sendMessage;

  const respondToToolApproval = async (approved: boolean) => {
    const tool = toolDetails;
    if (!tool?.approvalId || approvalBusy) return;
    setApprovalBusy(true);
    try {
      const editor = editorSnapshotRef.current;
      const currentProject = projectRef.current;
      if (approved && tool.name === 'rename_project' && currentProject && currentProject.id === String(tool.arguments.project_id) && editor.dirty && editor.path) {
        await api.saveFile(currentProject.id, editor.path, fileContent);
        setSavedContent(fileContent);
        await refreshTree(currentProject.id);
      }
      await api.approveTool(tool.approvalId, approved);
      setToolDetails(null);
    } catch (error) { setToast((error as Error).message); }
    finally { setApprovalBusy(false); }
  };

  const createDialog = (kind: 'file' | 'folder') => {
    setPathDialogName('');
    setDialog({ kind: 'path', mode: kind });
  };

  const editorOptions = useMemo(() => ({
    minimap: { enabled: false }, fontSize: 13, lineHeight: 23, fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontLigatures: true, padding: { top: 18, bottom: 18 }, automaticLayout: true, scrollBeyondLastLine: false,
    wordWrap: 'on' as const, tabSize: 2, smoothScrolling: true, cursorBlinking: 'smooth' as const,
    renderLineHighlight: 'gutter' as const, overviewRulerBorder: false, hideCursorInOverviewRuler: true,
    guides: { indentation: false }, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  }), []);
  const handleEditorMount: OnMount = (editor, monaco) => {
    monaco.editor.defineTheme('ledger-midnight', {
      base: 'vs-dark', inherit: true, rules: [], colors: {
        'editor.background': '#202A2F', 'editorGutter.background': '#202A2F', 'editorLineNumber.foreground': '#7D8989',
        'editorLineNumber.activeForeground': '#F6E9C7', 'editorCursor.foreground': '#64CDDE',
        'editor.selectionBackground': '#34798A66', 'editor.lineHighlightBackground': '#F6E9C708',
      },
    });
    monaco.editor.defineTheme('ledger-sand', {
      base: 'vs', inherit: true, rules: [], colors: {
        'editor.background': '#F6E9C7', 'editor.foreground': '#242721', 'editorGutter.background': '#F6E9C7',
        'editorLineNumber.foreground': '#918D7B', 'editorLineNumber.activeForeground': '#242721',
        'editorCursor.foreground': '#147F91', 'editor.selectionBackground': '#65AFC344',
        'editor.lineHighlightBackground': '#00000008', 'editorIndentGuide.background1': '#DED2B3',
      },
    });
    monaco.editor.setTheme(theme === 'light' ? 'ledger-sand' : 'ledger-midnight');
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveActiveFile(); });
  };

  const projectName = project?.name || 'No project selected';
  const imageOpen = useCallback((src: string, label: string) => setImage({ src, label }), []);
  const approvalPath = typeof toolDetails?.arguments.path === 'string' ? toolDetails.arguments.path : '';
  const approvalHasUnsavedEdits = Boolean(dirty && toolDetails && (
    (toolDetails.name === 'delete_project' && String(toolDetails.arguments.project_id) === project?.id) ||
    (toolDetails.name === 'delete_path' && activePath && (activePath === approvalPath || activePath.startsWith(`${approvalPath}/`)))
  ));
  const deleteDescription = dialog?.kind === 'delete-project'
    ? `This permanently deletes “${dialog.project.name}” and all its files.${dirty && project?.id === dialog.project.id ? ' Unsaved changes will also be discarded.' : ''}`
    : dialog?.kind === 'delete-path'
      ? `Delete “${dialog.node.name}”${dialog.node.type === 'directory' ? ' and everything inside it' : ''}.${dirty && activePath && (activePath === dialog.node.path || activePath.startsWith(`${dialog.node.path}/`)) ? ' Unsaved changes will also be discarded.' : ''}`
      : '';

  return (
    <>
      {appBooting && <LoadingScreen theme={theme} completing={appBootCompleting} label="Preparing workspace" />}
      <div className="app-shell" data-theme={theme} data-chat-active={activeChatId ? 'true' : undefined}>
      <header className="app-header">
        <div className="header-branding">
          <button
            className={`ledger-toggle ${sidebarExpanded ? 'active' : ''}`}
            type="button"
            aria-label={sidebarExpanded ? 'Collapse workspace sidebar' : 'Expand workspace sidebar'}
            aria-pressed={sidebarExpanded}
            onClick={() => setSidebarExpanded((open) => !open)}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
          >{logoHovered || !sidebarExpanded ? <PanelLeft size={18} /> : <BrandMark />}</button>
        </div>
        <div className="header-center"><span className="brand-word">Ledger <span>AI</span></span></div>
        <div className="header-actions">
          {activePath && <button className={`header-view file-view-tab ${view === 'file' ? 'current' : ''}`} type="button" onClick={() => setView('file')}><LanguageIcon path={activePath} size={14} />{activePath.split('/').pop()} {dirty && <span className="dirty-dot" />}</button>}
          {activeChatId && <div className="header-context" title={`Context: ~${(contextStats?.approxTokens ?? 0).toLocaleString()} / ${MODEL_CONTEXT_TOKENS.toLocaleString()} tokens`}>
            <ContextRing used={contextStats?.approxTokens ?? 0} total={MODEL_CONTEXT_TOKENS} />
            <span className="header-context-number">{formatCompactNumber(contextStats?.approxTokens ?? 0)}</span>
          </div>}
          <button className="icon-button theme-toggle" type="button" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>
      </header>

      <div className={`workspace ${sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
        {sidebarExpanded && typeof window !== 'undefined' && window.innerWidth <= 760 && <button type="button" className="sidebar-backdrop" aria-label="Close sidebar" onClick={() => setSidebarExpanded(false)} />}
        <aside className="sidebar" aria-label="Workspace navigation">
          {!sidebarExpanded ? (
            <nav className="sidebar-rail" aria-label="Workspace">
              <button type="button" className="rail-button" title="Files" aria-label="Files" onClick={() => setSidebarExpanded(true)}><Files size={18} /></button>
              <span className="rail-divider" />
              <button type="button" className="rail-button rail-add" title="New conversation" aria-label="New conversation" onClick={startNewChat}><Plus size={20} /></button>
            </nav>
          ) : (
            <>
              <div className="sidebar-top">
                <button type="button" className="sidebar-new-task" onClick={startNewChat} title="New Task">
                  <Plus size={16} /> <span>New Task</span>
                </button>
                <div className="sidebar-heading-actions">
                  <FileIconButton title="Collapse sidebar" onClick={() => setSidebarExpanded(false)}><PanelLeftClose size={15} /></FileIconButton>
                </div>
              </div>
              <div className="chats-panel" id="chats-panel">
                {chatListLoading ? (
                  <div className="projects-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
                    <LoadingScreen theme={theme} inline label="Loading conversations" />
                  </div>
                ) : (
                  <div className="projects-scroll">{chats.length ? chats.map((chat) => <div key={chat.id} className={`chat-card ${activeChatId === chat.id ? 'selected' : ''}`}><button type="button" className="chat-card-main" title={chat.title} onClick={() => void openChat(chat.id, chat.slug ?? undefined)}><span className="chat-card-icon"><ChatIcon name={chat.icon} size={16} /></span><span className="chat-card-copy"><strong>{chat.title}</strong><small>{projectNameFor(chat.projectId)} · {relativeTime(chat.updatedAt)}</small></span></button><button type="button" className="chat-card-delete" title="Delete conversation" aria-label={`Delete ${chat.title}`} onClick={() => void removeChat(chat)}><Trash2 size={13} /></button></div>) : <div className="projects-empty"><MessageSquareText size={22} /><strong>No conversations yet</strong><span>Your chats are saved here automatically and titled by the assistant.</span></div>}</div>
                )}
              </div>
              <div className="sidebar-footer"><span className="sandbox-lock"><Check size={13} /> Projects saved</span></div>
            </>
          )}
        </aside>

        <main className="main-panel">
          {view === 'chat' ? (
            <section className="chat-view">
              <div className="chat-scroll" ref={scrollRef}>
                {chatWindowLoading && activeChatId ? (
                  <LoadingScreen theme={theme} inline label="Loading conversation" />
                ) : messages.length === 0 ? (
                  <div className="welcome-screen">
                    <div className="welcome-mark"><BrandMark /></div>
                    <h1>What are we<br /><em>building?</em></h1>
                    {project ? <div className="welcome-project"><span className="project-indicator" /><strong>{project.name}</strong><button type="button" onClick={() => setSidebarExpanded(true)}>Open files</button></div> : <button className="welcome-create" type="button" onClick={() => { setCreatedDialogName(''); setDialog({ kind: 'project', mode: 'create' }); }}><Plus size={15} /> New project</button>}
                    <div className="starter-prompts">
                      {(project ? ['Explore code', 'Plan a feature', 'Create a file'] : ['Explore workspace', 'Plan an idea', 'Create a project']).map((prompt) => <button type="button" key={prompt} onClick={() => void sendMessage(prompt)}><Sparkles size={13} />{prompt}<ArrowUp size={12} /></button>)}
                    </div>
                  </div>
                ) : (
                  <div className="conversation-list">
                    {loadingOlder && <div className="loading-older"><LoaderCircle size={12} className="spin" /> Loading older messages…</div>}
                    {messages.map((message) => <MessageRow key={message.id} message={message} projectId={project?.id} onImageOpen={imageOpen} onOpenFile={openFile} onToolClick={onToolClick} />)}
                    {busy && !messages.some((message) => message.tools?.some((tool) => tool.status === 'running')) && <div className="thinking-row"><div className="assistant-avatar"><BrandMark small /></div><span className="thinking-indicator"><span /><span /><span /></span><span>{uploading ? 'Preparing attachments' : 'Thinking'}</span></div>}
                    <div className="scroll-end" />
                  </div>
                )}
              </div>
              <div className="composer-wrap">
                {composerLoading ? (
                  <div className="skeleton-composer">
                    <div className="skeleton-composer-textarea" />
                  </div>
                ) : (
                  <div className={`composer ${busy ? 'is-busy' : ''}`}>
                  {pendingFiles.length > 0 && <div className="composer-attachments" aria-label={`${pendingFiles.length} attached files`}>{pendingFiles.map((file, index) => <span key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="pending-attachment"><FileText size={13} /><span className="attachment-chip-label"><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span><button type="button" className="attachment-remove" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><X size={13} /></button></span>)}</div>}
                  <textarea ref={draftRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendMessage(); } }} placeholder='Message… (Ctrl+Enter to send)' rows={1} aria-label='Message' />
                  <div className="composer-bottom">
                    <div className="composer-tools-left">
                      <div className="composer-plus-wrap" ref={composerMenuRef}>
                        <input ref={uploadInputRef} className="file-input-hidden" type="file" multiple onChange={handleAttachmentChange} aria-hidden="true" tabIndex={-1} />
                        <button className={`composer-plus ${composerMenuOpen ? 'open' : ''}`} type="button" aria-label="Add to message" aria-haspopup="menu" aria-expanded={composerMenuOpen} title="Add to message" onClick={() => { setComposerMenuOpen((open) => !open); setComposerProjectsOpen(false); }}><Plus size={19} /></button>
                        {composerMenuOpen && <div className="composer-menu" role="menu" aria-label="Add to message">
                          <button className="composer-menu-item" type="button" role="menuitem" disabled={busy || pendingFiles.length >= MAX_ATTACHMENTS} onClick={() => { setComposerMenuOpen(false); uploadInputRef.current?.click(); }}><Paperclip size={15} /><span>Add Attachment</span></button>
                          <div className={`composer-menu-sub ${composerProjectsOpen ? 'open' : ''}`} onMouseEnter={() => setComposerProjectsOpen(true)} onMouseLeave={() => setComposerProjectsOpen(false)}>
                            <button className="composer-menu-item has-sub" type="button" aria-haspopup="menu" aria-expanded={composerProjectsOpen} onClick={() => setComposerProjectsOpen((open) => !open)}><FolderOpen size={15} /><span>Projects</span><ChevronRight size={14} className="composer-sub-chevron" /></button>
                            {composerProjectsOpen && <div className="composer-project-flyout" role="menu" aria-label="Projects">
                              <div className="composer-project-list">
                                <button type="button" role="menuitem" className={`composer-project-card ${!project ? 'selected' : ''}`} title="No project" onClick={() => selectProject(null)}><span className="composer-project-icon"><FolderOpen size={15} /></span><span className="composer-project-name">No project</span>{!project && <Check size={14} />}</button>
                                {projects.length ? projects.map((item) => <button key={item.id} type="button" role="menuitem" className={`composer-project-card ${project?.id === item.id ? 'selected' : ''}`} title={item.name} onClick={() => selectProject(item)}><span className="composer-project-icon"><Code2 size={15} /></span><span className="composer-project-name">{item.name}</span>{project?.id === item.id && <Check size={14} />}</button>) : <span className="composer-project-empty">No projects yet</span>}
                              </div>
                              <button className="composer-add-project" type="button" role="menuitem" onClick={() => { setComposerMenuOpen(false); setComposerProjectsOpen(false); setCreatedDialogName(''); setDialog({ kind: 'project', mode: 'create' }); }}><Plus size={15} /><span>Add project</span></button>
                            </div>}
                          </div>
                        </div>}
                      </div>
                    </div>
                    <div className="composer-controls">
                      <button className={`vision-toggle ${visionMode ? 'active' : ''}`} type="button" title="Enable visual understanding for attached images" aria-label="Vision mode" aria-pressed={visionMode} onClick={() => setVisionMode((enabled) => !enabled)}><Eye size={14} /><span>Vision</span></button>
                      {busy ? <button className="send-button stop-button" type="button" onClick={cancelAgentTurn} aria-label={uploading ? 'Cancel upload' : 'Stop agent'}>{uploading ? <LoaderCircle size={14} className="spin" /> : <Square size={13} fill="currentColor" />}</button> : <button className="send-button" type="button" onClick={() => void sendMessage()} disabled={!draft.trim() && pendingFiles.length === 0} aria-label="Send message"><ArrowUp size={18} /></button>}
                    </div>
                  </div>
                </div>
              )}
              </div>
            </section>
          ) : (
            <section className="editor-view">
              <div className="editor-toolbar">
                <div className="editor-file-label">{activePath && <><LanguageIcon path={activePath} size={15} /><span>{activePath}</span>{dirty && <span className="dirty-label">Unsaved</span>}</>}</div>
                <div className="editor-toolbar-actions">
                  {activePath && /\.mdx?$/i.test(activePath) && <div className="preview-toggle"><button type="button" className={markdownPreview ? 'selected' : ''} onClick={() => setMarkdownPreview(true)}><Eye size={13} /> Preview</button><button type="button" className={!markdownPreview ? 'selected' : ''} onClick={() => setMarkdownPreview(false)}><Code2 size={13} /> Source</button></div>}
                  <button className={`save-file-button ${dirty ? 'dirty' : ''}`} type="button" disabled={!dirty || saving} onClick={() => void saveActiveFile()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}<span>{saving ? 'Saving…' : 'Save'}</span><kbd>⌘ S</kbd></button>
                </div>
              </div>
              {activePath && markdownPreview && /\.mdx?$/i.test(activePath) ? <div className="markdown-file-scroll"><div className="markdown-file-paper"><MarkdownView content={fileContent} projectId={project?.id} filePath={activePath} onImageOpen={imageOpen} onOpenFile={(path) => void openFile(path)} /></div></div> : activePath ? <div className="monaco-wrap"><Editor height="100%" width="100%" path={activePath} language={languageForPath(activePath)} theme={theme === 'light' ? 'ledger-sand' : 'ledger-midnight'} value={fileContent} onChange={(value) => setFileContent(value || '')} onMount={handleEditorMount} options={editorOptions} loading={<div className="editor-loading"><LoaderCircle size={17} className="spin" /> Loading…</div>} /></div> : <div className="no-file-open"><BrandMark /><strong>Open a file</strong><button type="button" onClick={() => setSidebarExpanded(true)}>Open files</button></div>}
              <div className="editor-statusbar"><span><span className="status-dot" /> {project?.name || 'Workspace'}</span><span>{activePath ? languageForPath(activePath) : 'Text'}</span></div>
            </section>
          )}
        </main>
      </div>

      {dialog?.kind === 'project' && <ModalFrame title={dialog.mode === 'create' ? 'New project' : 'Rename project'} onClose={() => setDialog(null)}>
        <form className="dialog-form" onSubmit={(event) => void handleProjectSubmit(event)}><label htmlFor="project-name">Name</label><input autoFocus id="project-name" value={createdDialogName} onChange={(event) => setCreatedDialogName(event.target.value)} placeholder="e.g. atlas-dashboard" maxLength={64} /><div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary-button" type="submit" disabled={!createdDialogName.trim()}><Plus size={15} />{dialog.mode === 'create' ? 'Create' : 'Save'}</button></div></form>
      </ModalFrame>}

      {dialog?.kind === 'path' && <ModalFrame title={dialog.mode === 'file' ? 'New file' : 'New folder'} description={project ? `${project.name}${activeFolder ? ` · ${activeFolder}` : ''}` : 'Choose a project first.'} onClose={() => setDialog(null)}>
        <form className="dialog-form" onSubmit={(event) => void handlePathSubmit(event)}><label htmlFor="path-name">Name</label><input autoFocus id="path-name" value={pathDialogName} onChange={(event) => setPathDialogName(event.target.value)} placeholder={dialog.mode === 'file' ? 'component.tsx' : 'components'} /><div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary-button" type="submit" disabled={!project || !pathDialogName.trim()}>{dialog.mode === 'file' ? <FilePlus2 size={15} /> : <FolderPlus size={15} />}{dialog.mode === 'file' ? 'Create' : 'Create'}</button></div></form>
      </ModalFrame>}

      {(dialog?.kind === 'delete-project' || dialog?.kind === 'delete-path') && <ModalFrame title={dialog.kind === 'delete-project' ? 'Delete this project?' : 'Delete this item?'} description={deleteDescription} onClose={() => setDialog(null)}><div className="delete-dialog-copy"><span className="delete-warning-icon"><Trash2 size={18} /></span><div><strong>This cannot be undone</strong><span>Make sure there is nothing here you still need.</span></div></div><div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialog(null)}>Keep it</button><button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={pendingDelete}>{pendingDelete ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}Delete permanently</button></div></ModalFrame>}

      {pendingNavigation && <ModalFrame title="Unsaved changes" description={pendingNavigation.kind === 'project' ? `Save or discard the changes in ${activePath || 'the current file'} before switching to ${pendingNavigation.project?.name || 'another project'}.` : `Save or discard the changes in ${activePath || 'the current file'} before opening ${pendingNavigation.path}.`} onClose={() => setPendingNavigation(null)}>
        <div className="dirty-dialog-copy"><span className="dirty-warning-icon"><Save size={17} /></span><div><strong>{activePath}</strong><span>Your edits are only in the editor until you save.</span></div></div>
        <div className="dialog-actions unsaved-dialog-actions"><button className="quiet-button" type="button" onClick={() => setPendingNavigation(null)}>Stay here</button><button className="quiet-button discard-button" type="button" onClick={() => void resolvePendingNavigation(false)}>Discard and continue</button><button className="primary-button" type="button" onClick={() => void resolvePendingNavigation(true)} disabled={saving}><Save size={14} />Save and continue</button></div>
      </ModalFrame>}

      {image && <ImageModal image={image} onClose={() => setImage(null)} />}
      {toolDetails && <ToolDetailsModal tool={toolDetails} onClose={() => setToolDetails(null)} onApproval={(approved) => void respondToToolApproval(approved)} approving={approvalBusy} hasUnsavedEdits={approvalHasUnsavedEdits} onJobUpdate={onTerminalJobLiveUpdate} />}
      {toast && <div className="toast-message" role="status"><Check size={15} />{toast}<button type="button" aria-label="Dismiss notice" onClick={() => setToast('')}><X size={14} /></button></div>}
    </div>
    </>
  );
}

