/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SimpleBatchedMesh - A multiview-compatible batched mesh implementation
 *
 * This is based on the THREE.js r165 BatchedMesh approach which uses a vertex
 * attribute for batch IDs instead of gl_DrawID. This works correctly with
 * multiview rendering on Quest, where the gl_DrawID-based approach fails.
 *
 * Key differences from modern THREE.js BatchedMesh:
 * - Uses `attribute float batchId` instead of `gl_DrawID`
 * - Simpler API: each geometry is its own instance
 * - No dependency on WEBGL_multi_draw extension
 */

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  Material,
  Matrix4,
  Mesh,
  RGBAFormat,
  REVISION,
  Sphere,
} from 'three';

const ID_ATTR_NAME = 'batchId';
const _identityMatrix = new Matrix4();
// Since r183, three's vertex color varying is always a vec4.
const VEC4_VERTEX_COLORS = parseInt(REVISION) >= 183;

// Helper to copy attribute data
function copyAttributeData(
  src: BufferAttribute,
  target: BufferAttribute,
  targetOffset = 0,
) {
  const itemSize = target.itemSize;
  if (src.array.constructor !== target.array.constructor) {
    const vertexCount = src.count;
    for (let i = 0; i < vertexCount; i++) {
      for (let c = 0; c < itemSize; c++) {
        target.setComponent(i + targetOffset, c, src.getComponent(i, c));
      }
    }
  } else {
    target.array.set(src.array, targetOffset * itemSize);
  }
  target.needsUpdate = true;
}

export class SimpleBatchedMesh extends Mesh {
  // Do NOT set isBatchedMesh = true - that triggers THREE.js's multi-draw path
  // which we don't support. Instead we handle batching entirely through material patching.
  readonly isSimpleBatchedMesh = true;

  private _drawRanges: Array<{ start: number; count: number }> = [];
  private _reservedRanges: Array<{
    vertexStart: number;
    vertexCount: number;
    indexStart: number;
    indexCount: number;
  }> = [];
  private _visibility: boolean[] = [];
  private _active: boolean[] = [];
  private _bounds: Array<{
    boxInitialized: boolean;
    box: Box3;
    sphereInitialized: boolean;
    sphere: Sphere;
  }> = [];

  private _maxGeometryCount: number;
  private _maxVertexCount: number;
  private _maxIndexCount: number;

  private _geometryInitialized = false;
  private _geometryCount = 0;

  // Matrices texture for batch transforms
  private _matricesTexture: DataTexture | null = null;

  constructor(
    maxGeometryCount: number,
    maxVertexCount: number,
    maxIndexCount: number = maxVertexCount * 2,
    material: Material,
  ) {
    super(new BufferGeometry(), material);

    this._maxGeometryCount = maxGeometryCount;
    this._maxVertexCount = maxVertexCount;
    this._maxIndexCount = maxIndexCount;

    this._initMatricesTexture();

    // Patch the material to use batchId attribute
    this._patchMaterial(material);
  }

  get maxGeometryCount() {
    return this._maxGeometryCount;
  }

  private _initMatricesTexture() {
    // Layout: 1 matrix = 4 pixels (RGBA each column)
    let size = Math.sqrt(this._maxGeometryCount * 4);
    size = Math.ceil(size / 4) * 4;
    size = Math.max(size, 4);

    const matricesArray = new Float32Array(size * size * 4);
    const matricesTexture = new DataTexture(
      matricesArray,
      size,
      size,
      RGBAFormat,
      FloatType,
    );

    this._matricesTexture = matricesTexture;
  }

