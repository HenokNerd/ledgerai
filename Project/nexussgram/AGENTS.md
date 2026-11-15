# AGENTS.md — NexussGram Repository Contract

## Stack & Commands

### Root (Monorepo)
```bash
# Install all deps
pnpm install

# Run all checks
pnpm check          # lint + typecheck + test
pnpm build          # build all packages
pnpm dev            # start all dev servers
```

### Packages
```
packages/
  shared/          # Types, schemas, constants, utilities
  server/          # Fastify + Socket.io + Prisma
  client/          # React + Vite + Tailwind
```

### Server (packages/server)
```bash
cd packages/server
pnpm dev            # tsx watch src/index.ts
pnpm build          # tsc
pnpm start          # node dist/index.js
pnpm db:push        # prisma db push
pnpm db:migrate     # prisma migrate dev
pnpm db:studio      # prisma studio
pnpm test           # vitest run
pnpm lint           # eslint src --ext .ts
pnpm typecheck      # tsc --noEmit
```

### Client (packages/client)
```bash
cd packages/client
pnpm dev            # vite
pnpm build          # tsc && vite build
pnpm preview        # vite preview
pnpm test           # vitest run
pnpm test:e2e       # playwright test
pnpm lint           # eslint src --ext .ts,.tsx
pnpm typecheck      # tsc --noEmit
```

### Shared (packages/shared)
```bash
cd packages/shared
pnpm build          # tsc
pnpm test           # vitest run
```

## Conventions

### Code Style
- TypeScript strict mode, no `any` unless explicitly justified with `// @ts-expect-error` comment
- ESLint + Prettier (config in each package)
- Functional components, hooks, no classes in React
- Zod schemas for all API boundaries (request/response, events)
- Prisma models = source of truth for DB; Zod derived from Prisma where possible

### Git
- Main branch: `main`
- Feature branches: `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- No direct pushes to main; PR required (even for solo)

### Architecture
- **Server**: Fastify plugins per domain (auth, chat, groups, channels, admin, presence)
- **Socket.io**: Namespaces per domain (`/chat`, `/presence`, `/notifications`)
- **Client**: Feature folders under `src/features/<domain>/` with `components/`, `hooks/`, `api/`, `types/`
- **Shared**: `packages/shared/src/` — `schemas/`, `types/`, `constants/`, `utils/`

### Database (Prisma)
- Models: User, Chat, Message, Group, GroupMember, Channel, ChannelMember, Reaction, AdminAction, EmojiPack, Contact
- Indexes on: User.username, User.phone, Chat.participants, Message.chatId+createdAt
- Soft deletes via `deletedAt` where appropriate

### API Contracts
- REST for CRUD, mutations, auth
- Socket.io for real-time: messages, presence, typing, reactions, read receipts
- All responses: `{ data?, error? }` — never throw for expected errors
- Pagination: cursor-based (`cursor`, `limit`)

### Testing
- Unit: Vitest, test files co-located (`*.test.ts`)
- Integration: Vitest + testcontainers for DB
- E2E: Playwright, critical paths only
- Coverage target: 80% on shared/server, 60% on client

### Environment
```env
# Server
DATABASE_URL="postgresql://..."
BETTER_AUTH_SECRET="..."
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
JWT_SECRET="..."
SOCKET_PORT=3001
CLIENT_URL="http://localhost:5173"

# Client
VITE_API_URL="http://localhost:3000"
VITE_SOCKET_URL="http://localhost:3001"
```

## Definition of Done (Per Component)
1. Types/schemas in `shared`
2. Server routes + Socket handlers + tests
3. Client feature + components + hooks + tests
4. E2E test for happy path
5. Docs updated (README, API docs if public)
6. `pnpm check` passes at root