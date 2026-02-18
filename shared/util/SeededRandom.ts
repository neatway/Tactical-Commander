/**
 * @file SeededRandom.ts
 * @description A deterministic pseudo-random number generator (PRNG) using
 * the Mulberry32 algorithm. Seeded randomness ensures that both client and
 * server produce identical simulation results given the same seed.
 *
 * This is critical for the deterministic lockstep simulation model:
 * if both sides use the same seed and the same sequence of calls,
 * they will produce exactly the same game state.
 */

/**
 * Seeded pseudo-random number generator.
 * Uses the Mulberry32 algorithm for fast, deterministic random numbers.
 *
 * @example
 * ```ts
 * const rng = new SeededRandom(12345);
 * const value = rng.next();      // Always the same for seed 12345
 * const ranged = rng.nextRange(1, 6); // Deterministic integer 1-6
 * ```
 */
export class SeededRandom {
  /** The internal state of the PRNG. Mutated with each call to next(). */
  private state: number;

  /**
   * Create a new SeededRandom instance.
   *
   * @param seed - The initial seed value. Same seed = same sequence.
   */
  constructor(seed: number) {
    this.state = seed;
  }

  /**
   * Generate the next pseudo-random number in the sequence.
   * Returns a float in the range [0, 1) (like Math.random()).
   *
   * Uses the Mulberry32 algorithm:
   * - Fast (single multiplication, shifts, and XORs)
   * - Good statistical distribution for game use
   * - Fully deterministic
   *
   * @returns A pseudo-random float in [0, 1)
   */
  next(): number {
    /* Advance the internal state */
    this.state += 0x6D2B79F5;
    let t = this.state;
    /* Mulberry32 mixing steps */
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    /* Normalize to [0, 1) range */
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate a pseudo-random integer in the inclusive range [min, max].
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @returns A pseudo-random integer between min and max
   */
  nextRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Generate a pseudo-random float in the range [min, max).
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (exclusive)
   * @returns A pseudo-random float between min and max
   */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}
