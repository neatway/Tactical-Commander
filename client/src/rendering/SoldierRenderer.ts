/**
 * @file SoldierRenderer.ts
 * @description Renders soldiers as placeholder capsule meshes in the 3D scene.
 * Each soldier is represented by a group containing a body capsule, a direction
 * indicator cone, a health bar, and a selection ring. Supports vision cones,
 * waypoint visualization, and death animations.
 */

import * as THREE from 'three';

/**
 * Manages the 3D representation of all soldiers in the game.
 *
 * Each soldier is a THREE.Group containing:
 * - Body: CapsuleGeometry colored by team (red/blue)
 * - Direction indicator: Small cone showing facing direction
 * - Health bar: Two thin boxes (background + foreground) above the head
 * - Selection ring: Yellow torus around the base (hidden until selected)
 *
 * Additional visual features include vision cones and waypoint paths.
 *
 * @example
 * ```ts
 * const soldierRenderer = new SoldierRenderer(scene);
 * soldierRenderer.createSoldier('soldier-1', 'red', { x: 100, z: 200 });
 * soldierRenderer.setSelected('soldier-1');
 * ```
 */
export class SoldierRenderer {
  /** Reference to the Three.js scene where soldiers are rendered. */
  private scene: THREE.Scene;

  /**
   * Map of soldier IDs to their THREE.Group instances.
   * Each group contains all meshes that make up a soldier's visual.
   */
  private soldierMeshes: Map<string, THREE.Group> = new Map();

  /**
   * Map of soldier IDs to their vision cone meshes.
   * Stored separately for easy show/hide toggling.
   */
  private visionCones: Map<string, THREE.Mesh> = new Map();

  /**
   * Map of soldier IDs to their waypoint visualization groups.
   * Each group contains line segments and waypoint marker spheres.
   */
  private waypointGroups: Map<string, THREE.Group> = new Map();

  /** The ID of the currently selected soldier, or null if none selected. */
  private selectedSoldierId: string | null = null;

  /**
   * Creates a new SoldierRenderer attached to the given scene.
   *
   * @param scene - The Three.js scene to add soldier meshes to.
   */
  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Creates a new soldier mesh group and adds it to the scene.
   *
   * The soldier consists of:
   * 1. Body capsule - main visual representation
   * 2. Direction cone - small arrow at the front showing facing
   * 3. Health bar - green bar above head showing remaining HP
   * 4. Selection ring - yellow torus at feet (hidden by default)
   *
   * @param soldierId - Unique identifier for this soldier.
   * @param teamColor - Team affiliation determining the mesh color.
   *                    'red' = attackers (#cc3333), 'blue' = defenders (#3333cc).
   * @param position - Initial world position on the ground plane.
   */
  public createSoldier(
    soldierId: string,
    teamColor: 'red' | 'blue',
    position: { x: number; z: number }
  ): void {
    /** Create the parent group that holds all soldier sub-meshes */
    const group = new THREE.Group();
    group.name = soldierId;

    /* ----- Body Capsule ----- */
    /**
     * CapsuleGeometry creates a cylinder with hemispherical caps.
     * Radius=8 gives a reasonable soldier width.
     * Height=25 is the cylinder portion (total height = 25 + 2*8 = 41).
     */
    const bodyColor = teamColor === 'red' ? 0xcc3333 : 0x3333cc;
    const bodyGeometry = new THREE.CapsuleGeometry(8, 25, 8, 16);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.6,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.name = 'body';
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    /* ----- Direction Indicator ----- */
    /**
     * Small cone at the front of the soldier showing which direction
     * they are facing. Uses a slightly lighter version of the team color.
     * ConeGeometry(radius=3, height=8, segments=8) for a small arrow.
     */
    const dirColor = teamColor === 'red' ? 0xee5555 : 0x5555ee;
    const dirGeometry = new THREE.ConeGeometry(3, 8, 8);
    const dirMaterial = new THREE.MeshStandardMaterial({
      color: dirColor,
      roughness: 0.5,
    });
    const dirIndicator = new THREE.Mesh(dirGeometry, dirMaterial);
    dirIndicator.name = 'direction';

    /**
     * Rotate the cone so it points forward (along +Z in local space).
     * Default cone points up (+Y), so rotate -90 degrees around X.
     * Position it at the front of the capsule.
     */
    dirIndicator.rotation.x = -Math.PI / 2;
    dirIndicator.position.set(0, 0, 12); /* 12 units in front of center */
    group.add(dirIndicator);

    /* ----- Health Bar ----- */
    /**
     * Health bar is composed of two thin boxes:
     * 1. Background bar (dark gray) - always full width
     * 2. Foreground bar (green) - scales with health percentage
     *
     * Both are positioned above the soldier's head.
     */
    const healthBarWidth = 20;
    const healthBarHeight = 2;
    const healthBarDepth = 1;

    /** Dark background bar (always visible, full width) */
    const bgGeometry = new THREE.BoxGeometry(healthBarWidth, healthBarHeight, healthBarDepth);
    const bgMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const healthBg = new THREE.Mesh(bgGeometry, bgMaterial);
    healthBg.name = 'healthBg';
    healthBg.position.set(0, 25, 0); /* Above the capsule head */
    group.add(healthBg);

    /** Green foreground bar (scales with remaining health) */
    const fgGeometry = new THREE.BoxGeometry(healthBarWidth, healthBarHeight, healthBarDepth);
    const fgMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const healthFg = new THREE.Mesh(fgGeometry, fgMaterial);
    healthFg.name = 'healthFg';
    healthFg.position.set(0, 25, 0); /* Same position as background */
    group.add(healthFg);

    /* ----- Selection Ring ----- */
    /**
     * A yellow torus around the soldier's base to indicate selection.
     * TorusGeometry(outerRadius=12, tubeRadius=1.5) creates a ring.
     * Hidden by default; shown via setSelected().
     */
    const ringGeometry = new THREE.TorusGeometry(12, 1.5, 8, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,      /* bright yellow */
      transparent: true,
      opacity: 0.6,
    });
    const selectionRing = new THREE.Mesh(ringGeometry, ringMaterial);
    selectionRing.name = 'selectionRing';
    selectionRing.rotation.x = -Math.PI / 2; /* Lay flat on XZ plane */
    selectionRing.position.set(0, 0.5, 0);   /* Just above ground */
    selectionRing.visible = false;            /* Hidden until selected */
    group.add(selectionRing);

    /* ----- Position the Group ----- */
    /**
     * Place the entire group at the specified world position.
     * Y offset of 25/2 = 12.5 so the capsule base sits on the ground.
     */
    group.position.set(position.x, 25 / 2, position.z);

    /* Add to scene and store reference */
    this.scene.add(group);
    this.soldierMeshes.set(soldierId, group);
  }

