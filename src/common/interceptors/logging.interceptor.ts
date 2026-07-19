import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP')

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ method: string; url: string }>()
    const { method, url } = req
    const start = Date.now()

    return next.handle().pipe(
      tap({
        next: () => {
          const res = ctx.switchToHttp().getResponse<{ statusCode: number }>()
          this.logger.log(`${method} ${url} ${res.statusCode} ${Date.now() - start}ms`)
        },
        error: (err: { status?: number }) => {
          const status = err?.status ?? 500
          this.logger.warn(`${method} ${url} ${status} ${Date.now() - start}ms`)
        },
      }),
    )
  }
}
