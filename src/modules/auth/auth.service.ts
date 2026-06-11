import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import * as bcrypt from 'bcryptjs'
import { UserDocument } from '@app/users/schemas/user.schema'
import { UsersService } from '@app/modules/users/users.service'
import { SanitizedUserDto } from '@app/modules/users/dto/user-profile.dto'
import { LoginEvent, LoginEventDocument } from '@app/database/schemas/login-event.schema'
import { JwtPayload } from './interfaces/jwt-payload.interface'
import { AuthResponseDto, TokensDto } from './dto/auth-response.dto'

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(LoginEvent.name)
    private readonly loginEventModel: Model<LoginEventDocument>,
  ) {}

  async login(email: string, password: string, ipAddress?: string): Promise<AuthResponseDto> {
    // Load user including select:false secrets needed for auth
    const user = await this.usersService.findByEmailForAuth(email)
    if (!user) throw new UnauthorizedException('Invalid credentials')

    if (!user.isWhitelisted) {
      throw new ForbiddenException('Account is not whitelisted for access')
    }

    if (user.isLocked) {
      throw new HttpException(`ACCOUNT_LOCKED_UNTIL:${user.lockUntil!.toISOString()}`, 423)
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash)

    if (!passwordValid) {
      user.loginAttempts = (user.loginAttempts ?? 0) + 1
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1_000)
      }
      await user.save()
      throw new UnauthorizedException('Invalid credentials')
    }

    user.loginAttempts = 0
    user.lockUntil = undefined
    user.lastLoginAt = new Date()
    await user.save()

    await this.recordLoginEvent(user, ipAddress)

    return this.generateTokens(user)
  }

  /**
   * Append-only login record powering admin-only daily login analytics.
   * Failures are swallowed — a logging hiccup must never block authentication.
   */
  private async recordLoginEvent(user: UserDocument, ipAddress?: string): Promise<void> {
    try {
      const now = new Date()
      const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
        now.getUTCDate(),
      ).padStart(2, '0')}`
      await this.loginEventModel.create({
        userId: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        date,
        ipAddress,
      })
    } catch {
      // Non-fatal — never block login on analytics write
    }
  }

  async refreshTokens(userId: string, rawRefreshToken: string): Promise<TokensDto> {
    const user = await this.usersService.findByIdForRefresh(userId)
    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token invalid or expired')
    }

    const isValid = await bcrypt.compare(rawRefreshToken, user.refreshTokenHash)
    if (!isValid) throw new UnauthorizedException('Refresh token invalid or expired')

    // Rotate: issue new pair and overwrite stored hash
    const { accessToken, refreshToken } = await this.signTokenPair(user)
    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10)
    await user.save()

    return { accessToken, refreshToken }
  }

  async logout(userId: string): Promise<void> {
    const user = await this.usersService.findByIdForRefresh(userId)
    if (!user) return
    user.refreshTokenHash = null
    await user.save()
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async generateTokens(user: UserDocument): Promise<AuthResponseDto> {
    const { accessToken, refreshToken } = await this.signTokenPair(user)
    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10)
    await user.save()
    return { accessToken, refreshToken, user: this.toProfile(user) }
  }

  private async signTokenPair(
    user: UserDocument,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      azureId: user.azureDevOpsId,
      role: user.role,
    }
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.secret'),
        expiresIn: this.configService.get<string>('jwt.expiration') ?? '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiration') ?? '7d',
      }),
    ])
    return { accessToken, refreshToken }
  }

  private toProfile(user: UserDocument): SanitizedUserDto {
    return this.usersService.sanitizeUser(user)
  }
}
