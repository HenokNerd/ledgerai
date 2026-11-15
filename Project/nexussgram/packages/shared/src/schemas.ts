import { z } from "zod";

// ============================================
// Auth Schemas
// ============================================

export const phoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, "Invalid phone format (E.164)");

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Username must start with letter, only alphanumeric and underscore");

export const displayNameSchema = z.string().min(1).max(64);

export const signupPhoneSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, "OTP must be 6 digits"),
});

export const signupGoogleSchema = z.object({
  idToken: z.string().min(1),
});

export const completeProfileSchema = z.object({
  username: usernameSchema.optional(),
  displayName: displayNameSchema,
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(160).optional(),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  username: usernameSchema.optional(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(160).optional(),
  isPublic: z.boolean().optional(),
});

export const loginResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    phone: z.string().nullable(),
    username: z.string().nullable(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    isPublic: z.boolean(),
    presence: z.enum(["ONLINE", "OFFLINE", "AWAY"]),
    lastSeen: z.string().datetime().nullable(),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// ============================================
// User/Search Schemas
// ============================================

export const userSearchQuerySchema = z.object({
  q: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export const userSearchResultSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  isPublic: z.boolean(),
  presence: z.enum(["ONLINE", "OFFLINE", "AWAY"]),
  lastSeen: z.string().datetime().nullable(),
  isContact: z.boolean(),
});

export const userSearchResponseSchema = z.object({
  users: z.array(userSearchResultSchema),
  nextCursor: z.string().nullable(),
});

// ============================================
// Contact Schemas
// ============================================

export const addContactSchema = z.object({
  targetId: z.string().cuid(),
  name: z.string().max(64).optional(),
});

export const contactSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  name: z.string().nullable(),
  isSaved: z.boolean(),
  createdAt: z.string().datetime(),
  user: z.object({
    id: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    presence: z.enum(["ONLINE", "OFFLINE", "AWAY"]),
    lastSeen: z.string().datetime().nullable(),
  }),
});

// ============================================
// Chat Schemas
// ============================================

export const createPrivateChatSchema = z.object({
  targetId: z.string().cuid(),
});

export const chatParticipantSchema = z.object({
  userId: z.string(),
  username: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  presence: z.enum(["ONLINE", "OFFLINE", "AWAY"]),
  lastSeen: z.string().datetime().nullable(),
  isPinned: z.boolean(),
  isMuted: z.boolean(),
  unreadCount: z.number().int(),
});

export const chatSchema = z.object({
  id: z.string(),
  type: z.enum(["PRIVATE", "GROUP", "CHANNEL"]),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  description: z.string().nullable(),
  participants: z.array(chatParticipantSchema),
  lastMessage: z
    .object({
      id: z.string(),
      content: z.string().nullable(),
      type: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "STICKER", "CONTACT", "LOCATION", "POLL", "SERVICE"]),
      senderId: z.string(),
      createdAt: z.string().datetime(),
      isDeleted: z.boolean(),
    })
    .nullable(),
  unreadCount: z.number().int(),
  isPinned: z.boolean(),
  isMuted: z.boolean(),
  updatedAt: z.string().datetime(),
});

export const chatListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const chatListResponseSchema = z.object({
  chats: z.array(chatSchema),
  nextCursor: z.string().nullable(),
});

// ============================================
// Message Schemas
// ============================================

export const messageTypeSchema = z.enum([
  "TEXT",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "DOCUMENT",
  "STICKER",
  "CONTACT",
  "LOCATION",
  "POLL",
  "SERVICE",
]);

export const sendMessageSchema = z.object({
  chatId: z.string().cuid(),
  type: messageTypeSchema.default("TEXT"),
  content: z.string().max(4096).optional(),
  mediaUrl: z.string().url().optional(),
  mediaType: z.string().optional(),
  mediaSize: z.number().int().positive().optional(),
  replyToId: z.string().cuid().optional(),
  forwardFromId: z.string().cuid().optional(),
  tempId: z.string().uuid(), // Client-generated for deduplication
});

export const editMessageSchema = z.object({
  content: z.string().max(4096),
});

export const messageQuerySchema = z.object({
  chatId: z.string().cuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(), // Message ID for pagination
  before: z.string().datetime().optional(),
});

export const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  receiverId: z.string().nullable(),
  type: messageTypeSchema,
  content: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  mediaSize: z.number().int().nullable(),
  replyTo: z
    .object({
      id: z.string(),
      content: z.string().nullable(),
      senderId: z.string(),
      senderName: z.string(),
    })
    .nullable(),
  forwardFrom: z
    .object({
      id: z.string(),
      senderId: z.string(),
      senderName: z.string(),
    })
    .nullable(),
  isEdited: z.boolean(),
  isDeleted: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reactions: z.array(
    z.object({
      emoji: z.string(),
      count: z.number().int(),
      users: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
        })
      ),
      hasReacted: z.boolean(),
    })
  ),
  readBy: z.array(
    z.object({
      userId: z.string(),
      readAt: z.string().datetime(),
    })
  ),
});

