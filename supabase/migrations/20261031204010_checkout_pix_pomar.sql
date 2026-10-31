-- v0.5: payment-only capability links. No public workspace or table grants.
-- Apply once after the three earlier migrations. Existing billing stays disabled.
begin;

create table pomar_private.pix_checkouts (
 charge_id uuid primary key references public.pomar_charges(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 payment_id text unique check(payment_id ~ '^\d{1,30}$'),
 qr_code text check(char_length(qr_code)<=4096),
 qr_base64 text check(char_length(qr_base64)<=800000),
 payer jsonb check(payer is null or (jsonb_typeof(payer)='object' and octet_length(payer::text)<=2048)),
 attempts integer not null default 0 check(attempts between 0 and 20),
 next_attempt_at timestamptz, next_poll_at timestamptz,
 created_at timestamptz not null default now()
);
alter table pomar_private.pix_checkouts enable row level security;
alter table pomar_private.pix_checkouts force row level security;
revoke all on pomar_private.pix_checkouts from public,anon,authenticated,pomar_billing_worker;
grant usage on schema pomar_private to pomar_billing_worker;

create function pomar_private.pix_checkout_capabilities() returns integer
language plpgsql security definer set search_path='' as $$begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 return 1;
end $$;

create function pomar_private.pix_checkout_create(p_id uuid,p_hash text,p_url text,p_collector text,p_mode text) returns void
language plpgsql security definer set search_path='' as $$
declare c pomar_private.billing_config;ch public.pomar_charges;
begin
 perform pomar_private.pix_checkout_capabilities();
 select * into c from pomar_private.billing_config where singleton and enabled and collector_id=p_collector and mode=p_mode;
 if c.owner_id is null or not exists(select 1 from pomar_private.owner_registry where singleton and active and owner_id=c.owner_id) then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 select * into ch from public.pomar_charges where id=p_id and owner_id=c.owner_id and mode=c.mode for update;
 if ch.id is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 if exists(select 1 from pomar_private.pix_checkouts where charge_id=p_id) and ch.status='ready' then return;end if;
 if p_hash is null or p_url is null or ch.status not in('creating','creation_unknown') or ch.expires_at<=now() or
    p_hash !~ '^[a-f0-9]{64}$' or p_url !~ '^https://[^/?#:@]+/pagar/[A-Za-z0-9_-]{43}$' or
    encode(sha256(convert_to(split_part(p_url,'/pagar/',2),'UTF8')),'hex')<>p_hash
 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 insert into pomar_private.pix_checkouts(charge_id,token_hash) values(p_id,p_hash);
 update public.pomar_charges set status='ready',checkout_url=p_url,expires_at=date_trunc('second',expires_at) where id=p_id;
 perform pomar_private.billing_audit(c.owner_id,'installment',ch.installment_id,'Link privado do checkout Pix Grupo Pomar preparado.');
end $$;

create function pomar_private.pix_checkout_read(p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c pomar_private.billing_config;ch public.pomar_charges;x pomar_private.pix_checkouts;p public.pomar_provider_payments;
 part public.pomar_installments;contract public.pomar_contracts;remaining bigint;s text;
begin
 perform pomar_private.pix_checkout_capabilities();
 select * into c from pomar_private.billing_config where singleton and enabled;
 if c.owner_id is null or not exists(select 1 from pomar_private.owner_registry where singleton and active and owner_id=c.owner_id) then return null;end if;
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash;
 if x.charge_id is null then return null;end if;
 select * into ch from public.pomar_charges where id=x.charge_id and owner_id=c.owner_id and mode=c.mode and status='ready';
 if ch.id is null then return null;end if;
 select * into p from public.pomar_provider_payments where charge_id=ch.id and mode=c.mode and (x.payment_id is null or provider_payment_id=x.payment_id) order by provider_updated_at desc limit 1;
 select * into part from public.pomar_installments where id=ch.installment_id and owner_id=c.owner_id;
 select * into contract from public.pomar_contracts where id=part.contract_id and owner_id=c.owner_id;
 select part.amount_cents-coalesce(sum(a.amount_cents),0) into remaining from public.pomar_allocations a join public.pomar_receipts r on r.owner_id=a.owner_id and r.id=a.receipt_id where a.installment_id=part.id and a.owner_id=c.owner_id and r.status='confirmed';
 select remaining+coalesce(sum(amount_cents),0) into remaining from public.pomar_refunds where installment_id=part.id and owner_id=c.owner_id;
 s:=case
  when p.review_reason<>'' or p.status in('in_mediation','charged_back','unknown') then 'review'
  when p.status='approved' and (p.receipt_id is not null or c.mode='test') then 'paid'
  when p.status in('cancelled','rejected','refunded') or part.status<>'open' or contract.status<>'active' or remaining<>ch.amount_cents then 'closed'
  when ch.expires_at<=now() then 'expired'
  when x.payment_id is not null then 'pending' else 'ready' end;
 return jsonb_build_object('charge_id',ch.id,'amount_cents',ch.amount_cents,'expires_at',ch.expires_at,'mode',c.mode,'collector_id',c.collector_id,'status',s,
   'qr_code',case when s='pending' then x.qr_code else null end,'qr_base64',case when s='pending' then x.qr_base64 else null end);
end $$;

create function pomar_private.pix_checkout_begin(p_hash text,p_payer jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;v jsonb;
begin
 perform pomar_private.pix_checkout_capabilities();
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash for update;
 if x.charge_id is null then return null;end if;
 v:=pomar_private.pix_checkout_read(p_hash);
 if v is null or v->>'status'<>'ready' then return jsonb_build_object('create',false);end if;
 if (v->>'expires_at')::timestamptz<now()+interval '30 minutes' then raise exception using errcode='P0001',message='POMAR_PIX_EXPIRED';end if;
 if x.attempts>=20 or x.next_attempt_at>now() then raise exception using errcode='P0001',message='POMAR_PIX_BUSY';end if;
 if p_payer is null or jsonb_typeof(p_payer)<>'object' or octet_length(p_payer::text)>2048 or
    char_length(coalesce(p_payer->>'name','')) not between 3 and 120 or char_length(coalesce(p_payer->>'email','')) not between 3 and 254 or
    coalesce(p_payer->>'document','') !~ '^(\d{11}|\d{14})$' then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 -- An uncertain provider result must reuse the exact stored body/idempotency key.
 update pomar_private.pix_checkouts set payer=coalesce(payer,p_payer),attempts=attempts+1,next_attempt_at=now()+interval '20 seconds' where charge_id=x.charge_id returning * into x;
 return v||jsonb_build_object('create',true,'payer',x.payer);
end $$;

create function pomar_private.pix_checkout_attach(p_hash text,p_payment text,p_code text,p_base64 text,p_expiry timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;ch public.pomar_charges;v jsonb;
begin
 perform pomar_private.pix_checkout_capabilities();
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash for update;
 v:=pomar_private.pix_checkout_read(p_hash);
 if v is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 select * into ch from public.pomar_charges where id=x.charge_id;
 if p_payment is null or p_code is null or p_base64 is null or p_payment !~ '^\d{1,30}$' or char_length(p_code) not between 20 and 4096 or
    char_length(p_base64)>800000 or p_base64 !~ '^iVBORw0KGgo[A-Za-z0-9+/=]+$' or p_expiry is distinct from ch.expires_at or
    (x.payment_id is not null and x.payment_id<>p_payment) then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 update pomar_private.pix_checkouts set payment_id=p_payment,qr_code=p_code,qr_base64=p_base64,payer=null where charge_id=x.charge_id;
end $$;

create function pomar_private.pix_checkout_refresh(p_hash text) returns text
language plpgsql security definer set search_path='' as $$declare x pomar_private.pix_checkouts;v jsonb;begin
 perform pomar_private.pix_checkout_capabilities();
 v:=pomar_private.pix_checkout_read(p_hash);if v is null then return null;end if;
 update pomar_private.pix_checkouts set next_poll_at=now()+interval '20 seconds'
  where token_hash=p_hash and payment_id is not null and (next_poll_at is null or next_poll_at<=now()) returning * into x;
 return x.payment_id;
end $$;

revoke all on function pomar_private.pix_checkout_capabilities(),pomar_private.pix_checkout_create(uuid,text,text,text,text),pomar_private.pix_checkout_read(text),pomar_private.pix_checkout_begin(text,jsonb),pomar_private.pix_checkout_attach(text,text,text,text,timestamptz),pomar_private.pix_checkout_refresh(text) from public,anon,authenticated,pomar_billing_worker;
grant execute on function pomar_private.pix_checkout_capabilities(),pomar_private.pix_checkout_create(uuid,text,text,text,text),pomar_private.pix_checkout_read(text),pomar_private.pix_checkout_begin(text,jsonb),pomar_private.pix_checkout_attach(text,text,text,text,timestamptz),pomar_private.pix_checkout_refresh(text) to pomar_billing_worker;
commit;
