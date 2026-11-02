-- Preencha a senha SOMENTE no SQL Editor privado. Não publique o arquivo preenchido.
-- O modelo recusa a senha de exemplo e valores curtos.
do $$
declare v_password text:='PREENCHA_SOMENTE_NO_SEU_SQL_EDITOR';
begin
 if v_password='PREENCHA_SOMENTE_NO_SEU_SQL_EDITOR' or char_length(v_password)<32 or char_length(v_password)>512 or v_password ~ '[\r\n]' then raise exception 'Use uma senha privada forte com pelo menos 32 caracteres.';end if;
 if not exists(select 1 from pg_roles where rolname='pomar_notification_worker' and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls and not rolinherit) then raise exception 'Confira a instalação do papel restrito antes de habilitar login.';end if;
 execute format('alter role pomar_notification_worker login password %L',v_password);
end $$;
