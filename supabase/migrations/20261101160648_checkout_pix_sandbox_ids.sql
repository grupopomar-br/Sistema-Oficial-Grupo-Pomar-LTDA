-- Sandbox orders have an ORDTST namespace. Preserve the complete opaque ID.
-- Apply once after checkout_pix_orders. Does not enable billing or change mode.
begin;
alter table public.pomar_provider_payments drop constraint pomar_provider_payments_provider_payment_id_check;
alter table public.pomar_provider_payments add constraint pomar_provider_payments_provider_payment_id_check check(provider_payment_id ~ '^(\d{1,30}|ORD(TST)?[0-9A-HJKMNP-TV-Z]{26})$' and (mode='test' or provider_payment_id not like 'ORDTST%'));
alter table pomar_private.pix_checkouts drop constraint pix_checkouts_payment_id_check;
alter table pomar_private.pix_checkouts add constraint pix_checkouts_payment_id_check check(payment_id ~ '^(\d{1,30}|ORD(TST)?[0-9A-HJKMNP-TV-Z]{26})$');
create or replace function pomar_private.pix_checkout_capabilities() returns integer
language plpgsql security definer set search_path='' as $$begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 return 3;
end $$;

create or replace function pomar_private.pix_checkout_order(p_hash text,p_order text) returns void
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;v jsonb;begin
 perform pomar_private.pix_checkout_capabilities();
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash for update;
 v:=pomar_private.pix_checkout_read(p_hash);
 if v is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 if (v->>'mode'='live' and p_order like 'ORDTST%') or p_order is null or p_order !~ '^ORD(TST)?[0-9A-HJKMNP-TV-Z]{26}$' or x.attempts=0 or
   (x.payment_id is not null and x.payment_id<>p_order) then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 update pomar_private.pix_checkouts set payment_id=p_order,payer=null where charge_id=x.charge_id;
end $$;

