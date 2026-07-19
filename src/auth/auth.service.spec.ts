import { ConflictException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import * as bcrypt from 'bcryptjs'
import { ConfigService } from '@nestjs/config'
import { AuthService } from './auth.service'
import { UsersService } from '../users/users.service'
import { UserDocument } from '../users/schemas/user.schema'
import { UserRole } from '../users/schemas/user.schema'

const makeUser = (overrides: Partial<UserDocument> = {}): UserDocument =>
  ({
    _id: { toString: () => 'user-id-1' },
    email: 'test@example.com',
    passwordHash: '$2a$12$hashedpassword',
    name: 'Test User',
    role: UserRole.MANAGER,
    isActive: true,
    refreshTokenHash: null,
    ...overrides,
  }) as unknown as UserDocument

describe('AuthService', () => {
  let service: AuthService
  let usersService: jest.Mocked<UsersService>
  let jwtService: jest.Mocked<JwtService>
  let configService: jest.Mocked<ConfigService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
            updateRefreshTokenHash: jest.fn(),
            validateRefreshToken: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const map: Record<string, string> = {
                'jwt.secret': 'access-secret',
                'jwt.refreshSecret': 'refresh-secret',
              }
              return map[key]
            }),
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                'jwt.expiration': '7d',
                'jwt.refreshExpiration': '30d',
              }
              return map[key]
            }),
          },
        },
      ],
    }).compile()

    service = module.get(AuthService)
    usersService = module.get(UsersService)
    jwtService = module.get(JwtService)
    configService = module.get(ConfigService)
  })

  describe('register', () => {
    it('throws ConflictException when email already exists', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser())
      await expect(
        service.register({ email: 'test@example.com', password: 'password1', name: 'Test' }),
      ).rejects.toThrow(ConflictException)
    })

    it('creates user and returns tokens + profile on success', async () => {
      const newUser = makeUser()
      usersService.findByEmail.mockResolvedValue(null)
      usersService.create.mockResolvedValue(newUser)
      usersService.updateRefreshTokenHash.mockResolvedValue(undefined)
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token')

      const result = await service.register({
        email: 'test@example.com',
        password: 'password1',
        name: 'Test User',
      })

      expect(result.accessToken).toBe('access-token')
      expect(result.refreshToken).toBe('refresh-token')
      expect(result.user.email).toBe('test@example.com')
      expect(usersService.updateRefreshTokenHash).toHaveBeenCalledWith('user-id-1', 'refresh-token')
    })

    it('hashes the password before creating user', async () => {
      usersService.findByEmail.mockResolvedValue(null)
      usersService.create.mockResolvedValue(makeUser())
      usersService.updateRefreshTokenHash.mockResolvedValue(undefined)
      jwtService.signAsync.mockResolvedValue('token')

      await service.register({ email: 'a@b.com', password: 'plaintext', name: 'A' })

      const createCall = usersService.create.mock.calls[0][0]
      expect(createCall.passwordHash).not.toBe('plaintext')
      expect(await bcrypt.compare('plaintext', createCall.passwordHash)).toBe(true)
    })
  })

  describe('login', () => {
    it('throws UnauthorizedException when user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null)
      await expect(
        service.login({ email: 'missing@example.com', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('throws UnauthorizedException on wrong password', async () => {
      const user = makeUser({ passwordHash: await bcrypt.hash('correct', 12) })
      usersService.findByEmail.mockResolvedValue(user)
      await expect(service.login({ email: 'test@example.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      )
    })

    it('throws UnauthorizedException when account is disabled', async () => {
      const user = makeUser({
        passwordHash: await bcrypt.hash('password1', 12),
        isActive: false,
      })
      usersService.findByEmail.mockResolvedValue(user)
      await expect(
        service.login({ email: 'test@example.com', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('returns tokens and profile on valid credentials', async () => {
      const user = makeUser({ passwordHash: await bcrypt.hash('password1', 12) })
      usersService.findByEmail.mockResolvedValue(user)
      usersService.updateRefreshTokenHash.mockResolvedValue(undefined)
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token')

      const result = await service.login({ email: 'test@example.com', password: 'password1' })

      expect(result.accessToken).toBe('access-token')
      expect(result.refreshToken).toBe('refresh-token')
      expect(result.user.id).toBe('user-id-1')
    })
  })

  describe('refresh', () => {
    it('issues new token pair and rotates refresh token hash', async () => {
      const user = makeUser()
      usersService.updateRefreshTokenHash.mockResolvedValue(undefined)
      jwtService.signAsync.mockResolvedValueOnce('new-access').mockResolvedValueOnce('new-refresh')

      const tokens = await service.refresh(user)

      expect(tokens.accessToken).toBe('new-access')
      expect(tokens.refreshToken).toBe('new-refresh')
      expect(usersService.updateRefreshTokenHash).toHaveBeenCalledWith('user-id-1', 'new-refresh')
    })
  })

  describe('logout', () => {
    it('clears refresh token hash', async () => {
      usersService.updateRefreshTokenHash.mockResolvedValue(undefined)
      await service.logout('user-id-1')
      expect(usersService.updateRefreshTokenHash).toHaveBeenCalledWith('user-id-1', null)
    })
  })

  describe('generateTokens (via login)', () => {
    it('calls signAsync with correct secrets and expirations', async () => {
      const user = makeUser({ passwordHash: await bcrypt.hash('password1', 12) })
      usersService.findByEmail.mockResolvedValue(user)
      usersService.updateRefreshTokenHash.mockResolvedValue(undefined)
      jwtService.signAsync.mockResolvedValue('token')

      await service.login({ email: 'test@example.com', password: 'password1' })

      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        { sub: 'user-id-1', email: 'test@example.com', role: UserRole.MANAGER },
        { secret: 'access-secret', expiresIn: '7d' },
      )
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        { sub: 'user-id-1', email: 'test@example.com', role: UserRole.MANAGER },
        { secret: 'refresh-secret', expiresIn: '30d' },
      )
    })
  })
})
