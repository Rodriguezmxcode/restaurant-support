import postgres from 'postgres';
import { listManagedUsers } from './managementStore.js';
import type { SessionUser } from './authSession.js';
import { parseClientSetup } from '../shared/tenantAccess.js';

export type OpsVistaOrganization = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  clientNumber: number;
  locations: string[];
  subscriptionId?: string;
};

export type OrganizationMembership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  clientNumber: number;
  organizationLocations: string[];
};

let client: ReturnType<typeof postgres> | undefined;
let initialized = false;
let bootstrapped = false;

function databaseUrl() {
  return process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL || '';
}

function sql() {
  const url = databaseUrl();
  if (!url) throw new Error('OpsVista database URL is not configured');
  if (!client) client = postgres(url,{max:4,idle_timeout:20,connect_timeout:10});
  return client;
}

async function ensureSchema() {
  if (initialized) return;
  const db=sql();
  await db`
    create table if not exists opsvista_organizations (
      id text primary key,
      name text not null,
      slug text not null unique,
      status text not null default 'active',
      client_number integer not null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await db`
    create table if not exists opsvista_organization_memberships (
      user_id text primary key,
      organization_id text not null references opsvista_organizations(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await db`create index if not exists opsvista_memberships_org_idx on opsvista_organization_memberships (organization_id)`;
  await db`alter table opsvista_organizations add column if not exists locations jsonb not null default '[]'::jsonb`;
  await db`alter table opsvista_organizations add column if not exists stripe_subscription_id text`;
  await db`alter table opsvista_organizations add column if not exists payment_reviewed_by text`;
  await db`create unique index if not exists opsvista_org_subscription_idx on opsvista_organizations(stripe_subscription_id) where stripe_subscription_id is not null`;
  initialized=true;
}

async function bootstrapPuertoVallarta() {
  if (bootstrapped) return;
  await ensureSchema();
  const db=sql();
  await db`
    insert into opsvista_organizations (id,name,slug,status,client_number)
    values ('org-puerto-vallarta','Puerto Vallarta Restaurants','puerto-vallarta','active',1)
    on conflict (id) do update set name=excluded.name,slug=excluded.slug,status='active',client_number=1,updated_at=now()
  `;

  const users=await listManagedUsers();
  for (const user of users) {
    if (user.role==='Founder') continue;
    await db`
      insert into opsvista_organization_memberships (user_id,organization_id)
      values (${user.id},'org-puerto-vallarta')
      on conflict (user_id) do nothing
    `;
  }
  bootstrapped=true;
}

export async function listOrganizations(): Promise<OpsVistaOrganization[]> {
  await bootstrapPuertoVallarta();
  const rows=await sql()`select id,name,slug,status,client_number,locations,stripe_subscription_id from opsvista_organizations order by client_number asc`;
  return rows.map(row=>({id:String(row.id),name:String(row.name),slug:String(row.slug),status:String(row.status) as 'active'|'inactive',clientNumber:Number(row.client_number),locations:row.locations as string[],subscriptionId:row.stripe_subscription_id ? String(row.stripe_subscription_id) : undefined}));
}

export async function getOrganizationMembership(userId:string):Promise<OrganizationMembership|null> {
  await bootstrapPuertoVallarta();
  const rows=await sql()`
    select o.id,o.name,o.slug,o.client_number,o.locations
    from opsvista_organization_memberships m
    join opsvista_organizations o on o.id=m.organization_id
    where m.user_id=${userId} and o.status='active'
    limit 1
  `;
  const row=rows[0];
  if (!row) return null;
  return {organizationId:String(row.id),organizationName:String(row.name),organizationSlug:String(row.slug),clientNumber:Number(row.client_number),organizationLocations:row.locations as string[]};
}

// Assisted onboarding: the Founder reviews the actual paid subscription and
// quantity in Stripe. A Checkout redirect is never accepted as proof of payment.
export async function provisionClient(body: Record<string, unknown>, actor: SessionUser) {
  if (actor.role !== 'Founder') throw new Error('Founder access required');
  const input = parseClientSetup(body);
  await bootstrapPuertoVallarta();
  const organizationId = `org-${input.requestId}`, userId = `client-${input.requestId}`;
  await sql().begin(async tx => {
    // Serialize client numbering and retries; users and memberships commit together.
    await tx`select pg_advisory_xact_lock(73914792)`;
    const existing = await tx`select id from opsvista_organizations where id=${organizationId}`;
    if (existing.length) return;
    const number = await tx`select coalesce(max(client_number),0)+1 as next from opsvista_organizations`;
    await tx`insert into opsvista_organizations(id,name,slug,status,client_number,locations,stripe_subscription_id,payment_reviewed_by)
      values(${organizationId},${input.name},${organizationId},'active',${Number(number[0].next)},${tx.json(input.locations)},${input.subscriptionId},${actor.id})`;
    await tx`insert into opsvista_management_users(id,name,email,role,title,active,locations,location_grants,organization_id,updated_by)
      values(${userId},${input.adminName},${input.email},'Corporate','Account administrator',true,${tx.json(input.locations)},'[]'::jsonb,${organizationId},${actor.id})`;
    await tx`insert into opsvista_organization_memberships(user_id,organization_id) values(${userId},${organizationId})`;
    await tx`insert into opsvista_management_audit(id,at,actor_id,actor_name,target_user_id,target_user_name,action,reason,automatic)
      values(${`onboard-${input.requestId}`},now(),${actor.id},${actor.name},${userId},${input.adminName},'Client activated',${`Founder reviewed Stripe subscription ${input.subscriptionId} for ${input.locations.length} locations. Assisted activation.`},false)`;
  });
  return { organizationId, userId };
}

export async function addClientTeamMember(body: Record<string, unknown>, actor: SessionUser) {
  if (actor.role !== 'Corporate' || !actor.organizationId || actor.organizationId === 'org-puerto-vallarta') throw new Error('Client administrator access required');
  const organizationId = actor.organizationId;
  const membership = await getOrganizationMembership(actor.id);
  if (!membership || membership.organizationId !== actor.organizationId) throw new Error('Organization unavailable');
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = typeof body.role === 'string' ? body.role : '';
  const locations = Array.isArray(body.locations) ? body.locations.filter((v): v is string => typeof v === 'string') : [];
  if (!/^[a-f0-9-]{36}$/i.test(requestId) || !name || name.length > 160 || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Valid name and email required');
  if (!['Corporate','Location Manager','Kitchen','Maintenance'].includes(role)) throw new Error('Invalid role');
  if (!locations.length || locations.some(v => !membership.organizationLocations.includes(v))) throw new Error('Choose locations in your organization');
  const userId = `team-${requestId}`;
  await sql().begin(async tx => {
    const existing = await tx`select id,organization_id from opsvista_management_users where id=${userId}`;
    if (existing.length) {
      if (existing[0].organization_id !== actor.organizationId) throw new Error('Invalid request');
      return;
    }
    await tx`insert into opsvista_management_users(id,name,email,role,title,active,locations,location_grants,organization_id,updated_by)
      values(${userId},${name},${email},${role},${role},true,${tx.json(locations)},'[]'::jsonb,${organizationId},${actor.id})`;
    await tx`insert into opsvista_organization_memberships(user_id,organization_id) values(${userId},${organizationId})`;
    await tx`insert into opsvista_management_audit(id,at,actor_id,actor_name,target_user_id,target_user_name,action,reason,automatic)
      values(${`team-add-${requestId}`},now(),${actor.id},${actor.name},${userId},${name},'Team member created','Organization administrator added a team member.',false)`;
  });
  return { userId };
}
