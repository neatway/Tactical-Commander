/**
 * @file Renderer.ts
 * @description Main Three.js renderer setup for the tactical commander game.
 * Manages the WebGL rendering pipeline, orthographic camera for top-down view,
 * scene lighting, and coordinate conversion utilities. This is the core rendering
 * entry point that all other rendering modules depend on.
 */

import * as THREE from 'three';

/**
 * Main renderer class that encapsulates the Three.js rendering pipeline.
 *
 * Responsibilities:
 * - Initializes and configures the WebGLRenderer with quality settings
 * - Sets up an orthographic camera for a top-down tactical view
 * - Manages scene lighting (ambient, directional with shadows, hemisphere)
 * - Handles window resize events to keep the viewport correct
 * - Provides coordinate conversion from screen space to world space
 * - Supports camera zoom and pan operations
 *
 * @example
 * ```ts
 * const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
 * const renderer = new Renderer(canvas);
 * // In your game loop:
 * renderer.render();
 * ```
 */
export class Renderer {
  /** The root Three.js scene graph. All renderable objects are added here. */
  public scene: THREE.Scene;

  /**
   * Orthographic camera providing the top-down tactical view.
   * Orthographic projection ensures no perspective distortion,
   * which is ideal for a strategy/tactical game where distances
   * need to be visually consistent across the viewport.
   */
  public camera: THREE.OrthographicCamera;

  /**
   * The WebGL renderer instance responsible for drawing frames.
   * Configured with antialiasing, shadow maps, and tone mapping
   * for high-quality visual output.
   */
  public renderer: THREE.WebGLRenderer;

  /** Reference to the HTML canvas element that the renderer draws to. */
  public canvas: HTMLCanvasElement;

  /**
   * The base frustum half-height used as a reference for zoom calculations.
   * A value of 600 means the camera initially shows 1200 world units vertically.
   * The horizontal extent is derived from the aspect ratio.
   */
  private baseFrustumSize: number;

  /**
   * The current zoom level. 1.0 is the default view.
   * Values < 1.0 zoom in (show less of the map).
   * Values > 1.0 zoom out (show more of the map).
   */
  private currentZoom: number = 1.0;

  /**
   * Reusable raycaster instance for screen-to-world coordinate conversion.
   * Stored as a class property to avoid allocating a new one every frame.
   */
  private raycaster: THREE.Raycaster;

  /**
   * A horizontal plane at y=0 used as the ground reference for raycasting.
   * When converting screen coordinates to world positions, rays are intersected
   * with this plane to find the corresponding ground-level world position.
   */
  private groundPlane: THREE.Plane;

