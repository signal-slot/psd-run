// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import type { InteractionConfig, InteractionElement, LayerInfo } from '../lib/types';
import { usePsdStore } from './psd-store';
import { qtRenderer } from '../lib/qt-renderer';

// Find the nearest ancestor screen folder for a layer
// Layers are in pre-order: walk BACKWARD to find parent groups
function findAncestorScreen(
  layers: LayerInfo[],
  layerId: number,
  screenLayerIds: Set<number>
): number | null {
  const layerIndex = layers.findIndex(l => l.id === layerId);
  if (layerIndex === -1) return null;

  let depth = 0;
  for (let i = layerIndex - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.type === 'groupEnd') {
      depth++;
    } else if (layer.type === 'group') {
      if (depth === 0) {
        if (screenLayerIds.has(layer.id)) return layer.id;
        // keep walking — screen folder may be a higher ancestor
      } else {
        depth--;
      }
    }
  }
  return null;
}

interface InteractionState {
  config: InteractionConfig | null;
  currentScreen: string | null;
  elementScreenMap: Map<number, string>;  // layerId → screen name
  sliderValues: Map<number, number>;
  clockTimers: Map<number, number>;
  screenTimerIds: number[];  // active setTimeout IDs for screen timers
  activePopups: Set<string>;  // names of currently visible popups
  selectedHighlights: Map<string, string>;  // group → selected highlight name
  dynamicTexts: Map<number, string>;  // tracks current text values (for input logic)
}

interface InteractionActions {
  setConfig: (config: InteractionConfig) => void;
  navigateToScreen: (screenName: string) => void;
  setSliderValue: (layerId: number, value: number) => void;
  setDynamicText: (layerId: number, text: string) => void;
  startClocks: () => void;
  stopClocks: () => void;
  executeAction: (element: InteractionElement) => void;
  getElementsForCurrentScreen: () => InteractionElement[];
  clear: () => void;
}

