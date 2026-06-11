import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  Commit,
  CommitDocument,
  CommitAnalysisStatus,
  FileChangeType,
} from '@app/database/schemas/commit.schema'
import type { ChangedFile } from '@app/shared/helpers/diff-parser.helper'

export interface CreateCommitData {
  azureCommitId: string
  repositoryId: string
  repositoryName: string
  projectId: string
  projectName: string
  authorAzureId: string
  authorName: string
  authorEmail: string
  branchName: string
  message: string
  pushedAt: Date
  filesChanged: ChangedFile[]
  workItemIds?: number[]
}

@Injectable()
export class CommitsService {
  private readonly logger = new Logger(CommitsService.name)

  constructor(
    @InjectModel(Commit.name)
    private readonly commitModel: Model<CommitDocument>,
  ) {}

  async findById(id: string): Promise<CommitDocument | null> {
    return this.commitModel.findById(id).exec()
  }

  async exists(azureCommitId: string): Promise<boolean> {
    return !!(await this.commitModel.exists({ azureCommitId }).exec())
  }

  /**
   * Persist a commit. Returns the created document, or `null` when the commit
   * already exists — a concurrent ingestion (e.g. a push event and a PR event
   * racing past each other's {@link exists} pre-check) lost the race against the
   * unique `azureCommitId` index. Callers must treat `null` as "skip", not an
   * error, so the same commit is never counted twice.
   */
  async create(data: CreateCommitData): Promise<CommitDocument | null> {
    const filesChanged = data.filesChanged.map((f) => ({
      filePath: f.filePath,
      linesAdded: f.linesAdded,
      linesRemoved: f.linesRemoved,
      changeType: f.changeType as unknown as FileChangeType,
      language: f.language,
    }))

    const totalLinesAdded = filesChanged.reduce((s, f) => s + f.linesAdded, 0)
    const totalLinesRemoved = filesChanged.reduce((s, f) => s + f.linesRemoved, 0)
    const languagesUsed = [
      ...new Set(filesChanged.map((f) => f.language).filter((l) => l !== 'unknown')),
    ]

    try {
      return await this.commitModel.create({
        azureCommitId: data.azureCommitId,
        repositoryId: data.repositoryId,
        repositoryName: data.repositoryName,
        projectId: data.projectId,
        projectName: data.projectName,
        authorAzureId: data.authorAzureId,
        authorName: data.authorName,
        authorEmail: data.authorEmail,
        branchName: data.branchName,
        message: data.message,
        pushedAt: data.pushedAt,
        filesChanged,
        totalLinesAdded,
        totalLinesRemoved,
        totalFilesChanged: filesChanged.length,
        languagesUsed,
        workItemIds: data.workItemIds ?? [],
        analysisStatus: CommitAnalysisStatus.PENDING,
      })
    } catch (err) {
      // E11000 = duplicate key on the unique azureCommitId index. The commit was
      // already stored by a concurrent ingestion; treat as an idempotent no-op.
      if ((err as { code?: number }).code === 11000) {
        this.logger.debug(`Commit ${data.azureCommitId} already ingested — skipping duplicate`)
        return null
      }
      throw err
    }
  }

  /**
   * Determine which developer did the actual work in a PR by inspecting the
   * commits linked to it. Ownership goes to the author of the most commits,
   * tie-broken by total lines changed. Commits with no resolved author are
   * ignored. Returns null when the PR has no attributable commit yet (caller
   * should fall back to the PR creator).
   */
  async getDominantAuthor(prObjectId: string): Promise<string | null> {
    const rows = await this.commitModel.aggregate<{ _id: string }>([
      { $match: { pullRequestId: prObjectId, authorAzureId: { $nin: ['', null] } } },
      {
        $group: {
          _id: '$authorAzureId',
          commitCount: { $sum: 1 },
          linesChanged: { $sum: { $add: ['$totalLinesAdded', '$totalLinesRemoved'] } },
        },
      },
      { $sort: { commitCount: -1, linesChanged: -1 } },
      { $limit: 1 },
    ])
    return rows[0]?._id ?? null
  }

  async updatePullRequestId(azureCommitIds: string[], prObjectId: string): Promise<void> {
    if (!azureCommitIds.length) return
    await this.commitModel
      .updateMany(
        { azureCommitId: { $in: azureCommitIds } },
        { $set: { pullRequestId: prObjectId } },
      )
      .exec()
  }
}
