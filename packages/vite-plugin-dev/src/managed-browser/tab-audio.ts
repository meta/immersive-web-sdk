/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { BrowserContext, Frame, Page } from 'playwright';

// Chromium's app-mode window hides the tab mute control, and the DevTools
// Protocol has no tab-mute command. The managed browser therefore mutes each
// frame itself: Web Audio output passes through a hidden gain per context, and
// media elements are force-muted while page code still reads its own `muted`.

/** Page-callable binding the workspace UI uses to change the host state. */
export const TAB_AUDIO_BINDING = '__IWSDK_SET_TAB_AUDIO_MUTED';
/** Window event dispatched in every frame whose mute state changes. */
export const TAB_AUDIO_CHANGE_EVENT = 'iwsdk:tab-audio-change';
// Lets a reloaded same-origin document start in the current state before the
// host's framenavigated push reaches it. Written only once the state changes.
const TAB_AUDIO_STORAGE_KEY = 'iwsdk:managed-tab-audio-muted';
// A frame blocked in a dialog or long task must not hold the command past its
// budget. A late evaluation still runs in order, so the frame converges.
const FRAME_APPLY_TIMEOUT_MS = 2_000;
// Started media elements are remembered so detached players can be muted;
// paused ones are pruned once the set grows past this size.
const STARTED_MEDIA_PRUNE_SIZE = 64;

interface TabAudioInitOptions {
  eventName: string;
  initialMuted: boolean;
  pruneSize: number;
  storageKey: string;
}

export interface ManagedTabAudioOptions {
  muted: boolean;
  /** Invoked whenever an agent or the workspace UI changes the state. */
  onMutedChange?: (muted: boolean) => void;
}

export interface TabAudioController {
  readonly muted: boolean;
  apply(muted: boolean): boolean;
}

type AudioNodeMethod = (this: AudioNode, ...args: unknown[]) => unknown;

