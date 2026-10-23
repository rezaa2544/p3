import type { AuthContext } from './lib/scope.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    session: { id: string; csrfToken: string } | null;
  }
}

export type SessionRow = {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
};

export type { AuthContext };
