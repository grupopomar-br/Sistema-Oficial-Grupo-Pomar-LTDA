-- Central Operacional Pomar v1. Execute primeiro esta migração no SQL Editor.
-- Não contém credenciais nem dados da operação. Cadastro do proprietário: 02_proprietario.sql.
begin;
create schema if not exists pomar_private;
revoke all on schema pomar_private from public, anon;
grant usage on schema pomar_private to authenticated;

create table pomar_private.owner_registry (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null unique references auth.users(id),
  active boolean not null default true
);
revoke all on pomar_private.owner_registry from public, anon, authenticated;

-- Exceção deliberada SECURITY DEFINER: consulta somente a lista privada de proprietário
-- e a existência da sessão no Auth. Nunca recebe um ID de usuário do chamador.
create function pomar_private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt()->>'aal', '') = 'aal2'
    and exists (select 1 from pomar_private.owner_registry o
                where o.singleton and o.active and o.owner_id = auth.uid())
    and exists (select 1 from auth.sessions s where s.user_id = auth.uid()
      and s.id::text = auth.jwt()->>'session_id');
$$;
revoke all on function pomar_private.is_owner() from public, anon;
grant execute on function pomar_private.is_owner() to authenticated;
create function public.pomar_access() returns boolean
language sql stable security invoker set search_path = '' as $$ select pomar_private.is_owner(); $$;
revoke all on function public.pomar_access() from public, anon;
grant execute on function public.pomar_access() to authenticated;

