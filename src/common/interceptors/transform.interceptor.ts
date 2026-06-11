import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { ApiResponse } from '../types/api-response.type'

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const response = ctx.switchToHttp().getResponse<{ statusCode: number }>()
    return next.handle().pipe(map((data) => ApiResponse.ok(data, response.statusCode)))
  }
}
