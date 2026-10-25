import {
  type LoginRequestDto,
  type RegisterRequestDto,
  type UserSummary,
} from '@spriter/shared';
import { AuthService } from '../domain/auth.service.ts';

export class AuthController {
  private readonly authService: AuthService;

  constructor(authService?: AuthService) {
    this.authService = authService ?? new AuthService();
  }

  public getService(): AuthService {
    return this.authService;
  }

  public async register(req: { body: RegisterRequestDto }) {
    const result = await this.authService.register(req.body);
    switch (result.status) {
      case 'INVALID_INPUT':
        return {
          statusCode: 422 as const,
          body: { errorCode: 'VALIDATION_FAILED' as const, message: result.message },
        };
      case 'EMAIL_EXISTS':
        return {
          statusCode: 409 as const,
          body: { errorCode: 'EMAIL_ALREADY_EXISTS' as const, message: result.message },
        };
      case 'OK':
        return {
          statusCode: 201 as const,
          body: result.session,
        };
    }
  }

  public async login(req: { body: LoginRequestDto }) {
    const result = await this.authService.login(req.body);
    if (result.status === 'UNAUTHORIZED') {
      return {
        statusCode: 401 as const,
        body: { errorCode: 'UNAUTHORIZED' as const, message: result.message },
      };
    }
    return {
      statusCode: 200 as const,
      body: result.session,
    };
  }

  public async me(req: { authorizationHeader?: string }) {
    const authCheck = await this.authenticateBearer(req.authorizationHeader);
    if (!authCheck.authenticated) {
      return authCheck.errorResponse;
    }
    return {
      statusCode: 200 as const,
      body: authCheck.user,
    };
  }

  public async authenticateBearer(authorizationHeader?: string): Promise<
    | { authenticated: true; user: UserSummary }
    | {
        authenticated: false;
        errorResponse: {
          statusCode: 401;
          body: { errorCode: 'UNAUTHORIZED'; message: string };
        };
      }
  > {
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
      return {
        authenticated: false,
        errorResponse: {
          statusCode: 401,
          body: {
            errorCode: 'UNAUTHORIZED',
            message: 'Missing or malformed Authorization: Bearer <token> header.',
          },
        },
      };
    }
    const token = authorizationHeader.slice('Bearer '.length).trim();
    const user = await this.authService.getAuthenticatedUser(token);
    if (!user) {
      return {
        authenticated: false,
        errorResponse: {
          statusCode: 401,
          body: {
            errorCode: 'UNAUTHORIZED',
            message: 'Access token is invalid or expired.',
          },
        },
      };
    }
    return { authenticated: true, user };
  }
}