export const messageListResponseSchema = z.object({
  messages: z.array(messageSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const markReadSchema = z.object({
  chatId: z.string().cuid(),
  messageId: z.string().cuid(),
});

// ============================================
// Reaction Schemas
// ============================================

export const addReactionSchema = z.object({
  messageId: z.string().cuid(),
  emoji: z.string().min(1).max(8), // Unicode emoji
});

export const reactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int(),
  users: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
    })
  ),
  hasReacted: z.boolean(),
});

// ============================================
// Group Schemas
// ============================================

export const createGroupSchema = z.object({
  name: z.string().min(1).max(128),
  avatarUrl: z.string().url().optional(),
  description: z.string().max(512).optional(),
  memberIds: z.array(z.string().cuid()).min(1).max(199), // + owner = 200 max initial
  isPublic: z.boolean().default(false),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  avatarUrl: z.string().url().optional(),
  description: z.string().max(512).optional(),
  isPublic: z.boolean().optional(),
});

export const groupMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  status: z.enum(["INVITED", "ACCEPTED", "LEFT", "BANNED", "KICKED"]),
  joinedAt: z.string().datetime().nullable(),
  invitedAt: z.string().datetime(),
  invitedBy: z.string().nullable(),
  leftAt: z.string().datetime().nullable(),
  bannedAt: z.string().datetime().nullable(),
  banExpiresAt: z.string().datetime().nullable(),
  muteExpiresAt: z.string().datetime().nullable(),
  user: z.object({
    id: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    presence: z.enum(["ONLINE", "OFFLINE", "AWAY"]),
    lastSeen: z.string().datetime().nullable(),
  }),
});

export const groupSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  ownerId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  description: z.string().nullable(),
  inviteLink: z.string().nullable(),
  isPublic: z.boolean(),
  maxMembers: z.number().int(),
  memberCount: z.number().int(),
  adminCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  myRole: z.enum(["OWNER", "ADMIN", "MEMBER"]).nullable(),
  myStatus: z.enum(["INVITED", "ACCEPTED", "LEFT", "BANNED", "KICKED"]).nullable(),
});

export const inviteToGroupSchema = z.object({
  groupId: z.string().cuid(),
  userIds: z.array(z.string().cuid()).min(1).max(100),
});

export const respondToInviteSchema = z.object({
  groupId: z.string().cuid(),
  accept: z.boolean(),
});

export const groupActionSchema = z.object({
  groupId: z.string().cuid(),
  targetId: z.string().cuid(),
  reason: z.string().max(256).optional(),
  durationMinutes: z.number().int().positive().optional(), // For mute/ban
});

// ============================================
// Channel Schemas
// ============================================

export const createChannelSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  title: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  avatarUrl: z.string().url().optional(),
  isPublic: z.boolean().default(true),
  linkedGroupId: z.string().cuid().optional(), // Existing group for comments
});

export const updateChannelSchema = z.object({
  title: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  avatarUrl: z.string().url().optional(),
  isPublic: z.boolean().optional(),
  linkedGroupId: z.string().cuid().optional(),
});

export const channelMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  joinedAt: z.string().datetime(),
  leftAt: z.string().datetime().nullable(),
  user: z.object({
    id: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});

export const channelSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  ownerId: z.string(),
  username: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isPublic: z.boolean(),
  memberCount: z.number().int(),
  linkedGroupId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  myRole: z.enum(["OWNER", "ADMIN", "MEMBER"]).nullable(),
});

export const createPostSchema = z.object({
  channelId: z.string().cuid(),
  content: z.string().max(4096).optional(),
  mediaUrl: z.string().url().optional(),
  mediaType: z.string().optional(),
  replyToId: z.string().cuid().optional(),
});

export const updatePostSchema = z.object({
  content: z.string().max(4096).optional(),
});

export const channelPostSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  authorId: z.string(),
  content: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  replyTo: z
    .object({
      id: z.string(),
      content: z.string().nullable(),
      authorId: z.string(),
      authorName: z.string(),
    })
    .nullable(),
  viewCount: z.number().int(),
  forwardCount: z.number().int(),
  reactions: z.array(
    z.object({
      emoji: z.string(),
      count: z.number().int(),
      hasReacted: z.boolean(),
    })
  ),
  commentCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  author: z.object({
    id: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});

