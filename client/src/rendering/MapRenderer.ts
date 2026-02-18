/**
 * @file MapRenderer.ts
 * @description Renders the game map from JSON data using Three.js.
 * Handles creation of the floor plane, grid overlay, walls, cover objects,
 * bomb sites, spawn zones, and plant zones. All geometry is generated
 * procedurally from MapData structures received from the server.
 */

import * as THREE from 'three';
import type { MapData, Wall, CoverObject, BombSite, Zone } from '@shared/types/MapTypes';

/**
 * Responsible for rendering the tactical game map in 3D.
 *
 * Converts abstract map data (walls, cover, bomb sites, spawn zones) into
 * Three.js geometry and materials. All map objects are tracked internally
 * so they can be cleared and rebuilt when a new map is loaded.
 *
 * @example
 * ```ts
 * const mapRenderer = new MapRenderer(scene);
 * mapRenderer.loadMap(mapData);
 * // Later, to switch maps:
 * mapRenderer.clearMap();
 * mapRenderer.loadMap(newMapData);
 * ```
 */
export class MapRenderer {
  /** Reference to the Three.js scene where map objects are added. */
  private scene: THREE.Scene;

  /**
   * Array tracking all Three.js objects created for the current map.
   * Used by clearMap() to remove everything when switching maps.
   */
  private mapObjects: THREE.Object3D[] = [];

  /**
   * Creates a new MapRenderer attached to the given scene.
   *
   * @param scene - The Three.js scene to add map geometry to.
   */
  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Loads and renders a complete game map from structured data.
   *
   * Creates all visual elements of the map:
   * 1. Floor plane with sandy texture
   * 2. Subtle grid lines for distance gauging
   * 3. Walls (tall obstacles that block movement and vision)
   * 4. Cover objects (shorter obstacles for tactical positioning)
   * 5. Bomb site overlays (semi-transparent colored zones)
   * 6. Spawn zone indicators
   * 7. Plant zone highlights
   *
   * @param mapData - The complete map definition including dimensions,
   *                  walls, cover, bomb sites, and spawn zones.
   */
  public loadMap(mapData: MapData): void {
    /* Clear any previously loaded map geometry */
    this.clearMap();

    /* ----- Floor Plane ----- */
    /**
     * Create a large horizontal plane to serve as the ground.
     * PlaneGeometry is created in the XY plane by default, so we rotate
     * it -90 degrees around X to lay it flat in the XZ plane.
     * Color #b8a68a gives a dusty sand appearance.
     */
    const floorGeometry = new THREE.PlaneGeometry(mapData.width, mapData.height);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8a68a,    /* dusty sand color */
      roughness: 0.9,     /* very rough surface for matte look */
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2; /* Rotate to horizontal (XZ plane) */
    floor.position.set(mapData.width / 2, 0, mapData.height / 2); /* Center on map */
    floor.receiveShadow = true; /* Floor receives shadows from walls/objects */
    this.addToScene(floor);

    /* ----- Grid Lines ----- */
    /**
     * Draw subtle grid lines every 200 world units to help the player
     * gauge distances during tactical planning. Lines are very faint
     * (opacity 0.1) so they do not distract from gameplay.
     */
    this.createGridLines(mapData.width, mapData.height, 200);

    /* ----- Walls ----- */
    /**
     * Walls are tall rectangular obstacles that block movement and line of sight.
     * Each wall is a box with configurable dimensions and a sandy tan color.
     */
    if (mapData.walls) {
      for (const wall of mapData.walls) {
        this.createWall(wall);
      }
    }

    /* ----- Cover Objects ----- */
    /**
     * Cover objects are shorter obstacles (default 50 units tall) that soldiers
     * can hide behind. They use a warm brown color to distinguish from walls.
     */
    if (mapData.cover) {
      for (const cover of mapData.cover) {
        this.createCover(cover);
      }
    }

    /* ----- Bomb Sites ----- */
    /**
     * Bomb sites are key objective areas. Each gets a semi-transparent overlay
     * and a floating text label ("A" or "B"). Site A is red-tinted, B is blue.
     */
    if (mapData.bombSites) {
      for (const site of mapData.bombSites) {
        this.createBombSite(site);
      }
    }

    /* ----- Spawn Zones ----- */
    /**
     * Spawn zones show where each team starts. Attackers get an orange overlay,
     * defenders get a blue overlay. Very low opacity to be subtle.
     */
    if (mapData.spawnZones) {
      for (const zone of mapData.spawnZones) {
        this.createSpawnZone(zone);
      }
    }

    /* ----- Plant Zones ----- */
    /**
     * Plant zones are sub-areas within bomb sites where the bomb can actually
     * be planted. They get a slightly brighter overlay than the bomb site itself.
     */
    if (mapData.plantZones) {
      for (const zone of mapData.plantZones) {
        this.createPlantZone(zone);
      }
    }
  }

