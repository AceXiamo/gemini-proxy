# Gemini Proxy

A proxy for Gemini pro

## Usage

*Fork this repo and deploy it to Vercel.*
[🔗 Deploy](https://vercel.com/new)

![vercel](./assets/powered-by-vercel.svg)

> tip: dist directory is must
>
```bash
curl \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"Write a story about a magic backpack"}]}]}' \
  -X POST https://gemini-proxy-dusky.vercel.app?key=YOUR_API_KEY
```
