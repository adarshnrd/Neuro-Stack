import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ApiResponse } from '../types/api-response.type'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // HttpExceptionFilter handles HttpException; this filter covers everything else.
    if (exception instanceof HttpException) return

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    )

    const { httpAdapter } = this.httpAdapterHost
    const ctx = host.switchToHttp()
    httpAdapter.reply(
      ctx.getResponse(),
      ApiResponse.error('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR),
      HttpStatus.INTERNAL_SERVER_ERROR,
    )
  }
}
