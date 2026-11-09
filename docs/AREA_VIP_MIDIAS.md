# Ativar a Área VIP de mídias

## Cloudflare R2

Crie um bucket dedicado na classe **Standard**, como `pomar-vip-midias`. Em **Settings**, deixe o acesso por `r2.dev` e por domínio público desativado. Em **Manage R2 API Tokens**, gere credenciais **Object Read & Write** para esse bucket específico. Use o Account ID, o Access Key ID e o Secret Access Key gerados para a API S3.

No bucket, salve a política em **CORS Policy**. Use a origem exata do domínio oficial da Central.

```json
[
  {
    "AllowedOrigins": ["https://central.ogrupopomar.com.br"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Length",
      "Content-Disposition",
      "Cache-Control",
      "If-None-Match"
    ],
    "MaxAgeSeconds": 300
  }
]
```

## Supabase e Vercel

1. No SQL Editor do mesmo projeto da Central, aplique [a migração da Área VIP](../supabase/migrations/20261109015528_portal_vip_midias.sql) inteira, uma vez.
2. Gere uma senha exclusiva para o papel de mídias. Em uma consulta privada, troque o marcador abaixo pela senha e execute. Guarde o valor na configuração protegida da Vercel.

```sql
do $$
declare senha text := 'SUBSTITUA_POR_UMA_SENHA_ALEATORIA';
begin
  if senha like 'SUBSTITUA_%' or char_length(senha) < 32 then
    raise exception 'Preencha uma senha exclusiva com pelo menos 32 caracteres.';
  end if;
  execute format('alter role pomar_media_worker login password %L', senha);
end $$;
```

3. Configure as variáveis abaixo somente no ambiente de produção da Central. Use o host do pooler do mesmo projeto e o usuário `pomar_media_worker.PROJECT_REF`. Use a porta indicada pelo pooler e codifique caracteres especiais da senha na URI.

| Variável                     | Valor                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POMAR_R2_ACCOUNT_ID`        | Account ID do R2                                                                                        |
| `POMAR_R2_MEDIA_BUCKET`      | Nome exato do bucket privado                                                                            |
| `POMAR_R2_ACCESS_KEY_ID`     | Access Key ID restrito ao bucket                                                                        |
| `POMAR_R2_SECRET_ACCESS_KEY` | Secret Access Key restrito ao bucket                                                                    |
| `POMAR_MEDIA_DATABASE_URL`   | URI do pooler com o papel de mídias                                                                     |
| `POMAR_MEDIA_DB_CA_BASE64`   | CA do Supabase, se necessário. Na ausência desta variável, a Central usa a CA configurada para cobrança |
| `POMAR_MEDIA_ENABLED`        | `true` após concluir a configuração                                                                     |

4. Faça um novo deploy para carregar as variáveis. Na Central, abra um projeto ligado a um cliente e entre em **Mídias VIP**.

## Homologar com mídia fictícia

Gere um convite, abra-o em uma janela sem sessão na Central e envie uma foto e um vídeo pequenos. Confira o estado **Recebido**. Na ficha do projeto, atualize a lista e baixe os dois originais. Revogue o convite e verifique se a página deixa de aceitar novos envios.

Convites valem sete dias. O link completo aparece na hora da geração. Quem o recebe pode enviar mídia durante a validade. Revogar o convite bloqueia novas autorizações e confirmações. Autorizações já emitidas para um único objeto expiram em até dez minutos.

O portal aceita PNG, JPG, HEIC, HEIF e WebP até 30 MB, e MP4, MOV e WebM até 500 MB. A conferência usa tamanho e assinatura inicial do formato. Os originais são oferecidos para download. Cada projeto tem até 100 reservas e 2 GB. O teto da aplicação é de 8 GB para o bucket dedicado, incluindo reservas pendentes. Uma repetição na mesma seleção reaproveita a reserva do arquivo. A franquia do R2 Standard é compartilhada com os demais buckets da conta. [Preços do R2](https://developers.cloudflare.com/r2/pricing/)
