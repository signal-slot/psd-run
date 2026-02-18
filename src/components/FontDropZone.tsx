// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { useCallback, useState, useRef, useEffect } from 'react';
import { qtRenderer } from '../lib/qt-renderer';
import { usePsdStore } from '../stores/psd-store';

const styles = {
  container: (isDragging: boolean) => ({
    padding: '10px',
    border: `2px dashed ${isDragging ? '#64b5f6' : '#444'}`,
    borderRadius: '8px',
    backgroundColor: isDragging ? 'rgba(100, 181, 246, 0.15)' : 'transparent',
    cursor: 'pointer',
    transition: 'all 0.2s',
  }),
  label: {
    fontSize: '12px',
    fontWeight: 600 as const,
    color: '#999',
    marginBottom: '4px',
  },
  hint: {
    fontSize: '11px',
    opacity: 0.5,
  },
  fontList: {
    fontSize: '11px',
    opacity: 0.7,
    marginTop: '4px',
    maxHeight: '60px',
    overflow: 'auto' as const,
  },
};

export default function FontDropZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [families, setFamilies] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Show fonts already registered (e.g. defaults loaded by QtRenderer)
  useEffect(() => {
    if (qtRenderer.isReady()) {
      const registered = qtRenderer.getRegisteredFonts();
      if (registered.length > 0) setFamilies(registered);
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList) => {
    setLoading(true);
    const newFamilies: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.ttf') && !lower.endsWith('.otf')) continue;

      try {
        const buffer = await file.arrayBuffer();
        const result = await qtRenderer.registerFont(buffer, file.name);
        newFamilies.push(...result.families);
      } catch (e) {
        console.error('Font registration failed:', e);
      }
    }

    if (newFamilies.length > 0) {
      setFamilies(prev => [...prev, ...newFamilies]);
      // Invalidate cached parsers and re-render
      qtRenderer.invalidateForFonts();
      const { psd, recomposite } = usePsdStore.getState();
      if (psd) {
        await recomposite();
      }
    }
    setLoading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleClick = useCallback(() => inputRef.current?.click(), []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
  }, [handleFiles]);

  return (
    <div
      style={styles.container(isDragging)}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf"
        multiple
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />

      <div style={styles.label}>Fonts</div>

      {loading ? (
        <div style={{ fontSize: '11px' }}>Loading fonts...</div>
      ) : families.length > 0 ? (
        <div style={styles.fontList}>
          {families.map((f, i) => (
            <div key={i}>{f}</div>
          ))}
        </div>
      ) : (
        <div style={styles.hint}>
          Drop .ttf / .otf files for Japanese text
        </div>
      )}
    </div>
  );
}
