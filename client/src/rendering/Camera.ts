/**
 * @file Camera.ts
 * @description Camera controller for the top-down tactical view.
 * Handles panning (WASD/arrow keys), zooming (scroll wheel), and smooth
 * camera transitions. Provides utility methods for screen-to-world
 * coordinate conversion and visibility bounds queries.
 */

import * as THREE from 'three';

/**
 * Input state object describing which directional/zoom keys are currently held.
 * All fields are booleans indicating pressed state.
 */
interface CameraInput {
  /** Whether the pan-left key (A or Left Arrow) is pressed. */
  panLeft: boolean;
  /** Whether the pan-right key (D or Right Arrow) is pressed. */
  panRight: boolean;
  /** Whether the pan-up key (W or Up Arrow) is pressed. */
  panUp: boolean;
  /** Whether the pan-down key (S or Down Arrow) is pressed. */
  panDown: boolean;
  /** Whether the zoom-in key/action is active. */
  zoomIn: boolean;
  /** Whether the zoom-out key/action is active. */
  zoomOut: boolean;
}

/**
 * Controls the orthographic camera for the tactical top-down view.
 *
 * Features:
 * - WASD/arrow key panning with configurable speed
 * - Smooth zoom with min/max limits
 * - Camera position clamped to map bounds
 * - Screen-to-world coordinate conversion
 * - Smooth focus-on transitions
 * - Visible bounds queries
 *
 * @example
 * ```ts
 * const controller = new CameraController(camera, 2400, 2400);
 * // In game loop:
 * controller.update(deltaTime, inputState);
 * ```
 */
export class CameraController {
  /** Reference to the orthographic camera being controlled. */
  private camera: THREE.OrthographicCamera;

  /** Minimum allowed zoom level (most zoomed in). */
  private minZoom: number = 0.3;

  /** Maximum allowed zoom level (most zoomed out). */
  private maxZoom: number = 3.0;

  /** Current zoom level. 1.0 is the default view. */
  private currentZoom: number = 1.0;

  /**
   * Target zoom level for smooth interpolation.
   * The actual zoom lerps toward this value each frame.
   */
  private targetZoom: number = 1.0;

  /**
   * Camera pan speed in world units per second.
   * At zoom=1.0, this is how fast the camera moves when a key is held.
   */
  private panSpeed: number = 500;

  /** Zoom change speed per frame when zoom keys are held. */
  private zoomSpeed: number = 0.1;

  /** Current camera position on the XZ ground plane. */
  private position: { x: number; z: number };

  /**
   * Map dimensions used for clamping camera position.
   * Camera cannot pan beyond the map edges (with padding).
   */
  private mapBounds: { width: number; height: number };

  /**
   * Target position for smooth focus-on transitions.
   * When not null, the camera smoothly pans to this position.
   */
  private focusTarget: { x: number; z: number } | null = null;

  /**
   * Base frustum half-height, cached from the camera's initial state.
   * Used to recalculate the frustum when zoom changes.
   */
  private baseFrustumSize: number;

  /**
   * Reusable raycaster for screen-to-world conversions.
   * Cached to avoid per-frame allocations.
   */
  private raycaster: THREE.Raycaster;

  /**
   * Ground plane at y=0 for raycasting screen-to-world conversions.
   */
  private groundPlane: THREE.Plane;

