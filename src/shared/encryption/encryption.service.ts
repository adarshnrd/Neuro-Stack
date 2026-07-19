import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

@Injectable()
export class EncryptionService {
  private readonly key: Buffer

  constructor(configService: ConfigService) {
    const raw = configService.getOrThrow<string>('ENCRYPTION_KEY')
    // Normalize any string key to exactly 32 bytes via SHA-256
    this.key = createHash('sha256').update(raw).digest()
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    // Layout: [IV(16)] + [ciphertext] + [authTag(16)]
    return Buffer.concat([iv, encrypted, authTag]).toString('hex')
  }

  decrypt(ciphertext: string): string {
    const data = Buffer.from(ciphertext, 'hex')
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Ciphertext too short')
    }
    const iv = data.subarray(0, IV_LENGTH)
    const authTag = data.subarray(data.length - AUTH_TAG_LENGTH)
    const encrypted = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH)

    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }

  encryptObject(obj: Record<string, unknown>): string {
    return this.encrypt(JSON.stringify(obj))
  }

  decryptObject<T = Record<string, unknown>>(ciphertext: string): T {
    return JSON.parse(this.decrypt(ciphertext)) as T
  }
}