  /**
   * Updates a soldier's position, rotation, health, and alive state.
   *
   * Called each frame (or on state change) to synchronize the 3D visuals
   * with the game simulation state.
   *
   * @param soldierId - The unique ID of the soldier to update.
   * @param position - New world position on the ground plane.
   * @param rotation - Facing angle in radians (0 = +Z, PI/2 = +X).
   * @param health - Current health as a fraction (0.0 to 1.0).
   * @param alive - Whether the soldier is still alive.
   */
  public updateSoldier(
    soldierId: string,
    position: { x: number; z: number },
    rotation: number,
    health: number,
    alive: boolean
  ): void {
    const group = this.soldierMeshes.get(soldierId);
    if (\!group) return;

    if (\!alive) {
      /**
       * Dead soldiers are either hidden or shown as grey laying flat.
       * We change the body material to dark grey and rotate the group
       * to lay on its side, giving a "fallen" appearance.
       */
      const body = group.getObjectByName('body') as THREE.Mesh | undefined;
      if (body) {
        (body.material as THREE.MeshStandardMaterial).color.set(0x444444);
      }
      group.rotation.z = Math.PI / 2; /* Lay on side */
      group.position.y = 5;           /* Lower to near-ground */
      return;
    }

    /* Update world position (maintain Y offset for capsule base) */
    group.position.set(position.x, 25 / 2, position.z);

    /* Rotate the entire group to face the specified direction */
    group.rotation.y = rotation;

    /* ----- Update Health Bar ----- */
    /**
     * Scale the green foreground bar proportionally to remaining health.
     * Scale on the X axis (width) from 1.0 (full health) to 0.0 (dead).
     * Offset the position so the bar shrinks from the right side.
     */
    const healthFg = group.getObjectByName('healthFg') as THREE.Mesh | undefined;
    if (healthFg) {
      healthFg.scale.x = Math.max(0, Math.min(1, health));
      /**
       * Shift the bar left as it shrinks so it appears to decrease
       * from right to left. Offset = (1 - health) * halfWidth * -1.
       */
      const halfWidth = 10; /* half of healthBarWidth (20) */
      healthFg.position.x = -(1 - health) * halfWidth / 2;

      /* Change color from green to yellow to red based on health */
      const mat = healthFg.material as THREE.MeshBasicMaterial;
      if (health > 0.6) {
        mat.color.set(0x00ff00); /* Green - healthy */
      } else if (health > 0.3) {
        mat.color.set(0xffff00); /* Yellow - wounded */
      } else {
        mat.color.set(0xff0000); /* Red - critical */
      }
    }
  }

