-- v0.4: integração opcional. Sem credencial administrativa nas rotas da aplicação.
-- O worker não possui acesso às tabelas: somente às funções delimitadas abaixo.
begin;
do $$begin
 if not exists(select 1 from pg_roles where rolname='pomar_billing_worker') then
  create role pomar_billing_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 end if;
 if exists(select 1 from pg_roles where rolname='pomar_billing_worker' and (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls)) then raise exception 'O papel do worker tem privilégios incompatíveis.';end if;
end $$;
revoke all on schema public,pomar_private from pomar_billing_worker;
grant usage on schema public to pomar_billing_worker;
revoke create on schema public from public,anon,authenticated,pomar_billing_worker;
create table pomar_private.billing_config (
 singleton boolean primary key default true check(singleton),owner_id uuid not null references auth.users(id),collector_id text not null check(collector_id ~ '^\d{1,30}$'),
 mode text not null check(mode in('test','live')),enabled boolean not null default false
);
alter table pomar_private.billing_config enable row level security;alter table pomar_private.billing_config force row level security;
revoke all on pomar_private.billing_config from public,anon,authenticated,pomar_billing_worker;
create table public.pomar_charges (
 id uuid primary key,owner_id uuid not null references auth.users(id),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 installment_id uuid not null,provider text not null default 'mercadopago' check(provider='mercadopago'),status text not null default 'creating' check(status in('creating','ready','creation_unknown','failed')),
 mode text not null check(mode in('test','live')),amount_cents bigint not null check(amount_cents between 1 and 100000000000),expires_at timestamptz not null,
 checkout_url text not null default '' check(char_length(checkout_url)<=2048),preference_id text check(char_length(preference_id)<=200),unique(owner_id,id),unique(preference_id),
 foreign key(owner_id,installment_id) references public.pomar_installments(owner_id,id)
);
create table public.pomar_provider_payments (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 provider text not null default 'mercadopago' check(provider='mercadopago'),provider_payment_id text not null check(provider_payment_id ~ '^\d{1,30}$'),charge_id uuid,receipt_id uuid,
 amount_cents bigint not null check(amount_cents between 1 and 100000000000),fee_cents bigint check(fee_cents between 0 and 100000000000),refunded_cents bigint not null default 0 check(refunded_cents>=0 and refunded_cents<=amount_cents),
 currency text not null check(currency='BRL'),status text not null check(status in('pending','in_process','authorized','approved','rejected','cancelled','in_mediation','refunded','charged_back','unknown')),
 mode text not null check(mode in('test','live')),paid_on date,provider_updated_at timestamptz not null,review_reason text not null default '' check(char_length(review_reason)<=300),
 unique(owner_id,id),unique(provider,provider_payment_id,mode),unique(receipt_id),foreign key(owner_id,charge_id) references public.pomar_charges(owner_id,id),foreign key(owner_id,receipt_id) references public.pomar_receipts(owner_id,id)
);
create table public.pomar_refunds (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 receipt_id uuid not null,installment_id uuid not null,provider_payment_id uuid not null,provider_refund_id text not null check(provider_refund_id ~ '^\d{1,40}$'),amount_cents bigint not null check(amount_cents between 1 and 100000000000),occurred_on date not null,reason text not null default 'refund' check(reason='refund'),
 unique(owner_id,id),unique(provider_payment_id,provider_refund_id),foreign key(owner_id,receipt_id) references public.pomar_receipts(owner_id,id),foreign key(owner_id,installment_id) references public.pomar_installments(owner_id,id),foreign key(owner_id,provider_payment_id) references public.pomar_provider_payments(owner_id,id)
);
do $$declare t text;begin
 foreach t in array array['charges','provider_payments','refunds'] loop
  execute format('alter table public.pomar_%I enable row level security',t);execute format('alter table public.pomar_%I force row level security',t);
  execute format('revoke all on public.pomar_%I from public,anon,authenticated,pomar_billing_worker',t);execute format('grant select on public.pomar_%I to authenticated',t);
  execute format('create policy owner_read on public.pomar_%I for select to authenticated using(owner_id=(select auth.uid()) and (select pomar_private.is_owner()))',t);
  execute format('create trigger touch_record before insert or update on public.pomar_%I for each row execute function pomar_private.touch_record()',t);
 end loop;
