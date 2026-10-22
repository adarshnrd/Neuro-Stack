export enum MergeMethod {
  MERGE = 'merge',
  SQUASH = 'squash',
  REBASE = 'rebase',
}

export enum ReviewEvent {
  APPROVE = 'APPROVE',
  REQUEST_CHANGES = 'REQUEST_CHANGES',
  COMMENT = 'COMMENT',
}