  /**
   * Shows a selection ring on the specified soldier and hides it on all others.
   *
   * Only one soldier can be selected at a time. Passing null deselects all.
   *
   * @param soldierId - The ID of the soldier to select, or null to deselect all.
   */
  public setSelected(soldierId: string | null): void {
    /* Hide the ring on the previously selected soldier */
    if (this.selectedSoldierId) {
      const prevGroup = this.soldierMeshes.get(this.selectedSoldierId);
      if (prevGroup) {
        const ring = prevGroup.getObjectByName('selectionRing') as THREE.Mesh | undefined;
        if (ring) ring.visible = false;
      }
    }

    /* Show the ring on the newly selected soldier */
    this.selectedSoldierId = soldierId;
    if (soldierId) {
      const group = this.soldierMeshes.get(soldierId);
      if (group) {
        const ring = group.getObjectByName('selectionRing') as THREE.Mesh | undefined;
        if (ring) ring.visible = true;
      }
    }
  }

  /**
   * Shows or hides a vision cone for a soldier.
   *
   * The vision cone is a semi-transparent pie-slice shape on the ground plane
   * showing the area the soldier can see. Uses CircleGeometry with thetaStart
   * and thetaLength to create the wedge shape.
   *
   * @param soldierId - The soldier to show/hide the vision cone for.
   * @param angle - The total arc angle of vision in radians.
   * @param radius - How far the soldier can see (length of the cone).
   * @param visible - Whether to show (true) or hide (false) the cone.
   */
  public showVisionCone(
    soldierId: string,
    angle: number,
    radius: number,
    visible: boolean
  ): void {
    /* Remove existing vision cone if present */
    const existingCone = this.visionCones.get(soldierId);
    if (existingCone) {
      this.scene.remove(existingCone);
      existingCone.geometry.dispose();
      (existingCone.material as THREE.Material).dispose();
      this.visionCones.delete(soldierId);
    }

    if (\!visible) return;

    const group = this.soldierMeshes.get(soldierId);
    if (\!group) return;

    /**
     * Create a pie-slice shape using CircleGeometry.
     * thetaStart: Where the arc begins (offset by -half the angle
     *             so it's centered on the forward direction).
     * thetaLength: Total arc sweep (the vision angle).
     * 32 segments for smooth arc edges.
     */
    const thetaStart = -angle / 2;
    const thetaLength = angle;
    const coneGeometry = new THREE.CircleGeometry(radius, 32, thetaStart, thetaLength);

    /**
     * Determine cone color from team.
     * We check the body mesh material color to determine team.
     */
    const body = group.getObjectByName('body') as THREE.Mesh | undefined;
    const bodyColor = body
      ? (body.material as THREE.MeshStandardMaterial).color.getHex()
      : 0xffffff;

    const coneMaterial = new THREE.MeshBasicMaterial({
      color: bodyColor,
      transparent: true,
      opacity: 0.08,         /* Very subtle translucency */
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const coneMesh = new THREE.Mesh(coneGeometry, coneMaterial);

    /** Rotate flat on the ground and position at soldier's feet */
    coneMesh.rotation.x = -Math.PI / 2;
    coneMesh.position.set(group.position.x, 0.3, group.position.z);

    /**
     * Rotate the cone to match the soldier's facing direction.
     * The circle geometry's default forward is +Y in local space,
     * which maps to +Z after the X rotation. We add the soldier's
     * Y rotation to align the cone with their facing.
     */
    coneMesh.rotation.z = -group.rotation.y;

    this.scene.add(coneMesh);
    this.visionCones.set(soldierId, coneMesh);
  }

  /**
   * Draws a waypoint path from the soldier through all specified waypoints.
   *
   * Visualization includes:
   * - Dashed line segments connecting the soldier to each waypoint
   * - Small spheres at each waypoint location
   *
   * @param soldierId - The soldier whose waypoints to display.
   * @param waypoints - Ordered array of world positions defining the path.
   * @param color - CSS color string for the waypoint visualization.
   */
  public showWaypoints(
    soldierId: string,
    waypoints: { x: number; z: number }[],
    color: string
  ): void {
    /* Clear any existing waypoint visualization for this soldier */
    this.clearWaypoints(soldierId);

    const group = this.soldierMeshes.get(soldierId);
    if (\!group || waypoints.length === 0) return;

    /** Create a group to hold all waypoint visual elements */
    const wpGroup = new THREE.Group();
    wpGroup.name = `waypoints-${soldierId}`;

    /** Parse the CSS color string into a Three.js Color */
    const threeColor = new THREE.Color(color);

    /* ----- Dashed Path Lines ----- */
    /**
     * Build an array of points starting from the soldier's current position
     * through each waypoint. Lines are drawn at ground level (y=1).
     */
    const pathPoints: THREE.Vector3[] = [
      new THREE.Vector3(group.position.x, 1, group.position.z),
    ];

    for (const wp of waypoints) {
      pathPoints.push(new THREE.Vector3(wp.x, 1, wp.z));
    }

    /** Create a line geometry from the path points */
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(pathPoints);

    /**
     * LineDashedMaterial creates a dashed/dotted line effect.
     * dashSize and gapSize control the pattern.
     */
    const lineMaterial = new THREE.LineDashedMaterial({
      color: threeColor,
      dashSize: 10,    /* Length of each dash */
      gapSize: 5,      /* Length of each gap */
      transparent: true,
      opacity: 0.7,
    });

    const line = new THREE.Line(lineGeometry, lineMaterial);
    /**
     * computeLineDistances() is required for dashed lines to work.
     * It calculates the cumulative distance along the line segments,
     * which the shader uses to determine dash/gap placement.
     */
    line.computeLineDistances();
    wpGroup.add(line);

    /* ----- Waypoint Markers ----- */
    /**
     * Place a small sphere at each waypoint location.
     * SphereGeometry(radius=3) gives a small but visible marker.
     */
    const markerGeometry = new THREE.SphereGeometry(3, 8, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: threeColor,
      transparent: true,
      opacity: 0.8,
    });

    for (const wp of waypoints) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(wp.x, 1, wp.z); /* At ground level */
      wpGroup.add(marker);
    }

    /* Add the waypoint group to the scene and store the reference */
    this.scene.add(wpGroup);
    this.waypointGroups.set(soldierId, wpGroup);
  }

