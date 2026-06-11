import { Injectable, Logger, NestMiddleware } from '@nestjs/common'
import { randomUUID } from 'crypto'

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request')

  use(req: Record<string, unknown>, res: Record<string, unknown>, next: () => void): void {
    const requestId = randomUUID()

    req['requestId'] = requestId

    // Fastify uses reply.header(); Express uses res.setHeader()
    if (typeof res['header'] === 'function') {
      ;(res as { header(name: string, value: string): void }).header('X-Request-ID', requestId)
    } else if (typeof res['setHeader'] === 'function') {
      ;(res as { setHeader(name: string, value: string): void }).setHeader(
        'X-Request-ID',
        requestId,
      )
    }

    const headers = req['headers'] as Record<string, string | string[] | undefined> | undefined
    const ip =
      (req['ip'] as string | undefined) ??
      (req['connection'] as { remoteAddress?: string } | undefined)?.remoteAddress ??
      'unknown'
    const userAgent = (headers?.['user-agent'] as string | undefined) ?? 'unknown'

    this.logger.log(`[${requestId}] ${ip} "${userAgent}"`)
    next()
  }
}
