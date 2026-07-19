import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole } from '../types/roles.enum'
import { ROLES_KEY } from '../decorators/roles.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    // No @Roles() on this route → any authenticated user is allowed
    if (!required?.length) return true

    const user = ctx.switchToHttp().getRequest<{ user?: { role: UserRole } }>().user

    return !!user && required.includes(user.role)
  }
}
