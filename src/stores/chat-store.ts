// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import type { ChatMessage, InteractionConfig } from '../lib/types';
import { sendMessage, rgbaToBase64Png } from '../lib/claude-client';
import type { ApiMessage, MessageContent } from '../lib/claude-client';
import { qtRenderer } from '../lib/qt-renderer';
import { usePsdStore } from './psd-store';

interface ChatState {
  messages: ChatMessage[];
  apiKey: string;
  sending: boolean;
  interactionConfig: InteractionConfig | null;
  systemContext: string | null;  // system prompt for follow-up messages
  layerJson: string | null;     // stored layer JSON for rebuilding context
  suggestedReply: string | null; // pre-filled reply suggestion from AI
}

interface ChatActions {
  setApiKey: (key: string) => void;
  sendUserMessage: (text: string) => Promise<void>;
  analyzeCurrentPsd: () => Promise<void>;
  clearMessages: () => void;
}

// Try to parse interaction config from AI response
function parseInteractionConfig(text: string): InteractionConfig | null {
  // Look for JSON blocks in the response
  const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (parsed.elements && Array.isArray(parsed.elements)) {
      return parsed as InteractionConfig;
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

// Extract ```reply ... ``` block from AI response
function extractSuggestedReply(text: string): { reply: string | null; cleaned: string } {
  const match = text.match(/```reply\s*\n([\s\S]*?)\n```/);
  if (!match) return { reply: null, cleaned: text };
  const reply = match[1].trim();
  const cleaned = text.replace(/```reply\s*\n[\s\S]*?\n```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return { reply, cleaned };
}

// Build system context for follow-up conversations
function buildSystemContext(layerJson: string, currentConfig: InteractionConfig | null): string {
  let ctx = `あなたはPSDデザインモックアップをインタラクティブなGUIアプリに変換するアシスタントです。
ユーザーの指示に従い、設定JSONを更新してください。不明な点は推測せず質問してください。
デザインの中に対応要素タイプでは実現できないUI要素・動作がある場合は、「未対応の機能」として何が必要かを具体的に説明してください。

## 対応する要素タイプと必須フィールド

| type | 用途 | 必須フィールド |
|------|------|--------------|
| screen | 画面フォルダ | layerId, name |
| button | ボタン（画面遷移） | layerId, action:"navigate", target:"<screen名>" |
| button | ボタン（条件付き遷移） | layerId, action:"navigate_conditional", targets:{画面名:遷移先,...} |
| tap_area | タップ可能エリア | layerId, action:"navigate", target:"<screen名>" |
| input_digit | 数字入力ボタン | layerId, action:"input_digit", value:"<0-9>", target:"<display名カンマ区切り>" |
| clear_input | 入力クリア | layerId, action:"clear_input", target:"<display名カンマ区切り>" |
| display | 動的テキスト表示（テキストレイヤー） | layerId, name, value:"<初期値>" |
| clock | 時計表示 | layerId, format:"HH:mm:ss" |
| slider | スライダー | layerId, min, max |
| timer | 画面タイマー（layerId:0） | delay:<秒>, action:"navigate", target:"<screen名>", triggerOn:["<screen名>",...] |
| highlight | 選択ハイライトレイヤー | layerId, name, group:"<グループ名>" |
| popup | ポップアップ/ダイアログ | layerId, name |

## タイマー
- layerIdは0（視覚レイヤー不要）
- triggerOnに指定した画面に遷移すると自動開始、画面を離れるとキャンセル
- delay秒後にactionを実行（例: 5秒後に最初の画面に戻る）

## ハイライト選択
- highlight: 選択状態を表すレイヤー。初期状態は非表示
- **ラジオボタン式** (action:"show_highlight"): 同じgroup内で1つだけ表示可能。別の候補をタップすると切り替わる
  - 例: 候補者A/Bの選択 → highlight group:"vote" を2つ定義、各候補タップで切り替え
- **トグル式** (action:"toggle_highlight"): 同じボタンで選択/解除を切り替え。選択済みなら解除、未選択なら選択
  - 例: 国民審査の×ボタン → 各裁判官ごとにhighlightを定義、タップでON/OFF切り替え

## ポップアップ
- popup: ダイアログ/確認画面として使うレイヤーグループ。初期状態は非表示
- ボタンの action:"show_popup", target:"<popup名>" で表示
- ボタンの action:"hide_popup" で非表示（targetなし）
- ボタンの action:"hide_popup", target:"<screen名>" でポップアップ閉じ＋画面遷移
- action:"navigate_from_popup" は hide_popup+target と同義

## 表示の仕組み
- screen同士は排他的（1つだけ表示、他は非表示）
- showOn:["画面A","画面B"] で任意レイヤーを特定画面でのみ表示可能
- 上記のどちらにも該当しないレイヤーは常に表示されたまま

## 要素の所属
- インタラクティブ要素はいずれかのscreenフォルダの子孫レイヤーを使ってください
- screenが非表示のとき、その中の全要素も自動的に非表示になります

## 数字入力
- displayのlayerIdには必ず**テキストレイヤー**のIDを指定してください（PSDフォントで描画されます）
- 新しい数字は右端に入り、既存の数字は左へシフト（例: -- → -1 → 12）
- PSDに桁ごとに別テキストレイヤーがある場合: 各桁にdisplayを作り、input_digit/clear_inputのtargetにカンマ区切りで左→右の順に列挙
  - 例: display name="d1" (左の桁), display name="d2" (右の桁) → target:"d1,d2"
  - 各displayのvalueは1文字（例: "-"）
- PSDに1つのテキストレイヤーしかない場合: target に1つのdisplay名を指定

## 重要なルール
- layerId は必ずレイヤーツリーJSONに存在するIDを使ってください
- フォルダ全体をタップ領域にしたい場合、そのフォルダのIDを使います
- screensには全画面名を列挙し、initialScreenに初期画面を指定してください
- 変更があるときは完全なJSONブロックを返してください

## 出力形式
\`\`\`json
{
  "elements": [...],
  "screens": ["screen1", "screen2", ...],
  "initialScreen": "screen1"
}
\`\`\`

質問がある場合は、回答の末尾にユーザーが編集して返信できる模範回答を以下の形式で含めてください：
\`\`\`reply
（ここに模範回答）
\`\`\`

## レイヤーツリー
${layerJson}`;

  if (currentConfig) {
    ctx += `\n\n## 現在のインタラクション設定\n\`\`\`json\n${JSON.stringify(currentConfig, null, 2)}\n\`\`\``;
  }

  return ctx;
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  messages: [],
  apiKey: localStorage.getItem('psd-run:api-key') || '',
  sending: false,
  interactionConfig: null,
  systemContext: null,
  layerJson: null,
  suggestedReply: null,

  setApiKey: (key) => {
    localStorage.setItem('psd-run:api-key', key);
    set({ apiKey: key });
  },

  sendUserMessage: async (text) => {
    const state = get();
    if (!state.apiKey || state.sending) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    set({ messages: [...state.messages, userMessage], sending: true });

    try {
      // Build API messages from history (use apiContent if available)
      const apiMessages: ApiMessage[] = get().messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.apiContent || m.content,
      }));

      // Add placeholder for streaming
      const placeholderMessage: ChatMessage = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      set({ messages: [...get().messages, placeholderMessage] });

      // Build system prompt from context (layer JSON from analysis)
      const systemCtx = get().systemContext || undefined;

      const fullText = await sendMessage(
        state.apiKey,
        apiMessages,
        (partialText) => {
          // Update the last message with streaming content
          const msgs = [...get().messages];
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: partialText };
          set({ messages: msgs });
        },
        systemCtx
      );

      // Final update — extract suggested reply
      const { reply: suggestedReply } = extractSuggestedReply(fullText);
      const msgs = [...get().messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullText };

      // Try to parse interaction config from response
      const config = parseInteractionConfig(fullText);
      const newConfig = config || state.interactionConfig;
      const storedLayerJson = get().layerJson;
      // Update system context with new config if it changed
      if (config && storedLayerJson) {
        set({ messages: msgs, interactionConfig: newConfig, suggestedReply, systemContext: buildSystemContext(storedLayerJson, newConfig) });
      } else {
        set({ messages: msgs, interactionConfig: newConfig, suggestedReply });
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };
      set({ messages: [...get().messages.slice(0, -1), errorMsg] });
    } finally {
      set({ sending: false });
    }
  },

  analyzeCurrentPsd: async () => {
    const state = get();
    if (!state.apiKey || state.sending) return;

    const psdState = usePsdStore.getState();
    if (!psdState.psd) return;

    set({ sending: true });

    try {
      // Get layer tree JSON
      const layerJson = await qtRenderer.exportLayerJson('main');

      // Build analysis prompt text (also used as apiContent for follow-up history)
      const analysisPromptText = `あなたはPSDデザインモックアップをインタラクティブなGUIアプリに変換するアシスタントです。

## 提供する情報
1. レイヤーツリーJSON（各レイヤーのid, name, type, 座標, テキスト内容）
2. 全体合成画像
3. 主要フォルダの個別画像

## あなたのタスク
画像とレイヤー構造を分析し、このデザインをインタラクティブに動作させるための設定JSONを生成してください。

## 進め方
1. まず画像とレイヤー構造から、何画面あるか・各画面にどんなUI要素があるかを分析してください
2. 分析結果をもとに、推測できる動作を含めて**最初から完全な設定JSON**を生成してください。推測した部分には説明を添えてください
3. 推測に自信がない部分や複数の解釈がありうる部分は、推測した内容を説明した上で質問してください。例えば：
   - 「このフォルダはXX画面として扱いました。共有ヘッダーの場合はお知らせください」
   - 「この数字ボタン群は2桁入力と仮定しました。桁数が異なる場合は教えてください」
   - 「このエリアのタップでYY画面に遷移すると推測しました。正しいですか？」
4. デザインの中に上記の対応要素タイプでは実現できないUI要素・動作がある場合は、「未対応の機能」として何が必要かを具体的に説明してください（例: ドラッグ&ドロップ、アニメーション遷移、テキスト自由入力など）
5. ユーザーの回答を受けて、設定JSONを完成・更新してください

## システムの動作仕様

### 表示の仕組み
- PSDのすべてのレイヤーは、デフォルトでそのまま表示されます
- システムが制御するのは以下の2つです：
  1. **screen**: 排他的画面切り替え（1つだけ表示、他のscreenは非表示）
  2. **showOn**: 任意の要素に付与でき、指定された画面でのみ表示する
- 上記のどちらにも該当しないレイヤーは常に表示されたままです

### 画面遷移
- type:"screen" に指定したフォルダ同士は排他的です
- screenのlayerId は必ずフォルダ（type:"group"）のレイヤーIDを指定してください
- すべてのトップレベルフォルダをscreenにする必要はありません

### 条件付き画面遷移
- 同じボタンが現在の画面に応じて異なる遷移先を持つ場合に使用
- action:"navigate_conditional", targets: {"現在の画面名":"遷移先画面名", ...}
- 例: 確認ポップアップの「はい」ボタンが画面ごとに異なる次画面に遷移する場合
  - {"layerId":500, "type":"tap_area", "action":"navigate_conditional", "targets":{"screen_a":"screen_b", "screen_b":"screen_c"}}

### 画面ごとの条件付き表示（showOn）
- 任意の要素に showOn:["画面A","画面B"] を付けると、その画面でのみレイヤーが表示されます
- 例：ヘッダーを最初の画面だけ非表示にしたい場合
  → {"layerId":123, "type":"conditional", "showOn":["parking_input","payment_credit",...]}
  （最初のwelcome画面はリストに含めない → 非表示になる）

### 対応する要素タイプと必須フィールド

| type | 用途 | 必須フィールド |
|------|------|--------------|
| screen | 画面フォルダ（排他表示） | layerId, name |
| conditional | 条件付き表示レイヤー | layerId, showOn:["画面名",...] |
| button | ボタン（画面遷移） | layerId, action:"navigate", target:"<screen名>" |
| button | ボタン（条件付き遷移） | layerId, action:"navigate_conditional", targets:{画面名:遷移先,...} |
| tap_area | タップ可能エリア | layerId, action:"navigate", target:"<screen名>" |
| input_digit | 数字入力ボタン | layerId, action:"input_digit", value:"<0-9>", target:"<display名カンマ区切り>" |
| clear_input | 入力クリア | layerId, action:"clear_input", target:"<display名カンマ区切り>" |
| display | 動的テキスト表示（テキストレイヤー） | layerId, name, value:"<初期値>" |
| clock | 時計表示 | layerId, format:"HH:mm:ss" |
| slider | スライダー | layerId, min, max |
| timer | 画面タイマー（layerId:0） | delay:<秒>, action:"navigate", target:"<screen名>", triggerOn:["<screen名>",...] |
| highlight | 選択ハイライトレイヤー | layerId, name, group:"<グループ名>" |
| popup | ポップアップ/ダイアログ | layerId, name |

### タイマー
- layerIdは0を指定（視覚レイヤー不要）
- triggerOnに指定した画面に遷移すると自動開始、画面を離れるとキャンセル
- delay秒後にactionを実行（例: 完了画面で5秒後にトップに戻る）
- 例: {"layerId":0, "type":"timer", "delay":5, "action":"navigate", "target":"welcome", "triggerOn":["complete","thankyou"]}

### ハイライト選択
- highlight: 選択状態を表すレイヤー（枠や背景色など）。初期状態は非表示
- **ラジオボタン式** (action:"show_highlight"): 同じgroup内で1つだけ表示。別の候補をタップすると切り替わる
  - 例: 候補者選択
  - {"layerId":101, "type":"highlight", "name":"hl_a", "group":"vote"}
  - {"layerId":102, "type":"highlight", "name":"hl_b", "group":"vote"}
  - {"layerId":201, "type":"tap_area", "action":"show_highlight", "target":"hl_a"}
- **トグル式** (action:"toggle_highlight"): 同じボタンで選択/解除を切り替え。選択済みなら解除、未選択なら選択
  - 例: 国民審査の×ボタン（各裁判官ごとに独立してON/OFF）
  - {"layerId":301, "type":"highlight", "name":"judge1_x", "group":"judge1"}
  - {"layerId":401, "type":"tap_area", "action":"toggle_highlight", "target":"judge1_x"}

### ポップアップ
- popup: ダイアログ/確認画面として使うフォルダレイヤー。初期状態は非表示
- ボタンに action:"show_popup", target:"<popup名>" で表示
- ボタンに action:"hide_popup" で非表示に（targetなしで閉じるだけ）
- ボタンに action:"hide_popup", target:"<screen名>" で閉じて画面遷移
- action:"navigate_from_popup" は hide_popup+target と同義
- 画面遷移時はポップアップが自動的に閉じる

### 要素の所属
- ボタンやinput等のインタラクティブ要素は、いずれかのscreenフォルダの子孫レイヤーを使ってください
- screenが非表示のとき、そのscreen内の全要素も自動的に非表示になります

### 数字入力の動作
新しい数字は右端に入り、既存の数字は左へシフトします（例: -- → -1 → 12）。
- displayが**1つのテキストレイヤー**を使う場合: target に1つのdisplay名を指定
  - [--] + 1 → [-1], [-1] + 2 → [12], [12] + 3 → 変化なし
- displayが**桁ごとに別テキストレイヤー**の場合: target にカンマ区切りでdisplay名を左→右の順に列挙
  - 例: target:"digit1,digit2" → digit1=左の桁, digit2=右の桁
  - 各displayのvalueは1文字（初期値 "-"）
  - PSDに桁ごとのテキストレイヤーがある場合はこちらを使ってください
- clear → 全displayをvalue初期値に戻す

### 重要なルール
- layerId は必ずレイヤーツリーJSONに存在するIDを使ってください
- フォルダ全体をタップ領域にしたい場合、そのフォルダのIDを使います
- 個別レイヤーをボタンにしたい場合、そのレイヤーのIDを使います
- screensには全画面名を列挙し、initialScreenに初期画面を指定してください

## 出力形式
分析結果・推測の説明・質問を自然な文章で書き、推測を含めた完全な設定JSONを以下の形式で含めてください：
\`\`\`json
{
  "elements": [...],
  "screens": ["screen1", "screen2", ...],
  "initialScreen": "screen1"
}
\`\`\`

質問がある場合は、回答の末尾にユーザーが編集して返信できる模範回答を以下の形式で含めてください：
\`\`\`reply
（ここに模範回答。各質問への回答を箇条書きで。ユーザーはこれを編集して送信します）
\`\`\`

## レイヤーツリー
${layerJson}`;

      // Build content array with text + images
      const content: MessageContent[] = [
        { type: 'text', text: analysisPromptText },
      ];

      // Add composite image
      if (psdState.composite?.data) {
        const base64 = await rgbaToBase64Png(
          psdState.composite.data,
          psdState.composite.width,
          psdState.composite.height
        );
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: base64,
          },
        });
      }

      // Add top-level folder images (up to 5 to avoid token limits)
      const topFolders = psdState.psd.layers.filter(l => l.type === 'group').slice(0, 5);
      for (const folder of topFolders) {
        try {
          const layerImg = await qtRenderer.getLayerImage('main', folder.id);
          if (layerImg.data && layerImg.width > 0 && layerImg.height > 0) {
            const base64 = await rgbaToBase64Png(layerImg.data, layerImg.width, layerImg.height);
            content.push({
              type: 'text',
              text: `Layer "${folder.name}" (ID: ${folder.id}):`,
            });
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64,
              },
            });
          }
        } catch (e) {
          console.warn(`Failed to get image for layer ${folder.id}:`, e);
        }
      }

      const userMessage: ChatMessage = {
        role: 'user',
        content: 'PSDを分析してインタラクティブ要素を検出してください（画像付き）',
        apiContent: analysisPromptText,  // full prompt for follow-up API history
        timestamp: Date.now(),
      };

      const placeholderMessage: ChatMessage = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      set({ messages: [...get().messages, userMessage, placeholderMessage] });

      const apiMessages: ApiMessage[] = [{ role: 'user', content }];

      const fullText = await sendMessage(
        state.apiKey,
        apiMessages,
        (partialText) => {
          const msgs = [...get().messages];
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: partialText };
          set({ messages: msgs });
        }
      );

      const { reply: suggestedReply } = extractSuggestedReply(fullText);
      const msgs = [...get().messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullText };

      const config = parseInteractionConfig(fullText);

      // Store system context for follow-up conversations
      const newConfig = config || state.interactionConfig;
      const systemContext = buildSystemContext(layerJson, newConfig);
      set({ messages: msgs, interactionConfig: newConfig, suggestedReply, systemContext, layerJson });

      // Save hints after analysis
      try {
        const { fileName } = usePsdStore.getState();
        if (fileName) {
          const hintsJson = await qtRenderer.getHintsJson('main');
          localStorage.setItem(`psd-run:hints:${fileName}`, hintsJson);
        }
      } catch (e) {
        console.warn('Failed to save hints:', e);
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };
      // Remove placeholder if it exists, add error
      const msgs = get().messages;
      if (msgs.length > 0 && msgs[msgs.length - 1].content === '') {
        set({ messages: [...msgs.slice(0, -1), errorMsg] });
      } else {
        set({ messages: [...msgs, errorMsg] });
      }
    } finally {
      set({ sending: false });
    }
  },

  clearMessages: () => set({ messages: [], interactionConfig: null, systemContext: null, layerJson: null, suggestedReply: null }),
}));
