import fs from 'node:fs/promises';
import { FileSystemError } from './filesystem.mjs';
import { getUploadRecord, readUploadText } from './uploads.mjs';
import { CHAT_ICONS, fallbackChatMeta, sanitizeChatIcon, sanitizeChatTitle } from './chats.mjs';

const API_ROOT = 'https://integrate.api.nvidia.com/v1';
const STANDARD_MODEL = process.env.LEDGER_STANDARD_MODEL?.trim() || 'nvidia/nemotron-3-ultra-550b-a55b';
const VISION_MODEL = process.env.LEDGER_VISION_MODEL?.trim() || 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const FALLBACK_MODEL = process.env.LEDGER_FALLBACK_MODEL?.trim() || '';
const CHECK_TTL_MS = 60_000;
const MAX_INLINE_TEXT_TOTAL = 48_000;
const MAX_INLINE_TEXT_PER_FILE = 12_000;
const MAX_VISION_IMAGES = 50;
const MAX_LOCAL_IMAGE_BYTES = 32 * 1024 * 1024;

const COMPLETION_MAX_ATTEMPTS = 12;
const COMPLETION_BASE_DELAY_MS = 750;
const COMPLETION_MAX_DELAY_MS = 30_000;

let credentialCheck = { checkedAt: 0, valid: false, error: 'The AI connection has not been checked.' };
let credentialCheckPending = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function completionDelay(response, attempt) {
  const retryAfterHeader = response?.headers?.get('retry-after');
  const retryAfter = retryAfterHeader == null ? NaN : Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(Math.max(retryAfter * 1000, 1_000), 60_000);
  const base = response?.status === 429 ? 2_000 : COMPLETION_BASE_DELAY_MS;
  return Math.min(base * (2 ** Math.max(0, attempt - 1)), COMPLETION_MAX_DELAY_MS) + Math.floor(Math.random() * 400);
}

async function fetchJsonWithStatus(url, options, timeoutMs) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs || 30_000) });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, headers: response.headers, payload };
  } catch (error) {
    return { ok: false, status: 0, headers: null, payload: {}, error };
  }
}

async function fetchWithRetry(url, options, label, attempts = 5) {
  const { timeoutMs, ...requestOptions } = options;
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await fetchJsonWithStatus(url, requestOptions, timeoutMs);
    if (last.ok) return { ok: true, status: last.status, headers: last.headers, payload: last.payload, json: async () => last.payload };
    if (!isRetryableStatus(last.status) || attempt === attempts) return { ok: false, status: last.status, headers: last.headers, payload: last.payload, json: async () => last.payload };
    console.warn(`[ledger-agent] ${label} returned HTTP ${last.status || 'network error'}; retrying (${attempt}/${attempts - 1})`);
    await sleep(completionDelay({ headers: last.headers, status: last.status }, attempt));
  }
  return { ok: false, status: last?.status || 0, headers: last?.headers || null, payload: last?.payload || {}, json: async () => last?.payload || {} };
}

export async function validateNvidiaCredential({ force = false } = {}) {
  const now = Date.now();
  if (!force && credentialCheck.checkedAt && now - credentialCheck.checkedAt < CHECK_TTL_MS) return credentialCheck;
  if (credentialCheckPending) return credentialCheckPending;

  credentialCheckPending = Promise.resolve().then(async () => {
    try {
      const token = process.env.NVIDIA?.trim();
      if (!token) {
        credentialCheck = { checkedAt: Date.now(), valid: false, error: 'The AI credential is missing. Check the server credential settings.' };
        return credentialCheck;
      }
      const response = await fetchWithRetry(`${API_ROOT}/models`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        timeoutMs: 15_000,
      }, 'credential check');
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          credentialCheck = { checkedAt: Date.now(), valid: false, error: 'The AI credential was rejected. Check the server credential settings.' };
          return credentialCheck;
        }
        // Keep AI available when the credential is present but the catalog check
        // is temporarily unreachable; chat requests retry and report real errors.
        credentialCheck = { checkedAt: Date.now(), valid: true, error: null, degraded: response.status || 'unreachable' };
        return credentialCheck;
      }
      const catalog = await response.json().catch(() => ({}));
      const available = new Set(Array.isArray(catalog?.data) ? catalog.data.map((item) => item?.id).filter((item) => typeof item === 'string') : []);
      if (available.size > 0 && (!available.has(STANDARD_MODEL) || !available.has(VISION_MODEL))) {
        credentialCheck = { checkedAt: Date.now(), valid: false, error: 'The AI service is missing a required capability. Check the server model access settings.' };
        return credentialCheck;
      }
      credentialCheck = { checkedAt: Date.now(), valid: true, error: null };
      return credentialCheck;
    } catch {
      // Credential exists but the check failed locally/transiently; keep AI on.
      credentialCheck = { checkedAt: Date.now(), valid: true, error: null, degraded: 'network' };
      return credentialCheck;
    } finally {
      credentialCheckPending = null;
    }
  });
  return credentialCheckPending;
}

function trustedImageOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value) return null;
    const isProductionHost = url.hostname === 'ledgerai.wasmer.app';
    const isPreviewHost = url.hostname.startsWith('3000-') && url.hostname.endsWith('.manus.computer');
    return isProductionHost || isPreviewHost ? url.origin : null;
  } catch {
    return null;
  }
}

function imagePartFromUrl(id, origin) {
  return { type: 'image_url', image_url: { url: `${origin}/api/uploads/${encodeURIComponent(id)}/preview` } };
}

async function makeProviderMessages(history, { vision, imageOrigin }) {
  const origin = trustedImageOrigin(imageOrigin);
  const records = new Map();
  const attachmentIdsByIndex = new Map();

  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    if (item.role !== 'user' || !Array.isArray(item.attachmentIds)) continue;
    const ids = [...new Set(item.attachmentIds.filter((id) => typeof id === 'string'))].slice(0, 50);
    const available = [];
    for (const id of ids) {
      try {
        const record = await getUploadRecord(id);
        records.set(id, record);
        available.push(id);
      } catch {
        available.push({ missing: true, id });
      }
    }
    attachmentIdsByIndex.set(index, available);
  }

  const visualIds = new Set();
  if (vision) {
    let visualCount = 0;
    for (let index = history.length - 1; index >= 0 && visualCount < MAX_VISION_IMAGES; index -= 1) {
      for (const entry of [...(attachmentIdsByIndex.get(index) || [])].reverse()) {
        if (visualCount >= MAX_VISION_IMAGES) break;
        if (typeof entry !== 'string') continue;
        const record = records.get(entry);
        if (record?.metadata.imageMimeType) {
          visualIds.add(entry);
          visualCount += 1;
        }
      }
    }
  }

  let textBudget = MAX_INLINE_TEXT_TOTAL;
  let localImageBytes = 0;
  const prepared = [];
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    const textParts = [item.content];
    const contentParts = [];
    const attached = attachmentIdsByIndex.get(index) || [];
    for (const entry of attached) {
      if (typeof entry !== 'string') {
        textParts.push('[An attachment from an earlier message is no longer available.]');
        continue;
      }
      const { metadata, contentPath } = records.get(entry);
      if (vision && visualIds.has(entry) && metadata.imageMimeType) {
        if (origin) {
          contentParts.push(imagePartFromUrl(entry, origin));
        } else if (localImageBytes + metadata.size <= MAX_LOCAL_IMAGE_BYTES) {
          const encoded = (await fs.readFile(contentPath)).toString('base64');
          contentParts.push({ type: 'image_url', image_url: { url: `data:${metadata.imageMimeType};base64,${encoded}` } });
          localImageBytes += metadata.size;
        } else {
          throw new FileSystemError('Too many large images for this local connection. Open the secure hosted workspace and try again.', 413);
        }
        textParts.push(`[Image attached: ${metadata.name}]`);
        continue;
      }
      if (metadata.imageMimeType) {
        textParts.push(`[Image attached: ${metadata.name}. Visual analysis is available when Vision is enabled.]`);
        continue;
      }
      if (textBudget > 0) {
        try {
          const text = await readUploadText(entry);
          const snippet = text.content.slice(0, Math.min(MAX_INLINE_TEXT_PER_FILE, textBudget));
          textBudget -= snippet.length;
          const remainder = snippet.length < text.content.length ? '\n[Attachment text shortened; use read_attachment for more.]' : '';
          textParts.push(`Attachment: ${metadata.name}\n\n${snippet}${remainder}`);
        } catch {
          textParts.push(`[File attached: ${metadata.name} · ${metadata.size} bytes. Use read_attachment with id ${metadata.id} if it is text.]`);
        }
      } else {
        textParts.push(`[File attached: ${metadata.name} · ${metadata.size} bytes. Use read_attachment with id ${metadata.id} if it is text.]`);
      }
    }
    let text = textParts.filter(Boolean).join('\n\n');
    if (item.role === 'system' && item.meta && typeof item.meta === 'object') {
      const metaJson = JSON.stringify(item.meta);
      text = `${text}${text ? '\n\n' : ''}[system_event]\n${metaJson}`;
    }
    const providerMessage = { role: item.role, content: contentParts.length ? [{ type: 'text', text }, ...contentParts] : text };
    if (item.role === 'assistant' && Array.isArray(item.tool_calls)) providerMessage.tool_calls = item.tool_calls;
    if (item.role === 'tool' && typeof item.tool_call_id === 'string') providerMessage.tool_call_id = item.tool_call_id;
    prepared.push(providerMessage);
  }
  return prepared;
}

