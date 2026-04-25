export type ChatResponseType = 'ai' | 'system' | 'error';

export interface ChatResult {
  type: ChatResponseType;
  content: string;
  changeSetId?: string;
  changesSummary?: {
    filesAdded: number;
    filesModified: number;
    filesDeleted: number;
  };
}
