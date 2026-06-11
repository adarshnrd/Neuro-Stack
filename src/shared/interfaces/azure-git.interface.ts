import type { ChangedFile } from '../helpers/diff-parser.helper'
import type { BuiltPatch } from '../helpers/unified-diff.helper'

export const AZURE_GIT_SERVICE = 'AZURE_GIT_SERVICE'

export interface AzureOrgMember {
  id: string // Azure DevOps user GUID
  displayName: string
  emailAddress: string
}

/** A commit that belongs to a pull request, as returned by the Azure Git API. */
export interface PrCommitRef {
  commitId: string
  authorName: string
  authorEmail: string
  authorDate?: Date
  comment: string
}

export interface IAzureGitService {
  getAllOrgMembers(): Promise<AzureOrgMember[]>
  getCommitDiff(repositoryId: string, commitId: string, projectName: string): Promise<string>
  /** Look up a single org member by email address. Returns null when not found or on error. */
  resolveUserByEmail(email: string): Promise<AzureOrgMember | null>
  /** List the commits that belong to a pull request (source branch ahead of target). */
  getPullRequestCommits(
    repositoryId: string,
    pullRequestId: number,
    projectName: string,
  ): Promise<PrCommitRef[]>
  /**
   * Authoritative list of work-item ids linked to a pull request. Azure's PR
   * webhook payload usually omits these, so we read them straight from the Git
   * API (each ref's `id` is the work item id — no URL parsing). Returns [] on
   * error so PR processing is never blocked.
   */
  getPullRequestWorkItemRefs(
    repositoryId: string,
    pullRequestId: number,
    projectName: string,
  ): Promise<number[]>
  /**
   * Per-file change stats for a commit with REAL added/removed line counts,
   * computed by diffing each changed file's content against its parent.
   */
  getCommitChangedFiles(
    repositoryId: string,
    commitId: string,
    projectName: string,
  ): Promise<ChangedFile[]>
  /** Size-capped unified patch (real code) for a single commit, for AI analysis. */
  getCommitPatch(repositoryId: string, commitId: string, projectName: string): Promise<BuiltPatch>
  /** Size-capped unified patch of a PR's NET base→head changes, for AI analysis. */
  getPullRequestNetDiff(
    repositoryId: string,
    pullRequestId: number,
    projectName: string,
  ): Promise<BuiltPatch>
}
