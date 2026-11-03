import 'dotenv/config'
import Koa from 'koa'
import cors from '@koa/cors'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import { hasRealAgent } from './agent'
import { chatHandler } from './routes/chat'
import { actionHandler } from './routes/action'

const app = new Koa()
const router = new Router()

app.use(cors())
// 图片 base64 编码后易超 1mb，调高上限避免 413。
app.use(bodyParser({ jsonLimit: '20mb', formLimit: '20mb' }))

router.get('/api/health', (ctx) => {
  ctx.body = { ok: true, hasRealAgent: hasRealAgent() }
})

router.post('/api/chat', chatHandler)
router.post('/api/action', actionHandler)

app.use(router.routes()).use(router.allowedMethods())

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`[a2ui-server] listening on http://127.0.0.1:${PORT}`)
})
