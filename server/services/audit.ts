import type { PoolClient } from 'pg';
import type { FastifyRequest } from 'fastify';
import { q } from '../db';
import { clientIp } from '../lib/http';
import type { AuthUser, Role } from '../types';

export interface AuditInput {
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

export async function writeAudit(input: AuditInput, client?: PoolClient): Promise<void> {
  const sql = `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, meta, ip)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`;
  const params = [
    input.actorId,
    input.actorRole,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    JSON.stringify(input.meta ?? {}),
    input.ip ?? null,
  ];
  if (client) await client.query(sql, params);
  else await q(sql, params);
}

export function auditForRequest(
  request: FastifyRequest,
  action: string,
  targetType?: string,
  targetId?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const user = request.authUser;
  return writeAudit({
    actorId: user?.id ?? null,
    actorRole: user?.role ?? null,
    action,
    targetType,
    targetId,
    meta,
    ip: clientIp(request),
  });
}

export async function createNotification(
  client: PoolClient | null,
  userId: string,
  kind: string,
  title: string,
  body: string,
  taskId?: string | null,
): Promise<void> {
  const sql = `INSERT INTO notifications (user_id, kind, title, body, task_id)
               VALUES ($1,$2,$3,$4,$5)`;
  const params = [userId, kind, title, body, taskId ?? null];
  if (client) await client.query(sql, params);
  else await q(sql, params);
}
