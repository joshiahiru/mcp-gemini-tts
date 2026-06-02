# mcp-gemini-tts

A Model Context Protocol (MCP) server that exposes Google Gemini text-to-speech as a tool Claude Code can call.

## Setup

### 1. Install dependencies and build

```bash
cd /Users/olaf.van.der.hoorn/Documents/Claude/mcp-gemini-tts
npm install
npm run build
```

### 2. Get a Gemini API key

Visit https://aistudio.google.com/app/apikey and create a key with access to the `gemini-2.5-flash-preview-tts` model.

### 3. Register with Claude Code

Add the following to `~/.claude/claude_code_config.json` under the `mcpServers` key:

```json
{
  "mcpServers": {
    "gemini-tts": {
      "command": "node",
      "args": ["/Users/olaf.van.der.hoorn/Documents/Claude/mcp-gemini-tts/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Code after saving the config.

## Tool: `synthesize_speech`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | yes | — | Text to convert to speech |
| `output_path` | string | yes | — | Absolute path for the output WAV file |
| `voice` | string | no | `Kore` | Gemini TTS voice name |
| `model` | string | no | `gemini-2.5-flash-preview-tts` | Gemini model |

### Available voices

Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr

### Example usage (in Claude Code chat)

> "Synthesize the text 'Hello, world!' and save it to /tmp/hello.wav"

## Development

```bash
npm run build   # compile TypeScript
npm start       # run server (stdio mode — for testing only)
```
