// ============================================================================
// MathUtils.ts
// Vector math and geometric utility functions for the tactical commander game.
//
// All spatial calculations use a 2D coordinate system where:
//   - x = horizontal axis (left/right)
//   - z = vertical axis (forward/back, top-down view)
//   - y is reserved for "up" in Three.js 3D space (not used in 2D logic)
//
// Distances are in pixels. Angles are in radians unless noted otherwise.
// ============================================================================

// ----------------------------------------------------------------------------
// VECTOR TYPE
// The core 2D position/direction type used throughout the simulation.
// ----------------------------------------------------------------------------

/**
 * A 2D vector representing a position or direction in the game world.
 * Uses x and z coordinates because y is reserved for the vertical axis
 * in Three.js (the 3D rendering engine). In our top-down 2D game logic,
 * x is horizontal and z is the "depth" (forward/backward on the map).
 */
export interface Vec2 {
  /** Horizontal position in pixels (left = negative, right = positive) */
  readonly x: number;
  /** Depth position in pixels (top-down forward/backward axis) */
  readonly z: number;
}

// ----------------------------------------------------------------------------
// DISTANCE FUNCTIONS
// Used for range checks, detection radius, and proximity calculations.
// ----------------------------------------------------------------------------

/**
 * Calculates the Euclidean distance between two points.
 * This is the "true" straight-line distance using the Pythagorean theorem.
 *
 * Formula: sqrt((b.x - a.x)^2 + (b.z - a.z)^2)
 *
 * Use this when you need the actual distance value (e.g., for damage falloff).
 * For simple range comparisons, prefer distanceSquared() to avoid the sqrt.
 *
 * @param a - First point
 * @param b - Second point
 * @returns Euclidean distance in pixels
 */
export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Calculates the squared Euclidean distance between two points.
 * Avoids the expensive sqrt operation when you only need to COMPARE distances.
 *
 * Formula: (b.x - a.x)^2 + (b.z - a.z)^2
 *
 * Usage: Instead of `distance(a, b) < 300`, use `distanceSquared(a, b) < 300*300`
 * This is significantly faster when called thousands of times per tick.
 *
 * @param a - First point
 * @param b - Second point
 * @returns Squared Euclidean distance in pixels-squared
 */
export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz;
}

// ----------------------------------------------------------------------------
// VECTOR ARITHMETIC
// Basic vector operations for movement, direction, and interpolation.
// All functions return NEW Vec2 objects (immutable pattern).
// ----------------------------------------------------------------------------

/**
 * Normalizes a vector to unit length (length = 1).
 * A normalized vector represents a pure direction with no magnitude.
 * Returns {x: 0, z: 0} for zero-length vectors to avoid division by zero.
 *
 * @param v - The vector to normalize
 * @returns A new Vec2 with the same direction but length 1
 */
export function normalize(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.z * v.z);
  if (len === 0) {
    return { x: 0, z: 0 };
  }
  return { x: v.x / len, z: v.z / len };
}

/**
 * Adds two vectors component-wise.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns A new Vec2 where result.x = a.x + b.x, result.z = a.z + b.z
 */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

/**
 * Subtracts vector b from vector a component-wise.
 * Commonly used to get the direction vector FROM a TO b: subtract(b, a).
 *
 * @param a - First vector (minuend)
 * @param b - Second vector (subtrahend)
 * @returns A new Vec2 where result.x = a.x - b.x, result.z = a.z - b.z
 */
export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

/**
 * Scales a vector by a scalar multiplier.
 * Used for applying speed to direction vectors:
 *   velocity = scale(normalize(direction), speed)
 *
 * @param v - The vector to scale
 * @param s - The scalar multiplier
 * @returns A new Vec2 where result.x = v.x * s, result.z = v.z * s
 */
export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, z: v.z * s };
}

/**
 * Linearly interpolates between two vectors.
 * Returns a point that is t% of the way from a to b.
 *
 * Formula: a + (b - a) * t = a * (1 - t) + b * t
 *
 *   t=0.0 -> returns a (start)
 *   t=0.5 -> returns midpoint between a and b
 *   t=1.0 -> returns b (end)
 *
 * Commonly used for smooth movement animations and waypoint interpolation.
 *
 * @param a - Start vector (returned when t=0)
 * @param b - End vector (returned when t=1)
 * @param t - Interpolation factor, typically [0, 1]
 * @returns A new Vec2 at the interpolated position
 */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// ----------------------------------------------------------------------------
// ANGLE AND CONE FUNCTIONS
// Used for facing direction, vision cones, and line-of-sight calculations.
// The detection system uses cone-based vision (soldiers see in a forward arc).
// ----------------------------------------------------------------------------

/**
 * Calculates the angle in radians from one point to another.
 * Uses atan2 which returns values in the range [-PI, PI].
 *
 * The angle represents the direction you would need to face at 'from'
 * to look directly at 'to'. Measured counter-clockwise from the positive x-axis.
 *
 * @param from - The origin point (where you are)
 * @param to - The target point (where you are looking)
 * @returns Angle in radians, range [-PI, PI]
 */
export function angleBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

