// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import type { PsdData, RenderedImage, LayerInfo } from '../lib/types';
import { qtRenderer } from '../lib/qt-renderer';

// Helper: build layer tree for visibility hierarchy
// NOTE: layers are in pre-order (parent → children → groupEnd)
//   index 0: group "Screen1"
//   index 1:   layer "Child1"
//   index 2:   group "SubGroup"
//   index 3:     layer "Child2"
//   index 4:   groupEnd "SubGroup"
//   index 5: groupEnd "Screen1"

// Compute bounding rect for group layers that have 0×0 from PSD
// (groups have no pixel data; their extent is the union of children)
function computeGroupBounds(layers: LayerInfo[]): void {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer.type !== 'group') continue;
    if (layer.width > 0 && layer.height > 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let depth = 0;
    for (let j = i + 1; j < layers.length; j++) {
      const child = layers[j];
      if (child.type === 'groupEnd') {
        if (depth === 0) break;
        depth--;
      } else {
        if (child.type === 'group') depth++;
        if (child.width > 0 && child.height > 0) {
          minX = Math.min(minX, child.x);
          minY = Math.min(minY, child.y);
          maxX = Math.max(maxX, child.x + child.width);
          maxY = Math.max(maxY, child.y + child.height);
        }
      }
    }

    if (minX < Infinity) {
      layer.x = minX;
      layer.y = minY;
      layer.width = maxX - minX;
      layer.height = maxY - minY;
    }
  }
}

function getAncestorGroupIds(layers: LayerInfo[], layerIndex: number): number[] {
  const ancestors: number[] = [];
  // Walk BACKWARD from the layer to find parent groups
  let depth = 0;
  for (let i = layerIndex - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.type === 'groupEnd') {
      depth++;
    } else if (layer.type === 'group') {
      if (depth === 0) {
        ancestors.push(layer.id);
        // keep walking to find higher ancestors
      } else {
        depth--;
      }
    }
  }
  return ancestors;
}

function computeEffectiveVisibility(
  layers: LayerInfo[],
  layerId: number,
  overrides: Map<number, boolean>
): boolean {
  const layerIndex = layers.findIndex(l => l.id === layerId);
  if (layerIndex === -1) return false;

  const layer = layers[layerIndex];
  const ownVisible = overrides.has(layerId) ? overrides.get(layerId)! : layer.visible;
  if (!ownVisible) return false;

  const ancestorIds = getAncestorGroupIds(layers, layerIndex);
  for (const ancestorId of ancestorIds) {
    const ancestor = layers.find(l => l.id === ancestorId);
    if (!ancestor) continue;
    const ancestorVisible = overrides.has(ancestorId) ? overrides.get(ancestorId)! : ancestor.visible;
    if (!ancestorVisible) return false;
  }

  return true;
}

interface PsdState {
  psd: PsdData | null;
  composite: RenderedImage | null;
  loading: boolean;
  rendering: boolean;
  error: string | null;
  fileName: string | null;
  visibilityOverrides: Map<number, boolean>;
}

let loadingGuard = false;

interface PsdActions {
  loadPsd: (data: ArrayBuffer, fileName: string) => Promise<void>;
  toggleLayerVisibility: (layerId: number) => Promise<void>;
  setMultipleVisibility: (overrides: Map<number, boolean>) => Promise<void>;
  recomposite: () => Promise<void>;
  getEffectiveVisibility: (layerId: number) => boolean;
  getOwnVisibility: (layerId: number) => boolean;
  clear: () => void;
  setError: (error: string | null) => void;
}

