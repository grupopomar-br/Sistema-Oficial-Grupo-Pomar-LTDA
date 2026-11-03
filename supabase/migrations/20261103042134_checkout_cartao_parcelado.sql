-- Opção de cartão via Checkout Pro. Desativada até homologação explícita no app.
-- Não cria preferência/pagamento nem altera o recebimento histórico do Pix.
begin;
alter table pomar_private.pix_checkouts add column chosen_method text check(chosen_method in('pix','card'));
update pomar_private.pix_checkouts set chosen_method='pix' where attempts>0 or payment_id is not null;
create table pomar_private.card_checkout_preferences (
 charge_id uuid primary key references public.pomar_charges(id),
 preference_id text check(char_length(preference_id) between 1 and 160),
 checkout_url text check(char_length(checkout_url)<=2048),
 max_installments integer not null default 12 check(max_installments between 1 and 12),
 attempts integer not null default 0 check(attempts between 0 and 10),
 next_attempt_at timestamptz not null default now(),lease_token uuid,
 next_poll_at timestamptz not null default now(),
 check((preference_id is null)=(checkout_url is null))
);
alter table pomar_private.card_checkout_preferences enable row level security;
alter table pomar_private.card_checkout_preferences force row level security;
revoke all on pomar_private.card_checkout_preferences from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;

-- Separate metadata keeps old snapshot DTOs and the historical payment table
-- unchanged, including while a prior application version is still running.
create table public.pomar_payment_availability (
 payment_id uuid primary key,owner_id uuid not null references auth.users(id),
 payment_method text not null check(payment_method in('credit_card','account_money')),funds_available boolean,
 foreign key(owner_id,payment_id) references public.pomar_provider_payments(owner_id,id)
);
alter table public.pomar_payment_availability enable row level security;
alter table public.pomar_payment_availability force row level security;
revoke all on public.pomar_payment_availability from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
grant select on public.pomar_payment_availability to authenticated;
create policy owner_read on public.pomar_payment_availability for select to authenticated
 using(owner_id=(select auth.uid()) and (select pomar_private.is_owner()));

