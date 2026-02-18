// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { useRef, useEffect, useState, useCallback } from 'react';
import { usePsdStore } from '../stores/psd-store';
import { useInteractionStore } from '../stores/interaction-store';
import type { InteractionElement } from '../lib/types';

// Element types that should get clickable overlays
const CLICKABLE_TYPES = new Set([
  'button', 'tap_area', 'input_digit', 'clear_input',
  'select_payment', 'toggle', 'input',
]);

export default function Preview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { psd, composite, getEffectiveVisibility } = usePsdStore();
  const {
    config, currentScreen, elementScreenMap, sliderValues,
    navigateToScreen, setSliderValue, executeAction,
  } = useInteractionStore();

  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track container size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Auto-fit when composite changes
  useEffect(() => {
    if (composite && containerSize.width > 0 && containerSize.height > 0) {
      const scaleX = containerSize.width / composite.width;
      const scaleY = containerSize.height / composite.height;
      const fitZoom = Math.min(scaleX, scaleY) * 0.9;
      setZoom(fitZoom);
      setPanX(0);
      setPanY(0);
    }
  }, [composite?.width, composite?.height, containerSize.width, containerSize.height]);

  // Render image to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !composite?.data) return;

    canvas.width = composite.width;
    canvas.height = composite.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataCopy = new Uint8ClampedArray(composite.data.length);
    dataCopy.set(composite.data);
    const imageData = new ImageData(dataCopy, composite.width, composite.height);
    ctx.putImageData(imageData, 0, 0);
  }, [composite]);

  // Pan handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - panX, y: e.clientY - panY });
    }
  }, [panX, panY]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isPanning) {
        setPanX(e.clientX - startPan.x);
        setPanY(e.clientY - startPan.y);
      }
    };
    const handleMouseUp = () => setIsPanning(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning, startPan]);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => z * delta);
  }, []);

  // Fit to view
  const handleFit = useCallback(() => {
    if (composite && containerSize.width > 0) {
      const scaleX = containerSize.width / composite.width;
      const scaleY = containerSize.height / composite.height;
      setZoom(Math.min(scaleX, scaleY) * 0.9);
      setPanX(0);
      setPanY(0);
    }
  }, [composite, containerSize]);

  // Reset zoom
  const handleReset = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  const imageWidth = composite ? composite.width * zoom : 0;
  const imageHeight = composite ? composite.height * zoom : 0;
  const imageLeft = (containerSize.width - imageWidth) / 2 + panX;
  const imageTop = (containerSize.height - imageHeight) / 2 + panY;

  // Collect interactive overlay elements for the CURRENT screen only
  const overlayElements = (composite && config) ? config.elements.filter(e => {
    if (e.type === 'screen' || e.type === 'conditional') return false;

    // Text elements rendered by WASM — no overlay needed
    if (e.type === 'display' || e.type === 'dynamic_text' || e.type === 'clock') return false;

    // Non-visual / container elements — no overlay needed
    if (e.type === 'highlight' || e.type === 'popup' || e.type === 'timer') return false;

    // showOn check: if element specifies showOn, only show on those screens
    if (Array.isArray(e.showOn) && currentScreen) {
      if (!e.showOn.includes(currentScreen)) return false;
    }

    // Screen membership check: if element belongs to a screen, only show on that screen
    const elemScreen = elementScreenMap.get(e.layerId);
    if (elemScreen && elemScreen !== currentScreen) return false;

    // Also check PSD layer visibility as a safety net
    return getEffectiveVisibility(e.layerId);
  }) : [];

  // Screen navigation buttons
  const screenElements = config?.elements.filter(e => e.type === 'screen') || [];

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      {composite && (
        <div style={{
          padding: '6px 12px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}>
          <button onClick={() => setZoom(z => z * 1.2)} style={toolbarBtn}>+</button>
          <button onClick={() => setZoom(z => z * 0.8)} style={toolbarBtn}>-</button>
          <button onClick={handleFit} style={toolbarBtn}>Fit</button>
          <button onClick={handleReset} style={toolbarBtn}>1:1</button>
          <span style={{ fontSize: '12px', opacity: 0.5, marginLeft: '8px' }}>
            {Math.round(zoom * 100)}%
          </span>
          {currentScreen && (
            <>
              <span style={{ fontSize: '12px', opacity: 0.5, marginLeft: 'auto' }}>
                Screen: {currentScreen}
              </span>
              {screenElements.length > 1 && screenElements.map(s => (
                <button
                  key={s.layerId}
                  onClick={() => navigateToScreen(s.name!)}
                  style={{
                    ...toolbarBtn,
                    backgroundColor: s.name === currentScreen ? '#4caf50' : '#333',
                    color: s.name === currentScreen ? '#fff' : '#e0e0e0',
                  }}
                >
                  {s.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Canvas area — always rendered so containerRef is measured */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          cursor: composite ? (isPanning ? 'grabbing' : 'grab') : 'default',
          backgroundColor: '#1a1a1a',
        }}
        onMouseDown={composite ? handleMouseDown : undefined}
        onWheel={composite ? handleWheel : undefined}
      >
        {!composite ? (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#666',
          }}>
            <div style={{ textAlign: 'center' }}>
              <svg width="64" height="64" viewBox="0 0 32 32" style={{ opacity: 0.3, marginBottom: '12px' }}>
                <rect x="2" y="4" width="28" height="24" rx="3" fill="#4caf50"/>
                <polygon points="13,10 13,22 23,16" fill="#fff"/>
              </svg>
              <div>Drop a PSD file to get started</div>
            </div>
          </div>
        ) : (
          <>
            {/* Checkerboard background for transparency */}
            <div style={{
              position: 'absolute',
              left: imageLeft,
              top: imageTop,
              width: imageWidth,
              height: imageHeight,
              backgroundImage: 'linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            }} />

            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                left: imageLeft,
                top: imageTop,
                width: imageWidth,
                height: imageHeight,
              }}
            />

            {/* Interaction overlays — clickable areas only, no text rendering */}
            {overlayElements.map((elem) => (
              <InteractionOverlay
                key={`${elem.layerId}-${elem.type}`}
                element={elem}
                psd={psd}
                zoom={zoom}
                imageLeft={imageLeft}
                imageTop={imageTop}
                sliderValues={sliderValues}
                onNavigate={navigateToScreen}
                onSliderChange={setSliderValue}
                onAction={executeAction}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const toolbarBtn: React.CSSProperties = {
  padding: '4px 10px',
  backgroundColor: '#333',
  color: '#e0e0e0',
  border: '1px solid #555',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
};

function InteractionOverlay({
  element,
  psd,
  zoom,
  imageLeft,
  imageTop,
  sliderValues,
  onNavigate,
  onSliderChange,
  onAction,
}: {
  element: InteractionElement;
  psd: { layers: { id: number; x: number; y: number; width: number; height: number }[] } | null;
  zoom: number;
  imageLeft: number;
  imageTop: number;
  sliderValues: Map<number, number>;
  onNavigate: (screen: string) => void;
  onSliderChange: (layerId: number, value: number) => void;
  onAction: (element: InteractionElement) => void;
}) {
  const layer = psd?.layers.find(l => l.id === element.layerId);
  if (!layer) return null;

  const left = imageLeft + layer.x * zoom;
  const top = imageTop + layer.y * zoom;
  const width = layer.width * zoom;
  const height = layer.height * zoom;

  // Clickable elements: buttons, tap areas, digit inputs, popup triggers, etc.
  if (CLICKABLE_TYPES.has(element.type) || element.action) {
    return (
      <div
        style={{
          position: 'absolute',
          left, top, width, height,
          cursor: 'pointer',
          zIndex: 10,
          border: '2px solid transparent',
          borderRadius: '4px',
          transition: 'border-color 0.2s, background-color 0.2s',
        }}
        onClick={(e) => {
          e.stopPropagation();
          // For simple navigate buttons, navigate directly
          if (element.action === 'navigate' && element.target) {
            onNavigate(element.target);
          } else {
            // Delegate to executeAction for other actions
            onAction(element);
          }
        }}
        onMouseDown={(e) => {
          e.stopPropagation(); // Prevent pan
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(76, 175, 80, 0.5)';
          e.currentTarget.style.backgroundColor = 'rgba(76, 175, 80, 0.08)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'transparent';
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
        title={formatTooltip(element)}
      />
    );
  }

  // Slider element
  if (element.type === 'slider') {
    const value = sliderValues.get(element.layerId) ?? (element.min ?? 0);
    return (
      <div
        style={{
          position: 'absolute',
          left, top, width, height,
          display: 'flex',
          alignItems: 'center',
          zIndex: 10,
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="range"
          min={element.min ?? 0}
          max={element.max ?? 100}
          value={value}
          onChange={(e) => onSliderChange(element.layerId, Number(e.target.value))}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>
    );
  }

  return null;
}

function formatTooltip(element: InteractionElement): string {
  const parts = [element.type];
  if (element.name) parts.push(`"${element.name}"`);
  if (element.action) parts.push(`-> ${element.action}`);
  if (element.target) parts.push(`(${element.target})`);
  if (element.value != null) parts.push(`[${element.value}]`);
  return parts.join(' ');
}
