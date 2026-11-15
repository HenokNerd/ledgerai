// Shared constants

// ============================================
// Message Limits
// ============================================

export const MESSAGE_MAX_LENGTH = 4096;
export const MESSAGE_MEDIA_MAX_SIZE = 50 * 1024 * 1024; // 50MB
export const CHANNEL_POST_MAX_LENGTH = 4096;

// ============================================
// Pagination
// ============================================

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
export const CHAT_LIST_LIMIT = 50;
export const MESSAGE_LIST_LIMIT = 50;
export const USER_SEARCH_LIMIT = 20;
export const GROUP_INVITE_MAX = 100;

// ============================================
// Group Limits
// ============================================

export const GROUP_MAX_MEMBERS = 200000;
export const GROUP_INITIAL_MAX_MEMBERS = 200;
export const GROUP_NAME_MAX_LENGTH = 128;
export const GROUP_DESCRIPTION_MAX_LENGTH = 512;

// ============================================
// Channel Limits
// ============================================

export const CHANNEL_USERNAME_MIN_LENGTH = 3;
export const CHANNEL_USERNAME_MAX_LENGTH = 32;
export const CHANNEL_TITLE_MAX_LENGTH = 128;
export const CHANNEL_DESCRIPTION_MAX_LENGTH = 512;

// ============================================
// Admin Action Durations (minutes)
// ============================================

export const MIN_MUTE_DURATION = 1;
export const MAX_MUTE_DURATION = 525600; // 1 year
export const MIN_BAN_DURATION = 1;
export const MAX_BAN_DURATION = 525600; // 1 year
export const DEFAULT_MUTE_DURATION = 60; // 1 hour
export const DEFAULT_BAN_DURATION = 1440; // 24 hours

// ============================================
// Presence
// ============================================

export const PRESENCE_HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const PRESENCE_TIMEOUT = 90000; // 90 seconds (3 missed heartbeats)
export const TYPING_INDICATOR_TIMEOUT = 5000; // 5 seconds

// ============================================
// OTP
// ============================================

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_RATE_LIMIT_WINDOW = 60000; // 1 minute
export const OTP_RATE_LIMIT_MAX = 3;

// ============================================
// Session
// ============================================

export const ACCESS_TOKEN_EXPIRY = "15m";
export const REFRESH_TOKEN_EXPIRY = "7d";
export const REFRESH_TOKEN_ROTATION_WINDOW = 5 * 60 * 1000; // 5 minutes

// ============================================
// File Upload
// ============================================

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/ogg", "audio/wav", "audio/mp4"];
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

// ============================================
// Emoji
// ============================================

export const EMOJI_CATEGORIES = [
  "smileys",
  "people",
  "animals",
  "food",
  "travel",
  "activities",
  "objects",
  "symbols",
  "flags",
] as const;

export const CURATED_CHANNEL_EMOJIS = [
  "👍",
  "👎",
  "❤️",
  "🔥",
  "😁",
  "😂",
  "😢",
  "😮",
  "😡",
  "🤔",
  "👏",
  "🙏",
  "🎉",
  "💯",
  "🤝",
  "💪",
  "🧠",
  "👀",
  "💩",
  "🤷",
] as const;

export const RECENT_EMOJIS_MAX = 50;
export const EMOJI_SEARCH_DEBOUNCE = 150;

// ============================================
// Socket.io Namespaces
// ============================================

export const SOCKET_NAMESPACES = {
  CHAT: "/chat",
  PRESENCE: "/presence",
  NOTIFICATIONS: "/notifications",
} as const;

// ============================================
// Redis Keys
// ============================================

export const REDIS_KEYS = {
  PRESENCE: (userId: string) => `presence:${userId}`,
  TYPING: (chatId: string, userId: string) => `typing:${chatId}:${userId}`,
  ONLINE_USERS: "online:users",
  SESSION: (token: string) => `session:${token}`,
  RATE_LIMIT: (key: string) => `ratelimit:${key}`,
} as const;

// ============================================
// Database
// ============================================

export const SOFT_DELETE_FIELD = "deletedAt";

// ============================================
// Error Codes
// ============================================

export const ERROR_CODES = {
  // Auth
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  ACCOUNT_ALREADY_EXISTS: "ACCOUNT_ALREADY_EXISTS",
  OTP_INVALID: "OTP_INVALID",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_RATE_LIMITED: "OTP_RATE_LIMITED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",

  // User
  USER_NOT_FOUND: "USER_NOT_FOUND",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  USERNAME_INVALID: "USERNAME_INVALID",
  PHONE_TAKEN: "PHONE_TAKEN",

  // Chat
  CHAT_NOT_FOUND: "CHAT_NOT_FOUND",
  CHAT_ACCESS_DENIED: "CHAT_ACCESS_DENIED",
  CANNOT_MESSAGE_SELF: "CANNOT_MESSAGE_SELF",
  ALREADY_IN_CHAT: "ALREADY_IN_CHAT",

  // Message
  MESSAGE_NOT_FOUND: "MESSAGE_NOT_FOUND",
  MESSAGE_TOO_LONG: "MESSAGE_TOO_LONG",
  MESSAGE_EDIT_WINDOW_EXPIRED: "MESSAGE_EDIT_WINDOW_EXPIRED",
  CANNOT_EDIT_DELETED: "CANNOT_EDIT_DELETED",

  // Group
  GROUP_NOT_FOUND: "GROUP_NOT_FOUND",
  GROUP_FULL: "GROUP_FULL",
  NOT_GROUP_MEMBER: "NOT_GROUP_MEMBER",
  ALREADY_GROUP_MEMBER: "ALREADY_GROUP_MEMBER",
  INVITE_PENDING: "INVITE_PENDING",
  INVITE_EXPIRED: "INVITE_EXPIRED",
  CANNOT_LEAVE_OWNER: "CANNOT_LEAVE_OWNER",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  MEMBER_BANNED: "MEMBER_BANNED",
  MEMBER_MUTED: "MEMBER_MUTED",

  // Channel
  CHANNEL_NOT_FOUND: "CHANNEL_NOT_FOUND",
  CHANNEL_USERNAME_TAKEN: "CHANNEL_USERNAME_TAKEN",
  NOT_CHANNEL_MEMBER: "NOT_CHANNEL_MEMBER",
  ONLY_ADMINS_CAN_POST: "ONLY_ADMINS_CAN_POST",
  POST_NOT_FOUND: "POST_NOT_FOUND",

  // Admin
  ADMIN_ACTION_DENIED: "ADMIN_ACTION_DENIED",
  CANNOT_ACTION_OWNER: "CANNOT_ACTION_OWNER",
  CANNOT_ACTION_ADMIN: "CANNOT_ACTION_ADMIN",
  ACTION_EXPIRED: "ACTION_EXPIRED",
  USER_ALREADY_BANNED: "USER_ALREADY_BANNED",
  USER_ALREADY_MUTED: "USER_ALREADY_MUTED",

  // Contact
  CONTACT_NOT_FOUND: "CONTACT_NOT_FOUND",
  ALREADY_CONTACT: "ALREADY_CONTACT",
  CANNOT_ADD_SELF: "CANNOT_ADD_SELF",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_INPUT: "INVALID_INPUT",

  // Rate Limit
  RATE_LIMITED: "RATE_LIMITED",

  // Server
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ============================================
// HTTP Status Codes
// ============================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;