import type { FastifyRequest } from 'fastify';
import { config } from '../config';
import { one, q } from '../db';
import { hashToken, randomToken } from '../lib/crypto';
import { unauthorized } from '../lib/errors';
import type { AuthUser, Role, UserRow, UserStatus } from '../types';

interface SessionJoinRow extends UserRow {
  session_id: string;
  expires_at: Date;
  last_seen_at: Date;
}

export async function createSession(
  userId: string,
  ip: string,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  await q(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, expiresAt, ip, userAgent?.slice(0, 300) ?? null],
  );
  await q('DELETE FROM sessions WHERE expires_at < now()');
  return { token, expiresAt };
}

export async function resolveSession(request: FastifyRequest): Promise<AuthUser | null> {
  const token = request.cookies[config.cookieName];
  if (!token) return null;
  const row = await one<SessionJoinRow>(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await q('DELETE FROM sessions WHERE id = $1', [row.session_id]);
    return null;
  }
  if (row.status !== 'ACTIVE') return null;

  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60 * 1000) {
    await q('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  }

  request.rawSessionToken = token;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    inviteEnabled: row.invite_enabled,
    invitedBy: row.invited_by,
    sessionId: row.session_id,
  };
}

export async function destroyCurrentSession(request: FastifyRequest): Promise<void> {
  const token = request.rawSessionToken ?? request.cookies[config.cookieName];
  if (!token) return;
  await q('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await q('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export function publicUser(user: {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  invite_enabled: boolean;
  invited_by: string | null;
  created_at: Date;
  last_login_at: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    inviteEnabled: user.invite_enabled,
    invitedBy: user.invited_by,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

export async function requireActiveSession(request: FastifyRequest): Promise<AuthUser> {
  const user = await resolveSession(request);
  if (!user) throw unauthorized('登录状态已失效，请重新登录');
  return user;
}

export function isStrongEnoughPassword(password: string): boolean {
  return password.length >= 10 && password.length <= 128 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
