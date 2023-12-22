import http from 'node:http'
import fetch from 'node-fetch'

const API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=`

const server = http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  if (req.method !== 'POST') {
    sendErr(res, '💣 Only POST method allowed!', 405)
    return
  }
  try {
    const body = await bodyFromRequest(req)
    const key = keyFromURl(req.url || '')
    const result = await fetch(API + key, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const json = await result.json()
    res.end(JSON.stringify(json))
  }
  catch (e) {
    const { message } = e as { message: string }
    sendErr(res, `💣 ${message}`)
  }
})

function sendErr(res: http.ServerResponse, msg: string = '💣', code: number = 500) {
  res.statusCode = 500
  res.end(`{
    "code": ${code},
    "message": "${msg}",
  }`)
}

function keyFromURl(url: string) {
  if (!url.includes('?') || !url.includes('key='))
    throw new Error('add param key to url!')
  return url.split('?')[1].split('key=')[1]
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
