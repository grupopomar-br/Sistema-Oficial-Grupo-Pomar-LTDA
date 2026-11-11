-- Cancela o lançamento de teste pelo fluxo financeiro existente.
begin;

create or replace function pomar_private.remove_test_contract(p_key uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 contract_status text;
begin
 if not pomar_private.is_owner() then
  raise exception using errcode='42501',message='POMAR_ACCESS';
 end if;
 select status into contract_status from public.pomar_contracts
 where owner_id=uid and id=p_id for update;
 if not found then
  raise exception using errcode='P0001',message='POMAR_NOT_FOUND';
 end if;

 if contract_status='active' then
  -- O contrato serializa baixas e novos links. Os locks abaixo serializam a
  -- vinculação do checkout e o início de uma tentativa Pix ou cartão.
  perform 1 from public.pomar_charges ch
  join public.pomar_installments i on (i.owner_id,i.id)=(ch.owner_id,ch.installment_id)
  where i.owner_id=uid and i.contract_id=p_id and ch.mode='live'
  order by ch.id for update of ch;
  perform 1 from pomar_private.pix_checkouts x
  join public.pomar_charges ch on ch.id=x.charge_id
  join public.pomar_installments i on (i.owner_id,i.id)=(ch.owner_id,ch.installment_id)
  where i.owner_id=uid and i.contract_id=p_id and ch.mode='live'
  order by x.charge_id for update of x;

  if exists(select 1 from public.pomar_receipts
   where owner_id=uid and contract_id=p_id and status='confirmed')
  or exists(select 1 from public.pomar_provider_payments p
   join public.pomar_charges ch on (ch.owner_id,ch.id)=(p.owner_id,p.charge_id)
   join public.pomar_installments i on (i.owner_id,i.id)=(ch.owner_id,ch.installment_id)
   where i.owner_id=uid and i.contract_id=p_id and p.mode='live'
    and (p.receipt_id is not null or p.refunded_cents>0 or p.status not in ('cancelled','rejected') or p.review_reason<>''))
  then raise exception using errcode='P0001',message='POMAR_TEST_PAYMENT_EXISTS'; end if;

  if exists(select 1 from public.pomar_charges ch
   join public.pomar_installments i on (i.owner_id,i.id)=(ch.owner_id,ch.installment_id)
   left join pomar_private.pix_checkouts x on x.charge_id=ch.id
   where i.owner_id=uid and i.contract_id=p_id and ch.mode='live'
    and greatest(ch.expires_at,x.provider_expires_at)>clock_timestamp()
    and (ch.preference_id is not null or to_jsonb(x)->>'chosen_method' is not null or x.attempts>0 or x.payment_id is not null))
  then raise exception using errcode='P0001',message='POMAR_TEST_CHECKOUT_IN_PROGRESS'; end if;
 end if;

 return public.pomar_command(p_key,jsonb_build_object(
  'type','cancelContract','id',p_id,'reason','Lançamento removido por ser um teste.'
 ));
end $$;

create or replace function public.pomar_remove_test_contract(p_key uuid,p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select pomar_private.remove_test_contract(p_key,p_id);
$$;

revoke all on function pomar_private.remove_test_contract(uuid,uuid),
 public.pomar_remove_test_contract(uuid,uuid) from public,anon,authenticated,pomar_billing_worker;
grant execute on function pomar_private.remove_test_contract(uuid,uuid),
 public.pomar_remove_test_contract(uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
