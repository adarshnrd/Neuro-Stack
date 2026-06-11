import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ApiResponse } from '../types/api-response.type'

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost
    const ctx = host.switchToHttp()
    const statusCode = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    let message: string
    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse
    } else {
      const raw = (exceptionResponse as { message?: string | string[] }).message
      message = Array.isArray(raw) ? raw.join('; ') : (raw ?? exception.message)
    }

    httpAdapter.reply(ctx.getResponse(), ApiResponse.error(message, statusCode), statusCode)
  }
}
