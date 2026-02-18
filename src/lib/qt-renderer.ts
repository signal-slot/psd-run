// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT
//
// Qt Renderer - Main thread WASM module for full Qt rendering with hints support

import type { RenderedImage, LayerInfo } from './types';

interface PsdRunModule {
  allocateBuffer(size: number): void;
  getBufferView(): Uint8Array;
  parsePsd(dataSize: number): {
    handle?: number;
    width?: number;
    height?: number;
    layers?: LayerInfo[];
    error?: string;
  };
  renderCompositeWithQt(handle: number, hiddenLayerIds: number[], shownLayerIds: number[]): {
    width?: number;
    height?: number;
    data?: Uint8ClampedArray;
    error?: string;
  };
  getLayerImage(handle: number, layerId: number): {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    data?: Uint8ClampedArray;
    error?: string;
  };
  exportLayerJson(handle: number): {
    json?: string;
    error?: string;
  };
  getHintsJson(handle: number): {
    json?: string;
    error?: string;
  };
  setHintsJson(handle: number, json: string): {
    restored?: number;
    error?: string;
  };
  setLayerText(handle: number, layerId: number, text: string): {
    ok?: boolean;
    error?: string;
  };
  releaseParser(handle: number): void;
  allocateFontBuffer(size: number): void;
  getFontBufferView(): Uint8Array;
  registerFont(dataSize: number, filename: string): {
    fontId?: number;
    families?: string[];
    error?: string;
  };
  getRegisteredFonts(): string[];
}

class QtRenderer {
  private module: PsdRunModule | null = null;
  private initPromise: Promise<void> | null = null;
  private parserHandles: Map<string, number> = new Map();
  private psdDataCache: Map<string, ArrayBuffer> = new Map();

  async initialize(): Promise<void> {
    if (this.module) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.loadModule();
    return this.initPromise;
  }

