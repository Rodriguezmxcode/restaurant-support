import { randomBytes, scryptSync } from 'node:crypto';
import postgres from 'postgres';
import { authenticateUser, readSession } from '../../server/authSession.js';
import { getManagedUser } from '../../server/managementStore.js';

type ApiRequest = {
  method?: string;
  headers?: { cookie?: string };
  body?: { currentPassword?: string; newPassword?: string };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

function databaseUrl() {
  return process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL || '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = readSession(req.headers?.cookie);
  if (!session) return res.status(401).json({ error: 'Authentication required' });

  const currentPassword = req.body?.currentPassword || '';
  const newPassword = req.body?.newPassword || '';
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
  if (newPassword.length < 12) return res.status(400).json({ error: 'New password must be at least 12 characters' });
  if (currentPassword === newPassword) return res.status(400).json({ error: 'New password must be different from current password' });

  const url = databaseUrl();
  if (!url) return res.status(503).json({ error: 'OpsVista database URL is not configured' });

  try {
    const verified = await authenticateUser(session.email, currentPassword);
    if (!verified || verified.id !== session.id) return res.status(401).json({ error: 'Current password is incorrect' });

    const managed = await getManagedUser(session.id);
    if (!managed || !managed.active || !managed.email) return res.status(403).json({ error: 'Account is unavailable' });

    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(newPassword, salt, 64).toString('hex');
    const db = postgres(url,{max:2,idle_timeout:20,connect_timeout:10});

    try {
      await db.begin(async tx => {
        await tx`
          update opsvista_auth_credentials
          set email=${managed.email.toLowerCase()}, password_salt=${salt}, password_hash=${hash}, password_set_at=now(), updated_at=now()
          where user_id=${managed.id}
        `;
        await tx`
          insert into opsvista_management_audit
          (id,at,actor_id,actor_name,target_user_id,target_user_name,action,before_value,after_value,reason,automatic)
          values (${`pwd_${randomBytes(12).toString('hex')}`},now(),${managed.id},${managed.name},${managed.id},${managed.name},'Password changed','Existing credential','Credential rotated','Authenticated user changed their password.',false)
        `;
      });
    } finally {
      await db.end({ timeout: 5 });
    }

    res.setHeader?.('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[OpsVista Auth Change Password]', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Unable to change password' });
  }
}
