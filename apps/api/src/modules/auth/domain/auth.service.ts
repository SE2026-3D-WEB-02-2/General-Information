import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  type AuthSessionResponseDto,
  type LoginRequestDto,
  type RegisterRequestDto,
  type UserSummary,
} from '@spriter/shared';
import { InMemoryUserRepository } from '../adapters/in-memory-user.repository.ts';
import { type InternalDbUserRecord, type UserRepositoryPort } from './ports.ts';

export const ACCESS_TOKEN_TTL_SECONDS = 86_400; // 24 hours

export function hashPasswordScrypt(password: string, saltHex?: string): string {
  const salt = saltHex ?? randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  const candidateHex = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidateHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RegisterOutcome =
  | { status: 'OK'; session: AuthSessionResponseDto }
  | { status: 'EMAIL_EXISTS'; message: string }
  | { status: 'INVALID_INPUT'; message: string };

export type LoginOutcome =
  | { status: 'OK'; session: AuthSessionResponseDto }
  | { status: 'UNAUTHORIZED'; message: string };

export class AuthService {
  private readonly userRepo: UserRepositoryPort;
  private readonly jwtSecret: string;
  private readonly nowFn: () => Date;

  constructor(
    userRepo?: UserRepositoryPort,
    jwtSecret = process.env.JWT_SECRET ?? 'spriter-dev-hmac-secret-2026',
    nowFn: () => Date = () => new Date(),
  ) {
    this.userRepo = userRepo ?? new InMemoryUserRepository();
    this.jwtSecret = jwtSecret;
    this.nowFn = nowFn;
  }

  private toUserSummary(record: InternalDbUserRecord): UserSummary {
    // Information Hiding: strips `password_hash` and `created_at`
    return {
      id: record.id,
      email: record.email,
      name: record.name,
      ...(record.avatar_url ? { avatarUrl: record.avatar_url } : {}),
      role: record.role,
    };
  }

  public signAccessToken(user: UserSummary): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const issuedAtSec = Math.floor(this.nowFn().getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        iat: issuedAtSec,
        exp: issuedAtSec + ACCESS_TOKEN_TTL_SECONDS,
      }),
    ).toString('base64url');

    const signature = createHmac('sha256', this.jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  public verifyAccessToken(token: string): UserSummary | null {
    const segments = token.split('.');
    if (segments.length !== 3) {
      return null;
    }
    const [headerB64, payloadB64, signatureB64] = segments as [string, string, string];
    const expectedSig = createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signatureB64);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
        sub: string;
        email: string;
        name: string;
        role: 'REVIEWER' | 'PROJECT_LEAD';
        exp: number;
      };
      const nowSec = Math.floor(this.nowFn().getTime() / 1000);
      if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
        return null;
      }
      return {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
    } catch {
      return null;
    }
  }

  public async register(dto: RegisterRequestDto): Promise<RegisterOutcome> {
    const email = dto.email?.trim().toLowerCase();
    const name = dto.name?.trim();
    if (!email || !email.includes('@')) {
      return { status: 'INVALID_INPUT', message: 'A valid email address is required.' };
    }
    if (!name || name.length < 2) {
      return { status: 'INVALID_INPUT', message: 'Display name must be at least 2 characters.' };
    }
    if (!dto.password || dto.password.length < 8) {
      return { status: 'INVALID_INPUT', message: 'Password must be at least 8 characters long.' };
    }

    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      return { status: 'EMAIL_EXISTS', message: `Email "${email}" is already registered.` };
    }

    const nowIso = this.nowFn().toISOString();
    const record: InternalDbUserRecord = {
      id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      email,
      name,
      avatar_url: dto.avatarUrl,
      role: dto.role ?? 'REVIEWER',
      password_hash: hashPasswordScrypt(dto.password),
      created_at: nowIso,
    };

    await this.userRepo.insert(record);
    const user = this.toUserSummary(record);
    return {
      status: 'OK',
      session: {
        user,
        accessToken: this.signAccessToken(user),
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }

  public async login(dto: LoginRequestDto): Promise<LoginOutcome> {
    const email = dto.email?.trim().toLowerCase();
    if (!email || !dto.password) {
      return { status: 'UNAUTHORIZED', message: 'Invalid email or password.' };
    }

    const record = await this.userRepo.findByEmail(email);
    if (!record || !verifyPasswordScrypt(dto.password, record.password_hash)) {
      return { status: 'UNAUTHORIZED', message: 'Invalid email or password.' };
    }

    const user = this.toUserSummary(record);
    return {
      status: 'OK',
      session: {
        user,
        accessToken: this.signAccessToken(user),
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }

  public async getAuthenticatedUser(accessToken: string): Promise<UserSummary | null> {
    const claims = this.verifyAccessToken(accessToken);
    if (!claims) {
      return null;
    }
    const dbUser = await this.userRepo.findById(claims.id);
    return dbUser ? this.toUserSummary(dbUser) : claims;
  }
}