create table public.pomar_settings (
 owner_id uuid primary key references auth.users(id), id uuid not null unique default gen_random_uuid(),
 version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision bigint not null default 0 check(revision>=0),
 business_name text not null check(char_length(business_name) between 2 and 160),
 display_name text not null check(char_length(display_name) between 1 and 60),
 daily_focus_limit integer not null default 5 check(daily_focus_limit between 1 and 5),
 stale_days integer not null default 7 check(stale_days between 3 and 90)
);
create table public.pomar_areas (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 name text not null check(char_length(name) between 2 and 160), color text not null check(color in('green','amber','violet','blue')), archived boolean not null default false,
 unique(owner_id,id)
);
create table public.pomar_clients (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 name text not null check(char_length(name) between 2 and 160), kind text not null check(kind in('business','person')),
 city text not null default '' check(char_length(city)<=100), segment text not null default '' check(char_length(segment)<=100),
 contact_name text not null default '' check(char_length(contact_name)<=100), email text not null default '' check(char_length(email)<=320),
 phone text not null default '' check(char_length(phone)<=40), website text not null default '' check(website='' or website ~ '^https?://'),
 notes text not null default '' check(char_length(notes)<=5000), status text not null check(status in('active','prospect','archived')), unique(owner_id,id)
);
create table public.pomar_projects (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 name text not null check(char_length(name) between 2 and 160), client_id uuid, contractor_id uuid, area_id uuid not null,
 status text not null check(status in('planning','active','waiting','paused','completed','cancelled')), priority text not null check(priority in('P0','P1','P2','P3')),
 started_on date, due_on date, next_action text not null default '' check(char_length(next_action)<=1000), next_action_on date,
 waiting_for text not null default '' check(char_length(waiting_for)<=500), notes text not null default '' check(char_length(notes)<=10000),
 check(started_on is null or due_on is null or due_on>=started_on), unique(owner_id,id),
 foreign key(owner_id,client_id) references public.pomar_clients(owner_id,id),
 foreign key(owner_id,contractor_id) references public.pomar_clients(owner_id,id),
 foreign key(owner_id,area_id) references public.pomar_areas(owner_id,id)
);
create table public.pomar_tasks (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 title text not null check(char_length(title) between 2 and 160), project_id uuid, priority text not null check(priority in('P0','P1','P2','P3')),
 status text not null check(status in('pending','doing','blocked','done')), due_on date, focus_on date,
 description text not null default '' check(char_length(description)<=5000), completed_at timestamptz,
 check((status='done')=(completed_at is not null)), unique(owner_id,id),
 foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id)
);
create table public.pomar_contracts (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 title text not null check(char_length(title) between 2 and 160), client_id uuid not null, project_id uuid,
 total_cents bigint not null check(total_cents between 1 and 100000000000), signed_on date not null,
 status text not null default 'active' check(status in('active','cancelled','completed')), notes text not null default '' check(char_length(notes)<=5000), unique(owner_id,id),
 foreign key(owner_id,client_id) references public.pomar_clients(owner_id,id),
 foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id)
);
create table public.pomar_installments (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 contract_id uuid not null, sequence integer not null check(sequence between 1 and 120), due_on date not null,
 amount_cents bigint not null check(amount_cents between 1 and 100000000000), status text not null default 'open' check(status in('open','cancelled')),
 unique(owner_id,id), unique(owner_id,contract_id,sequence), foreign key(owner_id,contract_id) references public.pomar_contracts(owner_id,id)
);
create table public.pomar_receipts (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 contract_id uuid not null, amount_cents bigint not null check(amount_cents between 1 and 100000000000), received_on date,
 status text not null default 'confirmed' check(status in('confirmed','voided')), void_reason text not null default '' check(char_length(void_reason)<=1000),
 check(status<>'voided' or char_length(trim(void_reason))>=5), unique(owner_id,id),
 foreign key(owner_id,contract_id) references public.pomar_contracts(owner_id,id)
);
create table public.pomar_allocations (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 receipt_id uuid not null, installment_id uuid not null, amount_cents bigint not null check(amount_cents between 1 and 100000000000),
 unique(owner_id,id), foreign key(owner_id,receipt_id) references public.pomar_receipts(owner_id,id),
 foreign key(owner_id,installment_id) references public.pomar_installments(owner_id,id)
);
create table public.pomar_expenses (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 title text not null check(char_length(title) between 2 and 160), category text not null check(category in('infrastructure','service','withdrawal','other')),
 project_id uuid, amount_cents bigint not null check(amount_cents between 1 and 100000000000), due_on date, paid_on date,
 status text not null check(status in('pending','paid','cancelled')), notes text not null default '' check(char_length(notes)<=5000),
 check(status<>'paid' or paid_on is not null), unique(owner_id,id), foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id)
);
create table public.pomar_opportunities (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 title text not null check(char_length(title) between 2 and 160), client_id uuid not null,
 stage text not null check(stage in('identified','contact','diagnosis','proposal','negotiation','won','lost')),
 value_cents bigint not null default 0 check(value_cents between 0 and 100000000000), next_action text not null default '' check(char_length(next_action)<=1000),
 next_contact_on date, notes text not null default '' check(char_length(notes)<=5000), lost_reason text not null default '' check(char_length(lost_reason)<=1000), project_id uuid,
 unique(owner_id,id), foreign key(owner_id,client_id) references public.pomar_clients(owner_id,id),
 foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id)
);
create table public.pomar_updates (
 id uuid primary key, owner_id uuid not null references auth.users(id), version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 project_id uuid not null, message text not null check(char_length(message) between 3 and 5000),
 unique(owner_id,id), foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id)
);
create table public.pomar_audit_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 entity_type text not null, entity_id uuid not null, action text not null, summary text not null check(char_length(summary)<=500),
 created_at timestamptz not null default now(), before_data jsonb, after_data jsonb
);
create table public.pomar_command_log (
 owner_id uuid not null references auth.users(id), command_id uuid not null, payload jsonb not null,
 created_at timestamptz not null default now(), primary key(owner_id,command_id)
);

-- Todas as tabelas expostas têm políticas de proprietário, MFA e sessão ativa.
do $$ declare t text; begin
 foreach t in array array['settings','areas','clients','projects','tasks','contracts','installments','receipts','allocations','expenses','opportunities','updates','audit_events','command_log'] loop
   execute format('alter table public.pomar_%I enable row level security',t);
   execute format('alter table public.pomar_%I force row level security',t);
   execute format('revoke all on public.pomar_%I from public, anon, authenticated',t);
   execute format('grant select on public.pomar_%I to authenticated',t);
   execute format('create policy owner_access on public.pomar_%I to authenticated using (owner_id = (select auth.uid()) and (select pomar_private.is_owner())) with check (owner_id = (select auth.uid()) and (select pomar_private.is_owner()))',t);
 end loop;
 foreach t in array array['areas','clients','projects','tasks','contracts','installments','receipts','expenses','opportunities'] loop
   execute format('grant insert, update on public.pomar_%I to authenticated',t);
 end loop;
