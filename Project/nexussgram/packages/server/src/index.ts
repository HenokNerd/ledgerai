import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

const prisma = new PrismaClient();

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: env.CLIENT_URL,
  credentials: true,
});

await fastify.register(cookie);
await fastify.register(jwt, {
  secret: env.JWT_SECRET,
  cookie: { cookieName: 'token', signed: false },
});

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

const httpServer = createServer(fastify.server);

const io = new SocketIOServer(httpServer, {
  cors: { origin: env.CLIENT_URL, credentials: true },
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

async function main() {
  try {
    await fastify.ready();
    httpServer.listen({ port: env.PORT, host: '0.0.0.0' }, () => {
      console.log(`🚀 Server running on http://localhost:${env.PORT}`);
      console.log(`🔌 Socket.io ready`);
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();

export { fastify, io, prisma };