export const useInteractionStore = create<InteractionState & InteractionActions>((set, get) => ({
  config: null,
  currentScreen: null,
  elementScreenMap: new Map(),
  sliderValues: new Map(),
  clockTimers: new Map(),
  screenTimerIds: [],
  activePopups: new Set(),
  selectedHighlights: new Map(),
  dynamicTexts: new Map(),

  setConfig: (config) => {
    // Stop existing clocks and screen timers
    get().stopClocks();
    stopScreenTimers(get().screenTimerIds);

    // Initialize display elements with their default value
    const initialTexts = new Map<number, string>();
    for (const elem of config.elements) {
      if (elem.type === 'display' || elem.type === 'dynamic_text') {
        initialTexts.set(elem.layerId, elem.value ?? '--');
      }
    }

    // Build element → screen mapping from PSD layer hierarchy
    const psdState = usePsdStore.getState();
    const layers = psdState.psd?.layers || [];
    const screenElements = config.elements.filter(e => e.type === 'screen');
    const screenLayerIds = new Set(screenElements.map(e => e.layerId));
    const screenNameById = new Map(screenElements.map(e => [e.layerId, e.name!] as const));

    const elementScreenMap = new Map<number, string>();
    for (const elem of config.elements) {
      if (elem.type === 'screen') continue;
      const screenId = findAncestorScreen(layers, elem.layerId, screenLayerIds);
      if (screenId !== null) {
        elementScreenMap.set(elem.layerId, screenNameById.get(screenId)!);
      }
    }

    console.log('[interaction] setConfig:', {
      screens: config.screens,
      initialScreen: config.initialScreen,
      elementCount: config.elements.length,
      types: [...new Set(config.elements.map(e => e.type))],
      screenMap: Object.fromEntries(elementScreenMap),
    });

    set({
      config,
      currentScreen: config.initialScreen,
      elementScreenMap,
      sliderValues: new Map(),
      activePopups: new Set(),
      selectedHighlights: new Map(),
      dynamicTexts: initialTexts,
    });

    // Initialize PSD text layers via WASM, then apply screen visibility + recomposite
    (async () => {
      for (const elem of config.elements) {
        if (elem.type === 'display' || elem.type === 'dynamic_text') {
          try {
            await qtRenderer.setLayerText('main', elem.layerId, elem.value ?? '--');
          } catch (e) {
            console.warn('[interaction] Failed to set text for layer', elem.layerId, e);
          }
        }
      }
      applyScreenVisibility(config, config.initialScreen, new Set(), new Map());
    })();

    // Start clocks if any
    const clockElements = config.elements.filter(e => e.type === 'clock');
    if (clockElements.length > 0) {
      setTimeout(() => get().startClocks(), 100);
    }

    // Start screen timers for initial screen
    set({ screenTimerIds: startScreenTimers(config, config.initialScreen, get().navigateToScreen) });
  },

  navigateToScreen: (screenName) => {
    const { config } = get();
    if (!config) return;

    console.log('[interaction] navigateToScreen:', screenName);

    // Cancel previous screen timers
    stopScreenTimers(get().screenTimerIds);

    // Clear popups on navigation, keep highlights
    set({ currentScreen: screenName, activePopups: new Set() });
    applyScreenVisibility(config, screenName, new Set(), get().selectedHighlights);

    // Start timers that trigger on this screen
    set({ screenTimerIds: startScreenTimers(config, screenName, get().navigateToScreen) });
  },

  setSliderValue: (layerId, value) => {
    const newValues = new Map(get().sliderValues);
    newValues.set(layerId, value);
    set({ sliderValues: newValues });
  },

  setDynamicText: (layerId, text) => {
    const newTexts = new Map(get().dynamicTexts);
    newTexts.set(layerId, text);
    set({ dynamicTexts: newTexts });
  },

  startClocks: () => {
    const { config } = get();
    if (!config) return;

    const clockElements = config.elements.filter(e => e.type === 'clock');
    const newTimers = new Map<number, number>();

    for (const elem of clockElements) {
      const timerId = window.setInterval(() => {
        const now = new Date();
        const format = elem.format || 'HH:mm:ss';
        const timeStr = formatTime(now, format);

        // Update tracking state
        const newTexts = new Map(get().dynamicTexts);
        newTexts.set(elem.layerId, timeStr);
        set({ dynamicTexts: newTexts });

        // Update PSD text layer + recomposite
        qtRenderer.setLayerText('main', elem.layerId, timeStr).then(() => {
          usePsdStore.getState().recomposite();
        }).catch(e => console.warn('[interaction] Clock setLayerText failed:', e));
      }, 1000);
      newTimers.set(elem.layerId, timerId);
    }

    set({ clockTimers: newTimers });
  },

  stopClocks: () => {
    const { clockTimers } = get();
    for (const [, timerId] of clockTimers) {
      window.clearInterval(timerId);
    }
    set({ clockTimers: new Map() });
  },

  executeAction: (element) => {
    const { navigateToScreen, setDynamicText, dynamicTexts, config } = get();

    console.log('[interaction] executeAction:', element.type, element.action, element.value, element.target);

    if (element.action === 'navigate' && element.target) {
      navigateToScreen(element.target);
      return;
    }

    // navigate_conditional: navigate to different screens based on current screen
    // targets: { "screenA": "screenB", "screenC": "screenD" }
    if (element.action === 'navigate_conditional' && element.targets) {
      const currentScreen = get().currentScreen;
      if (!currentScreen) return;
      const dest = (element.targets as Record<string, string>)[currentScreen];
      if (dest) {
        navigateToScreen(dest);
      }
      return;
    }

    if (element.action === 'input_digit' && element.value != null) {
      if (!config) return;

      // target can be comma-separated list of display names (one per digit position)
      const targetNames = (element.target || '').split(',').map(s => s.trim()).filter(Boolean);
      const displayElems = targetNames
        .map(name => config.elements.find(e =>
          (e.type === 'display' || e.type === 'dynamic_text') && e.name === name
        ))
        .filter((e): e is InteractionElement => e !== undefined);

      if (displayElems.length === 0) return;

      const digit = String(element.value);
      const emptyValue = '-';

      // Digit input: -- → -1 → 12 (new digit goes to rightmost, existing shift left)
      if (displayElems.length === 1) {
        // Single display: 2-char string logic
        const displayElem = displayElems[0];
        const current = dynamicTexts.get(displayElem.layerId) || '--';
        const d1 = current.charAt(0);  // left
        const d2 = current.charAt(1);  // right

        let next: string;
        if (d1 === emptyValue && d2 === emptyValue) {
          // [--] + digit → [-d]
          next = emptyValue + digit;
        } else if (d1 === emptyValue && d2 !== emptyValue) {
          // [-X] + digit → [Xd] (X shifts left, new digit goes right)
          next = d2 + digit;
        } else {
          // [XY] full → no change
          next = current;
        }

        setDynamicText(displayElem.layerId, next);
        qtRenderer.setLayerText('main', displayElem.layerId, next).then(() => {
          usePsdStore.getState().recomposite();
        }).catch(e => console.warn('[interaction] Failed to update text layer:', e));
      } else {
        // Multiple displays: each holds one character, ordered left → right
        // Check if all positions are filled
        const allFilled = displayElems.every(d => {
          const t = dynamicTexts.get(d.layerId) || emptyValue;
          return t !== emptyValue;
        });
        if (allFilled) return;

        // Read current values BEFORE any mutation (captured dynamicTexts is pre-update)
        const currentValues = displayElems.map(d => dynamicTexts.get(d.layerId) || emptyValue);

        // Shift existing values left, new digit goes to rightmost position
        // [-, -] + 1 → [-, 1]
        // [-, 1] + 2 → [1, 2]
        for (let i = 0; i < displayElems.length - 1; i++) {
          setDynamicText(displayElems[i].layerId, currentValues[i + 1]);
        }
        setDynamicText(displayElems[displayElems.length - 1].layerId, digit);

        // Update all PSD text layers via WASM + single recomposite
        (async () => {
          const state = get();
          for (const d of displayElems) {
            const text = state.dynamicTexts.get(d.layerId) || emptyValue;
            try {
              await qtRenderer.setLayerText('main', d.layerId, text);
            } catch (e) {
              console.warn('[interaction] Failed to update text layer:', d.layerId, e);
            }
          }
          usePsdStore.getState().recomposite();
        })();
      }
      return;
    }

    // show_highlight: radio-button style selection within a group
    // toggle_highlight: toggle on/off (same target toggles off, different target switches)
    if ((element.action === 'show_highlight' || element.action === 'toggle_highlight') && element.target) {
      if (!config) return;

      const targetElem = config.elements.find(e => e.type === 'highlight' && e.name === element.target);
      if (!targetElem) return;

      const group = targetElem.group as string;
      if (!group) return;

      const currentSelected = get().selectedHighlights.get(group);
      const isToggleOff = element.action === 'toggle_highlight' && currentSelected === element.target;

      const groupHighlights = config.elements.filter(
        e => e.type === 'highlight' && (e.group as string) === group
      );

      const overrides = new Map<number, boolean>();
      for (const h of groupHighlights) {
        overrides.set(h.layerId, isToggleOff ? false : h.name === element.target);
      }

      const newSelected = new Map(get().selectedHighlights);
      if (isToggleOff) {
        newSelected.delete(group);
      } else {
        newSelected.set(group, element.target);
      }
      set({ selectedHighlights: newSelected });

      usePsdStore.getState().setMultipleVisibility(overrides);
      return;
    }

    // show_popup: show a popup layer/group
    if (element.action === 'show_popup' && element.target) {
      if (!config) return;

      const popupElem = config.elements.find(e => e.type === 'popup' && e.name === element.target);
      if (!popupElem) return;

      const overrides = new Map<number, boolean>();
      overrides.set(popupElem.layerId, true);

      const newPopups = new Set(get().activePopups);
      newPopups.add(element.target);
      set({ activePopups: newPopups });

      usePsdStore.getState().setMultipleVisibility(overrides);
      return;
    }

    // hide_popup / navigate_from_popup: dismiss popup, optionally navigate
    if (element.action === 'hide_popup' || element.action === 'navigate_from_popup') {
      set({ activePopups: new Set() });

      if (element.target) {
        // navigateToScreen calls applyScreenVisibility which hides all popups
        navigateToScreen(element.target);
      } else if (config) {
        // Re-apply current screen visibility with empty popups
        const currentScreen = get().currentScreen;
        if (currentScreen) {
          applyScreenVisibility(config, currentScreen, new Set(), get().selectedHighlights);
        }
      }
      return;
    }

    if (element.action === 'clear_input') {
      if (!config) return;

      const targetNames = (element.target || '').split(',').map(s => s.trim()).filter(Boolean);
      const displayElems = targetNames
        .map(name => config.elements.find(e =>
          (e.type === 'display' || e.type === 'dynamic_text') && e.name === name
        ))
        .filter((e): e is InteractionElement => e !== undefined);

      if (displayElems.length === 0) return;

      for (const d of displayElems) {
        setDynamicText(d.layerId, d.value ?? '-');
      }

      (async () => {
        for (const d of displayElems) {
          try {
            await qtRenderer.setLayerText('main', d.layerId, d.value ?? '-');
          } catch (e) {
            console.warn('[interaction] Failed to clear text layer:', d.layerId, e);
          }
        }
        usePsdStore.getState().recomposite();
      })();
      return;
    }
  },

  getElementsForCurrentScreen: () => {
    const { config, currentScreen } = get();
    if (!config || !currentScreen) return [];
    return config.elements;
  },

  clear: () => {
    get().stopClocks();
    stopScreenTimers(get().screenTimerIds);
    set({
      config: null,
      currentScreen: null,
      elementScreenMap: new Map(),
      sliderValues: new Map(),
      clockTimers: new Map(),
      screenTimerIds: [],
      activePopups: new Set(),
      selectedHighlights: new Map(),
      dynamicTexts: new Map(),
    });
  },
}));

