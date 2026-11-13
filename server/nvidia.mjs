import fs from 'node:fs/promises';
import { FileSystemError } from './filesystem.mjs';
import { getUploadRecord, readUploadText } from './uploads.mjs';

const API_ROOT = 'https://integrate.api.nvidia.com/v1';
const STANDARD_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const VISION_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const CHECK_TTL_MS = 60_000;
const MAX_INLINE_TEXT_TOTAL = 48_000;
const MAX_INLINE_TEXT_PER_FILE = 12_000;
const MAX_VISION_IMAGES = 50;
const MAX_LOCAL_IMAGE_BYTES = 32 * 1024 * 1024;

let credentialCheck = { checkedAt: 0, valid: false, error: 'The AI connection has not been checked.' };
let credentialCheckPending = null;

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
      const response = await fetch(`${API_ROOT}/models`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        credentialCheck = { checkedAt: Date.now(), valid: false, error: response.status === 401 || response.status === 403
          ? 'The AI credential was rejected. Check the server credential settings.'
          : 'The AI service could not be checked. Try again in a moment.' };
        return credentialCheck;
      }
      const catalog = await response.json().catch(() => ({}));
      const available = new Set(Array.isArray(catalog?.data) ? catalog.data.map((item) => item?.id).filter((item) => typeof item === 'string') : []);
      if (!available.has(STANDARD_MODEL) || !available.has(VISION_MODEL)) {
        credentialCheck = { checkedAt: Date.now(), valid: false, error: 'The AI service is missing a required capability. Check the server model access settings.' };
        return credentialCheck;
      }
      credentialCheck = { checkedAt: Date.now(), valid: true, error: null };
      return credentialCheck;
    } catch {
      credentialCheck = { checkedAt: Date.now(), valid: false, error: 'The AI service could not be reached. Check the connection and try again.' };
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
    const text = textParts.filter(Boolean).join('\n\n');
    prepared.push({ role: item.role, content: contentParts.length ? [{ type: 'text', text }, ...contentParts] : text });
  }
  return prepared;
}

export async function nvidiaChatCompletion(history, { vision = false, imageOrigin = '' } = {}, tools) {
  const credential = await validateNvidiaCredential();
  if (!credential.valid) throw new FileSystemError(credential.error || 'The AI service is unavailable.', 503);
  const messages = await makeProviderMessages(history, { vision, imageOrigin });
  const payload = {
    model: vision ? VISION_MODEL : STANDARD_MODEL,
    messages,
    tools,
    tool_choice: 'auto',
    max_tokens: 8192,
  };
  const response = await fetch(`${API_ROOT}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA.trim()}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) {
    if (response.status === 401 || response.status === 403) {
      credentialCheck = { checkedAt: Date.now(), valid: false, error: 'The AI credential was rejected. Check the NVIDIA secret in the server settings.' };
    }
    throw new Error(response.status === 413 ? 'The attachments are too large for one AI request. Send fewer files or smaller images.' : `The AI service returned an error (HTTP ${response.status || 502}). Check the attachment and server settings, then try again.`);
  }
  return result;
}