end $$;
grant update on public.pomar_settings to authenticated;
grant insert on public.pomar_allocations, public.pomar_updates, public.pomar_command_log to authenticated;
create index on public.pomar_projects(owner_id,status,due_on);
create index on public.pomar_projects(owner_id,client_id);
create index on public.pomar_projects(owner_id,contractor_id);
create index on public.pomar_projects(owner_id,area_id);
create index on public.pomar_tasks(owner_id,status,due_on);
create index on public.pomar_tasks(owner_id,project_id);
create index on public.pomar_contracts(owner_id,client_id);
create index on public.pomar_contracts(owner_id,project_id);
create index on public.pomar_installments(owner_id,status,due_on);
create index on public.pomar_receipts(owner_id,contract_id);
create index on public.pomar_receipts(owner_id,received_on);
create index on public.pomar_allocations(owner_id,receipt_id);
create index on public.pomar_allocations(owner_id,installment_id);
create index on public.pomar_expenses(owner_id,status,paid_on);
create index on public.pomar_expenses(owner_id,project_id);
create index on public.pomar_opportunities(owner_id,stage,next_contact_on);
create index on public.pomar_opportunities(owner_id,client_id);
create index on public.pomar_opportunities(owner_id,project_id);
create index on public.pomar_updates(owner_id,project_id,created_at desc);
create index on public.pomar_audit_events(owner_id,created_at desc,id);

create function pomar_private.touch_record() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if tg_op='UPDATE' then
   if new.id<>old.id or new.owner_id<>old.owner_id or new.created_at<>old.created_at then
     raise exception using errcode='P0001',message='POMAR_IMMUTABLE';
   end if;
   new.version:=old.version+1;
 else new.version:=1; new.created_at:=now(); end if;
 new.updated_at:=now(); return new;
end $$;

-- O log é gravado pelo banco, nunca por uma permissão de escrita do navegador.
-- SECURITY DEFINER limitado a auditar a linha autorizada pelo RLS e avançar a revisão.
create function pomar_private.audit_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; a jsonb; title text; et text; ei uuid;
begin
 if auth.uid() is null then return new; end if; -- bootstrap administrativo manual
 if new.owner_id<>auth.uid() or not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 a:=to_jsonb(new); if tg_op='UPDATE' then b:=to_jsonb(old); end if;
 if tg_table_name='pomar_settings' and (a-array['revision','version','updated_at']) is not distinct from (b-array['revision','version','updated_at']) then return new; end if;
 et:=tg_argv[0]; ei:=new.id;
 title:=coalesce(a->>'name',a->>'title','Preferências da operação');
 if tg_table_name='pomar_updates' then et:='project'; ei:=new.project_id; title:=a->>'message'; end if;
 if tg_table_name='pomar_receipts' then title:=case when new.status='voided' then 'Recebimento estornado: '||new.void_reason else 'Recebimento registrado ou conciliado.' end; end if;
 insert into public.pomar_audit_events(owner_id,entity_type,entity_id,action,summary,before_data,after_data)
 values(new.owner_id,et,ei,case when tg_table_name='pomar_updates' then 'note' when tg_op='INSERT' then 'create' else 'update' end,left(title,500),b,a);
 if tg_table_name<>'pomar_settings' then update public.pomar_settings set revision=revision+1 where owner_id=new.owner_id; end if;
 return new;
end $$;
revoke all on function pomar_private.touch_record(), pomar_private.audit_record() from public, anon, authenticated;
do $$ declare t text; et text; begin
 foreach t in array array['settings','areas','clients','projects','tasks','contracts','installments','receipts','allocations','expenses','opportunities','updates'] loop
  et:=case t when 'settings' then 'settings' when 'opportunities' then 'opportunity' when 'updates' then 'project' else left(t,-1) end;
  execute format('create trigger touch_record before insert or update on public.pomar_%I for each row execute function pomar_private.touch_record()',t);
  execute format('create trigger audit_record after insert or update on public.pomar_%I for each row execute function pomar_private.audit_record(%L)',t,et);
 end loop;
end $$;

