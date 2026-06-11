import { UnauthorizedException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtStrategy } from './jwt.strategy'
import { UsersService } from '../../users/users.service'
import { UserDocument, UserRole } from '../../users/schemas/user.schema'

const makeUser = (overrides: Partial<UserDocument> = {}): UserDocument =>
  ({
    _id: { toString: () => 'user-id-1' },
    email: 'test@example.com',
    role: UserRole.MANAGER,
    isActive: true,
    ...overrides,
  }) as unknown as UserDocument

describe('JwtStrategy', () => {
  let strategy: JwtStrategy
  let usersService: jest.Mocked<UsersService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('test-jwt-secret-at-least-32-chars-long'),
          },
        },
        {
          provide: UsersService,
          useValue: { findById: jest.fn() },
        },
      ],
    }).compile()

    strategy = module.get(JwtStrategy)
    usersService = module.get(UsersService)
  })

  describe('validate', () => {
    const payload = { sub: 'user-id-1', email: 'test@example.com', role: UserRole.MANAGER }

    it('returns user when token is valid and account is active', async () => {
      const user = makeUser()
      usersService.findById.mockResolvedValue(user)

      const result = await strategy.validate(payload)

      expect(usersService.findById).toHaveBeenCalledWith('user-id-1')
      expect(result).toBe(user)
    })

    it('throws UnauthorizedException when user is not found', async () => {
      usersService.findById.mockResolvedValue(null)

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException)
    })

    it('throws UnauthorizedException when account is inactive', async () => {
      usersService.findById.mockResolvedValue(makeUser({ isActive: false }))

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException)
    })
  })
})
