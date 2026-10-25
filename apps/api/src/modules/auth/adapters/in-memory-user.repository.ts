import { hashPasswordScrypt } from '../domain/auth.service.ts';
import { type InternalDbUserRecord, type UserRepositoryPort } from '../domain/ports.ts';

const DEFAULT_TEAM_USERS: InternalDbUserRecord[] = [
  {
    id: 'user-lead-nekover2',
    email: 'lead@spriter.local',
    name: 'Nekover2 (Tech Lead)',
    role: 'PROJECT_LEAD',
    password_hash: hashPasswordScrypt('SpriterLead#2026', '0102030405060708090a0b0c0d0e0f10'),
    created_at: '2026-10-25T00:00:00.000Z',
  },
  {
    id: 'user-3d-huy',
    email: 'huy@spriter.local',
    name: 'Hoàng Đức Huy (3D Viewport)',
    role: 'REVIEWER',
    password_hash: hashPasswordScrypt('Spriter3D#2026', '1112131415161718191a1b1c1d1e1f20'),
    created_at: '2026-10-25T00:00:00.000Z',
  },
  {
    id: 'user-ui-hieu',
    email: 'hieu@spriter.local',
    name: 'Hồ Trọng Hiếu (Collab UI)',
    role: 'REVIEWER',
    password_hash: hashPasswordScrypt('SpriterUI#2026', '2122232425262728292a2b2c2d2e2f30'),
    created_at: '2026-10-25T00:00:00.000Z',
  },
];

export class InMemoryUserRepository implements UserRepositoryPort {
  private readonly byId = new Map<string, InternalDbUserRecord>();
  private readonly byEmail = new Map<string, InternalDbUserRecord>();

  constructor(seedUsers: ReadonlyArray<InternalDbUserRecord> = DEFAULT_TEAM_USERS) {
    for (const u of seedUsers) {
      const clone = structuredClone(u);
      this.byId.set(clone.id, clone);
      this.byEmail.set(clone.email.toLowerCase(), clone);
    }
  }

  public async findByEmail(email: string): Promise<InternalDbUserRecord | undefined> {
    return this.byEmail.get(email.toLowerCase());
  }

  public async findById(id: string): Promise<InternalDbUserRecord | undefined> {
    return this.byId.get(id);
  }

  public async insert(user: InternalDbUserRecord): Promise<void> {
    const clone = structuredClone(user);
    this.byId.set(clone.id, clone);
    this.byEmail.set(clone.email.toLowerCase(), clone);
  }
}
