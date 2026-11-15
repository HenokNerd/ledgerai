# NexussGram — Live Task Queue

## Now (Active)
- [ ] **C0** Initialize pnpm monorepo with 3 packages (shared, server, client)
- [ ] **C0** Configure TypeScript, ESLint, Prettier, Vitest for each package
- [ ] **C0** Define Prisma schema with all models
- [ ] **C0** Generate Prisma client
- [ ] **C0** Create Zod schemas for all API boundaries
- [ ] **C0** Shared constants and utilities

## Next (Unblocked after C0)
- [ ] **C1** Server: Better Auth setup with phone + Google providers
- [ ] **C7** Server: Socket.io server with Fastify integration
- [ ] **C6** Shared: Emoji dataset and picker core

## Blocked (Waiting on dependencies)
- [ ] **C1** Client: Auth pages and context (needs C0, C1 server)
- [ ] **C2** P2P Chat (needs C0, C1, C7)
- [ ] **C3** Groups (needs C0, C1, C7)
- [ ] **C4** Channels (needs C0, C1, C3, C6, C7)
- [ ] **C5** Admin Management (needs C0, C1, C3, C4)
- [ ] **C6** Client: EmojiPicker component (needs C0, C6 shared)
- [ ] **C7** Client: Socket connection manager (needs C0, C7 server)

## Done
None yet.

## Component Status
| Component | Status | Gates Passed |
|---|---|---|
| C0 Shared Core | pending | 0/4 |
| C1 Auth & Identity | pending | 0/5 |
| C7 Realtime Infra | pending | 0/4 |
| C6 Emoji Pack | pending | 0/5 |
| C2 P2P Chat | pending | 0/6 |
| C3 Groups | pending | 0/5 |
| C4 Channels | pending | 0/5 |
| C5 Admin Mgmt | pending | 0/6 |