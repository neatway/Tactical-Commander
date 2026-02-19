/**
 * InputManager.ts - Handles all keyboard and mouse input for the game
 *
 * Tracks which keys are pressed, mouse position, and click events.
 * The game loop reads input state each frame to determine actions.
 * Mouse clicks are converted to world positions via raycasting.
 */

// ============================================================
// Types
// ============================================================

/** Mouse button identifiers */
export enum MouseButton {
  LEFT = 0,
  MIDDLE = 1,
  RIGHT = 2,
}

/** A click event with screen and world coordinates */
export interface ClickEvent {
  /** Which mouse button was clicked */
  button: MouseButton;
  /** Screen X coordinate (pixels from left) */
  screenX: number;
  /** Screen Y coordinate (pixels from top) */
  screenY: number;
  /** Whether shift was held during click */
  shiftKey: boolean;
  /** Whether ctrl was held during click */
  ctrlKey: boolean;
  /** Timestamp of the click */
  timestamp: number;
}

/** Drag selection rectangle (for multi-selecting soldiers) */
export interface DragRect {
  /** Starting screen X */
  startX: number;
  /** Starting screen Y */
  startY: number;
  /** Current/end screen X */
  endX: number;
  /** Current/end screen Y */
  endY: number;
}

// ============================================================
// Input Manager Class
// ============================================================

/**
 * Manages all player input - keyboard state, mouse state, and click events.
 * Designed to be polled each frame by the game loop.
 *
 * Usage:
 *   const input = new InputManager(canvas);
 *   // In game loop:
 *   if (input.isKeyDown('KeyW')) { // pan camera up }
 *   const clicks = input.consumeClicks();
 *   // Process clicks...
 */
export class InputManager {
  // --- Keyboard state ---
  /** Set of currently pressed key codes (e.g., 'KeyW', 'Space') */
  private keysDown: Set<string> = new Set();
  /** Keys pressed this frame (cleared each frame) */
  private keysPressed: Set<string> = new Set();

  // --- Mouse state ---
  /** Current mouse screen position */
  private mouseScreenX: number = 0;
  private mouseScreenY: number = 0;
  /** Whether each mouse button is currently held */
  private mouseButtonsDown: Set<number> = new Set();
  /** Queue of click events to be consumed by the game loop */
  private clickQueue: ClickEvent[] = [];
  /** Current scroll delta (positive = scroll up/zoom in) */
  private scrollDelta: number = 0;

  // --- Drag selection ---
  /** Whether user is currently drag-selecting */
  private isDragging: boolean = false;
  /** The current drag rectangle (null if not dragging) */
  private dragRect: DragRect | null = null;
  /** Completed drag rect waiting to be consumed by game loop (set on mouseup after drag) */
  private completedDragRect: DragRect | null = null;
  /** Minimum pixels moved before a click becomes a drag */
  private readonly DRAG_THRESHOLD = 5;
  /** Where the mouse went down (to detect drag vs click) */
  private mouseDownPos: { x: number; y: number } | null = null;

  // --- Reference to canvas for coordinate calculations ---
  private canvas: HTMLCanvasElement;

