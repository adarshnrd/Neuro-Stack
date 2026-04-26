import { UserRole } from '../enums/authEnum.js';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  message: string;
  user?: AuthUser;
  token?: string;
}
