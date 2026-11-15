// Shared TypeScript types (non-Zod)
// These complement the Zod schemas for internal use

// ============================================
// User & Auth
// ============================================

export interface UserProfile {
  id: string;
  phone: string | null;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isPublic: boolean;
  presence: PresenceStatus;
  lastSeen: Date | null;
  createdAt: Date;
}

export type PresenceStatus = "ONLINE" | "OFFLINE" | "AWAY";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface JWTPayload {
  sub: string; // userId
  phone?: string;
  username?: string;
  iat: number;
  exp: number;
}

// ============================================
// Chat & Messages
// ============================================

export type ChatType = "PRIVATE" | "GROUP" | "CHANNEL";

export interface ChatParticipant {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  presence: PresenceStatus;
  lastSeen: Date | null;
  isPinned: boolean;
  isMuted: boolean;
  unreadCount: number;
}

export interface Chat {
  id: string;
  type: ChatType;
  name: string | null;
  avatarUrl: string | null;
  description: string | null;
  participants: ChatParticipant[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  updatedAt: Date;
}

export interface MessagePreview {
  id: string;
  content: string | null;
  type: MessageType;
  senderId: string;
  createdAt: Date;
  isDeleted: boolean;
}

export type MessageType =
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "DOCUMENT"
  | "STICKER"
  | "CONTACT"
  | "LOCATION"
  | "POLL"
  | "SERVICE";

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  receiverId: string | null;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaSize: number | null;
  replyTo: MessageReply | null;
  forwardFrom: MessageForward | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  reactions: MessageReaction[];
  readBy: MessageRead[];
}

export interface MessageReply {
  id: string;
  content: string | null;
  senderId: string;
  senderName: string;
}

export interface MessageForward {
  id: string;
  senderId: string;
  senderName: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  users: ReactionUser[];
  hasReacted: boolean;
}

export interface ReactionUser {
  id: string;
  displayName: string;
}

export interface MessageRead {
  userId: string;
  readAt: Date;
}

// ============================================
// Groups
// ============================================

export type GroupMemberRole = "OWNER" | "ADMIN" | "MEMBER";
export type GroupMemberStatus = "INVITED" | "ACCEPTED" | "LEFT" | "BANNED" | "KICKED";

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  joinedAt: Date | null;
  invitedAt: Date;
  invitedBy: string | null;
  leftAt: Date | null;
  bannedAt: Date | null;
  banExpiresAt: Date | null;
  muteExpiresAt: Date | null;
  user: UserProfile;
}

export interface Group {
  id: string;
  chatId: string;
  ownerId: string;
  name: string;
  avatarUrl: string | null;
  description: string | null;
  inviteLink: string | null;
  isPublic: boolean;
  maxMembers: number;
  memberCount: number;
  adminCount: number;
  createdAt: Date;
  updatedAt: Date;
  myRole: GroupMemberRole | null;
  myStatus: GroupMemberStatus | null;
}

// ============================================
// Channels
// ============================================

export type ChannelMemberRole = "OWNER" | "ADMIN" | "MEMBER";

export interface ChannelMember {
  id: string;
  channelId: string;
  userId: string;
  role: ChannelMemberRole;
  joinedAt: Date;
  leftAt: Date | null;
  user: Pick<UserProfile, "id" | "username" | "displayName" | "avatarUrl">;
}

export interface Channel {
  id: string;
  chatId: string;
  ownerId: string;
  username: string;
  title: string;
  description: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  memberCount: number;
  linkedGroupId: string | null;
  createdAt: Date;
  updatedAt: Date;
  myRole: ChannelMemberRole | null;
}

export interface ChannelPost {
  id: string;
  channelId: string;
  authorId: string;
  content: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  replyTo: PostReply | null;
  viewCount: number;
  forwardCount: number;
  reactions: PostReaction[];
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
  author: Pick<UserProfile, "id" | "username" | "displayName" | "avatarUrl">;
}

export interface PostReply {
  id: string;
  content: string | null;
  authorId: string;
  authorName: string;
}

export interface PostReaction {
  emoji: string;
  count: number;
  hasReacted: boolean;
}

// ============================================
// Admin
// ============================================

export type AdminActionType =
  | "MUTE"
  | "UNMUTE"
  | "BAN"
  | "UNBAN"
  | "WARN"
  | "PROMOTE"
  | "DEMOTE"
  | "REMOVE"
  | "DELETE_MESSAGE";