  /**
   * Creates and initializes the complete rendering pipeline.
   *
   * Sets up:
   * 1. WebGLRenderer with quality settings (antialias, shadows, tone mapping)
   * 2. Orthographic camera positioned for top-down view
   * 3. Three-light setup (ambient + directional + hemisphere) for
   *    realistic tactical map illumination
   * 4. Window resize listener for responsive viewport
   *
   * @param canvas - The HTML canvas element to render into.
   *                 Must already be inserted into the DOM.
   */
  constructor(canvas: HTMLCanvasElement) {
    /* Store canvas reference for later use (e.g., resize calculations) */
    this.canvas = canvas;

    /* ----- Scene Setup ----- */
    /** Create the root scene that will hold all 3D objects */
    this.scene = new THREE.Scene();

    /* ----- WebGL Renderer Configuration ----- */
    /**
     * Initialize WebGLRenderer with high-quality settings:
     * - antialias: Smooth jagged edges on geometry
     * - canvas: Render to the provided canvas element
     * - ACES Filmic tone mapping: Cinematic tone curve that handles
     *   bright highlights gracefully and gives a natural look
     * - sRGB output: Correct color space for display on standard monitors
     * - Shadow maps: Enable dynamic shadows for directional light
     * - PCFSoft shadow type: Soft-edged shadows that look more natural
     */
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    /* Set initial renderer size to fill the browser window */
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    /* Enable device pixel ratio for sharp rendering on HiDPI displays */
    this.renderer.setPixelRatio(window.devicePixelRatio);

    /* ----- Orthographic Camera Setup ----- */
    /**
     * Calculate the camera frustum dimensions based on the window aspect ratio.
     * The frustum defines the visible rectangular volume for the orthographic camera.
     *
     * baseFrustumSize is the half-height of the visible area in world units.
     * The horizontal extent is derived from the aspect ratio.
     */
    this.baseFrustumSize = 600;
    const aspect = window.innerWidth / window.innerHeight;

    this.camera = new THREE.OrthographicCamera(
      -this.baseFrustumSize * aspect, /* left   - negative half-width  */
      this.baseFrustumSize * aspect,  /* right  - positive half-width  */
      this.baseFrustumSize,           /* top    - positive half-height */
      -this.baseFrustumSize,          /* bottom - negative half-height */
      1,                              /* near clipping plane           */
      5000                            /* far clipping plane            */
    );

    /**
     * Position the camera high above the map looking straight down.
     * y=800 ensures we are well within the near/far range (1..5000).
     * rotation.x = -PI/2 points the camera directly downward (-Y direction).
     */
    this.camera.position.set(0, 800, 0);
    this.camera.rotation.x = -Math.PI / 2;

    /* ----- Lighting Setup ----- */

    /**
     * Ambient light provides uniform base illumination to all objects.
     * Intensity 0.4 ensures shadows are never pitch black, simulating
     * indirect light scattering in an outdoor environment.
     */
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    /**
     * Directional light simulates sunlight - a single distant light source
     * that casts parallel rays. Positioned at (500, 1000, 500) to create
     * shadows that fall at a natural diagonal angle.
     *
     * Shadow configuration:
     * - mapSize 2048x2048: High-resolution shadow map for crisp shadow edges
     * - Shadow camera covers a large area (-1500 to 1500) to encompass
     *   the entire playable map area without shadow clipping
     */
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(500, 1000, 500);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;

    /* Configure the shadow camera frustum to cover the entire map area */
    directionalLight.shadow.camera.left = -1500;
    directionalLight.shadow.camera.right = 1500;
    directionalLight.shadow.camera.top = 1500;
    directionalLight.shadow.camera.bottom = -1500;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 3000;

    this.scene.add(directionalLight);

    /**
     * Hemisphere light provides subtle color bleed between sky and ground.
     * Sky color (light blue) tints upward-facing surfaces with a cool tone.
     * Ground color (sandy tan) tints downward-facing surfaces warmly.
     * Low intensity (0.3) keeps the effect subtle and natural.
     */
    const hemisphereLight = new THREE.HemisphereLight(
      0x87ceeb, /* sky color   - light blue    */
      0xc4a46c, /* ground color - sandy tan     */
      0.3       /* intensity   - subtle effect  */
    );
    this.scene.add(hemisphereLight);

    /* ----- Raycasting Utilities ----- */
    /** Reusable raycaster for screen-to-world conversions */
    this.raycaster = new THREE.Raycaster();

    /**
     * Ground plane at y=0, facing upward (normal = +Y).
     * Used as the intersection target when converting screen coordinates
     * to world positions. The constant (0) means the plane passes through
     * the origin on the Y axis.
     */
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    /* ----- Event Listeners ----- */
    /** Listen for window resize to keep the viewport and camera frustum correct */
    window.addEventListener('resize', this.resize.bind(this));
  }

  /**
   * Renders a single frame of the scene using the current camera.
   * Should be called once per frame in the game loop
   * (typically via requestAnimationFrame).
   */
  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Handles window resize events by recalculating the camera frustum
   * and updating the renderer viewport size.
   *
   * The orthographic frustum is recalculated to maintain the correct
   * aspect ratio while respecting the current zoom level.
   */
  public resize(): void {
    /* Get the new window dimensions */
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    /* Recalculate the orthographic frustum with the new aspect ratio */
    const frustumHalfHeight = this.baseFrustumSize * this.currentZoom;
    const frustumHalfWidth = frustumHalfHeight * aspect;

    this.camera.left = -frustumHalfWidth;
    this.camera.right = frustumHalfWidth;
    this.camera.top = frustumHalfHeight;
    this.camera.bottom = -frustumHalfHeight;

    /* Tell Three.js to recompute the projection matrix with new values */
    this.camera.updateProjectionMatrix();

    /* Update the renderer output size and pixel ratio */
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }

  /**
   * Converts screen (pixel) coordinates to a world-space position on the
   * ground plane (y=0).
   *
   * This is essential for translating mouse clicks/movements into game-world
   * positions. It works by casting a ray from the camera through the screen
   * point and finding where that ray intersects the horizontal ground plane.
   *
   * @param screenX - The X position in pixels from the left edge of the canvas.
   * @param screenY - The Y position in pixels from the top edge of the canvas.
   * @returns A THREE.Vector3 representing the world-space intersection point.
   *          Returns (0, 0, 0) if the ray does not intersect the plane.
   */
  public getWorldPosition(screenX: number, screenY: number): THREE.Vector3 {
    /**
     * Convert pixel coordinates to Normalized Device Coordinates (NDC).
     * NDC ranges from -1 to +1 on both axes:
     * - X: -1 at the left edge, +1 at the right edge
     * - Y: +1 at the top edge, -1 at the bottom edge (inverted from screen)
     */
    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;

    /* Set the raycaster to cast a ray from the camera through the NDC point */
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    /* Attempt to find intersection with the ground plane at y=0 */
    const intersectionPoint = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(
      this.groundPlane,
      intersectionPoint
    );

    /* Return intersection point, or origin if no hit (should not happen top-down) */
    if (hit) {
      return intersectionPoint;
    }
    return new THREE.Vector3(0, 0, 0);
  }

  /**
   * Returns a reference to the orthographic camera.
   * Useful for other systems that need to query or manipulate the camera
   * directly (e.g., the CameraController).
   *
   * @returns The orthographic camera instance.
   */
  public getCamera(): THREE.OrthographicCamera {
    return this.camera;
  }

  /**
   * Returns a reference to the Three.js scene graph.
   * Other rendering modules (MapRenderer, SoldierRenderer) need this
   * to add their objects to the scene.
   *
   * @returns The root scene instance.
   */
  public getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Adjusts the camera zoom level by resizing the orthographic frustum.
   *
   * Zoom works inversely to frustum size:
   * - zoom=1.0: Default view (baseFrustumSize)
   * - zoom=0.5: Zoomed IN - frustum is smaller, shows less world area
   * - zoom=2.0: Zoomed OUT - frustum is larger, shows more world area
   *
   * @param zoom - The desired zoom level. Applied directly; external callers
   *               (e.g., CameraController) should handle clamping.
   */
  public setZoom(zoom: number): void {
    this.currentZoom = zoom;

    /* Recalculate frustum dimensions based on the new zoom level */
    const aspect = window.innerWidth / window.innerHeight;
    const frustumHalfHeight = this.baseFrustumSize * this.currentZoom;
    const frustumHalfWidth = frustumHalfHeight * aspect;

    /* Apply new frustum bounds to the camera */
    this.camera.left = -frustumHalfWidth;
    this.camera.right = frustumHalfWidth;
    this.camera.top = frustumHalfHeight;
    this.camera.bottom = -frustumHalfHeight;

    /* Recompute the projection matrix to apply changes */
    this.camera.updateProjectionMatrix();
  }

  /**
   * Pans (translates) the camera in the XZ ground plane.
   *
   * Since the camera looks straight down (along -Y), panning moves
   * the camera X and Z coordinates. The Y position stays fixed
   * at the configured height (800).
   *
   * @param dx - The amount to move along the X axis (positive = right).
   * @param dz - The amount to move along the Z axis
   *             (positive = south on map / into screen).
   */
  public panCamera(dx: number, dz: number): void {
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }
}
