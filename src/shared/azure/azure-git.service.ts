import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as azdev from 'azure-devops-node-api'
import type { IGitApi } from 'azure-devops-node-api/GitApi'
import type {
  GitChange,
  GitCommit,
  GitRepository,
} from 'azure-devops-node-api/interfaces/GitInterfaces'
import type {
  IAzureGitService,
  AzureOrgMember,
  PrCommitRef,
} from '../interfaces/azure-git.interface'
import type { ChangedFile, ChangeType } from '../helpers/diff-parser.helper'
import { detectLanguage } from '../helpers/diff-parser.helper'
import type { BuiltPatch, FileDiffInput } from '../helpers/unified-diff.helper'
import { buildPatch, isNoiseFile } from '../helpers/unified-diff.helper'
import { AzureThrottleService } from './azure-throttle.service'
import { AzureRateLimitError, parseAzureRateLimit } from './azure-rate-limit.error'

// ── Public interfaces ──────────────────────────────────────────────────────

export type OrgMember = AzureOrgMember

export interface CommitDiffResult {
  commitId: string
  repositoryId: string
  files: Array<{
    path: string
    originalPath?: string
    changeType: 'add' | 'modify' | 'delete' | 'rename'
  }>
  /** Formatted unified-diff-style string ready for parseDiff() */
  diffText: string
}

// ── Internal helpers ───────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const TEAM_PAGE_SIZE = 200
// Skip line-diffing for files larger than this (binary blobs, generated files).
const MAX_DIFF_CONTENT_BYTES = 1_500_000
// Bounds for assembling a PR net diff.
const MAX_PR_COMMITS_SCAN = 100
const MAX_PR_FILES = 300
const DEFAULT_MAX_DIFF_CHARS = 60_000

function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

/** Count newline-delimited lines in a text blob (null/empty → 0). */
function countLines(content: string | null): number {
  if (!content) return 0
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content
  if (normalized.length === 0) return 0
  return normalized.split('\n').length
}

/**
 * Approximate added/removed line counts via a histogram (multiset) diff:
 * added = lines present more often in new than old; removed = the reverse.
 * O(n+m), bounded memory — treats pure reordering as no change, which is fine
 * for churn metrics and avoids LCS blow-up on large files.
 */
function countLineDiff(
  oldContent: string | null,
  newContent: string | null,
): { added: number; removed: number } {
  if (!oldContent) return { added: countLines(newContent), removed: 0 }
  if (!newContent) return { added: 0, removed: countLines(oldContent) }

  const tally = new Map<string, number>()
  for (const line of oldContent.split('\n')) tally.set(line, (tally.get(line) ?? 0) - 1)
  for (const line of newContent.split('\n')) tally.set(line, (tally.get(line) ?? 0) + 1)

  let added = 0
  let removed = 0
  for (const count of tally.values()) {
    if (count > 0) added += count
    else if (count < 0) removed += -count
  }
  return { added, removed }
}

// Numeric aliases so we stay independent of the imported enum at runtime
const VC = {
  None: 0,
  Add: 1,
  Delete: 16,
  Rename: 8,
  SourceRename: 1024, // "old" side of a rename — skip in diffs
} as const

/**
 * Maps Azure's bitmask change type to our four-value enum.
 * Returns null for entries that should be skipped (SourceRename / None).
 */
function mapVcChangeType(ct: number | undefined): 'add' | 'modify' | 'delete' | 'rename' | null {
  if (!ct || ct === VC.None) return null
  if (ct & VC.SourceRename) return null // old path side of rename — skip
  if (ct & VC.Delete) return 'delete'
  if (ct & VC.Rename) return 'rename'
  if (ct & VC.Add) return 'add'
  return 'modify'
}

@Injectable()
export class AzureGitService implements IAzureGitService {
  private readonly logger = new Logger(AzureGitService.name)
  private readonly webApi: azdev.WebApi
  private readonly repoCache = new Map<string, CacheEntry<unknown>>()
  // Memoised Git API handle — avoids a fresh getGitApi() round-trip per call
  private gitApiPromise?: Promise<IGitApi>

