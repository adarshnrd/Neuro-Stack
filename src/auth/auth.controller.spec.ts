import { Test, TestingModule } from '@nestjs/testing'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { UserRole, UserDocument } from '../users/schemas/user.schema'
import { AuthResponseDto, TokensDto } from './dto/auth-response.dto'

const mockProfile = {
  id: 'user-id-1',
  email: 'test@example.com',
  name: 'Test User',
  role: UserRole.MANAGER,
}

const mockTokens: TokensDto = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
}

const mockAuthResponse: AuthResponseDto = { ...mockTokens, user: mockProfile }

const makeUserDoc = (): UserDocument =>
  ({ _id: { toString: () => 'user-id-1' } }) as unknown as UserDocument

describe('AuthController', () => {
  let controller: AuthController
  let authService: jest.Mocked<AuthService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            refresh: jest.fn(),
            logout: jest.fn(),
          },
        },
      ],
    }).compile()

    controller = module.get(AuthController)
    authService = module.get(AuthService)
  })

  describe('register', () => {
    it('delegates to AuthService.register and returns result', async () => {
      authService.register.mockResolvedValue(mockAuthResponse)
      const dto = { email: 'test@example.com', password: 'password1', name: 'Test User' }

      const result = await controller.register(dto)

      expect(authService.register).toHaveBeenCalledWith(dto)
      expect(result).toBe(mockAuthResponse)
    })
  })

  describe('login', () => {
    it('delegates to AuthService.login and returns result', async () => {
      authService.login.mockResolvedValue(mockAuthResponse)
      const dto = { email: 'test@example.com', password: 'password1' }

      const result = await controller.login(dto)

      expect(authService.login).toHaveBeenCalledWith(dto)
      expect(result).toBe(mockAuthResponse)
    })
  })

  describe('refresh', () => {
    it('delegates to AuthService.refresh with the current user document', async () => {
      authService.refresh.mockResolvedValue(mockTokens)
      const user = makeUserDoc()

      const result = await controller.refresh(user)

      expect(authService.refresh).toHaveBeenCalledWith(user)
      expect(result).toBe(mockTokens)
    })
  })

  describe('logout', () => {
    it('calls AuthService.logout with the string representation of _id', async () => {
      authService.logout.mockResolvedValue(undefined)
      const userId = { toString: () => 'user-id-1' }

      await controller.logout(userId)

      expect(authService.logout).toHaveBeenCalledWith('user-id-1')
    })
  })
})
