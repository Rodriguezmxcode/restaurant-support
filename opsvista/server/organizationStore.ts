import postgres from 'postgres';
import { listManagedUsers } from './managementStore.js';

export type OpsVistaOrganization = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  clientNumber: number;
};

export type OrganizationMembership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  clientNumber: number;
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
  const rows=await sql()`select id,name,slug,status,client_number from opsvista_organizations order by client_number asc`;
  return rows.map(row=>({id:String(row.id),name:String(row.name),slug:String(row.slug),status:String(row.status) as 'active'|'inactive',clientNumber:Number(row.client_number)}));
}

export async function getOrganizationMembership(userId:string):Promise<OrganizationMembership|null> {
  await bootstrapPuertoVallarta();
  const rows=await sql()`
    select o.id,o.name,o.slug,o.client_number
    from opsvista_organization_memberships m
    join opsvista_organizations o on o.id=m.organization_id
    where m.user_id=${userId} and o.status='active'
    limit 1
  `;
  const row=rows[0];
  if (!row) return null;
  return {organizationId:String(row.id),organizationName:String(row.name),organizationSlug:String(row.slug),clientNumber:Number(row.client_number)};
}
