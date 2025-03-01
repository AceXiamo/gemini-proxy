'use strict';

const http = require('node:http');
const fetch = require('node-fetch');

function _interopDefaultCompat (e) { return e && typeof e === 'object' && 'default' in e ? e.default : e; }

const http__default = /*#__PURE__*/_interopDefaultCompat(http);
const fetch__default = /*#__PURE__*/_interopDefaultCompat(fetch);

const API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=`;
const server = http__default.createServer(async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  if (req.method !== "POST") {
    sendErr(res, "\u{1F4A3} Only POST method allowed!", 405);
    return;
  }
  try {
    const body = await bodyFromRequest(req);
    const key = keyFromURl(req.url || "");
    const result = await fetch__default(API + key, {
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
  console.log("Server listening on port 80");
});