// Apply screen visibility by batching all folder show/hide at once
function applyScreenVisibility(
  config: InteractionConfig,
  screenName: string,
  activePopups: Set<string>,
  selectedHighlights: Map<string, string>
) {
  const psdStore = usePsdStore.getState();
  if (!psdStore.psd) return;

  const overrides = new Map<number, boolean>();

  // 1. Screen folders: show only the active one
  const screenElements = config.elements.filter(e => e.type === 'screen');
  for (const screen of screenElements) {
    const layer = psdStore.psd.layers.find(l => l.id === screen.layerId);
    if (!layer) continue;
    overrides.set(screen.layerId, screen.name === screenName);
  }

  // 2. Elements with showOn: show only on listed screens
  const conditionalElements = config.elements.filter(e => Array.isArray(e.showOn));
  for (const elem of conditionalElements) {
    const layer = psdStore.psd.layers.find(l => l.id === elem.layerId);
    if (!layer) continue;
    overrides.set(elem.layerId, elem.showOn!.includes(screenName));
  }

  // 3. Highlights: show only the selected one per group, hide all others
  for (const elem of config.elements) {
    if (elem.type !== 'highlight') continue;
    const group = elem.group as string | undefined;
    const selectedName = group ? selectedHighlights.get(group) : undefined;
    overrides.set(elem.layerId, elem.name === selectedName);
  }

  // 4. Popups: show only active ones
  for (const elem of config.elements) {
    if (elem.type !== 'popup') continue;
    overrides.set(elem.layerId, activePopups.has(elem.name!));
  }

  // Single batch update + single recomposite
  psdStore.setMultipleVisibility(overrides);
}

// Screen timer helpers — start/stop timers that fire on specific screens
function startScreenTimers(
  config: InteractionConfig,
  screenName: string,
  navigateToScreen: (name: string) => void
): number[] {
  const timerElements = config.elements.filter(e => e.type === 'timer');
  const ids: number[] = [];

  for (const elem of timerElements) {
    const triggerOn = elem.triggerOn as string[] | undefined;
    if (!Array.isArray(triggerOn) || !triggerOn.includes(screenName)) continue;

    const delay = (typeof elem.delay === 'number' ? elem.delay : 5) * 1000;

    console.log('[interaction] startScreenTimer:', elem.action, elem.target, `${delay}ms on`, screenName);

    const id = window.setTimeout(() => {
      if (elem.action === 'navigate' && elem.target) {
        navigateToScreen(elem.target);
      }
    }, delay);
    ids.push(id);
  }

  return ids;
}

function stopScreenTimers(ids: number[]): void {
  for (const id of ids) {
    window.clearTimeout(id);
  }
}

// Format time string
function formatTime(date: Date, format: string): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return format.replace('HH', h).replace('mm', m).replace('ss', s);
}
