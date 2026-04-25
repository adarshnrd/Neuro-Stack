import { ChangeSetStatus, FileChangeStatus } from '../enums/reviewEnum.js';

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface ReviewComment {
  id: string;
  fileIndex: number;
  lineNumber: number;
  content: string;
  author: 'user' | 'system';
  timestamp: string;
}

export interface FileChange {
  filePath: string;
  originalContent: string;
  proposedContent: string;
  diffLines: DiffLine[];
  status: FileChangeStatus;
}

export interface ChangeSet {
  changeSetId: string;
  sessionId: string;
  status: ChangeSetStatus;
  files: FileChange[];
  comments: ReviewComment[];
  feedback?: string;
  createdAt: string;
  updatedAt: string;
}