export async function generateConversationMeta({ text = '', projectName = '', firstPrompt = '', firstResponse = '', secondPrompt = '', currentTitle = '', currentIcon = '' } = {}) {
  const first = String(firstPrompt || text || '').replace(/\s+/g, ' ').trim().slice(0, 2_000);
  const response = String(firstResponse || '').replace(/\s+/g, ' ').trim().slice(0, 3_000);
  const second = String(secondPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 2_000);
  const subject = second ? `${first}\n${response}\n${second}` : first;
  const fallback = fallbackChatMeta(first || projectName || 'New chat');
  const keepTitle = sanitizeChatTitle(currentTitle, fallback.title);
  const keepIcon = sanitizeChatIcon(currentIcon || fallback.icon);
  if (!first) return fallback;

  const credential = await validateNvidiaCredential();
  if (!credential.valid) return fallback;

  const iconNames = [...CHAT_ICONS].join(', ');
  const isRefinement = Boolean(first && response && second);
  const instruction = isRefinement ? [
    'You name and label software-development conversations.',
    'The first user message may have been vague (for example "hi"). You are given the first prompt, the assistant’s first response, and the user’s second prompt. Use all three to determine the real topic.',
    'Produce:',
    '1. "title": a specific 2-6 word title in Title Case capturing the concrete subject. No quotes, no trailing punctuation, do not end with a preposition or article, and no generic words like "Chat", "Request", "Greeting", or "Hello".',
    '2. "icon": exactly one icon name from the allowed list that best represents the topic.',
    `Current title: "${keepTitle}". Current icon: "${keepIcon}". Rename the title and/or icon if they are generic, vague, or no longer accurate; otherwise keep the most accurate specific values.`,
    `Allowed icons: ${iconNames}.`,
    'Reply with only a JSON object: {"title":"…","icon":"…"}',
  ].join('\n') : [
    'You name and label software-development conversations.',
    'Given the first message of a conversation, produce:',
    '1. "title": a specific 2-6 word title in Title Case that captures the concrete subject (for example "Fix Postgres Pool Leak", "Design Landing Hero", "Audit Auth Middleware"). No quotes, no trailing punctuation, do not end with a preposition or article, and no generic words like "Chat" or "Request".',
    '2. "icon": exactly one icon name from the allowed list that best and most distinctively represents this specific task. Avoid repeating a generic chat/message icon; pick the icon that makes this conversation recognizable at a glance and likely differs from conversations about other topics.',
    `Allowed icons: ${iconNames}.`,
    'Reply with only a JSON object: {"title":"…","icon":"…"}',
  ].join('\n');

  const userContent = isRefinement
    ? `${projectName ? `Project: ${projectName}\n` : ''}First prompt:\n${first}\n\nAssistant first response:\n${response}\n\nUser second prompt:\n${second}`
    : `${projectName ? `Project: ${projectName}\n` : ''}First message:\n${subject}`;

  const failed = { title: keepTitle || fallback.title, icon: keepIcon || fallback.icon };
  try {
    const { ok, payload } = await fetchWithRetry(`${API_ROOT}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA.trim()}` },
      body: JSON.stringify({
        model: STANDARD_MODEL,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: userContent },
        ],
        max_tokens: 512,
        temperature: 0.3,
      }),
      timeoutMs: 45_000,
    }, 'conversation title');
    if (!ok) return isRefinement ? failed : fallback;
    const message = payload?.choices?.[0]?.message || {};
    let content = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content) ? message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('') : '';
    if (!content.trim() && typeof message.reasoning_content === 'string') content = message.reasoning_content;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return isRefinement ? failed : fallback;
    const parsed = JSON.parse(match[0]);
    return {
      title: sanitizeChatTitle(parsed?.title, (isRefinement ? keepTitle : '') || fallback.title),
      icon: sanitizeChatIcon(parsed?.icon || keepIcon || fallback.icon),
    };
  } catch {
    return isRefinement ? failed : fallback;
  }
}

