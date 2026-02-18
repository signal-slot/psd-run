// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback } from 'react';
import { usePsdStore } from '../stores/psd-store';
import type { LayerInfo, LayerTreeNode } from '../lib/types';

// Build nested tree from flat layer list
function buildLayerTree(layers: LayerInfo[]): LayerTreeNode[] {
  const tree: LayerTreeNode[] = [];
  const stack: LayerTreeNode[][] = [tree];

  // PSD layers are stored bottom-to-top; groups end with groupEnd markers
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];

    if (layer.type === 'groupEnd') {
      // Start a new group level
      stack.push([]);
    } else if (layer.type === 'group') {
      // Close the current group
      const children = stack.pop() || [];
      const node: LayerTreeNode = { layer, children, expanded: true };
      const parent = stack[stack.length - 1];
      parent.push(node);
    } else {
      // Regular layer
      const node: LayerTreeNode = { layer, children: [], expanded: false };
      const parent = stack[stack.length - 1];
      parent.push(node);
    }
  }

  return tree;
}

function filterTree(nodes: LayerTreeNode[], query: string): LayerTreeNode[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();

  return nodes.reduce<LayerTreeNode[]>((acc, node) => {
    const nameMatch = node.layer.name.toLowerCase().includes(lower);
    const filteredChildren = filterTree(node.children, query);

    if (nameMatch || filteredChildren.length > 0) {
      acc.push({ ...node, children: filteredChildren, expanded: filteredChildren.length > 0 });
    }
    return acc;
  }, []);
}

const styles = {
  container: {
    flex: 1,
    overflow: 'auto',
    fontSize: '13px',
  },
  search: {
    padding: '8px 12px',
    borderBottom: '1px solid #333',
  },
  searchInput: {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid #444',
    borderRadius: '4px',
    backgroundColor: '#2a2a2a',
    color: '#e0e0e0',
    fontSize: '13px',
    outline: 'none',
  },
  tree: {
    padding: '4px 0',
  },
  node: (depth: number, selected: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    padding: '3px 8px',
    paddingLeft: `${8 + depth * 16}px`,
    cursor: 'pointer',
    backgroundColor: selected ? 'rgba(76, 175, 80, 0.2)' : 'transparent',
  }),
  toggle: {
    width: '16px',
    height: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '4px',
    opacity: 0.5,
    fontSize: '10px',
  },
  icon: {
    marginRight: '6px',
    opacity: 0.5,
    fontSize: '12px',
  },
  name: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  visibility: (visible: boolean) => ({
    marginLeft: '4px',
    padding: '1px 4px',
    fontSize: '12px',
    borderRadius: '3px',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: visible ? '#4fc3f7' : '#666',
    cursor: 'pointer',
  }),
};

const iconMap: Record<string, string> = {
  text: 'T',
  shape: '#',
  image: 'I',
  folder: 'F',
  unknown: '?',
};

function LayerNodeComponent({
  node,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpand,
}: {
  node: LayerTreeNode;
  depth: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  expandedIds: Set<number>;
  onToggleExpand: (id: number) => void;
}) {
  const { toggleLayerVisibility, getOwnVisibility, getEffectiveVisibility } = usePsdStore();
  const isGroup = node.layer.type === 'group';
  const isExpanded = expandedIds.has(node.layer.id);
  const isSelected = selectedId === node.layer.id;
  const ownVisible = getOwnVisibility(node.layer.id);
  const effectiveVisible = getEffectiveVisibility(node.layer.id);
  const inheritedHidden = ownVisible && !effectiveVisible;

  const handleClick = () => onSelect(node.layer.id);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(node.layer.id);
  };

  const handleVisibilityToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleLayerVisibility(node.layer.id);
  };

  const itemIcon = iconMap[node.layer.itemType || 'unknown'] || (isGroup ? 'F' : 'L');

  return (
    <>
      <div style={styles.node(depth, isSelected)} onClick={handleClick}>
        {isGroup ? (
          <span style={styles.toggle} onClick={handleToggle}>
            {isExpanded ? '\u25BC' : '\u25B6'}
          </span>
        ) : (
          <span style={styles.toggle} />
        )}

        <span style={styles.icon}>{itemIcon}</span>

        <span style={styles.name} title={node.layer.name}>
          {node.layer.name || '(unnamed)'}
        </span>

        <span
          style={{ ...styles.visibility(ownVisible), opacity: inheritedHidden ? 0.35 : 1 }}
          onClick={handleVisibilityToggle}
          title={inheritedHidden ? 'Visible (parent hidden)' : ownVisible ? 'Hide layer' : 'Show layer'}
        >
          {ownVisible ? '\u25C9' : '\u25CB'}
        </span>
      </div>

      {isGroup && isExpanded && node.children.map((child, i) => (
        <LayerNodeComponent
          key={child.layer.id || i}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </>
  );
}

export default function LayerTree() {
  const { psd } = usePsdStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const tree = useMemo(() => {
    if (!psd) return [];
    const built = buildLayerTree(psd.layers);
    // Auto-expand all groups initially
    const allGroupIds = new Set<number>();
    const collectGroups = (nodes: LayerTreeNode[]) => {
      for (const n of nodes) {
        if (n.layer.type === 'group') allGroupIds.add(n.layer.id);
        collectGroups(n.children);
      }
    };
    collectGroups(built);
    if (expandedIds.size === 0 && allGroupIds.size > 0) {
      setExpandedIds(allGroupIds);
    }
    return built;
  }, [psd, expandedIds.size]);

  const filteredTree = useMemo(() => filterTree(tree, searchQuery), [tree, searchQuery]);

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.search}>
        <input
          type="text"
          placeholder="Search layers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      <div style={styles.tree}>
        {filteredTree.length > 0 ? (
          filteredTree.map((node, i) => (
            <LayerNodeComponent
              key={node.layer.id || i}
              node={node}
              depth={0}
              selectedId={selectedId}
              onSelect={setSelectedId}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
            />
          ))
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5 }}>
            No layers match
          </div>
        )}
      </div>
    </div>
  );
}
