import http from 'node:http'
import { Buffer } from 'node:buffer'
import fetch, { type Response } from 'node-fetch'

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
      // --- Conversion needs to be async now ---
      let conversionResult: { contents: GeminiContent[] | null, imageProcessed: boolean }
      try {
        // Use Promise.all because convertOpenAIMessagesToGeminiContents is now async
        conversionResult = await convertOpenAIMessagesToGeminiContents(bodyJSON.messages)
      }
      catch (conversionError: any) {
        console.error('Error during message conversion:', conversionError)
        // Send specific error if available, otherwise generic
        const errorMessage = conversionError instanceof Error ? conversionError.message : 'Error processing message content'
        sendErr(res, `💣 ${errorMessage}`, 400)
        return
      }
      // Filter out any null results from failed conversions
      // Handle case where conversionResult itself might be problematic, though the catch should handle errors
      if (!conversionResult || conversionResult.contents === null) {
        // Error already sent in catch block or no valid content produced
        // We might log here, but likely already handled.
        sendErr(res, '💣 Failed to convert message content', 500) // Or use error from catch
        return
      }

      const geminiContents = conversionResult.contents
      const imageProcessed = conversionResult.imageProcessed
      // -------------------------------------

      // Base structure for the request body to Gemini
      const requestBodyToGemini: any = {
        contents: geminiContents,
      }

      // Automatically add generationConfig if an image was processed
      if (imageProcessed) {
        console.log('Image processed, adding default generationConfig with responseModalities.')
        requestBodyToGemini.generationConfig = { responseModalities: ['TEXT', 'IMAGE'] }
      }

      // Allow user to override/provide their own generationConfig
      if (bodyJSON.gemini_generation_config) {
        console.log('User provided gemini_generation_config, overriding default.')
        requestBodyToGemini.generationConfig = bodyJSON.gemini_generation_config
      }

      const geminiBody = JSON.stringify(requestBodyToGemini)
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

// --- Conversion Helper Function --- needs to return more info now
async function convertOpenAIMessagesToGeminiContents(messages: OpenAIMessage[]):
Promise<{ contents: GeminiContent[] | null, imageProcessed: boolean }> {
  let imageProcessedOverall = false // Flag to track if any image was processed

  // Map messages to promises that resolve to GeminiContent or null
  const contentPromises = messages.map(async (message): Promise<GeminiContent | null> => {
    let role: 'user' | 'model' = 'user'
    if (message.role === 'assistant')
      role = 'model'
    else if (message.role === 'system')
      role = 'user'

    const parts: GeminiPart[] = []
    let processedAsImage = false

    // Check for the custom image format: #image#split#{url}#split#{text}
    if (typeof message.content === 'string' && message.content.startsWith('#image#split#')) {
      const partsRaw = message.content.split('#split#')
      if (partsRaw.length === 3) {
        const imageUrl = partsRaw[1]
        const textContent = partsRaw[2]
        processedAsImage = true

        try {
          console.log(`Fetching image from URL: ${imageUrl}`)
          const imageResponse: Response = await fetch(imageUrl)

          if (!imageResponse.ok) {
            // Throw an error that includes the status text
            throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText} from ${imageUrl}`)
          }

          const mimeType = imageResponse.headers.get('content-type') || 'application/octet-stream' // Get MIME type or default
          const imageBuffer = await imageResponse.arrayBuffer()
          const imageBase64 = Buffer.from(imageBuffer).toString('base64')

          console.log(`Successfully fetched and encoded image. MimeType: ${mimeType}, Base64 Length: ${imageBase64.length}`)

          // Add text part first, then image part
          parts.push({ text: textContent })
          parts.push({ inlineData: { mimeType, data: imageBase64 } })
          // ----> Set the overall flag if successful <----
          imageProcessedOverall = true
        }
        catch (error: any) {
          console.error(`Error processing image URL ${imageUrl}:`, error)
          // Decide how to handle image fetching errors.
          // Option 1: Skip the image, only include text (could be confusing)
          // parts.push({ text: `${textContent} (Error fetching image: ${error.message})` });
          // Option 2: Throw the error up, causing the entire request for this message to potentially fail
          // throw error; // Re-throw the error to be caught by the outer try/catch in createServer
          // Option 3: Return null for this message, filtering it out later
          return null
        }
      }
    }

    // If not processed as custom image format, handle as regular text or array
    if (!processedAsImage) {
      if (typeof message.content === 'string') {
        parts.push({ text: message.content })
      }
      else if (Array.isArray(message.content)) {
        message.content.forEach((item) => {
          if (item.type === 'text' && typeof item.text === 'string') {
            parts.push({ text: item.text })
          }
          // Keep the basic URL-as-text handling for the standard OpenAI vision format
          else if (item.type === 'image_url' && item.image_url && typeof item.image_url.url === 'string') {
            console.warn('Standard OpenAI image_url detected. Passing URL as text.')
            parts.push({ text: `Image URL: ${item.image_url.url}` })
          }
        })
      }
      else {
        console.warn(`Unsupported message content type: ${typeof message.content}. Skipping content.`)
      }
    }

    // Only return content if parts were successfully generated
    if (parts.length > 0) {
      return { role, parts }
    }
    else {
      // This case might happen if content was empty or unsupported type and not image format
      console.warn('Message resulted in empty parts, filtering out.')
      return null
    }
  }) // End of messages.map

  // Wait for all image fetching/conversion promises to settle
  const settledContents = await Promise.all(contentPromises)

  // Filter out nulls (from errors or empty parts) and get the valid GeminiContent array
  const finalContents = settledContents.filter((content): content is GeminiContent => content !== null)

  // Return both the contents and the flag indicating if any image was processed
  return { contents: finalContents, imageProcessed: imageProcessedOverall }
}

// --- End Conversion Helper ---

server.listen(80, () => {
  console.log('Server listening on port 80')
})
