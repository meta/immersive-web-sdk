/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from 'elics';
import type { AnyComponent } from 'elics';
import type { World } from '../ecs/world.js';

// ---------------------------------------------------------------------------
// Debug state (module-scoped singleton — only one World per page)
// ---------------------------------------------------------------------------

const debugState = {
  paused: false,
  stepResolve: null as (() => void) | null,
  stepReject: null as ((error: Error) => void) | null,
  stepInFlight: false,
  stepDelta: 1 / 72,
  frameCount: 0,
  pausedAtFrame: 0,
};

interface DebugFrameSynchronizer {
  prepareDebugFrame?(delta: number): void;
  flushDebugFrame(): Promise<void>;
}

/** How long debug tools wait on the render loop before giving up. @internal */
export const DEBUG_SYNC_TIMEOUT_MS = 5000;

function isDebugFrameSynchronizer(
  system: unknown,
): system is DebugFrameSynchronizer {
  return (
    typeof system === 'object' &&
    system !== null &&
    'flushDebugFrame' in system &&
    typeof system.flushDebugFrame === 'function'
  );
}

async function flushDebugSystems(world: World): Promise<void> {
  await Promise.all(
    world
      .getSystems()
      .map((system) =>
        isDebugFrameSynchronizer(system)
          ? system.flushDebugFrame()
          : Promise.resolve(),
      ),
  );
}

function prepareDebugSystems(world: World, delta: number): void {
  for (const system of world.getSystems()) {
    if (isDebugFrameSynchronizer(system)) {
      system.prepareDebugFrame?.(delta);
    }
  }
}

