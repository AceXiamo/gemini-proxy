import http from 'node:http';
import { Buffer } from 'node:buffer';
import fetch from 'node-fetch';

const BASE_API = `https://generativelanguage.googleapis.com/v1beta/models`;
const server = http.createServer(async (req, res) => {
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
      let conversionResult;
      try {
        conversionResult = await convertOpenAIMessagesToGeminiContents(bodyJSON.messages);
      } catch (conversionError) {
        console.error("Error during message conversion:", conversionError);
        const errorMessage = conversionError instanceof Error ? conversionError.message : "Error processing message content";
        sendErr(res, `\u{1F4A3} ${errorMessage}`, 400);
        return;
      }
      if (!conversionResult || conversionResult.contents === null) {
        sendErr(res, "\u{1F4A3} Failed to convert message content", 500);
        return;
      }
      const geminiContents = conversionResult.contents;
      const imageProcessed = conversionResult.imageProcessed;
      const requestBodyToGemini = {
        contents: geminiContents
      };
      if (imageProcessed) {
        console.log("Image processed, adding default generationConfig with responseModalities.");
        requestBodyToGemini.generationConfig = { responseModalities: ["TEXT", "IMAGE"] };
      }
      if (bodyJSON.gemini_generation_config) {
        console.log("User provided gemini_generation_config, overriding default.");
        requestBodyToGemini.generationConfig = bodyJSON.gemini_generation_config;
      }
      const geminiBody = JSON.stringify(requestBodyToGemini);
      const geminiUrl = `${BASE_API}/${model}:generateContent?key=${apiKey}`;
      const result2 = await fetch(geminiUrl, {
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
    const result = await fetch(legacyApiUrl, {
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
async function convertOpenAIMessagesToGeminiContents(messages) {
  let imageProcessedOverall = false;
  const contentPromises = messages.map(async (message) => {
    let role = "user";
    if (message.role === "assistant")
      role = "model";
    else if (message.role === "system")
      role = "user";
    const parts = [];
    let processedAsImage = false;
    if (typeof message.content === "string" && message.content.startsWith("#image#split#")) {
      const partsRaw = message.content.split("#split#");
      if (partsRaw.length === 3) {
        const imageSource = partsRaw[1];
        const textContent = partsRaw[2];
        processedAsImage = true;
        try {
          if (imageSource.startsWith("data:image/")) {
            console.log("Processing base64 image data");
            const matches = imageSource.match(/^data:([^;]+);base64,(.+)$/);
            if (!matches || matches.length !== 3)
              throw new Error("Invalid base64 image format. Expected format: data:image/xxx;base64,xxx");
            const mimeType = matches[1];
            const imageBase64 = matches[2];
            console.log(`Successfully processed base64 image. MimeType: ${mimeType}, Base64 Length: ${imageBase64.length}`);
            parts.push({ text: textContent });
            parts.push({ inlineData: { mimeType, data: imageBase64 } });
            imageProcessedOverall = true;
          } else {
            console.log(`Fetching image from URL: ${imageSource}`);
            const imageResponse = await fetch(imageSource);
            if (!imageResponse.ok)
              throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText} from ${imageSource}`);
            const mimeType = imageResponse.headers.get("content-type") || "application/octet-stream";
            const imageBuffer = await imageResponse.arrayBuffer();
            const imageBase64 = Buffer.from(imageBuffer).toString("base64");
            console.log(`Successfully fetched and encoded image. MimeType: ${mimeType}, Base64 Length: ${imageBase64.length}`);
            parts.push({ text: textContent });
            parts.push({ inlineData: { mimeType, data: imageBase64 } });
            imageProcessedOverall = true;
          }
        } catch (error) {
          console.error(`Error processing image ${imageSource}:`, error);
          return null;
        }
      }
    }
    if (!processedAsImage) {
      if (typeof message.content === "string") {
        parts.push({ text: message.content });
      } else if (Array.isArray(message.content)) {
        message.content.forEach((item) => {
          if (item.type === "text" && typeof item.text === "string") {
            parts.push({ text: item.text });
          } else if (item.type === "image_url" && item.image_url && typeof item.image_url.url === "string") {
            console.warn("Standard OpenAI image_url detected. Passing URL as text.");
            parts.push({ text: `Image URL: ${item.image_url.url}` });
          }
        });
      } else {
        console.warn(`Unsupported message content type: ${typeof message.content}. Skipping content.`);
      }
    }
    if (parts.length > 0) {
      return { role, parts };
    } else {
      console.warn("Message resulted in empty parts, filtering out.");
      return null;
    }
  });
  const settledContents = await Promise.all(contentPromises);
  const finalContents = settledContents.filter((content) => content !== null);
  return { contents: finalContents, imageProcessed: imageProcessedOverall };
}
server.listen(80, () => {
  console.log("Server listening on port 80");
});