  /**
   * Removes all map objects from the scene and clears the tracking array.
   * Call this before loading a new map to prevent visual artifacts from
   * the previous map remaining in the scene.
   */
  public clearMap(): void {
    for (const obj of this.mapObjects) {
      this.scene.remove(obj);

      /* Dispose of geometry and materials to free GPU memory */
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
    this.mapObjects = [];
  }

  /**
   * Creates subtle grid lines on the floor to help players gauge distances.
   *
   * The grid is drawn using LineSegments with a transparent white material.
   * Lines run along both the X and Z axes at regular intervals.
   *
   * @param mapWidth - Total width of the map in world units.
   * @param mapHeight - Total height (depth) of the map in world units.
   * @param spacing - Distance between grid lines in world units (default 200).
   */
  private createGridLines(mapWidth: number, mapHeight: number, spacing: number): void {
    /** Array of vertex positions for all grid line segments */
    const points: number[] = [];

    /* Vertical lines (parallel to Z axis) */
    for (let x = 0; x <= mapWidth; x += spacing) {
      points.push(x, 0.1, 0);          /* Line start (slightly above floor to prevent z-fighting) */
      points.push(x, 0.1, mapHeight);  /* Line end */
    }

    /* Horizontal lines (parallel to X axis) */
    for (let z = 0; z <= mapHeight; z += spacing) {
      points.push(0, 0.1, z);          /* Line start */
      points.push(mapWidth, 0.1, z);   /* Line end */
    }

    /** Create a BufferGeometry from the vertex positions */
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points, 3)
    );