async function flushDebugSystemsWithTimeout(
  world: World,
  operation: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      flushDebugSystems(world),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${operation} timed out after ${DEBUG_SYNC_TIMEOUT_MS}ms while waiting for asynchronous systems to settle`,
            ),
          );
        }, DEBUG_SYNC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Install debug hook — monkey-patches world.update()
// ---------------------------------------------------------------------------

let originalUpdate: ((delta: number, time: number) => void) | null = null;
let hookedWorld: World | null = null;

export function installDebugHook(world: World): void {
  if (hookedWorld === world) {
    return;
  } // already installed

  originalUpdate = world.update.bind(world);
  hookedWorld = world;

  world.update = (delta: number, time: number): void => {
    debugState.frameCount++;

    if (debugState.paused && !debugState.stepResolve) {
      // Skip ECS updates; renderer.render() still runs after this
      return;
    }

    if (debugState.paused && debugState.stepResolve) {
      if (debugState.stepInFlight) {
        return;
      }
      // Stepping — use fixed timestep
      const resolve = debugState.stepResolve;
      const reject = debugState.stepReject;
      debugState.stepResolve = null;
      debugState.stepReject = null;
      debugState.stepInFlight = true;
      try {
        prepareDebugSystems(world, debugState.stepDelta);
        originalUpdate!(debugState.stepDelta, time);
      } catch (error) {
        debugState.stepInFlight = false;
        reject?.(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      void flushDebugSystems(world).then(
        () => {
          debugState.stepInFlight = false;
          resolve();
        },
        (error) => {
          debugState.stepInFlight = false;
          reject?.(error instanceof Error ? error : new Error(String(error)));
        },
      );
      return;
    }

    originalUpdate!(delta, time);
  };
}

/** Whether `ecs_pause` is in effect (systems skipped until resumed). */
export function isEcsPaused(): boolean {
  return debugState.paused;
}

// ---------------------------------------------------------------------------
// ecs_pause
// ---------------------------------------------------------------------------

export interface EcsPauseResult {
  paused: boolean;
  frame: number;
  systemCount: number;
}

export async function ecsPause(world: World): Promise<EcsPauseResult> {
  debugState.paused = true;
  debugState.pausedAtFrame = debugState.frameCount;
  await flushDebugSystemsWithTimeout(world, 'Pause');
  return {
    paused: true,
    frame: debugState.frameCount,
    systemCount: world.getSystems().length,
  };
}

// ---------------------------------------------------------------------------
// ecs_resume
// ---------------------------------------------------------------------------

export interface EcsResumeResult {
  paused: boolean;
  framesWhilePaused: number;
}

let resumeClampInstalled = false;

export function ecsResume(world: World): EcsResumeResult {
  const framesWhilePaused = debugState.frameCount - debugState.pausedAtFrame;
  debugState.paused = false;
  debugState.stepResolve = null;
  debugState.stepReject = null;
  // Keep stepInFlight set until its asynchronous system flush actually
  // settles. Normal updates can resume, but a later debugger step must not
  // overlap the abandoned exchange.

  // Cap first real delta after resume to avoid physics explosions
  if (!resumeClampInstalled && originalUpdate) {
    const currentUpdate = world.update;
    let clampNext = true;
    world.update = (delta: number, time: number): void => {
      if (clampNext) {
        clampNext = false;
        const maxDelta = 1 / 30;
        currentUpdate(Math.min(delta, maxDelta), time);
        // Restore the regular patched update
        world.update = currentUpdate;
        return;
      }
      currentUpdate(delta, time);
    };
    // Only need to do this once per resume
    resumeClampInstalled = true;
    // Reset so the next resume can install again
    setTimeout(() => {
      resumeClampInstalled = false;
    }, 0);
  }

  return {
    paused: false,
    framesWhilePaused,
  };
}

// ---------------------------------------------------------------------------
// ecs_step
// ---------------------------------------------------------------------------

export interface EcsStepParams {
  count?: number;
  delta?: number;
}

export interface EcsStepResult {
  framesAdvanced: number;
  totalFrame: number;
}

export async function ecsStep(
  _world: World,
  params: Record<string, unknown>,
): Promise<EcsStepResult> {
  const { count = 1, delta = 1 / 72 } = params as EcsStepParams;

  if (!debugState.paused) {
    throw new Error(
      'Cannot step when ECS is not paused. Call ecs_pause first.',
    );
  }

  const frameCount = Math.max(1, Math.min(120, Math.round(count)));
  debugState.stepDelta = delta;

  // Per-step timeout: if the render loop isn't running (tab backgrounded,
  // no active XR session, page hidden), the resolve callback from
  // world.update() never fires. A 5s timeout per step prevents the MCP
  // call from hanging indefinitely.
  for (let i = 0; i < frameCount; i++) {
    await new Promise<void>((resolve, reject) => {
      debugState.stepResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      debugState.stepReject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        debugState.stepResolve = null;
        debugState.stepReject = null;
        // If world.update already started this step, its asynchronous flush is
        // still physically in flight. Leave the guard set so a retry cannot
        // submit another exact step until that work really settles.
        reject(
          new Error(
            `Step timeout after ${DEBUG_SYNC_TIMEOUT_MS}ms — the render loop may not be running. ` +
              `Ensure an XR session is active and the browser tab is visible.`,
          ),
        );
      }, DEBUG_SYNC_TIMEOUT_MS);
    });
  }

  return {
    framesAdvanced: frameCount,
    totalFrame: debugState.frameCount,
  };
}

// ---------------------------------------------------------------------------
// Component serialization helpers
// ---------------------------------------------------------------------------

const VECTOR_TYPES = new Set(['Vec2', 'Vec3', 'Vec4', 'Color']);
const MAX_STRING_LENGTH = 200;
const MAX_DEPTH = 3;
const MAX_TYPED_ARRAY_ELEMENTS = 16;

function safeSerialize(
  value: unknown,
  depth: number = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const type = typeof value;
  if (type === 'number' || type === 'boolean') {
    return value;
  }
  if (type === 'string') {
    return (value as string).length > MAX_STRING_LENGTH
      ? (value as string).slice(0, MAX_STRING_LENGTH) + '...'
      : value;
  }
  if (type === 'function') {
    return '<function>';
  }

  if (type !== 'object') {
    return String(value);
  }

  const obj = value as Record<string, unknown>;

  // Circular reference check
  if (seen.has(obj)) {
    return '<circular>';
  }
  seen.add(obj);

  // Depth limit
  if (depth >= MAX_DEPTH) {
    return '<object>';
  }

  // TypedArray
  if (ArrayBuffer.isView(obj) && 'length' in obj) {
    const arr = obj as unknown as ArrayLike<number>;
    const len = Math.min(arr.length, MAX_TYPED_ARRAY_ELEMENTS);
    const result = Array.from({ length: len }, (_, i) => arr[i]);
    if (arr.length > MAX_TYPED_ARRAY_ELEMENTS) {
      return { values: result, truncated: true, totalLength: arr.length };
    }
    return result;
  }

  // Array
  if (Array.isArray(obj)) {
    return obj
      .slice(0, MAX_TYPED_ARRAY_ELEMENTS)
      .map((item) => safeSerialize(item, depth + 1, seen));
  }

  // Three.js sentinel detection — return type tag instead of full object
  if ((obj as any).isObject3D) {
    return `<Object3D:${(obj as any).name || (obj as any).type || 'unnamed'}>`;
  }
  if ((obj as any).isMaterial) {
    return `<Material:${(obj as any).type || 'unknown'}>`;
  }
  if ((obj as any).isTexture) {
    return `<Texture:${(obj as any).name || 'unnamed'}>`;
  }
  if ((obj as any).isBufferGeometry) {
    return `<BufferGeometry>`;
  }

  // Plain object
  const result: Record<string, unknown> = {};
  const keys = Object.keys(obj);
  for (const key of keys.slice(0, 20)) {
    result[key] = safeSerialize(obj[key], depth + 1, seen);
  }
  if (keys.length > 20) {
    result['...'] = `${keys.length - 20} more keys`;
  }
  return result;
}

function serializeComponentValue(
  entity: import('elics').Entity,
  component: AnyComponent,
  key: string,
  schemaField: { type: string },
): unknown {
  const type = schemaField.type;

  if (VECTOR_TYPES.has(type)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Array.from((entity as any).getVectorView(component, key));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (entity as any).getValue(component, key);

  if (type === 'Entity') {
    if (raw === null) {
      return null;
    }
    const ref = raw as import('elics').Entity;
    return {
      entityIndex: ref.index,
      name: ref.object3D?.name || undefined,
    };
  }

  if (type === 'Object') {
    return safeSerialize(raw);
  }

  return raw;
}

// ---------------------------------------------------------------------------
// ecs_query_entity
// ---------------------------------------------------------------------------

export interface EcsQueryEntityParams {
  entityIndex: number;
  components?: string[];
}

export interface ComponentData {
  componentId: string;
  description?: string;
  values: Record<string, unknown>;
}

export interface EcsQueryEntityResult {
  entityIndex: number;
  active: boolean;
  name?: string;
  components: ComponentData[];
}

export function ecsQueryEntity(
  world: World,
  params: Record<string, unknown>,
): EcsQueryEntityResult {
  const { entityIndex, components } = params as unknown as EcsQueryEntityParams;

  if (entityIndex === undefined || entityIndex === null) {
    throw new Error(
      'entityIndex is required. Use get_scene_hierarchy or ecs_find_entities to discover entity indices.',
    );
  }

  const entity = world.entityManager.getEntityByIndex(entityIndex);
  if (!entity) {
    throw new Error(
      `Entity ${entityIndex} not found or has been destroyed. Use get_scene_hierarchy or ecs_find_entities to find active entities.`,
    );
  }

  const entityComponents = entity.getComponents();

  // Filter to requested components if specified
  let targetComponents = entityComponents;
  if (components && components.length > 0) {
    const filterSet = new Set(components);
    targetComponents = entityComponents.filter((c) => filterSet.has(c.id));
  }

  const componentDataList: ComponentData[] = targetComponents.map(
    (component) => {
      const values: Record<string, unknown> = {};
      const schema = component.schema;

      for (const key of Object.keys(schema)) {
        values[key] = serializeComponentValue(
          entity,
          component,
          key,
          schema[key],
        );
      }

      return {
        componentId: component.id,
        description: component.description,
        values,
      };
    },
  );

  return {
    entityIndex: entity.index,
    active: entity.active,
    name: entity.object3D?.name || undefined,
    components: componentDataList,
  };
}

// ---------------------------------------------------------------------------
// ecs_find_entities
// ---------------------------------------------------------------------------

export interface EcsFindEntitiesParams {
  withComponents?: string[];
  withoutComponents?: string[];
  namePattern?: string;
  limit?: number;
}

export interface EntitySummary {
  entityIndex: number;
  name?: string;
  componentIds: string[];
}

export interface EcsFindEntitiesResult {
  entities: EntitySummary[];
  total: number;
  limited: boolean;
}

export function ecsFindEntities(
  world: World,
  params: Record<string, unknown>,
): EcsFindEntitiesResult {
  const {
    withComponents,
    withoutComponents,
    namePattern,
    limit = 50,
  } = params as EcsFindEntitiesParams;

  // Resolve component names to component objects
  const requiredComponents: AnyComponent[] = [];
  if (withComponents) {
    for (const name of withComponents) {
      const comp = ComponentRegistry.getById(name);
      if (!comp) {
        throw new Error(
          `Component '${name}' not found in registry. Check the component ID.`,
        );
      }
      requiredComponents.push(comp);
    }
  }

  const excludedComponents: AnyComponent[] = [];
  if (withoutComponents) {
    for (const name of withoutComponents) {
      const comp = ComponentRegistry.getById(name);
      if (!comp) {
        throw new Error(
          `Component '${name}' not found in registry. Check the component ID.`,
        );
      }
      excludedComponents.push(comp);
    }
  }

  let nameRegex: RegExp | null = null;
  if (namePattern) {
    nameRegex = new RegExp(namePattern, 'i');
  }

  const maxResults = Math.max(1, Math.min(50, limit));
  const matches: EntitySummary[] = [];

  // indexLookup is internal to ELICS (not part of the public API). If an
  // iteration API becomes public, migrate to that instead. For now, direct
  // access is the only way to enumerate all live entities efficiently.
  const lookup = (world.entityManager as any).indexLookup as (
    | import('elics').Entity
    | null
  )[];

  for (let i = 0; i < lookup.length; i++) {
    const entity = lookup[i];
    if (!entity || !entity.active) {
      continue;
    }

    // Check required components
    let match = true;
    for (const comp of requiredComponents) {
      if (!entityHasDebugComponent(entity, comp)) {
        match = false;
        break;
      }
    }
    if (!match) {
      continue;
    }

    // Check excluded components
    for (const comp of excludedComponents) {
      if (entityHasDebugComponent(entity, comp)) {
        match = false;
        break;
      }
    }
    if (!match) {
      continue;
    }

    // Check name pattern
    if (nameRegex) {
      const name = entity.object3D?.name;
      if (!name || !nameRegex.test(name)) {
        continue;
      }
    }

    const componentIds = entity.getComponents().map((c: AnyComponent) => c.id);
    matches.push({
      entityIndex: entity.index,
      name: entity.object3D?.name || undefined,
      componentIds,
    });
  }

  const totalMatches = matches.length;
  const results = matches
    .sort((a, b) => getEntityDebugSortRank(a) - getEntityDebugSortRank(b))
    .slice(0, maxResults);

  return {
    entities: results,
    total: totalMatches,
    limited: totalMatches > maxResults,
  };
}

function entityHasDebugComponent(
  entity: import('elics').Entity,
  component: AnyComponent,
): boolean {
  if (component.bitmask != null) {
    return entity.hasComponent(component);
  }
  return entity.getComponents().some((entry: AnyComponent) => {
    return entry === component || entry.id === component.id;
  });
}

function getEntityDebugSortRank(entity: EntitySummary): number {
  // Keep infrastructure roots discoverable but list mutable level content first.
  // Tools and agents often pick the first match for quick probes; LevelRoot is
  // intentionally reset to identity every frame by LevelSystem.
  if (entity.componentIds.includes('LevelRoot')) {
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// ecs_list_systems
// ---------------------------------------------------------------------------

export interface SystemInfo {
  name: string;
  index: number;
  priority: number;
  isPaused: boolean;
  configKeys: string[];
  queryNames: string[];
  entityCounts: Record<string, number>;
}

export interface EcsListSystemsResult {
  systems: SystemInfo[];
  total: number;
}

export function ecsListSystems(world: World): EcsListSystemsResult {
  const systems = world.getSystems();
  const result: SystemInfo[] = systems.map((system, index) => {
    const queryNames = Object.keys(system.queries || {});
    const entityCounts: Record<string, number> = {};
    for (const qName of queryNames) {
      entityCounts[qName] = system.queries[qName]?.entities?.size ?? 0;
    }
    return {
      name: system.constructor.name,
      index,
      priority: system.priority,
      isPaused: system.isPaused,
      configKeys: Object.keys(system.config || {}),
      queryNames,
      entityCounts,
    };
  });
  return { systems: result, total: result.length };
}

// ---------------------------------------------------------------------------
// ecs_list_components
// ---------------------------------------------------------------------------

export interface ComponentInfo {
  id: string;
  description?: string;
  fields: Record<string, { type: string; default: unknown }>;
}

export interface EcsListComponentsResult {
  components: ComponentInfo[];
  total: number;
}

export function ecsListComponents(): EcsListComponentsResult {
  const all = ComponentRegistry.getAllComponents();
  const result: ComponentInfo[] = all.map((comp) => {
    const fields: Record<string, { type: string; default: unknown }> = {};
    for (const [key, field] of Object.entries(comp.schema)) {
      fields[key] = {
        type: (field as any).type,
        default: (field as any).default,
      };
    }
    return {
      id: comp.id,
      description: comp.description,
      fields,
    };
  });
  return { components: result, total: result.length };
}

// ---------------------------------------------------------------------------
// ecs_toggle_system
// ---------------------------------------------------------------------------

export interface EcsToggleSystemParams {
  name: string;
  paused?: boolean;
}

export interface EcsToggleSystemResult {
  name: string;
  isPaused: boolean;
}

export function ecsToggleSystem(
  world: World,
  params: Record<string, unknown>,
): EcsToggleSystemResult {
  const { name, paused } = params as unknown as EcsToggleSystemParams;
  const systems = world.getSystems();
  const system = systems.find((s) => s.constructor.name === name);
  if (!system) {
    const available = systems.map((s) => s.constructor.name).join(', ');
    throw new Error(
      `System '${name}' not found. Available systems: ${available}`,
    );
  }
  const targetPaused = paused !== undefined ? paused : !system.isPaused;
  if (targetPaused) {
    system.stop();
  } else {
    system.play();
  }
  return { name: system.constructor.name, isPaused: system.isPaused };
}

// ---------------------------------------------------------------------------
// ecs_set_component
// ---------------------------------------------------------------------------

export interface EcsSetComponentParams {
  entityIndex: number;
  componentId: string;
  field: string;
  value: unknown;
}

export interface EcsSetComponentResult {
  entityIndex: number;
  componentId: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
}

export function ecsSetComponent(
  world: World,
  params: Record<string, unknown>,
): EcsSetComponentResult {
  const { entityIndex, componentId, field, value } =
    params as unknown as EcsSetComponentParams;

  const entity = world.entityManager.getEntityByIndex(entityIndex);
  if (!entity) {
    throw new Error(`Entity ${entityIndex} not found.`);
  }

  const component = ComponentRegistry.getById(componentId);
  if (!component) {
    throw new Error(`Component '${componentId}' not found in registry.`);
  }

  if (!entity.hasComponent(component)) {
    throw new Error(
      `Entity ${entityIndex} does not have component '${componentId}'.`,
    );
  }

  const schemaField = component.schema[field];
  if (!schemaField) {
    const available = Object.keys(component.schema).join(', ');
    throw new Error(
      `Field '${field}' not found on '${componentId}'. Available: ${available}`,
    );
  }

  // Read previous value using existing serialization helper
  const previousValue = serializeComponentValue(
    entity,
    component,
    field,
    schemaField,
  );

  const type = schemaField.type;
  if (VECTOR_TYPES.has(type)) {
    // Vector types: write via getVectorView
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = (entity as any).getVectorView(component, field);
    // Value may arrive as a JSON string from MCP clients (e.g. "[0, 1.2, -1.5]")
    let arr = value;
    if (typeof arr === 'string') {
      try {
        arr = JSON.parse(arr);
      } catch {
        throw new Error(
          `${type} field '${field}': could not parse value string as JSON array.`,
        );
      }
    }
    if (!Array.isArray(arr) || arr.length !== view.length) {
      throw new Error(
        `${type} field '${field}' requires an array of ${view.length} numbers.`,
      );
    }
    for (let i = 0; i < view.length; i++) {
      view[i] = arr[i];
    }
  } else {
    // Scalar types: use setValue (handles validation, query updates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (entity as any).setValue(component, field, value);
  }

  // Read back new value
  const newValue = serializeComponentValue(
    entity,
    component,
    field,
    schemaField,
  );

  return { entityIndex, componentId, field, previousValue, newValue };
}

// ---------------------------------------------------------------------------
// ecs_snapshot / ecs_diff
// ---------------------------------------------------------------------------

// Module-scoped snapshot storage
const snapshots = new Map<string, EcsSnapshot>();
const DEFAULT_SNAPSHOT_CAPACITY = 2;
const MAX_SNAPSHOT_CAPACITY = 20;
let snapshotCapacity = DEFAULT_SNAPSHOT_CAPACITY;
let nextSnapshotSequence = 0;

function nextSnapshotLabel(): string {
  let label: string;
  do {
    label = `snap-${nextSnapshotSequence++}`;
  } while (snapshots.has(label));
  return label;
}

interface EntitySnapshot {
  entityIndex: number;
  name?: string;
  components: Record<string, Record<string, unknown>>;
}

export interface EcsSnapshot {
  label: string;
  timestamp: number;
  frame: number;
  entities: EntitySnapshot[];
}

export interface EcsSnapshotParams {
  label?: string;
  capacity?: number;
}

export interface EcsSnapshotResult {
  label: string;
  entityCount: number;
  componentCount: number;
  storedSnapshots: string[];
  snapshotCapacity: number;
  evictedSnapshots: string[];
}

export function ecsSnapshot(
  world: World,
  params: Record<string, unknown>,
): EcsSnapshotResult {
  const { capacity, label: requestedLabel } = params as EcsSnapshotParams;
  const label = requestedLabel ?? nextSnapshotLabel();
  if (capacity !== undefined) {
    if (
      !Number.isInteger(capacity) ||
      capacity < DEFAULT_SNAPSHOT_CAPACITY ||
      capacity > MAX_SNAPSHOT_CAPACITY
    ) {
      throw new Error(
        `Snapshot capacity must be an integer from ${DEFAULT_SNAPSHOT_CAPACITY} to ${MAX_SNAPSHOT_CAPACITY}.`,
      );
    }
    snapshotCapacity = capacity;
  }

  // See comment in ecsFindEntities — indexLookup is internal to ELICS.
  const lookup = (world.entityManager as any).indexLookup as (
    | import('elics').Entity
    | null
  )[];
  const entities: EntitySnapshot[] = [];
  let componentCount = 0;

  for (let i = 0; i < lookup.length; i++) {
    const entity = lookup[i];
    if (!entity || !entity.active) {
      continue;
    }

    const comps = entity.getComponents();
    const components: Record<string, Record<string, unknown>> = {};

    for (const comp of comps) {
      const values: Record<string, unknown> = {};
      for (const key of Object.keys(comp.schema)) {
        values[key] = serializeComponentValue(
          entity,
          comp,
          key,
          comp.schema[key],
        );
      }
      components[comp.id] = values;
      componentCount++;
    }

    entities.push({
      entityIndex: entity.index,
      name: entity.object3D?.name || undefined,
      components,
    });
  }

  const snapshot: EcsSnapshot = {
    label,
    timestamp: performance.now(),
    frame: debugState.frameCount,
    entities,
  };

  // Replacing a named snapshot should make the new capture the most recent
  // entry. Map.set() preserves an existing key's insertion order, which could
  // otherwise evict the snapshot we just wrote when capacity is reduced.
  snapshots.delete(label);
  snapshots.set(label, snapshot);

  // Map insertion order makes retention deterministic: oldest labels leave
  // first and replaced labels move to the newest position.
  const evictedSnapshots: string[] = [];
  while (snapshots.size > snapshotCapacity) {
    const oldest = snapshots.keys().next().value!;
    snapshots.delete(oldest);
    evictedSnapshots.push(oldest);
  }

  return {
    label,
    entityCount: entities.length,
    componentCount,
    storedSnapshots: Array.from(snapshots.keys()),
    snapshotCapacity,
    evictedSnapshots,
  };
}

// --- ecs_diff ---

export interface EcsDiffParams {
  from: string;
  to: string;
}

interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

interface ComponentDiff {
  componentId: string;
  status: 'changed' | 'added' | 'removed';
  fields?: FieldDiff[];
}

interface EntityDiff {
  entityIndex: number;
  name?: string;
  status: 'changed' | 'added' | 'removed';
  components?: ComponentDiff[];
}

export interface EcsDiffResult {
  from: string;
  to: string;
  frameDelta: number;
  timeDelta: number;
  entities: EntityDiff[];
  summary: { added: number; removed: number; changed: number };
}

export function ecsDiff(
  _world: World,
  params: Record<string, unknown>,
): EcsDiffResult {
  const { from, to } = params as unknown as EcsDiffParams;

  const snapFrom = snapshots.get(from);
  const snapTo = snapshots.get(to);
  if (!snapFrom) {
    throw new Error(
      `Snapshot '${from}' not found. Stored: ${Array.from(snapshots.keys()).join(', ')}`,
    );
  }
  if (!snapTo) {
    throw new Error(
      `Snapshot '${to}' not found. Stored: ${Array.from(snapshots.keys()).join(', ')}`,
    );
  }

  // Index by entityIndex
  const fromMap = new Map(snapFrom.entities.map((e) => [e.entityIndex, e]));
  const toMap = new Map(snapTo.entities.map((e) => [e.entityIndex, e]));

  const diffs: EntityDiff[] = [];
  let added = 0,
    removed = 0,
    changed = 0;

  // Check removed + changed
  for (const [idx, fromEntity] of fromMap) {
    const toEntity = toMap.get(idx);
    if (!toEntity) {
      diffs.push({
        entityIndex: idx,
        name: fromEntity.name,
        status: 'removed',
      });
      removed++;
      continue;
    }
    // Diff components
    const compDiffs: ComponentDiff[] = [];
    const allCompIds = new Set([
      ...Object.keys(fromEntity.components),
      ...Object.keys(toEntity.components),
    ]);
    for (const compId of allCompIds) {
      const fromComp = fromEntity.components[compId];
      const toComp = toEntity.components[compId];
      if (!fromComp) {
        compDiffs.push({ componentId: compId, status: 'added' });
        continue;
      }
      if (!toComp) {
        compDiffs.push({ componentId: compId, status: 'removed' });
        continue;
      }
      // Diff fields
      const fieldDiffs: FieldDiff[] = [];
      for (const field of Object.keys(fromComp)) {
        const fv = JSON.stringify(fromComp[field]);
        const tv = JSON.stringify(toComp[field]);
        if (fv !== tv) {
          fieldDiffs.push({ field, from: fromComp[field], to: toComp[field] });
        }
      }
      // Check for fields added in toComp
      for (const field of Object.keys(toComp)) {
        if (!(field in fromComp)) {
          fieldDiffs.push({
            field,
            from: undefined,
            to: toComp[field],
          });
        }
      }
      if (fieldDiffs.length > 0) {
        compDiffs.push({
          componentId: compId,
          status: 'changed',
          fields: fieldDiffs,
        });
      }
    }
    if (compDiffs.length > 0) {
      diffs.push({
        entityIndex: idx,
        name: fromEntity.name,
        status: 'changed',
        components: compDiffs,
      });
      changed++;
    }
  }

  // Check added
  for (const [idx, toEntity] of toMap) {
    if (!fromMap.has(idx)) {
      diffs.push({
        entityIndex: idx,
        name: toEntity.name,
        status: 'added',
      });
      added++;
    }
  }

  return {
    from,
    to,
    frameDelta: snapTo.frame - snapFrom.frame,
    timeDelta: snapTo.timestamp - snapFrom.timestamp,
    entities: diffs,
    summary: { added, removed, changed },
  };
}
