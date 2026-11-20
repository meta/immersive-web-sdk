/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import {
  NATIVE_CONTROL_NOTICE_ID,
  NATIVE_CONTROL_NOTICE_TEXT,
  NATIVE_CONTROL_NOTICE_TITLE,
  showNativeControlNotice,
} from '../src/native-control-notice.js';

class FakeElement {
  id = '';
  textContent: string | null = null;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  style = { cssText: '' };

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  text(): string {
    return (
      (this.textContent ?? '') + this.children.map((c) => c.text()).join('')
    );
  }
}

function fakeDocument(readyState: string, hasBody = true) {
  const body = new FakeElement('body');
  const listeners: Array<() => void> = [];
  const fake = {
    readyState,
    body: hasBody ? body : null,
    getElementById: (id: string) =>
      body.children.find((c) => c.id === id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
    addEventListener: (_type: string, listener: () => void) => {
      listeners.push(listener);
    },
  };
  // The notice touches only the members above.
  const doc = fake as unknown as Document;
  const fire = () => {
    fake.body = body;
    listeners.splice(0).forEach((listener) => listener());
  };
  return { doc, body, fire };
}

describe('showNativeControlNotice', () => {
  test('adds one fixed, click-through banner that says how to get control back', () => {
    const { doc, body } = fakeDocument('complete');
    showNativeControlNotice(doc);
    showNativeControlNotice(doc);

    expect(body.children).toHaveLength(1);
    const bar = body.children[0];
    expect(bar.id).toBe(NATIVE_CONTROL_NOTICE_ID);
    expect(bar.attributes.get('role')).toBe('status');
    expect(bar.style.cssText).toContain('position:fixed');
    expect(bar.style.cssText).toContain('pointer-events:none');
    expect(bar.text()).toContain(NATIVE_CONTROL_NOTICE_TITLE);
    expect(bar.text()).toContain(NATIVE_CONTROL_NOTICE_TEXT);
    expect(NATIVE_CONTROL_NOTICE_TEXT).toContain(
      'restart the dev server without --native-xr-control',
    );
  });

  test('waits for the body when the page is still loading', () => {
    const { doc, body, fire } = fakeDocument('loading', false);
    showNativeControlNotice(doc);
    expect(body.children).toHaveLength(0);
    fire();
    expect(body.children).toHaveLength(1);
  });

  test('is shown only on the native-control path of the injected runtime', async () => {
    const source = await readFile(
      new URL('../src/injection-template.ts', import.meta.url),
      'utf8',
    );
    const calls = source.split('showNativeControlNotice(document)').length - 1;
    expect(calls).toBe(1);
    // The call sits in the branch for a full native override, not the
    // gaze-only target-device preview.
    const branch = source.slice(
      source.indexOf(
        'if (targetPreviewActive) {\n        (window as any).__IWSDK_TARGET_DEVICE_PREVIEW__',
      ),
      source.indexOf('(window as any).IWER_NATIVE_OVERRIDE = nativeOverride;'),
    );
    expect(branch).toContain('} else {');
    expect(branch).toContain('showNativeControlNotice(document)');
  });
});