create or replace function pomar_private.pix_checkout_order_qr(p_hash text,p_order text,p_code text,p_base64 text,p_expiry timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare x pomar_private.pix_checkouts;v jsonb;begin
 perform pomar_private.pix_checkout_capabilities();
 select * into x from pomar_private.pix_checkouts where token_hash=p_hash for update;
 v:=pomar_private.pix_checkout_read(p_hash);
 if v is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 if (v->>'mode'='live' and p_order like 'ORDTST%') or x.payment_id is distinct from p_order or p_order !~ '^ORD(TST)?[0-9A-HJKMNP-TV-Z]{26}$' or
   p_code is null or char_length(p_code) not between 20 and 4096 or
   (p_base64 is not null and (char_length(p_base64)>800000 or p_base64 !~ '^iVBORw0KGgo[A-Za-z0-9+/=]+$')) or
   p_expiry is null or p_expiry<now()-interval '30 days' or p_expiry>now()+interval '31 days' or
   (x.provider_expires_at is not null and x.provider_expires_at<>p_expiry)
 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 update pomar_private.pix_checkouts set qr_code=p_code,qr_base64=p_base64,provider_expires_at=p_expiry where charge_id=x.charge_id;
end $$;

create or replace function public.pomar_billing_apply_payment(p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c pomar_private.billing_config;charge public.pomar_charges;part public.pomar_installments;contract public.pomar_contracts;
 payment public.pomar_provider_payments;old_payment public.pomar_provider_payments;pid text:=p_event->>'provider_payment_id';external_ref uuid;v_status text:=p_event->>'status';
 amount bigint:=(p_event->>'amount_cents')::bigint;refunded bigint:=(p_event->>'refunded_cents')::bigint;at timestamptz:=(p_event->>'provider_updated_at')::timestamptz;v_paid_on date:=(p_event->>'paid_on')::date;
 recovery_hash text;paid bigint;remaining bigint;reason text:='';r jsonb;refund_sum bigint;already bigint;new_receipt uuid;
begin
 if session_user<>'pomar_billing_worker' then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 select * into c from pomar_private.billing_config where singleton and enabled and collector_id=p_event->>'collector_id' and mode=p_event->>'mode';
 if c.owner_id is null then raise exception using errcode='42501',message='POMAR_WORKER_ACCESS';end if;
 if (c.mode='live' and pid like 'ORDTST%') or (pid is null or pid !~ '^(\d{1,30}|ORD(TST)?[0-9A-HJKMNP-TV-Z]{26})$') or p_event->>'currency'<>'BRL' or amount not between 1 and 100000000000 or refunded not between 0 and amount or at is null or at>now()+interval '5 minutes' or v_paid_on>(now() at time zone 'America/Fortaleza')::date then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
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
 if payment.paid_on is not null then v_paid_on:=payment.paid_on;end if;
 if p_event ? 'owner_confirmed_by' and (
   p_event->>'owner_confirmed_by' is distinct from c.owner_id::text or
   c.mode<>'live' or v_status<>'approved' or v_paid_on is null or
   v_paid_on<(charge.created_at at time zone 'America/Fortaleza')::date or
   not ((payment.review_reason='Data de aprovação não confirmada.' and payment.receipt_id is null) or
        (payment.receipt_id is not null and payment.paid_on=(p_event->>'paid_on')::date))
 ) then raise exception using errcode='42501',message='POMAR_DATE_CONFIRMATION';end if;
 if payment.amount_cents<>amount or (payment.charge_id is not null and payment.charge_id is distinct from charge.id) then raise exception using errcode='22023',message='POMAR_PAYMENT_CHANGED';end if;
 -- The worker has fetched and verified the full provider order. Recover its
 -- original checkout before duplicate handling; never replace a bound ID.
 if charge.status='ready' and charge.mode=c.mode and amount=charge.amount_cents and pid ~ '^ORD(TST)?[0-9A-HJKMNP-TV-Z]{26}$' then
  select token_hash into recovery_hash from pomar_private.pix_checkouts where charge_id=charge.id and payment_id is null and attempts>0 for update;
  if recovery_hash is not null then perform pomar_private.pix_checkout_order(recovery_hash,pid);end if;
 end if;
 if at<payment.provider_updated_at then return jsonb_build_object('duplicate',true);end if;
 if payment.provider_updated_at=at and payment.status=v_status and payment.refunded_cents=refunded and payment.review_reason='' then return jsonb_build_object('duplicate',true);end if;

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
    if r->>'provider_refund_id' !~ '^(\d{1,40}|REF[0-9A-HJKMNP-TV-Z]{26})$' or (r->>'amount_cents')::bigint<=0 or (r->>'occurred_on')::date>(now() at time zone 'America/Fortaleza')::date then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
    select amount_cents into already from public.pomar_refunds where provider_payment_id=payment.id and provider_refund_id=r->>'provider_refund_id';
    if found and already<>(r->>'amount_cents')::bigint then raise exception using errcode='22023',message='POMAR_PAYMENT_CHANGED';end if;
    insert into public.pomar_refunds(owner_id,receipt_id,installment_id,provider_payment_id,provider_refund_id,amount_cents,occurred_on) values(c.owner_id,payment.receipt_id,part.id,payment.id,r->>'provider_refund_id',(r->>'amount_cents')::bigint,(r->>'occurred_on')::date) on conflict(provider_payment_id,provider_refund_id) do nothing;
   end loop;
   select coalesce(sum(amount_cents),0) into refund_sum from public.pomar_refunds where provider_payment_id=payment.id;
   if refund_sum<>refunded or refund_sum>amount then raise exception using errcode='22023',message='POMAR_REFUND_TOTAL';end if;
  end if;
 end if;
 update public.pomar_provider_payments set charge_id=coalesce(charge_id,charge.id),receipt_id=payment.receipt_id,status=v_status,paid_on=v_paid_on,fee_cents=(p_event->>'fee_cents')::bigint,refunded_cents=greatest(refunded_cents,refunded),provider_updated_at=at,review_reason=reason where id=payment.id;
 if p_event ? 'owner_confirmed_by' then
  perform pomar_private.billing_audit(c.owner_id,'receipt',coalesce(payment.receipt_id,payment.id),'Data do recebimento conferida pelo proprietário no Mercado Pago: '||v_paid_on::text||'.');
 end if;
 perform pomar_private.billing_audit(c.owner_id,case when c.mode='test' then 'payment_test' else 'receipt' end,coalesce(payment.receipt_id,payment.id),case when reason='' then case when c.mode='test' then 'Simulação de pagamento; sem baixa financeira; estado: ' else 'Pagamento do provedor verificado; estado: ' end||v_status else 'Pagamento do provedor em revisão: '||reason end);
 return jsonb_build_object('duplicate',false,'review',reason<>'');
end $$;
-- CREATE OR REPLACE preserves grants; repeat the intended allowlist explicitly.
revoke all on function pomar_private.pix_checkout_capabilities(),public.pomar_billing_apply_payment(jsonb),pomar_private.pix_checkout_order(text,text),pomar_private.pix_checkout_order_qr(text,text,text,text,timestamptz) from public,anon,authenticated,pomar_billing_worker;
grant execute on function pomar_private.pix_checkout_capabilities(),public.pomar_billing_apply_payment(jsonb),pomar_private.pix_checkout_order(text,text),pomar_private.pix_checkout_order_qr(text,text,text,text,timestamptz) to pomar_billing_worker;
commit;
