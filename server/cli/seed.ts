import { closeDb, one, withTx } from '../db';
import { config } from '../config';
import { hashPassword } from '../lib/crypto';
import { logger } from '../lib/logger';
import { DEFAULT_COPY_PROMPT, DEFAULT_IMAGE_PROMPT } from '../defaults';

interface SeedUser {
  email: string;
  name: string;
  role: 'ADMIN' | 'AGENT' | 'USER';
  inviteEnabled?: boolean;
  invitedByEmail?: string;
}

const seeds: SeedUser[] = [
  { email: config.adminEmail, name: '拾味管理员', role: 'ADMIN' },
  { email: 'agent@shiwei.local', name: '阿岚 · 代理', role: 'AGENT', inviteEnabled: true },
  { email: 'user-a@shiwei.local', name: '林小满', role: 'USER', invitedByEmail: 'agent@shiwei.local' },
  { email: 'user-b@shiwei.local', name: '陈一白', role: 'USER', invitedByEmail: 'agent@shiwei.local' },
];

async function main(): Promise<void> {
  const passwordHash = await hashPassword(config.demoPassword);
  await withTx(async (client) => {
    const ids = new Map<string, string>();
    for (const seed of seeds) {
      const existing = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [seed.email]);
      let id: string;
      if (existing.rows[0]) {
        id = existing.rows[0].id;
        await client.query(
          `UPDATE users SET display_name = $1, role = $2, invite_enabled = $3, status = 'ACTIVE'
           WHERE id = $4`,
          [seed.name, seed.role, Boolean(seed.inviteEnabled), id],
        );
      } else {
        const invitedBy = seed.invitedByEmail ? ids.get(seed.invitedByEmail) ?? null : null;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, display_name, role, invite_enabled, invited_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [seed.email, passwordHash, seed.name, seed.role, Boolean(seed.inviteEnabled), invitedBy],
        );
        id = inserted.rows[0].id;
      }
      ids.set(seed.email, id);
    }
    const adminId = ids.get(config.adminEmail)!;

    for (const kind of ['TEXT', 'IMAGE'] as const) {
      await client.query(
        `INSERT INTO provider_settings (kind, provider, base_url, model, api_key_ciphertext, options, updated_by)
         VALUES ($1, 'mock', NULL, 'mock-local', NULL, '{}', $2)
         ON CONFLICT (kind) DO NOTHING`,
        [kind, adminId],
      );
    }

    const active = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM prompt_templates WHERE is_active = true');
    if (Number(active.rows[0]?.count ?? 0) === 0) {
      await client.query(
        `INSERT INTO prompt_templates (kind, name, version, content, is_active, created_by)
         VALUES ('IMAGE','内置生图 Prompt · 初始版',1,$1,true,$2)`,
        [JSON.stringify(DEFAULT_IMAGE_PROMPT), adminId],
      );
      await client.query(
        `INSERT INTO prompt_templates (kind, name, version, content, is_active, created_by)
         VALUES ('COPY','内置文案 Prompt · 初始版',1,$1,true,$2)`,
        [JSON.stringify(DEFAULT_COPY_PROMPT), adminId],
      );
    }
  });

  const counts = await one<{ users: string; prompts: string }>(
    `SELECT (SELECT count(*)::text FROM users) AS users,
            (SELECT count(*)::text FROM prompt_templates) AS prompts`,
  );
  logger.info({ users: counts?.users, prompts: counts?.prompts }, '种子数据初始化完成');
  console.log('\n演示账号（本地 DEMO_MODE=true 时可从登录页一键进入）');
  console.log(`  管理员  ${config.adminEmail} / ${config.demoPassword}`);
  console.log('  代理    agent@shiwei.local');
  console.log('  用户 A  user-a@shiwei.local');
  console.log('  用户 B  user-b@shiwei.local');
  console.log(`  统一密码 ${config.demoPassword}  ← 生产环境务必修改\n`);
}

main()
  .catch((error) => {
    logger.fatal({ err: error }, '种子数据初始化失败');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
