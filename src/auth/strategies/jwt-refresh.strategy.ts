import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { UsersService } from '../../users/users.service'
import { UserDocument } from '../../users/schemas/user.schema'
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
      secretOrKey: configService.getOrThrow<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    })
  }

  async validate(
    req: { headers: { authorization?: string } },
    payload: JwtPayload,
  ): Promise<UserDocument> {
    const refreshToken = req.headers.authorization?.split(' ')[1]
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing')

    const user = await this.usersService.validateRefreshToken(payload.sub, refreshToken)
    if (!user) throw new UnauthorizedException('Refresh token invalid or expired')
    return user
  }
}
