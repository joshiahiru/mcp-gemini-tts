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

const DEFAULT_VOICE = "Kore";
const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";

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
                "Absolute path where the audio file will be saved (e.g. /tmp/output.wav).",
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
          required: ["text", "output_path"],
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
  const outputPath = args.output_path as string | undefined;
  const voice = (args.voice as string | undefined) ?? DEFAULT_VOICE;
  const model = (args.model as string | undefined) ?? DEFAULT_MODEL;

  // Validate required inputs
  if (!text || typeof text !== "string" || text.trim() === "") {
    return {
      content: [{ type: "text", text: "Error: 'text' is required and must be a non-empty string." }],
      isError: true,
    };
  }

  if (!outputPath || typeof outputPath !== "string") {
    return {
      content: [{ type: "text", text: "Error: 'output_path' is required and must be an absolute path string." }],
      isError: true,
    };
  }

  if (!path.isAbsolute(outputPath)) {
    return {
      content: [{ type: "text", text: `Error: 'output_path' must be an absolute path. Got: ${outputPath}` }],
      isError: true,
    };
  }

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
  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text }] }],
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error calling Gemini API: ${message}` }],
      isError: true,
    };
  }

  // Write audio file
  try {
    const buffer = Buffer.from(audioData, "base64");
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
