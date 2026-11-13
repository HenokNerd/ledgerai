export interface Project {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  previousId?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
  children?: FileNode[];
}

export interface UploadedAttachment {
  id: string;
  name: string;
  mimeType: string;
  imageMimeType: string | null;
  size: number;
  createdAt: string;
  previewUrl: string | null;
}

export interface ToolRun {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'running' | 'approval' | 'success' | 'error';
  approvalId?: string;
  result?: unknown;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: UploadedAttachment[];
  tools?: ToolRun[];
}

export type AgentEvent =
  | { type: 'tool_start'; tool: { id: string; name: string; arguments: Record<string, unknown> } }
  | { type: 'approval_required'; id: string; approvalId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'assistant'; content: string }
  | { type: 'error'; message: string };
