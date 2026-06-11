import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { createHash } from 'crypto'
import { Developer, DeveloperDocument } from '@app/database/schemas/developer.schema'
import { EncryptionService } from '@app/shared/encryption/encryption.service'
import { AZURE_GIT_SERVICE, IAzureGitService } from '@app/shared/interfaces/azure-git.interface'

export interface DeveloperProfileDto {
  id: string
  name: string
  displayName?: string
  team?: string
  azureDevOpsId: string
  isActive: boolean
}

/**
 * Owns the `developers` collection — the tracked Azure DevOps contributors.
 *
 * Developers are deliberately NOT portal users: this service is the single
 * source of truth for the azureDevOpsId → displayName/email/team mapping that
 * analytics enrichment and commit-author resolution depend on, kept separate
 * from the auth/user-management surface (`users` = Admins + Managers only).
 */
@Injectable()
export class DevelopersService {
  private readonly logger = new Logger(DevelopersService.name)

  constructor(
    @InjectModel(Developer.name)
    private readonly developerModel: Model<DeveloperDocument>,
    private readonly encryptionService: EncryptionService,
    @Optional()
    @Inject(AZURE_GIT_SERVICE)
    private readonly azureGitService?: IAzureGitService,
  ) {}

  // ─── Email hashing ────────────────────────────────────────────────────────

  hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase()).digest('hex')
  }

  // ─── Finders ─────────────────────────────────────────────────────────────

  async findByAzureId(azureId: string): Promise<DeveloperDocument | null> {
    return this.developerModel.findOne({ azureDevOpsId: azureId }).exec()
  }

  async findByEmailHash(email: string): Promise<DeveloperDocument | null> {
    return this.developerModel.findOne({ emailHash: this.hashEmail(email) }).exec()
  }

  /** azureDevOpsId → decrypted display name, for analytics enrichment. */
  async buildDisplayNameMap(azureIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(azureIds)].filter(Boolean)
    if (!unique.length) return new Map()

    const developers = await this.developerModel.find({ azureDevOpsId: { $in: unique } }).exec()

    const map = new Map<string, string>()
    for (const dev of developers) {
      const name = this.resolveDisplayName(dev)
      if (name) map.set(dev.azureDevOpsId, name)
    }
    return map
  }

  // ─── Auto-create from webhook ────────────────────────────────────────────────

  /**
   * Resolve or create a developer record from a commit author.
   * Called during webhook push processing so every commit lands with a valid
   * authorAzureId rather than an empty string.
   *
   * Resolution order:
   *   1. Existing record by emailHash — returns immediately (no writes).
   *   2. Azure Identities API — gets the real GUID for the email address.
   *   3. Email-based fallback — creates a placeholder record (azureDevOpsId =
   *      "email::<address>") if Azure is unavailable. The next full sync will
   *      upgrade it to the real GUID via the emailHash match.
   */
  async findOrCreateFromCommit(name: string, email: string): Promise<{ azureDevOpsId: string }> {
    const normalised = email.toLowerCase().trim()
    const emailHash = this.hashEmail(normalised)

    // 1. Already known — fast path
    const existing = await this.developerModel.findOne({ emailHash }).exec()
    if (existing) return { azureDevOpsId: existing.azureDevOpsId }

    // 2. Attempt Azure identity lookup to get the real GUID
    let azureDevOpsId: string | null = null
    let resolvedName = name || normalised.split('@')[0]

    if (this.azureGitService) {
      try {
        const identity = await this.azureGitService.resolveUserByEmail(normalised)
        if (identity?.id) {
          azureDevOpsId = identity.id
          if (identity.displayName) resolvedName = identity.displayName
        }
      } catch {
        // non-fatal — fall through to email-based ID
      }
    }

    // 3. Email-based fallback when Azure is unavailable
    if (!azureDevOpsId) {
      azureDevOpsId = `email::${normalised}`
      this.logger.warn(
        `Azure identity lookup unavailable for ${normalised} — using email-based ID (will be upgraded on next sync)`,
      )
    }

    // If the Azure lookup resolved a real GUID, a record for this person may
    // already exist (e.g. created earlier from PR/work-item activity). Reuse it
    // and backfill the email so future commit lookups hit the fast path.
    if (azureDevOpsId && !azureDevOpsId.startsWith('email::')) {
      const byAzureId = await this.developerModel.findOne({ azureDevOpsId }).exec()
      if (byAzureId) {
        if (!byAzureId.email) {
          byAzureId.email = normalised
          byAzureId.emailHash = emailHash
          byAzureId.lastSyncedAt = new Date()
          try {
            await byAzureId.save()
          } catch {
            // non-fatal enrichment
          }
        }
        return { azureDevOpsId: byAzureId.azureDevOpsId }
      }
    }

    // Guard against a concurrent webhook creating the same record
    try {
      await this.developerModel.create({
        azureDevOpsId,
        email: normalised,
        emailHash,
        displayName: resolvedName,
        displayNameEncrypted: this.encryptionService.encrypt(resolvedName),
        isActive: true,
        lastSyncedAt: new Date(),
      })
      this.logger.log(`Auto-created developer: ${resolvedName} <${normalised}> (${azureDevOpsId})`)
    } catch (err: unknown) {
      // Duplicate key — another concurrent request won the race; re-fetch by
      // either unique key (emailHash OR azureDevOpsId).
      if ((err as { code?: number }).code === 11000) {
        const race =
          (await this.developerModel.findOne({ emailHash }).exec()) ??
          (await this.developerModel.findOne({ azureDevOpsId }).exec())
        if (race) return { azureDevOpsId: race.azureDevOpsId }
      }
      throw err
    }

    return { azureDevOpsId }
  }

  /**
   * Resolve or create a developer from an Azure DevOps identity carried by PR or
   * work-item webhooks. Unlike commit authors (git name/email), these payloads
   * give the real Azure user GUID, so dedupe is keyed on `azureDevOpsId`.
   *
   * Idempotent and self-healing: enriches a missing email/displayName when later
   * events supply better data, and upgrades email-based placeholder records
   * (azureDevOpsId = "email::…") created from a prior commit to the real GUID.
   * Returns null when no usable id is provided or creation could not complete —
   * callers treat developer creation as non-fatal.
   */
  async findOrCreateFromAzureIdentity(
    azureDevOpsId: string,
    displayName?: string,
    email?: string,
  ): Promise<DeveloperDocument | null> {
    const azureId = (azureDevOpsId ?? '').trim()
    if (!azureId) return null

    const normalised = email?.toLowerCase().trim() || undefined
    const emailHash = normalised ? this.hashEmail(normalised) : undefined
    const resolvedName = displayName?.trim() || normalised?.split('@')[0] || azureId

    // 1. Existing by real GUID — enrich opportunistically and return.
    const existing = await this.developerModel.findOne({ azureDevOpsId: azureId }).exec()
    if (existing) {
      let dirty = false
      if (normalised && !existing.email) {
        existing.email = normalised
        existing.emailHash = emailHash
        dirty = true
      }
      if (displayName?.trim() && (!existing.displayName || existing.displayName === azureId)) {
        existing.displayName = resolvedName
        existing.displayNameEncrypted = this.encryptionService.encrypt(resolvedName)
        dirty = true
      }
      if (dirty) {
        existing.lastSyncedAt = new Date()
        try {
          await existing.save()
        } catch {
          // non-fatal enrichment
        }
      }
      return existing
    }

    // 2. Upgrade an email-based placeholder (from a prior commit) to the real GUID.
    if (emailHash) {
      const placeholder = await this.developerModel.findOne({ emailHash }).exec()
      if (placeholder) {
        placeholder.azureDevOpsId = azureId
        if (displayName?.trim()) {
          placeholder.displayName = resolvedName
          placeholder.displayNameEncrypted = this.encryptionService.encrypt(resolvedName)
        }
        placeholder.lastSyncedAt = new Date()
        try {
          await placeholder.save()
          return placeholder
        } catch {
          // fall through to a fresh create on failure
        }
      }
    }

    // 3. Create a new record keyed on the real GUID.
    try {
      const created = await this.developerModel.create({
        azureDevOpsId: azureId,
        email: normalised,
        emailHash,
        displayName: resolvedName,
        displayNameEncrypted: this.encryptionService.encrypt(resolvedName),
        isActive: true,
        lastSyncedAt: new Date(),
      })
      this.logger.log(`Auto-created developer: ${resolvedName} (${azureId})`)
      return created
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        const race =
          (await this.developerModel.findOne({ azureDevOpsId: azureId }).exec()) ??
          (emailHash ? await this.developerModel.findOne({ emailHash }).exec() : null)
        if (race) return race
      }
      this.logger.warn(`Failed to auto-create developer ${azureId}: ${String(err)}`)
      return null
    }
  }

  // ─── Azure sync ────────────────────────────────────────────────────────────

  /**
   * Pull the current Azure DevOps org membership into the developers
   * collection. Idempotent: upserts by azureDevOpsId and refreshes
   * displayName/email/team on every run.
   *
   * Also upgrades email-based placeholder records (created during webhook
   * auto-create) to real Azure GUIDs by matching on emailHash.
   */
  async syncFromAzureDevOps(): Promise<{ created: number; updated: number }> {
    if (!this.azureGitService) return { created: 0, updated: 0 }

    let created = 0
    let updated = 0
    const members = await this.azureGitService.getAllOrgMembers()

    for (const member of members) {
      if (!member.id) continue
      const email = (member.emailAddress ?? '').toLowerCase()
      const emailHash = this.hashEmail(email)
      const displayName = member.displayName ?? email.split('@')[0] ?? member.id

      // Try by real GUID first, then by emailHash (catches email-fallback records)
      const existing =
        (await this.developerModel.findOne({ azureDevOpsId: member.id }).exec()) ??
        (await this.developerModel.findOne({ emailHash }).exec())

      if (!existing) {
        await this.developerModel.create({
          azureDevOpsId: member.id,
          email,
          emailHash,
          displayName,
          displayNameEncrypted: this.encryptionService.encrypt(displayName),
          isActive: true,
          lastSyncedAt: new Date(),
        })
        created++
      } else {
        // Upgrade placeholder azureDevOpsId if it was an email-based fallback
        existing.azureDevOpsId = member.id
        existing.email = email
        existing.emailHash = emailHash
        existing.displayName = displayName
        existing.displayNameEncrypted = this.encryptionService.encrypt(displayName)
        existing.lastSyncedAt = new Date()
        await existing.save()
        updated++
      }
    }

    this.logger.log(`Azure developer sync complete: ${created} created, ${updated} updated`)
    return { created, updated }
  }

  // ─── Serialization ──────────────────────────────────────────────────────────

  /** Public-facing developer profile (used by the developer detail page). */
  toProfile(dev: DeveloperDocument): DeveloperProfileDto {
    const displayName = this.resolveDisplayName(dev)
    return {
      id: dev._id.toString(),
      name: displayName || dev.displayName || dev.email || dev.azureDevOpsId,
      displayName: displayName || undefined,
      team: dev.team,
      azureDevOpsId: dev.azureDevOpsId,
      isActive: dev.isActive,
    }
  }

  private resolveDisplayName(dev: DeveloperDocument): string {
    if (dev.displayNameEncrypted) {
      try {
        return this.encryptionService.decrypt(dev.displayNameEncrypted)
      } catch {
        // fall through to plaintext
      }
    }
    return dev.displayName ?? ''
  }
}
