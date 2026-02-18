// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT
//
// Claude API client with vision support for browser-direct access

export interface MessageContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | MessageContent[];
}

// Convert RGBA ImageData to base64 PNG using canvas
export async function rgbaToBase64Png(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png');
  });

  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:image/png;base64, prefix
      resolve(result.split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

export async function sendMessage(
  apiKey: string,
  messages: ApiMessage[],
  onChunk?: (text: string) => void,
  system?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    stream: !!onChunk,
    messages,
  };
  if (system) {
    body.system = system;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorBody}`);
  }

  if (onChunk) {
    // Streaming response
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
              onChunk(fullText);
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }
    }

    return fullText;
  } else {
    // Non-streaming response
    const data = await response.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
    return textBlock?.text || '';
  }
}
