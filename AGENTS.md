# Central Operacional Pomar

- Produto interno de proprietário único. Não incluir cadastro público ou acesso de clientes.
- Repositório pode estar público: nunca incluir dados empresariais reais, credenciais, dumps, documentos internos ou backups de operação.
- Sem dependência de fornecedor de hospedagem. Supabase é configurado manualmente conforme `docs/CONFIGURACAO.md`.
- Modo local é de desenvolvimento e persiste no navegador; nunca habilitá-lo em produção ou usá-lo como fallback silencioso de falha na nuvem.
- Operações na nuvem exigem proprietário validado, sessão ativa e MFA; as políticas SQL também devem negar acesso a outros usuários.
- Dinheiro em centavos inteiros. Contrato, vencimento e recebimento são eventos diferentes; pagamentos e estornos são transacionais e idempotentes.
- Antes de concluir, executar checks pertinentes e registrar limites reais de validação.
- Fluxo: branch própria, implementação, testes, revisão e commit. Não forçar atualizações de branches existentes.
- Consulte a documentação da versão instalada de Next.js em `node_modules/next/dist/docs/` antes de alterar convenções do framework.

- Cobrança real permanece desativada até homologação. Sandbox nunca cria recibo real nem muda caixa.
- Criação de checkout e reconciliação exigem MFA recente. Webhook exige assinatura válida e nova consulta autenticada no provedor; retorno do checkout não prova pagamento.
- Worker financeiro é um papel de conexão restrito e não possui CRUD de tabelas. Não usar credenciais de administrador ou `service_role` para simplificar a integração.
- Devoluções são eventos próprios, com data confirmada. Não reescrever recebimento original nem inventar data de chargeback.
- Rascunhos não enviam mensagem. Links de teste e links desatualizados não entram no rascunho para clientes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