create function pomar_private.protect_financial_record() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if tg_table_name='pomar_contracts' then
   if (new.total_cents,new.client_id,new.project_id,new.signed_on) is distinct from (old.total_cents,old.client_id,old.project_id,old.signed_on)
     or (old.status='cancelled' and new.status<>'cancelled') then raise exception using errcode='P0001',message='POMAR_IMMUTABLE'; end if;
 elsif tg_table_name='pomar_installments' then
   if (new.amount_cents,new.contract_id,new.sequence,new.due_on) is distinct from (old.amount_cents,old.contract_id,old.sequence,old.due_on)
     or (old.status='cancelled' and new.status<>'cancelled') then raise exception using errcode='P0001',message='POMAR_IMMUTABLE'; end if;
 elsif tg_table_name='pomar_receipts' then
   if (new.amount_cents,new.contract_id) is distinct from (old.amount_cents,old.contract_id)
     or (old.received_on is not null and new.received_on is distinct from old.received_on)
     or (old.status='voided' and to_jsonb(new)-array['updated_at','version'] is distinct from to_jsonb(old)-array['updated_at','version']) then
     raise exception using errcode='P0001',message='POMAR_IMMUTABLE'; end if;
 end if;
 return new;
end $$;
create trigger financial_immutable before update on public.pomar_contracts for each row execute function pomar_private.protect_financial_record();
create trigger financial_immutable before update on public.pomar_installments for each row execute function pomar_private.protect_financial_record();
create trigger financial_immutable before update on public.pomar_receipts for each row execute function pomar_private.protect_financial_record();

create function pomar_private.check_receipt_date() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.received_on > (now() at time zone 'America/Fortaleza')::date then raise exception using errcode='P0001',message='POMAR_FUTURE_DATE'; end if;
 return new;
end $$;
create trigger receipt_date before insert or update on public.pomar_receipts for each row execute function pomar_private.check_receipt_date();
create function pomar_private.check_expense_date() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.paid_on > (now() at time zone 'America/Fortaleza')::date then raise exception using errcode='P0001',message='POMAR_FUTURE_EXPENSE'; end if;
 return new;
end $$;
create trigger expense_date before insert or update on public.pomar_expenses for each row execute function pomar_private.check_expense_date();
revoke all on function pomar_private.check_expense_date() from public,anon,authenticated;

-- Antes da alocação, trava o contrato e a parcela. A mesma ordem é usada nos RPCs.
create function pomar_private.check_allocation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare installment public.pomar_installments; receipt public.pomar_receipts; contract_status text; paid bigint;
begin
 select * into installment from public.pomar_installments where owner_id=new.owner_id and id=new.installment_id;
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 select status into contract_status from public.pomar_contracts where owner_id=new.owner_id and id=installment.contract_id for update;
 select * into installment from public.pomar_installments where owner_id=new.owner_id and id=new.installment_id for update;
 select * into receipt from public.pomar_receipts where owner_id=new.owner_id and id=new.receipt_id;
 if receipt.id is null or receipt.contract_id<>installment.contract_id or receipt.status<>'confirmed' or installment.status<>'open' or contract_status<>'active' then
   raise exception using errcode='P0001',message='POMAR_INVALID_ALLOCATION';
 end if;
 select coalesce(sum(a.amount_cents),0) into paid from public.pomar_allocations a join public.pomar_receipts r on r.owner_id=a.owner_id and r.id=a.receipt_id
 where a.owner_id=new.owner_id and a.installment_id=new.installment_id and r.status='confirmed';
 if paid+new.amount_cents>installment.amount_cents then raise exception using errcode='P0001',message='POMAR_OVERPAYMENT'; end if;
 return new;
end $$;
create trigger allocation_guard before insert on public.pomar_allocations for each row execute function pomar_private.check_allocation();

-- Invariantes diferidas: contrato e parcelas / recebimento e alocações fecham juntos.
-- Também protegem chamadas REST diretas, além dos RPCs da aplicação.
create function pomar_private.check_financial_totals() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare cid uuid; rid uuid; total bigint; expected bigint; cstatus text;
begin
 if tg_table_name in ('pomar_contracts','pomar_installments') then
   cid:=(to_jsonb(new)->>case when tg_table_name='pomar_contracts' then 'id' else 'contract_id' end)::uuid;
   select total_cents,status into expected,cstatus from public.pomar_contracts where owner_id=new.owner_id and id=cid;
   select coalesce(sum(amount_cents),0) into total from public.pomar_installments where owner_id=new.owner_id and contract_id=cid;
   if total<>expected then raise exception using errcode='P0001',message='POMAR_CONTRACT_TOTAL'; end if;
   if cstatus='cancelled' and exists(select 1 from public.pomar_installments where owner_id=new.owner_id and contract_id=cid and status<>'cancelled') then raise exception using errcode='P0001',message='POMAR_CANCELLED_INSTALLMENTS'; end if;
 elsif tg_table_name in ('pomar_receipts','pomar_allocations') then
   rid:=(to_jsonb(new)->>case when tg_table_name='pomar_receipts' then 'id' else 'receipt_id' end)::uuid;
   select amount_cents into expected from public.pomar_receipts where owner_id=new.owner_id and id=rid;
   select coalesce(sum(amount_cents),0) into total from public.pomar_allocations where owner_id=new.owner_id and receipt_id=rid;
   if total<>expected then raise exception using errcode='P0001',message='POMAR_RECEIPT_TOTAL'; end if;
 end if;
 return new;
