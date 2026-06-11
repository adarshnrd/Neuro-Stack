import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'

import { Organization, OrganizationDocument } from '@app/database/schemas/organization.schema'
import { Project, ProjectDocument } from '@app/database/schemas/project.schema'
import { Repository, RepositoryDocument } from '@app/database/schemas/repository.schema'
import { Team, TeamDocument } from '@app/database/schemas/team.schema'
import { EncryptionService } from '@app/shared/encryption/encryption.service'
import { AzureClientFactory, OrgAzureClient } from '@app/shared/azure/azure-client.factory'

import { CreateOrganizationDto } from './dto/create-organization.dto'
import { UpdateOrganizationDto } from './dto/update-organization.dto'

export interface OrgSyncResult {
  projects: number
  repositories: number
  teams: number
}

/**
 * Owns the `organizations` collection and the hierarchy beneath it
 * (`projects` / `repositories` / `teams`). Each organization stores its Azure
 * PAT encrypted at rest; this service is the single place that decrypts it to
 * build a per-org Azure client (via {@link AzureClientFactory}).
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name)

  constructor(
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Repository.name)
    private readonly repoModel: Model<RepositoryDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    private readonly encryption: EncryptionService,
    private readonly clientFactory: AzureClientFactory,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async create(dto: CreateOrganizationDto, userId: string): Promise<OrganizationDocument> {
    const orgUrl = normalizeUrl(dto.orgUrl)

    if (await this.orgModel.exists({ orgUrl })) {
      throw new ConflictException('An organization with this URL is already connected')
    }

    const authenticated = await this.clientFactory.probe(orgUrl, dto.pat)
    if (!authenticated) {
      throw new BadRequestException(
        'Could not authenticate to Azure DevOps with the provided URL and PAT',
      )
    }

    const org = await this.orgModel.create({
      name: dto.name,
      clientName: dto.clientName,
      azureOrgSlug: slugFromUrl(orgUrl),
      orgUrl,
      patEncrypted: this.encryption.encrypt(dto.pat),
      patLast4: dto.pat.slice(-4),
      patUpdatedByUserId: new Types.ObjectId(userId),
      webhookSecret: dto.webhookSecret,
      isActive: true,
    })

    this.logger.log(`Organization connected: ${dto.name} (${orgUrl})`)
    return org
  }

  async findAll(): Promise<OrganizationDocument[]> {
    return this.orgModel.find().sort({ createdAt: -1 }).exec()
  }

  async findOne(id: string): Promise<OrganizationDocument> {
    const org = await this.orgModel.findById(id).exec()
    if (!org) throw new NotFoundException('Organization not found')
    return org
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
    userId: string,
  ): Promise<OrganizationDocument> {
    const org = await this.orgModel.findById(id).select('+patEncrypted').exec()
    if (!org) throw new NotFoundException('Organization not found')

    if (dto.name !== undefined) org.name = dto.name
    if (dto.clientName !== undefined) org.clientName = dto.clientName
    if (dto.webhookSecret !== undefined) org.webhookSecret = dto.webhookSecret
    if (dto.isActive !== undefined) org.isActive = dto.isActive

    if (dto.pat) {
      const authenticated = await this.clientFactory.probe(org.orgUrl, dto.pat)
      if (!authenticated) {
        throw new BadRequestException('Could not authenticate to Azure DevOps with the new PAT')
      }
      org.patEncrypted = this.encryption.encrypt(dto.pat)
      org.patLast4 = dto.pat.slice(-4)
      org.patUpdatedByUserId = new Types.ObjectId(userId)
    }

    // Any credential/activation change must drop the cached client.
    if (dto.pat || dto.isActive === false) this.clientFactory.invalidate(org.orgUrl)

    await org.save()
    return org
  }

  async deactivate(id: string): Promise<void> {
    const org = await this.orgModel.findById(id).exec()
    if (!org) throw new NotFoundException('Organization not found')
    org.isActive = false
    await org.save()
    this.clientFactory.invalidate(org.orgUrl)
    this.logger.log(`Organization deactivated: ${org.name} (${org.orgUrl})`)
  }

  // ── Drill-down reads ─────────────────────────────────────────────────────────

  async listProjects(id: string): Promise<ProjectDocument[]> {
    return this.projectModel.find({ organizationId: new Types.ObjectId(id) }).sort({ name: 1 }).exec()
  }

  // ── Per-org Azure client ─────────────────────────────────────────────────────

  /**
   * Resolve an organization's authenticated Azure client (decrypts the PAT).
   * Used by hierarchy sync now, and by the webhook processors in a later chunk.
   */
  async getClientForOrg(id: string): Promise<{ org: OrganizationDocument; client: OrgAzureClient }> {
    const org = await this.orgModel.findById(id).select('+patEncrypted').exec()
    if (!org) throw new NotFoundException('Organization not found')
    if (!org.isActive) throw new BadRequestException('Organization is deactivated')
    const pat = this.encryption.decrypt(org.patEncrypted)
    return { org, client: this.clientFactory.getClient(org.orgUrl, pat) }
  }

  // ── Hierarchy sync (projects → repositories → teams) ─────────────────────────

  /** Pull the org's projects, repositories, and teams from Azure and upsert them. */
  async sync(id: string): Promise<OrgSyncResult> {
    const { org, client } = await this.getClientForOrg(id)
    const { webApi, throttle } = client

    const core = await webApi.getCoreApi()
    const git = await webApi.getGitApi()

    const projects = await throttle.runWithRetry(() => core.getProjects())
    const result: OrgSyncResult = { projects: 0, repositories: 0, teams: 0 }

    for (const proj of projects ?? []) {
      if (!proj.id || !proj.name) continue
      // Bind to locals so the non-null narrowing survives the awaits below
      // (object-property narrowing is reset across function calls).
      const azureProjectId: string = proj.id
      const projectName: string = proj.name

      const projectDoc = await this.projectModel
        .findOneAndUpdate(
          { organizationId: org._id, azureProjectId },
          { $set: { name: projectName, description: proj.description, lastSyncedAt: new Date() } },
          { upsert: true, new: true },
        )
        .exec()
      result.projects++

      // Repositories under the project
      const repos = await throttle.runWithRetry(() => git.getRepositories(azureProjectId))
      for (const repo of repos ?? []) {
        if (!repo.id || !repo.name) continue
        await this.repoModel
          .updateOne(
            { azureRepoId: repo.id },
            {
              $set: {
                organizationId: org._id,
                projectId: projectDoc!._id,
                azureProjectId,
                name: repo.name,
                defaultBranch: repo.defaultBranch,
                webUrl: repo.webUrl,
                lastSyncedAt: new Date(),
              },
            },
            { upsert: true },
          )
          .exec()
        result.repositories++
      }

      // Teams under the project (+ membership)
      const teams = await throttle.runWithRetry(() => core.getTeams(azureProjectId))
      for (const team of teams ?? []) {
        if (!team.id || !team.name) continue
        const azureTeamId: string = team.id
        const teamName: string = team.name

        let memberAzureIds: string[] = []
        try {
          const members = await throttle.runWithRetry(() =>
            core.getTeamMembersWithExtendedProperties(azureProjectId, azureTeamId),
          )
          memberAzureIds = (members ?? [])
            .map((m) => m.identity?.id)
            .filter((x): x is string => !!x)
        } catch (err) {
          this.logger.warn(`Team member sync skipped for "${teamName}": ${String(err)}`)
        }

        await this.teamModel
          .updateOne(
            { organizationId: org._id, azureTeamId },
            { $set: { azureProjectId, name: teamName, memberAzureIds } },
            { upsert: true },
          )
          .exec()
        result.teams++
      }
    }

    await this.orgModel.updateOne({ _id: org._id }, { $set: { lastSyncedAt: new Date() } }).exec()
    this.logger.log(
      `Sync complete for ${org.name}: ${result.projects} projects, ` +
        `${result.repositories} repos, ${result.teams} teams`,
    )
    return result
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function slugFromUrl(orgUrl: string): string {
  const devAzure = orgUrl.match(/dev\.azure\.com\/([^/]+)/i)
  if (devAzure) return devAzure[1]
  const vsts = orgUrl.match(/https?:\/\/([^.]+)\.visualstudio\.com/i)
  if (vsts) return vsts[1]
  return orgUrl.split('/').pop() ?? orgUrl
}
