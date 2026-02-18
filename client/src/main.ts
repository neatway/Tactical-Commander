/**
 * main.ts - Application entry point
 *
 * This is the first file that runs when the game loads in the browser.
 * It grabs the canvas element, creates the Game instance, and starts the match.
 *
 * Vite handles bundling this file and all its imports into a single
 * optimized JavaScript bundle for the browser.
 */

import { Game } from './game/Game';

// ============================================================
// Boot Sequence
// ============================================================

/**
 * Initialize and start the game.
 * Waits for the DOM to be ready before accessing canvas.
 */
async function boot(): Promise<void> {
  console.log('=== Tactical Commander v0.1.0 ===');
  console.log('Initializing...');

  /* Get the canvas element from the HTML */
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    console.error('Could not find #game-canvas element!');
    return;
  }

  /* Create the game instance - this sets up Three.js, input, and all subsystems */
  const game = new Game(canvas);

  /* Start a match immediately for testing */
  /* TODO: Show main menu first, let player choose to start match */
  try {
    await game.startMatch();
    console.log('Game is running. Use WASD to pan camera, scroll to zoom.');
    console.log('Click a soldier to select, click map to move.');
  } catch (error) {
    console.error('Failed to start match:', error);
  }

  /* Expose game instance globally for debugging in browser console */
  (window as any).__game = game;
}

/* Start when the page is loaded */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  /* DOM already loaded (e.g., script is at bottom of body) */
  boot();
}
