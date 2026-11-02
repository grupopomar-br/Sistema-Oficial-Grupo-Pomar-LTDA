# Identidade, metodologias e perfil

A Central usa as duas logos fornecidas pelo proprietário, adequadas ao fundo claro e ao fundo escuro. O checkout combina botões em verde-limão com texto verde-escuro e títulos com destaque em itálico e degradê verde. A alteração visual preserva o fluxo de pagamento.

## Ativação em uma conta existente

Publique a aplicação compatível antes de aplicar SQL. No SQL Editor do projeto Supabase da Central, execute uma vez, nesta ordem:

1. [project_completion_date](../supabase/migrations/20261102071708_project_completion_date.sql), se ainda não foi aplicada. Ela grava a data real nas próximas conclusões de projeto e não preenche datas históricas por suposição.
2. [melhorias_audio_central](../supabase/migrations/20261102163721_melhorias_audio_central.sql). Ela acrescenta as tabelas de metodologias/perfil, o bucket privado e a política de sessão atualizada. A transação recusa execução sem o snapshot de conclusão ou sem Storage.
3. Recarregue a Central. Confira os indicadores com [05_diagnostico_personalizacao.sql](../supabase/05_diagnostico_personalizacao.sql), que consulta metadados sem retornar registros da operação.

Não reaplique a instalação inicial nem os scripts de identidade/conta financeira. Esta atualização não cria, cancela, reembolsa ou concilia pagamentos. Aplique os advisors do Supabase após a instalação, conforme a rotina administrativa do projeto.

A aplicação funciona com o banco anterior enquanto a atualização manual está pendente. Usa as janelas antigas de sessão e apresenta os recursos novos como aguardando ativação. O fallback de RPC acontece somente no erro de função ausente (`PGRST202`); erros de acesso, rede ou banco não são mascarados.

## Uso

- **Metodologias:** crie o nome, serviço, objetivo, etapas, diferenciais, entregáveis, critérios de qualidade e referências. Pesquise no conteúdo, consulte, edite ou arquive. O filtro de arquivadas permite restaurar. Nenhum texto interno da empresa foi inventado ou incluído como exemplo na conta.
- **Preferências → Sua imagem na Central:** envie uma foto, use a logo do Grupo Pomar ou remova a imagem. A foto aparece também no rodapé da navegação. PNG/JPG/WebP de até 2 MB; o servidor decodifica, limita pixels, rejeita SVG/animação, remove metadados e regrava WebP de até 512 px.
- **Projetos:** o tempo decorrido utiliza dias civis e a conclusão efetiva. A contagem não usa o vencimento como se fosse conclusão; projetos antigos sem data continuam identificados como tal.

## Sessão

Após a migração, o bloqueio ocorre com **60 minutos sem atividade** e o TOTP recente vale por **30 minutos** nas operações que o exigem. O limite absoluto continua em oito horas desde o login. MFA, proprietário, revogação, guarda de sessão e RLS continuam obrigatórios. A tela mostra a política efetivamente instalada, não uma preferência local que desvie do banco. Uma solicitação de nova confirmação de MFA não encerra a sessão de senha por si só.

## Persistência e limites

Metodologias e perfil têm RLS forçado, histórico e conflitos de versão; outro usuário, anônimo e worker financeiro não recebem acesso. O snapshot antigo preserva seu formato para rollback da aplicação. A coleção tem limite explícito de 1.000 metodologias.

As fotos ficam no bucket **privado** `pomar-profile`, com caminhos restritos ao proprietário. A leitura passa pela API autenticada e retorna `private, no-store`; não há URL pública. Uma substituição só remove a foto anterior após salvar a nova referência. Uma falha de rede com resultado de commit desconhecido preserva o arquivo para evitar apagar uma foto já salva. Objetos órfãos de tentativas interrompidas podem exigir limpeza administrativa posterior.

O backup JSON inclui os textos e a referência da foto; **não inclui os bytes do Storage**. O backup completo precisa preservar também os objetos. A restauração JSON continua exclusiva do desenvolvimento; o envio de fotos requer a conta conectada. A marca oficial pode ser selecionada também no modo local.

O bucket, as políticas e a API de Storage precisam de conferência na conta real após a instalação manual. Os testes de SQL usam um catálogo mínimo de Storage com RLS, não um emulador do serviço HTTP.