end $$;
create constraint trigger contract_total after insert or update on public.pomar_contracts deferrable initially deferred for each row execute function pomar_private.check_financial_totals();
create constraint trigger installment_total after insert or update on public.pomar_installments deferrable initially deferred for each row execute function pomar_private.check_financial_totals();
create constraint trigger receipt_total after insert or update on public.pomar_receipts deferrable initially deferred for each row execute function pomar_private.check_financial_totals();
create constraint trigger allocation_total after insert on public.pomar_allocations deferrable initially deferred for each row execute function pomar_private.check_financial_totals();

-- Escrita genérica só aceita esta lista fixa de tabelas e colunas. Nomes do usuário
-- nunca se tornam identificadores SQL. A versão é comparada no próprio UPDATE.
create function pomar_private.save_entity(p_entity text,p_value jsonb,p_version integer) returns void
language plpgsql security invoker set search_path='' as $$
declare cols text[]; col_list text; assignments text; table_name text; existing integer; changed integer;
begin
 cols:=case p_entity
 when 'clients' then array['name','kind','city','segment','contact_name','email','phone','website','notes','status']
 when 'areas' then array['name','color','archived']
 when 'projects' then array['name','client_id','contractor_id','area_id','status','priority','started_on','due_on','next_action','next_action_on','waiting_for','notes']
 when 'tasks' then array['title','project_id','priority','status','due_on','focus_on','description','completed_at']
 when 'expenses' then array['title','category','project_id','amount_cents','due_on','paid_on','status','notes']
 when 'opportunities' then array['title','client_id','stage','value_cents','next_action','next_contact_on','notes','lost_reason','project_id']
 else null end;
 if cols is null or exists(select 1 from jsonb_object_keys(p_value) k where not (k=any(cols||array['id']))) then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
 table_name:='pomar_'||p_entity;
 select string_agg(format('%I',c),',') into col_list from unnest(cols) c;
 select string_agg(format('%I = r.%I',c,c),',') into assignments from unnest(cols) c;
 execute format('select version from public.%I where owner_id=$1 and id=$2',table_name) into existing using auth.uid(),(p_value->>'id')::uuid;
 if existing is null then
   if p_version<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
   execute format('insert into public.%I(id,owner_id,%s) select r.id,$1,%s from jsonb_populate_record(null::public.%I,$2) r',table_name,col_list,col_list,table_name) using auth.uid(),p_value;
 else
   execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=r.id and t.owner_id=$2 and t.version=$3',table_name,assignments,table_name) using p_value,auth.uid(),p_version;
   get diagnostics changed=row_count;
   if changed<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
 end if;
end $$;
revoke all on function pomar_private.save_entity(text,jsonb,integer) from public, anon;
grant execute on function pomar_private.save_entity(text,jsonb,integer) to authenticated;