// Playwright serializes this function into every frame before page scripts
// run, so it must not reference anything outside its own body.
function installTabAudioController({
  eventName,
  initialMuted,
  pruneSize,
  storageKey,
}: TabAudioInitOptions): void {
  if (Object.prototype.hasOwnProperty.call(window, '__IWSDK_TAB_AUDIO')) {
    return;
  }
  let muted = initialMuted;
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    muted = stored == null ? initialMuted : stored === '1';
  } catch {
    // Opaque-origin and sandboxed frames have no storage; the host pushes.
  }

  const NativeAudioContext = window.AudioContext;
  const nodeProto = AudioNode.prototype;
  const nativeConnect = nodeProto.connect as AudioNodeMethod;
  const nativeDisconnect = nodeProto.disconnect as AudioNodeMethod;
  const nativeCreateGain = BaseAudioContext.prototype.createGain;
  // The weak lookup still finds a closed context's gain for disconnect();
  // only open contexts are retained for state changes.
  const masters = new WeakMap<AudioContext, GainNode>();
  const openContexts = new Set<AudioContext>();
  const forEachOpenMaster = (callback: (master: GainNode) => void): void => {
    openContexts.forEach((context) => {
      if (context.state === 'closed') {
        openContexts.delete(context);
      } else {
        callback(masters.get(context)!);
      }
    });
  };
  const masterFor = (destination: AudioDestinationNode): GainNode | null => {
    const context = destination.context;
    // OfflineAudioContext renders into a buffer, not to the speakers.
    if (!(context instanceof NativeAudioContext)) {
      return null;
    }
    let master = masters.get(context);
    if (master == null) {
      forEachOpenMaster(() => {});
      master = nativeCreateGain.call(context);
      master.channelInterpretation = destination.channelInterpretation;
      master.gain.value = muted ? 0 : 1;
      nativeConnect.call(master, destination);
      masters.set(context, master);
      openContexts.add(context);
    }
    return master;
  };
  nodeProto.connect = function connect(
    this: AudioNode,
    destination: unknown,
    ...rest: unknown[]
  ) {
    const master =
      destination instanceof AudioDestinationNode
        ? masterFor(destination)
        : null;
    if (master == null) {
      return nativeConnect.call(this, destination, ...rest);
    }
    nativeConnect.call(this, master, ...rest);
    return destination;
  } as AudioNode['connect'];
  nodeProto.disconnect = function disconnect(
    this: AudioNode,
    ...args: unknown[]
  ) {
    const [destination, ...rest] = args;
    const master =
      destination instanceof AudioDestinationNode
        ? masters.get(destination.context as AudioContext)
        : undefined;
    return master == null
      ? nativeDisconnect.apply(this, args)
      : nativeDisconnect.call(this, master, ...rest);
  } as AudioNode['disconnect'];

  const mediaProto = HTMLMediaElement.prototype;
  const mutedDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'muted')!;
  const nativeGetMuted = mutedDescriptor.get!;
  const nativeSetMuted = mutedDescriptor.set!;
  const nativePlay = mediaProto.play;
  // The `muted` value page code expects while the tab mute overrides it.
  const pageMuted = new WeakMap<HTMLMediaElement, boolean>();
  // Elements routed into Web Audio are silenced by the hidden gain instead;
  // muting the element would also starve analysers fed from it.
  const routed = new WeakSet<HTMLMediaElement>();
  const started = new Set<HTMLMediaElement>();
  const syncElement = (element: HTMLMediaElement): void => {
    if (muted && !routed.has(element)) {
      if (!pageMuted.has(element)) {
        pageMuted.set(element, nativeGetMuted.call(element));
      }
      nativeSetMuted.call(element, true);
    } else if (pageMuted.has(element)) {
      // Elements outside the DOM and the started set are released lazily
      // here, the next time they play.
      nativeSetMuted.call(element, pageMuted.get(element));
      pageMuted.delete(element);
    }
  };
  const trackStarted = (element: HTMLMediaElement): void => {
    syncElement(element);
    started.add(element);
    if (started.size > pruneSize) {
      started.forEach((candidate) => {
        if (candidate !== element && candidate.paused) {
          started.delete(candidate);
        }
      });
    }
  };
  const routeElement = (element: HTMLMediaElement): void => {
    routed.add(element);
    syncElement(element);
  };
  Object.defineProperty(mediaProto, 'muted', {
    ...mutedDescriptor,
    get(this: HTMLMediaElement) {
      return pageMuted.has(this)
        ? pageMuted.get(this)
        : nativeGetMuted.call(this);
    },
    set(this: HTMLMediaElement, value: unknown) {
      if (muted && !routed.has(this)) {
        pageMuted.set(this, Boolean(value));
        nativeSetMuted.call(this, true);
      } else {
        pageMuted.delete(this);
        nativeSetMuted.call(this, value);
      }
    },
  });
  mediaProto.play = function play(this: HTMLMediaElement) {
    trackStarted(this);
    return nativePlay.call(this);
  };
  const nativeCreateMediaElementSource =
    NativeAudioContext.prototype.createMediaElementSource;
  NativeAudioContext.prototype.createMediaElementSource =
    function createMediaElementSource(
      this: AudioContext,
      element: HTMLMediaElement,
    ) {
      const source = nativeCreateMediaElementSource.call(this, element);
      routeElement(element);
      return source;
    };
  const NativeMediaElementSource = window.MediaElementAudioSourceNode;
  const MediaElementSource = new Proxy(NativeMediaElementSource, {
    construct(target, args, newTarget) {
      const source = Reflect.construct(target, args, newTarget);
      routeElement(source.mediaElement);
      return source;
    },
  });
  // Keep `node.constructor === MediaElementAudioSourceNode` true, and route
  // `new node.constructor(...)` through the hook as well.
  Object.defineProperty(NativeMediaElementSource.prototype, 'constructor', {
    ...Object.getOwnPropertyDescriptor(
      NativeMediaElementSource.prototype,
      'constructor',
    ),
    value: MediaElementSource,
  });
  window.MediaElementAudioSourceNode = MediaElementSource;
  // Autoplay and native controls start playback without calling play(), and
  // native controls can unmute an element directly.
  const onPlay = (event: Event): void => {
    if (event.target instanceof HTMLMediaElement) {
      trackStarted(event.target);
    }
  };
  const onVolumeChange = (event: Event): void => {
    const element = event.target;
    if (
      muted &&
      element instanceof HTMLMediaElement &&
      !routed.has(element) &&
      nativeGetMuted.call(element) === false
    ) {
      pageMuted.set(element, false);
      nativeSetMuted.call(element, true);
    }
  };
  // Media events do not cross shadow boundaries, so watch each shadow root.
  const watchMediaEvents = (target: EventTarget): void => {
    target.addEventListener('play', onPlay, true);
    target.addEventListener('volumechange', onVolumeChange, true);
  };
  watchMediaEvents(window);
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadow(
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = nativeAttachShadow.call(this, init);
    watchMediaEvents(root);
    return root;
  };

  const apply = (next: boolean): boolean => {
    if (next === muted) {
      return muted;
    }
    muted = next;
    try {
      window.sessionStorage.setItem(storageKey, muted ? '1' : '0');
    } catch {
      // See the read above.
    }
    forEachOpenMaster((master) => {
      master.gain.value = muted ? 0 : 1;
    });
    document
      .querySelectorAll<HTMLMediaElement>('audio, video')
      .forEach(syncElement);
    started.forEach(syncElement);
    window.dispatchEvent(new CustomEvent(eventName, { detail: { muted } }));
    return muted;
  };
  const controller: TabAudioController = {
    get muted() {
      return muted;
    },
    apply: (next) => apply(next === true),
  };
  Object.defineProperty(window, '__IWSDK_TAB_AUDIO', {
    value: Object.freeze(controller),
  });
}

