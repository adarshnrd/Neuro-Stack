import { SessionStatus } from '../enums/sessionEnum.js';

export interface SessionAction {
  id: string;
  description: string;
  completed: boolean;
}

export interface Session {
  id: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  status: SessionStatus;
  intent: string;
  decisions: string[];
  actions: SessionAction[];
  currentState: string;
  learned: string[];
}
