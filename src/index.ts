#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DEFAULT_VOICE = "Kore";
const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";

// Directory used when output_path is omitted or relative. Configurable via the
// GEMINI_TTS_OUTPUT_DIR environment variable; falls back to the user's home dir.
function defaultOutputDir(): string {
  const fromEnv = process.env.GEMINI_TTS_OUTPUT_DIR;
  if (fromEnv && fromEnv.trim() !== "") {
    return fromEnv.startsWith("~")
      ? path.join(os.homedir(), fromEnv.slice(1))
      : fromEnv;
  }
  return os.homedir();
}

// Resolve a user-supplied output path against the default dir. Accepts an
// absolute path (used as-is), a relative path/bare filename (resolved against
// the default dir), or undefined (auto-generates a timestamped filename).
function resolveOutputPath(outputPath: string | undefined): string {
  const dir = defaultOutputDir();
  if (!outputPath || outputPath.trim() === "") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(dir, `gemini-tts-${stamp}.wav`);
  }
  if (outputPath.startsWith("~")) {
    return path.join(os.homedir(), outputPath.slice(1));
  }
  if (path.isAbsolute(outputPath)) {
    return outputPath;
  }
  return path.join(dir, outputPath);
}

// Gemini TTS treats a bare prompt as something to respond to (often failing with
// "Model tried to generate text, but it should only be used for TTS"). Prefixing
// an explicit verbatim directive makes it speak the text without responding.
const TTS_DIRECTIVE =
  "Read the following text aloud verbatim, without responding to it:\n\n";

// Gemini returns raw PCM (e.g. audio/L16;codec=pcm;rate=24000), not a container
// format. Parse the sample rate from the mime type so we can write a valid WAV.
function parseSampleRate(mimeType: string | undefined): number {
  const match = /rate=(\d+)/.exec(mimeType ?? "");
  return match ? parseInt(match[1], 10) : 24000;
}

// Wrap raw 16-bit mono PCM in a minimal WAV (RIFF) header.
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const server = new Server(
  {
    name: "mcp-gemini-tts",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "synthesize_speech",
        description:
          "Convert text to speech using Google Gemini TTS and save the audio file to disk.",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text to convert to speech.",
            },
            output_path: {
              type: "string",
              description:
                "Where to save the audio file. May be an absolute path, or a relative path/bare filename which is resolved against the default output directory (GEMINI_TTS_OUTPUT_DIR, or the user's home directory). If omitted, a timestamped filename is generated in that directory.",
            },
            voice: {
              type: "string",
              description: `Voice name to use. Defaults to "${DEFAULT_VOICE}". Available Gemini TTS voices include: Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr.`,
            },
            model: {
              type: "string",
              description: `Gemini model to use. Defaults to "${DEFAULT_MODEL}".`,
            },
          },
          required: ["text"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "synthesize_speech") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const args = request.params.arguments as Record<string, unknown>;
  const text = args.text as string | undefined;
  const voice = (args.voice as string | undefined) ?? DEFAULT_VOICE;
  const model = (args.model as string | undefined) ?? DEFAULT_MODEL;

  // Validate required inputs
  if (!text || typeof text !== "string" || text.trim() === "") {
    return {
      content: [{ type: "text", text: "Error: 'text' is required and must be a non-empty string." }],
      isError: true,
    };
  }

  // Resolve output path: absolute as-is, relative/bare against the default dir
  // (GEMINI_TTS_OUTPUT_DIR or home), or auto-generated when omitted.
  const outputPath = resolveOutputPath(args.output_path as string | undefined);

  // Check API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      content: [{ type: "text", text: "Error: GEMINI_API_KEY environment variable is not set." }],
      isError: true,
    };
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: Could not create output directory '${outputDir}': ${err}` }],
      isError: true,
    };
  }

  // Call Gemini TTS
  let audioData: string;
  let mimeType: string | undefined;
  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: TTS_DIRECTIVE + text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (!part || !("inlineData" in part) || !part.inlineData?.data) {
      return {
        content: [{ type: "text", text: "Error: Gemini API returned no audio data. Check model and voice name." }],
        isError: true,
      };
    }

    audioData = part.inlineData.data;
    mimeType = part.inlineData.mimeType;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error calling Gemini API: ${message}` }],
      isError: true,
    };
  }

  // Write audio file. Gemini returns raw PCM, so wrap it in a WAV header.
  try {
    const pcm = Buffer.from(audioData, "base64");
    const sampleRate = parseSampleRate(mimeType);
    const buffer = pcmToWav(pcm, sampleRate);
    fs.writeFileSync(outputPath, buffer);

    const fileSizeKb = Math.round(buffer.length / 1024);

    return {
      content: [
        {
          type: "text",
          text: `Speech synthesized successfully.\n\nFile: ${outputPath}\nSize: ${fileSizeKb} KB\nVoice: ${voice}\nModel: ${model}\nCharacters: ${text.length}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error writing audio file to '${outputPath}': ${err}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is running; log to stderr so it doesn't pollute the MCP stdio stream
  process.stderr.write("mcp-gemini-tts server started\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
