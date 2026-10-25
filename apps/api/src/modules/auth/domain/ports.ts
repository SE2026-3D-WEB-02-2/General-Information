import { type UserRole } from '@spriter/shared';

export interface InternalDbUserRecord {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: UserRole;
  password_hash: string;
  created_at: string;
}

export interface UserRepositoryPort {
  findByEmail(email: string): Promise<InternalDbUserRecord | undefined>;
  findById(id: string): Promise<InternalDbUserRecord | undefined>;
  insert(user: InternalDbUserRecord): Promise<void>;
}
