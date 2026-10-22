/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MCPWebSocketClient,
  connectFrameworkTargetResolver,
  initMCPBridge,
  initMCPClient,
} from '../src/mcp/ws-client.js';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static autoOpen = true;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private sentMessages: string[] = [];

  constructor(public url: string) {
    // Simulate async connection
    if (MockWebSocket.autoOpen) {
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) {
          this.onopen(new Event('open'));
        }
      }, 0);
    }
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Test helpers
  getSentMessages(): string[] {
    return this.sentMessages;
  }

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent('message', { data: JSON.stringify(data) }),
      );
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  simulateClose(reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { reason }));
    }
  }
}

// Mock XRDevice with remote.dispatch
function createMockDevice() {
  return {
    remote: {
      dispatch: vi.fn().mockResolvedValue({ success: true }),
    },
  };
}

// Helper to flush all pending promises
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

function getParsedSentMessages(
  instance: MockWebSocket,
): Record<string, unknown>[] {
  return instance.getSentMessages().map((message) => JSON.parse(message));
}

function getRuntimeResponses(
  instance: MockWebSocket,
): Record<string, unknown>[] {
  return getParsedSentMessages(instance).filter(
    (message) => message.type !== 'iwsdk_browser_hello',
  );
}

describe('MCPWebSocketClient', () => {
  let client: MCPWebSocketClient | null = null;
  let mockDevice: ReturnType<typeof createMockDevice>;
  let mockWebSocketInstance: MockWebSocket | null = null;
  let originalWebSocket: typeof WebSocket | undefined;
  let originalWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    mockDevice = createMockDevice();
    mockWebSocketInstance = null;
    MockWebSocket.autoOpen = true;

    // Mock WebSocket globally with static properties
    originalWebSocket = globalThis.WebSocket;
    const MockWebSocketClass = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWebSocketInstance = this;
      }
    };
    // Copy static properties
    (MockWebSocketClass as any).CONNECTING = 0;
    (MockWebSocketClass as any).OPEN = 1;
    (MockWebSocketClass as any).CLOSING = 2;
    (MockWebSocketClass as any).CLOSED = 3;
    (globalThis as any).WebSocket = MockWebSocketClass;

    // Mock window for browser-like environment
    originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      history: { state: { test: true }, replaceState: vi.fn() },
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        pathname: '/',
        port: '5173',
        href: 'http://localhost:5173/?__iwsdk_headset=test#view',
        replace: vi.fn(),
        reload: vi.fn(),
      },
    };
  });

  afterEach(() => {
    // Clean up client to prevent timer/console leaks
    if (client) {
      client.disconnect();
      client = null;
    }
    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket;
    }
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    test('should create client with device', () => {
      client = new MCPWebSocketClient(mockDevice as any);
      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    test('reports the actual bridge connection state', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      expect(client.connected).toBe(false);
      expect(client.connectionState).toBe('disconnected');

      client.connect();
      expect(client.connected).toBe(false);
      expect(client.connectionState).toBe('connecting');

      await vi.waitFor(() => {
        expect(client?.connected).toBe(true);
      });
      expect(client.connectionState).toBe('connected');

      client.disconnect();
      expect(client.connected).toBe(false);
      expect(client.connectionState).toBe('disconnected');
      client = null;
    });

    test('should connect to WebSocket with correct URL', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);

      expect(mockWebSocketInstance!.url).toBe('ws://localhost:5173/__iwer_mcp');
    });

    test('should use wss protocol for https pages', async () => {
      (globalThis as any).window.location = {
        protocol: 'https:',
        hostname: 'localhost',
        pathname: '/',
        port: '5173',
      };

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);

      expect(mockWebSocketInstance!.url).toBe(
        'wss://localhost:5173/__iwer_mcp',
      );
    });

    test('should use custom port when specified', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect(3000);

      await vi.waitFor(() => mockWebSocketInstance !== null);

      expect(mockWebSocketInstance!.url).toBe('ws://localhost:3000/__iwer_mcp');
    });

    test('should default to 5173 when no port in location', async () => {
      (globalThis as any).window.location = {
        protocol: 'http:',
        hostname: 'localhost',
        pathname: '/',
        port: '',
      };

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);

      expect(mockWebSocketInstance!.url).toBe('ws://localhost:5173/__iwer_mcp');
    });

    test('should not create duplicate connections', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      const firstInstance = mockWebSocketInstance;

      // Second connect should be a no-op
      client.connect();

      expect(mockWebSocketInstance).toBe(firstInstance);
    });

    test('retries when a WebSocket remains stuck connecting', async () => {
      vi.useFakeTimers();
      MockWebSocket.autoOpen = false;
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();
      const firstInstance = mockWebSocketInstance;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(firstInstance?.readyState).toBe(MockWebSocket.CLOSED);
      expect(client.connectionState).toBe('disconnected');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockWebSocketInstance).not.toBe(firstInstance);
      expect(client.connectionState).toBe('connecting');
    });

    test('ignores close callbacks from an obsolete WebSocket', async () => {
      vi.useFakeTimers();
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();
      await vi.advanceTimersByTimeAsync(0);
      const firstInstance = mockWebSocketInstance!;
      const staleClose = firstInstance.onclose!;

      firstInstance.simulateClose('restart');
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1);
      const replacement = mockWebSocketInstance!;
      expect(replacement).not.toBe(firstInstance);
      expect(client.connected).toBe(true);

      staleClose(new CloseEvent('close', { reason: 'stale' }));

      expect(client.connected).toBe(true);
      expect(mockWebSocketInstance).toBe(replacement);
    });

    test('sends a browser hello message after opening', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      const messages = getParsedSentMessages(mockWebSocketInstance!);
      expect(messages[0]).toMatchObject({
        type: 'iwsdk_browser_hello',
        commandReady: false,
        deviceClass: 'managed',
        pageId: client.tabId,
        pageRole: 'app',
        role: 'app',
        tabId: client.tabId,
        tabGeneration: client.tabGeneration,
      });
    });

    test('identifies a physical XR client in the browser hello', async () => {
      client = new MCPWebSocketClient(mockDevice as any, {
        deviceClass: 'physical',
      });
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      expect(getParsedSentMessages(mockWebSocketInstance!)[0]).toMatchObject({
        type: 'iwsdk_browser_hello',
        deviceClass: 'physical',
        pageRole: 'app',
      });
    });

    test('reports an already-installed framework runtime in the browser hello', async () => {
      (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = {};

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      expect(getParsedSentMessages(mockWebSocketInstance!)[0]).toMatchObject({
        type: 'iwsdk_browser_hello',
        commandReady: true,
      });
    });

    test('announces readiness when the framework runtime becomes available after connecting', async () => {
      let runtimeReadyListener: (() => void) | undefined;
      (globalThis as any).window.addEventListener = vi.fn(
        (type: string, listener: () => void) => {
          if (type === 'iwsdk:mcp-runtime-ready') {
            runtimeReadyListener = listener;
          }
        },
      );

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      expect(runtimeReadyListener).toBeDefined();
      runtimeReadyListener!();

      expect(getParsedSentMessages(mockWebSocketInstance!)).toContainEqual(
        expect.objectContaining({
          type: 'iwsdk_browser_ready',
          pageId: client.tabId,
          pageRole: 'app',
          tabGeneration: client.tabGeneration,
        }),
      );
    });

    test('sends editor page role metadata for workspace route pages', async () => {
      (globalThis as any).window.location.pathname = '/__iwsdk/workspace';
      (globalThis as any).window.__IWSDK_SCENE_SESSION_ID = 'scene-test';

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      const messages = getParsedSentMessages(mockWebSocketInstance!);
      expect(messages[0]).toMatchObject({
        type: 'iwsdk_browser_hello',
        pageId: client.tabId,
        pageRole: 'editor',
        role: 'editor',
        sceneSessionId: 'scene-test',
        tabId: client.tabId,
        tabGeneration: client.tabGeneration,
      });
    });
  });

  describe('disconnect', () => {
    test('should close WebSocket on disconnect', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      client.disconnect();
      client = null; // Already disconnected

      expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.CLOSED);
    });

    test('should not reconnect after intentional disconnect', async () => {
      vi.useFakeTimers();

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.advanceTimersByTimeAsync(0);

      const firstInstance = mockWebSocketInstance;
      client.disconnect();
      client = null; // Already disconnected

      // Advance well past any reconnect delay
      await vi.advanceTimersByTimeAsync(10000);

      // No new WebSocket should have been created
      expect(mockWebSocketInstance).toBe(firstInstance);
    });

    test('should cancel pending reconnect timer on disconnect', async () => {
      vi.useFakeTimers();

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.advanceTimersByTimeAsync(0);

      const firstInstance = mockWebSocketInstance;

      // Trigger reconnect by simulating close (uses onclose directly to
      // mimic server-side disconnect before our intentional disconnect)
      firstInstance!.simulateClose();

      // Now disconnect before the reconnect timer fires
      client.disconnect();
      client = null;

      // Advance past the reconnect delay
      await vi.advanceTimersByTimeAsync(5000);

      // No new WebSocket should have been created
      expect(mockWebSocketInstance).toBe(firstInstance);
    });
  });

  describe('message handling', () => {
    test('waits for framework XR teardown before acknowledging and navigating', async () => {
      vi.useFakeTimers();
      let endSession!: () => void;
      (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = {
        prepareForReload: () =>
          new Promise<void>((resolve) => {
            endSession = resolve;
          }),
      };
      client = initMCPBridge({ deviceClass: 'physical' });
      await vi.advanceTimersByTimeAsync(0);
      mockWebSocketInstance!.simulateMessage({
        id: 'reload',
        method: 'reload_page',
        params: {},
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(getRuntimeResponses(mockWebSocketInstance!)).toHaveLength(0);
      expect(window.location.replace).not.toHaveBeenCalled();
      endSession();
      await vi.advanceTimersByTimeAsync(0);
      expect(getRuntimeResponses(mockWebSocketInstance!)[0]).toMatchObject({
        id: 'reload',
        result: { success: true },
      });
      expect(window.location.replace).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(window.location.replace).toHaveBeenCalledTimes(1);
      const destination = new URL(
        vi.mocked(window.location.replace).mock.calls[0][0],
      );
      expect(destination.searchParams.get('__iwsdk_reload')).toBeTruthy();
      destination.searchParams.delete('__iwsdk_reload');
      expect(destination.href).toBe(
        'http://localhost:5173/?__iwsdk_headset=test#view',
      );
      expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('bootstrap removes only the private reload query and preserves history state', () => {
      window.location.href =
        'http://localhost:5173/?__iwsdk_headset=test&__iwsdk_reload=nonce#view';
      client = new MCPWebSocketClient(mockDevice as any);
      expect(window.history.replaceState).toHaveBeenCalledExactlyOnceWith(
        { test: true },
        '',
        'http://localhost:5173/?__iwsdk_headset=test#view',
      );
    });

    test.each([
      '',
      '?',
      '#',
      '?#',
      '?__iwsdk_headset=t&q=a%20b&debug#/r?x=1',
      '?path=/levels/2&tags=a,b#view',
      '?cfg={%22a%22:1}&',
      '?debug#route&__iwsdk_reload=app-fragment',
      '?value=?__iwsdk_reload=app-value',
      'level&__iwsdk_reload=path-value',
    ])('reload round-trips the exact raw URL: %s', async (suffix) => {
      vi.useFakeTimers();
      const original = `http://localhost:5173/${suffix}`;
      window.location.href = original;
      client = initMCPBridge({ deviceClass: 'physical' });
      await vi.advanceTimersByTimeAsync(0);
      mockWebSocketInstance!.simulateMessage({
        id: 'reload',
        method: 'reload_page',
        params: {},
      });
      await vi.advanceTimersByTimeAsync(50);
      const destination = vi.mocked(window.location.replace).mock.calls[0][0];
      expect(new URL(destination).search).not.toBe(new URL(original).search);
      client.disconnect();
      window.location.href = destination;
      client = new MCPWebSocketClient(mockDevice as any);
      expect(window.history.replaceState).toHaveBeenCalledExactlyOnceWith(
        { test: true },
        '',
        original,
      );
    });

    test('reports failed XR teardown without starting navigation', async () => {
      vi.useFakeTimers();
      (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = {
        prepareForReload: () => Promise.reject(new Error('XR teardown failed')),
      };
      client = initMCPBridge({ deviceClass: 'physical' });
      await vi.advanceTimersByTimeAsync(0);
      mockWebSocketInstance!.simulateMessage({
        id: 'reload',
        method: 'reload_page',
        params: {},
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(getRuntimeResponses(mockWebSocketInstance!)[0]).toMatchObject({
        id: 'reload',
        error: { message: 'XR teardown failed' },
      });
      expect(window.location.replace).not.toHaveBeenCalled();
    });

    test('responds before reloading a relayed physical page', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();
      await vi.waitFor(() => {
        expect(mockWebSocketInstance?.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: 'reload',
        method: 'reload_page',
        params: {},
      });

      await vi.waitFor(() => {
        expect(getRuntimeResponses(mockWebSocketInstance!)).toHaveLength(1);
      });
      expect(getRuntimeResponses(mockWebSocketInstance!)[0]).toMatchObject({
        id: 'reload',
        result: { success: true, message: 'Page reload initiated' },
      });
      await vi.waitFor(() => {
        expect((globalThis as any).window.location.replace).toHaveBeenCalled();
      });
      expect(mockDevice.remote.dispatch).not.toHaveBeenCalled();
    });

    test('should dispatch IWER methods to device.remote.dispatch', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      // Simulate incoming MCP request
      mockWebSocketInstance!.simulateMessage({
        id: '1',
        method: 'get_transform',
        params: { device: 'headset' },
      });

      await vi.waitFor(() => mockDevice.remote.dispatch.mock.calls.length > 0);

      expect(mockDevice.remote.dispatch).toHaveBeenCalledWith('get_transform', {
        device: 'headset',
      });
    });

    test('should route get_console_logs to device.remote.dispatch (server-side handles it)', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      // Simulate incoming console logs request
      mockWebSocketInstance!.simulateMessage({
        id: '2',
        method: 'get_console_logs',
        params: { count: 10 },
      });

      // Now falls through to device.remote.dispatch since browser-side handling was removed
      await vi.waitFor(() => mockDevice.remote.dispatch.mock.calls.length > 0);
      expect(mockDevice.remote.dispatch).toHaveBeenCalledWith(
        'get_console_logs',
        { count: 10 },
      );
    });

    test('should route to FRAMEWORK_MCP_RUNTIME when available and handles method', async () => {
      const mockFrameworkRuntime = {
        handles: vi.fn().mockReturnValue(true),
        dispatch: vi.fn().mockResolvedValue({ scene: 'hierarchy' }),
      };
      (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = mockFrameworkRuntime;

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: '5',
        method: 'get_scene_hierarchy',
        params: { maxDepth: 3 },
      });

      await vi.waitFor(
        () => mockFrameworkRuntime.handles.mock.calls.length > 0,
      );

      expect(mockFrameworkRuntime.handles).toHaveBeenCalledWith(
        'get_scene_hierarchy',
      );
      expect(mockFrameworkRuntime.dispatch).toHaveBeenCalledWith(
        'get_scene_hierarchy',
        { maxDepth: 3 },
      );
      expect(mockDevice.remote.dispatch).not.toHaveBeenCalled();

      delete (globalThis as any).window.FRAMEWORK_MCP_RUNTIME;
    });

    test('routes framework methods without an IWER device and rejects XR methods clearly', async () => {
      const mockFrameworkRuntime = {
        handles: vi.fn((method: string) => method === 'workspace_get_state'),
        dispatch: vi.fn().mockResolvedValue({ view: 'editor' }),
      };
      (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = mockFrameworkRuntime;

      client = new MCPWebSocketClient(null);
      client.connect();
      await vi.waitFor(() => {
        expect(mockWebSocketInstance?.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: 'workspace-bridge',
        method: 'workspace_get_state',
        params: {},
      });
      await vi.waitFor(
        () => mockFrameworkRuntime.dispatch.mock.calls.length > 0,
      );
      expect(mockFrameworkRuntime.dispatch).toHaveBeenCalledWith(
        'workspace_get_state',
        {},
      );

      await expect(
        (client as any).dispatch('get_transform', { device: 'headset' }),
      ).rejects.toThrow(
        'requires IWER device emulation and is unavailable in this workspace-only page',
      );

      delete (globalThis as any).window.FRAMEWORK_MCP_RUNTIME;
    });

    test('should fall back to device.remote.dispatch when FRAMEWORK_MCP_RUNTIME does not handle method', async () => {
      const mockFrameworkRuntime = {
        handles: vi.fn().mockReturnValue(false),
        dispatch: vi.fn(),
      };
      (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = mockFrameworkRuntime;

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: '6',
        method: 'get_transform',
        params: { device: 'headset' },
      });

      await vi.waitFor(
        () => mockFrameworkRuntime.handles.mock.calls.length > 0,
      );

      expect(mockFrameworkRuntime.handles).toHaveBeenCalledWith(
        'get_transform',
      );
      expect(mockFrameworkRuntime.dispatch).not.toHaveBeenCalled();
      expect(mockDevice.remote.dispatch).toHaveBeenCalledWith('get_transform', {
        device: 'headset',
      });

      delete (globalThis as any).window.FRAMEWORK_MCP_RUNTIME;
    });

    test('should send response back via WebSocket', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: '3',
        method: 'get_transform',
        params: { device: 'headset' },
      });

      // Wait for async message handling to complete and response to be sent
      await vi.waitFor(() => {
        expect(
          getRuntimeResponses(mockWebSocketInstance!).length,
        ).toBeGreaterThan(0);
      });

      const response = getRuntimeResponses(mockWebSocketInstance!)[0];
      expect(response.id).toBe('3');
      expect(response.result).toBeDefined();
    });

    test('should send error response when dispatch fails', async () => {
      mockDevice.remote.dispatch.mockRejectedValueOnce(new Error('Test error'));

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: '4',
        method: 'some_method',
        params: {},
      });

      // Wait for async message handling to complete and response to be sent
      await vi.waitFor(() => {
        expect(
          getRuntimeResponses(mockWebSocketInstance!).length,
        ).toBeGreaterThan(0);
      });

      const response = getRuntimeResponses(mockWebSocketInstance!)[0];
      expect(response.id).toBe('4');
      expect(response.error).toBeDefined();
      expect(response.error.message).toBe('Test error');
    });

    test('preserves structured framework error details in the WebSocket response', async () => {
      const structuredError = Object.assign(new Error('Scene is invalid'), {
        code: 'invalid_scene',
        details: { documentHash: 'sha256:stale' },
        issues: [{ code: 'below-floor', nodeId: 'chair' }],
        lifecycle: { schemaValid: 'failed' },
        recoverable: true,
        retryAction: 'scene_validate',
      });
      const mockFrameworkRuntime = {
        handles: vi.fn().mockReturnValue(true),
        dispatch: vi.fn().mockRejectedValue(structuredError),
      };
      (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = mockFrameworkRuntime;
      client = new MCPWebSocketClient(null);
      client.connect();
      await vi.waitFor(() => {
        expect(mockWebSocketInstance?.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: 'structured-error',
        method: 'scene_validate',
        params: {},
      });
      await vi.waitFor(() => {
        expect(getRuntimeResponses(mockWebSocketInstance!)).toHaveLength(1);
      });

      expect(getRuntimeResponses(mockWebSocketInstance!)[0]).toMatchObject({
        error: {
          code: -32000,
          data: {
            code: 'invalid_scene',
            details: { documentHash: 'sha256:stale' },
            issues: [{ code: 'below-floor', nodeId: 'chair' }],
            lifecycle: { schemaValid: 'failed' },
            recoverable: true,
            retryAction: 'scene_validate',
          },
          message: 'Scene is invalid',
        },
        id: 'structured-error',
      });
      delete (globalThis as any).window.FRAMEWORK_MCP_RUNTIME;
    });

    test('should ignore invalid JSON messages', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      // Send invalid JSON directly (not through simulateMessage which stringifies)
      if (mockWebSocketInstance!.onmessage) {
        mockWebSocketInstance!.onmessage(
          new MessageEvent('message', { data: 'invalid json{' }),
        );
      }

      // Should not crash, no response sent
      expect(getRuntimeResponses(mockWebSocketInstance!)).toHaveLength(0);
    });

    test('should ignore malformed requests without id or method', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      // Send valid JSON but missing required fields
      if (mockWebSocketInstance!.onmessage) {
        mockWebSocketInstance!.onmessage(
          new MessageEvent('message', { data: '{"foo": "bar"}' }),
        );
      }

      await flushPromises();
      expect(getRuntimeResponses(mockWebSocketInstance!)).toHaveLength(0);
      expect(mockDevice.remote.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    test('should attempt to reconnect on close', async () => {
      vi.useFakeTimers();

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.advanceTimersByTimeAsync(0); // Let connection complete

      const firstInstance = mockWebSocketInstance;
      firstInstance!.simulateClose('test close');

      // Advance past reconnect delay
      await vi.advanceTimersByTimeAsync(1000);

      // Should have created a new WebSocket
      expect(mockWebSocketInstance).not.toBe(firstInstance);
    });

    test('should stop reconnecting after max attempts', async () => {
      vi.useFakeTimers();

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.advanceTimersByTimeAsync(0);

      // Simulate 5 failed reconnections
      for (let i = 0; i < 6; i++) {
        mockWebSocketInstance!.simulateClose();
        await vi.advanceTimersByTimeAsync(5000); // Reconnect delays increase
      }

      const lastInstance = mockWebSocketInstance;

      // After max attempts, no more reconnection
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockWebSocketInstance).toBe(lastInstance);
    });

    test('should reset reconnect attempts on successful connection', async () => {
      vi.useFakeTimers();

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.advanceTimersByTimeAsync(0);

      // Simulate close
      mockWebSocketInstance!.simulateClose();

      // Advance past first reconnect delay
      await vi.advanceTimersByTimeAsync(1500);

      // A new connection should have been attempted
      const secondInstance = mockWebSocketInstance;
      expect(secondInstance).toBeDefined();

      // Wait for connection to complete
      await vi.advanceTimersByTimeAsync(0);

      // Verify the reconnect attempt happened by checking we have a new instance URL
      expect(secondInstance!.url).toContain('/__iwer_mcp');
    });

    test('disconnect() resets the reconnect budget so a later connect can recover', () => {
      const c = new MCPWebSocketClient(mockDevice as any);
      client = c;

      // Simulate a client that used up all of its reconnect attempts during a
      // run of failed reconnections (onopen never fired to reset the counter).
      (c as any).reconnectAttempts = (c as any).maxReconnectAttempts;
      expect((c as any).reconnectAttempts).toBeGreaterThan(0);

      c.disconnect();

      // Regression: pre-fix this stayed pinned at the cap, so a later
      // connect()/close() could never schedule another reconnect
      // (scheduleReconnect early-returns once reconnectAttempts >= max).
      expect((c as any).reconnectAttempts).toBe(0);
    });
  });

  describe('tab identity', () => {
    let originalSessionStorage: typeof globalThis.sessionStorage | undefined;
    let store: Record<string, string>;

    beforeEach(() => {
      store = {};
      originalSessionStorage = (globalThis as any).sessionStorage;
      (globalThis as any).sessionStorage = {
        getItem: vi.fn((k: string) => store[k] ?? null),
        setItem: vi.fn((k: string, v: string) => {
          store[k] = v;
        }),
      };
    });

    afterEach(() => {
      if (originalSessionStorage !== undefined) {
        (globalThis as any).sessionStorage = originalSessionStorage;
      } else {
        delete (globalThis as any).sessionStorage;
      }
    });

    test('tabId is read from sessionStorage when present', () => {
      store['iwer-mcp-tab-id:app'] = 'existing-tab-123';
      client = new MCPWebSocketClient(mockDevice as any);
      expect(client.tabId).toBe('existing-tab-123');
      // Should NOT overwrite the existing value
      expect(sessionStorage.setItem).not.toHaveBeenCalledWith(
        'iwer-mcp-tab-id:app',
        expect.not.stringContaining('existing-tab-123'),
      );
    });

    test('tabId is generated and stored when sessionStorage is empty', () => {
      client = new MCPWebSocketClient(mockDevice as any);
      expect(client.tabId).toMatch(/^tab-/);
      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        'iwer-mcp-tab-id:app',
        client.tabId,
      );
    });

    test('tabId is generated when sessionStorage is unavailable', () => {
      delete (globalThis as any).sessionStorage;
      client = new MCPWebSocketClient(mockDevice as any);
      // Should still get a valid tabId (fallback generation)
      expect(client.tabId).toMatch(/^tab-/);
    });

    test('tabGeneration increments from stored value', () => {
      store['iwer-mcp-gen:app'] = '3';
      client = new MCPWebSocketClient(mockDevice as any);
      expect(client.tabGeneration).toBe(4);
      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        'iwer-mcp-gen:app',
        '4',
      );
    });

    test('tabGeneration starts at 1 when no prior value', () => {
      client = new MCPWebSocketClient(mockDevice as any);
      expect(client.tabGeneration).toBe(1);
      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        'iwer-mcp-gen:app',
        '1',
      );
    });

    test('tabGeneration starts at 1 when sessionStorage unavailable', () => {
      delete (globalThis as any).sessionStorage;
      client = new MCPWebSocketClient(mockDevice as any);
      expect(client.tabGeneration).toBe(1);
    });
  });

  describe('response enrichment', () => {
    test('_tabId and _tabGeneration are present in successful outgoing responses', async () => {
      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: 'enrich-1',
        method: 'get_transform',
        params: { device: 'headset' },
      });

      await vi.waitFor(() => {
        expect(
          getRuntimeResponses(mockWebSocketInstance!).length,
        ).toBeGreaterThan(0);
      });

      const response = getRuntimeResponses(mockWebSocketInstance!)[0];
      expect(response._tabId).toBe(client.tabId);
      expect(response._tabGeneration).toBe(client.tabGeneration);
    });

    test('_tabId is present in error responses', async () => {
      mockDevice.remote.dispatch.mockRejectedValueOnce(new Error('Boom'));

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: 'enrich-err',
        method: 'fail_method',
        params: {},
      });

      await vi.waitFor(() => {
        expect(
          getRuntimeResponses(mockWebSocketInstance!).length,
        ).toBeGreaterThan(0);
      });

      const response = getRuntimeResponses(mockWebSocketInstance!)[0];
      expect(response._tabId).toBe(client.tabId);
      expect(response._tabGeneration).toBe(client.tabGeneration);
      expect(response.error).toBeDefined();
    });

    test('original id and result fields are not clobbered by enrichment', async () => {
      const originalResult = { position: { x: 1, y: 2, z: 3 } };
      mockDevice.remote.dispatch.mockResolvedValueOnce(originalResult);

      client = new MCPWebSocketClient(mockDevice as any);
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocketInstance!.simulateMessage({
        id: 'enrich-2',
        method: 'get_transform',
        params: { device: 'headset' },
      });

      await vi.waitFor(() => {
        expect(
          getRuntimeResponses(mockWebSocketInstance!).length,
        ).toBeGreaterThan(0);
      });

      const response = getRuntimeResponses(mockWebSocketInstance!)[0];
      expect(response.id).toBe('enrich-2');
      expect(response.result).toEqual(originalResult);
      // Enrichment fields co-exist
      expect(response._tabId).toBeDefined();
    });
  });

  describe('verbose mode', () => {
    test('should log connection status when verbose is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      client = new MCPWebSocketClient(mockDevice as any, {
        verbose: true,
      });
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      // Should have logged connection messages
      const iwerLogs = consoleSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('[IWSDK-MCP]'),
      );
      expect(iwerLogs.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    test('should not log when verbose is disabled', async () => {
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      const consoleDebugSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      client = new MCPWebSocketClient(mockDevice as any, {
        verbose: false,
      });
      client.connect();

      await vi.waitFor(() => mockWebSocketInstance !== null);
      await vi.waitFor(() => {
        expect(mockWebSocketInstance!.readyState).toBe(MockWebSocket.OPEN);
      });

      // No [IWSDK-MCP] logs should be present in either log or debug
      const iwerLogCalls = consoleLogSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('[IWSDK-MCP]'),
      );
      const iwerDebugCalls = consoleDebugSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('[IWSDK-MCP]'),
      );
      expect(iwerLogCalls).toHaveLength(0);
      expect(iwerDebugCalls).toHaveLength(0);

      consoleLogSpy.mockRestore();
      consoleDebugSpy.mockRestore();
    });
  });
});