/** Owns the managed browser's mute state and applies it to every frame. */
export class ManagedTabAudio {
  private applyQueue: Promise<unknown> = Promise.resolve();
  private muted: boolean;
  private readonly onMutedChange?: (muted: boolean) => void;

  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    options: ManagedTabAudioOptions,
  ) {
    this.muted = options.muted;
    this.onMutedChange = options.onMutedChange;
  }

  /** Install the frame controller and UI binding before the first navigation. */
  static async install(
    context: BrowserContext,
    page: Page,
    options: ManagedTabAudioOptions,
  ): Promise<ManagedTabAudio> {
    const tabAudio = new ManagedTabAudio(context, page, options);
    await context.addInitScript(installTabAudioController, {
      eventName: TAB_AUDIO_CHANGE_EVENT,
      initialMuted: options.muted,
      pruneSize: STARTED_MEDIA_PRUNE_SIZE,
      storageKey: TAB_AUDIO_STORAGE_KEY,
    } satisfies TabAudioInitOptions);
    await context.exposeBinding(TAB_AUDIO_BINDING, ({ frame }, muted) => {
      if (frame !== page.mainFrame()) {
        throw new Error('Only the managed page can change tab audio.');
      }
      return tabAudio.setMuted(muted);
    });
    // Covers frames that commit after a change in any page of the managed
    // browser, including cross-origin frames that cannot read the stored state.
    const pushOnNavigation = (target: Page) => {
      target.on('framenavigated', (frame) => {
        void applyToFrame(frame, tabAudio.muted);
      });
    };
    context.pages().forEach(pushOnNavigation);
    context.on('page', pushOnNavigation);
    return tabAudio;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: unknown): Promise<boolean> {
    if (typeof muted !== 'boolean') {
      return Promise.reject(new TypeError('muted must be a boolean.'));
    }
    if (this.page.isClosed()) {
      return Promise.reject(new Error('The managed browser page is closed.'));
    }
    if (muted !== this.muted) {
      this.muted = muted;
      this.onMutedChange?.(muted);
    }
    // Queue fan-outs so overlapping requests reach each frame in call order.
    const operation = this.applyQueue.then(async () => {
      const frames = this.context.pages().flatMap((page) => page.frames());
      await Promise.all(frames.map((frame) => applyToFrame(frame, muted)));
      return muted;
    });
    this.applyQueue = operation.catch(() => {});
    return operation;
  }
}

async function applyToFrame(frame: Frame, muted: boolean): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      frame
        .evaluate((value) => {
          (window as any).__IWSDK_TAB_AUDIO?.apply(value);
        }, muted)
        // Detached and navigating frames pick the state up on their next
        // commit from storage or the framenavigated push.
        .catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FRAME_APPLY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
