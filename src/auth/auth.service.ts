import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { UsersService } from '../users/users.service'
import { UserDocument } from '../users/schemas/user.schema'
import { UserProfileDto } from '../users/dto/user-profile.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { AuthResponseDto, TokensDto } from './dto/auth-response.dto'
import { JwtPayload } from './interfaces/jwt-payload.interface'

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.usersService.findByEmail(dto.email)
    if (existing) throw new ConflictException('Email is already registered')

    const passwordHash = await bcrypt.hash(dto.password, 12)
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
      role: dto.role,
    })

    const tokens = await this.generateTokens(user)
    await this.usersService.updateRefreshTokenHash(user._id.toString(), tokens.refreshToken)
    return { ...tokens, user: this.toProfile(user) }
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email)
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials')

    if (!user.isActive) throw new UnauthorizedException('Account is disabled')

    const tokens = await this.generateTokens(user)
    await this.usersService.updateRefreshTokenHash(user._id.toString(), tokens.refreshToken)
    return { ...tokens, user: this.toProfile(user) }
  }

  async refresh(user: UserDocument): Promise<TokensDto> {
    const tokens = await this.generateTokens(user)
    await this.usersService.updateRefreshTokenHash(user._id.toString(), tokens.refreshToken)
    return tokens
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.updateRefreshTokenHash(userId, null)
  }

  private async generateTokens(user: UserDocument): Promise<TokensDto> {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.secret'),
        expiresIn: this.configService.get<string>('jwt.expiration') ?? '7d',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiration') ?? '30d',
      }),
    ])

    return { accessToken, refreshToken }
  }

  private toProfile(user: UserDocument): UserProfileDto {
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    }
  }
}
