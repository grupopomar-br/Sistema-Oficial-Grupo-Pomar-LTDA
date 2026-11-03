# Abertura e interação do checkout

O checkout público é independente da sessão do proprietário. Ele consulta somente a cobrança identificada pelo token privado, mantém valor/validade no servidor e não usa cache compartilhado de dados financeiros.

## Ajustes de experiência

- A estrutura visual aparece por streaming enquanto a cobrança é consultada. O estado inicial não inventa valor nem mostra um formulário pronto antes de conferir o link. A página final substitui o carregamento no mesmo layout.
- O proxy conserva CSP, nonce e cache privado, mas não renova a sessão do proprietário nas rotas públicas exatas de pagamento. Central, APIs internas, perfil, financeiro e notificações continuam com suas verificações de acesso.
- A marca no topo é solicitada com prioridade alta, sem mudar o arquivo ou o desenho. Os demais usos da marca mantêm o carregamento anterior.
- Somente o texto do contador atualiza a cada segundo, quando o QR está visível. O formulário e o restante da página não acompanham esse relógio. A expiração da cobrança tem um temporizador próprio e é conferida ao voltar à aba; o servidor continua decidindo a validade real.
- Pagamentos pendentes são conferidos ao abrir, ao voltar do banco e a cada 25 segundos com a página visível. O bloqueio existente evita requisições simultâneas; a consulta nunca cria outro pagamento. A confirmação continua vindo do provedor, não do retorno do navegador.
- Falha temporária de leitura tem mensagem e botão de nova tentativa; link inexistente continua com estado próprio. Repetir a leitura não gera Pix nem preferência de cartão.
- Campos do Pix preservam preenchimento automático e usam Próximo/Ir no teclado do celular. Cartão segue para o Mercado Pago sem pedir novamente na Central os dados que o provedor coletará.

## Prévia e homologação

`/pagamento/visualizar` permite escolher Pix ou cartão com valor fictício e sem criar cobrança. O botão de pagamento com cartão permanece desativado nessa prévia. Isso permite conferir layout e texto; não comprova que a conta oferece doze parcelas, ausência de juros, aprovação ou liberação do dinheiro.

A ativação do cartão segue [CARTAO_PARCELADO.md](CARTAO_PARCELADO.md), com implantação/banco de teste separados e credenciais inseridas diretamente pelo proprietário. Não alterar as credenciais nem o modo das cobranças reais para executar a homologação.

## Como verificar

1. Em celular e computador, abrir uma cobrança própria de teste e conferir a transição de carregamento para o valor correto. Usar a prévia apenas para o visual, sem dados de pagador.
2. Conferir teclado, preenchimento, escolha de meio, QR/Copia e Cola e retorno do aplicativo do banco. Reabrir o mesmo link deve preservar a tentativa existente.
3. No cartão, conferir o redirecionamento e os valores/juros no provedor. Retorno sem pagamento não pode apresentar confirmação. Usar o roteiro de aprovação/recusa e liberação documentado.
4. Medir com navegador em conexão móvel e registrar condições, TTFB, FCP/LCP, interação e quantidade/peso de requisições. Comparar várias navegações nas mesmas condições; separar a latência do provedor da abertura da página.

As verificações HTTP do ambiente de execução não representam a rede móvel de um cliente. Streaming melhora a apresentação inicial; não reduz por si só o tempo do banco, da autorização ou do processamento do Mercado Pago. Não publicar percentual de ganho ou promessa de tempo sem medição comparável no aparelho.
