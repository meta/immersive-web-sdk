/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { PointerEventsMap } from '@pmndrs/pointer-events';
import { Entity as ElicsEntity, Types } from 'elics';
import type { AnyComponent, TypeValueToType } from 'elics';
import type { Color, Object3D, Object3DEventMap } from '../runtime/index.js';

export type ColorValueInput =
  | number
  | string
  | Color
  | readonly [number, number, number]
  | readonly [number, number, number, number];

/**
 * The value `setValue` accepts for a field: Color fields also take hex
 * numbers, `#RRGGBB`/`#RRGGBBAA` strings, `Color` objects and RGB tuples.
 */
type SetValueInput<
  C extends AnyComponent,
  K extends keyof C['schema'],
> = C['schema'][K]['type'] extends 'Color'
  ? ColorValueInput
  : TypeValueToType<C['schema'][K]['type']>;

/** Options for {@link Entity.dispose}. @category ECS */
export interface EntityDisposeOptions {
  /**
   * Whether to dispose GPU resources attached to this entity's Object3D tree.
   *
   * @defaultValue true
   */
  disposeResources?: boolean;
}

declare module 'elics' {
  interface Entity {
    object3D?: Object3D<Object3DEventMap & PointerEventsMap>;
    /** @internal Flag to indicate GPU resources should be disposed on destroy */
    _disposeResources?: boolean;
    /**
     * Destroy the entity and dispose of its GPU resources (geometry, materials, textures).
     *
     * @remarks
     * Use this instead of `destroy()` when you want to fully clean up GPU memory.
     * Use with caution when resources may be shared across multiple entities.
     *
     * @example
     * ```ts
     * // Remove entity and free GPU resources
     * entity.dispose();
     *
     * // Remove entity while preserving shared geometry/materials
     * entity.dispose({ disposeResources: false });
     * ```
     */
    dispose(options?: EntityDisposeOptions): void;
    // Keyed on every schema field, like elics' own signature, so editors
    // keep completing all keys (an overload limited to Color keys hid the
    // others).
    setValue<C extends AnyComponent, K extends keyof C['schema']>(
      component: C,
      key: K,
      value: SetValueInput<C, K>,
    ): void;
  }
}

function normalizeColorValue(value: unknown): [number, number, number, number] {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      throw new Error(
        'Color hex numbers must be RGB integers between 0x000000 and 0xffffff. Use #RRGGBBAA strings when alpha is needed.',
      );
    }
    return [
      ((value >> 16) & 0xff) / 255,
      ((value >> 8) & 0xff) / 255,
      (value & 0xff) / 255,
      1,
    ];
  }

  if (typeof value === 'string') {
    const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value);
    if (!match) {
      throw new Error('Color strings must use #RRGGBB or #RRGGBBAA.');
    }

    const hex = match[1];
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    ];
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { isColor?: unknown }).isColor === true &&
    typeof (value as { toArray?: unknown }).toArray === 'function'
  ) {
    const [r = 1, g = 1, b = 1] = (value as Color).toArray();
    return [r, g, b, 1];
  }

  if (Array.isArray(value)) {
    if (value.length !== 3 && value.length !== 4) {
      throw new Error('Color arrays must have 3 or 4 entries.');
    }
    if (
      !value.every(
        (entry) => typeof entry === 'number' && Number.isFinite(entry),
      )
    ) {
      throw new Error('Color array entries must be finite numbers.');
    }
    const [r, g, b, a = 1] = value;
    return [r, g, b, a];
  }

  throw new Error(
    'Color values must be a hex number, #RRGGBB/#RRGGBBAA string, THREE.Color, or RGB/RGBA array.',
  );
}

const originalSetValue = ElicsEntity.prototype.setValue;

ElicsEntity.prototype.setValue = function setValueWithColorCoercion(
  this: ElicsEntity,
  component: any,
  key: any,
  value: any,
) {
  if (component.schema[key]?.type === Types.Color) {
    ((this as any).getVectorView(component, key) as Float32Array).set(
      normalizeColorValue(value),
    );
    (this as any).queryManager.updateEntityValue(this, component);
    return;
  }

  (originalSetValue as any).call(this, component, key, value);
};

// Add dispose method to Entity prototype
ElicsEntity.prototype.dispose = function (
  this: ElicsEntity,
  options?: EntityDisposeOptions,
) {
  if (options?.disposeResources !== false) {
    (this as any)._disposeResources = true;
  }
  this.destroy();
};

export { Entity } from 'elics';
/** Sentinel value used for "no parent" in Transform.parent. @category ECS */
export const NullEntity = -1;
