# NexussGram — Project Definition

## Goal
Build a Telegram-like messaging application with P2P chats, groups, channels, admin management, and a complete emoji/reaction system — shipped in verified increments.

## Objectives (Measurable Done Criteria)
1. **Auth & Identity**: Phone number + Google OAuth signup; session management; profile with username (public) or phone-only (private)
2. **P2P Chat**: Search by username, open chat window, left/right message bubbles, online/offline/last-seen with human-readable timestamps, save contacts
3. **Groups**: Create/join groups, invite from contacts, acceptance flow, member management
4. **Channels**: Admin-only posting, member reactions with curated emoji pack, comment section linked to a group
5. **Admin Management**: Owner assigns admins; admins can mute, ban (timed), warn; privilege matrix enforced
6. **Emoji Pack**: Complete emoji picker library with categories, search, recent, skin tones — not a static list
7. **Real-time**: WebSocket-based message delivery, presence, typing indicators, read receipts
8. **UI/UX**: Telegram-like layout — sidebar (chats/contacts), chat window, responsive, dark/light theme

## Non-Goals
- End-to-end encryption (v1)
- Voice/video calls
- Bots/platform API
- Multi-device sync beyond session
- File storage backend (use object storage placeholder)

## Constraints
- Stack: React 18 + TypeScript + Vite (frontend), Node.js + Fastify + TypeScript (backend), PostgreSQL + Prisma (DB), Socket.io (realtime), Tailwind CSS
- Auth: Better Auth (phone + Google OAuth), JWT sessions
- Deployment target: Docker Compose for local, Kubernetes-ready configs
- Code quality: ESLint, Prettier, TypeScript strict, Vitest + Playwright

## Success Definition
- All 7 objectives verified by automated tests (unit, integration, E2E)
- Manual smoke test: two users can signup, find each other by username, chat in real-time, create group, create channel, react, admin actions work
- No critical security findings in auth, authorization, or data access
- Build passes CI pipeline (lint, typecheck, test, build)