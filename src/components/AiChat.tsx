// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useChatStore } from '../stores/chat-store';
import { useInteractionStore } from '../stores/interaction-store';
import { usePsdStore } from '../stores/psd-store';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    fontSize: '13px',
  },
  header: {
    padding: '10px 12px',
    borderBottom: '1px solid #333',
    fontWeight: 600,
    fontSize: '14px',
  },
  apiKeySection: {
    padding: '8px 12px',
    borderBottom: '1px solid #333',
  },
  apiKeyInput: {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid #444',
    borderRadius: '4px',
    backgroundColor: '#2a2a2a',
    color: '#e0e0e0',
    fontSize: '12px',
    outline: 'none',
  },
  messagesArea: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 12px',
  },
  message: (isUser: boolean) => ({
    marginBottom: '12px',
    padding: '8px 10px',
    borderRadius: '8px',
    backgroundColor: isUser ? 'rgba(76, 175, 80, 0.15)' : '#2a2a2a',
    maxWidth: '100%',
    wordBreak: 'break-word' as const,
    fontSize: '13px',
    lineHeight: '1.5',
  }),
  roleLabel: (isUser: boolean) => ({
    fontSize: '11px',
    fontWeight: 600,
    color: isUser ? '#4caf50' : '#64b5f6',
    marginBottom: '4px',
  }),
  inputArea: {
    padding: '8px 12px',
    borderTop: '1px solid #333',
    display: 'flex',
    gap: '8px',
  },
  textInput: {
    flex: 1,
    padding: '8px 10px',
    border: '1px solid #444',
    borderRadius: '4px',
    backgroundColor: '#2a2a2a',
    color: '#e0e0e0',
    fontSize: '13px',
    outline: 'none',
    resize: 'none' as const,
  },
  sendBtn: (disabled: boolean) => ({
    padding: '8px 16px',
    backgroundColor: disabled ? '#333' : '#4caf50',
    color: disabled ? '#666' : 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '14px',
    fontWeight: 600,
  }),
  analyzeBtn: (disabled: boolean) => ({
    padding: '6px 12px',
    backgroundColor: disabled ? '#333' : '#2196f3',
    color: disabled ? '#666' : 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '12px',
    width: '100%',
  }),
};

export default function AiChat() {
  const { messages, apiKey, sending, interactionConfig, suggestedReply, setApiKey, sendUserMessage, analyzeCurrentPsd, clearMessages } = useChatStore();
  const { setConfig } = useInteractionStore();
  const { psd } = usePsdStore();
  const [input, setInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Apply interaction config when detected
  useEffect(() => {
    if (interactionConfig) {
      setConfig(interactionConfig);
    }
  }, [interactionConfig, setConfig]);

  // Pre-fill input with suggested reply from AI
  useEffect(() => {
    if (suggestedReply) {
      setInput(suggestedReply);
    }
  }, [suggestedReply]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    await sendUserMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAnalyze = async () => {
    if (!psd || sending || !apiKey) return;
    await analyzeCurrentPsd();
  };

  const canSend = apiKey && !sending;
  const canAnalyze = apiKey && psd && !sending;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>AI Chat</span>
        <button
          onClick={clearMessages}
          style={{
            float: 'right',
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: '12px',
          }}
          title="Clear messages"
        >
          Clear
        </button>
      </div>

      {/* API Key */}
      <div style={styles.apiKeySection}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <label style={{ fontSize: '11px', opacity: 0.7 }}>API Key</label>
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '11px' }}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          type={showApiKey ? 'text' : 'password'}
          placeholder="sk-ant-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={styles.apiKeyInput}
        />
      </div>

      {/* Analyze button */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <button
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          style={styles.analyzeBtn(!canAnalyze)}
        >
          {sending ? 'Analyzing...' : 'Analyze PSD'}
        </button>
      </div>

      {/* Messages */}
      <div style={styles.messagesArea}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', opacity: 0.4, padding: '20px' }}>
            Load a PSD file, enter your API key, then click "Analyze PSD" to start.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={styles.message(msg.role === 'user')}>
            <div style={styles.roleLabel(msg.role === 'user')}>
              {msg.role === 'user' ? 'You' : 'AI'}
            </div>
            {msg.role === 'user'
              ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
              : <div className="ai-markdown"><ReactMarkdown>{stripInternalBlocks(msg.content)}</ReactMarkdown></div>
            }
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={styles.inputArea}>
        <textarea
          rows={5}
          placeholder="Shift+Enter で送信"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={styles.textInput}
        />
        <button
          onClick={handleSend}
          disabled={!canSend || !input.trim()}
          style={styles.sendBtn(!canSend || !input.trim())}
        >
          &#9654;
        </button>
      </div>
    </div>
  );
}

// Strip ```json ... ``` and ```reply ... ``` blocks from display text — they are parsed internally
function stripInternalBlocks(text: string): string {
  return text.replace(/```(?:json|reply)\s*\n[\s\S]*?\n```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
