// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { useCallback, useState, useRef } from 'react';
import { usePsdStore } from '../stores/psd-store';

const styles = {
  container: (isDragging: boolean, hasFile: boolean) => ({
    padding: '14px',
    border: `2px dashed ${isDragging ? '#4caf50' : hasFile ? '#555' : '#4caf50'}`,
    borderRadius: '8px',
    backgroundColor: isDragging ? 'rgba(76, 175, 80, 0.15)' : hasFile ? 'transparent' : 'rgba(76, 175, 80, 0.08)',
    cursor: 'pointer',
    transition: 'all 0.2s',
  }),
  label: (hasFile: boolean) => ({
    fontSize: '12px',
    fontWeight: 600,
    marginBottom: '4px',
    color: hasFile ? '#999' : '#4caf50',
  }),
  fileName: {
    fontSize: '14px',
    wordBreak: 'break-all' as const,
  },
  hint: {
    fontSize: '12px',
    opacity: 0.5,
  },
  info: {
    fontSize: '11px',
    opacity: 0.5,
    marginTop: '4px',
  },
};

export default function FileDropZone() {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const psd = usePsdStore(state => state.psd);
  const loading = usePsdStore(state => state.loading);
  const fileName = usePsdStore(state => state.fileName);
  const loadPsd = usePsdStore(state => state.loadPsd);

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.psd')) {
      usePsdStore.getState().setError('Please select a PSD file');
      return;
    }
    const buffer = await f.arrayBuffer();
    await loadPsd(buffer, f.name);
  }, [loadPsd]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  return (
    <div
      style={styles.container(isDragging, !!psd)}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".psd"
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />

      <div style={styles.label(!!psd)}>Open PSD</div>

      {loading ? (
        <div style={{ fontSize: '14px' }}>Loading...</div>
      ) : psd ? (
        <>
          <div style={styles.fileName}>{fileName}</div>
          <div style={styles.info}>
            {psd.width} x {psd.height} | {psd.layers.length} layers
          </div>
        </>
      ) : (
        <div style={styles.hint}>
          Drop PSD file or click to select
        </div>
      )}
    </div>
  );
}
