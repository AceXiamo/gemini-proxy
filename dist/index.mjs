import http from 'node:http';
import fetch from 'node-fetch';

const API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=`;
const server = http.createServer(async (req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  if (req.method !== "POST") {
    sendErr(res, "\u{1F4A3} Only POST method allowed!", 405);
    return;
  }
  try {
    const body = await bodyFromRequest(req);
    const key = keyFromURl(req.url || "");
    const result = await fetch(API + key, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json"
      }
    });
    const json = await result.json();
    res.end(JSON.stringify(json));
  } catch (e) {
    const { message } = e;
    sendErr(res, `\u{1F4A3} ${message}`);
  }
});
function sendErr(res, msg = "\u{1F4A3}", code = 500) {
  res.statusCode = 500;
  res.end(`{
    "code": ${code},
    "message": "${msg}",
  }`);
}
function keyFromURl(url) {
  if (!url.includes("?") || !url.includes("key="))
    throw new Error("add param key to url!");
  return url.split("?")[1].split("key=")[1];
}
function bodyFromRequest(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
server.listen(80, () => {
  console.log("Server listening on port 3000");
});