export const postListQuerySchema = z.object({
  channelId: z.string().cuid(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export const postListResponseSchema = z.object({
  posts: z.array(channelPostSchema),
  nextCursor: z.string().nullable(),
});

export const addPostReactionSchema = z.object({
  postId: z.string().cuid(),
  emoji: z.string().min(1).max(8),
});

// ============================================
// Admin Schemas
// ============================================

export const adminActionTypeSchema = z.enum([
  "MUTE",
  "UNMUTE",
  "BAN",
  "UNBAN",
  "WARN",
  "PROMOTE",
  "DEMOTE",
  "REMOVE",
  "DELETE_MESSAGE",
]);

export const adminActionSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  targetId: z.string(),
  groupId: z.string().nullable(),
  channelId: z.string().nullable(),
  action: adminActionTypeSchema,
  reason: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  actor: z.object({
    id: z.string(),
    displayName: z.string(),
  }),
  target: z.object({
    id: z.string(),
    displayName: z.string(),
  }),
});

export const adminActionListQuerySchema = z.object({
  groupId: z.string().cuid().optional(),
  channelId: z.string().cuid().optional(),
  targetId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const adminActionListResponseSchema = z.object({
  actions: z.array(adminActionSchema),
  nextCursor: z.string().nullable(),
});

export const assignAdminSchema = z.object({
  groupId: z.string().cuid().optional(),
  channelId: z.string().cuid().optional(),
  targetId: z.string().cuid(),
});

export const muteBanSchema = z.object({
  groupId: z.string().cuid().optional(),
  channelId: z.string().cuid().optional(),
  targetId: z.string().cuid(),
  durationMinutes: z.number().int().positive().max(525600), // Max 1 year
  reason: z.string().max(256).optional(),
});

export const warnSchema = z.object({
  groupId: z.string().cuid().optional(),
  channelId: z.string().cuid().optional(),
  targetId: z.string().cuid(),
  reason: z.string().max(256),
});

// ============================================
// Emoji Schemas
// ============================================

export const emojiSchema = z.object({
  emoji: z.string(),
  name: z.string(),
  category: z.string(),
  keywords: z.array(z.string()),
  skinTones: z.array(z.string()).optional(),
  version: z.string(),
});

export const emojiCategorySchema = z.object({
  name: z.string(),
  emojis: z.array(emojiSchema),
});

export const emojiPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  categories: z.array(emojiCategorySchema),
  isDefault: z.boolean(),
});

export const curatedEmojiSetSchema = z.object({
  emojis: z.array(z.string()), // Unicode emoji strings
});

// ============================================
// Real-time Event Schemas
// ============================================

export const socketAuthSchema = z.object({
  token: z.string(),
});

export const joinChatSchema = z.object({
  chatId: z.string().cuid(),
});

export const typingStartSchema = z.object({
  chatId: z.string().cuid(),
});

export const typingStopSchema = z.object({
  chatId: z.string().cuid(),
});

export const newMessageEventSchema = z.object({
  message: messageSchema,
  tempId: z.string().uuid().optional(),
});

export const messageUpdatedEventSchema = z.object({
  messageId: z.string().cuid(),
  content: z.string(),
  isEdited: z.boolean(),
});

export const messageDeletedEventSchema = z.object({
  messageId: z.string().cuid(),
  chatId: z.string().cuid(),
});

export const reactionAddedEventSchema = z.object({
  messageId: z.string().cuid(),
  userId: z.string(),
  emoji: z.string(),
});

export const reactionRemovedEventSchema = z.object({
  messageId: z.string().cuid(),
  userId: z.string(),
  emoji: z.string(),
});

export const presenceUpdateEventSchema = z.object({
  userId: z.string(),
  presence: z.enum(["ONLINE", "OFFLINE", "AWAY"]),
  lastSeen: z.string().datetime().nullable(),
});

export const readReceiptEventSchema = z.object({
  chatId: z.string().cuid(),
  messageId: z.string().cuid(),
  userId: z.string(),
  readAt: z.string().datetime(),
});

export const groupMemberUpdateEventSchema = z.object({
  groupId: z.string().cuid(),
  userId: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).optional(),
  status: z.enum(["INVITED", "ACCEPTED", "LEFT", "BANNED", "KICKED"]).optional(),
});

export const channelPostEventSchema = z.object({
  post: channelPostSchema,
});

export const channelReactionEventSchema = z.object({
  postId: z.string().cuid(),
  userId: z.string(),
  emoji: z.string(),
});

// ============================================
// Type Exports
// ============================================

