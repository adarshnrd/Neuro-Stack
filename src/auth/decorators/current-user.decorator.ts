import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { UserDocument } from '../../users/schemas/user.schema'

export const CurrentUser = createParamDecorator(
  (data: keyof UserDocument | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: UserDocument }>()
    const user = request.user
    return data ? user?.[data] : user
  },
)
