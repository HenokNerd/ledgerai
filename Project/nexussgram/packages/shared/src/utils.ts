// Shared utilities

import { formatDistanceToNow, format, isToday, isYesterday, parseISO } from "date-fns";
import { toZonedTime, format as formatTz } from "date-fns-tz";

// ============================================
// Date & Time Formatting
// ============================================

/**
 * Format a date to human-readable relative time (e.g., "2 min ago", "1 hour ago", "yesterday", "3 days ago")
 * This is the primary function for presence/last seen display
 */
export function formatRelativeTime(date: Date | string, options?: { addSuffix?: boolean }): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  const now = new Date();

  // If today, use relative time
  if (isToday(d)) {
    return formatDistanceToNow(d, { addSuffix: true, ...options });
  }

  // If yesterday, show "yesterday at HH:MM"
  if (isYesterday(d)) {
    return `yesterday at ${format(d, "HH:mm")}`;
  }

  // If within this week, show day name
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return format(d, "EEEE at HH:mm"); // e.g., "Monday at 14:30"
  }

  // Otherwise show date
  return format(d, "MMM d, yyyy 'at' HH:mm"); // e.g., "Jan 15, 2024 at 14:30"
}

/**
 * Format last seen for presence display
 * Returns: "online", "2 min ago", "1 hour ago", "yesterday", "Jan 15"
 */
export function formatLastSeen(date: Date | string | null, options?: { timezone?: string }): string {
  if (!date) return "never";

  const d = typeof date === "string" ? parseISO(date) : date;
  const now = new Date();

  // Online if within 30 seconds
  if (now.getTime() - d.getTime() < 30000) {
    return "online";
  }

  // If today, use relative
  if (isToday(d)) {
    return formatDistanceToNow(d, { addSuffix: true });
  }

  // Yesterday
  if (isYesterday(d)) {
    return "yesterday";
  }

  // Within a week - day name
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return format(d, "EEEE"); // "Monday"
  }

  // Older - short date
  return format(d, "MMM d"); // "Jan 15"
}

/**
 * Format time for message display (HH:mm)
 */
export function formatMessageTime(date: Date | string, timezone?: string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (timezone) {
    const zoned = toZonedTime(d, timezone);
    return formatTz(zoned, "HH:mm", { timeZone: timezone });
  }
  return format(d, "HH:mm");
}

/**
 * Format date for message grouping (e.g., "Today", "Yesterday", "Monday", "Jan 15")
 */
export function formatMessageDate(date: Date | string, timezone?: string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  const now = new Date();

  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";

  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return format(d, "EEEE"); // "Monday"
  }

  return format(d, "MMM d, yyyy"); // "Jan 15, 2024"
}

/**
 * Full timestamp for message info
 */
export function formatFullTimestamp(date: Date | string, timezone?: string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (timezone) {
    const zoned = toZonedTime(d, timezone);
    return formatTz(zoned, "MMMM d, yyyy 'at' HH:mm:ss (z)", { timeZone: timezone });
  }
  return format(d, "MMMM d, yyyy 'at' HH:mm:ss");
}

// ============================================
// String Utilities
// ============================================

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

/**
 * Generate a random string for temp IDs, invite codes, etc.
 */
export function generateId(length = 12): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate UUID v4
 */
export function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Sanitize username - remove @ prefix if present
 */
export function sanitizeUsername(username: string): string {
  return username.replace(/^@/, "").toLowerCase();
}

/**
 * Format username for display (with @)
 */
export function formatUsername(username: string | null): string {
  if (!username) return "";
  return `@${username}`;
}

/**
 * Get initials from display name for avatar fallback
 */
export function getInitials(name: string, max = 2): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, max)
    .join("")
    .toUpperCase();
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Parse mentions from text (@username)
 */
export function extractMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z][a-zA-Z0-9_]{2,31})/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

/**
 * Parse hashtags from text
 */
export function extractHashtags(text: string): string[] {
  const hashtagRegex = /#([a-zA-Z0-9_]{2,64})/g;
  const hashtags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hashtagRegex.exec(text)) !== null) {
    hashtags.push(match[1]);
  }
  return hashtags;
}

// ============================================
// Validation Utilities
// ============================================

/**
 * Validate E.164 phone number format
 */
export function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

/**
 * Validate username format
 */
export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(username);
}

/**
 * Normalize phone to E.164 (basic - assumes input is already close)
 */
export function normalizePhone(phone: string): string {
  // Remove all non-digits except leading +
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  return `+${cleaned}`;
}

// ============================================
// Array/Object Utilities
// ============================================

/**
 * Remove duplicates from array by key
 */
export function uniqueBy<T>(array: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return array.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Group array by key
 */
export function groupBy<T>(array: T[], key: (item: T) => string): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const k = key(item);
    (groups[k] = groups[k] || []).push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Deep merge objects
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key as keyof T];
    const targetValue = target[key as keyof T];
    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}

// ============================================
// Async Utilities
// ============================================

/**
 * Sleep for ms
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelay?: number; maxDelay?: number; shouldRetry?: (error: unknown) => boolean } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, maxDelay = 10000, shouldRetry = () => true } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// ============================================
// Color Utilities (for avatar backgrounds)
// ============================================

const AVATAR_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#FFD93D", // Yellow
  "#6BCB77", // Green
  "#4D96FF", // Blue
  "#FF6B9D", // Pink
  "#A855F7", // Purple
  "#F97316", // Orange
  "#06B6D4", // Cyan
  "#84CC16", // Lime
];

/**
 * Get consistent color for a string (e.g., user ID or name)
 */
export function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ============================================
// File Size Formatting
// ============================================

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ============================================
// Number Formatting
// ============================================

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

// ============================================
// Environment
// ============================================

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isTest(): boolean {
  return process.env.NODE_ENV === "test";
}
