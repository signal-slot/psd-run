// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

export type LayerType = 'layer' | 'group' | 'groupEnd';
export type ItemType = 'text' | 'shape' | 'image' | 'folder' | 'unknown';

export type BlendMode =
  | 'passThrough' | 'normal' | 'dissolve'
  | 'darken' | 'multiply' | 'colorBurn' | 'linearBurn' | 'darkerColor'
  | 'lighten' | 'screen' | 'colorDodge' | 'linearDodge' | 'lighterColor'
  | 'overlay' | 'softLight' | 'hardLight' | 'vividLight' | 'linearLight' | 'pinLight' | 'hardMix'
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface LayerInfo {
  id: number;
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  type: LayerType;
  itemType?: ItemType;
  text?: string;
}

export interface PsdData {
  handle: number;
  width: number;
  height: number;
  layers: LayerInfo[];
}

export interface RenderedImage {
  width: number;
  height: number;
  x?: number;
  y?: number;
  data: Uint8ClampedArray | null;
}

export interface LayerTreeNode {
  layer: LayerInfo;
  children: LayerTreeNode[];
  expanded: boolean;
}

// AI interaction types — accept any string so AI can freely classify elements
export type InteractionType = string;

export interface InteractionElement {
  layerId: number;
  type: InteractionType;
  action?: string;
  target?: string;
  min?: number;
  max?: number;
  format?: string;
  name?: string;
  value?: string;
  persistent?: boolean;
  showOn?: string[];  // show this layer only on these screens
  targets?: Record<string, string>;  // for navigate_conditional: currentScreen → destScreen
  [key: string]: unknown;  // allow additional AI-defined fields
}

export interface InteractionConfig {
  elements: InteractionElement[];
  screens: string[];
  initialScreen: string;
}

// Chat message types
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;           // display text
  apiContent?: string;       // override for API history (e.g. full analysis prompt)
  timestamp: number;
}