export const usePsdStore = create<PsdState & PsdActions>((set, get) => ({
  psd: null,
  composite: null,
  loading: false,
  rendering: false,
  error: null,
  fileName: null,
  visibilityOverrides: new Map(),

  loadPsd: async (data, fileName) => {
    if (loadingGuard) return;
    loadingGuard = true;

    set({ loading: true, error: null });

    try {
      await qtRenderer.initialize();
      qtRenderer.cachePsdData('main', data);
      const parsed = await qtRenderer.parsePsd('main');

      const layers = parsed.layers as LayerInfo[];
      computeGroupBounds(layers);

      const psdData: PsdData = {
        handle: parsed.handle,
        width: parsed.width,
        height: parsed.height,
        layers,
      };

      set({ psd: psdData, composite: null, fileName });

      // Restore hints from localStorage
      const savedHints = localStorage.getItem(`psd-run:hints:${fileName}`);
      if (savedHints) {
        try {
          const restored = await qtRenderer.setHintsJson('main', savedHints);
          console.log('[psd-store] Restored hints:', restored);
        } catch (e) {
          console.warn('[psd-store] Failed to restore hints:', e);
        }
      }

      // Initial render
      const composite = await qtRenderer.renderCompositeWithQt('main', [], []);
      set({ composite });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load PSD' });
    } finally {
      loadingGuard = false;
      set({ loading: false });
    }
  },

  toggleLayerVisibility: async (layerId) => {
    const state = get();
    if (!state.psd) return;

    const layer = state.psd.layers.find(l => l.id === layerId);
    if (!layer) return;

    const overrides = state.visibilityOverrides;
    const currentVisible = overrides.has(layerId) ? overrides.get(layerId)! : layer.visible;
    const newVisible = !currentVisible;

    const newOverrides = new Map(overrides);
    newOverrides.set(layerId, newVisible);

    // Compute hidden/shown lists
    const hiddenLayerIds: number[] = [];
    const shownLayerIds: number[] = [];

    for (const l of state.psd.layers) {
      if (l.type === 'groupEnd') continue;
      const effectiveVisible = computeEffectiveVisibility(state.psd.layers, l.id, newOverrides);
      if (effectiveVisible && !l.visible) {
        shownLayerIds.push(l.id);
      } else if (!effectiveVisible && l.visible) {
        hiddenLayerIds.push(l.id);
      }
    }

    set({ visibilityOverrides: newOverrides });

    try {
      const composite = await qtRenderer.renderCompositeWithQt('main', hiddenLayerIds, shownLayerIds);
      set({ composite });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to render' });
    }
  },

  setMultipleVisibility: async (overrides) => {
    const state = get();
    if (!state.psd) return;

    const newOverrides = new Map(state.visibilityOverrides);

    for (const [layerId, visible] of overrides) {
      newOverrides.set(layerId, visible);
    }

    // Compute hidden/shown lists once
    const hiddenLayerIds: number[] = [];
    const shownLayerIds: number[] = [];

    for (const l of state.psd.layers) {
      if (l.type === 'groupEnd') continue;
      const effectiveVisible = computeEffectiveVisibility(state.psd.layers, l.id, newOverrides);
      if (effectiveVisible && !l.visible) {
        shownLayerIds.push(l.id);
      } else if (!effectiveVisible && l.visible) {
        hiddenLayerIds.push(l.id);
      }
    }

    set({ visibilityOverrides: newOverrides });

    try {
      const composite = await qtRenderer.renderCompositeWithQt('main', hiddenLayerIds, shownLayerIds);
      set({ composite });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to render' });
    }
  },

  recomposite: async () => {
    const state = get();
    if (!state.psd) return;

    const hiddenLayerIds: number[] = [];
    const shownLayerIds: number[] = [];

    for (const layer of state.psd.layers) {
      if (layer.type === 'groupEnd') continue;
      const effectiveVisible = computeEffectiveVisibility(state.psd.layers, layer.id, state.visibilityOverrides);
      if (effectiveVisible && !layer.visible) {
        shownLayerIds.push(layer.id);
      } else if (!effectiveVisible && layer.visible) {
        hiddenLayerIds.push(layer.id);
      }
    }

    try {
      const composite = await qtRenderer.renderCompositeWithQt('main', hiddenLayerIds, shownLayerIds);
      set({ composite });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to render' });
    }
  },

  getEffectiveVisibility: (layerId) => {
    const state = get();
    if (!state.psd) return false;
    return computeEffectiveVisibility(state.psd.layers, layerId, state.visibilityOverrides);
  },

  getOwnVisibility: (layerId) => {
    const state = get();
    if (!state.psd) return false;
    const layer = state.psd.layers.find(l => l.id === layerId);
    if (!layer) return false;
    return state.visibilityOverrides.has(layerId) ? state.visibilityOverrides.get(layerId)! : layer.visible;
  },

  clear: () => {
    qtRenderer.release('main');
    set({
      psd: null,
      composite: null,
      error: null,
      fileName: null,
      visibilityOverrides: new Map(),
    });
  },

  setError: (error) => set({ error }),
}));
