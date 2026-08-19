import { readSession } from '../../server/authSession';
import { authorize } from '../../server/authorization';
import { listManagedUsers, saveManagedUser, type ManagedDirectoryUser, type StoredAuditEvent } from '../../server/managementStore';

type ApiRequest = {
  method?: string;
  headers?: { cookie?: string };
  body?: { user?: ManagedDirectoryUser; events?: StoredAuditEvent[] };
};

type ApiResponse = {
  status: (code:number) => ApiResponse;
  json: (body:unknown) => void;
  setHeader?: (name:string,value:string) => void;
};

export default async function handler(req:ApiRequest,res:ApiResponse) {
  const session = readSession(req.headers?.cookie);
  const auth = authorize(session,'users:manage');
  if (!auth.ok) return res.status(auth.status).json({ error:auth.error });
  res.setHeader?.('Cache-Control','private, no-store');

  try {
    if (!req.method || req.method === 'GET') {
      return res.status(200).json({ users:await listManagedUsers() });
    }
    if (req.method === 'PUT') {
      const user = req.body?.user;
      const events = req.body?.events ?? [];
      if (!user?.id || !user.name || !user.role) return res.status(400).json({ error:'Valid user payload required' });
      if (!events.length || events.some(event => !event.reason?.trim())) return res.status(400).json({ error:'At least one audited change with management reason is required' });
      if (events.some(event => event.targetUserId !== user.id)) return res.status(400).json({ error:'Audit target must match edited user' });
      await saveManagedUser(user,events,auth.user);
      return res.status(200).json({ user });
    }
    res.setHeader?.('Allow','GET, PUT');
    return res.status(405).json({ error:'Method not allowed' });
  } catch (error) {
    console.error('[OpsVista Management Users]', error instanceof Error ? error.message : error);
    return res.status(503).json({ error:'Central management store unavailable' });
  }
}
