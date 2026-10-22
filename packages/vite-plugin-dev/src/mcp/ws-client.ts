/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

type MCPPageRole = 'app' | 'editor' | 'preview';
type MCPDeviceClass = 'managed' | 'physical';

/** IWER's TargetResolver: turns run_sequence target names into scene points. */
interface MCPTargetResolver {
  resolve(target: unknown, context: unknown): unknown;
  list?(): unknown[];
}

interface MCPDevice {
  remote: {
    dispatch(
      method: string,
      params: Record<string, unknown>,
    ): Promise<unknown> | unknown;
    /** Registers how hand sequences resolve target names (IWER 2.7+). */
    setTargetResolver?(resolver: MCPTargetResolver | null): void;
  };
}

/**
 * Interface that any framework can implement to provide MCP tools.
 * The vite plugin will route requests to this runtime when available.
 */
interface FrameworkMCPRuntime {
  /** Release framework-owned resources that must settle before navigation. */
  prepareForReload?(): Promise<void>;
  /**
   * Returns true if this runtime handles the given method.
   */
  handles(method: string): boolean;

  /**
   * Dispatch a method call. Returns result or throws an error.
   */
  dispatch(method: string, params: Record<string, unknown>): Promise<unknown>;

  /** Resolves the target names of emulated hand sequences in the scene. */
  targetResolver?: MCPTargetResolver;
}

declare global {
  interface Window {
    FRAMEWORK_MCP_RUNTIME?: FrameworkMCPRuntime;
    __IWSDK_MCP_TRACE?: boolean;
    __IWSDK_MCP_PAGE_ID?: string;
    __IWSDK_MCP_PAGE_ROLE?: MCPPageRole;
    __IWSDK_MCP_TAB_GENERATION?: number;
    __IWSDK_SCENE_SESSION_ID?: string;
  }
}

/**
 * MCP request message format
 */
interface MCPRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * MCP response message format
 */
interface MCPResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    cause?: string;
    data?: Record<string, unknown>;
  };
}

const STRUCTURED_ERROR_FIELDS = [
  'code',
  'details',
  'issues',
  'lifecycle',
  'recoverable',
  'retryAction',
] as const;

function serializeMCPError(error: unknown): NonNullable<MCPResponse['error']> {
  const source =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : null;
  const data: Record<string, unknown> = {};
  for (const field of STRUCTURED_ERROR_FIELDS) {
    if (source != null && source[field] !== undefined) {
      data[field] = source[field];
    }
  }
  const cause =
    source != null && typeof source.cause === 'string'
      ? source.cause
      : undefined;
  return {
    code:
      source != null &&
      typeof source.code === 'number' &&
      Number.isInteger(source.code)
        ? source.code
        : -32000,
    message: error instanceof Error ? error.message : String(error),
    ...(cause == null ? {} : { cause }),
    ...(Object.keys(data).length === 0 ? {} : { data }),
  };
}

/**
 * WebSocket client that connects the browser to the Vite dev server's MCP endpoint.
 * Routes commands to device.remote.dispatch() for IWER tools,
 * framework runtime for IWSDK tools, and handles page reload locally.
 */
export class MCPWebSocketClient {
  private ws: WebSocket | null = null;
  private device: MCPDevice | null;
  private reconnectAttempts = 0;
  // Vite may be unavailable for longer than five seconds while a project
  // manifest edit restarts and re-optimizes the server. Keep reconnecting for
  // the lifetime of the managed page instead of permanently stranding it.
  private maxReconnectAttempts = Number.POSITIVE_INFINITY;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 5000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly connectTimeoutMs = 10_000;
  private intentionalDisconnect = false;
  private verbose: boolean;
  private readonly runtimeReadyListener = () => this.announceCommandReady();

  // Tab identity: stable across reloads/HMR within the same browser tab,
  // new ID when the tab is closed and reopened.
  readonly tabId: string;
  readonly tabGeneration: number;
  readonly pageRole: MCPPageRole;
  readonly deviceClass: MCPDeviceClass;
  readonly sceneSessionId: string | undefined;

  constructor(
    device: MCPDevice | null,
    options: { deviceClass?: MCPDeviceClass; verbose?: boolean } = {},
  ) {
    this.device = device;
    this.verbose = options.verbose ?? false;
    this.pageRole = this.detectPageRole();
    this.deviceClass = options.deviceClass ?? 'managed';
    this.sceneSessionId =
      typeof window !== 'undefined'
        ? window.__IWSDK_SCENE_SESSION_ID
        : undefined;

    // sessionStorage is shared by same-origin frames. Key identity by role so
    // the editor shell and its runtime iframe cannot impersonate successive
    // generations of one page.
    const tabIdStorageKey = `iwer-mcp-tab-id:${this.pageRole}`;
    const tabGenerationStorageKey = `iwer-mcp-gen:${this.pageRole}`;
    let id =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(tabIdStorageKey)
        : null;
    if (!id) {
      id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(tabIdStorageKey, id);
      }
    }
    this.tabId = id;

