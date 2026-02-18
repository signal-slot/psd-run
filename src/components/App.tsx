// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { usePsdStore } from '../stores/psd-store';
import FileDropZone from './FileDropZone';
import FontDropZone from './FontDropZone';
import LayerTree from './LayerTree';
import Preview from './Preview';
import AiChat from './AiChat';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    backgroundColor: '#1a1a1a',
    color: '#e0e0e0',
  },
  header: {
    padding: '10px 20px',
    borderBottom: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: '280px',
    borderRight: '1px solid #333',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    flexShrink: 0,
  },
  dropZone: {
    padding: '12px',
    borderBottom: '1px solid #333',
  },
  layerSection: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  preview: {
    flex: 1,
    overflow: 'hidden',
  },
  chatPanel: {
    width: '360px',
    borderLeft: '1px solid #333',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    flexShrink: 0,
  },
  error: {
    padding: '8px 12px',
    backgroundColor: '#ff4444',
    color: 'white',
    fontSize: '14px',
  },
};

export default function App() {
  const { psd, error } = usePsdStore();

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <span style={styles.title}>
          <svg width="24" height="24" viewBox="0 0 32 32">
            <rect x="2" y="4" width="28" height="24" rx="3" fill="#4caf50" opacity="0.9"/>
            <polygon points="13,10 13,22 23,16" fill="#fff"/>
          </svg>
          PSD Run
        </span>
        <span style={{ fontSize: '12px', opacity: 0.6 }}>
          <a href="https://signal-slot.co.jp" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
            &copy; Signal Slot Inc.
          </a>
        </span>
      </header>

      {error && <div style={styles.error}>{error}</div>}

      <main style={styles.main}>
        {/* Left: Layer Tree */}
        <aside style={styles.sidebar}>
          <div style={styles.dropZone}>
            <FileDropZone />
          </div>
          <div style={styles.dropZone}>
            <FontDropZone />
          </div>
          <div style={styles.layerSection}>
            {psd ? (
              <LayerTree />
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5 }}>
                Load a PSD file to view layers
              </div>
            )}
          </div>
        </aside>

        {/* Center: Interactive Preview */}
        <section style={styles.preview}>
          <Preview />
        </section>

        {/* Right: AI Chat */}
        <aside style={styles.chatPanel}>
          <AiChat />
        </aside>
      </main>
    </div>
  );
}
