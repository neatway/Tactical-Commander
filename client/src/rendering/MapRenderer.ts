/**
 * @file MapRenderer.ts
 * @description Renders the game map from MapData using Three.js.
 * Handles creation of the floor plane, grid overlay, walls, cover objects,
 * bomb sites, spawn zones, and plant zones. All geometry is generated
 * procedurally from MapData structures.
 */

import * as THREE from 'three';
import type { MapData, Wall, CoverObject, BombSite } from '@shared/types/MapTypes';

/**
 * Responsible for rendering the tactical game map in 3D.
 *
 * Converts abstract map data (walls, cover, bomb sites, spawn zones) into
 * Three.js geometry and materials. All map objects are tracked internally
 * so they can be cleared and rebuilt when a new map is loaded.
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
   * 7. Plant zone highlights within bomb sites
   *
   * @param mapData - The complete map definition.
   */
  public loadMap(mapData: MapData): void {
    /* Clear any previously loaded map geometry */
    this.clearMap();

    const mapWidth = mapData.dimensions.width;
    const mapHeight = mapData.dimensions.height;

    /* ----- Floor Plane ----- */
    /**
     * Create a large horizontal plane to serve as the ground.
     * PlaneGeometry is created in the XY plane by default, so we rotate
     * it -90 degrees around X to lay it flat in the XZ plane.
     */
    const floorGeometry = new THREE.PlaneGeometry(mapWidth, mapHeight);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8a68a,    /* dusty sand color */
      roughness: 0.9,     /* very rough surface for matte look */
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2; /* Rotate to horizontal (XZ plane) */
    floor.position.set(mapWidth / 2, 0, mapHeight / 2); /* Center on map */
    floor.receiveShadow = true; /* Floor receives shadows from walls/objects */
    this.addToScene(floor);

    /* ----- Grid Lines ----- */
    this.createGridLines(mapWidth, mapHeight, 200);

    /* ----- Walls ----- */
    if (mapData.walls) {
      for (const wall of mapData.walls) {
        this.createWall(wall);
      }
    }

    /* ----- Cover Objects ----- */
    if (mapData.cover) {
      for (const cover of mapData.cover) {
        this.createCover(cover);
      }
    }

    /* ----- Bomb Sites ----- */
    if (mapData.bombSites) {
      for (const site of mapData.bombSites) {
        this.createBombSite(site);
      }
    }

    /* ----- Spawn Zones ----- */
    if (mapData.spawnZones) {
      /* Attacker spawn (orange overlay) */
      this.createSpawnZone(mapData.spawnZones.attacker, 0xff6600);
      /* Defender spawn (blue overlay) */
      this.createSpawnZone(mapData.spawnZones.defender, 0x0066ff);
    }
  }

  /**
   * Removes all map objects from the scene and clears the tracking array.
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
   * @param mapWidth - Total width of the map in world units.
   * @param mapHeight - Total height (depth) of the map in world units.
   * @param spacing - Distance between grid lines in world units.
   */
  private createGridLines(mapWidth: number, mapHeight: number, spacing: number): void {
    const points: number[] = [];

    /* Vertical lines (parallel to Z axis) */
    for (let x = 0; x <= mapWidth; x += spacing) {
      points.push(x, 0.1, 0);
      points.push(x, 0.1, mapHeight);
    }

    /* Horizontal lines (parallel to X axis) */
    for (let z = 0; z <= mapHeight; z += spacing) {
      points.push(0, 0.1, z);
      points.push(mapWidth, 0.1, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points, 3)
    );

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
   * Walls are tall rectangular boxes with a sandy tan color.
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
      roughness: 0.7,
    });

    const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);

    /**
     * Position so its base sits on the ground and corner aligns
     * with the map data coordinates.
     */
    wallMesh.position.set(
      wall.x + wall.width / 2,
      wall.elevation / 2,
      wall.z + wall.height / 2
    );

    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    this.addToScene(wallMesh);
  }

  /**
   * Creates a single cover object in the scene.
   * Cover objects are shorter than walls, providing partial protection.
   * @param cover - Cover object definition with position and dimensions.
   */
  private createCover(cover: CoverObject): void {
    const elevation = cover.elevation ?? 50;

    const coverGeometry = new THREE.BoxGeometry(
      cover.width,
      elevation,
      cover.height
    );

    const coverMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b7355,   /* warm brown color */
      roughness: 0.7,
    });

    const coverMesh = new THREE.Mesh(coverGeometry, coverMaterial);
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
   * Each bomb site gets a semi-transparent colored zone overlay
   * plus a plant zone highlight and a floating text label.
   * @param site - Bomb site definition with id, zone, and plantZone.
   */
  private createBombSite(site: BombSite): void {
    const zone = site.zone;

    /* Choose overlay color: Site A = red, Site B = blue */
    const color = site.id === 'A' ? 0xff4444 : 0x4444ff;

    /* Main bomb site zone overlay */
    const overlayGeometry = new THREE.PlaneGeometry(zone.width, zone.height);
    const overlayMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(
      zone.x + zone.width / 2,
      0.2,
      zone.z + zone.height / 2
    );
    this.addToScene(overlay);

    /* Plant zone overlay (brighter amber highlight) */
    const pz = site.plantZone;
    const pzGeometry = new THREE.PlaneGeometry(pz.width, pz.height);
    const pzMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const pzOverlay = new THREE.Mesh(pzGeometry, pzMaterial);
    pzOverlay.rotation.x = -Math.PI / 2;
    pzOverlay.position.set(
      pz.x + pz.width / 2,
      0.25,
      pz.z + pz.height / 2
    );
    this.addToScene(pzOverlay);

    /* Floating text label */
    const labelColor = site.id === 'A' ? '#ff4444' : '#4444ff';
    const textSprite = this.createTextSprite(site.id, labelColor, 64);
    textSprite.position.set(
      zone.x + zone.width / 2,
      80,
      zone.z + zone.height / 2
    );
    this.addToScene(textSprite);
  }

  /**
   * Creates a spawn zone overlay in the scene.
   * @param zone - Zone definition with position and dimensions.
   * @param color - Hex color for the overlay.
   */
  private createSpawnZone(zone: { x: number; z: number; width: number; height: number }, color: number): void {
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
   * Creates a text sprite that always faces the camera (billboard).
   * @param text - The text string to display.
   * @param color - CSS color string for the text.
   * @param size - Font size in pixels for the canvas rendering.
   * @returns A THREE.Sprite with the rendered text as its texture.
   */
  public createTextSprite(text: string, color: string, size: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const canvasSize = size * 4;
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    const context = canvas.getContext('2d')!;
    context.font = `bold ${size * 2}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.fillText(text, canvasSize / 2, canvasSize / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(60, 60, 1);
    return sprite;
  }

  /**
   * Helper to add an object to both the scene and the tracking array.
   * @param object - The Three.js object to add to the scene.
   */
  private addToScene(object: THREE.Object3D): void {
    this.scene.add(object);
    this.mapObjects.push(object);
  }
}