  constructor(
    private readonly configService: ConfigService,
    private readonly throttle: AzureThrottleService,
  ) {
    const orgUrl = this.configService.getOrThrow<string>('azure.orgUrl')
    const pat = this.configService.getOrThrow<string>('azure.pat')
    this.webApi = new azdev.WebApi(orgUrl, azdev.getPersonalAccessTokenHandler(pat))
  }

  // ── Throttled retry ─────────────────────────────────────────────────────────
  // Routes every Azure call through the shared rate limiter + 429-aware retry.

  private withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return this.throttle.runWithRetry(fn)
  }

  /** Lazily create and reuse the Git API handle. */
  private getGit(): Promise<IGitApi> {
    if (!this.gitApiPromise) {
      this.gitApiPromise = this.webApi.getGitApi().catch((err) => {
        // Reset on failure so the next call can retry handle creation
        this.gitApiPromise = undefined
        throw err
      })
    }
    return this.gitApiPromise
  }

  // ── Repository-level cache ────────────────────────────────────────────────

  private cacheGet<T>(key: string): T | null {
    const entry = this.repoCache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.repoCache.delete(key)
      return null
    }
    return entry.data
  }

  private cacheSet<T>(key: string, data: T): void {
    this.repoCache.set(key, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns a pseudo-unified-diff string for a single commit.
   *
   * Azure DevOps does not expose a line-level diff endpoint — this method
   * converts the file-level change list into diff headers that parseDiff()
   * can use to extract file paths, change types, and language.
   * Line counts will be 0 for edit/rename entries.
   */
  async getCommitDiff(
    repositoryId: string,
    commitId: string,
    projectName: string,
  ): Promise<string> {
    try {
      return await this.withRetry(async () => {
        const git = await this.getGit()
        const result = await git.getChanges(
          commitId,
          repositoryId,
          projectName,
          1000, // top — return up to 1000 file changes
        )
        return this.buildDiffString(result.changes ?? [])
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getCommitDiff failed [repo=${repositoryId} commit=${commitId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return ''
    }
  }

  async getCommitDetails(
    repositoryId: string,
    commitId: string,
    projectName: string,
  ): Promise<GitCommit | null> {
    try {
      return await this.withRetry(async () => {
        const git = await this.getGit()
        return git.getCommit(commitId, repositoryId, projectName)
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getCommitDetails failed [${commitId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return null
    }
  }

  /**
   * List the commits that belong to a pull request, with author identity.
   * Used to ingest commit/contribution data even when no git.push webhook is
   * configured (the PR webhook payload's `commits` array is usually empty).
   */
  async getPullRequestWorkItemRefs(
    repositoryId: string,
    pullRequestId: number,
    projectName: string,
  ): Promise<number[]> {
    try {
      return await this.withRetry(async () => {
        const git = await this.getGit()
        const refs = await git.getPullRequestWorkItemRefs(repositoryId, pullRequestId, projectName)
        return (refs ?? [])
          .map((r) => Number(r.id))
          .filter((n) => Number.isInteger(n) && n > 0)
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getPullRequestWorkItemRefs failed [repo=${repositoryId} pr=${pullRequestId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  }

  async getPullRequestCommits(
    repositoryId: string,
    pullRequestId: number,
    projectName: string,
  ): Promise<PrCommitRef[]> {
    try {
      return await this.withRetry(async () => {
        const git = await this.getGit()
        const commits = await git.getPullRequestCommits(repositoryId, pullRequestId, projectName)
        return (commits ?? [])
          .filter((c) => !!c.commitId)
          .map((c) => ({
            commitId: c.commitId as string,
            authorName: c.author?.name ?? '',
            authorEmail: (c.author?.email ?? '').toLowerCase(),
            authorDate: c.author?.date ? new Date(c.author.date) : undefined,
            comment: c.comment ?? '',
          }))
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getPullRequestCommits failed [repo=${repositoryId} pr=${pullRequestId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  }

  /**
   * Per-file change stats for a commit with REAL line counts.
   *
   * Azure has no per-commit line-count endpoint, so for each changed file we
   * fetch the content at the commit and at its parent and diff them. Best-effort
   * per file: binary/oversized/fetch-failure falls back to 0 lines (the file is
   * still counted with its change type), so stats never crash ingestion.
   */
  async getCommitChangedFiles(
    repositoryId: string,
    commitId: string,
    projectName: string,
  ): Promise<ChangedFile[]> {
    try {
      return await this.withRetry(async () => {
        const git = await this.getGit()
        const [changesResult, commit] = await Promise.all([
          git.getChanges(commitId, repositoryId, projectName, 1000),
          git.getCommit(commitId, repositoryId, projectName),
        ])
        const parentId = commit?.parents?.[0]
        const changes = changesResult.changes ?? []

        const files: ChangedFile[] = []
        for (const change of changes) {
          const path = change.item?.path ?? ''
          if (!path || path.endsWith('/') || change.item?.isFolder) continue

          const ct = mapVcChangeType(change.changeType as number | undefined)
          if (!ct) continue
          const originalPath = change.originalPath ?? path

          let linesAdded = 0
          let linesRemoved = 0
          try {
            if (ct === 'add') {
              const content = await this.fetchItemContent(projectName, repositoryId, path, commitId)
              linesAdded = countLines(content)
            } else if (ct === 'delete') {
              const content = parentId
                ? await this.fetchItemContent(projectName, repositoryId, originalPath, parentId)
                : null
              linesRemoved = countLines(content)
            } else {
              // modify / rename — diff parent vs commit content
              const [oldContent, newContent] = await Promise.all([
                parentId
                  ? this.fetchItemContent(projectName, repositoryId, originalPath, parentId)
                  : Promise.resolve(null),
                this.fetchItemContent(projectName, repositoryId, path, commitId),
              ])
              const diff = countLineDiff(oldContent, newContent)
              linesAdded = diff.added
              linesRemoved = diff.removed
            }
          } catch (statErr) {
            if (statErr instanceof AzureRateLimitError) throw statErr
            // Non-fatal: keep the file with 0 line counts.
          }

          files.push({
            filePath: stripLeadingSlash(path),
            linesAdded,
            linesRemoved,
            changeType: ct as ChangeType,
            language: detectLanguage(path),
          })
        }
        return files
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getCommitChangedFiles failed [repo=${repositoryId} commit=${commitId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  }

  /**
   * Fetch a file's text content at a specific commit via the Items REST API.
   * Returns null for binary/oversized content or on any failure.
   */
  private async fetchItemContent(
    projectName: string,
    repositoryId: string,
    path: string,
    commitVersion: string,
  ): Promise<string | null> {
    const orgUrl = this.configService.getOrThrow<string>('azure.orgUrl')
    const url =
      `${orgUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories/${repositoryId}/items` +
      `?path=${encodeURIComponent(path)}` +
      `&versionDescriptor.version=${commitVersion}&versionDescriptor.versionType=commit` +
      '&includeContent=true&$format=json&api-version=7.1'

    try {
      const res = await this.webApi.rest.get<{ content?: string }>(url)
      const content = res?.result?.content
      if (typeof content !== 'string') return null
      if (content.length > MAX_DIFF_CONTENT_BYTES) return null // skip very large files
      if (content.includes('\u0000')) return null // skip binary
      return content
    } catch (err) {
      // A 404 simply means the file doesn't exist at this version (add/delete).
      // Surface rate-limits so the caller can defer; swallow everything else.
      if (parseAzureRateLimit(err).isRateLimited) {
        throw new AzureRateLimitError(
          'Azure rate limited while fetching item content',
          parseAzureRateLimit(err).retryAfterMs ?? 1000,
        )
      }
      return null
    }
  }

  /** Configurable cap on how much patch text we send to the model. */
  private maxDiffChars(): number {
    return Number(process.env.AI_MAX_DIFF_CHARS) || DEFAULT_MAX_DIFF_CHARS
  }

  /** Size-capped unified patch (real code) for one commit vs its parent. */
  async getCommitPatch(
    repositoryId: string,
    commitId: string,
    projectName: string,
  ): Promise<BuiltPatch> {
    try {
      return await this.withRetry(async () => {
        const git = await this.getGit()
        const [changesResult, commit] = await Promise.all([
          git.getChanges(commitId, repositoryId, projectName, 1000),
          git.getCommit(commitId, repositoryId, projectName),
        ])
        const parentId = commit?.parents?.[0]
        const files: FileDiffInput[] = []

        for (const change of changesResult.changes ?? []) {
          const path = change.item?.path ?? ''
          if (!path || path.endsWith('/') || change.item?.isFolder) continue
          const ct = mapVcChangeType(change.changeType as number | undefined)
          if (!ct) continue
          if (isNoiseFile(path)) continue
          const originalPath = change.originalPath ?? path

          const [oldContent, newContent] = await Promise.all([
            ct === 'add' || !parentId
              ? Promise.resolve(null)
              : this.fetchItemContent(projectName, repositoryId, originalPath, parentId),
            ct === 'delete'
              ? Promise.resolve(null)
              : this.fetchItemContent(projectName, repositoryId, path, commitId),
          ])

          files.push({
            path: stripLeadingSlash(path),
            changeType: ct as ChangeType,
            language: detectLanguage(path),
            oldContent,
            newContent,
          })
        }
        return buildPatch(files, this.maxDiffChars())
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getCommitPatch failed [repo=${repositoryId} commit=${commitId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return { patch: '', truncated: false, filesIncluded: 0, filesTotal: 0 }
    }
  }

  /**
   * Size-capped unified patch of a PR's NET base→head changes. Built from the
   * union of files the PR's commits touch, with content fetched at the base
   * (parent of the first commit) and head (last commit) — so churn/reverts are
   * naturally de-duplicated (add→revert nets to nothing).
   */
  async getPullRequestNetDiff(
    repositoryId: string,
    pullRequestId: number,
    projectName: string,
  ): Promise<BuiltPatch> {
    const empty: BuiltPatch = { patch: '', truncated: false, filesIncluded: 0, filesTotal: 0 }
    try {
      return await this.withRetry(async () => {
        const git = await this.getGit()
        const refs = await git.getPullRequestCommits(repositoryId, pullRequestId, projectName)
        const commits = (refs ?? [])
          .filter((c) => !!c.commitId)
          .map((c) => ({
            id: c.commitId as string,
            t: c.author?.date ? new Date(c.author.date).getTime() : 0,
          }))
          .sort((a, b) => a.t - b.t)
        if (!commits.length) return empty

        const headId = commits[commits.length - 1].id
        const firstCommit = await git.getCommit(commits[0].id, repositoryId, projectName)
        const baseId = firstCommit?.parents?.[0]

        // Union of changed file paths across the PR's commits.
        const pathMeta = new Map<string, { originalPath: string }>()
        for (const c of commits.slice(0, MAX_PR_COMMITS_SCAN)) {
          const ch = await git.getChanges(c.id, repositoryId, projectName, 1000)
          for (const change of ch.changes ?? []) {
            const path = change.item?.path ?? ''
            if (!path || path.endsWith('/') || change.item?.isFolder) continue
            if (isNoiseFile(path)) continue
            if (!pathMeta.has(path))
              pathMeta.set(path, { originalPath: change.originalPath ?? path })
          }
        }

        const files: FileDiffInput[] = []
        for (const [path, meta] of pathMeta) {
          if (files.length >= MAX_PR_FILES) break
          const [oldContent, newContent] = await Promise.all([
            baseId
              ? this.fetchItemContent(projectName, repositoryId, meta.originalPath, baseId)
              : Promise.resolve(null),
            this.fetchItemContent(projectName, repositoryId, path, headId),
          ])
          if (oldContent === null && newContent === null) continue // unchanged/binary/absent
          const changeType: ChangeType =
            oldContent === null ? 'add' : newContent === null ? 'delete' : 'modify'
          files.push({
            path: stripLeadingSlash(path),
            changeType,
            language: detectLanguage(path),
            oldContent,
            newContent,
          })
        }
        return buildPatch(files, this.maxDiffChars())
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getPullRequestNetDiff failed [repo=${repositoryId} pr=${pullRequestId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return empty
    }
  }

  async getRepository(repositoryId: string, projectName: string): Promise<GitRepository | null> {
    const cacheKey = `${projectName}:${repositoryId}`
    const cached = this.cacheGet<GitRepository>(cacheKey)
    if (cached) return cached

    try {
      const repo = await this.withRetry(async () => {
        const git = await this.getGit()
        return git.getRepository(repositoryId, projectName)
      })
      this.cacheSet(cacheKey, repo)
      return repo
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getRepository failed [${repositoryId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return null
    }
  }

  /**
   * Look up a single org member by their email address using the Azure
   * Identities REST API (vssps.dev.azure.com). Used during webhook processing
   * to resolve the commit author's GUID before creating a developer record.
   *
   * Returns null when the identity is not found or the API call fails.
   */
  async resolveUserByEmail(email: string): Promise<AzureOrgMember | null> {
    try {
      return await this.withRetry(async () => {
        const orgUrl = this.configService.getOrThrow<string>('azure.orgUrl')
        // dev.azure.com uses a separate vssps subdomain for the Identities API
        const vsspsBase = orgUrl.replace(
          /^https:\/\/dev\.azure\.com/,
          'https://vssps.dev.azure.com',
        )
        const url =
          `${vsspsBase}/_apis/identities` +
          `?searchFilter=MailAddress&filterValue=${encodeURIComponent(email)}&api-version=7.1`

        const res = await this.webApi.rest.get<{
          count: number
          value: Array<{ id: string; providerDisplayName: string }>
        }>(url)

        const identity = res?.result?.value?.[0]
        if (!identity?.id) return null

        return {
          id: identity.id,
          displayName: identity.providerDisplayName ?? email.split('@')[0],
          emailAddress: email,
        }
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.warn(
        `resolveUserByEmail failed for ${email}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  async getAllOrgMembers(): Promise<AzureOrgMember[]> {
    try {
      return await this.withRetry(async () => {
        const core = await this.webApi.getCoreApi()
        const memberMap = new Map<string, AzureOrgMember>()

        let skip = 0
        while (true) {
          const teams = await core.getAllTeams(false, TEAM_PAGE_SIZE, skip)
          if (!teams?.length) break

          // Fetch members for each team concurrently within the page
          await Promise.all(
            teams.map(async (team) => {
              if (!team.projectId || !team.id) return
              try {
                const members = await core.getTeamMembersWithExtendedProperties(
                  team.projectId,
                  team.id,
                  200,
                )
                for (const m of members ?? []) {
                  const identity = m.identity
                  if (!identity?.id || memberMap.has(identity.id)) continue
                  memberMap.set(identity.id, {
                    id: identity.id,
                    displayName: identity.displayName ?? '',
                    emailAddress:
                      identity.uniqueName ??
                      (identity as Record<string, string>)['preferredEmailAddress'] ??
                      '',
                  })
                }
              } catch (teamErr) {
                this.logger.warn(`Skipping team "${team.name}": ${String(teamErr)}`)
              }
            }),
          )

          if (teams.length < TEAM_PAGE_SIZE) break
          skip += TEAM_PAGE_SIZE
        }

        return [...memberMap.values()]
      })
    } catch (err) {
      this.logger.error('getAllOrgMembers failed', err instanceof Error ? err.message : String(err))
      return []
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildDiffString(changes: GitChange[]): string {
    const lines: string[] = []

    for (const change of changes) {
      const path = change.item?.path ?? ''
      if (!path || path.endsWith('/')) continue // skip empty paths and directory entries

      const ct = mapVcChangeType(change.changeType as number | undefined)
      if (!ct) continue // SourceRename / None — skip

      const orig = change.originalPath ?? path

      switch (ct) {
        case 'add':
          lines.push(
            `diff --git a/${path} b/${path}`,
            'new file mode 100644',
            '--- /dev/null',
            `+++ b/${path}`,
            '',
          )
          break

        case 'delete':
          lines.push(
            `diff --git a/${path} b/${path}`,
            'deleted file mode 100644',
            `--- a/${path}`,
            '+++ /dev/null',
            '',
          )
          break

        case 'rename':
          lines.push(
            `diff --git a/${orig} b/${path}`,
            `rename from ${orig}`,
            `rename to ${path}`,
            '',
          )
          break

        default: // modify / edit
          lines.push(`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '')
      }
    }

    return lines.join('\n')
  }
}