  /**
   * Removes the waypoint visualization for a specific soldier.
   *
   * Disposes of all geometry and materials to free GPU memory,
   * then removes the group from the scene.
   *
   * @param soldierId - The soldier whose waypoints should be cleared.
   */
  public clearWaypoints(soldierId: string): void {
    const wpGroup = this.waypointGroups.get(soldierId);
    if (\!wpGroup) return;

    /** Traverse all children and dispose their geometry/materials */
    wpGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    this.scene.remove(wpGroup);
    this.waypointGroups.delete(soldierId);
  }

  /**
   * Removes a single soldier from the scene and cleans up all associated
   * resources (mesh group, vision cone, waypoints).
   *
   * @param soldierId - The unique ID of the soldier to remove.
   */
  public removeSoldier(soldierId: string): void {
    /* Remove vision cone if present */
    this.showVisionCone(soldierId, 0, 0, false);

    /* Remove waypoints if present */
    this.clearWaypoints(soldierId);

    /* Remove the soldier mesh group */
    const group = this.soldierMeshes.get(soldierId);
    if (group) {
      /** Dispose all geometry and materials within the group */
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });

      this.scene.remove(group);
      this.soldierMeshes.delete(soldierId);
    }

    /* Clear selection if this soldier was selected */
    if (this.selectedSoldierId === soldierId) {
      this.selectedSoldierId = null;
    }
  }

  /**
   * Removes all soldiers from the scene and cleans up all resources.
   * Typically called at the end of a round or when resetting the game state.
   */
  public removeAll(): void {
    /**
     * Collect all soldier IDs first, then remove each one.
     * We collect IDs into an array to avoid modifying the map
     * while iterating over it.
     */
    const allIds = Array.from(this.soldierMeshes.keys());
    for (const id of allIds) {
      this.removeSoldier(id);
    }
  }
}