    /**
     * Very faint white lines with low opacity.
     * Using LineBasicMaterial with transparency for subtle visual guide.
     */
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.1,
    });

    const gridLines = new THREE.LineSegments(geometry, material);
    this.addToScene(gridLines);
  }

  /**
   * Creates a single wall obstacle in the scene.
   *
   * Walls are tall rectangular boxes with a sandy tan color (#c4a46c).
   * They cast and receive shadows for visual depth. The wall is positioned
   * so that its origin aligns with the top-left corner defined in the
   * map data (x, z), offset by half its dimensions to center the geometry.
   *
   * @param wall - Wall definition containing position, dimensions, and elevation.
   */
  private createWall(wall: Wall): void {
    const wallGeometry = new THREE.BoxGeometry(
      wall.width,      /* X dimension */
      wall.elevation,  /* Y dimension (height of the wall) */
      wall.height      /* Z dimension (depth of the wall) */
    );

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xc4a46c,   /* sandy tan color */
      roughness: 0.7,    /* moderately rough surface */
    });

    const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);

    /**
     * Position the wall so its base sits on the ground (y=0) and its
     * corner aligns with the map data coordinates. BoxGeometry is centered
     * at origin, so we offset by half the dimensions.
     */
    wallMesh.position.set(
      wall.x + wall.width / 2,       /* Center X */
      wall.elevation / 2,             /* Raise so base is at y=0 */
      wall.z + wall.height / 2        /* Center Z */
    );

    wallMesh.castShadow = true;     /* Wall casts shadows onto the floor */
    wallMesh.receiveShadow = true;  /* Wall can receive shadows from other objects */

    this.addToScene(wallMesh);
  }

  /**
   * Creates a single cover object in the scene.
   *
   * Cover objects are similar to walls but shorter (default elevation of 50 units).
   * They provide tactical cover for soldiers. Colored warm brown (#8b7355)
   * to distinguish from taller walls.
   *
   * @param cover - Cover object definition with position and dimensions.
   */
  private createCover(cover: CoverObject): void {
    /** Use the cover's elevation if specified, otherwise default to 50 units */
    const elevation = cover.elevation ?? 50;

    const coverGeometry = new THREE.BoxGeometry(
      cover.width,    /* X dimension */
      elevation,      /* Y dimension (shorter than walls) */
      cover.height    /* Z dimension */
    );

    const coverMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b7355,   /* warm brown color */
      roughness: 0.7,    /* moderately rough surface */
    });

    const coverMesh = new THREE.Mesh(coverGeometry, coverMaterial);

    /** Position with base on ground, corner at map data coordinates */
    coverMesh.position.set(
      cover.x + cover.width / 2,
      elevation / 2,
      cover.z + cover.height / 2
    );

    coverMesh.castShadow = true;
    coverMesh.receiveShadow = true;

    this.addToScene(coverMesh);
  }

  /**
   * Creates a bomb site overlay and floating label in the scene.
   *
   * Each bomb site gets:
   * 1. A semi-transparent colored plane overlay on the ground
   *    - Site A: red (#ff4444) with 15% opacity
   *    - Site B: blue (#4444ff) with 15% opacity
   * 2. A floating text sprite showing "A" or "B" above the site
   *
   * @param site - Bomb site definition with label, position, and dimensions.
   */
  private createBombSite(site: BombSite): void {
    /**
     * Choose overlay color based on site label.
     * Site A is red-tinted, site B is blue-tinted.
     */
    const color = site.label === 'A' ? 0xff4444 : 0x4444ff;
    const opacity = 0.15;

    /** Create a flat plane overlay at ground level */
    const overlayGeometry = new THREE.PlaneGeometry(site.width, site.height);
    const overlayMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      side: THREE.DoubleSide,
      depthWrite: false, /* Prevent z-fighting with floor */
    });

    const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
    overlay.rotation.x = -Math.PI / 2; /* Lay flat on XZ plane */

    /** Position slightly above floor to prevent z-fighting */
    overlay.position.set(
      site.x + site.width / 2,
      0.2,
      site.z + site.height / 2
    );

    this.addToScene(overlay);

    /**
     * Create a floating text sprite above the bomb site.
     * The sprite always faces the camera (billboard behavior).
     */
    const labelColor = site.label === 'A' ? '#ff4444' : '#4444ff';
    const textSprite = this.createTextSprite(site.label, labelColor, 64);

    /** Position the label floating 80 units above the center of the site */
    textSprite.position.set(
      site.x + site.width / 2,
      80,
      site.z + site.height / 2
    );

    this.addToScene(textSprite);
  }

  /**
   * Creates a spawn zone overlay in the scene.
   *
   * Spawn zones indicate where each team starts the round.
   * Attacker spawn is orange-tinted (#ff6600, 10% opacity).
   * Defender spawn is blue-tinted (#0066ff, 10% opacity).
   *
   * @param zone - Zone definition with team, position, and dimensions.
   */
  private createSpawnZone(zone: Zone): void {
    /** Orange for attackers, blue for defenders */
    const color = zone.team === 'attacker' ? 0xff6600 : 0x0066ff;

    const overlayGeometry = new THREE.PlaneGeometry(zone.width, zone.height);
    const overlayMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(
      zone.x + zone.width / 2,
      0.15,
      zone.z + zone.height / 2
    );

    this.addToScene(overlay);
  }

  /**
   * Creates a plant zone overlay within a bomb site.
   *
   * Plant zones show the exact area where the bomb can be planted.
   * They use a slightly brighter overlay than the parent bomb site
   * to draw attention to the plantable area.
   *
   * @param zone - Zone definition with position and dimensions.
   */
  private createPlantZone(zone: Zone): void {
    const overlayGeometry = new THREE.PlaneGeometry(zone.width, zone.height);
    const overlayMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,    /* bright amber to indicate plantable area */
      transparent: true,
      opacity: 0.2,       /* slightly brighter than bomb site overlay */
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(
      zone.x + zone.width / 2,
      0.25, /* Slightly above bomb site overlay to layer correctly */
      zone.z + zone.height / 2
    );

    this.addToScene(overlay);
  }

  /**
   * Creates a text sprite that always faces the camera (billboard).
   *
   * Renders text onto an off-screen canvas, then uses that canvas as a
   * texture for a Three.js Sprite. Sprites automatically face the camera
   * regardless of viewing angle, making them ideal for labels.
   *
   * @param text - The text string to display (e.g., "A" or "B").
   * @param color - CSS color string for the text (e.g., '#ff4444').
   * @param size - Font size in pixels for the canvas rendering.
   * @returns A THREE.Sprite with the rendered text as its texture.
   */
  public createTextSprite(text: string, color: string, size: number): THREE.Sprite {
    /**
     * Create an off-screen canvas for text rendering.
     * Canvas size is proportional to the font size for adequate resolution.
     */
    const canvas = document.createElement('canvas');
    const canvasSize = size * 4; /* Extra resolution for crisp text */
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    /** Get 2D drawing context and configure text rendering */
    const context = canvas.getContext('2d')\!;
    context.font = `bold ${size * 2}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.fillText(text, canvasSize / 2, canvasSize / 2);

    /** Create a Three.js texture from the canvas */
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    /** Create the sprite material with the text texture */
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });

    /** Create the sprite and scale it to a reasonable world-space size */
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(60, 60, 1); /* 60x60 world units for visibility */

    return sprite;
  }

  /**
   * Helper to add an object to both the scene and the tracking array.
   * All map objects should be added through this method so clearMap()
   * can properly clean them up.
   *
   * @param object - The Three.js object to add to the scene.
   */
  private addToScene(object: THREE.Object3D): void {
    this.scene.add(object);
    this.mapObjects.push(object);
  }
}