  /**
   * Creates a new CameraController for the given orthographic camera.
   *
   * Initializes position tracking, map bounds, and raycasting utilities.
   * The camera's current position is used as the starting point.
   *
   * @param camera - The Three.js orthographic camera to control.
   * @param mapWidth - Total map width in world units (for clamping).
   * @param mapHeight - Total map height in world units (for clamping).
   */
  constructor(
    camera: THREE.OrthographicCamera,
    mapWidth: number,
    mapHeight: number
  ) {
    this.camera = camera;
    this.mapBounds = { width: mapWidth, height: mapHeight };

    /* Initialize position from camera's current world position */
    this.position = {
      x: camera.position.x,
      z: camera.position.z,
    };

    /**
     * Cache the base frustum size from the camera's current top value.
     * This represents the half-height of the default (zoom=1.0) view.
     */
    this.baseFrustumSize = camera.top;

    /* Initialize raycasting utilities */
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  /**
   * Updates the camera position and zoom based on current input state.
   *
   * Should be called once per frame in the game loop. Handles:
   * 1. Directional panning from WASD/arrow key input
   * 2. Position clamping within map bounds
   * 3. Smooth zoom interpolation toward target
   * 4. Smooth focus-on transitions
   * 5. Camera frustum recalculation on zoom change
   *
   * @param deltaTime - Time elapsed since last frame in seconds.
   *                    Used to make pan speed frame-rate independent.
   * @param input - Current state of all camera control keys.
   */
  public update(deltaTime: number, input: CameraInput): void {
    /* ----- Panning ----- */
    /**
     * Calculate pan offset from directional input.
     * Multiply by panSpeed and deltaTime for frame-rate independent movement.
     * Positive X = right, Positive Z = down (south on the map).
     */
    let dx = 0;
    let dz = 0;

    if (input.panLeft) dx -= this.panSpeed * deltaTime;
    if (input.panRight) dx += this.panSpeed * deltaTime;
    if (input.panUp) dz -= this.panSpeed * deltaTime;    /* Up = -Z (north) */
    if (input.panDown) dz += this.panSpeed * deltaTime;  /* Down = +Z (south) */

    /* Apply pan offset to position */
    this.position.x += dx;
    this.position.z += dz;

    /* ----- Zooming ----- */
    /**
     * Adjust target zoom based on zoom input.
     * Clamp to min/max to prevent extreme zoom levels.
     */
    if (input.zoomIn) {
      this.targetZoom = Math.max(this.minZoom, this.targetZoom - this.zoomSpeed);
    }
    if (input.zoomOut) {
      this.targetZoom = Math.min(this.maxZoom, this.targetZoom + this.zoomSpeed);
    }

    /**
     * Smoothly interpolate current zoom toward target zoom.
     * Lerp factor of 0.1 gives a smooth, responsive feel.
     */
    this.currentZoom += (this.targetZoom - this.currentZoom) * 0.1;

    /* ----- Focus Transition ----- */
    /**
     * If a focus target is set, smoothly pan toward it.
     * Once close enough (< 1 world unit), clear the target.
     */
    if (this.focusTarget) {
      const lerpFactor = 0.05; /* Smooth but noticeable */
      this.position.x += (this.focusTarget.x - this.position.x) * lerpFactor;
      this.position.z += (this.focusTarget.z - this.position.z) * lerpFactor;

      /** Check if we've arrived (close enough to target) */
      const dist = Math.sqrt(
        Math.pow(this.focusTarget.x - this.position.x, 2) +
        Math.pow(this.focusTarget.z - this.position.z, 2)
      );
      if (dist < 1) {
        this.focusTarget = null; /* Arrived, stop transitioning */
      }
    }

    /* ----- Clamping ----- */
    /**
     * Clamp camera position within map bounds with padding.
     * Padding of 100 units allows the player to slightly overshoot
     * the map edges, which feels more natural than a hard stop.
     */
    const padding = 100;
    this.position.x = Math.max(-padding, Math.min(this.mapBounds.width + padding, this.position.x));
    this.position.z = Math.max(-padding, Math.min(this.mapBounds.height + padding, this.position.z));

    /* ----- Apply to Camera ----- */
    /** Update the actual Three.js camera position */
    this.camera.position.x = this.position.x;
    this.camera.position.z = this.position.z;

    /* ----- Update Frustum ----- */
    /**
     * Recalculate the orthographic frustum based on current zoom.
     * The frustum size scales with zoom: larger zoom = more visible area.
     */
    const aspect = window.innerWidth / window.innerHeight;
    const frustumHalfHeight = this.baseFrustumSize * this.currentZoom;
    const frustumHalfWidth = frustumHalfHeight * aspect;

    this.camera.left = -frustumHalfWidth;
    this.camera.right = frustumHalfWidth;
    this.camera.top = frustumHalfHeight;
    this.camera.bottom = -frustumHalfHeight;

    /** Recompute projection matrix to apply frustum changes */
    this.camera.updateProjectionMatrix();
  }

  /**
   * Sets the zoom level directly (bypassing smooth interpolation).
   * Useful for programmatic zoom changes (e.g., reset to default).
   *
   * @param zoom - The desired zoom level. Clamped to [minZoom, maxZoom].
   */
  public setZoom(zoom: number): void {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.currentZoom = this.targetZoom; /* Skip interpolation */
  }

  /**
   * Returns the current zoom level.
   *
   * @returns The current zoom value (1.0 = default, <1 = zoomed in, >1 = zoomed out).
   */
  public getZoom(): number {
    return this.currentZoom;
  }

  /**
   * Converts screen (pixel) coordinates to world-space position on the
   * ground plane (y=0).
   *
   * Uses raycasting from the camera through the screen point to find
   * where it intersects the horizontal ground plane. Essential for
   * translating mouse interactions into game-world coordinates.
   *
   * @param screenX - X position in pixels from the left edge of the viewport.
   * @param screenY - Y position in pixels from the top edge of the viewport.
   * @param renderer - The Three.js WebGLRenderer (needed for viewport size).
   * @returns World-space position {x, z} on the ground plane.
   */
  public screenToWorld(
    screenX: number,
    screenY: number,
    renderer: THREE.WebGLRenderer
  ): { x: number; z: number } {
    /** Get the renderer's viewport dimensions */
    const size = new THREE.Vector2();
    renderer.getSize(size);

    /**
     * Convert screen pixels to Normalized Device Coordinates (NDC).
     * NDC X ranges from -1 (left) to +1 (right).
     * NDC Y ranges from +1 (top) to -1 (bottom) -- inverted from screen.
     */
    const ndcX = (screenX / size.x) * 2 - 1;
    const ndcY = -(screenY / size.y) * 2 + 1;

    /** Cast a ray from the camera through the NDC point */
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    /** Find where the ray intersects the ground plane at y=0 */
    const intersectionPoint = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersectionPoint);

    if (hit) {
      return { x: intersectionPoint.x, z: intersectionPoint.z };
    }

    /* Fallback to camera position if ray misses (should not happen top-down) */
    return { x: this.position.x, z: this.position.z };
  }

