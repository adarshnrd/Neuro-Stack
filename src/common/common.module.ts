import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { AllExceptionsFilter } from './filters/all-exceptions.filter'
import { HttpExceptionFilter } from './filters/http-exception.filter'
import { LoggingInterceptor } from './interceptors/logging.interceptor'
import { TimeoutInterceptor } from './interceptors/timeout.interceptor'
import { TransformInterceptor } from './interceptors/transform.interceptor'
import { SecurityMiddleware } from './middlewares/security.middleware'

@Module({
  providers: [
    // Filters: AllExceptions registered first so HttpExceptionFilter (more specific) takes priority
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },

    // Interceptors: outer → inner (logging wraps timeout wraps transform)
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL })
  }
}
