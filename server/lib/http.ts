import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../types';
import { forbidden, unauthorized } from './errors';
import { config } from '../config';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
    rawSessionToken?: string;
    requestStart?: number;
  }
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw unauthorized();
  return request.authUser;
}

export function requireRole(request: FastifyRequest, ...roles: AuthUser['role'][]): AuthUser {
  const user = requireUser(request);
  if (!roles.includes(user.role)) throw forbidden('当前角色无权执行此操作');
  return user;
}

export function setSessionCookie(reply: FastifyReply, token: string, maxAgeMs: number): void {
  reply.setCookie(config.cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.cookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
  });
}

export function clientIp(request: FastifyRequest): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}
