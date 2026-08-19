import { readSession } from '../../server/authSession';
import { authorize } from '../../server/authorization';
import { listManagementAudit } from '../../server/managementStore';

type ApiRequest = { method?:string; headers?:{ cookie?:string }; query?:{ limit?:string|string[] } };
type ApiResponse = { status:(code:number)=>ApiResponse; json:(body:unknown)=>void; setHeader?:(name:string,value:string)=>void };

export default async function handler(req:ApiRequest,res:ApiResponse) {
  const session = readSession(req.headers?.cookie);
  const auth = authorize(session,'users:manage');
  if (!auth.ok) return res.status(auth.status).json({ error:auth.error });
  if (req.method && req.method !== 'GET') {
    res.setHeader?.('Allow','GET');
    return res.status(405).json({ error:'Method not allowed' });
  }
  try {
    const raw = Array.isArray(req.query?.limit) ? req.query?.limit[0] : req.query?.limit;
    const limit = raw ? Number(raw) : 500;
    res.setHeader?.('Cache-Control','private, no-store');
    return res.status(200).json({ events:await listManagementAudit(Number.isFinite(limit) ? limit : 500) });
  } catch (error) {
    console.error('[OpsVista Management Audit]', error instanceof Error ? error.message : error);
    return res.status(503).json({ error:'Central management audit unavailable' });
  }
}