-- Old and new callers share the same lock/choice. An uncertain Pix attempt
-- reserves Pix as well: switching methods cannot create a second live payment.
alter function pomar_private.pix_checkout_begin(text,jsonb) rename to pix_checkout_begin_before_card;
revoke all on function pomar_private.pix_checkout_begin_before_card(text,jsonb) from public,anon,authenticated,pomar_billing_worker;
create function pomar_private.pix_checkout_begin(p_hash text,p_payer jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;result jsonb;begin
 perform pomar_private.pix_checkout_capabilities();
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash for update;
 if x.chosen_method='card' then raise exception using errcode='P0001',message='POMAR_METHOD_LOCKED';end if;
 result:=pomar_private.pix_checkout_begin_before_card(p_hash,p_payer);
 if result->>'create'='true' then update pomar_private.pix_checkouts set chosen_method='pix' where token_hash=p_hash;end if;
 return result;
end $$;
revoke all on function pomar_private.pix_checkout_begin(text,jsonb) from public,anon,authenticated;
grant execute on function pomar_private.pix_checkout_begin(text,jsonb) to pomar_billing_worker;

create function pomar_private.checkout_read_with_card(p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;x pomar_private.pix_checkouts;c pomar_private.card_checkout_preferences;p public.pomar_provider_payments;s text;can_pay boolean;begin
 perform pomar_private.pix_checkout_capabilities();
 result:=pomar_private.pix_checkout_read(p_hash);if result is null then return null;end if;
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash;
 select * into c from pomar_private.card_checkout_preferences where charge_id=x.charge_id;
 s:=result->>'status';
 if x.chosen_method='card' then
  -- Preserve the payment that created the receipt ahead of later failed card
  -- attempts. Failure callbacks never override an existing successful payment.
  select * into p from public.pomar_provider_payments where charge_id=x.charge_id and mode=result->>'mode'
   order by (receipt_id is not null) desc,provider_updated_at desc limit 1;
  select exists(select 1 from public.pomar_charges ch join public.pomar_installments i on i.id=ch.installment_id and i.owner_id=ch.owner_id
   join public.pomar_contracts t on t.id=i.contract_id and t.owner_id=i.owner_id
   where ch.id=x.charge_id and ch.status='ready' and i.status='open' and t.status='active'
   and i.amount_cents-coalesce((select sum(a.amount_cents) from public.pomar_allocations a join public.pomar_receipts r on r.id=a.receipt_id and r.owner_id=a.owner_id and r.status='confirmed' where a.installment_id=i.id and a.owner_id=i.owner_id),0)
   +coalesce((select sum(f.amount_cents) from public.pomar_refunds f where f.installment_id=i.id and f.owner_id=i.owner_id),0)=ch.amount_cents) into can_pay;
  if p.status='approved' and p.amount_cents=(result->>'amount_cents')::bigint and (p.receipt_id is not null or p.review_reason='Data de aprovação não confirmada.' or result->>'mode'='test') then s:='paid';
  elsif p.review_reason<>'' or p.status in('in_mediation','charged_back','unknown') then s:='review';
  elsif s='expired' then null;
  elsif s='closed' then
   if p.status in('rejected','cancelled') and can_pay and c.checkout_url is not null then s:='pending';end if;
  elsif c.checkout_url is not null then s:='pending';
  else s:='processing';end if;
 end if;
 return result||jsonb_build_object('card_available',true,'chosen_method',x.chosen_method,'status',s,
  'card_url',case when s in('ready','pending') then c.checkout_url else null end,'max_installments',coalesce(c.max_installments,12));
end $$;

create function pomar_private.card_checkout_begin(p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;c pomar_private.card_checkout_preferences;result jsonb;lease uuid:=gen_random_uuid();begin
 perform pomar_private.pix_checkout_capabilities();
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash for update;
 if x.charge_id is null then return null;end if;
 result:=pomar_private.checkout_read_with_card(p_hash);
 if result is null or result->>'status' not in('ready','processing','pending') then return jsonb_build_object('create',false);end if;
 if x.chosen_method='pix' or x.attempts>0 or x.payment_id is not null then raise exception using errcode='P0001',message='POMAR_METHOD_LOCKED';end if;
 if (result->>'expires_at')::timestamptz<=now()+interval '5 minutes' then raise exception using errcode='P0001',message='POMAR_CARD_EXPIRED';end if;
 insert into pomar_private.card_checkout_preferences(charge_id) values(x.charge_id) on conflict do nothing;
 select * into c from pomar_private.card_checkout_preferences where charge_id=x.charge_id for update;
 if c.checkout_url is not null then return result||jsonb_build_object('create',false);end if;
 if c.attempts>=10 or (c.attempts>0 and c.next_attempt_at>now()) then raise exception using errcode='P0001',message='POMAR_CARD_BUSY';end if;
 update pomar_private.pix_checkouts set chosen_method='card' where charge_id=x.charge_id;
 update pomar_private.card_checkout_preferences set attempts=attempts+1,next_attempt_at=now()+interval '60 seconds',lease_token=lease where charge_id=x.charge_id;
 return result||jsonb_build_object('create',true,'lease',lease);
end $$;

create function pomar_private.card_checkout_attach(p_hash text,p_lease uuid,p_preference text,p_url text,p_installments integer) returns void
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;result jsonb;n integer;begin
 perform pomar_private.pix_checkout_capabilities();
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash for update;
 result:=pomar_private.checkout_read_with_card(p_hash);
 if result is null or x.chosen_method is distinct from 'card' or result->>'status' not in('ready','pending','processing') then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 if p_preference is null or p_preference !~ '^[A-Za-z0-9_-]{1,160}$' or p_url is null or char_length(p_url)>2048
  or p_url !~ '^https://(www|sandbox)\.mercadopago\.(com|com\.br)/checkout/'
  or p_url ~ '[#[:space:]]' or position('pref_id='||p_preference in p_url)=0
  or (result->>'mode'='test') is distinct from (p_url ~ '^https://sandbox\.')
  or p_installments is null or p_installments not between 1 and 12 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 update pomar_private.card_checkout_preferences set preference_id=p_preference,checkout_url=p_url,max_installments=p_installments,lease_token=null
 where charge_id=x.charge_id and lease_token=p_lease and checkout_url is null;get diagnostics n=row_count;
 if n<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT';end if;
end $$;

create function pomar_private.card_checkout_poll(p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;result jsonb;n integer;begin
 perform pomar_private.pix_checkout_capabilities();
 result:=pomar_private.checkout_read_with_card(p_hash);
 if result is null then return false;end if;
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash;
 if x.chosen_method is distinct from 'card' then return false;end if;
 update pomar_private.card_checkout_preferences set next_poll_at=now()+interval '30 seconds'
 where charge_id=x.charge_id and preference_id is not null and next_poll_at<=now();get diagnostics n=row_count;
 return n=1;
end $$;
revoke all on function pomar_private.checkout_read_with_card(text),pomar_private.card_checkout_begin(text),pomar_private.card_checkout_attach(text,uuid,text,text,integer),pomar_private.card_checkout_poll(text) from public,anon,authenticated,pomar_notification_worker;
grant execute on function pomar_private.checkout_read_with_card(text),pomar_private.card_checkout_begin(text),pomar_private.card_checkout_attach(text,uuid,text,text,integer),pomar_private.card_checkout_poll(text) to pomar_billing_worker;

-- Extend metadata without replacing the verified, transactional ledger. Only
-- authenticated provider data can make a card approval count as available cash.
alter function public.pomar_billing_apply_payment(jsonb) rename to pomar_billing_apply_before_card;
alter function public.pomar_billing_apply_before_card(jsonb) set schema pomar_private;
revoke all on function pomar_private.pomar_billing_apply_before_card(jsonb) from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
create function public.pomar_billing_apply_payment(p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;method text:=p_event->>'payment_method';old_method text;begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 if method is not null and method not in('credit_card','account_money') then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 if p_event ? 'funds_available' and jsonb_typeof(p_event->'funds_available') not in('boolean','null') then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 select a.payment_method into old_method from public.pomar_payment_availability a join public.pomar_provider_payments p on p.id=a.payment_id and p.owner_id=a.owner_id where p.provider_payment_id=p_event->>'provider_payment_id' and p.mode=p_event->>'mode';
 if method is null and exists(select 1 from pomar_private.card_checkout_preferences c where c.charge_id::text=p_event->>'external_reference') then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 if old_method is not null and method is distinct from old_method then raise exception using errcode='22023',message='POMAR_PAYMENT_CHANGED';end if;
 if method='credit_card' and p_event->>'paid_on' is not null and p_event->>'funds_available' is distinct from 'true' then raise exception using errcode='22023',message='POMAR_CARD_NOT_RELEASED';end if;
 result:=pomar_private.pomar_billing_apply_before_card(p_event);
 if method is not null then
  insert into public.pomar_payment_availability(payment_id,owner_id,payment_method,funds_available)
   select p.id,p.owner_id,method,(p_event->>'funds_available')::boolean from public.pomar_provider_payments p
   where p.provider_payment_id=p_event->>'provider_payment_id' and p.mode=p_event->>'mode'
   and exists(select 1 from pomar_private.billing_config c where c.singleton and c.enabled and c.owner_id=p.owner_id and c.collector_id=p_event->>'collector_id' and c.mode=p_event->>'mode')
   on conflict(payment_id) do update set funds_available=excluded.funds_available;
 end if;
 return result;
end $$;
revoke all on function public.pomar_billing_apply_payment(jsonb) from public,anon,authenticated,pomar_notification_worker;
grant execute on function public.pomar_billing_apply_payment(jsonb) to pomar_billing_worker;

create function public.pomar_workspace_cards() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;payments jsonb;begin
 result:=public.pomar_workspace_results();
 select coalesce(jsonb_agg(j.value||jsonb_build_object('payment_method',a.payment_method,'funds_available',a.funds_available) order by j.ordinality),'[]'::jsonb) into payments
 from jsonb_array_elements(result->'provider_payments') with ordinality j(value,ordinality)
 left join public.pomar_payment_availability a on a.payment_id=(j.value->>'id')::uuid and a.owner_id=auth.uid();
 return result||jsonb_build_object('provider_payments',payments);
end $$;
revoke all on function public.pomar_workspace_cards() from public,anon;
grant execute on function public.pomar_workspace_cards() to authenticated;
notify pgrst,'reload schema';
commit;