export type Phone = z.infer<typeof phoneSchema>;
export type Username = z.infer<typeof usernameSchema>;
export type DisplayName = z.infer<typeof displayNameSchema>;
export type SignupPhone = z.infer<typeof signupPhoneSchema>;
export type VerifyOtp = z.infer<typeof verifyOtpSchema>;
export type SignupGoogle = z.infer<typeof signupGoogleSchema>;
export type CompleteProfile = z.infer<typeof completeProfileSchema>;
export type UpdateProfile = z.infer<typeof updateProfileSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RefreshToken = z.infer<typeof refreshTokenSchema>;

export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;
export type UserSearchResult = z.infer<typeof userSearchResultSchema>;
export type UserSearchResponse = z.infer<typeof userSearchResponseSchema>;

export type AddContact = z.infer<typeof addContactSchema>;
export type Contact = z.infer<typeof contactSchema>;

export type CreatePrivateChat = z.infer<typeof createPrivateChatSchema>;
export type ChatParticipant = z.infer<typeof chatParticipantSchema>;
export type Chat = z.infer<typeof chatSchema>;
export type ChatListQuery = z.infer<typeof chatListQuerySchema>;
export type ChatListResponse = z.infer<typeof chatListResponseSchema>;

export type MessageType = z.infer<typeof messageTypeSchema>;
export type SendMessage = z.infer<typeof sendMessageSchema>;
export type EditMessage = z.infer<typeof editMessageSchema>;
export type MessageQuery = z.infer<typeof messageQuerySchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
export type MarkRead = z.infer<typeof markReadSchema>;

export type AddReaction = z.infer<typeof addReactionSchema>;
export type Reaction = z.infer<typeof reactionSchema>;

export type CreateGroup = z.infer<typeof createGroupSchema>;
export type UpdateGroup = z.infer<typeof updateGroupSchema>;
export type GroupMember = z.infer<typeof groupMemberSchema>;
export type Group = z.infer<typeof groupSchema>;
export type InviteToGroup = z.infer<typeof inviteToGroupSchema>;
export type RespondToInvite = z.infer<typeof respondToInviteSchema>;
export type GroupAction = z.infer<typeof groupActionSchema>;

export type CreateChannel = z.infer<typeof createChannelSchema>;
export type UpdateChannel = z.infer<typeof updateChannelSchema>;
export type ChannelMember = z.infer<typeof channelMemberSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type CreatePost = z.infer<typeof createPostSchema>;
export type UpdatePost = z.infer<typeof updatePostSchema>;
export type ChannelPost = z.infer<typeof channelPostSchema>;
export type PostListQuery = z.infer<typeof postListQuerySchema>;
export type PostListResponse = z.infer<typeof postListResponseSchema>;
export type AddPostReaction = z.infer<typeof addPostReactionSchema>;

export type AdminActionType = z.infer<typeof adminActionTypeSchema>;
export type AdminAction = z.infer<typeof adminActionSchema>;
export type AdminActionListQuery = z.infer<typeof adminActionListQuerySchema>;
export type AdminActionListResponse = z.infer<typeof adminActionListResponseSchema>;
export type AssignAdmin = z.infer<typeof assignAdminSchema>;
export type MuteBan = z.infer<typeof muteBanSchema>;
export type Warn = z.infer<typeof warnSchema>;

export type Emoji = z.infer<typeof emojiSchema>;
export type EmojiCategory = z.infer<typeof emojiCategorySchema>;
export type EmojiPack = z.infer<typeof emojiPackSchema>;
export type CuratedEmojiSet = z.infer<typeof curatedEmojiSetSchema>;

export type SocketAuth = z.infer<typeof socketAuthSchema>;
export type JoinChat = z.infer<typeof joinChatSchema>;
export type TypingStart = z.infer<typeof typingStartSchema>;
export type TypingStop = z.infer<typeof typingStopSchema>;
export type NewMessageEvent = z.infer<typeof newMessageEventSchema>;
export type MessageUpdatedEvent = z.infer<typeof messageUpdatedEventSchema>;
export type MessageDeletedEvent = z.infer<typeof messageDeletedEventSchema>;
export type ReactionAddedEvent = z.infer<typeof reactionAddedEventSchema>;
export type ReactionRemovedEvent = z.infer<typeof reactionRemovedEventSchema>;
export type PresenceUpdateEvent = z.infer<typeof presenceUpdateEventSchema>;
export type ReadReceiptEvent = z.infer<typeof readReceiptEventSchema>;
export type GroupMemberUpdateEvent = z.infer<typeof groupMemberUpdateEventSchema>;
export type ChannelPostEvent = z.infer<typeof channelPostEventSchema>;
export type ChannelReactionEvent = z.infer<typeof channelReactionEventSchema>;