import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.XAI_API_KEY;
const apiBase = (process.env.AI_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "");
const model = process.env.AI_MODEL || "grok-3-mini";
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/icon.svg", ["icon.svg", "image/svg+xml"]]
]);

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Message history is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleChat(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Use POST to send a message." });
  }
  if (!apiKey) {
    return sendJson(response, 503, {
      error: "AI is not configured yet. Set XAI_API_KEY on the server and restart Emoney."
    });
  }

  let body;
  try {
    body = await readRequestBody(request);
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Invalid request body." });
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 30) {
    return sendJson(response, 400, { error: "Send between 1 and 30 messages." });
  }
  const messages = body.messages;
  if (messages.some(message =>
    !message ||
    !["user", "assistant"].includes(message.role) ||
    typeof message.content !== "string" ||
    !message.content.trim() ||
    message.content.length > 8000
  )) {
    return sendJson(response, 400, { error: "One or more messages are invalid." });
  }

  let upstream;
  try {
    upstream = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are Emoney, a helpful, curious, and candid AI assistant. Be clear, warm, and thoughtful. Do not claim to have live information unless a tool provides it."
          },
          ...messages
        ],
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (error) {
    console.error("AI provider request failed.", error);
    return sendJson(response, 502, { error: "Could not reach the AI provider. Check the server connection and try again." });
  }

  if (!upstream.ok) {
    const providerMessage = await upstream.text();
    console.error(`AI provider returned ${upstream.status}: ${providerMessage.slice(0, 500)}`);
    return sendJson(response, 502, {
      error: `AI provider returned an error (${upstream.status}). Check your API key, model, and provider settings.`
    });
  }

  let data;
  try {
    data = await upstream.json();
  } catch (error) {
    console.error("AI provider returned invalid JSON.", error);
    return sendJson(response, 502, { error: "AI provider returned an invalid response." });
  }
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    console.error("AI provider response did not include a text reply.");
    return sendJson(response, 502, { error: "AI provider response did not contain a text reply." });
  }
  return sendJson(response, 200, { reply });
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/api/chat") {
    try {
      await handleChat(request, response);
    } catch (error) {
      console.error("Unexpected chat request failure.", error);
      if (!response.headersSent) sendJson(response, 500, { error: "Unexpected server error. Check the server log." });
      else response.destroy();
    }
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const [filename, contentType] = asset;
  try {
    const filePath = resolve(root, filename);
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": filename === "index.html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error(`Could not serve ${filename}.`, error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Could not load the app.");
  }
});

server.listen(port, () => {
  console.log(`Emoney is ready at http://localhost:${port}`);
  if (!apiKey) console.log("Set XAI_API_KEY to enable AI replies.");
});
