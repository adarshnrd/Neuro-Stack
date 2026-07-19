import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import * as bcrypt from 'bcryptjs'
import { UsersService } from './users.service'
import { User, UserDocument, UserRole } from './schemas/user.schema'

const makeUser = (overrides: Partial<UserDocument> = {}): UserDocument =>
  ({
    _id: { toString: () => 'user-id-1' },
    email: 'test@example.com',
    passwordHash: 'hashed',
    name: 'Test',
    role: UserRole.MANAGER,
    isActive: true,
    refreshTokenHash: null,
    save: jest.fn().mockReturnThis(),
    ...overrides,
  }) as unknown as UserDocument

describe('UsersService', () => {
  let service: UsersService
  let modelMock: {
    new: jest.Mock
    findById: jest.Mock
    findOne: jest.Mock
    findByIdAndUpdate: jest.Mock
    prototype: { save: jest.Mock }
  }

  beforeEach(async () => {
    const savedUser = makeUser()
    const saveMock = jest.fn().mockResolvedValue(savedUser)

    modelMock = jest.fn().mockImplementation(() => ({ save: saveMock })) as any
    modelMock.findById = jest.fn()
    modelMock.findOne = jest.fn()
    modelMock.findByIdAndUpdate = jest.fn()

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: getModelToken(User.name), useValue: modelMock }],
    }).compile()

    service = module.get(UsersService)
  })

  describe('create', () => {
    it('instantiates the model and calls save', async () => {
      const result = await service.create({
        email: 'test@example.com',
        passwordHash: 'hashed',
        name: 'Test',
      })
      expect(result.email).toBe('test@example.com')
    })
  })

  describe('findById', () => {
    it('returns user when found', async () => {
      const user = makeUser()
      modelMock.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) })

      const result = await service.findById('user-id-1')
      expect(modelMock.findById).toHaveBeenCalledWith('user-id-1')
      expect(result).toBe(user)
    })

    it('returns null when not found', async () => {
      modelMock.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })

      expect(await service.findById('missing-id')).toBeNull()
    })
  })

  describe('findByEmail', () => {
    it('lowercases the email before querying', async () => {
      const user = makeUser()
      modelMock.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) })

      await service.findByEmail('TEST@EXAMPLE.COM')
      expect(modelMock.findOne).toHaveBeenCalledWith({ email: 'test@example.com' })
    })
  })

  describe('updateRefreshTokenHash', () => {
    it('stores a bcrypt hash when token is provided', async () => {
      modelMock.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })

      await service.updateRefreshTokenHash('user-id-1', 'some-refresh-token')

      const updateCall = modelMock.findByIdAndUpdate.mock.calls[0]
      expect(updateCall[0]).toBe('user-id-1')
      const hash = updateCall[1].refreshTokenHash
      expect(typeof hash).toBe('string')
      expect(await bcrypt.compare('some-refresh-token', hash)).toBe(true)
    })

    it('sets hash to null when token is null (logout)', async () => {
      modelMock.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })

      await service.updateRefreshTokenHash('user-id-1', null)

      const updateCall = modelMock.findByIdAndUpdate.mock.calls[0]
      expect(updateCall[1].refreshTokenHash).toBeNull()
    })
  })

  describe('validateRefreshToken', () => {
    it('returns user when token matches stored hash', async () => {
      const token = 'my-refresh-token'
      const hash = await bcrypt.hash(token, 10)
      const user = makeUser({ refreshTokenHash: hash })

      modelMock.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) })

      const result = await service.validateRefreshToken('user-id-1', token)
      expect(result).toBe(user)
    })

    it('returns null when token does not match', async () => {
      const hash = await bcrypt.hash('correct-token', 10)
      const user = makeUser({ refreshTokenHash: hash })
      modelMock.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) })

      expect(await service.validateRefreshToken('user-id-1', 'wrong-token')).toBeNull()
    })

    it('returns null when user has no refresh token hash', async () => {
      const user = makeUser({ refreshTokenHash: null })
      modelMock.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) })

      expect(await service.validateRefreshToken('user-id-1', 'any-token')).toBeNull()
    })

    it('returns null when user is inactive', async () => {
      const hash = await bcrypt.hash('token', 10)
      const user = makeUser({ refreshTokenHash: hash, isActive: false })
      modelMock.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) })

      expect(await service.validateRefreshToken('user-id-1', 'token')).toBeNull()
    })

    it('returns null when user is not found', async () => {
      modelMock.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })

      expect(await service.validateRefreshToken('missing-id', 'token')).toBeNull()
    })
  })
})
