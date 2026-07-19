import { UnauthorizedException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtRefreshStrategy } from './jwt-refresh.strategy'
import { UsersService } from '../../users/users.service'
import { UserDocument, UserRole } from '../../users/schemas/user.schema'

const makeUser = (): UserDocument =>
  ({
    _id: { toString: () => 'user-id-1' },
    email: 'test@example.com',
    role: UserRole.MANAGER,
    isActive: true,
  }) as unknown as UserDocument

const makeReq = (token?: string) => ({
  headers: { authorization: token ? `Bearer ${token}` : undefined },
})

describe('JwtRefreshStrategy', () => {
  let strategy: JwtRefreshStrategy
  let usersService: jest.Mocked<UsersService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtRefreshStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('test-refresh-secret-at-least-32-chars'),
          },
        },
        {
          provide: UsersService,
          useValue: { validateRefreshToken: jest.fn() },
        },
      ],
    }).compile()

    strategy = module.get(JwtRefreshStrategy)
    usersService = module.get(UsersService)
  })

  const payload = { sub: 'user-id-1', email: 'test@example.com', role: UserRole.MANAGER }

  describe('validate', () => {
    it('returns user when refresh token is valid', async () => {
      const user = makeUser()
      usersService.validateRefreshToken.mockResolvedValue(user)

      const result = await strategy.validate(makeReq('valid-refresh-token'), payload)

      expect(usersService.validateRefreshToken).toHaveBeenCalledWith(
        'user-id-1',
        'valid-refresh-token',
      )
      expect(result).toBe(user)
    })

    it('throws UnauthorizedException when authorization header is missing', async () => {
      await expect(strategy.validate(makeReq(), payload)).rejects.toThrow(UnauthorizedException)
    })

    it('throws UnauthorizedException when token is invalid or expired', async () => {
      usersService.validateRefreshToken.mockResolvedValue(null)

      await expect(strategy.validate(makeReq('invalid-token'), payload)).rejects.toThrow(
        UnauthorizedException,
      )
    })
  })
})
