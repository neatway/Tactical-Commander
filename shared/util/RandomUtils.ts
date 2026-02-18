// ============================================================================
// RandomUtils.ts
// Seeded random number generation for deterministic combat simulation.
//
// CRITICAL DESIGN DECISION: The simulation MUST be deterministic.
// Given the same seed, the same sequence of random numbers must be produced.
// This enables:
//   1. Replay verification (both clients can replay and verify outcomes)
//   2. Anti-cheat (server can replay with the same seed to verify)
//   3. Spectator replays (recreate the exact match from a seed + commands)
//
// We use the Mulberry32 algorithm: a fast, high-quality 32-bit PRNG
// that passes statistical randomness tests while being simple to implement.
// ============================================================================

// ----------------------------------------------------------------------------
// CORE PRNG: Mulberry32
// A simple but effective 32-bit pseudo-random number generator.
// Period of 2^32 (~4 billion values before repeating).
// ----------------------------------------------------------------------------

/**
 * Creates a Mulberry32 pseudo-random number generator from a seed.
 *
 * Mulberry32 is a 32-bit PRNG with excellent statistical properties:
 * - Period of 2^32 (4,294,967,296)
 * - Passes BigCrush statistical test suite
 * - Very fast: only bitwise operations and multiplication
 * - Deterministic: same seed always produces same sequence
 *
 * The returned function produces uniformly distributed floats in [0, 1).
 *
 * @param seed - An integer seed value. Different seeds produce different sequences.
 *               Using the same seed guarantees identical output.
 * @returns A function that, when called, returns the next random float in [0, 1)
 *
 * @example
 * const rng = mulberry32(12345);
 * rng(); // Always returns the same first value for seed 12345
 * rng(); // Always returns the same second value for seed 12345
 */
export function mulberry32(seed: number): () => number {
  /**
   * Internal state variable. Mutated on each call.
   * The algorithm works by:
   * 1. Incrementing state by a large odd constant (golden ratio related)
   * 2. Applying bit mixing operations to diffuse the state
   * 3. Converting to a float in [0, 1)
   */
  let state = seed | 0; // Ensure integer

  return function (): number {
    // Increment state by a constant derived from the golden ratio
    // 0x6D2B79F5 = 1831565813 (a carefully chosen odd constant)
    state = (state + 0x6D2B79F5) | 0;

    // Bit mixing: spread the entropy across all 32 bits
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    // Final mixing and conversion to [0, 1) float
    // The >>> 0 converts to unsigned 32-bit integer
    // Dividing by 2^32 (4294967296) maps to [0, 1)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------------------
// SEEDED RANDOM CLASS
// A convenient wrapper around Mulberry32 providing common random operations.
// Used throughout the simulation engine for all random decisions.
// ----------------------------------------------------------------------------

/**
 * A seeded random number generator class with convenient utility methods.
 *
 * Wraps the Mulberry32 PRNG with higher-level operations commonly needed
 * in the game simulation: integer ranges, booleans, array shuffling, etc.
 *
 * All methods are deterministic given the same seed and call sequence.
 * The order in which methods are called matters: calling next() before
 * nextInt() will produce different results than calling nextInt() first.
 *
 * @example
 * const rng = new SeededRandom(42);
 * const speed = rng.nextFloat(100, 300);    // Random float in [100, 300)
 * const critHit = rng.nextBool(0.25);       // 25% chance of true
 * const target = rng.pick(enemies);          // Random enemy from array
 * const shuffled = rng.shuffle([1,2,3,4]);   // Deterministic shuffle
 */
export class SeededRandom {
  /** The underlying Mulberry32 PRNG function */
  private readonly rng: () => number;

  /**
   * Creates a new SeededRandom instance with the given seed.
   *
   * @param seed - Integer seed for the PRNG. Same seed = same sequence.
   */
  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  /**
   * Returns the next random float in the range [0, 1).
   * This is the fundamental operation; all other methods build on this.
   *
   * The returned value is uniformly distributed:
   *   - 0.0 is possible (inclusive lower bound)
   *   - 1.0 is NOT possible (exclusive upper bound)
   *
   * @returns A random float in [0, 1)
   */
  next(): number {
    return this.rng();
  }

  /**
   * Returns a random integer in the range [min, max] (inclusive on both ends).
   *
   * Formula: floor(rng() * (max - min + 1)) + min
   *
   * The +1 in the range ensures max is included. For example:
   *   nextInt(1, 6) -> returns 1, 2, 3, 4, 5, or 6 (simulates a die roll)
   *   nextInt(0, 99) -> returns 0 through 99 inclusive
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @returns A random integer in [min, max]
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  /**
   * Returns a random float in the range [min, max).
   * The max value is exclusive (technically possible but astronomically unlikely).
   *
   * Formula: rng() * (max - min) + min
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (exclusive)
   * @returns A random float in [min, max)
   */
  nextFloat(min: number, max: number): number {
    return this.rng() * (max - min) + min;
  }

  /**
   * Returns true with the given probability, false otherwise.
   * Default probability is 0.5 (coin flip).
   *
   * @param probability - Chance of returning true, in range [0, 1].
   *                      0.0 = always false, 1.0 = always true, 0.5 = coin flip.
   *                      Defaults to 0.5 if not specified.
   * @returns true with the given probability
   *
   * @example
   * rng.nextBool()     // 50% chance of true
   * rng.nextBool(0.75) // 75% chance of true
   * rng.nextBool(0.1)  // 10% chance of true
   */
  nextBool(probability: number = 0.5): boolean {
    return this.rng() < probability;
  }

  /**
   * Shuffles an array in-place using the Fisher-Yates (Knuth) algorithm.
   * Returns the same array reference (mutated) for convenience.
   *
   * The Fisher-Yates algorithm guarantees a uniform distribution of permutations:
   * every possible ordering is equally likely. It runs in O(n) time.
   *
   * Algorithm:
   *   For i from (length-1) down to 1:
   *     Pick random j in [0, i]
   *     Swap array[i] and array[j]
   *
   * WARNING: This mutates the input array. Clone it first if you need
   * to preserve the original: rng.shuffle([...originalArray])
   *
   * @param array - The array to shuffle (will be mutated)
   * @returns The same array, now shuffled
   *
   * @example
   * const deck = [1, 2, 3, 4, 5];
   * rng.shuffle(deck); // deck is now randomly reordered
   */
  shuffle<T>(array: T[]): T[] {
    // Fisher-Yates: iterate backwards, swapping each element with a random earlier one
    for (let i = array.length - 1; i > 0; i--) {
      /** Pick a random index from 0 to i (inclusive) */
      const j = Math.floor(this.rng() * (i + 1));

      /** Swap elements at positions i and j */
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }

    return array;
  }

  /**
   * Picks a random element from a non-empty array.
   * Throws an error if the array is empty (undefined behavior prevention).
   *
   * @param array - The array to pick from (must not be empty)
   * @returns A randomly selected element from the array
   *
   * @example
   * const weapons = ['PISTOL', 'RIFLE', 'AWP'];
   * const chosen = rng.pick(weapons); // Returns one of the three weapons
   */
  pick<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }

    /** Generate a random index from 0 to length-1 */
    const index = Math.floor(this.rng() * array.length);
    return array[index];
  }
}