  private _patchMaterial(material: Material) {
    // Add the batchingTexture uniform and onBeforeCompile hook
    const self = this;

    material.onBeforeCompile = (shader) => {
      // Add uniforms
      shader.uniforms.batchingTexture = { value: self._matricesTexture };

      // Inject USE_BATCHING define at the start of vertex shader
      // (THREE.js won't add it since we don't set isBatchedMesh = true)
      shader.vertexShader = '#define USE_BATCHING\n' + shader.vertexShader;

      // Add batching pars to vertex shader (r165 style with attribute)
      // Includes both matrix lookup and color lookup functions
      const batchingParsVertex = `
        #ifdef USE_BATCHING
          attribute float batchId;
          uniform highp sampler2D batchingTexture;
          mat4 getBatchingMatrix( const in float i ) {
            int size = textureSize( batchingTexture, 0 ).x;
            int j = int( i ) * 4;
            int x = j % size;
            int y = j / size;
            vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
            vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
            vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
            vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
            return mat4( v1, v2, v3, v4 );
          }
        #endif
        #ifdef USE_BATCHING_COLOR
          uniform sampler2D batchingColorTexture;
          vec4 getBatchingColor( const in float i ) {
            int size = textureSize( batchingColorTexture, 0 ).x;
            int j = int( i );
            int x = j % size;
            int y = j / size;
            return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
          }
        #endif
      `;

      // Replace THREE.js batching_pars_vertex
      shader.vertexShader = shader.vertexShader.replace(
        '#include <batching_pars_vertex>',
        batchingParsVertex,
      );

      // Replace batching_vertex to use batchId attribute
      const batchingVertex = `
        #ifdef USE_BATCHING
          mat4 batchingMatrix = getBatchingMatrix( batchId );
        #endif
      `;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <batching_vertex>',
        batchingVertex,
      );

      // Replace color_vertex to use batchId for batching color (r165 style);
      // three's own chunk uses getIndirectIndex(gl_DrawID), which we don't
      // support. vColor is a vec4 since r183 and a vec3 (vec4 with
      // USE_COLOR_ALPHA) before that.
      const colorVertex = VEC4_VERTEX_COLORS
        ? `
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
          vColor = vec4( 1.0 );
        #endif
        #ifdef USE_COLOR_ALPHA
          vColor *= color;
        #elif defined( USE_COLOR )
          vColor.rgb *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= instanceColor.rgb;
        #endif
        #ifdef USE_BATCHING_COLOR
          vColor *= getBatchingColor( batchId );
        #endif
      `
        : `
        #if defined( USE_COLOR_ALPHA )
          vColor = vec4( 1.0 );
        #elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
          vColor = vec3( 1.0 );
        #endif
        #ifdef USE_COLOR
          vColor *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz *= instanceColor.xyz;
        #endif
        #ifdef USE_BATCHING_COLOR
          vColor.xyz *= getBatchingColor( batchId ).xyz;
        #endif
      `;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        colorVertex,
      );
    };

    // Force material to use batching
    (material as any).batching = true;
    material.needsUpdate = true;
  }

  private _initializeGeometry(reference: BufferGeometry) {
    const geometry = this.geometry as BufferGeometry;
    const maxVertexCount = this._maxVertexCount;
    const maxGeometryCount = this._maxGeometryCount;
    const maxIndexCount = this._maxIndexCount;

    if (this._geometryInitialized === false) {
      for (const attributeName in reference.attributes) {
        const srcAttribute = reference.getAttribute(
          attributeName,
        ) as BufferAttribute;
        const { array, itemSize, normalized } = srcAttribute;

        const dstArray = new (array.constructor as any)(
          maxVertexCount * itemSize,
        );
        const dstAttribute = new BufferAttribute(
          dstArray,
          itemSize,
          normalized,
        );

        geometry.setAttribute(attributeName, dstAttribute);
      }

      if (reference.getIndex() !== null) {
        const indexArray =
          maxVertexCount > 65536
            ? new Uint32Array(maxIndexCount)
            : new Uint16Array(maxIndexCount);

        geometry.setIndex(new BufferAttribute(indexArray, 1));
      }

      // Add batchId attribute (the key difference from r181)
      const idArray =
        maxGeometryCount > 65536
          ? new Uint32Array(maxVertexCount)
          : new Uint16Array(maxVertexCount);
      geometry.setAttribute(ID_ATTR_NAME, new BufferAttribute(idArray, 1));

      this._geometryInitialized = true;
    }
  }

  private _validateGeometry(geometry: BufferGeometry) {
    if (geometry.getAttribute(ID_ATTR_NAME)) {
      throw new Error(
        `SimpleBatchedMesh: Geometry cannot use attribute "${ID_ATTR_NAME}"`,
      );
    }

    const batchGeometry = this.geometry as BufferGeometry;
    if (Boolean(geometry.getIndex()) !== Boolean(batchGeometry.getIndex())) {
      throw new Error(
        'SimpleBatchedMesh: All geometries must consistently have "index".',
      );
    }

    for (const attributeName in batchGeometry.attributes) {
      if (attributeName === ID_ATTR_NAME) {
        continue;
      }

      if (!geometry.hasAttribute(attributeName)) {
        throw new Error(
          `SimpleBatchedMesh: Added geometry missing "${attributeName}".`,
        );
      }

      const srcAttribute = geometry.getAttribute(
        attributeName,
      ) as BufferAttribute;
      const dstAttribute = batchGeometry.getAttribute(
        attributeName,
      ) as BufferAttribute;
      if (
        srcAttribute.itemSize !== dstAttribute.itemSize ||
        srcAttribute.normalized !== dstAttribute.normalized
      ) {
        throw new Error(
          'SimpleBatchedMesh: All attributes must have consistent itemSize and normalized value.',
        );
      }
    }
  }

  addGeometry(
    geometry: BufferGeometry,
    vertexCount = -1,
    indexCount = -1,
  ): number {
    this._initializeGeometry(geometry);
    this._validateGeometry(geometry);

    if (this._geometryCount >= this._maxGeometryCount) {
      throw new Error('SimpleBatchedMesh: Maximum geometry count reached.');
    }

    const reservedRange = {
      vertexStart: -1,
      vertexCount: -1,
      indexStart: -1,
      indexCount: -1,
    };

    let lastRange = null;
    const reservedRanges = this._reservedRanges;
    if (this._geometryCount !== 0) {
      lastRange = reservedRanges[reservedRanges.length - 1];
    }

    if (vertexCount === -1) {
      reservedRange.vertexCount = (
        geometry.getAttribute('position') as BufferAttribute
      ).count;
    } else {
      reservedRange.vertexCount = vertexCount;
    }

    if (lastRange === null) {
      reservedRange.vertexStart = 0;
    } else {
      reservedRange.vertexStart = lastRange.vertexStart + lastRange.vertexCount;
    }

    const index = geometry.getIndex();
    const hasIndex = index !== null;
    if (hasIndex) {
      if (indexCount === -1) {
        reservedRange.indexCount = index!.count;
      } else {
        reservedRange.indexCount = indexCount;
      }

      if (lastRange === null) {
        reservedRange.indexStart = 0;
      } else {
        reservedRange.indexStart = lastRange.indexStart + lastRange.indexCount;
      }
    }

    if (
      (reservedRange.indexStart !== -1 &&
        reservedRange.indexStart + reservedRange.indexCount >
          this._maxIndexCount) ||
      reservedRange.vertexStart + reservedRange.vertexCount >
        this._maxVertexCount
    ) {
      throw new Error(
        'SimpleBatchedMesh: Reserved space request exceeds maximum buffer size.',
      );
    }

    this._visibility.push(true);
    this._active.push(true);

    const geometryId = this._geometryCount;
    this._geometryCount++;

    // Initialize matrix to identity
    const matricesArray = this._matricesTexture!.image.data as Float32Array;
    _identityMatrix.toArray(matricesArray, geometryId * 16);
    this._matricesTexture!.needsUpdate = true;

    reservedRanges.push(reservedRange);
    this._drawRanges.push({
      start: hasIndex ? reservedRange.indexStart : reservedRange.vertexStart,
      count: -1,
    });
    this._bounds.push({
      boxInitialized: false,
      box: new Box3(),
      sphereInitialized: false,
      sphere: new Sphere(),
    });

    // Set the batchId for all vertices of this geometry
    const idAttribute = (this.geometry as BufferGeometry).getAttribute(
      ID_ATTR_NAME,
    ) as BufferAttribute;
    for (let i = 0; i < reservedRange.vertexCount; i++) {
      idAttribute.setX(reservedRange.vertexStart + i, geometryId);
    }
    idAttribute.needsUpdate = true;

    // Copy geometry data
    this.setGeometryAt(geometryId, geometry);

    return geometryId;
  }

  setGeometryAt(id: number, geometry: BufferGeometry): number {
    if (id >= this._geometryCount) {
      throw new Error('SimpleBatchedMesh: Maximum geometry count reached.');
    }

    this._validateGeometry(geometry);

    const batchGeometry = this.geometry as BufferGeometry;
    const hasIndex = batchGeometry.getIndex() !== null;
    const dstIndex = batchGeometry.getIndex();
    const srcIndex = geometry.getIndex();
    const reservedRange = this._reservedRanges[id];

    if (
      (hasIndex && srcIndex!.count > reservedRange.indexCount) ||
      (geometry.getAttribute('position') as BufferAttribute).count >
        reservedRange.vertexCount
    ) {
      throw new Error(
        'SimpleBatchedMesh: Reserved space not large enough for provided geometry.',
      );
    }

    const vertexStart = reservedRange.vertexStart;
    const vertexCount = reservedRange.vertexCount;

    for (const attributeName in batchGeometry.attributes) {
      if (attributeName === ID_ATTR_NAME) {
        continue;
      }

      const srcAttribute = geometry.getAttribute(
        attributeName,
      ) as BufferAttribute;
      const dstAttribute = batchGeometry.getAttribute(
        attributeName,
      ) as BufferAttribute;
      copyAttributeData(srcAttribute, dstAttribute, vertexStart);

      // Fill rest with zeroes
      const itemSize = srcAttribute.itemSize;
      for (let i = srcAttribute.count; i < vertexCount; i++) {
        const index = vertexStart + i;
        for (let c = 0; c < itemSize; c++) {
          dstAttribute.setComponent(index, c, 0);
        }
      }

      dstAttribute.needsUpdate = true;
    }

    // Copy index
    if (hasIndex && dstIndex && srcIndex) {
      const indexStart = reservedRange.indexStart;

      for (let i = 0; i < srcIndex.count; i++) {
        dstIndex.setX(indexStart + i, vertexStart + srcIndex.getX(i));
      }

      for (let i = srcIndex.count; i < reservedRange.indexCount; i++) {
        dstIndex.setX(indexStart + i, vertexStart);
      }

      dstIndex.needsUpdate = true;
    }

    // Store bounding info
    const bound = this._bounds[id];
    if (geometry.boundingBox !== null) {
      bound.box.copy(geometry.boundingBox);
      bound.boxInitialized = true;
    } else {
      bound.boxInitialized = false;
    }

    if (geometry.boundingSphere !== null) {
      bound.sphere.copy(geometry.boundingSphere);
      bound.sphereInitialized = true;
    } else {
      bound.sphereInitialized = false;
    }

    // Set draw range count
    const drawRange = this._drawRanges[id];
    const posAttr = geometry.getAttribute('position') as BufferAttribute;
    drawRange.count = hasIndex ? srcIndex!.count : posAttr.count;

    return id;
  }

  setMatrixAt(geometryId: number, matrix: Matrix4): this {
    const active = this._active;
    const matricesTexture = this._matricesTexture!;
    const matricesArray = matricesTexture.image.data as Float32Array;

    if (geometryId >= this._geometryCount || active[geometryId] === false) {
      return this;
    }

    matrix.toArray(matricesArray, geometryId * 16);
    matricesTexture.needsUpdate = true;

    return this;
  }

  getMatrixAt(geometryId: number, matrix: Matrix4): Matrix4 | null {
    const active = this._active;
    const matricesArray = this._matricesTexture!.image.data as Float32Array;

    if (geometryId >= this._geometryCount || active[geometryId] === false) {
      return null;
    }

    return matrix.fromArray(matricesArray, geometryId * 16);
  }

  setVisibleAt(geometryId: number, value: boolean): this {
    const visibility = this._visibility;
    const active = this._active;

    if (
      geometryId >= this._geometryCount ||
      active[geometryId] === false ||
      visibility[geometryId] === value
    ) {
      return this;
    }

    visibility[geometryId] = value;
    return this;
  }

  getVisibleAt(geometryId: number): boolean {
    const visibility = this._visibility;
    const active = this._active;

    if (geometryId >= this._geometryCount || active[geometryId] === false) {
      return false;
    }

    return visibility[geometryId];
  }

  dispose() {
    this.geometry.dispose();
    this._matricesTexture?.dispose();
  }
}
