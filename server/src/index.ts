/**
 * @file index.ts
 * @description Main entry point for the Tactical Commander game server.
 *
 * Starts an Express HTTP server with Socket.io for real-time WebSocket
 * communication. The server handles:
 *   - Serving the built client files (production)
 *   - WebSocket connections for real-time gameplay
 *   - Matchmaking: pairing two players into a game room
 *   - Game rooms: managing individual matches with server-authoritative simulation
 *
 * Architecture:
 *   index.ts (this file)
 *     └── SocketServer (network/SocketServer.ts)
 *           ├── MatchmakingQueue (matchmaking/MatchmakingQueue.ts)
 *           └── GameRoom[] (game/GameRoom.ts)
 *                 └── ServerSimulation (simulation/ServerSimulation.ts)
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupSocketHandlers } from './network/SocketServer.js';

// ============================================================================
// --- Server Configuration ---
// ============================================================================

/** Port the server listens on. Uses PORT env var or defaults to 4000. */
const PORT = parseInt(process.env.PORT ?? '4000', 10);

/**
 * Resolve __dirname for ES modules (import.meta.url workaround).
 * Needed because ES modules don't have __dirname by default.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// --- Express + HTTP Server ---
// ============================================================================

/** Create the Express app */
const app = express();

/** Create an HTTP server wrapping Express (required for Socket.io) */
const httpServer = createServer(app);

/**
 * Serve the built client files from the dist/ directory in production.
 * In development, the client is served by Vite dev server on port 3000.
 */
const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));

/** Health check endpoint for monitoring */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

/** Serve the client's index.html for any unmatched route (SPA fallback) */
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ============================================================================
// --- Socket.io Server ---
// ============================================================================

/**
 * Create the Socket.io server with CORS configured for development.
 * In development, the Vite dev server runs on port 3000 and the game
 * server runs on port 4000, so we need CORS to allow cross-origin requests.
 */
const io = new SocketServer(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:4000'],
    methods: ['GET', 'POST'],
  },
  /** Increase the max buffer size for large state updates */
  maxHttpBufferSize: 1e6, // 1MB
});

/** Set up all Socket.io event handlers (connection, disconnect, messages) */
setupSocketHandlers(io);

// ============================================================================
// --- Start Server ---
// ============================================================================

httpServer.listen(PORT, () => {
  console.log(`[Server] Tactical Commander server running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[Server] Client (production): http://localhost:${PORT}`);
  console.log(`[Server] Client (dev): http://localhost:3000 (requires Vite dev server)`);
});
