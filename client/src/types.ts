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
  output?: { stdout: string; stderr: string };
}

export interface ChatSystemMeta {
  kind?: string;
  jobId?: string;
  command?: string;
  status?: string;
  exitCode?: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: UploadedAttachment[];
  tools?: ToolRun[];
  meta?: ChatSystemMeta;
  hidden?: boolean;
}

export interface ChatSummary {
  id: string;
  slug: string | null;
  title: string;
  icon: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatRecord extends ChatSummary {
  messages: ChatMessage[];
}

export interface ChatMeta {
  title: string;
  icon: string;
}

export interface TerminalJob {
  jobId: string;
  command: string;
  cwd: string;
  background: boolean;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'timed_out';
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  killed: boolean;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  truncated?: { stdout: boolean; stderr: boolean };
  stdout?: string;
  stderr?: string;
}

export interface ContextStats {
  systemChars: number;
  historyMessages: number;
  historyChars: number;
  toolMessages: number;
  totalChars: number;
  approxTokens: number;
  stage: string;
  receivedMessages?: number;
  filteredMessages?: number;
  usedMessages?: number;
  droppedMessages?: number;
}

export type AgentEvent =
  | { type: 'tool_start'; tool: { id: string; name: string; arguments: Record<string, unknown> } }
  | { type: 'approval_required'; id: string; approvalId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'tool_output'; id: string; jobId?: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'terminal_exit'; id: string; jobId: string; command: string; status: TerminalJob['status']; exitCode: number | null; signal: string | null; stdout?: string; stderr?: string }
  | { type: 'context'; stats: ContextStats }
  | { type: 'assistant'; content: string }
  | { type: 'error'; message: string };
