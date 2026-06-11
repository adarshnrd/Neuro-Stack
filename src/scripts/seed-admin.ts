/**
 * One-time bootstrap script — creates the first ADMIN user.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts \
 *     --email admin@example.com \
 *     --password YourPassword123 \
 *     --name "Admin User"
 *
 * Requires .env to be present (reads MONGODB_URI, MONGODB_DB_NAME, ENCRYPTION_KEY).
 * Safe to re-run — exits without error if the email already exists.
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { createHash, createCipheriv, randomBytes } from 'crypto'
import * as bcrypt from 'bcryptjs'

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .match(/--(\w+)\s+([^\s-][^\s]*)/g)
    ?.map((s) => {
      const [k, v] = s.replace('--', '').split(/\s+/)
      return [k, v]
    }) ?? [],
)

const email = args['email']
const password = args['password']
const name = args['name'] ?? email?.split('@')[0] ?? 'Admin'

if (!email || !password) {
  console.error('Usage: seed-admin.ts --email <email> --password <password> [--name <name>]')
  process.exit(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashEmail(e: string): string {
  return createHash('sha256').update(e.toLowerCase()).digest('hex')
}

function encryptName(plaintext: string, keyRaw: string): string {
  const key = createHash('sha256').update(keyRaw).digest()
  const iv = randomBytes(16) // must match EncryptionService IV_LENGTH=16
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Layout must match EncryptionService: [iv(16)] + [ciphertext] + [authTag(16)], hex
  return Buffer.concat([iv, encrypted, authTag]).toString('hex')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB_NAME ?? 'dev_analytics'
  const encKey = process.env.ENCRYPTION_KEY

  if (!uri) { console.error('MONGODB_URI missing in .env'); process.exit(1) }
  if (!encKey) { console.error('ENCRYPTION_KEY missing in .env'); process.exit(1) }

  await mongoose.connect(uri, { dbName })
  console.log('Connected to MongoDB')

  const db = mongoose.connection.db!
  const users = db.collection('users')

  const emailLower = email.toLowerCase()
  const emailHash = hashEmail(emailLower)

  const existing = await users.findOne({ emailHash })
  if (existing) {
    console.log(`User ${emailLower} already exists — nothing to do.`)
    await mongoose.disconnect()
    return
  }

  const [passwordHash, displayNameEncrypted] = await Promise.all([
    bcrypt.hash(password, 12),
    Promise.resolve(encryptName(name, encKey)),
  ])

  await users.insertOne({
    email: emailLower,
    emailHash,
    name,
    passwordHash,
    displayNameEncrypted,
    role: 'admin',
    isActive: true,
    isWhitelisted: true,
    loginAttempts: 0,
    refreshTokenHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  console.log(`✓ Admin user created: ${emailLower}`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