  /**
   * Initiates a smooth pan transition to center the camera on a world position.
   *
   * The camera will smoothly interpolate to the target position over subsequent
   * update() calls. Any ongoing focus transition is replaced.
   *
   * @param worldX - Target X coordinate in world space.
   * @param worldZ - Target Z coordinate in world space.
   */
  public focusOn(worldX: number, worldZ: number): void {
    this.focusTarget = { x: worldX, z: worldZ };
  }

  /**
   * Returns the world-space bounds of what is currently visible on screen.
   *
   * Calculates the rectangular area visible to the orthographic camera
   * based on its current position and frustum size. Useful for culling,
   * minimap viewport indicators, and other visibility checks.
   *
   * @returns An object with {minX, maxX, minZ, maxZ} defining the
   *          visible rectangle in world space.
   */
  public getVisibleBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    /**
     * For an orthographic camera looking straight down:
     * - camera.left/right define the horizontal extent
     * - camera.top/bottom define the vertical extent (mapped to Z in world space)
     * These are relative to the camera's position.
     */
    return {
      minX: this.camera.position.x + this.camera.left,
      maxX: this.camera.position.x + this.camera.right,
      minZ: this.camera.position.z + this.camera.bottom,
      maxZ: this.camera.position.z + this.camera.top,
    };
  }
}
