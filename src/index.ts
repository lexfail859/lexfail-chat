/**
 * LLM Chat Application (Nemotron-first)
 *
 * Uses @cf/nvidia/nemotron-3-120b-a12b by default and exposes a lightweight,
 * safe system prompt override from the frontend (validated server-side).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Default model: Nemotron (change here if you want a different default)
const DEFAULT_MODEL_ID = "@cf/nvidia/nemotron-3-120b-a12b";

// Stronger, AI-first system prompt template (concise, instruction-following, safe)
const DEFAULT_SYSTEM_PROMPT = `
You are Nemotron, a helpful and concise assistant. Follow these rules:
- Provide accurate, evidence-based answers; when uncertain, say "I don't know" and offer to look it up.
- Ask a single clarifying question only if the user's request is ambiguous.
- Prefer short, structured answers with optional "Details" sections.
- When asked for code, return runnable snippets with language fences and a short explanation.
- Avoid hallucination: do not fabricate facts, sources, logs, or credentials.
- Do not request, store, or expose secrets or PII.
Respond in a friendly tone. If user asks for step-by-step instructions, ask whether they want a high-level summary or exact commands.
`;

/**
 * Validate that the requested model is allowed for this deployment.
 * Only allow a small, explicit safelist to prevent accidental model usage.
 */
function isAllowedModel(modelId: string) {
  const allowed = new Set([
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/meta/llama-3.1-8b-instruct-fp8", // keep existing as fallback if you want
  ]);
  return allowed.has(modelId);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets unless the path is /api/*
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    // Accept optional modelId and optional systemPrompt from client (both optional)
    // Body example: { messages: [...], modelId?: string, systemPrompt?: string }
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      modelId?: string;
      systemPrompt?: string;
    };

    const messages = body.messages ?? [];

    // Determine effective model
    const requestedModel = body.modelId ?? DEFAULT_MODEL_ID;
    const modelId = isAllowedModel(requestedModel) ? requestedModel : DEFAULT_MODEL_ID;

    // Determine effective system prompt (server-side fallback + trimming)
    const clientSystem = typeof body.systemPrompt === "string" && body.systemPrompt.trim().length > 0
      ? body.systemPrompt.trim()
      : null;

    // If there's no system message, inject either the client-provided one (if present) or the default.
    if (!messages.some((m) => m.role === "system")) {
      messages.unshift({
        role: "system",
        content: clientSystem ?? DEFAULT_SYSTEM_PROMPT,
      });
    } else if (clientSystem) {
      // If client supplied a system prompt but messages already contain one, prepend client system prompt to make it authoritative
      messages.unshift({ role: "system", content: clientSystem });
    }

    // Input parameters tuned for helpful, concise responses from Nemotron
    const inputs = {
      messages,
      max_tokens: 1024,
      temperature: 0.2,
      top_p: 0.95,
      stream: true,
    } satisfies AiTextGenerationInput & { stream: true };

    // Run the model (streaming)
    const stream = await env.AI.run<typeof modelId>(modelId, inputs, {});

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(JSON.stringify({ error: "Failed to process request" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
