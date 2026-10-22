export interface SessionRecord {
  id: string;
  userId: string;
  title: string | null;
  isActive: boolean;
  status: string;
  /** Local project folder this session's prompts run the folder agent in (null = normal chat). */
  folderPath: string | null;
  createdAt: string;
  lastActiveAt: string;
}
