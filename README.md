# mcp-gemini-tts

A Model Context Protocol (MCP) server that exposes Google Gemini text-to-speech as a tool Claude Code can call.

## Setup

### 1. Install dependencies and build

```bash
cd mcp-gemini-tts
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
      "args": ["<your path>/mcp-gemini-tts/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY_HERE",
        "GEMINI_TTS_OUTPUT_DIR": "/Users/you/Documents/tts",
        "GEMINI_TTS_VOICE": "Kore",
        "GEMINI_TTS_MODEL": "gemini-2.5-flash-preview-tts"
      }
    }
  }
}
```

Restart Claude Code after saving the config.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | — | Gemini API key |
| `GEMINI_TTS_OUTPUT_DIR` | no | user's home directory | Default directory for output files. Used when `output_path` is omitted or relative. Supports `~`. |
| `GEMINI_TTS_VOICE` | no | `Kore` | Default voice when the `voice` argument is omitted. |
| `GEMINI_TTS_MODEL` | no | `gemini-2.5-flash-preview-tts` | Default model when the `model` argument is omitted. |

## Tool: `synthesize_speech`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | yes | — | Text to convert to speech |
| `output_path` | string | no | timestamped file in the default dir | Absolute path, or a relative path/bare filename resolved against the default output directory (`GEMINI_TTS_OUTPUT_DIR`, or home). If omitted, a `gemini-tts-<timestamp>.wav` file is created there. |
| `voice` | string | no | `GEMINI_TTS_VOICE`, else `Kore` | Gemini TTS voice name |
| `model` | string | no | `GEMINI_TTS_MODEL`, else `gemini-2.5-flash-preview-tts` | Gemini model |

### Available voices

Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr

### Example usage (in Claude Code chat)

> "Synthesize the text 'Hello, world!' and save it to /tmp/hello.wav"

## Development

```bash
npm run build   # compile TypeScript
npm start       # run server (stdio mode — for testing only)
```