describe('initMCPClient', () => {
  let mockDevice: ReturnType<typeof createMockDevice>;
  let mockWebSocketInstance: MockWebSocket | null = null;
  let originalWebSocket: typeof WebSocket | undefined;
  let originalWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    mockDevice = createMockDevice();
    mockWebSocketInstance = null;

    // Mock WebSocket globally with static properties — use subclass to capture instance
    originalWebSocket = globalThis.WebSocket;
    const MockWebSocketClass = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWebSocketInstance = this;
      }
    };
    (MockWebSocketClass as any).CONNECTING = 0;
    (MockWebSocketClass as any).OPEN = 1;
    (MockWebSocketClass as any).CLOSING = 2;
    (MockWebSocketClass as any).CLOSED = 3;
    (globalThis as any).WebSocket = MockWebSocketClass;

    // Mock window for browser-like environment
    originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        port: '5173',
      },
    };
  });

  afterEach(() => {
    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket;
    }
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
    vi.useRealTimers();
  });

  test('should create and connect client', () => {
    const client = initMCPClient(mockDevice as any);
    expect(client).toBeInstanceOf(MCPWebSocketClient);
    client.disconnect();
  });

  test('should create a device-less managed workspace bridge', () => {
    const client = initMCPBridge();
    expect(client).toBeInstanceOf(MCPWebSocketClient);
    client.disconnect();
  });

  test('should pass options to client', async () => {
    // Mock console.log to prevent verbose output in test results
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const client = initMCPClient(mockDevice as any, {
      port: 3000,
      verbose: true,
    });
    expect(client).toBeInstanceOf(MCPWebSocketClient);

    await vi.waitFor(() => mockWebSocketInstance !== null);
    expect(mockWebSocketInstance!.url).toBe('ws://localhost:3000/__iwer_mcp');

    client.disconnect();
    consoleSpy.mockRestore();
  });
});

