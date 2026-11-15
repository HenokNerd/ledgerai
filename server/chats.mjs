import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileSystemError, PROJECTS_ROOT } from './filesystem.mjs';

export const CHATS_ROOT = path.resolve(path.dirname(PROJECTS_ROOT), 'Chats');

const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGES = 500;
const MAX_TITLE_CHARS = 80;
const MAX_CONTENT_CHARS = 200_000;
const MAX_ATTACHMENTS = 50;
const MAX_TOOLS = 50;
const MAX_ARGUMENT_CHARS = 8_000;
const MAX_RESULT_CHARS = 24_000;
const TOOL_STATUSES = new Set(['running', 'approval', 'success', 'error']);

// Keep this list in sync with client/src/components/ChatIcon.tsx.
export const CHAT_ICONS = new Set([
  'Code2', 'Bug', 'Rocket', 'Database', 'Palette', 'Cloud', 'Shield', 'Cpu', 'Globe', 'Terminal',
  'Wrench', 'BookOpen', 'BarChart3', 'Bot', 'Brain', 'Camera', 'Compass', 'CreditCard', 'FileCode2',
  'FlaskConical', 'Gamepad2', 'GitBranch', 'HeartPulse', 'KeyRound', 'Layers', 'LayoutDashboard',
  'Lightbulb', 'Mail', 'MapPin', 'Music', 'Network', 'Package', 'PenTool', 'Puzzle', 'Search',
  'Server', 'Settings', 'Smartphone', 'Sparkles', 'TestTube2', 'Timer', 'Trophy', 'Truck', 'User',
  'Video', 'Wallet', 'Wand2', 'Webhook', 'Wifi', 'Workflow', 'Zap', 'Calendar', 'Coffee', 'Leaf',
  'GraduationCap', 'DollarSign', 'ShoppingCart', 'House', 'Plane', 'Microscope', 'Atom', 'Bookmark',
  'Briefcase', 'Building2', 'PieChart', 'Clapperboard', 'Dna', 'Earth', 'Fingerprint', 'Gauge',
  'Handshake', 'Headphones', 'Lock', 'Megaphone', 'Monitor', 'Paintbrush', 'Presentation', 'Scale',
  'ShieldCheck', 'Store', 'Target', 'TrendingUp', 'Users', 'MessageSquareText',
]);

const DEFAULT_ICON = 'MessageSquareText';

function assertSafeChatsRoot() {
  try {
    const info = fsSync.lstatSync(CHATS_ROOT);
    if (!info.isDirectory() || info.isSymbolicLink() || fsSync.realpathSync(CHATS_ROOT) !== CHATS_ROOT) {
      throw new FileSystemError('The Chats/ store must be a real directory, not a symlink.', 403);
    }
  } catch (error) {
    if (error instanceof FileSystemError) throw error;
    throw new FileSystemError('The Chats/ store could not be verified.', 500);
  }
}

export async function ensureChatsRoot() {
  try {
    await fs.mkdir(CHATS_ROOT, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  assertSafeChatsRoot();
  await fs.chmod(CHATS_ROOT, 0o700);
  assertSafeChatsRoot();
}

function validateChatId(id) {
  if (typeof id !== 'string' || !CHAT_ID_PATTERN.test(id)) {
    throw new FileSystemError('That conversation id is not valid.', 400);
  }
  return id.toLowerCase();
}

function chatFile(id) {
  assertSafeChatsRoot();
  const file = path.resolve(CHATS_ROOT, `${validateChatId(id)}.json`);
  if (!file.startsWith(`${CHATS_ROOT}${path.sep}`)) {
    throw new FileSystemError('Conversation path is outside the workspace.', 403);
  }
  return file;
}

function cleanString(value, maxChars) {
  return typeof value === 'string' ? value.slice(0, maxChars) : '';
}

export function sanitizeChatTitle(value, fallback = 'New chat') {
  const title = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^["'`#*\s]+|["'`*\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return title || fallback;
}

export function sanitizeChatIcon(value) {
  return typeof value === 'string' && CHAT_ICONS.has(value) ? value : DEFAULT_ICON;
}

export function fallbackChatMeta(text) {
  const words = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^\p{L}\p{N}\s'+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 5);
  const title = words.length
    ? words.map((word) => word.length > 2 ? `${word[0].toUpperCase()}${word.slice(1)}` : word).join(' ')
    : 'New chat';
  let hash = 0;
  for (const character of String(text ?? '')) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  const icons = [...CHAT_ICONS];
  return { title: sanitizeChatTitle(title), icon: icons[hash % icons.length] };
}

function sanitizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ATTACHMENTS).flatMap((attachment) => {
    if (!attachment || typeof attachment !== 'object' || typeof attachment.id !== 'string') return [];
    return [{
      id: cleanString(attachment.id, 120),
      name: cleanString(attachment.name, 255),
      mimeType: cleanString(attachment.mimeType, 120),
      imageMimeType: typeof attachment.imageMimeType === 'string' ? cleanString(attachment.imageMimeType, 120) : null,
      size: Number.isFinite(attachment.size) ? Math.max(0, Math.round(attachment.size)) : 0,
      createdAt: cleanString(attachment.createdAt, 40),
      previewUrl: typeof attachment.previewUrl === 'string' ? cleanString(attachment.previewUrl, 500) : null,
    }];
  });
}

function sanitizeTools(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TOOLS).flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || typeof tool.id !== 'string') return [];
    let args = tool.arguments && typeof tool.arguments === 'object' ? tool.arguments : {};
    try { if (JSON.stringify(args).length > MAX_ARGUMENT_CHARS) args = { note: 'Arguments shortened.' }; } catch { args = {}; }
    let result = tool.result;
    try {
      const encoded = JSON.stringify(result);
      if (encoded === undefined) result = undefined;
      else if (encoded.length > MAX_RESULT_CHARS) result = { note: 'Result shortened for storage.', preview: encoded.slice(0, 2_000) };
    } catch { result = undefined; }
    const output = tool.output && typeof tool.output === 'object'
      ? {
        stdout: cleanString(tool.output.stdout, 8_000),
        stderr: cleanString(tool.output.stderr, 4_000),
      }
      : undefined;
    return [{
      id: cleanString(tool.id, 200),
      name: cleanString(tool.name, 120),
      arguments: args,
      status: TOOL_STATUSES.has(tool.status) ? tool.status : 'success',
      ...(typeof tool.approvalId === 'string' ? { approvalId: cleanString(tool.approvalId, 120) } : {}),
      ...(result === undefined ? {} : { result }),
      ...(typeof tool.error === 'string' ? { error: cleanString(tool.error, 4_000) } : {}),
      ...(output && (output.stdout || output.stderr) ? { output } : {}),
    }];
  });
}

function sanitizeMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (typeof key !== 'string' || !key) continue;
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      out[key] = typeof item === 'string' ? item.slice(0, 4_000) : item;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_MESSAGES).flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') return [];
    const attachments = sanitizeAttachments(message.attachments);
    const tools = sanitizeTools(message.tools);
    const meta = sanitizeMeta(message.meta);
    return [{
      id: cleanString(message.id, 120) || randomUUID(),
      role: message.role,
      content: cleanString(message.content, MAX_CONTENT_CHARS),
      ...(attachments.length ? { attachments } : {}),
      ...(tools.length ? { tools } : {}),
      ...(meta ? { meta } : {}),
      ...(message.hidden === true ? { hidden: true } : {}),
    }];
  });
}

function sanitizeProjectId(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, 120);
}

function toSummary(record) {
  return {
    id: record.id,
    slug: record.slug || null,
    title: record.title,
    icon: record.icon,
    projectId: record.projectId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: Array.isArray(record.messages) ? record.messages.length : 0,
  };
}

async function writeChat(record) {
  const file = chatFile(record.id);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
}

export async function listChats() {
  assertSafeChatsRoot();
  const entries = await fs.readdir(CHATS_ROOT, { withFileTypes: true });
  const records = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => {
      try {
        const raw = await fs.readFile(path.join(CHATS_ROOT, entry.name), 'utf8');
        const record = JSON.parse(raw);
        if (!record || typeof record.id !== 'string') return null;
        return toSummary(record);
      } catch {
        return null;
      }
    }));
  return records
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getChat(id, { limit = 50, before } = {}) {
  try {
    const raw = await fs.readFile(chatFile(id), 'utf8');
    const record = JSON.parse(raw);
    let messages = sanitizeMessages(record.messages);
    if (before) {
      const beforeIndex = messages.findIndex((m) => m.id === before);
      if (beforeIndex !== -1) {
        messages = messages.slice(0, beforeIndex);
      }
    }
    const window = messages.slice(-limit);
    const hasMore = messages.length > limit;
    return {
      ...record,
      messages: window,
      _pagination: { limit, hasMore, total: messages.length, before },
    };
  } catch (error) {
    if (error instanceof FileSystemError) throw error;
    if (error?.code === 'ENOENT') throw new FileSystemError('Conversation not found.', 404);
    throw new FileSystemError('The conversation could not be read.', 500);
  }
}

export async function getChatIdBySlug(slug) {
  assertSafeChatsRoot();
  const entries = await fs.readdir(CHATS_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(CHATS_ROOT, entry.name), 'utf8');
      const record = JSON.parse(raw);
      if (record && record.slug === slug) return record.id;
    } catch { /* skip unreadable files */ }
  }
  throw new FileSystemError('Conversation not found.', 404);
}

export async function createChat({ title, icon, projectId } = {}) {
  const now = new Date().toISOString();
  const slug = randomUUID().replaceAll('-', '').slice(0, 22);
  const record = {
    id: randomUUID(),
    slug,
    title: sanitizeChatTitle(title),
    icon: sanitizeChatIcon(icon),
    projectId: sanitizeProjectId(projectId),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await writeChat(record);
  return { ...toSummary(record), messages: record.messages };
}

export async function saveChat(id, updates = {}) {
  const existing = await getChat(id);
  const record = {
    ...existing,
    ...(updates.title !== undefined ? { title: sanitizeChatTitle(updates.title, existing.title) } : {}),
    ...(updates.icon !== undefined ? { icon: sanitizeChatIcon(updates.icon) } : {}),
    ...(updates.projectId !== undefined ? { projectId: sanitizeProjectId(updates.projectId) } : {}),
    ...(updates.messages !== undefined ? { messages: sanitizeMessages(updates.messages) } : {}),
    updatedAt: new Date().toISOString(),
  };
  await writeChat(record);
  return { ...toSummary(record), messages: record.messages };
}

export async function deleteChat(id) {
  const file = chatFile(id);
  try {
    await fs.unlink(file);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new FileSystemError('Conversation not found.', 404);
    throw error;
  }
  return { deleted: true, id: validateChatId(id) };
}
