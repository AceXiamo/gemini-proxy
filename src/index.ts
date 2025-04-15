import http from 'node:http'
import fetch from 'node-fetch'

const BASE_API = `https://generativelanguage.googleapis.com/v1beta/models`
// const API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=` // Keep original for reference or specific use

// Interfaces related to OpenAI conversion are removed
// Keeping GeminiPart for potential future use/validation might be useful, but removing for now.
/*
interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  // Add other part types like fileData if needed
}
*/

const server = http.createServer(async (req, res) => {
  // Set CORS headers for all responses, including OPTIONS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS') // Allow GET for potential health checks, OPTIONS for preflight
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization') // Allow Authorization header

  // Handle OPTIONS preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204) // No Content
    res.end()
    return
  }

  const url = req.url || '/'
  const isLegacyPath = url.startsWith('/?key=') || url === '/' // Basic check for original path
  const isOpenAIPath = url.startsWith('/v1/chat/completions')

  try {
    if (req.method !== 'POST' && (isLegacyPath || isOpenAIPath)) {
      sendErr(res, '💣 Only POST method allowed for this endpoint!', 405)
      return
    }

    // --- Handle OpenAI Compatible Requests ---
    if (isOpenAIPath) {
      const apiKey = keyFromHeader(req.headers.authorization)
      const bodyString = await bodyFromRequest(req)
      let bodyJSON: any
      try {
        bodyJSON = JSON.parse(bodyString)
      }
      catch (error) {
        sendErr(res, '💣 Invalid JSON received in request body!', 400)
        return
      }

      // IMPORTANT: Still expecting a 'model' field in the request body to determine the target URL
      // This is non-standard for Gemini API but keeps the endpoint structure consistent for the proxy
      const model = bodyJSON.model

      if (!model) {
        sendErr(res, '💣 Missing "model" field in request body! This proxy requires it to determine the target Gemini model URL.', 400)
        return
      }

      // --- Remove conversion logic ---
      // const geminiContents: GeminiContent[] = convertOpenAIMessagesToGeminiContents(bodyJSON.messages)
      // const geminiBody = JSON.stringify({ contents: geminiContents, ... })
      // --- Now directly forward the original bodyString ---

      // Check if the body contains the required 'contents' field for Gemini format
      if (!bodyJSON.contents) {
        sendErr(res, '💣 Invalid request body format. Expecting Gemini native format with a "contents" field.', 400)
        return
      }

      // Construct Gemini API URL dynamically using the model from the request body
      const geminiUrl = `${BASE_API}/${model}:generateContent?key=${apiKey}`

      const result = await fetch(geminiUrl, {
        method: 'POST',
        body: bodyString, // Forward the original request body (which includes the 'model' field)
        // Gemini API should ignore the extra 'model' field.
        headers: {
          'Content-Type': 'application/json',
        },
      })
      // Forward the response directly, including status code
      // Check if result.body exists before piping
      if (result.body) {
        res.writeHead(result.status, { 'Content-Type': 'application/json' })
        result.body.pipe(res) // Stream the response back
      }
      else {
        // Handle cases where there is no response body (e.g., 204 No Content, or error without body)
        res.writeHead(result.status, { 'Content-Type': 'application/json' })
        res.end() // End the response without a body
      }
      return // Stop processing here for OpenAI path
    }

    // --- Handle Legacy Requests (Original Logic) ---
    // Basic check to ensure it's not the OpenAI path trying to use legacy logic
    if (!isLegacyPath && !isOpenAIPath) {
      sendErr(res, '💣 Unknown path!', 404)
      return
    }
    // Re-add header setting for legacy path specifically if needed, or rely on common headers set above
    res.writeHead(200, {
      'Content-Type': 'application/json',
      // CORS headers are already set above
    })

    const body = await bodyFromRequest(req)
    const key = keyFromURl(req.url || '') // Use existing key extraction for legacy
    const legacyModel = 'gemini-1.5-flash' // Or keep 2.0-flash, or make configurable
    const legacyApiUrl = `${BASE_API}/${legacyModel}:generateContent?key=${key}`

    const result = await fetch(legacyApiUrl, { // Use the constructed legacy URL
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const json = await result.json() // Assuming legacy path always expects JSON back directly
    res.end(JSON.stringify(json))
  }
  catch (e) {
    let message = '💣 An unknown error occurred'
    let statusCode = 500
    if (e instanceof Error)
      message = `💣 ${e.message}`
    else if (typeof e === 'string')
      message = `💣 ${e}`

    // Try to determine a more specific status code if possible
    if (message.includes('API key not valid') || message.includes('API key invalid'))
      statusCode = 401 // Unauthorized
    else if (message.includes('Invalid JSON'))
      statusCode = 400 // Bad Request
    else if (message.includes('timed out'))
      statusCode = 504 // Gateway Timeout

    sendErr(res, message, statusCode)
  }
})

function sendErr(res: http.ServerResponse, msg: string = '💣 Internal Server Error', code: number = 500) {
  // Check if headers already sent before trying to set them again
  if (!res.headersSent) {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      // CORS headers are already set at the beginning
    })
  }
  // Ensure the response ends correctly even if headers were sent
  res.end(JSON.stringify({ // Use JSON.stringify for consistent JSON error response
    error: { // Nest details under 'error' key, common practice
      code, // Use property shorthand
      message: msg,
    },
  }))
}

// --- Helper Functions ---

function keyFromURl(url: string): string {
  const params = new URLSearchParams(url.split('?')[1] || '')
  const key = params.get('key')
  if (!key)
    throw new Error('add param key to url!')

  return key
}

function keyFromHeader(authHeader?: string): string {
  if (!authHeader || !authHeader.startsWith('Bearer '))
    throw new Error('💣 Missing or invalid Authorization header! Format: "Bearer YOUR_API_KEY"')

  return authHeader.substring(7) // Remove "Bearer " prefix
}

function bodyFromRequest(req: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

server.listen(80, () => {
  console.log('Server listening on port 80')
})