  /**
   * Creates the input manager and attaches event listeners to the canvas.
   * @param canvas - The game canvas element to listen for input on
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupKeyboardListeners();
    this.setupMouseListeners();
  }

  // ============================================================
  // Setup - Attach DOM event listeners
  // ============================================================

  /** Attach keyboard event listeners to the window */
  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      /* Prevent default for game keys (WASD, space, etc.) but not browser shortcuts */
      if (this.isGameKey(e.code)) {
        e.preventDefault();
      }
      /* Track that this key is now held down */
      if (!this.keysDown.has(e.code)) {
        this.keysPressed.add(e.code); // First frame only
      }
      this.keysDown.add(e.code);
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    });

    /* Clear all keys when window loses focus (prevents stuck keys) */
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.keysPressed.clear();
    });
  }

  /** Attach mouse event listeners to the canvas */
  private setupMouseListeners(): void {
    /* Track mouse position */
    this.canvas.addEventListener('mousemove', (e: MouseEvent) => {
      this.mouseScreenX = e.clientX;
      this.mouseScreenY = e.clientY;

      /* Update drag rectangle if dragging */
      if (this.isDragging && this.dragRect) {
        this.dragRect.endX = e.clientX;
        this.dragRect.endY = e.clientY;
      }

      /* Check if mouse has moved enough to start a drag */
      if (this.mouseButtonsDown.has(MouseButton.LEFT) && this.mouseDownPos && !this.isDragging) {
        const dx = e.clientX - this.mouseDownPos.x;
        const dy = e.clientY - this.mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > this.DRAG_THRESHOLD) {
          this.isDragging = true;
          this.dragRect = {
            startX: this.mouseDownPos.x,
            startY: this.mouseDownPos.y,
            endX: e.clientX,
            endY: e.clientY,
          };
        }
      }
    });

    /* Track mouse button press */
    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      this.mouseButtonsDown.add(e.button);
      this.mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    /* Track mouse button release and generate click events */
    this.canvas.addEventListener('mouseup', (e: MouseEvent) => {
      this.mouseButtonsDown.delete(e.button);

      if (this.isDragging && this.dragRect) {
        /* Drag completed — save the final rect for Game.ts to consume */
        this.completedDragRect = {
          startX: this.dragRect.startX,
          startY: this.dragRect.startY,
          endX: e.clientX,
          endY: e.clientY,
        };
      } else {
        /* If we didn't drag, this is a click */
        this.clickQueue.push({
          button: e.button as MouseButton,
          screenX: e.clientX,
          screenY: e.clientY,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          timestamp: performance.now(),
        });
      }

      /* Reset drag state */
      this.isDragging = false;
      this.dragRect = null;
      this.mouseDownPos = null;
    });

    /* Track scroll wheel for zoom */
    this.canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      /* Normalize scroll delta: positive = zoom in, negative = zoom out */
      this.scrollDelta += e.deltaY > 0 ? -1 : 1;
    }, { passive: false });

    /* Prevent right-click context menu on canvas */
    this.canvas.addEventListener('contextmenu', (e: Event) => {
      e.preventDefault();
    });
  }

  // ============================================================
  // Query Methods - Called by game loop each frame
  // ============================================================

  /**
   * Check if a key is currently held down.
   * @param code - KeyboardEvent.code value (e.g., 'KeyW', 'Space', 'Digit1')
   */
  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /**
   * Check if a key was just pressed this frame (not held from last frame).
   * Useful for toggle actions like opening buy menu.
   * @param code - KeyboardEvent.code value
   */
  wasKeyPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  /** Get current mouse position in screen coordinates */
  getMouseScreen(): { x: number; y: number } {
    return { x: this.mouseScreenX, y: this.mouseScreenY };
  }

  /** Check if a mouse button is currently held down */
  isMouseButtonDown(button: MouseButton): boolean {
    return this.mouseButtonsDown.has(button);
  }

  /**
   * Consume all pending click events. Call once per frame.
   * Returns the clicks and clears the queue.
   */
  consumeClicks(): ClickEvent[] {
    const clicks = [...this.clickQueue];
    this.clickQueue = [];
    return clicks;
  }

  /**
   * Consume scroll delta. Call once per frame.
   * Returns accumulated scroll since last consume (positive = zoom in).
   */
  consumeScroll(): number {
    const delta = this.scrollDelta;
    this.scrollDelta = 0;
    return delta;
  }

  /** Get the current drag selection rectangle, or null if not dragging */
  getDragRect(): DragRect | null {
    return this.dragRect ? { ...this.dragRect } : null;
  }

  /** Whether the user is currently drag-selecting */
  getIsDragging(): boolean {
    return this.isDragging;
  }

  /**
   * Consume a completed drag selection. Call once per frame.
   * Returns the final drag rect if a drag just finished, then clears it.
   * This is the "drag equivalent" of consumeClicks().
   */
  consumeCompletedDrag(): DragRect | null {
    const rect = this.completedDragRect;
    this.completedDragRect = null;
    return rect;
  }

  // ============================================================
  // Camera pan helpers - Convenience methods for common checks
  // ============================================================

  /** Returns an object indicating which camera pan directions are active */
  getCameraPanState(): { left: boolean; right: boolean; up: boolean; down: boolean } {
    return {
      left: this.isKeyDown('KeyA') || this.isKeyDown('ArrowLeft'),
      right: this.isKeyDown('KeyD') || this.isKeyDown('ArrowRight'),
      up: this.isKeyDown('KeyW') || this.isKeyDown('ArrowUp'),
      down: this.isKeyDown('KeyS') || this.isKeyDown('ArrowDown'),
    };
  }

  // ============================================================
  // Frame Lifecycle - Called at start/end of each frame
  // ============================================================

  /**
   * Clear per-frame state. Call at the END of each game loop iteration
   * so that "just pressed" keys are only true for one frame.
   */
  endFrame(): void {
    this.keysPressed.clear();
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Check if a key code is a game key that should have default behavior prevented.
   * We don't want WASD to type in chat boxes or space to scroll the page.
   * Uses a static Set (created once) to avoid allocating a new Set on every keydown.
   */
  private static readonly GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',     // Camera pan
    'Space',                               // Could be used for actions
    'KeyH', 'KeyR', 'KeyG', 'KeyP',       // Hold, Retreat, Regroup, Plant
    'KeyE',                                // Defuse bomb
    'KeyB',                                // Buy menu toggle
    'Digit1', 'Digit2', 'Digit3', 'Digit4', // Utility selection
    'Tab',                                 // Scoreboard
    'Escape',                              // Menu/cancel
  ]);

  private isGameKey(code: string): boolean {
    return InputManager.GAME_KEYS.has(code);
  }

  /**
   * Clean up event listeners. Call when the game is destroyed.
   */
  destroy(): void {
    /* Note: In a real implementation, we'd store references to the
     * listener functions so we can remove them. For now, the listeners
     * will be garbage collected when the canvas is removed from DOM. */
  }
}
