import http from 'node:http'
import fetch from 'node-fetch'

const BASE_API = `https://generativelanguage.googleapis.com/v1beta/models`
// const API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=` // Keep original for reference or specific use

// Define simple interfaces for type safety
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | any // Keep 'any' for now to handle potential complex content
}

interface GeminiPart {
  text?: string
  inlineData?: {
    mimeType: string
    data: string
  }
  // Add other part types like fileData if needed
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

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
      const model = bodyJSON.model // Extract model from request body

      if (!model) {
        sendErr(res, '💣 Missing "model" field in request body!', 400)
        return
      }

      // --- Convert OpenAI messages to Gemini contents ---
      if (!Array.isArray(bodyJSON.messages)) {
        sendErr(res, '💣 Missing or invalid "messages" array in request body!', 400)
        return
      }

      const geminiContents: GeminiContent[] = convertOpenAIMessagesToGeminiContents(bodyJSON.messages)

      const geminiBody = JSON.stringify({
        contents: geminiContents,
        // TODO: Optionally map other parameters like temperature, max_tokens
        // generationConfig: { ... }
      })
      // ---------------------------------------------

      // Construct Gemini API URL dynamically
      const geminiUrl = `${BASE_API}/${model}:generateContent?key=${apiKey}`

      const result = await fetch(geminiUrl, {
        method: 'POST',
        body: geminiBody, // Use the converted Gemini format body
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

// --- Conversion Helper Function ---
function convertOpenAIMessagesToGeminiContents(messages: OpenAIMessage[]): GeminiContent[] {
  return messages.map((message) => {
    let role: 'user' | 'model' = 'user' // Default to user
    if (message.role === 'assistant')
      role = 'model'
    // Note: Gemini API doesn't have a distinct 'system' role in the contents array.
    // System prompts are often handled as the first part of the 'user' turn
    // or via specific configuration. We map 'system' to 'user' here.
    else if (message.role === 'system')
      role = 'user'
    // Could potentially prepend text like "System Prompt: " to the content

    const parts: GeminiPart[] = [] // Use const as parts array is not reassigned, only mutated
    if (typeof message.content === 'string') {
      parts.push({ text: message.content })
    }
    // Basic handling for OpenAI vision format (array content)
    else if (Array.isArray(message.content)) {
      message.content.forEach((item) => {
        if (item.type === 'text' && typeof item.text === 'string') {
          parts.push({ text: item.text })
        }
        // Rudimentary image URL handling: pass URL as text
        // For full image support, fetch URL, base64 encode, and create inlineData part
        else if (item.type === 'image_url' && item.image_url && typeof item.image_url.url === 'string') {
          console.warn('Image URL detected. Passing URL as text. Full image processing not implemented.')
          parts.push({ text: `Image URL: ${item.image_url.url}` })
        }
      })
    }
    // Handle other potential content types if necessary
    else {
      console.warn(`Unsupported message content type: ${typeof message.content}. Skipping content.`)
    }

    return { role, parts }
  }).filter(content => content.parts.length > 0) // Filter out messages that couldn't be converted
}

// --- End Conversion Helper ---

server.listen(80, () => {
  console.log('Server listening on port 80')
})
