-- Execute DEPOIS da migração e da criação manual do usuário em Authentication > Users.
-- Substitua apenas o UUID abaixo pelo ID do usuário proprietário. Não use e-mail/senha aqui.
begin;
do $$
declare owner_uuid uuid := '00000000-0000-0000-0000-000000000000'; existing uuid;
begin
 if owner_uuid='00000000-0000-0000-0000-000000000000' then raise exception 'Substitua o UUID pelo ID do usuário criado em Authentication > Users.'; end if;
 if not exists(select 1 from auth.users where id=owner_uuid) then raise exception 'O usuário não existe no Authentication deste projeto.'; end if;
 select owner_id into existing from pomar_private.owner_registry where singleton;
 if existing is not null and existing<>owner_uuid then raise exception 'Este banco já possui outro proprietário. A troca exige procedimento separado.'; end if;
 insert into pomar_private.owner_registry(singleton,owner_id) values(true,owner_uuid) on conflict(singleton) do nothing;
 insert into public.pomar_settings(owner_id,id,business_name,display_name) values(owner_uuid,owner_uuid,'Grupo Pomar','William') on conflict(owner_id) do nothing;
 if not exists(select 1 from public.pomar_areas where owner_id=owner_uuid) then
   insert into public.pomar_areas(id,owner_id,name,color) values
   (gen_random_uuid(),owner_uuid,'Operação direta','green'),(gen_random_uuid(),owner_uuid,'Parcerias','amber'),(gen_random_uuid(),owner_uuid,'Estratégicos','violet');
 end if;
end $$;
commit;