    // Generation increments on every page load / HMR within the same tab
    const gen =
      typeof sessionStorage !== 'undefined'
        ? parseInt(sessionStorage.getItem(tabGenerationStorageKey) || '0', 10) +
          1
        : 1;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(tabGenerationStorageKey, String(gen));
    }
    this.tabGeneration = gen;

    if (typeof window !== 'undefined') {
      // A one-use query prevents Quest's offline MHTML cache from replacing
      // a live localhost document. Restore the app's address during bootstrap.
      try {
        const href = window.location.href;
        // Work on the raw address before its fragment so app query encoding,
        // flag parameters, and even a bare '?' survive unchanged.
        const restored = href.replace(/^[^#]*/u, (address) => {
          const queryStart = address.indexOf('?');
          if (queryStart === -1) {
            return address;
          }
          return (
            address.slice(0, queryStart) +
            address
              .slice(queryStart)
              .replace(/^\?__iwsdk_reload=[^&]*$|&__iwsdk_reload=[^&]*$/u, '')
          );
        });
        if (restored !== href) {
          window.history.replaceState(window.history.state, '', restored);
        }
      } catch {}
      window.__IWSDK_MCP_PAGE_ID = this.tabId;
      window.__IWSDK_MCP_PAGE_ROLE = this.pageRole;
      window.__IWSDK_MCP_TAB_GENERATION = this.tabGeneration;
      if (typeof window.addEventListener === 'function') {
        window.addEventListener(
          'iwsdk:mcp-runtime-ready',
          this.runtimeReadyListener,
        );
      }
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get connectionState():
    | 'connected'
    | 'connecting'
    | 'closing'
    | 'disconnected' {
    if (this.ws == null || this.ws.readyState === WebSocket.CLOSED) {
      return 'disconnected';
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      return 'connected';
    }
    if (this.ws.readyState === WebSocket.CLOSING) {
      return 'closing';
    }
    return 'connecting';
  }

  private isTraceEnabled(): boolean {
    return (
      this.verbose ||
      (typeof window !== 'undefined' && window.__IWSDK_MCP_TRACE === true)
    );
  }

  private detectPageRole(): MCPPageRole {
    if (typeof window === 'undefined') {
      return 'app';
    }

    const explicit = window.__IWSDK_MCP_PAGE_ROLE;
    if (explicit === 'app' || explicit === 'editor' || explicit === 'preview') {
      return explicit;
    }

    const pathname = window.location.pathname ?? '';
    return pathname.startsWith('/__iwsdk/editor') ||
      pathname.startsWith('/__iwsdk/workspace')
      ? 'editor'
      : 'app';
  }

  private trace(message: string, details: Record<string, unknown> = {}): void {
    if (!this.isTraceEnabled()) {
      return;
    }
    console.log(
      `[IWSDK-MCP-TRACE] ${message} ${JSON.stringify({
        ...details,
        tabId: this.tabId,
        tabGeneration: this.tabGeneration,
      })}`,
    );
  }

  /**
   * Connect to the Vite dev server's WebSocket endpoint
   */
  connect(port?: number): void {
    // Guard against duplicate connections
    if (this.ws !== null) {
      return;
    }

    this.intentionalDisconnect = false;

    const wsPort = port ?? this.getVitePort();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const wsUrl = `${protocol}//${host}:${wsPort}/__iwer_mcp`;

    if (this.verbose) {
      console.log('[IWSDK-MCP] Connecting to:', wsUrl);
    }
    this.trace('client_connect_start', {
      wsUrl,
      reconnectAttempts: this.reconnectAttempts,
    });

    try {
      const socket = new WebSocket(wsUrl);
      this.ws = socket;
      this.setupEventHandlers(socket);
      this.connectTimer = setTimeout(() => {
        if (this.ws !== socket || socket.readyState !== WebSocket.CONNECTING) {
          return;
        }
        this.trace('client_connect_timeout', {
          timeoutMs: this.connectTimeoutMs,
        });
        this.detachEventHandlers(socket);
        this.ws = null;
        try {
          socket.close();
        } catch {}
        this.clearConnectTimer();
        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      }, this.connectTimeoutMs);
    } catch (error) {
      console.error('[IWSDK-MCP] Failed to create WebSocket:', error);
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    this.intentionalDisconnect = true;

    // Reset the reconnect budget so a later connect() starts fresh. Without
    // this, a client that had already exhausted maxReconnectAttempts stays
    // capped after an explicit disconnect/reconnect cycle: scheduleReconnect()
    // early-returns forever and the client can never recover. (Auto-reconnects
    // go through scheduleReconnect()->connect(), not disconnect(), so the
    // backoff/cap behavior for unintentional drops is unchanged.)
    this.reconnectAttempts = 0;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectTimer();

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.detachEventHandlers(socket);
      try {
        socket.close();
      } catch {}
    }
  }

  private getVitePort(): number {
    const port = parseInt(window.location.port, 10);
    return port || 5173;
  }

  private setupEventHandlers(socket: WebSocket): void {
    socket.onopen = () => {
      if (this.ws !== socket) {
        return;
      }
      this.clearConnectTimer();
      if (this.verbose) {
        console.log('[IWSDK-MCP] Connected');
      }
      this.trace('client_open');
      this.reconnectAttempts = 0;
      socket.send(
        JSON.stringify({
          type: 'iwsdk_browser_hello',
          ...((window as any).__IWSDK_RUNTIME_IDENTITY ?? {}),
          headsetToken: (() => {
            if (this.deviceClass !== 'physical') {
              return undefined;
            }
            let token: string | null = null;
            try {
              token = new URL(window.location.href).searchParams.get(
                '__iwsdk_headset',
              );
            } catch {}
            try {
              if (token) {
                window.sessionStorage.setItem('iwsdk:headset-token', token);
              }
              return (
                token ?? window.sessionStorage.getItem('iwsdk:headset-token')
              );
            } catch {
              return token;
            }
          })(),
          commandReady: window.FRAMEWORK_MCP_RUNTIME != null,
          deviceClass: this.deviceClass,
          pageId: this.tabId,
          pageRole: this.pageRole,
          role: this.pageRole,
          sceneSessionId: this.sceneSessionId,
          tabId: this.tabId,
          tabGeneration: this.tabGeneration,
        }),
      );
      this.trace('client_hello_sent');
    };

    socket.onclose = (event) => {
      if (this.ws !== socket) {
        return;
      }
      this.clearConnectTimer();
      if (this.verbose) {
        console.log(
          '[IWSDK-MCP] Disconnected:',
          event.reason || 'Connection closed',
        );
      }
      this.trace('client_close', {
        code: event.code,
        reason: event.reason || 'Connection closed',
        intentional: this.intentionalDisconnect,
      });
      this.ws = null;
      this.detachEventHandlers(socket);
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = (error) => {
      if (this.ws !== socket) {
        return;
      }
      this.trace('client_error', {
        message:
          error instanceof ErrorEvent && error.message
            ? error.message
            : 'WebSocket error',
      });
      console.error('[IWSDK-MCP] WebSocket error:', error);
    };

    socket.onmessage = async (event) => {
      if (this.ws !== socket) {
        return;
      }
      await this.handleMessage(event.data);
    };
  }

  private clearConnectTimer(): void {
    if (this.connectTimer != null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private detachEventHandlers(socket: WebSocket): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

  private announceCommandReady(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(
      JSON.stringify({
        type: 'iwsdk_browser_ready',
        pageId: this.tabId,
        pageRole: this.pageRole,
        tabGeneration: this.tabGeneration,
      }),
    );
    this.trace('client_command_ready_sent');
  }

  private async handleMessage(data: string): Promise<void> {
    let request: MCPRequest;

    try {
      request = JSON.parse(data);
    } catch {
      console.error('[IWSDK-MCP] Invalid JSON received:', data);
      return;
    }

    // Validate request structure
    if (typeof request.id !== 'string' || typeof request.method !== 'string') {
      console.error(
        '[IWSDK-MCP] Malformed request (missing id or method):',
        request,
      );
      return;
    }

    if (this.verbose) {
      console.debug('[IWSDK-MCP] Received:', request.method, request.params);
    }
    this.trace('client_request_received', {
      id: request.id,
      method: request.method,
    });

    const response: MCPResponse = { id: request.id };

    try {
      response.result = await this.dispatch(
        request.method,
        request.params ?? {},
      );
    } catch (error) {
      response.error = serializeMCPError(error);
    }

    if (this.verbose) {
      if (response.error) {
        console.debug('[IWSDK-MCP] Error:', response.error.message);
      } else {
        console.debug('[IWSDK-MCP] Result:', response.result);
      }
    }

    this.send(response);
  }

  /**
   * Dispatch a method call to the appropriate handler.
   * Priority:
   * 1. Framework runtime (IWSDK or any framework providing FRAMEWORK_MCP_RUNTIME)
   * 2. IWER device control (device.remote.dispatch)
   *
   * Managed-browser host commands are normally intercepted by the Vite host.
   * Native XR control deliberately relays reload_page to the physical app so
   * the headset page, rather than an inert managed tab, is refreshed.
   */
  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    // 1. Reload the page locally when native XR routing sends this request to
    // the physical browser. Defer teardown so the WebSocket response flushes.
    if (method === 'reload_page') {
      // Quest can leave a blank, disconnected page when navigation tears down
      // an active immersive session. Let its owner finish XR teardown first.
      await window.FRAMEWORK_MCP_RUNTIME?.prepareForReload?.();
      // Quest may serve a script-free offline MHTML snapshot even for an
      // ordinary same-URL navigation. Request a fresh document; bootstrap
      // removes the private query without adding a browser history entry.
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const url = window.location.href.replace(
        /^[^#]*/u,
        (address) =>
          `${address}${address.includes('?') ? '&' : '?'}__iwsdk_reload=${nonce}`,
      );
      setTimeout(() => window.location.replace(url), 50);
      return { success: true, message: 'Page reload initiated' };
    }

    // 2. Route to framework runtime if available and handles this method
    if (window.FRAMEWORK_MCP_RUNTIME?.handles(method)) {
      return window.FRAMEWORK_MCP_RUNTIME.dispatch(method, params);
    }

    // 3. All other methods go to IWER's RemoteControlInterface when this page
    // owns an emulated device. Workspace-only editor pages deliberately use a
    // device-less bridge so browser-first apps keep native non-XR behavior.
    if (this.device == null) {
      throw new Error(
        `Method "${method}" requires IWER device emulation and is unavailable in this workspace-only page`,
      );
    }
    return this.device.remote.dispatch(method, params);
  }

  private send(response: MCPResponse): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Inject tab identity so the MCP server knows which tab responded
      const enriched = {
        ...response,
        _tabId: this.tabId,
        _tabGeneration: this.tabGeneration,
      };
      this.trace('client_response_sent', {
        id: response.id,
        hasError: Boolean(response.error),
      });
      this.ws.send(JSON.stringify(enriched));
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.reconnectTimer != null) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.verbose) {
        console.debug('[IWSDK-MCP] Max reconnect attempts reached');
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * this.reconnectAttempts,
      this.maxReconnectDelay,
    );

    if (this.verbose) {
      console.debug(
        `[IWSDK-MCP] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
      );
    }
    this.trace('client_reconnect_scheduled', {
      delay,
      attempt: this.reconnectAttempts,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/**
 * Initialize MCP WebSocket client and connect to the server
 */
export function initMCPClient(
  device: MCPDevice,
  options: {
    deviceClass?: MCPDeviceClass;
    port?: number;
    verbose?: boolean;
  } = {},
): MCPWebSocketClient {
  const client = new MCPWebSocketClient(device, {
    deviceClass: options.deviceClass,
    verbose: options.verbose,
  });
  client.connect(options.port);
  return client;
}

/**
 * IWER's hand sequences name their targets ("counter-button", "Map Pin 1"),
 * but only the framework knows the scene. Hands IWER the framework runtime's
 * resolver now, and again whenever a runtime starts (a new world after a
 * reload or HMR).
 */
export function connectFrameworkTargetResolver(device: MCPDevice): void {
  const { remote } = device;
  if (typeof remote.setTargetResolver !== 'function') {
    return;
  }
  const register = () =>
    remote.setTargetResolver!(
      window.FRAMEWORK_MCP_RUNTIME?.targetResolver ?? null,
    );
  register();
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('iwsdk:mcp-runtime-ready', register);
  }
}

/**
 * Connect a managed workspace/editor page without installing or requiring IWER.
 * Framework-provided scene/workspace methods and page reload remain available;
 * XR device methods return an explicit unsupported error.
 */
export function initMCPBridge(
  options: {
    port?: number;
    verbose?: boolean;
    deviceClass?: MCPDeviceClass;
  } = {},
): MCPWebSocketClient {
  const client = new MCPWebSocketClient(null, {
    verbose: options.verbose,
    deviceClass: options.deviceClass,
  });
  client.connect(options.port);
  return client;
}
