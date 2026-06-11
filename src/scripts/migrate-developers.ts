/**
 * One-time migration — move Azure-synced developers out of the `users`
 * collection into the dedicated `developers` collection.
 *
 * Historically `UsersService.syncFromAzureDevOps()` created one `users` doc per
 * Azure contributor with `isWhitelisted:false` and a random password. The portal
 * is now Admins/Managers only, so those rows are migrated to `developers` and
 * removed from `users`.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-developers.ts [--dry-run]
 *
 * Idempotent: upserts developers by azureDevOpsId, then deletes the migrated
 * user rows. Safe to re-run. Requires .env (MONGODB_URI, MONGODB_DB_NAME).
 *
 * Selection rule: a `users` row is treated as a developer when it is NOT
 * whitelisted (the synced rows) — Admins/Managers are always whitelisted.
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const dryRun = process.argv.includes('--dry-run')

async function main() {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB_NAME ?? 'dev_analytics'
  if (!uri) {
    console.error('MONGODB_URI missing in .env')
    process.exit(1)
  }

  await mongoose.connect(uri, { dbName })
  console.log(`Connected to MongoDB (${dbName})${dryRun ? ' [DRY RUN]' : ''}`)

  const db = mongoose.connection.db!
  const usersCol = db.collection('users')
  const developersCol = db.collection('developers')

  // Synced developers = non-whitelisted user rows. Guard against missing field.
  const candidates = await usersCol
    .find({ isWhitelisted: { $ne: true } })
    .toArray()

  console.log(`Found ${candidates.length} developer row(s) in users to migrate`)

  let migrated = 0
  let skipped = 0

  for (const u of candidates) {
    const azureDevOpsId: string | undefined = u['azureDevOpsId']
    if (!azureDevOpsId) {
      // No Azure linkage — cannot key a developer; leave the row untouched.
      skipped++
      continue
    }

    const developerDoc = {
      azureDevOpsId,
      email: (u['email'] as string | undefined)?.toLowerCase() ?? '',
      emailHash: u['emailHash'],
      displayName: u['name'] ?? '',
      displayNameEncrypted: u['displayNameEncrypted'],
      team: u['team'],
      isActive: u['isActive'] ?? true,
      lastSyncedAt: new Date(),
    }

    if (dryRun) {
      console.log(`  would migrate ${developerDoc.email || azureDevOpsId}`)
      migrated++
      continue
    }

    await developersCol.updateOne(
      { azureDevOpsId },
      {
        $set: developerDoc,
        $setOnInsert: { createdAt: new Date() },
        $currentDate: { updatedAt: true },
      },
      { upsert: true },
    )
    await usersCol.deleteOne({ _id: u['_id'] })
    migrated++
  }

  console.log(
    `✓ Migration complete: ${migrated} migrated, ${skipped} skipped (no azureDevOpsId)`,
  )
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
