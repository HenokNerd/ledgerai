import type { AgentEvent, FileNode, Project, UploadedAttachment } from '../types';

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
  health: () => request<{ ok: boolean; agentEnabled: boolean; agentError?: string | null }>('/api/health'),
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
  approveTool: (approvalId: string, approved: boolean) => request<{ ok: boolean }>(`/api/chat/approvals/${encodeURIComponent(approvalId)}`, json('POST', { approved })),
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
  const consume = (block: string) => {
    const line = block.split('\n').find((candidate) => candidate.startsWith('data:'));
    if (!line) return;
    try { onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent); } catch { /* Ignore incomplete events. */ }
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
  } finally {
    reader.releaseLock();
  }
}
