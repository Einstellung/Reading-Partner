#!/usr/bin/env node
// Direct call to the Right Code async drawing relay, same protocol as
// ppt-generation/server/rc-image-mcp.mjs, without going through MCP.
// usage: node gen.mjs --name front-blue --prompt-file p.txt [--model gpt-image-2.5] [--size 1024x1024] [--ref a.png ...]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const envFile = '/home/xinyuan/Documents/ppt-generation/.env'
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const KEY = process.env.RC_API_KEY
const DRAW = (process.env.RC_BASE_URL || 'https://right.codes/draw').replace(/\/+$/, '')
const TASKS = (process.env.RC_TASKS_URL || 'https://right.codes/v1/tasks').replace(/\/+$/, '')
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out')

const args = process.argv.slice(2)
const opt = { model: 'gpt-image-2.5', size: '1024x1024', refs: [], n: 1 }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--name') opt.name = args[++i]
  else if (a === '--prompt-file') opt.prompt = readFileSync(args[++i], 'utf8').trim()
  else if (a === '--prompt') opt.prompt = args[++i]
  else if (a === '--model') opt.model = args[++i]
  else if (a === '--size') opt.size = args[++i]
  else if (a === '--n') opt.n = Number(args[++i])
  else if (a === '--ref') opt.refs.push(args[++i])
}
if (!opt.name || !opt.prompt) throw new Error('need --name and --prompt/--prompt-file')

const log = (...a) => process.stderr.write(`[${opt.name}] ${a.join(' ')}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function http(url, init = {}, label = 'request') {
  let last
  for (let i = 0; i < 4; i++) {
    if (i > 0) await sleep(Math.min(1000 * 2 ** (i - 1), 8000))
    try {
      const res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(60000),
      })
      const text = await res.text()
      if (!res.ok) {
        if (res.status !== 429 && res.status < 500) throw new Error(`${label} ${res.status}: ${text.slice(0, 400)}`)
        last = new Error(`${label} ${res.status}: ${text.slice(0, 200)}`)
        log(`retry ${i + 1}: ${last.message}`)
        continue
      }
      return JSON.parse(text)
    } catch (e) {
      if (/ [4]\d\d:/.test(String(e.message))) throw e
      last = e
      log(`retry ${i + 1}: ${e.message}`)
    }
  }
  throw last
}

async function toDataUrl(p) {
  const buf = await readFile(p)
  const ext = path.extname(p).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

function urlsOf(task) {
  const out = []
  for (const d of task?.data || []) {
    if (typeof d?.url === 'string') out.push(d.url)
    if (d?.b64_json) out.push({ b64: d.b64_json })
  }
  return out
}
function statusOf(task) {
  const s = String(task?.status || '').toLowerCase()
  if (['completed', 'succeeded', 'success'].includes(s)) return 'completed'
  if (['failed', 'error', 'cancelled'].includes(s)) return 'failed'
  if (urlsOf(task).length) return 'completed'
  return 'in_progress'
}

const body = { model: opt.model, prompt: opt.prompt, n: opt.n, size: opt.size, async: true }
if (opt.refs.length) body.image = await Promise.all(opt.refs.map(toDataUrl))
const submitted = await http(`${DRAW}/v1/images/generations`, { method: 'POST', body: JSON.stringify(body) }, 'submit')
const taskId = submitted.task_id || submitted.id
if (!taskId) throw new Error(`no task_id: ${JSON.stringify(submitted).slice(0, 300)}`)
log(`task ${taskId}`)
await mkdir(OUT, { recursive: true })
await writeFile(path.join(OUT, `${opt.name}.task.json`), JSON.stringify({ taskId, ...opt, refs: opt.refs, submitted_at: new Date().toISOString() }, null, 2))

const deadline = Date.now() + 420_000
let delay = 3000
let task
while (Date.now() < deadline) {
  task = await http(`${TASKS}/${encodeURIComponent(taskId)}`, { method: 'GET' }, 'task')
  const st = statusOf(task)
  if (st === 'completed') {
    const urls = urlsOf(task)
    const files = []
    for (const [i, u] of urls.entries()) {
      const dest = path.join(OUT, `${opt.name}${urls.length > 1 ? `-${i + 1}` : ''}.png`)
      let buf
      if (typeof u === 'object') buf = Buffer.from(u.b64, 'base64')
      else {
        const res = await fetch(u, { signal: AbortSignal.timeout(120000) })
        buf = Buffer.from(await res.arrayBuffer())
      }
      await writeFile(dest, buf)
      files.push(dest)
    }
    console.log(JSON.stringify({ status: 'completed', taskId, files }))
    process.exit(0)
  }
  if (st === 'failed') {
    console.log(JSON.stringify({ status: 'failed', taskId, error: task?.error || task }))
    process.exit(1)
  }
  log(`progress ${task?.progress ?? '?'}`)
  await sleep(delay)
  delay = Math.min(delay * 1.3, 10000)
}
console.log(JSON.stringify({ status: 'timeout', taskId }))
process.exit(2)