export async function nvidiaChatCompletion(history, { vision = false, imageOrigin = '', model } = {}, tools) {
  let credential = await validateNvidiaCredential();
  if (!credential.valid) {
    credential = await validateNvidiaCredential({ force: true });
  }
  if (!credential.valid) throw new FileSystemError(credential.error || 'The AI service is unavailable.', 503);

  const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : (vision ? VISION_MODEL : STANDARD_MODEL);
  const messages = await makeProviderMessages(history, { vision, imageOrigin });
  const payload = {
    model: selectedModel,
    messages,
    tools,
    tool_choice: 'auto',
    max_tokens: 8192,
  };

  let lastStatus = 0;
  let lastProviderMessage = '';
  let authRetried = false;

  for (let attempt = 1; attempt <= COMPLETION_MAX_ATTEMPTS; attempt += 1) {
    const token = process.env.NVIDIA?.trim();
    if (!token) throw new FileSystemError('The AI credential is missing. Check the server credential settings.', 503);

    const { ok, status, headers, payload: result, error } = await fetchJsonWithStatus(`${API_ROOT}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }, 150_000);

    lastStatus = status || 0;
    lastProviderMessage = typeof result?.error?.message === 'string' ? result.error.message : '';

    if (ok && !result?.error && Array.isArray(result?.choices) && result.choices[0]?.message) {
      return result;
    }

    if (status === 401 || status === 403) {
      if (!authRetried) {
        authRetried = true;
        credentialCheck = { checkedAt: 0, valid: false, error: credentialCheck.error };
        const rechecked = await validateNvidiaCredential({ force: true });
        if (rechecked.valid) {
          console.warn(`[ledger-agent] credential refreshed after HTTP ${status}; retrying chat completion`);
          await sleep(400);
          continue;
        }
      }
      credentialCheck = { checkedAt: Date.now(), valid: false, error: 'The AI credential was rejected. Check the server credential settings.' };
      throw new Error('The AI credential was rejected. Check the server credential settings.');
    }

    if (status === 413) {
      throw new Error('The attachments are too large for one AI request. Send fewer files or smaller images.');
    }

    const retryable = Boolean(error) || status === 0 || isRetryableStatus(status) || !ok || result?.error || !result?.choices?.[0]?.message;
    if (!retryable && status >= 400 && status < 500) {
      console.error(`[ledger-agent] upstream request failed (HTTP ${status || 502})`);
      throw new Error(`The AI service returned an error (HTTP ${status || 502})${lastProviderMessage ? `: ${lastProviderMessage.slice(0, 240)}` : ''}.`);
    }

    if (attempt === COMPLETION_MAX_ATTEMPTS) break;

    const delay = completionDelay({ headers, status }, attempt);
    console.warn(`[ledger-agent] chat completion attempt ${attempt}/${COMPLETION_MAX_ATTEMPTS} failed (${status || error?.name || 'network error'}); retrying in ${delay} ms`);
    await sleep(delay);
  }

  console.error(`[ledger-agent] upstream request exhausted retries (HTTP ${lastStatus || 502})`);
  throw new Error(lastStatus === 429
    ? 'The AI service is busy right now. It kept rate-limiting requests; please try again in a moment.'
    : `The AI service could not complete this request after several attempts (HTTP ${lastStatus || 502})${lastProviderMessage ? `: ${lastProviderMessage.slice(0, 240)}` : ''}.`);
}
