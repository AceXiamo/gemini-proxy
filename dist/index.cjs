'use strict';

const http = require('node:http');
const fetch = require('node-fetch');

function _interopDefaultCompat (e) { return e && typeof e === 'object' && 'default' in e ? e.default : e; }

const http__default = /*#__PURE__*/_interopDefaultCompat(http);
const fetch__default = /*#__PURE__*/_interopDefaultCompat(fetch);

const BASE_API = `https://generativelanguage.googleapis.com/v1beta/models`;
const server = http__default.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = req.url || "/";
  const isLegacyPath = url.startsWith("/?key=") || url === "/";
  const isOpenAIPath = url.startsWith("/v1/chat/completions");
  try {
    if (req.method !== "POST" && (isLegacyPath || isOpenAIPath)) {
      sendErr(res, "\u{1F4A3} Only POST method allowed for this endpoint!", 405);
      return;
    }
    if (isOpenAIPath) {
      const apiKey = keyFromHeader(req.headers.authorization);
      const bodyString = await bodyFromRequest(req);
      let bodyJSON;
      try {
        bodyJSON = JSON.parse(bodyString);
      } catch (error) {
        sendErr(res, "\u{1F4A3} Invalid JSON received in request body!", 400);
        return;
      }
      const model = bodyJSON.model;
      if (!model) {
        sendErr(res, '\u{1F4A3} Missing "model" field in request body!', 400);
        return;
      }
      if (!Array.isArray(bodyJSON.messages)) {
        sendErr(res, '\u{1F4A3} Missing or invalid "messages" array in request body!', 400);
        return;
      }
      const geminiContents = convertOpenAIMessagesToGeminiContents(bodyJSON.messages);
      const geminiBody = JSON.stringify({
        contents: geminiContents
        // TODO: Optionally map other parameters like temperature, max_tokens
        // generationConfig: { ... }
      });
      const geminiUrl = `${BASE_API}/${model}:generateContent?key=${apiKey}`;
      const result2 = await fetch__default(geminiUrl, {
        method: "POST",
        body: geminiBody,
        // Use the converted Gemini format body
        headers: {
          "Content-Type": "application/json"
        }
      });
      if (result2.body) {
        res.writeHead(result2.status, { "Content-Type": "application/json" });
        result2.body.pipe(res);
      } else {
        res.writeHead(result2.status, { "Content-Type": "application/json" });
        res.end();
      }
      return;
    }
    if (!isLegacyPath && !isOpenAIPath) {
      sendErr(res, "\u{1F4A3} Unknown path!", 404);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json"
      // CORS headers are already set above
    });
    const body = await bodyFromRequest(req);
    const key = keyFromURl(req.url || "");
    const legacyModel = "gemini-1.5-flash";
    const legacyApiUrl = `${BASE_API}/${legacyModel}:generateContent?key=${key}`;
    const result = await fetch__default(legacyApiUrl, {
      // Use the constructed legacy URL
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json"
      }
    });
    const json = await result.json();
    res.end(JSON.stringify(json));
  } catch (e) {
    let message = "\u{1F4A3} An unknown error occurred";
    let statusCode = 500;
    if (e instanceof Error)
      message = `\u{1F4A3} ${e.message}`;
    else if (typeof e === "string")
      message = `\u{1F4A3} ${e}`;
    if (message.includes("API key not valid") || message.includes("API key invalid"))
      statusCode = 401;
    else if (message.includes("Invalid JSON"))
      statusCode = 400;
    else if (message.includes("timed out"))
      statusCode = 504;
    sendErr(res, message, statusCode);
  }
});
function sendErr(res, msg = "\u{1F4A3} Internal Server Error", code = 500) {
  if (!res.headersSent) {
    res.writeHead(code, {
      "Content-Type": "application/json"
      // CORS headers are already set at the beginning
    });
  }
  res.end(JSON.stringify({
    // Use JSON.stringify for consistent JSON error response
    error: {
      // Nest details under 'error' key, common practice
      code,
      // Use property shorthand
      message: msg
    }
  }));
}
function keyFromURl(url) {
  const params = new URLSearchParams(url.split("?")[1] || "");
  const key = params.get("key");
  if (!key)
    throw new Error("add param key to url!");
  return key;
}
function keyFromHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer "))
    throw new Error('\u{1F4A3} Missing or invalid Authorization header! Format: "Bearer YOUR_API_KEY"');
  return authHeader.substring(7);
}
function bodyFromRequest(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
function convertOpenAIMessagesToGeminiContents(messages) {
  return messages.map((message) => {
    let role = "user";
    if (message.role === "assistant")
      role = "model";
    else if (message.role === "system")
      role = "user";
    const parts = [];
    if (typeof message.content === "string") {
      parts.push({ text: message.content });
    } else if (Array.isArray(message.content)) {
      message.content.forEach((item) => {
        if (item.type === "text" && typeof item.text === "string") {
          parts.push({ text: item.text });
        } else if (item.type === "image_url" && item.image_url && typeof item.image_url.url === "string") {
          console.warn("Image URL detected. Passing URL as text. Full image processing not implemented.");
          parts.push({ text: `Image URL: ${item.image_url.url}` });
        }
      });
    } else {
      console.warn(`Unsupported message content type: ${typeof message.content}. Skipping content.`);
    }
    return { role, parts };
  }).filter((content) => content.parts.length > 0);
}
server.listen(80, () => {
  console.log("Server listening on port 80");
});
