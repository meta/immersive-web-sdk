/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDomeFadeMaterial,
  DOME_FADE_GLSL,
  DomeFadeBinding,
  domeFadeSpecFromComponentValue,
  injectDomeFade,
} from '../../src/environment/dome-fade-binding.js';
import { createDomeGradientUniforms } from '../../src/environment/gradient-environment.js';
import {
  BoxGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  PointsMaterial,
  ShaderLib,
  ShaderMaterial,
  ShadowMaterial,
  UniformsUtils,
  Vector4,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from '../../src/runtime/index.js';

const SUPPORTED: Array<[string, () => Material, keyof typeof ShaderLib]> = [
  ['MeshBasicMaterial', () => new MeshBasicMaterial(), 'basic'],
  ['MeshLambertMaterial', () => new MeshLambertMaterial(), 'lambert'],
  ['MeshPhongMaterial', () => new MeshPhongMaterial(), 'phong'],
  ['MeshStandardMaterial', () => new MeshStandardMaterial(), 'standard'],
  ['MeshPhysicalMaterial', () => new MeshPhysicalMaterial(), 'physical'],
  ['MeshToonMaterial', () => new MeshToonMaterial(), 'toon'],
];

const MULTIVIEW_DEFINED = [
  'viewMatrix',
  'projectionMatrix',
  'modelViewMatrix',
  'normalMatrix',
];

const renderer = {} as WebGLRenderer;

function shaderFor(
  name: keyof typeof ShaderLib,
): WebGLProgramParametersWithUniforms {
  const source = ShaderLib[name];
  return {
    fragmentShader: source.fragmentShader,
    uniforms: UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
  } as WebGLProgramParametersWithUniforms;
}

function compile(material: Material, name: keyof typeof ShaderLib) {
  const shader = shaderFor(name);
  material.onBeforeCompile(shader, renderer);
  return shader;
}

function nodeMesh(nodeId: string, material: Material | Material[]): Mesh {
  const mesh = new Mesh(new BoxGeometry(), material);
  mesh.userData.iwsdkSceneNodeId = nodeId;
  return mesh;
}

function floorNode(...children: Mesh[]): Group {
  const root = new Group();
  root.userData.iwsdkSceneNodeId = 'floor';
  root.add(...children);
  return root;
}

function bind(root: Group, spec = { end: 10, start: 4 }) {
  return new DomeFadeBinding(root, createDomeGradientUniforms(), spec);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DomeFade material patch', () => {
  for (const [type, create, shaderName] of SUPPORTED) {
    it(`injects the fade into ${type} at the documented anchors`, () => {
      const uniforms = createDomeGradientUniforms();
      const params = { value: new Vector4(4, 10, 0, 0) };
      const clone = createDomeFadeMaterial(create(), uniforms, params);
      const shader = compile(clone, shaderName);
      const vertex = shader.vertexShader;
      const fragment = shader.fragmentShader;

      expect(vertex).toContain(
        `#include <common>${DOME_FADE_GLSL.vertexDeclarations}`,
      );
      expect(vertex).toContain(
        `#include <project_vertex>${DOME_FADE_GLSL.vertexWorldPosition}`,
      );
      const world = vertex.slice(vertex.indexOf('vec4 iwsdkFadeWorld'));
      expect(world.indexOf('#ifdef USE_BATCHING')).toBeLessThan(
        world.indexOf('batchingMatrix * iwsdkFadeWorld'),
      );
      expect(world.indexOf('batchingMatrix * iwsdkFadeWorld')).toBeLessThan(
        world.indexOf('#ifdef USE_INSTANCING'),
      );
      expect(world.indexOf('instanceMatrix * iwsdkFadeWorld')).toBeLessThan(
        world.indexOf('modelMatrix * iwsdkFadeWorld'),
      );
      expect(fragment).toContain(
        `#include <common>${DOME_FADE_GLSL.fragmentDeclarations}`,
      );
      expect(fragment).toContain(
        `#include <fog_fragment>${DOME_FADE_GLSL.fragmentFade}`,
      );
      expect(fragment.indexOf(DOME_FADE_GLSL.fragmentFade)).toBeLessThan(
        fragment.indexOf('#include <premultiplied_alpha_fragment>'),
      );
      expect(fragment.indexOf(DOME_FADE_GLSL.fragmentFade)).toBeLessThan(
        fragment.indexOf('#include <dithering_fragment>'),
      );
      expect(vertex.match(/vIwsdkDomeFadeWorld;/g)).toHaveLength(1);

      expect(shader.uniforms.iwsdkDomeSky).toBe(uniforms.sky);
      expect(shader.uniforms.iwsdkDomeEquator).toBe(uniforms.equator);
      expect(shader.uniforms.iwsdkDomeGround).toBe(uniforms.ground);
      expect(shader.uniforms.iwsdkDomeAxis).toBe(uniforms.axis);
      expect(shader.uniforms.iwsdkDomeDither).toBe(uniforms.dither);
      expect(shader.uniforms.iwsdkDomeActive).toBe(uniforms.active);
      expect(shader.uniforms.iwsdkDomeFadeParams).toBe(params);
    });
  }

  it('leaves the source untouched and copies its identity', () => {
    const source = new MeshStandardMaterial({ color: 0x336699 });
    source.name = 'clay floor';
    source.userData.iwsdkSceneMaterialId = 'clay';
    const sourceHook = source.onBeforeCompile;
    const sourceKey = source.customProgramCacheKey();
    const clone = createDomeFadeMaterial(source, createDomeGradientUniforms(), {
      value: new Vector4(),
    });
    expect(clone).not.toBe(source);
    expect(clone.name).toBe('clay floor');
    expect(clone.userData).toEqual({
      iwsdkDomeFadeClone: true,
      iwsdkSceneMaterialId: 'clay',
    });
    expect(source.userData.iwsdkDomeFadeClone).toBeUndefined();
    expect(source.onBeforeCompile).toBe(sourceHook);
    expect(source.customProgramCacheKey()).toBe(sourceKey);
    expect(clone.customProgramCacheKey()).toBe(
      `${sourceKey}|iwsdk-dome-fade-v1`,
    );
    const shader = shaderFor('standard');
    const original = shader.fragmentShader;
    source.onBeforeCompile(shader, renderer);
    expect(shader.fragmentShader).toBe(original);
  });

  it('runs a chained source hook first and keys programs by it', () => {
    const calls: string[] = [];
    const first = new MeshStandardMaterial();
    first.onBeforeCompile = (shader) => {
      calls.push('source');
      expect(shader.fragmentShader).not.toContain('iwsdkDomeFadeParams');
      shader.fragmentShader = `// tinted\n${shader.fragmentShader}`;
    };
    const second = new MeshStandardMaterial();
    second.onBeforeCompile = (shader) => {
      shader.vertexShader = `// bent\n${shader.vertexShader}`;
    };
    const uniforms = createDomeGradientUniforms();
    const params = { value: new Vector4() };
    const firstClone = createDomeFadeMaterial(first, uniforms, params);
    const secondClone = createDomeFadeMaterial(second, uniforms, params);

    const shader = compile(firstClone, 'standard');
    expect(calls).toEqual(['source']);
    expect(shader.fragmentShader.startsWith('// tinted\n')).toBe(true);
    expect(shader.fragmentShader).toContain(DOME_FADE_GLSL.fragmentFade);
    expect(firstClone.customProgramCacheKey()).toBe(
      `${first.customProgramCacheKey()}|iwsdk-dome-fade-v1`,
    );
    expect(firstClone.customProgramCacheKey()).not.toBe(
      secondClone.customProgramCacheKey(),
    );
  });

  it('injects once when a chained hook already faded the shader', () => {
    const uniforms = createDomeGradientUniforms();
    const first = createDomeFadeMaterial(new MeshStandardMaterial(), uniforms, {
      value: new Vector4(),
    });
    const copy = first.clone();
    copy.onBeforeCompile = first.onBeforeCompile;
    const params = { value: new Vector4() };
    const second = createDomeFadeMaterial(copy, uniforms, params);
    const shader = compile(second, 'standard');
    expect(
      shader.fragmentShader.match(/uniform vec4 iwsdkDomeFadeParams;/g),
    ).toHaveLength(1);
    expect(shader.vertexShader.match(/vIwsdkDomeFadeWorld;/g)).toHaveLength(1);
  });

  it('keys a hook installed over the fade by its own text', () => {
    const source = new MeshStandardMaterial();
    const uniforms = createDomeGradientUniforms();
    const params = { value: new Vector4() };
    const clone = createDomeFadeMaterial(source, uniforms, params);
    const fadeKey = `${source.customProgramCacheKey()}|iwsdk-dome-fade-v1`;
    const fadeHook = clone.onBeforeCompile;
    clone.onBeforeCompile = function (shader, renderer) {
      fadeHook.call(this, shader, renderer);
      shader.fragmentShader += '\n// occluded';
    };
    const occludedKey = clone.customProgramCacheKey();
    expect(occludedKey).not.toBe(fadeKey);
    expect(occludedKey.startsWith(fadeKey)).toBe(true);
    clone.onBeforeCompile = fadeHook;
    expect(clone.customProgramCacheKey()).toBe(fadeKey);
  });

  it('leaves a shader unpatched and warns once per type when an anchor is gone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const uniforms = createDomeGradientUniforms();
    const params = { value: new Vector4() };
    const shader = shaderFor('toon');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      '',
    );
    const vertex = shader.vertexShader;
    expect(injectDomeFade(shader, uniforms, params, 'MissingAnchorTest')).toBe(
      false,
    );
    expect(shader.vertexShader).toBe(vertex);
    expect(shader.uniforms.iwsdkDomeFadeParams).toBeUndefined();
    injectDomeFade(shader, uniforms, params, 'MissingAnchorTest');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('declares no identifier that the multiview prefix defines', () => {
    const injected = Object.values(DOME_FADE_GLSL).join('\n');
    const declared = [
      ...injected.matchAll(
        /\b(?:uniform|varying)\s+\w+\s+(\w+)\s*;|\b(?:float|int|vec[234]|mat[234])\s+(\w+)\s*[=;(]/g,
      ),
    ].map((match) => match[1] ?? match[2]);
    expect(declared).toEqual(
      expect.arrayContaining([
        'vIwsdkDomeFadeWorld',
        'iwsdkDomeFadeParams',
        'iwsdkFadeT',
        'iwsdkFadeWorld',
      ]),
    );
    for (const name of MULTIVIEW_DEFINED) {
      expect(declared).not.toContain(name);
      expect(injected).not.toContain(name);
    }
  });
});

describe('DomeFadeBinding', () => {
  it('clones a source once per binding', () => {
    const source = new MeshStandardMaterial();
    const a = nodeMesh('floor', source);
    const b = nodeMesh('floor', source);
    const binding = bind(floorNode(a, b));
    expect(a.material).not.toBe(source);
    expect(b.material).toBe(a.material);
    expect(binding.meshCount).toBe(2);

    const otherMesh = nodeMesh('terrain', source);
    const otherRoot = new Group();
    otherRoot.userData.iwsdkSceneNodeId = 'terrain';
    otherRoot.add(otherMesh);
    bind(otherRoot as Group);
    expect(otherMesh.material).not.toBe(source);
    expect(otherMesh.material).not.toBe(a.material);
  });

  it('skips and counts unsupported materials, and patches material arrays', () => {
    const shader = new ShaderMaterial();
    const shadow = new ShadowMaterial();
    const points = new PointsMaterial();
    const standard = new MeshStandardMaterial();
    const multi = nodeMesh('floor', [standard, shadow]);
    const binding = bind(
      floorNode(
        nodeMesh('floor', shader),
        nodeMesh('floor', shadow),
        nodeMesh('floor', points),
        multi,
      ),
    );
    expect(binding.skippedMaterials).toBe(3);
    expect(binding.meshCount).toBe(1);
    expect([...binding.meshes]).toEqual([multi]);
    const materials = multi.material as Material[];
    expect(materials[0]).not.toBe(standard);
    expect(materials[0].userData.iwsdkDomeFadeClone).toBe(true);
    expect(materials[1]).toBe(shadow);

    binding.dispose();
    expect(multi.material).toEqual([standard, shadow]);
  });

  it("patches only the node's own content", () => {
    const own = nodeMesh('floor', new MeshStandardMaterial());
    const childNode = nodeMesh('rug', new MeshStandardMaterial());
    const childEntity = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    (childEntity as any).entityIdx = 7;
    const blob = nodeMesh('floor', new MeshBasicMaterial());
    blob.userData.iwsdkRuntimeOnly = true;
    const helper = nodeMesh('floor', new MeshBasicMaterial());
    helper.userData.iwsdkEditorHelper = true;
    const nested = nodeMesh('floor', new MeshStandardMaterial());
    childNode.add(nested);
    const root = floorNode(own, childNode, childEntity, blob, helper);
    (root as any).entityIdx = 3;
    const sources = new Map(
      [childNode, childEntity, blob, helper, nested].map((mesh) => [
        mesh,
        mesh.material,
      ]),
    );

    const binding = bind(root);
    expect([...binding.meshes]).toEqual([own]);
    for (const [mesh, material] of sources) {
      expect(mesh.material).toBe(material);
    }
  });

  it('picks up meshes added later and foreign material swaps', () => {
    const first = nodeMesh('floor', new MeshStandardMaterial());
    const root = floorNode(first);
    const binding = bind(root);
    const firstClone = first.material;

    const later = nodeMesh('floor', new MeshLambertMaterial());
    root.add(later);
    expect(later.material).toBeInstanceOf(MeshLambertMaterial);
    expect(binding.meshCount).toBe(1);
    binding.refresh();
    expect(binding.meshCount).toBe(2);
    expect((later.material as Material).userData.iwsdkDomeFadeClone).toBe(true);

    // A review-lens style swap is patched as a new source; restoring the old
    // material keeps using its existing clone.
    const neutral = new MeshStandardMaterial({ color: 0xb8bdc4 });
    const previous = first.material;
    first.material = neutral;
    binding.refresh();
    expect(first.material).not.toBe(neutral);
    expect((first.material as Material).userData.iwsdkDomeFadeClone).toBe(true);
    first.material = previous;
    binding.refresh();
    expect(first.material).toBe(firstClone);
  });

  it('patches a copy of one of its clones as a new source', () => {
    const source = new MeshStandardMaterial({ color: 0x336699 });
    const mesh = nodeMesh('floor', source);
    const binding = bind(floorNode(mesh));
    const clone = mesh.material as Material;

    // Restyling one instance: `Material.copy()` keeps the userData flag but
    // not the fade hook.
    const restyled = clone.clone() as MeshStandardMaterial;
    restyled.color.set(0xff0000);
    expect(restyled.userData.iwsdkDomeFadeClone).toBe(true);
    mesh.material = restyled;
    binding.refresh();
    expect(binding.meshCount).toBe(1);
    expect(binding.skippedMaterials).toBe(0);
    const repatched = mesh.material as MeshStandardMaterial;
    expect(repatched).not.toBe(restyled);
    expect(repatched).not.toBe(clone);
    expect(repatched.color.getHex()).toBe(0xff0000);
    const shader = compile(repatched, 'standard');
    expect(
      shader.fragmentShader.match(/uniform vec4 iwsdkDomeFadeParams;/g),
    ).toHaveLength(1);

    binding.dispose();
    expect(mesh.material).toBe(restyled);
  });

  it("skips another binding's clone instead of patching it twice", () => {
    const shared = nodeMesh('floor', new MeshStandardMaterial());
    const first = bind(floorNode(shared));
    const firstClone = shared.material as Material;
    const other = nodeMesh('terrain', firstClone);
    const otherRoot = new Group();
    otherRoot.userData.iwsdkSceneNodeId = 'terrain';
    otherRoot.add(other);
    const second = bind(otherRoot);
    expect(other.material).toBe(firstClone);
    expect(second.meshCount).toBe(0);
    expect(second.skippedMaterials).toBe(1);
    expect(first.meshCount).toBe(1);
  });

  it('skips a material it cannot copy and warns once', () => {
    class NeedsArgumentMaterial extends MeshStandardMaterial {
      constructor(required?: string) {
        super();
        if (required === undefined) {
          throw new Error('NeedsArgumentMaterial needs an argument');
        }
      }
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const material = new NeedsArgumentMaterial('clay');
    const cloneSpy = vi.spyOn(material, 'clone');
    const mesh = nodeMesh('floor', material);
    const binding = bind(floorNode(mesh));
    expect(mesh.material).toBe(material);
    expect(binding.meshCount).toBe(0);
    expect(binding.skippedMaterials).toBe(1);
    binding.refresh();
    expect(binding.skippedMaterials).toBe(1);
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('node "floor"');
  });

  it('disposes the clone of a source its owner disposed once no mesh shows it', () => {
    const source = new MeshStandardMaterial();
    const mesh = nodeMesh('floor', source);
    const binding = bind(floorNode(mesh));
    const clone = mesh.material as Material;
    const disposed: Material[] = [];
    clone.addEventListener('dispose', () => disposed.push(clone));

    // The editor's ghost: a copy swapped in, then restored and disposed.
    for (let pass = 0; pass < 3; pass += 1) {
      const ghost = clone.clone();
      ghost.transparent = true;
      mesh.material = ghost;
      binding.refresh();
      const ghostClone = mesh.material as Material;
      expect(ghostClone).not.toBe(ghost);
      ghostClone.addEventListener('dispose', () => disposed.push(ghostClone));

      // Disposed while its clone is still shown: kept until it is not.
      ghost.dispose();
      binding.refresh();
      expect(disposed).not.toContain(ghostClone);

      mesh.material = clone;
      binding.refresh();
      expect(disposed).toEqual(expect.arrayContaining([ghostClone]));
      expect((binding as any).cloneBySource.size).toBe(1);
      expect((ghost as any)._listeners.dispose).toHaveLength(0);
    }
    expect(disposed).toHaveLength(3);
    expect(disposed).not.toContain(clone);
    expect(mesh.material).toBe(clone);

    binding.dispose();
    expect(mesh.material).toBe(source);
    expect((source as any)._listeners.dispose).toHaveLength(0);
  });

  it('writes fade distances without new clones or recompiles', () => {
    const mesh = nodeMesh('floor', new MeshStandardMaterial());
    const binding = bind(floorNode(mesh));
    const clone = mesh.material as Material;
    const version = clone.version;

    binding.update({ end: 12, start: 2 });
    binding.refresh();
    expect(binding.params.value.x).toBe(2);
    expect(binding.params.value.y).toBe(12);
    expect(mesh.material).toBe(clone);
    expect(clone.version).toBe(version);
  });

  it('sanitizes the fade distances and warns once when it raises end', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const binding = bind(floorNode(), { end: Number.NaN, start: Number.NaN });
    expect(binding.params.value.toArray().slice(0, 2)).toEqual([4, 10]);
    binding.update({ end: 3, start: -2 });
    expect(binding.params.value.x).toBe(0);
    expect(binding.params.value.y).toBe(3);
    binding.update({ end: 5, start: 6 });
    expect(binding.params.value.x).toBe(6);
    expect(binding.params.value.y).toBeCloseTo(6.001, 9);
    binding.update({ end: 1, start: 6 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('follows the node origin on X/Z', () => {
    const parent = new Group();
    parent.position.set(1, 0, 2);
    const root = floorNode();
    root.position.set(5, 3, -4);
    parent.add(root);
    const binding = bind(root);
    expect(binding.params.value.z).toBe(6);
    expect(binding.params.value.w).toBe(-2);
    root.position.x = 0;
    binding.syncTransform();
    expect(binding.params.value.z).toBe(1);
  });

  it('replaces the marker only when a value changes', () => {
    const root = floorNode(nodeMesh('floor', new MeshStandardMaterial()));
    const binding = bind(root);
    binding.writeMarker(true, null);
    const marker = root.userData.iwsdkDomeFade;
    expect(marker).toEqual({
      active: true,
      end: 10,
      inactiveReason: null,
      meshCount: 1,
      skippedMaterials: 0,
      start: 4,
    });
    binding.writeMarker(true, null);
    expect(root.userData.iwsdkDomeFade).toBe(marker);
    binding.writeMarker(false, 'no-dome-gradient');
    expect(root.userData.iwsdkDomeFade).toMatchObject({
      active: false,
      inactiveReason: 'no-dome-gradient',
    });
  });

  it('restores sources and disposes only its clones', () => {
    const source = new MeshStandardMaterial();
    const mesh = nodeMesh('floor', source);
    const root = floorNode(mesh);
    const binding = bind(root);
    binding.writeMarker(true, null);
    const clone = mesh.material as Material;
    const disposed: Material[] = [];
    source.addEventListener('dispose', () => disposed.push(source));
    clone.addEventListener('dispose', () => disposed.push(clone));

    binding.dispose();
    expect(mesh.material).toBe(source);
    expect(disposed).toEqual([clone]);
    expect(root.userData.iwsdkDomeFade).toBeUndefined();
    expect(() => binding.refresh()).toThrow(/disposed/);
    binding.dispose();
  });

  it('parses serialized component payloads', () => {
    expect(
      domeFadeSpecFromComponentValue('com.iwsdk.components.DomeFade', {
        start: 2,
      }),
    ).toEqual({ end: 10, start: 2 });
    expect(domeFadeSpecFromComponentValue('DomeFade', null)).toEqual({
      end: 10,
      start: 4,
    });
    expect(
      domeFadeSpecFromComponentValue('com.iwsdk.components.PointLight', {}),
    ).toBeUndefined();
  });
});
