/**
 * @file SocketServer.ts
 * @description Socket.io connection handler and message router.
 *
 * Manages WebSocket connections for all connected players. Routes incoming
 * messages to the appropriate handler:
 *   - JOIN_QUEUE → MatchmakingQueue
 *   - SEND_COMMAND → GameRoom (via player's active room)
 *   - SEND_BUY_ORDER → GameRoom
 *   - READY_UP → GameRoom
 *   - STRATEGY_PLAN → GameRoom
 *
 * Tracks connected players and their active game rooms. Handles disconnection
 * with a 60-second reconnection window.
 */

import type { Server, Socket } from 'socket.io';
import { MatchmakingQueue } from '../matchmaking/MatchmakingQueue.js';
import { GameRoom } from '../game/GameRoom.js';

// ============================================================================
// --- Player Tracking ---
// ============================================================================

/**
 * Represents a connected player's server-side state.
 * Tracks their socket, identity, and active game room.
 */
interface ConnectedPlayer {
  /** The player's Socket.io socket */
  socket: Socket;
  /** Unique player ID (socket ID for now, will be auth-based later) */
  playerId: string;
  /** Display name (placeholder until auth is implemented) */
  displayName: string;
  /** The game room this player is currently in, or null */
  currentRoom: GameRoom | null;
  /** Which player number they are in their room (1 or 2) */
  playerNumber: 1 | 2;
}

/** Map of socket ID → ConnectedPlayer for all active connections */
const connectedPlayers = new Map<string, ConnectedPlayer>();

/** Map of room ID → GameRoom for all active game rooms */
const activeRooms = new Map<string, GameRoom>();

/** The global matchmaking queue instance */
let matchmakingQueue: MatchmakingQueue;

// ============================================================================
// --- Setup Function ---
// ============================================================================

/**
 * Set up Socket.io event handlers for the server.
 * Called once at server startup from index.ts.
 *
 * @param io - The Socket.io server instance
 */
export function setupSocketHandlers(io: Server): void {
  /** Create the matchmaking queue with a callback for when matches are found */
  matchmakingQueue = new MatchmakingQueue((player1Id, player2Id) => {
    createGameRoom(io, player1Id, player2Id);
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Player connected: ${socket.id}`);

    /**
     * Create the player record. For now, the player ID is the socket ID.
     * When auth is implemented, this will use the JWT-verified user ID.
     */
    const player: ConnectedPlayer = {
      socket,
      playerId: socket.id,
      displayName: `Player_${socket.id.slice(0, 4)}`,
      currentRoom: null,
      playerNumber: 1,
    };
    connectedPlayers.set(socket.id, player);

    // --- Message Handlers ---

    /**
     * JOIN_QUEUE: Player wants to find a match.
     * Adds them to the matchmaking queue. When two players are queued,
     * the matchmaking callback fires and creates a game room.
     */
    socket.on('JOIN_QUEUE', () => {
      console.log(`[Socket] ${player.displayName} joining matchmaking queue`);

      /* Don't allow joining the queue if already in a room */
      if (player.currentRoom) {
        socket.emit('ERROR', { message: 'Already in a match' });
        return;
      }

      matchmakingQueue.addPlayer(socket.id);
      socket.emit('QUEUE_JOINED', { position: matchmakingQueue.getQueueSize() });
    });

    /**
     * LEAVE_QUEUE: Player wants to stop searching for a match.
     */
    socket.on('LEAVE_QUEUE', () => {
      matchmakingQueue.removePlayer(socket.id);
      socket.emit('QUEUE_LEFT', {});
    });

    /**
     * SEND_COMMAND: Player issues a tactical command during LIVE_PHASE.
     * Routes the command to the player's active game room.
     */
    socket.on('SEND_COMMAND', (data: { command: unknown }) => {
      if (!player.currentRoom) {
        socket.emit('ERROR', { message: 'Not in a match' });
        return;
      }
      player.currentRoom.handleCommand(player.playerNumber, data.command);
    });

    /**
     * SEND_BUY_ORDER: Player purchases equipment during BUY_PHASE.
     * Routes the buy orders to the game room for validation.
     */
    socket.on('SEND_BUY_ORDER', (data: { orders: unknown[] }) => {
      if (!player.currentRoom) {
        socket.emit('ERROR', { message: 'Not in a match' });
        return;
      }
      player.currentRoom.handleBuyOrder(player.playerNumber, data.orders);
    });

    /**
     * READY_UP: Player signals they're done with the current phase.
     * If both players ready up, the phase may advance early.
     */
    socket.on('READY_UP', () => {
      if (!player.currentRoom) return;
      player.currentRoom.handleReadyUp(player.playerNumber);
    });

    /**
     * STRATEGY_PLAN: Player submits their soldier movement plans.
     * Stores waypoints that soldiers will follow when LIVE_PHASE starts.
     */
    socket.on('STRATEGY_PLAN', (data: { plans: unknown }) => {
      if (!player.currentRoom) return;
      player.currentRoom.handleStrategyPlan(player.playerNumber, data.plans);
    });

    /**
     * disconnect: Player's connection dropped.
     * Start a 60-second reconnection timer. If they don't reconnect
     * in time, they forfeit the match.
     */
    socket.on('disconnect', () => {
      console.log(`[Socket] Player disconnected: ${player.displayName} (${socket.id})`);

      /* Remove from matchmaking queue if they were in it */
      matchmakingQueue.removePlayer(socket.id);

      /* Handle disconnect from active game room */
      if (player.currentRoom) {
        player.currentRoom.handleDisconnect(player.playerNumber);
      }

      /* Remove from connected players map */
      connectedPlayers.delete(socket.id);
    });
  });

  console.log('[Socket] WebSocket handlers registered');
}

// ============================================================================
// --- Game Room Creation ---
// ============================================================================

/**
 * Create a new game room for two matched players.
 * Joins both players into a Socket.io room and initializes the match.
 *
 * @param io - The Socket.io server instance
 * @param player1Id - Socket ID of player 1
 * @param player2Id - Socket ID of player 2
 */
function createGameRoom(io: Server, player1Id: string, player2Id: string): void {
  const p1 = connectedPlayers.get(player1Id);
  const p2 = connectedPlayers.get(player2Id);

  if (!p1 || !p2) {
    console.error('[Socket] Failed to create room: player not found');
    return;
  }

  /** Generate a unique room ID */
  const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /** Create the game room */
  const room = new GameRoom(roomId, io, player1Id, player2Id);
  activeRooms.set(roomId, room);

  /** Assign players to the room */
  p1.currentRoom = room;
  p1.playerNumber = 1;
  p2.currentRoom = room;
  p2.playerNumber = 2;

  /** Join both sockets to the Socket.io room for broadcasting */
  p1.socket.join(roomId);
  p2.socket.join(roomId);

  /** Notify both players that a match was found */
  p1.socket.emit('MATCH_FOUND', {
    roomId,
    playerNumber: 1,
    opponentName: p2.displayName,
  });
  p2.socket.emit('MATCH_FOUND', {
    roomId,
    playerNumber: 2,
    opponentName: p1.displayName,
  });

  /** Start the match */
  room.startMatch();

  console.log(
    `[Socket] Game room created: ${roomId}` +
    ` — ${p1.displayName} (P1) vs ${p2.displayName} (P2)`
  );
}

/**
 * Get the count of currently active game rooms.
 * Used for monitoring and health checks.
 */
export function getActiveRoomCount(): number {
  return activeRooms.size;
}

/**
 * Get the count of currently connected players.
 * Used for monitoring and health checks.
 */
export function getConnectedPlayerCount(): number {
  return connectedPlayers.size;
}
