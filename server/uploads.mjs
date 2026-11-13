import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { FileSystemError, PROJECTS_ROOT } from './filesystem.mjs';

export const UPLOADS_ROOT = path.resolve(path.dirname(PROJECTS_ROOT), 'Upload');
export const MAX_UPLOAD_FILES = 50;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_STORAGE_BYTES = 1024 * 1024 * 1024;
const MAX_TEXT_READ_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertSafeUploadRoot() {
  const parent = path.dirname(PROJECTS_ROOT);
  try {
    const parentInfo = fsSync.lstatSync(parent);
    const rootInfo = fsSync.lstatSync(UPLOADS_ROOT);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || fsSync.realpathSync(parent) !== parent) {
      throw new FileSystemError('The persistent upload location could not be verified.', 403);
    }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || fsSync.realpathSync(UPLOADS_ROOT) !== UPLOADS_ROOT) {
      throw new FileSystemError('The Upload/ folder must be a real directory, not a symlink.', 403);
    }
  } catch (error) {
    if (error instanceof FileSystemError) throw error;
    throw new FileSystemError('The Upload/ folder could not be verified.', 500);
  }
}

export async function ensureUploadsRoot() {
  try {
    await fs.mkdir(UPLOADS_ROOT, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  assertSafeUploadRoot();
  await fs.chmod(UPLOADS_ROOT, 0o700);
  assertSafeUploadRoot();
}

function safeUploadId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new FileSystemError('Attachment not found.', 404);
  return value.toLowerCase();
}

function safeDisplayName(value) {
  const leaf = String(value ?? '').replaceAll('\\', '/').split('/').at(-1) || 'attachment';
  const safe = leaf.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '_').trim().slice(0, 180);
  return safe && safe !== '.' && safe !== '..' ? safe : 'attachment';
}

function rasterMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function detectStorageId(file) {
  const id = file?.uploadId || path.basename(path.dirname(file?.path || ''));
  return safeUploadId(id);
}

const storage = multer.diskStorage({
  destination(_request, file, callback) {
    try {
      assertSafeUploadRoot();
      file.uploadId = randomUUID();
      const directory = path.join(UPLOADS_ROOT, file.uploadId);
      fs.mkdir(directory, { recursive: false, mode: 0o700 }).then(() => callback(null, directory), callback);
    } catch (error) {
      callback(error);
    }
  },
  filename(_request, _file, callback) {
    callback(null, 'content');
  },
});

// No file-type or extension filter is applied: all files within the explicit size/count bounds are stored.
export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: MAX_UPLOAD_FILES,
    fields: 0,
    parts: MAX_UPLOAD_FILES,
    fieldNameSize: 64,
  },
});

async function currentUsageBytes() {
  assertSafeUploadRoot();
  const entries = await fs.readdir(UPLOADS_ROOT, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID_PATTERN.test(entry.name)) continue;
    const content = path.join(UPLOADS_ROOT, entry.name, 'content');
    const info = await fs.lstat(content).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink()) total += info.size;
  }
  return total;
}

export async function finalizeUploads(files) {
  assertSafeUploadRoot();
  const batchSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (await currentUsageBytes() > MAX_UPLOAD_STORAGE_BYTES - batchSize) {
    throw new FileSystemError('The shared upload space is full. Remove older uploads before adding more.', 413);
  }

  const output = [];
  for (const file of files) {
    const id = detectStorageId(file);
    const name = safeDisplayName(file.originalname);
    const directory = path.join(UPLOADS_ROOT, id);
    const contentPath = path.join(directory, 'content');
    const info = await fs.lstat(contentPath).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) throw new FileSystemError('An uploaded file could not be verified.', 500);
    const firstBytes = await fs.open(contentPath, 'r');
    let prefix;
    try {
      prefix = Buffer.alloc(Math.min(32, info.size));
      if (prefix.length) await firstBytes.read(prefix, 0, prefix.length, 0);
    } finally {
      await firstBytes.close();
    }
    const imageMimeType = rasterMime(prefix);
    const record = {
      id,
      name,
      mimeType: String(file.mimetype || 'application/octet-stream').slice(0, 160),
      imageMimeType,
      size: info.size,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    output.push({ ...record, previewUrl: imageMimeType ? `/api/uploads/${id}/preview` : null });
  }
  return output;
}

export async function discardPartialUploads(files = []) {
  assertSafeUploadRoot();
  await Promise.all(files.map(async (file) => {
    try {
      const id = detectStorageId(file);
      await fs.rm(path.join(UPLOADS_ROOT, id), { recursive: true, force: true });
    } catch {
      // A malformed storage reference is ignored; no path from the request is followed.
    }
  }));
}

export async function getUploadRecord(value) {
  assertSafeUploadRoot();
  const id = safeUploadId(value);
  const directory = path.resolve(UPLOADS_ROOT, id);
  if (!directory.startsWith(`${UPLOADS_ROOT}${path.sep}`)) throw new FileSystemError('Attachment not found.', 404);
  const dirInfo = await fs.lstat(directory).catch(() => null);
  if (!dirInfo?.isDirectory() || dirInfo.isSymbolicLink()) throw new FileSystemError('Attachment not found.', 404);
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
  } catch {
    throw new FileSystemError('Attachment not found.', 404);
  }
  if (metadata.id !== id) throw new FileSystemError('Attachment not found.', 404);
  const contentPath = path.join(directory, 'content');
  const contentInfo = await fs.lstat(contentPath).catch(() => null);
  if (!contentInfo?.isFile() || contentInfo.isSymbolicLink()) throw new FileSystemError('Attachment not found.', 404);
  return { metadata, contentPath, directory };
}

export async function getUploadPreview(value) {
  const { metadata, contentPath } = await getUploadRecord(value);
  const prefix = await fs.open(contentPath, 'r');
  let bytes;
  try {
    bytes = Buffer.alloc(Math.min(32, metadata.size));
    if (bytes.length) await prefix.read(bytes, 0, bytes.length, 0);
  } finally {
    await prefix.close();
  }
  const imageMimeType = rasterMime(bytes);
  if (!imageMimeType) throw new FileSystemError('Preview is only available for supported image files.', 415);
  return { buffer: await fs.readFile(contentPath), mimeType: imageMimeType };
}

export async function readUploadText(value) {
  const { metadata, contentPath } = await getUploadRecord(value);
  if (metadata.size > MAX_TEXT_READ_BYTES) throw new FileSystemError('This attachment is too large to read as text (2 MB limit).', 413);
  const buffer = await fs.readFile(contentPath);
  if (buffer.includes(0)) throw new FileSystemError('This attachment is a binary file. Image content is available when Vision is enabled.');
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new FileSystemError('This attachment is not UTF-8 text and cannot be read as text.');
  }
  return { id: metadata.id, name: metadata.name, mimeType: metadata.mimeType, size: metadata.size, content, truncated: false };
}

export async function deleteUpload(value) {
  const { metadata, directory } = await getUploadRecord(value);
  await fs.rm(directory, { recursive: true, force: false });
  return { deleted: true, id: metadata.id };
}
