import type { AgentEvent, ChatMeta, ChatRecord, ChatSummary, FileNode, Project, TerminalJob, UploadedAttachment } from '../types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const base = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  health: () => request<{ ok: boolean; agentEnabled: boolean; agentError?: string | null; terminalEnabled?: boolean }>('/api/health'),
  projects: () => request<Project[]>('/api/projects'),
  createProject: (name: string) => request<Project>('/api/projects', json('POST', { name })),
  renameProject: (id: string, name: string) => request<Project>(base(id), json('PATCH', { name })),
  deleteProject: (id: string) => request<{ deleted: boolean; project: Project }>(base(id), { method: 'DELETE' }),
  tree: (id: string) => request<FileNode[]>(`${base(id)}/tree`),
  createFile: (id: string, path: string, content = '') => request<{ path: string }>(`${base(id)}/files`, json('POST', { path, content })),
  saveFile: (id: string, path: string, content: string) => request<{ path: string; bytes: number }>(`${base(id)}/file`, json('PUT', { path, content })),
  createFolder: (id: string, path: string) => request<{ path: string }>(`${base(id)}/folders`, json('POST', { path })),
  deletePath: (id: string, path: string) => request<{ deleted: boolean; path: string }>(`${base(id)}/path?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  readFile: (id: string, path: string) => request<{ path: string; content: string; size: number }>(`${base(id)}/file?path=${encodeURIComponent(path)}`),
  assetUrl: (id: string, path: string) => `${base(id)}/asset?path=${encodeURIComponent(path)}`,
  uploadPreviewUrl: (id: string) => `/api/uploads/${encodeURIComponent(id)}/preview`,
  uploadFiles: async (files: File[], signal?: AbortSignal): Promise<UploadedAttachment[]> => {
    const body = new FormData();
    files.forEach((file) => body.append('files', file, file.name));
    const response = await fetch('/api/uploads', { method: 'POST', body, signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Upload failed (${response.status}).`);
    return Array.isArray(data?.files) ? data.files as UploadedAttachment[] : [];
  },
  deleteUpload: (id: string) => request<{ deleted: boolean }>(`/api/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chats: () => request<ChatSummary[]>('/api/chats'),
  chatBySlug: (slug: string) => request<{ id: string }>(`/api/chats/slug/${encodeURIComponent(slug)}`),
  chat: (id: string, options?: { limit?: number; before?: string }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.before) params.set('before', options.before);
    const query = params.toString();
    return request<ChatRecord>(`/api/chats/${encodeURIComponent(id)}${query ? `?${query}` : ''}`);
  },
  createChat: (data: { title?: string; icon?: string; projectId?: string | null }) => request<ChatRecord>('/api/chats', json('POST', data)),
  saveChat: (id: string, data: { title?: string; icon?: string; projectId?: string | null; messages: ChatRecord['messages'] }) => request<ChatRecord>(`/api/chats/${encodeURIComponent(id)}`, json('PUT', data)),
  deleteChat: (id: string) => request<{ deleted: boolean; id: string }>(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chatMeta: (body: { text?: string; projectName?: string; firstPrompt?: string; firstResponse?: string; secondPrompt?: string; currentTitle?: string; currentIcon?: string }) => request<ChatMeta>('/api/chats/meta', json('POST', body)),
  approveTool: (approvalId: string, approved: boolean) => request<{ ok: boolean }>(`/api/chat/approvals/${encodeURIComponent(approvalId)}`, json('POST', { approved })),
  terminalJobs: (ids?: string[], options: { activeOnly?: boolean; includeOutput?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (ids?.length) params.set('ids', ids.join(','));
    if (options.activeOnly) params.set('active', 'true');
    if (options.includeOutput) params.set('output', 'true');
    const query = params.toString();
    return request<{ jobs: TerminalJob[] }>(`/api/terminal/jobs${query ? `?${query}` : ''}`);
  },
  terminalJob: (id: string, includeOutput = true) => request<{ job: TerminalJob }>(`/api/terminal/jobs/${encodeURIComponent(id)}${includeOutput ? '' : '?output=false'}`),
  killTerminalJob: (id: string, signal = 'SIGTERM') => request<{ job: TerminalJob }>(`/api/terminal/jobs/${encodeURIComponent(id)}/kill`, json('POST', { signal })),
};

export async function streamAgent(
  projectId: string | null,
  messages: Array<{ role: 'user' | 'assistant'; content: string; attachmentIds?: string[] }>,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
  options: { vision?: boolean } = {},
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ projectId, messages, vision: options.vision === true, imageOrigin: window.location.origin }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || `The agent request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('This browser could not open the agent response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const consume = (block: string) => {
    const line = block.split('\n').find((candidate) => candidate.startsWith('data:'));
    if (!line) return;
    try {
      const event = JSON.parse(line.slice(5).trim()) as AgentEvent;
      if (event.type === 'assistant' || event.type === 'error') completed = true;
      onEvent(event);
    } catch { /* Ignore malformed or incomplete events; a missing terminal event is reported below. */ }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) consume(block);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!completed && !signal.aborted) throw new Error('The connection ended before the assistant finished responding. Your message is still in the conversation—please retry.');
  } finally {
    reader.releaseLock();
  }
}
