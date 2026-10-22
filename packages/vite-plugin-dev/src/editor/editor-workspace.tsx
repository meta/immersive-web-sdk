/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { signal, type Signal } from '@preact/signals-core';
import {
  Box,
  Boxes,
  Camera,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  ExternalLink,
  Focus,
  Gamepad2,
  Globe2,
  Lock,
  Magnet,
  Move3D,
  PanelTop,
  PersonStanding,
  Plus,
  Redo2,
  RefreshCw,
  Rotate3D,
  Scale3D,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide';
import { h, render, type ComponentChildren, type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

type WorkspaceView = 'runtime' | 'editor';
const ENTITY_REFERENCE_MIME = 'application/x-iwsdk-entity-reference';
type IconNode = readonly [
  tag: string,
  attributes: Record<string, string | number>,
  children?: readonly IconNode[],
];

export interface EditorWorkspaceSnapshot {
  assetCount: number;
  builtInSelection: string | null;
  dirty: boolean;
  dirtyStatus: string;
  ghostedNodeIds: string[];
  hiddenNodeIds: string[];
  lockedNodeIds: string[];
  loading: boolean;
  loadingProgress: number;
  loadingStatus: string;
  nodeCount: number;
  nodes: any[];
  rootSelected: boolean;
  sceneAssets: any[];
  scenePath: string | null;
  selectedNodeIds: string[];
  soloNodeId: string | null;
  statusStrip: string;
  tabAudioAvailable: boolean;
  tabAudioMuted: boolean;
  transformMode: 'translate' | 'rotate' | 'scale';
  transformSnapEnabled: boolean;
  transformSnapRotationDeg: number;
  transformSnapScale: number;
  transformSnapTranslation: number;
  transformSpace: 'local' | 'world';
  viewportDrawDistance: number;
  view: WorkspaceView;
}

export interface EditorWorkspaceController {
  addAsset?(assetId: string): void;
  addEntity?(): void;
  moveNode?(
    nodeId: string,
    parentId: string | null,
    parent?: { type: 'player-space'; target: string },
  ): void;
  openNodeContextMenu?(nodeId: string, point: { x: number; y: number }): void;
  openRuntimeInBrowser?(): void;
  redo?(): void;
  reloadPage?(): void;
  selectNode?(
    nodeId: string,
    modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ): void;
  selectBuiltin?(target: string): void;
  selectRoot?(): void;
  setTabAudioMuted?(muted: boolean): void;
  setTransformMode?(mode: 'translate' | 'rotate' | 'scale'): void;
  setTransformSnap?(
    mode: 'translate' | 'rotate' | 'scale',
    value: number,
  ): void;
  setTransformSpace?(space: 'local' | 'world'): void;
  setViewportDrawDistance?(distance: number): void;
  setView?(view: WorkspaceView): void;
  toggleNodeExpanded?(nodeId: string): void;
  toggleNodeVisibility?(nodeId: string): void;
  toggleTransformSnap?(): void;
  undo?(): void;
}

export interface EditorWorkspaceMount {
  state: Signal<EditorWorkspaceSnapshot>;
  unmount(): void;
  update(patch: Partial<EditorWorkspaceSnapshot>): void;
}

const DEFAULT_SNAPSHOT: EditorWorkspaceSnapshot = {
  assetCount: 0,
  builtInSelection: null,
  dirty: false,
  dirtyStatus: 'Saved',
  ghostedNodeIds: [],
  hiddenNodeIds: [],
  lockedNodeIds: [],
  loading: true,
  loadingProgress: 8,
  loadingStatus: 'Starting editor…',
  nodeCount: 0,
  nodes: [],
  rootSelected: false,
  sceneAssets: [],
  scenePath: null,
  selectedNodeIds: [],
  soloNodeId: null,
  statusStrip: 'Scene loading...',
  tabAudioAvailable: false,
  tabAudioMuted: false,
  transformMode: 'translate',
  transformSnapEnabled: false,
  transformSnapRotationDeg: 15,
  transformSnapScale: 0.1,
  transformSnapTranslation: 0.25,
  transformSpace: 'local',
  viewportDrawDistance: 5000,
  view: 'runtime',
};

const ICONS = {
  Box,
  Boxes,
  Camera,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  ExternalLink,
  Focus,
  Gamepad2,
  Globe2,
  Lock,
  Magnet,
  Move3D,
  PanelTop,
  PersonStanding,
  Plus,
  Redo2,
  RefreshCw,
  Rotate3D,
  Scale3D,
  Undo2,
  Volume2,
  VolumeX,
} satisfies Record<string, IconNode>;

export function mountEditorWorkspace(
  root: HTMLElement,
  controller: EditorWorkspaceController,
  initial: Partial<EditorWorkspaceSnapshot> = {},
): EditorWorkspaceMount {
  const state = signal({ ...DEFAULT_SNAPSHOT, ...initial });
  render(<EditorWorkspace state={state} controller={controller} />, root);
  return {
    state,
    unmount() {
      render(null, root);
    },
    update(patch) {
      state.value = { ...state.value, ...patch };
    },
  };
}

function EditorWorkspace({
  controller,
  state,
}: {
  controller: EditorWorkspaceController;
  state: Signal<EditorWorkspaceSnapshot>;
}) {
  const snapshot = useSignalValue(state);
  return (
    <main class="workspace-shell" data-workspace-shell>
      <WorkspaceViewSwitcher snapshot={snapshot} controller={controller} />
      <iframe
        id="workspace-runtime-frame"
        class="workspace-runtime-frame"
        data-workspace-runtime-src="/"
        title="IWSDK runtime app"
      />
      <section class="workspace-editor-pane" data-workspace-editor-pane>
        <main class="editor-shell">
          <div class="editor-state-readouts" aria-hidden="true">
            <span id="scene-status">
              {snapshot.nodeCount} nodes, {snapshot.assetCount} assets
            </span>
            <span
              id="dirty-status"
              data-state={snapshot.dirty ? 'dirty' : 'saved'}
            >
              {snapshot.dirtyStatus}
            </span>
          </div>
          <EditorViewport snapshot={snapshot} controller={controller} />
          <EditorLeftPanel snapshot={snapshot} controller={controller} />
          <EditorInspector snapshot={snapshot} controller={controller} />
        </main>
        {snapshot.loading ? (
          <EditorLoadingState
            overlay
            progress={snapshot.loadingProgress}
            status={snapshot.loadingStatus}
          />
        ) : null}
      </section>
    </main>
  );
}

function EditorLoadingState({
  overlay = false,
  progress,
  status,
}: {
  overlay?: boolean;
  progress: number;
  status: string;
}) {
  const normalizedProgress = Math.min(100, Math.max(0, progress));
  return (
    <main
      class={`editor-loading${overlay ? ' editor-loading-overlay' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div class="editor-loading-content">
        <div class="editor-loading-spinner" aria-hidden="true" />
        <h1>IWSDK Scene Editor</h1>
        <p>{status}</p>
        <div
          class="editor-loading-track"
          role="progressbar"
          aria-label="Editor startup"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={normalizedProgress}
        >
          <span
            class="editor-loading-progress"
            style={{ width: `${normalizedProgress}%` }}
          />
        </div>
      </div>
    </main>
  );
}

function useSignalValue<T>(state: Signal<T>): T {
  const [value, setValue] = useState(() => state.peek());
  useEffect(() => state.subscribe(setValue), [state]);
  return value;
}

function WorkspaceViewSwitcher({
  controller,
  snapshot,
}: {
  controller: EditorWorkspaceController;
  snapshot: EditorWorkspaceSnapshot;
}) {
  return (
    <div class="workspace-view-switcher" aria-label="Workspace view">
      {(['runtime', 'editor'] as const).map((view) => (
        <button
          key={view}
          data-active={snapshot.view === view || undefined}
          data-workspace-view-button={view}
          onClick={() => controller.setView?.(view)}
        >
          {view === 'runtime' ? 'Runtime' : 'Editor'}
        </button>
      ))}
      <button
        type="button"
        class="workspace-icon-button workspace-reload-button"
        data-workspace-reload-button
        title="Reload page"
        aria-label="Reload page"
        onClick={() => controller.reloadPage?.()}
      >
        <Icon name="RefreshCw" />
      </button>
      <button
        type="button"
        class="workspace-icon-button"
        data-workspace-open-browser-button
        title="Open runtime in default browser"
        aria-label="Open runtime in default browser"
        onClick={() => controller.openRuntimeInBrowser?.()}
      >
        <Icon name="ExternalLink" />
      </button>
      {snapshot.tabAudioAvailable ? (
        <TabAudioButton
          muted={snapshot.tabAudioMuted}
          onToggle={(muted) => controller.setTabAudioMuted?.(muted)}
        />
      ) : null}
    </div>
  );
}

function TabAudioButton({
  muted,
  onToggle,
}: {
  muted: boolean;
  onToggle(muted: boolean): void;
}) {
  const label = muted ? 'Unmute tab audio' : 'Mute tab audio';
  return (
    <button
      type="button"
      class="workspace-icon-button"
      data-active={muted || undefined}
      data-workspace-mute-button
      title={label}
      aria-label={label}
      onClick={() => onToggle(!muted)}
    >
      <Icon name={muted ? 'VolumeX' : 'Volume2'} />
    </button>
  );
}

function EditorViewport({
  controller,
  snapshot,
}: {
  controller: EditorWorkspaceController;
  snapshot: EditorWorkspaceSnapshot;
}) {
  return (
    <section class="editor-viewport">
      <EditorToolbar snapshot={snapshot} controller={controller} />
      <div id="scene-viewport">
        <div
          id="orientation-gizmo"
          aria-label="Interactive orientation gizmo"
        />
        <div
          class="editor-slot viewport-overlay-slot"
          data-editor-slot="viewport.overlay"
        />
      </div>
      <section
        id="editor-bottom-panel"
        class="editor-bottom-panel"
        aria-label="Scene diagnostics"
      >
        <div class="bottom-panel-tabs" role="tablist">
          <button data-bottom-tab="assets" data-active>
            Assets
          </button>
          <button data-bottom-tab="console">Console</button>
          <button data-bottom-tab="validation">Validation</button>
        </div>
        <AssetBrowser snapshot={snapshot} controller={controller} />
        <div id="bottom-panel-content" class="bottom-panel-content" />
      </section>
      <div
        id="editor-status-strip"
        aria-live="polite"
        data-state={snapshot.dirty ? 'dirty' : 'saved'}
      >
        {snapshot.statusStrip}
      </div>
    </section>
  );
}

function EditorToolbar({
  controller,
  snapshot,
}: {
  controller: EditorWorkspaceController;
  snapshot: EditorWorkspaceSnapshot;
}) {
  const snapControl =
    snapshot.transformMode === 'rotate'
      ? {
          label: 'Rotation snap interval',
          max: 180,
          min: 0.1,
          step: 0.1,
          suffix: '°',
          title: 'Rotation snapping interval in degrees',
          value: snapshot.transformSnapRotationDeg,
        }
      : snapshot.transformMode === 'scale'
        ? {
            label: 'Scale snap interval',
            max: 10,
            min: 0.001,
            step: 0.01,
            suffix: '×',
            title:
              'Scale factor snapping interval (0.1× equals 10 percentage-point steps)',
            value: snapshot.transformSnapScale,
          }
        : {
            label: 'Move snap interval',
            max: 10000,
            min: 0.001,
            step: 0.001,
            suffix: 'm',
            title: 'Movement snapping interval in meters',
            value: snapshot.transformSnapTranslation,
          };
  return (
    <div class="editor-toolbar" aria-label="Scene editor tools">
      <div class="editor-slot toolbar-slot" data-editor-slot="toolbar.left" />
      <div
        id="transform-toolbar"
        class="toolbar-group"
        aria-label="Transform controls"
      >
        <IconButton
          active={snapshot.transformMode === 'translate'}
          icon="Move3D"
          label="Move"
          data={{ 'data-transform-mode': 'translate' }}
          onClick={() => controller.setTransformMode?.('translate')}
        />
        <IconButton
          active={snapshot.transformMode === 'rotate'}
          icon="Rotate3D"
          label="Rotate"
          data={{ 'data-transform-mode': 'rotate' }}
          onClick={() => controller.setTransformMode?.('rotate')}
        />
        <IconButton
          active={snapshot.transformMode === 'scale'}
          icon="Scale3D"
          label="Scale"
          data={{ 'data-transform-mode': 'scale' }}
          onClick={() => controller.setTransformMode?.('scale')}
        />
      </div>
      <div class="toolbar-group" aria-label="Transform snapping">
        <IconButton
          active={snapshot.transformSnapEnabled}
          icon="Magnet"
          label="Snap"
          data={{ 'data-transform-snap': '' }}
          onClick={() => controller.toggleTransformSnap?.()}
        />
        <label class="transform-snap-control" title={snapControl.title}>
          <input
            aria-label={snapControl.label}
            data-transform-snap-interval={snapshot.transformMode}
            max={snapControl.max}
            min={snapControl.min}
            step={snapControl.step}
            type="number"
            value={snapControl.value}
            onBlur={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) {
                controller.setTransformSnap?.(snapshot.transformMode, value);
              }
            }}
          />
          <span>{snapControl.suffix}</span>
        </label>
      </div>
      <div class="toolbar-group" aria-label="Transform space">
        <IconButton
          active={snapshot.transformSpace === 'local'}
          icon="Box"
          label="Local space"
          data={{ 'data-transform-space': 'local' }}
          onClick={() => controller.setTransformSpace?.('local')}
        />
        <IconButton
          active={snapshot.transformSpace === 'world'}
          icon="Globe2"
          label="World space"
          data={{ 'data-transform-space': 'world' }}
          onClick={() => controller.setTransformSpace?.('world')}
        />
      </div>
      <div class="editor-slot toolbar-slot" data-editor-slot="toolbar.center" />
      <div class="toolbar-group" aria-label="Document history">
        <IconButton
          icon="Undo2"
          label="Undo"
          id="undo"
          onClick={() => controller.undo?.()}
        />
        <IconButton
          icon="Redo2"
          label="Redo"
          id="redo"
          onClick={() => controller.redo?.()}
        />
      </div>
      <div class="toolbar-group" aria-label="Viewport settings">
        <label
          class="viewport-distance-control"
          title="Editor viewport far clipping distance"
        >
          <span>View</span>
          <input
            aria-label="View distance"
            data-viewport-draw-distance
            min="50"
            max="100000"
            step="100"
            type="number"
            value={snapshot.viewportDrawDistance}
            onBlur={(event) => {
              const distance = event.currentTarget.valueAsNumber;
              if (Number.isFinite(distance)) {
                controller.setViewportDrawDistance?.(distance);
              }
            }}
          />
          <span>m</span>
        </label>
      </div>
      <div class="editor-slot toolbar-slot" data-editor-slot="toolbar.right" />
    </div>
  );
}

function IconButton({
  active = false,
  data = {},
  disabled = false,
  icon,
  id,
  label,
  onClick,
}: {
  active?: boolean;
  data?: Record<string, string>;
  disabled?: boolean;
  icon: keyof typeof ICONS;
  id?: string;
  label: string;
  onClick?(): void;
}) {
  return (
    <button
      {...data}
      id={id}
      class="icon-button"
      data-active={active || undefined}
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function EditorLeftPanel({
  controller,
  snapshot,
}: {
  controller: EditorWorkspaceController;
  snapshot: EditorWorkspaceSnapshot;
}) {
  return (
    <section
      class="editor-panel editor-panel-left"
      data-editor-panel="composition"
    >
      <div class="editor-slot sidebar-slot" data-editor-slot="sidebar.top" />
      <SceneGraph snapshot={snapshot} controller={controller} />
      <div class="editor-slot sidebar-slot" data-editor-slot="sidebar.bottom" />
      <div
        id="scene-graph-context-menu"
        class="scene-graph-context-menu"
        hidden
      />
    </section>
  );
}

function SceneGraph({
  controller,
  snapshot,
}: {
  controller: EditorWorkspaceController;
  snapshot: EditorWorkspaceSnapshot;
}) {
  const [query, setQuery] = useState('');
  const filteredNodes = useMemo(
    () =>
      sortSceneNodesById(
        filterSceneNodes(snapshot.nodes, query.trim().toLowerCase()),
      ),
    [snapshot.nodes, query],
  );
  const levelNodes = filteredNodes.filter((node) => node.parent == null);
  const playerNodes = (target: string) =>
    filteredNodes.filter(
      (node) =>
        node.parent?.type === 'player-space' && node.parent.target === target,
    );
  const renderNodes = (nodes: any[], depth: number) =>
    nodes.map((node) => (
      <SceneNodeRow
        key={node.id}
        node={node}
        depth={depth}
        query={query}
        snapshot={snapshot}
        controller={controller}
      />
    ));
  return (
    <div class="panel-section scene-graph-section">
      <div class="panel-section-header">
        <h2>Scene Graph</h2>
      </div>
      <div class="panel-control-row">
        <input
          id="scene-graph-filter"
          type="search"
          placeholder="Filter nodes"
          aria-label="Filter scene graph nodes"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <BuiltinSceneRow
        id="player"
        label="Player Space"
        icon="PersonStanding"
        entityReference={{ type: 'player-space', target: 'player' }}
        selected={snapshot.builtInSelection === 'player'}
        onSelect={() => controller.selectBuiltin?.('player')}
        dropTarget={{ type: 'player-space', target: 'player' }}
        controller={controller}
      >
        <BuiltinSceneRow
          collapsible
          id="camera"
          label="Camera"
          icon="Camera"
          entityReference={{ type: 'player-space', target: 'camera' }}
          selected={snapshot.builtInSelection === 'camera'}
          onSelect={() => controller.selectBuiltin?.('camera')}
          dropTarget={{ type: 'player-space', target: 'camera' }}
          controller={controller}
        >
          {renderNodes(playerNodes('camera'), 1)}
        </BuiltinSceneRow>
        <BuiltinSceneRow
          collapsible
          id="head"
          label="Head"
          icon="Focus"
          entityReference={{ type: 'player-space', target: 'head' }}
          selected={snapshot.builtInSelection === 'head'}
          onSelect={() => controller.selectBuiltin?.('head')}
          dropTarget={{ type: 'player-space', target: 'head' }}
          controller={controller}
        >
          {renderNodes(playerNodes('head'), 1)}
        </BuiltinSceneRow>
        <BuiltinSceneRow
          collapsible
          id="left-target-ray"
          label="Left Target Ray"
          icon="Crosshair"
          entityReference={{ type: 'player-space', target: 'left-target-ray' }}
          selected={snapshot.builtInSelection === 'left-target-ray'}
          onSelect={() => controller.selectBuiltin?.('left-target-ray')}
          dropTarget={{ type: 'player-space', target: 'left-target-ray' }}
          controller={controller}
        >
          {renderNodes(playerNodes('left-target-ray'), 1)}
        </BuiltinSceneRow>
        <BuiltinSceneRow
          collapsible
          id="left-grip"
          label="Left Grip"
          icon="Gamepad2"
          entityReference={{ type: 'player-space', target: 'left-grip' }}
          selected={snapshot.builtInSelection === 'left-grip'}
          onSelect={() => controller.selectBuiltin?.('left-grip')}
          dropTarget={{ type: 'player-space', target: 'left-grip' }}
          controller={controller}
        >
          {renderNodes(playerNodes('left-grip'), 1)}
        </BuiltinSceneRow>
        <BuiltinSceneRow
          collapsible
          id="right-target-ray"
          label="Right Target Ray"
          icon="Crosshair"
          entityReference={{ type: 'player-space', target: 'right-target-ray' }}
          selected={snapshot.builtInSelection === 'right-target-ray'}
          onSelect={() => controller.selectBuiltin?.('right-target-ray')}
          dropTarget={{ type: 'player-space', target: 'right-target-ray' }}
          controller={controller}
        >
          {renderNodes(playerNodes('right-target-ray'), 1)}
        </BuiltinSceneRow>
        <BuiltinSceneRow
          collapsible
          id="right-grip"
          label="Right Grip"
          icon="Gamepad2"
          entityReference={{ type: 'player-space', target: 'right-grip' }}
          selected={snapshot.builtInSelection === 'right-grip'}
          onSelect={() => controller.selectBuiltin?.('right-grip')}
          dropTarget={{ type: 'player-space', target: 'right-grip' }}
          controller={controller}
        >
          {renderNodes(playerNodes('right-grip'), 1)}
        </BuiltinSceneRow>
        {renderNodes(playerNodes('player'), 0)}
      </BuiltinSceneRow>
      <BuiltinSceneRow
        id="level-root"
        label="Level Root"
        icon="Move3D"
        entityReference={{ type: 'level-root' }}
        selected={snapshot.rootSelected}
        onSelect={() => controller.selectRoot?.()}
        dropTarget={null}
        controller={controller}
      >
        <div id="outliner" role="tree">
          {levelNodes.length ? (
            renderNodes(levelNodes, 0)
          ) : (
            <div class="empty-state" data-empty-outliner>
              No matching nodes
            </div>
          )}
        </div>
      </BuiltinSceneRow>
      <div class="scene-graph-footer">
        <button
          id="add-entity"
          class="component-add-button scene-add-entity-button"
          type="button"
          onClick={() => controller.addEntity?.()}
        >
          <Icon name="Plus" />
          <span>Add Entity</span>
        </button>
      </div>
    </div>
  );
}

function BuiltinSceneRow({
  children,
  collapsible = false,
  controller,
  depth = 0,
  dropTarget,
  entityReference,
  icon,
  id,
  label,
  onSelect,
  selected,
}: {
  children?: ComponentChildren;
  collapsible?: boolean;
  controller?: EditorWorkspaceController;
  depth?: number;
  dropTarget?: { type: 'player-space'; target: string } | null;
  entityReference:
    | { type: 'player-space'; target: string }
    | { type: 'level-root' };
  icon: keyof typeof ICONS;
  id: string;
  label: string;
  onSelect(): void;
  selected: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const acceptsDrop = dropTarget !== undefined;
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : children != null && children !== false;
  const hasDisclosure = collapsible && hasChildren;
  const toggleExpanded = () => {
    if (hasDisclosure) {
      setExpanded((value) => !value);
    }
  };
  return (
    <>
      <button
        id={dropTarget === null ? 'scene-root-drop-target' : undefined}
        class="scene-root-drop-target node-row builtin-node-row"
        data-active={selected || undefined}
        data-builtin-node={id}
        data-scene-root-drop={dropTarget === null || undefined}
        data-scene-builtin-drop={
          dropTarget && dropTarget.type === 'player-space'
            ? dropTarget.target
            : undefined
        }
        draggable
        type="button"
        aria-expanded={hasDisclosure ? expanded : undefined}
        style={{ '--depth': depth } as any}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (
            !hasDisclosure ||
            !['ArrowLeft', 'ArrowRight'].includes(event.key)
          ) {
            return;
          }
          const shouldExpand = event.key === 'ArrowRight';
          if (shouldExpand === expanded) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setExpanded(shouldExpand);
        }}
        onDragStart={(event) => {
          const transfer = event.dataTransfer;
          transfer?.setData(
            ENTITY_REFERENCE_MIME,
            JSON.stringify(entityReference),
          );
          if (transfer) {
            transfer.effectAllowed = 'copy';
          }
        }}
        onDragOver={
          acceptsDrop
            ? (event) => {
                const transfer = event.dataTransfer;
                if (transfer?.types.includes('text/plain')) {
                  event.preventDefault();
                  transfer.dropEffect = 'move';
                }
              }
            : undefined
        }
        onDrop={
          acceptsDrop
            ? (event) => {
                event.preventDefault();
                const nodeId = event.dataTransfer?.getData('text/plain');
                if (nodeId) {
                  controller?.moveNode?.(nodeId, null, dropTarget ?? undefined);
                }
              }
            : undefined
        }
      >
        {collapsible ? (
          <span
            class="node-row-caret"
            data-outliner-disclosure={hasDisclosure || undefined}
            title={
              hasDisclosure
                ? `${expanded ? 'Collapse' : 'Expand'} ${label}`
                : undefined
            }
            onClick={(event) => {
              if (!hasDisclosure) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              toggleExpanded();
            }}
          >
            {hasDisclosure ? (
              <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} />
            ) : null}
          </span>
        ) : null}
        <span class="node-row-icon">
          <Icon name={icon} />
        </span>
        <span class="node-row-main">
          <span class="node-row-id">{label}</span>
        </span>
        <span class="node-row-built-in">Built-in</span>
      </button>
      {!collapsible || expanded ? children : null}
    </>
  );
}

function SceneNodeRow({
  controller,
  depth,
  node,
  query,
  snapshot,
}: {
  controller: EditorWorkspaceController;
  depth: number;
  node: any;
  query: string;
  snapshot: EditorWorkspaceSnapshot;
}) {
  const children = Array.isArray(node.children) ? node.children : [];
  const expanded =
    children.length > 0 && (Boolean(query) || node.expanded !== false);
  const selected = snapshot.selectedNodeIds.includes(node.id);
  const hidden = snapshot.hiddenNodeIds.includes(node.id);
  const locked = snapshot.lockedNodeIds.includes(node.id);
  const ghosted = snapshot.ghostedNodeIds.includes(node.id);
  const solo = snapshot.soloNodeId === node.id;
  const kind = sceneNodeKind(node);
  const icon = sceneNodeHasPanelUI(node)
    ? 'PanelTop'
    : kind === 'group'
      ? 'Boxes'
      : 'Box';
  return (
    <>
      <button
        class="node-row"
        data-node-id={node.id}
        data-outliner-parent={children.length > 0 || undefined}
        data-active={selected || undefined}
        data-preview-hidden={hidden || undefined}
        data-preview-locked={locked || undefined}
        draggable
        aria-expanded={children.length > 0 ? expanded : undefined}
        style={{ '--depth': depth } as any}
        onClick={(event) =>
          controller.selectNode?.(node.id, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
        }
        onContextMenu={(event) => {
          event.preventDefault();
          controller.openNodeContextMenu?.(node.id, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onKeyDown={(event) => {
          if (
            !children.length ||
            !['ArrowLeft', 'ArrowRight'].includes(event.key)
          ) {
            return;
          }
          const shouldExpand = event.key === 'ArrowRight';
          if (shouldExpand === expanded) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          controller.toggleNodeExpanded?.(node.id);
        }}
        onDragStart={(event) => {
          const transfer = event.dataTransfer;
          transfer?.setData('text/plain', node.id);
          transfer?.setData(
            ENTITY_REFERENCE_MIME,
            JSON.stringify({ type: 'node', id: node.id }),
          );
          if (transfer) {
            transfer.effectAllowed = 'copyMove';
          }
        }}
        onDragOver={(event) => {
          const transfer = event.dataTransfer;
          const dragged = transfer?.getData('text/plain');
          if (dragged !== node.id) {
            event.preventDefault();
            if (transfer) {
              transfer.dropEffect = 'move';
            }
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const dragged = event.dataTransfer?.getData('text/plain');
          if (dragged && dragged !== node.id) {
            controller.moveNode?.(dragged, node.id);
          }
        }}
      >
        <span
          class="node-row-caret"
          data-outliner-disclosure={children.length > 0 || undefined}
          title={
            children.length > 0
              ? `${expanded ? 'Collapse' : 'Expand'} ${node.id}`
              : undefined
          }
          onClick={(event) => {
            if (!children.length) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            controller.toggleNodeExpanded?.(node.id);
          }}
        >
          {children.length > 0 ? (
            <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} />
          ) : null}
        </span>
        <span class="node-row-icon" data-node-icon={icon}>
          <Icon name={icon} />
        </span>
        <span class="node-row-main">
          <span class="node-row-id">{node.id}</span>
          <span class="node-row-subtitle">{sceneNodeSubtitle(node)}</span>
        </span>
        <span
          class="node-row-visibility"
          data-preview-visibility-toggle
          role="button"
          title={hidden ? 'Show in editor' : 'Hide in editor'}
          aria-label={hidden ? 'Show in editor' : 'Hide in editor'}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            controller.toggleNodeVisibility?.(node.id);
          }}
        >
          <Icon name={hidden ? 'EyeOff' : 'Eye'} />
        </span>
        {solo || ghosted || locked ? (
          <span class="node-row-preview-state" aria-hidden="true">
            {solo ? <Icon name="Focus" /> : null}
            {ghosted ? <Icon name="Eye" /> : null}
            {locked ? <Icon name="Lock" /> : null}
          </span>
        ) : null}
        {children.length > 0 ? (
          <span class="node-row-meta">{children.length}</span>
        ) : null}
      </button>
      {expanded
        ? children.map((child: any) => (
            <SceneNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              query={query}
              snapshot={snapshot}
              controller={controller}
            />
          ))
        : null}
    </>
  );
}

function filterSceneNodes(nodes: any[], query: string): any[] {
  if (!query) {
    return nodes;
  }
  return nodes.flatMap((node) => {
    const children = filterSceneNodes(node.children || [], query);
    const values = [
      node.id,
      node.name,
      node.content?.asset,
      node.content?.geometry?.type,
      sceneNodeKind(node),
    ];
    const matches = values.some(
      (value) =>
        typeof value === 'string' && value.toLowerCase().includes(query),
    );
    return matches || children.length ? [{ ...node, children }] : [];
  });
}

function sortSceneNodesById(nodes: any[]): any[] {
  return [...nodes]
    .sort((left, right) =>
      String(left.id).localeCompare(String(right.id), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    )
    .map((node) => ({
      ...node,
      children: sortSceneNodesById(node.children || []),
    }));
}

function sceneNodeKind(node: any): string {
  return node.content?.type || (node.children?.length ? 'group' : 'group');
}

function sceneNodeHasPanelUI(node: any): boolean {
  const components = node.components || {};
  return Boolean(
    node.assetKind === 'uikitml' ||
      components.PanelUI ||
      components['com.iwsdk.components.PanelUI'],
  );
}

function sceneNodeSubtitle(node: any): string {
  return (
    node.content?.asset ||
    node.content?.geometry?.type ||
    node.content?.type ||
    'group'
  );
}

function AssetBrowser({
  controller,
  snapshot,
}: {
  controller: EditorWorkspaceController;
  snapshot: EditorWorkspaceSnapshot;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const assets = snapshot.sceneAssets.filter((asset) =>
    normalizedQuery.length === 0
      ? true
      : `${asset.id} ${asset.name || ''} ${asset.kind || ''}`
          .toLowerCase()
          .includes(normalizedQuery),
  );
  return (
    <div id="assets-panel" class="asset-library-section" data-assets-panel>
      <div class="asset-library-project">
        <div class="panel-control-row asset-browser-controls">
          <input
            id="asset-filter"
            type="search"
            placeholder="Search assets"
            aria-label="Search assets"
            value={query}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setQuery(value);
            }}
          />
        </div>
        <div id="asset-catalog" aria-live="polite">
          {assets.length ? (
            assets.map((asset) => (
              <AssetRow
                key={asset.id}
                name={asset.id}
                meta={assetCatalogMeta(asset)}
                thumbnailUrl={asset.thumbnailUrl}
                actionLabel={`Add ${asset.id}`}
                actionIcon="Plus"
                actionData={{ 'data-add-asset': asset.id }}
                rowData={{
                  'data-asset-id': asset.id,
                  'data-asset-kind': asset.kind || 'asset',
                }}
                onAction={() => controller.addAsset?.(asset.id)}
              />
            ))
          ) : (
            <div class="empty-state">No assets found</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetRow({
  actionData,
  actionIcon,
  actionLabel,
  meta,
  name,
  onAction,
  rowData,
  thumbnailUrl,
}: {
  actionData?: Record<string, string>;
  actionIcon: 'Plus';
  actionLabel: string;
  meta: string;
  name: string;
  onAction(): void;
  rowData?: Record<string, string>;
  thumbnailUrl?: string;
}) {
  return (
    <div class="asset-catalog-row" {...rowData}>
      <span class="asset-catalog-thumb" aria-hidden="true">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <Icon name="Box" />}
      </span>
      <span class="asset-catalog-main">
        <span class="asset-catalog-name">{name}</span>
        <span class="asset-catalog-meta">{meta}</span>
      </span>
      <button
        {...actionData}
        class="asset-add-button icon-button"
        title={actionLabel}
        aria-label={actionLabel}
        onClick={onAction}
      >
        <Icon name={actionIcon} />
      </button>
    </div>
  );
}

function assetCatalogMeta(asset: any): string {
  const kind = asset.kind || 'asset';
  const name = typeof asset.name === 'string' ? asset.name.trim() : '';
  if (
    !name ||
    name === asset.id ||
    /^(root|scene|group|object3d|procedural|mesh)$/i.test(name)
  ) {
    return kind;
  }
  return `${kind} - ${name}`;
}

function EditorInspector({
  controller: _controller,
  snapshot: _snapshot,
}: {
  controller: EditorWorkspaceController;
  snapshot: EditorWorkspaceSnapshot;
}) {
  return (
    <section
      class="editor-panel editor-panel-right"
      data-editor-panel="inspector"
    >
      <div class="panel-section">
        <div class="panel-section-header">
          <h2>Inspector</h2>
        </div>
        <div id="inspector" />
      </div>
    </section>
  );
}

function Icon({ name }: { name: keyof typeof ICONS }) {
  return renderIconNode(ICONS[name], true);
}

function renderIconNode(node: IconNode, root = false, key = 0): VNode<any> {
  const [tag, attributes, children = []] = node;
  return h(
    tag,
    { ...attributes, ...(root ? { class: 'lucide-icon' } : {}), key },
    children.map((child, index) => renderIconNode(child, false, index)),
  );
}
