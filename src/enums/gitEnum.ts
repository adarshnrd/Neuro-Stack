export enum MergeMethod {
  MERGE = 'merge',
  SQUASH = 'squash',
  REBASE = 'rebase',
}

export enum PRState {
  OPEN = 'open',
  CLOSED = 'closed',
  ALL = 'all',
}

export enum ReviewEvent {
  APPROVE = 'APPROVE',
  REQUEST_CHANGES = 'REQUEST_CHANGES',
  COMMENT = 'COMMENT',
}