-- Uma transação por comando; nenhuma chave de serviço é usada. O log torna uma
-- repetição do mesmo comando inofensiva e rejeita reutilizar a chave com outro conteúdo.
create function public.pomar_command(p_key uuid,p_command jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 uid uuid:=auth.uid(); kind text:=p_command->>'type'; value jsonb:=p_command->'value';
 saved jsonb; inserted integer; entity text; record_id uuid; count_parts integer; amount bigint; first_due date;
 i integer; cid uuid; iid uuid; current_contract public.pomar_contracts; current_installment public.pomar_installments;
 current_receipt public.pomar_receipts; opp public.pomar_opportunities; task public.pomar_tasks;
 paid bigint; changed integer; expected integer; received date;
begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 if p_key is null or jsonb_typeof(p_command)<>'object' then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
 insert into public.pomar_command_log(owner_id,command_id,payload) values(uid,p_key,p_command) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then
  select payload into saved from public.pomar_command_log where owner_id=uid and command_id=p_key;
  if saved is distinct from p_command then raise exception using errcode='P0001',message='POMAR_KEY_REUSED'; end if;
  return jsonb_build_object('duplicate',true);
 end if;
 if kind in ('saveClient','saveArea','saveProject','saveTask','saveExpense','saveOpportunity') then
   entity:=case kind when 'saveClient' then 'clients' when 'saveArea' then 'areas' when 'saveProject' then 'projects' when 'saveTask' then 'tasks' when 'saveExpense' then 'expenses' else 'opportunities' end;
   expected:=(value->>'version')::integer;
   value:=value-array['version','created_at','updated_at'];
   if entity='tasks' then value:=jsonb_set(value,'{completed_at}',case when value->>'status'='done' then coalesce(nullif(value->'completed_at','null'::jsonb),to_jsonb(now())) else 'null'::jsonb end); end if;
   perform pomar_private.save_entity(entity,value,expected);
 elsif kind='saveSettings' then
   update public.pomar_settings set business_name=value->>'business_name',display_name=value->>'display_name',daily_focus_limit=(value->>'daily_focus_limit')::integer,stale_days=(value->>'stale_days')::integer,revision=revision+1
   where owner_id=uid and revision=(p_command->>'expected_revision')::bigint;
   get diagnostics changed=row_count; if changed<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
 elsif kind='setTaskStatus' then
   update public.pomar_tasks set status=p_command->>'status',completed_at=case when p_command->>'status'='done' then coalesce(completed_at,now()) else null end
   where owner_id=uid and id=(p_command->>'id')::uuid and version=(p_command->>'expected_version')::integer;
   get diagnostics changed=row_count; if changed<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
 elsif kind='createContract' then
   count_parts:=(p_command->>'count')::integer; amount:=(value->>'total_cents')::bigint; first_due:=(p_command->>'first_due_on')::date; cid:=(value->>'id')::uuid;
   if count_parts not between 1 and 120 or amount<count_parts or value->>'status'<>'active' then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
   insert into public.pomar_contracts(id,owner_id,title,client_id,project_id,total_cents,signed_on,status,notes)
   values(cid,uid,value->>'title',(value->>'client_id')::uuid,(value->>'project_id')::uuid,amount,(value->>'signed_on')::date,'active',coalesce(value->>'notes',''));
   for i in 0..count_parts-1 loop
     insert into public.pomar_installments(id,owner_id,contract_id,sequence,due_on,amount_cents,status)
     values(gen_random_uuid(),uid,cid,i+1,(first_due+make_interval(months=>i))::date,amount/count_parts+case when i<amount%count_parts then 1 else 0 end,'open');
   end loop;
 elsif kind='postReceipt' then
   iid:=(p_command->>'installment_id')::uuid; amount:=(p_command->>'amount_cents')::bigint; received:=(p_command->>'received_on')::date;
   select contract_id into cid from public.pomar_installments where owner_id=uid and id=iid;
   select * into current_contract from public.pomar_contracts where owner_id=uid and id=cid for update;
   select * into current_installment from public.pomar_installments where owner_id=uid and id=iid for update;
   if current_contract.id is null or current_contract.status<>'active' or current_installment.status<>'open' then raise exception using errcode='P0001',message='POMAR_NOT_ACTIVE'; end if;
   insert into public.pomar_receipts(id,owner_id,contract_id,amount_cents,received_on) values(p_key,uid,cid,amount,received);
   insert into public.pomar_allocations(id,owner_id,receipt_id,installment_id,amount_cents) values(gen_random_uuid(),uid,p_key,iid,amount);
 elsif kind in ('dateReceipt','voidReceipt') then
   record_id:=(p_command->>'id')::uuid;
   select contract_id into cid from public.pomar_receipts where owner_id=uid and id=record_id;
   perform 1 from public.pomar_contracts where owner_id=uid and id=cid for update;
   -- Mesmo contrato serializa recebimentos, estornos e cancelamentos.
   select * into current_receipt from public.pomar_receipts where owner_id=uid and id=record_id for update;
   if current_receipt.id is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
   if kind='voidReceipt' then
     if char_length(trim(p_command->>'reason'))<5 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
     if current_receipt.status<>'voided' then update public.pomar_receipts set status='voided',void_reason=p_command->>'reason' where owner_id=uid and id=record_id; end if;
   else
     if current_receipt.status<>'confirmed' or current_receipt.received_on is not null then raise exception using errcode='P0001',message='POMAR_ALREADY_DATED'; end if;
     update public.pomar_receipts set received_on=(p_command->>'received_on')::date where owner_id=uid and id=record_id;
   end if;
 elsif kind='cancelContract' then
   cid:=(p_command->>'id')::uuid;
   if char_length(trim(p_command->>'reason'))<5 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
   select * into current_contract from public.pomar_contracts where owner_id=uid and id=cid for update;
   if current_contract.id is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
   if current_contract.status<>'cancelled' then
     update public.pomar_contracts set status='cancelled',notes=left(trim(notes||E'\nCancelamento: '||(p_command->>'reason')),5000) where owner_id=uid and id=cid;
     update public.pomar_installments set status='cancelled' where owner_id=uid and contract_id=cid;
   end if;
 elsif kind='addUpdate' then
   insert into public.pomar_updates(id,owner_id,project_id,message) values(p_key,uid,(p_command->>'project_id')::uuid,p_command->>'message');
   update public.pomar_projects set updated_at=now() where owner_id=uid and id=(p_command->>'project_id')::uuid;
 elsif kind='convertOpportunity' then
   select * into opp from public.pomar_opportunities where owner_id=uid and id=(p_command->>'id')::uuid for update;
   if opp.id is null or opp.stage='lost' then raise exception using errcode='P0001',message='POMAR_NOT_ACTIVE'; end if;
   if opp.project_id is null then
     record_id:=(p_command->>'project_id')::uuid;
     insert into public.pomar_projects(id,owner_id,name,client_id,contractor_id,area_id,status,priority,started_on,due_on,next_action,next_action_on,waiting_for,notes)
     values(record_id,uid,opp.title,opp.client_id,null,(p_command->>'area_id')::uuid,'planning','P2',(now() at time zone 'America/Fortaleza')::date,(p_command->>'due_on')::date,'Definir escopo e próximos passos.',null,'',opp.notes);
     update public.pomar_opportunities set project_id=record_id,stage='won' where owner_id=uid and id=opp.id;
   end if;
 else raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
 return jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.pomar_command(uuid,jsonb) from public, anon;
grant execute on function public.pomar_command(uuid,jsonb) to authenticated;
revoke all on function pomar_private.protect_financial_record(),pomar_private.check_receipt_date(),pomar_private.check_allocation(),pomar_private.check_financial_totals() from public,anon,authenticated;
comment on function public.pomar_command(uuid,jsonb) is 'Comandos transacionais, idempotentes e sujeitos ao RLS. Valores em centavos inteiros.';

-- Um único statement produz um snapshot consistente, sem leituras parciais entre tabelas.
-- O limite explícito evita relatórios incompletos quando a v1 precisar ser ampliada.
create function public.pomar_workspace() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; settings jsonb; t text; rows jsonb; max_rows integer; total bigint;
begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 select to_jsonb(s)-array['id','owner_id','version','created_at','updated_at'] into settings from public.pomar_settings s where owner_id=auth.uid();
 if settings is null then raise exception using errcode='P0001',message='POMAR_NOT_INITIALIZED'; end if;
 result:=jsonb_build_object('schema_version',1,'revision',settings->'revision','settings',settings-'revision','processed_commands','[]'::jsonb);
 foreach t in array array['clients','areas','projects','tasks','contracts','installments','receipts','allocations','expenses','opportunities','updates'] loop
  max_rows:=case when t='areas' then 100 when t in('tasks','installments','receipts','allocations','updates') then 20000 else 10000 end;
  execute format('select count(*) from public.pomar_%I where owner_id=$1',t) into total using auth.uid();
  if total>max_rows then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)-''owner_id'' order by r.created_at,r.id),''[]''::jsonb) from public.pomar_%I r where owner_id=$1',t) into rows using auth.uid();
  result:=result||jsonb_build_object(t,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]'::jsonb) into rows from
  (select id,entity_type,entity_id,action,summary,created_at from public.pomar_audit_events where owner_id=auth.uid() order by created_at desc,id limit 1000) a;
 return result||jsonb_build_object('history',rows);
end $$;
revoke all on function public.pomar_workspace() from public,anon;
grant execute on function public.pomar_workspace() to authenticated;
commit;