describe('connectFrameworkTargetResolver', () => {
  let originalWindow: typeof globalThis.window | undefined;
  let readyListeners: Array<() => void>;

  beforeEach(() => {
    readyListeners = [];
    originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'iwsdk:mcp-runtime-ready') {
          readyListeners.push(listener);
        }
      }),
    };
  });

  afterEach(() => {
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  });

  test("hands IWER the framework runtime's resolver now and after every runtime start", () => {
    const first = { resolve: vi.fn(), list: vi.fn() };
    const second = { resolve: vi.fn(), list: vi.fn() };
    const device = {
      remote: { dispatch: vi.fn(), setTargetResolver: vi.fn() },
    };
    (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = {
      targetResolver: first,
    };

    connectFrameworkTargetResolver(device);
    expect(device.remote.setTargetResolver).toHaveBeenLastCalledWith(first);

    // A new world after a reload or HMR brings its own resolver.
    (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = {
      targetResolver: second,
    };
    readyListeners.forEach((listener) => listener());
    expect(device.remote.setTargetResolver).toHaveBeenLastCalledWith(second);

    // A runtime without one leaves IWER without a resolver, not a stale one.
    (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = {};
    readyListeners.forEach((listener) => listener());
    expect(device.remote.setTargetResolver).toHaveBeenLastCalledWith(null);
  });

  test('waits for the runtime when the world starts after the emulator', () => {
    const resolver = { resolve: vi.fn() };
    const device = {
      remote: { dispatch: vi.fn(), setTargetResolver: vi.fn() },
    };

    connectFrameworkTargetResolver(device);
    expect(device.remote.setTargetResolver).toHaveBeenLastCalledWith(null);

    (globalThis as any).window.FRAMEWORK_MCP_RUNTIME = {
      targetResolver: resolver,
    };
    readyListeners.forEach((listener) => listener());
    expect(device.remote.setTargetResolver).toHaveBeenLastCalledWith(resolver);
  });

  test('leaves an IWER without target resolution alone', () => {
    const device = { remote: { dispatch: vi.fn() } };
    expect(() => connectFrameworkTargetResolver(device)).not.toThrow();
    expect(readyListeners).toHaveLength(0);
  });
});
