/**
 * @file MatchmakingQueue.ts
 * @description Simple FIFO matchmaking queue that pairs two players.
 *
 * For the prototype, matchmaking is straightforward:
 *   1. Player joins the queue via JOIN_QUEUE message
 *   2. When 2+ players are in the queue, the first two are paired
 *   3. The onMatch callback fires with both player IDs
 *   4. Both players are removed from the queue
 *
 * Future improvements (Milestone 5):
 *   - Glicko-2 rating-based matching (pair similar skill levels)
 *   - Queue timeout with expanding search range
 *   - Map ban phase after match is found
 *   - Ranked roster power cap validation (max 2,750 total stats)
 */

// ============================================================================
// --- Types ---
// ============================================================================

/**
 * Callback fired when two players are matched.
 * The SocketServer uses this to create a GameRoom for the pair.
 *
 * @param player1Id - Socket ID of the first matched player
 * @param player2Id - Socket ID of the second matched player
 */
export type OnMatchCallback = (player1Id: string, player2Id: string) => void;

// ============================================================================
// --- MatchmakingQueue Class ---
// ============================================================================

/**
 * FIFO matchmaking queue. Pairs players in the order they joined.
 *
 * @example
 * ```ts
 * const queue = new MatchmakingQueue((p1, p2) => {
 *   createGameRoom(p1, p2);
 * });
 * queue.addPlayer('socket_abc');  // Enters queue, waits
 * queue.addPlayer('socket_xyz');  // Match found! Callback fires with both IDs
 * ```
 */
export class MatchmakingQueue {
  /** Ordered queue of player socket IDs waiting for a match */
  private queue: string[] = [];

  /** Callback fired when two players are matched */
  private onMatch: OnMatchCallback;

  /**
   * Create a new matchmaking queue.
   * @param onMatch - Callback to invoke when two players are paired
   */
  constructor(onMatch: OnMatchCallback) {
    this.onMatch = onMatch;
  }

  /**
   * Add a player to the matchmaking queue.
   * If there are now 2+ players, immediately pair the first two.
   *
   * @param playerId - Socket ID of the player joining the queue
   */
  addPlayer(playerId: string): void {
    /* Prevent duplicate entries */
    if (this.queue.includes(playerId)) {
      console.log(`[Matchmaking] Player ${playerId} already in queue, ignoring`);
      return;
    }

    this.queue.push(playerId);
    console.log(`[Matchmaking] Player added to queue (${this.queue.length} in queue)`);

    /* Try to form a match */
    this.tryMatch();
  }

  /**
   * Remove a player from the matchmaking queue.
   * Called when a player disconnects or cancels matchmaking.
   *
   * @param playerId - Socket ID of the player to remove
   */
  removePlayer(playerId: string): void {
    const index = this.queue.indexOf(playerId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      console.log(`[Matchmaking] Player removed from queue (${this.queue.length} in queue)`);
    }
  }

  /**
   * Get the current number of players waiting in the queue.
   * @returns Number of queued players
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Check if a specific player is in the queue.
   * @param playerId - Socket ID to check
   * @returns True if the player is queued
   */
  isPlayerQueued(playerId: string): boolean {
    return this.queue.includes(playerId);
  }

  /**
   * Attempt to pair two players from the front of the queue.
   * Called automatically when a new player is added.
   * Pairs are formed in FIFO order (first two in queue match first).
   */
  private tryMatch(): void {
    while (this.queue.length >= 2) {
      /** Take the first two players from the queue */
      const player1 = this.queue.shift()!;
      const player2 = this.queue.shift()!;

      console.log(`[Matchmaking] Match found: ${player1} vs ${player2}`);

      /** Fire the match callback to create a game room */
      this.onMatch(player1, player2);
    }
  }
}