export interface AdminAction {
  id: string;
  actorId: string;
  targetId: string;
  groupId: string | null;
  channelId: string | null;
  action: AdminActionType;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  actor: Pick<UserProfile, "id" | "displayName">;
  target: Pick<UserProfile, "id" | "displayName">;
}

// ============================================
// Contacts
// ============================================

export interface Contact {
  id: string;
  targetId: string;
  name: string | null;
  isSaved: boolean;
  createdAt: Date;
  user: UserProfile;
}

// ============================================
// Emoji
// ============================================

export interface Emoji {
  emoji: string;
  name: string;
  category: string;
  keywords: string[];
  skinTones: string[] | null;
  version: string;
}

export interface EmojiCategory {
  name: string;
  emojis: Emoji[];
}

export interface EmojiPack {
  id: string;
  name: string;
  version: string;
  categories: EmojiCategory[];
  isDefault: boolean;
}

// ============================================
// Real-time Events
// ============================================

export interface SocketEvents {
  // Connection
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: Error) => void;

  // Auth
  auth: (data: { token: string }) => void;
  authenticated: (data: { userId: string }) => void;
  auth_error: (error: { message: string }) => void;

  // Chat
  "chat:join": (data: { chatId: string }) => void;
  "chat:leave": (data: { chatId: string }) => void;
  "chat:message": (data: { message: Message; tempId?: string }) => void;
  "chat:message_ack": (data: { tempId: string; messageId: string }) => void;
  "chat:message_update": (data: { messageId: string; content: string; isEdited: boolean }) => void;
  "chat:message_delete": (data: { messageId: string; chatId: string }) => void;
  "chat:typing_start": (data: { chatId: string; userId: string }) => void;
  "chat:typing_stop": (data: { chatId: string; userId: string }) => void;
  "chat:read": (data: { chatId: string; messageId: string; userId: string }) => void;
  "chat:reaction_add": (data: { messageId: string; userId: string; emoji: string }) => void;
  "chat:reaction_remove": (data: { messageId: string; userId: string; emoji: string }) => void;

  // Presence
  "presence:update": (data: { userId: string; presence: PresenceStatus; lastSeen: Date | null }) => void;
  "presence:subscribe": (userIds: string[]) => void;
  "presence:unsubscribe": (userIds: string[]) => void;

  // Groups
  "group:member_update": (data: { groupId: string; userId: string; role?: GroupMemberRole; status?: GroupMemberStatus }) => void;
  "group:invite": (data: { groupId: string; inviterId: string; invitees: string[] }) => void;

  // Channels
  "channel:post": (data: { post: ChannelPost }) => void;
  "channel:reaction": (data: { postId: string; userId: string; emoji: string }) => void;

  // Notifications
  "notification:new": (data: NotificationPayload) => void;
}

export interface NotificationPayload {
  id: string;
  type: "message" | "group_invite" | "mention" | "reaction" | "admin_action";
  title: string;
  body: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

// Client-side event types (for emitting)
export type ClientEvents = {
  "auth": (data: { token: string }) => void;
  "chat:join": (data: { chatId: string }) => void;
  "chat:leave": (data: { chatId: string }) => void;
  "chat:message": (data: SendMessageData) => void;
  "chat:message_update": (data: { messageId: string; content: string }) => void;
  "chat:message_delete": (data: { messageId: string; chatId: string }) => void;
  "chat:typing_start": (data: { chatId: string }) => void;
  "chat:typing_stop": (data: { chatId: string }) => void;
  "chat:read": (data: { chatId: string; messageId: string }) => void;
  "chat:reaction_add": (data: { messageId: string; emoji: string }) => void;
  "chat:reaction_remove": (data: { messageId: string; emoji: string }) => void;
  "presence:subscribe": (userIds: string[]) => void;
  "presence:unsubscribe": (userIds: string[]) => void;
};

export interface SendMessageData {
  chatId: string;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaSize?: number;
  replyToId?: string;
  forwardFromId?: string;
  tempId: string;
}

// ============================================
// Pagination
// ============================================

export interface CursorPagination {
  cursor?: string;
  limit: number;
}

export interface CursorResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ============================================
// API Response Wrapper
// ============================================

export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function success<T>(data: T): ApiResponse<T> {
  return { data };
}

export function failure(code: string, message: string, details?: Record<string, unknown>): ApiResponse<never> {
  return { error: { code, message, details } };
}