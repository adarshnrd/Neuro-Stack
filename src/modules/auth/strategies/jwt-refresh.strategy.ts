import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { UsersService } from '@app/modules/users/users.service'
import { UserDocument } from '@app/users/schemas/user.schema'
import { JwtPayload } from '../interfaces/jwt-payload.interface'

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Separate secret so a stolen access token cannot be used as a refresh token
      secretOrKey: configService.getOrThrow<string>('jwt.refreshSecret'),
    })
  }

  async validate(payload: JwtPayload): Promise<UserDocument> {
    const user = await this.usersService.findById(payload.sub)
    if (!user || !user.isWhitelisted) {
      throw new UnauthorizedException('Refresh token invalid or access revoked')
    }
    // Bcrypt hash comparison happens in AuthService.refreshTokens() after this guard passes
    return user
  }
}