end $$;
create index on public.pomar_charges(owner_id,installment_id,created_at desc);
create index on public.pomar_charges(owner_id,status,expires_at);
create index on public.pomar_provider_payments(owner_id,charge_id);
create index on public.pomar_provider_payments(owner_id,review_reason) where review_reason<>'';
create index on public.pomar_refunds(owner_id,installment_id);
create index on public.pomar_refunds(owner_id,receipt_id);
create index on public.pomar_refunds(owner_id,occurred_on);
create function pomar_private.billing_audit(p_owner uuid,p_entity text,p_id uuid,p_summary text) returns void
language plpgsql security invoker set search_path='' as $$begin
 insert into public.pomar_audit_events(owner_id,entity_type,entity_id,action,summary) values(p_owner,p_entity,p_id,'provider_sync',left(p_summary,500));
 update public.pomar_settings set revision=revision+1 where owner_id=p_owner;
end $$;
revoke all on function pomar_private.billing_audit(uuid,text,uuid,text) from public,anon,authenticated,pomar_billing_worker;

create function public.pomar_billing_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$declare c pomar_private.billing_config;begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 select * into c from pomar_private.billing_config where singleton and owner_id=auth.uid();return jsonb_build_object('configured',c.enabled is true,'mode',c.mode);
end $$;
create function public.pomar_prepare_charge(p_key uuid,p_installment_id uuid,p_expires_hours integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c pomar_private.billing_config;part public.pomar_installments;contract public.pomar_contracts;existing public.pomar_charges;paid bigint;amount bigint;
begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 if not pomar_private.recent_mfa() then raise exception using errcode='42501',message='POMAR_RECENT_MFA';end if;
 select * into c from pomar_private.billing_config where singleton and owner_id=auth.uid() and enabled;
 if c.owner_id is null then raise exception using errcode='P0001',message='POMAR_BILLING_DISABLED';end if;
 if p_key is null or p_expires_hours not between 1 and 168 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 select * into part from public.pomar_installments where owner_id=c.owner_id and id=p_installment_id;
 select * into contract from public.pomar_contracts where owner_id=c.owner_id and id=part.contract_id for update;
 if part.id is null or part.status<>'open' or contract.status<>'active' then raise exception using errcode='P0001',message='POMAR_NOT_ACTIVE';end if;
 select * into existing from public.pomar_charges where id=p_key;
 if found then
  if existing.owner_id<>c.owner_id or existing.installment_id<>p_installment_id or abs(extract(epoch from(existing.expires_at-existing.created_at))-p_expires_hours*3600)>1 then raise exception using errcode='P0001',message='POMAR_KEY_REUSED';end if;
  return jsonb_build_object('charge',to_jsonb(existing)-'owner_id','created',false,'collector_id',c.collector_id);
 end if;
 if exists(select 1 from public.pomar_charges where owner_id=c.owner_id and installment_id=p_installment_id and status in('creating','ready','creation_unknown') and expires_at>now() and not exists(select 1 from public.pomar_provider_payments p where p.charge_id=pomar_charges.id and p.receipt_id is not null)) then raise exception using errcode='P0001',message='POMAR_ACTIVE_CHARGE';end if;
 select coalesce(sum(a.amount_cents),0) into paid from public.pomar_allocations a join public.pomar_receipts r on r.owner_id=a.owner_id and r.id=a.receipt_id where a.owner_id=c.owner_id and a.installment_id=p_installment_id and r.status='confirmed';
 select paid-coalesce(sum(amount_cents),0) into paid from public.pomar_refunds where owner_id=c.owner_id and installment_id=p_installment_id;
 amount:=part.amount_cents-paid;if amount<=0 then raise exception using errcode='P0001',message='POMAR_NOT_ACTIVE';end if;
 insert into public.pomar_charges(id,owner_id,installment_id,mode,amount_cents,expires_at) values(p_key,c.owner_id,p_installment_id,c.mode,amount,now()+make_interval(hours=>p_expires_hours)) returning * into existing;
 perform pomar_private.billing_audit(c.owner_id,'installment',part.id,'Cobrança preparada para checkout do provedor.');
 return jsonb_build_object('charge',to_jsonb(existing)-'owner_id','created',true,'collector_id',c.collector_id);
end $$;

create function public.pomar_billing_worker_status() returns jsonb language plpgsql stable security definer set search_path='' as $$declare c pomar_private.billing_config;begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 select * into c from pomar_private.billing_config where singleton;
 return jsonb_build_object('owner_id',c.owner_id,'collector_id',c.collector_id,'mode',c.mode,'enabled',coalesce(c.enabled,false));
end $$;
revoke all on function public.pomar_billing_worker_status() from public,anon,authenticated,pomar_billing_worker;
grant execute on function public.pomar_billing_worker_status() to pomar_billing_worker;

create function public.pomar_billing_attach(p_id uuid,p_preference_id text,p_url text,p_collector_id text,p_mode text) returns void
language plpgsql security definer set search_path='' as $$declare c pomar_private.billing_config;charge public.pomar_charges;begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 select * into c from pomar_private.billing_config where singleton and enabled and collector_id=p_collector_id and mode=p_mode;
 if c.owner_id is null then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 select * into charge from public.pomar_charges where owner_id=c.owner_id and id=p_id for update;
 if charge.id is null or charge.mode<>c.mode then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 if charge.status='ready' and charge.preference_id=p_preference_id and charge.checkout_url=p_url then return;end if;
 if (p_mode='live' and p_url ~ '^https://sandbox\.') or charge.status not in('creating','creation_unknown') or p_url !~ '^https://(www|sandbox)\.mercadopago\.com(\.br)?/[^?#]*checkout/[^#]*[?&]pref_id=' or char_length(p_preference_id) not between 3 and 200 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 update public.pomar_charges set status='ready',checkout_url=p_url,preference_id=p_preference_id where id=charge.id;
 perform pomar_private.billing_audit(c.owner_id,'installment',charge.installment_id,'Link de pagamento com validade real confirmado pelo provedor.');
end $$;
create function public.pomar_billing_creation_failed(p_id uuid,p_definitive boolean) returns void
language plpgsql security definer set search_path='' as $$declare c pomar_private.billing_config;charge public.pomar_charges;begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 select * into c from pomar_private.billing_config where singleton and enabled;if c.owner_id is null then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 update public.pomar_charges set status=case when p_definitive then 'failed' else 'creation_unknown' end where id=p_id and owner_id=c.owner_id and status='creating' returning * into charge;
 if found then perform pomar_private.billing_audit(c.owner_id,'installment',charge.installment_id,'Criação de checkout não confirmada; conferir antes de repetir.');end if;
end $$;

-- A baixa exige dados consultados pelo servidor no provedor e uma conexão com papel restrito.
-- Notificação repetida ou fora de ordem nunca duplica recebimento ou devolução.
create function public.pomar_billing_apply_payment(p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c pomar_private.billing_config;charge public.pomar_charges;part public.pomar_installments;contract public.pomar_contracts;
 payment public.pomar_provider_payments;old_payment public.pomar_provider_payments;pid text:=p_event->>'provider_payment_id';external_ref uuid;v_status text:=p_event->>'status';
 amount bigint:=(p_event->>'amount_cents')::bigint;refunded bigint:=(p_event->>'refunded_cents')::bigint;at timestamptz:=(p_event->>'provider_updated_at')::timestamptz;v_paid_on date:=(p_event->>'paid_on')::date;
 paid bigint;remaining bigint;reason text:='';r jsonb;refund_sum bigint;already bigint;new_receipt uuid;
begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 select * into c from pomar_private.billing_config where singleton and enabled and collector_id=p_event->>'collector_id' and mode=p_event->>'mode';
 if c.owner_id is null then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 if pid !~ '^\d{1,30}$' or p_event->>'currency'<>'BRL' or amount not between 1 and 100000000000 or refunded not between 0 and amount or at is null or at>now()+interval '5 minutes' or v_paid_on>(now() at time zone 'America/Fortaleza')::date then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 if p_event->>'external_reference' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then external_ref:=(p_event->>'external_reference')::uuid;end if;
 select * into charge from public.pomar_charges where id=external_ref and owner_id=c.owner_id;
 if charge.id is null then return jsonb_build_object('ignored',true);end if; -- ignora transações desta conta que não pertencem à Central

 if charge.id is not null then
  select * into part from public.pomar_installments where id=charge.installment_id and owner_id=c.owner_id;
  select * into contract from public.pomar_contracts where id=part.contract_id and owner_id=c.owner_id for update;
 end if;
 insert into public.pomar_provider_payments(owner_id,provider_payment_id,charge_id,amount_cents,refunded_cents,currency,status,mode,paid_on,provider_updated_at)
 values(c.owner_id,pid,charge.id,amount,0,'BRL','pending',c.mode,null,'1970-01-01T00:00:00Z') on conflict(provider,provider_payment_id,mode) do nothing;
 select * into payment from public.pomar_provider_payments where provider_payment_id=pid and mode=c.mode for update;
 old_payment:=payment;
 if at<payment.provider_updated_at then return jsonb_build_object('duplicate',true);end if;
 if payment.provider_updated_at=at and payment.status=v_status and payment.refunded_cents=refunded and payment.review_reason='' then return jsonb_build_object('duplicate',true);end if;
 if payment.amount_cents<>amount or (payment.charge_id is not null and payment.charge_id is distinct from charge.id) then raise exception using errcode='22023',message='POMAR_PAYMENT_CHANGED';end if;
 if charge.id is null then reason:='Referência de cobrança não localizada.';
 elsif charge.mode<>c.mode then reason:='Ambiente do checkout divergente.';
 elsif amount<>charge.amount_cents then reason:='Valor pago diverge do valor da cobrança.';
 elsif v_status in('in_mediation','charged_back','unknown') then reason:='Contestação ou estado que exige conciliação manual.';
 elsif v_status in('approved','refunded') and v_paid_on is null then reason:='Data de aprovação não confirmada.';
 end if;
 if payment.receipt_id is not null and v_status in('pending','in_process','authorized','rejected','cancelled') and refunded=0 then reason:='Estado posterior incompatível com recebimento confirmado.';end if;
 if reason='' and c.mode='live' and v_status in('approved','refunded') and payment.receipt_id is null then
  select coalesce(sum(a.amount_cents),0) into paid from public.pomar_allocations a join public.pomar_receipts r on r.id=a.receipt_id and r.owner_id=a.owner_id where a.owner_id=c.owner_id and a.installment_id=part.id and r.status='confirmed';
  select paid-coalesce(sum(amount_cents),0) into paid from public.pomar_refunds where owner_id=c.owner_id and installment_id=part.id;remaining:=part.amount_cents-paid;
  if contract.status<>'active' or part.status<>'open' then reason:='Pagamento confirmado após encerramento; conciliar o destino.';
  elsif amount>remaining then reason:='Pagamento excede o saldo atual; conferir pagamento manual ou duplicado.';
  else
   new_receipt:=gen_random_uuid();insert into public.pomar_receipts(id,owner_id,contract_id,amount_cents,received_on) values(new_receipt,c.owner_id,contract.id,amount,v_paid_on);
   insert into public.pomar_allocations(id,owner_id,receipt_id,installment_id,amount_cents) values(gen_random_uuid(),c.owner_id,new_receipt,part.id,amount);
   payment.receipt_id:=new_receipt;
  end if;
 end if;
 if refunded<payment.refunded_cents then reason:='Total de devoluções retrocedeu; conferir o provedor.';end if;
 if refunded>0 and payment.receipt_id is not null then
  select coalesce(sum((j->>'amount_cents')::bigint),0) into refund_sum from jsonb_array_elements(coalesce(p_event->'refunds','[]'::jsonb)) j;
  if p_event->>'refunds_complete'<>'true' or refund_sum<>refunded then reason:='Devolução identificada sem detalhamento completo.';
  else
   for r in select * from jsonb_array_elements(p_event->'refunds') loop
    if r->>'provider_refund_id' !~ '^\d{1,40}$' or (r->>'amount_cents')::bigint<=0 or (r->>'occurred_on')::date>(now() at time zone 'America/Fortaleza')::date then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
    select amount_cents into already from public.pomar_refunds where provider_payment_id=payment.id and provider_refund_id=r->>'provider_refund_id';
    if found and already<>(r->>'amount_cents')::bigint then raise exception using errcode='22023',message='POMAR_PAYMENT_CHANGED';end if;
    insert into public.pomar_refunds(owner_id,receipt_id,installment_id,provider_payment_id,provider_refund_id,amount_cents,occurred_on) values(c.owner_id,payment.receipt_id,part.id,payment.id,r->>'provider_refund_id',(r->>'amount_cents')::bigint,(r->>'occurred_on')::date) on conflict(provider_payment_id,provider_refund_id) do nothing;
   end loop;
   select coalesce(sum(amount_cents),0) into refund_sum from public.pomar_refunds where provider_payment_id=payment.id;
   if refund_sum<>refunded or refund_sum>amount then raise exception using errcode='22023',message='POMAR_REFUND_TOTAL';end if;
  end if;
 end if;
 update public.pomar_provider_payments set charge_id=coalesce(charge_id,charge.id),receipt_id=payment.receipt_id,status=v_status,paid_on=v_paid_on,fee_cents=(p_event->>'fee_cents')::bigint,refunded_cents=greatest(refunded_cents,refunded),provider_updated_at=at,review_reason=reason where id=payment.id;
 perform pomar_private.billing_audit(c.owner_id,case when c.mode='test' then 'payment_test' else 'receipt' end,coalesce(payment.receipt_id,payment.id),case when reason='' then case when c.mode='test' then 'Simulação de pagamento; sem baixa financeira; estado: ' else 'Pagamento do provedor verificado; estado: ' end||v_status else 'Pagamento do provedor em revisão: '||reason end);
 return jsonb_build_object('duplicate',false,'review',reason<>'');
end $$;

-- As condições aceitas também são respeitadas nas transições do projeto.
create function pomar_private.check_project_payment_gate() returns trigger language plpgsql security invoker set search_path='' as $$
declare c record;paid bigint;returned bigint;
begin
 if new.status=old.status or new.status not in('active','completed') then return new;end if;
 for c in select contract.id,contract.total_cents,a.initial_cents,a.gate from public.pomar_contracts contract join public.pomar_collection_agreements a on a.owner_id=contract.owner_id and a.contract_id=contract.id
  where contract.owner_id=new.owner_id and contract.project_id=new.id and contract.status='active' and a.accepted_on is not null loop
  select coalesce(sum(al.amount_cents),0) into paid from public.pomar_allocations al join public.pomar_receipts r on r.owner_id=al.owner_id and r.id=al.receipt_id where r.owner_id=new.owner_id and r.contract_id=c.id and r.status='confirmed';
  select coalesce(sum(f.amount_cents),0) into returned from public.pomar_refunds f join public.pomar_receipts r on r.owner_id=f.owner_id and r.id=f.receipt_id where r.owner_id=new.owner_id and r.contract_id=c.id;
  if (new.status='active' and c.gate='initial' and paid-returned<c.initial_cents) or (new.status='completed' and c.gate='full' and paid-returned<c.total_cents) then raise exception using errcode='P0001',message='POMAR_PAYMENT_GATE';end if;
 end loop;return new;
end $$;
create trigger project_payment_gate before update on public.pomar_projects for each row execute function pomar_private.check_project_payment_gate();
revoke all on function pomar_private.check_project_payment_gate() from public,anon,authenticated,pomar_billing_worker;

-- Originais do provedor não podem ser estornados manualmente pelo navegador.
create function pomar_private.protect_provider_receipt() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if exists(select 1 from public.pomar_provider_payments where receipt_id=old.id and owner_id=old.owner_id) and (new.status,new.received_on,new.amount_cents) is distinct from(old.status,old.received_on,old.amount_cents) then raise exception using errcode='P0001',message='POMAR_PROVIDER_RECEIPT';end if;return new;
end $$;
create trigger provider_receipt before update on public.pomar_receipts for each row execute function pomar_private.protect_provider_receipt();
create or replace function pomar_private.check_allocation() returns trigger language plpgsql security invoker set search_path='' as $$
declare part public.pomar_installments;receipt public.pomar_receipts;cstatus text;paid bigint;
begin
 select * into part from public.pomar_installments where owner_id=new.owner_id and id=new.installment_id;
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 select status into cstatus from public.pomar_contracts where owner_id=new.owner_id and id=part.contract_id for update;
 select * into part from public.pomar_installments where owner_id=new.owner_id and id=new.installment_id for update;
 select * into receipt from public.pomar_receipts where owner_id=new.owner_id and id=new.receipt_id;
 if receipt.id is null or receipt.contract_id<>part.contract_id or receipt.status<>'confirmed' or part.status<>'open' or cstatus<>'active' then raise exception using errcode='P0001',message='POMAR_INVALID_ALLOCATION';end if;
 select coalesce(sum(a.amount_cents),0) into paid from public.pomar_allocations a join public.pomar_receipts r on r.owner_id=a.owner_id and r.id=a.receipt_id where a.owner_id=new.owner_id and a.installment_id=part.id and r.status='confirmed';
 select paid-coalesce(sum(amount_cents),0) into paid from public.pomar_refunds where owner_id=new.owner_id and installment_id=part.id;
 if paid+new.amount_cents>part.amount_cents then raise exception using errcode='P0001',message='POMAR_OVERPAYMENT';end if;return new;
end $$;
revoke all on function pomar_private.protect_provider_receipt(),public.pomar_billing_status(),public.pomar_prepare_charge(uuid,uuid,integer),public.pomar_billing_attach(uuid,text,text,text,text),public.pomar_billing_creation_failed(uuid,boolean),public.pomar_billing_apply_payment(jsonb) from public,anon,authenticated,pomar_billing_worker;
grant execute on function public.pomar_billing_status(),public.pomar_prepare_charge(uuid,uuid,integer) to authenticated;
grant execute on function public.pomar_billing_attach(uuid,text,text,text,text),public.pomar_billing_creation_failed(uuid,boolean),public.pomar_billing_apply_payment(jsonb) to pomar_billing_worker;

-- Mantém uma leitura MVCC única também para cobranças, pagamentos e devoluções.
alter function public.pomar_workspace() rename to pomar_workspace_v2;
alter function public.pomar_workspace_v2() set schema pomar_private;
create function public.pomar_workspace() returns jsonb language plpgsql stable security invoker set search_path='' as $$declare result jsonb;t text;rows jsonb;n bigint;begin
 result:=pomar_private.pomar_workspace_v2();
 foreach t in array array['charges','provider_payments','refunds'] loop
  execute format('select count(*) from public.pomar_%I where owner_id=$1',t) into n using auth.uid();if n>20000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)-''owner_id'' order by created_at,id),''[]''::jsonb) from public.pomar_%I r where owner_id=$1',t) into rows using auth.uid();result:=result||jsonb_build_object(t,rows);
 end loop;return result;
end $$;
revoke all on function public.pomar_workspace() from public,anon;
grant execute on function public.pomar_workspace() to authenticated;
commit;