/**
 * Checks whether a target point falls within a vision cone.
 *
 * The cone is defined by:
 *   - origin: the viewer's position
 *   - direction: the angle the viewer is facing (in radians)
 *   - coneAngleDeg: the TOTAL width of the cone in degrees
 *
 * The cone extends coneAngleDeg/2 to each side of the facing direction.
 * For example, a 120-degree cone means the viewer can see 60 degrees
 * to the left and 60 degrees to the right of where they are looking.
 *
 * Algorithm:
 * 1. Calculate angle from origin to target
 * 2. Find the angular difference from the facing direction
 * 3. Normalize the difference to [-PI, PI]
 * 4. Check if the absolute difference is within half the cone angle
 *
 * @param origin - The viewer's position
 * @param direction - The direction the viewer is facing (radians)
 * @param target - The position to check
 * @param coneAngleDeg - Total cone width in degrees (e.g., 120)
 * @returns true if the target is within the vision cone
 */
export function isInCone(
  origin: Vec2,
  direction: number,
  target: Vec2,
  coneAngleDeg: number
): boolean {
  /** Calculate angle from origin to target */
  const angleToTarget = angleBetween(origin, target);

  /** Calculate the angular difference between facing direction and target direction */
  let angleDiff = angleToTarget - direction;

  /**
   * Normalize angle difference to [-PI, PI] range.
   * This handles the wrap-around case (e.g., facing 170 degrees,
   * target at -170 degrees should be a difference of 20 degrees, not 340).
   */
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
  while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

  /** Convert half the cone angle from degrees to radians for comparison */
  const halfConeRad = degreesToRadians(coneAngleDeg / 2);

  return Math.abs(angleDiff) <= halfConeRad;
}

// ----------------------------------------------------------------------------
// ANGLE CONVERSION UTILITIES
// Convenience functions for converting between degrees and radians.
// Game designers think in degrees; math functions use radians.
// ----------------------------------------------------------------------------

/**
 * Converts an angle from degrees to radians.
 *
 * Formula: degrees * (PI / 180)
 *
 * Common conversions:
 *   90 degrees  = PI/2 radians  (~1.571)
 *   180 degrees = PI radians    (~3.142)
 *   360 degrees = 2*PI radians  (~6.283)
 *
 * @param deg - Angle in degrees
 * @returns Angle in radians
 */
export function degreesToRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Converts an angle from radians to degrees.
 *
 * Formula: radians * (180 / PI)
 *
 * @param rad - Angle in radians
 * @returns Angle in degrees
 */
export function radiansToDegrees(rad: number): number {
  return rad * (180 / Math.PI);
}

// ----------------------------------------------------------------------------
// LINE-OF-SIGHT (LOS) GEOMETRY
// Used to check if a bullet or sightline passes through a wall/obstacle.
// The map is composed of axis-aligned rectangles (walls, boxes, etc.).
// ----------------------------------------------------------------------------

/**
 * Checks whether a line segment intersects with an axis-aligned rectangle.
 * Used for line-of-sight (LOS) checks: can soldier A see soldier B,
 * or is there a wall in the way?
 *
 * Algorithm: Uses the Liang-Barsky line clipping algorithm.
 * Tests the line segment against each of the 4 edges of the rectangle.
 * If the line enters and exits the rectangle (tMin < tMax and within [0,1]),
 * there is an intersection.
 *
 * The rectangle is defined by its top-left corner (x, z) and dimensions
 * (width, height). In our coordinate system:
 *   - rect.x is the left edge
 *   - rect.x + rect.width is the right edge
 *   - rect.z is the top edge
 *   - rect.z + rect.height is the bottom edge
 *
 * @param p1 - Start point of the line segment
 * @param p2 - End point of the line segment
 * @param rect - Axis-aligned rectangle with {x, z, width, height}
 * @returns true if the line segment intersects the rectangle
 */
export function lineIntersectsRect(
  p1: Vec2,
  p2: Vec2,
  rect: { x: number; z: number; width: number; height: number }
): boolean {
  /** Direction vector of the line segment */
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;

  /**
   * Liang-Barsky parameters.
   * p[i] = -dx, dx, -dz, dz (edge normals)
   * q[i] = corresponding signed distances from p1 to each edge
   */
  const p = [-dx, dx, -dz, dz];
  const q = [
    p1.x - rect.x,                     // Distance from p1 to left edge
    rect.x + rect.width - p1.x,        // Distance from p1 to right edge
    p1.z - rect.z,                      // Distance from p1 to top edge
    rect.z + rect.height - p1.z,       // Distance from p1 to bottom edge
  ];

  /** tMin and tMax track the valid range of the parameter t along the line */
  let tMin = 0;
  let tMax = 1;

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      /**
       * Line is parallel to this edge.
       * If q[i] < 0, line is outside the rectangle on this side -> no intersection.
       */
      if (q[i] < 0) {
        return false;
      }
      // Otherwise, line is between the parallel edges, continue checking
    } else {
      /** Calculate parameter t where the line crosses this edge */
      const t = q[i] / p[i];

      if (p[i] < 0) {
        // Line is entering the rectangle on this side
        tMin = Math.max(tMin, t);
      } else {
        // Line is exiting the rectangle on this side
        tMax = Math.min(tMax, t);
      }

      /**
       * If tMin > tMax, the line enters the rectangle AFTER it exits,
       * meaning there is no actual intersection.
       */
      if (tMin > tMax) {
        return false;
      }
    }
  }

  // tMin <= tMax and both are within [0, 1]: the line segment intersects the rectangle
  return true;
}