  private async loadModule(): Promise<void> {
    try {
      const cacheBuster = Date.now();
      const response = await fetch(`/wasm/psdrun_qt.js?v=${cacheBuster}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM module: ${response.status}`);
      }

      const scriptText = await response.text();
      const scriptFunc = new Function(scriptText + '\nreturn psdrun_qt_entry;');
      const factory = scriptFunc() as (options?: Record<string, unknown>) => Promise<PsdRunModule>;

      this.module = await factory({
        locateFile: (path: string) => `/wasm/${path}?v=${cacheBuster}`
      });

      console.log('[QtRenderer] Module initialized');
      await this.loadDefaultFonts();
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  private async loadDefaultFonts(): Promise<void> {
    // Direct URLs to OTF files from Noto CJK GitHub repository
    const fonts = [
      { url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf', filename: 'NotoSansCJKjp-Regular.otf' },
    ];

    // Fetch in parallel, register serially (shared WASM buffer)
    const fetched = await Promise.all(fonts.map(async ({ url, filename }) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) { console.warn(`[QtRenderer] Failed to fetch ${filename}: ${resp.status}`); return null; }
        return { data: await resp.arrayBuffer(), filename };
      } catch (e) {
        console.warn(`[QtRenderer] Failed to load ${filename}:`, e);
        return null;
      }
    }));
    for (const entry of fetched) {
      if (!entry) continue;
      const bytes = new Uint8Array(entry.data);
      this.module!.allocateFontBuffer(bytes.length);
      this.module!.getFontBufferView().set(bytes);
      const result = this.module!.registerFont(bytes.length, entry.filename);
      if (result.error) { console.warn(`[QtRenderer] ${entry.filename}: ${result.error}`); continue; }
      console.log(`[QtRenderer] Registered ${entry.filename}: ${result.families?.join(', ')}`);
    }
  }

  isReady(): boolean {
    return this.module !== null;
  }

  cachePsdData(file: string, data: ArrayBuffer): void {
    const existingHandle = this.parserHandles.get(file);
    if (existingHandle !== undefined && this.module) {
      this.module.releaseParser(existingHandle);
      this.parserHandles.delete(file);
    }
    this.psdDataCache.set(file, data);
  }

  async parsePsd(file: string): Promise<{ handle: number; layers: LayerInfo[]; width: number; height: number }> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    const data = this.psdDataCache.get(file);
    if (!data) throw new Error(`No PSD data cached for file ${file}`);

    const existingHandle = this.parserHandles.get(file);
    if (existingHandle !== undefined) {
      this.module.releaseParser(existingHandle);
      this.parserHandles.delete(file);
    }

    const bytes = new Uint8Array(data);
    this.module.allocateBuffer(bytes.length);
    const bufferView = this.module.getBufferView();
    bufferView.set(bytes);

    const result = this.module.parsePsd(bytes.length);
    if (result.error) throw new Error(`Failed to parse PSD: ${result.error}`);
    if (!result.handle) throw new Error('No handle returned');

    this.parserHandles.set(file, result.handle);

    return {
      handle: result.handle,
      layers: result.layers || [],
      width: result.width || 0,
      height: result.height || 0
    };
  }

  async renderCompositeWithQt(
    file: string,
    hiddenLayerIds: number[],
    shownLayerIds: number[]
  ): Promise<RenderedImage> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    let handle = this.parserHandles.get(file);
    if (handle === undefined) {
      const parsed = await this.parsePsd(file);
      handle = parsed.handle;
    }

    const result = this.module.renderCompositeWithQt(handle, hiddenLayerIds, shownLayerIds);
    if (result.error) throw new Error(`Render failed: ${result.error}`);
    if (!result.data) throw new Error('No render data');

    return {
      width: result.width!,
      height: result.height!,
      data: result.data
    };
  }

  async getLayerImage(file: string, layerId: number): Promise<RenderedImage> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    let handle = this.parserHandles.get(file);
    if (handle === undefined) {
      const parsed = await this.parsePsd(file);
      handle = parsed.handle;
    }

    const result = this.module.getLayerImage(handle, layerId);
    if (result.error) throw new Error(`getLayerImage failed: ${result.error}`);
    if (!result.data) throw new Error('No image data');

    return {
      width: result.width!,
      height: result.height!,
      x: result.x,
      y: result.y,
      data: result.data
    };
  }

  async exportLayerJson(file: string): Promise<string> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    let handle = this.parserHandles.get(file);
    if (handle === undefined) {
      const parsed = await this.parsePsd(file);
      handle = parsed.handle;
    }

    const result = this.module.exportLayerJson(handle);
    if (result.error) throw new Error(`exportLayerJson failed: ${result.error}`);
    return result.json || '{}';
  }

  async getHintsJson(file: string): Promise<string> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    const handle = this.parserHandles.get(file);
    if (handle === undefined) throw new Error(`No parser for file ${file}`);

    const result = this.module.getHintsJson(handle);
    if (result.error) throw new Error(`getHintsJson failed: ${result.error}`);
    return result.json || '{}';
  }

  async setHintsJson(file: string, json: string): Promise<number> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    const handle = this.parserHandles.get(file);
    if (handle === undefined) throw new Error(`No parser for file ${file}`);

    const result = this.module.setHintsJson(handle, json);
    if (result.error) throw new Error(`setHintsJson failed: ${result.error}`);
    return result.restored || 0;
  }

  async setLayerText(file: string, layerId: number, text: string): Promise<void> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    const handle = this.parserHandles.get(file);
    if (handle === undefined) throw new Error(`No parser for file ${file}`);

    const result = this.module.setLayerText(handle, layerId, text);
    if (result.error) throw new Error(`setLayerText failed: ${result.error}`);
  }

  async registerFont(data: ArrayBuffer, filename: string): Promise<{ fontId: number; families: string[] }> {
    await this.initialize();
    if (!this.module) throw new Error('Module not initialized');

    const bytes = new Uint8Array(data);
    this.module.allocateFontBuffer(bytes.length);
    const bufferView = this.module.getFontBufferView();
    bufferView.set(bytes);

    const result = this.module.registerFont(bytes.length, filename);
    if (result.error) throw new Error(`Font registration failed: ${result.error}`);

    return { fontId: result.fontId!, families: result.families || [] };
  }

  getRegisteredFonts(): string[] {
    if (!this.module) return [];
    return this.module.getRegisteredFonts();
  }

  release(file: string): void {
    if (!this.module) return;
    const handle = this.parserHandles.get(file);
    if (handle !== undefined) {
      this.module.releaseParser(handle);
      this.parserHandles.delete(file);
    }
    this.psdDataCache.delete(file);
  }

  invalidateForFonts(): void {
    if (!this.module) return;
    for (const [, handle] of this.parserHandles) {
      this.module.releaseParser(handle);
    }
    this.parserHandles.clear();
  }
}

export const qtRenderer = new QtRenderer();
