---
name: minerar-cloud
description: Rotina de mineração de ofertas low ticket na Biblioteca de Anúncios da Meta, para rodar num sandbox cloud (Linux) via biblioteca.js/oferta.js, com geração de ideia de oferta, checagem de duplicata/oferta morta contra o Todoist, e entrega como tarefa no Todoist.
---

# Minerar ofertas (versão cloud)

Pipeline diário de descoberta de ofertas low ticket na Biblioteca de Anúncios da Meta,
adaptado para rodar sem intervenção humana num sandbox Linux. Usa `biblioteca.js` (varredura
em lote por palavra-chave) e `oferta.js` (aprofundar um anúncio específico) desta mesma pasta.

## Seção 0: limite das colunas do Todoist

Cada seção de pesquisa tem limite de **20 tarefas abertas**. Antes de minerar, conte as tarefas
abertas com a ferramenta MCP `find-tasks` (`responsibleUserFiltering: "all"`, paginação até o
fim) filtrando por `section_id`, em:
- **PESQUISA BR** (project_id do projeto "Ofertas Mineradas", section PESQUISA BR)
- **PESQUISA LATAM** (mesma project, section PESQUISA LATAM)

Meta do dia: **min(3, vagas)** por mercado. Mercado com 0 vagas não recebe mineração nesse dia.
Se os dois estiverem cheios, termine imediatamente sem rodar setup nem mineração, respondendo:
"Colunas cheias (BR: N/20, LATAM: N/20). Nada minerado."

## Setup do ambiente

1. `mkdir -p /home/user/scratch`.
2. Ligar o Playwright global do sandbox nos scripts sem `npm install`:
   `mkdir -p node_modules && ln -sfn /opt/node22/lib/node_modules/playwright/node_modules/playwright-core node_modules/playwright-core`
   (se esse caminho não existir, ache com `find / -maxdepth 7 -type d -name playwright-core 2>/dev/null`).
3. Chromium do sandbox: normalmente em `/opt/pw-browsers/chromium`. Confirme com
   `/opt/pw-browsers/chromium --version`; se não existir, ache com
   `find / -maxdepth 6 -iname "chromium*" -type f 2>/dev/null`.
4. A internet do sandbox passa por um proxy que reassina TLS — por isso todo comando `node`
   destes scripts leva `CHROME=<caminho do chromium> IGNORAR_TLS=1`. Não mexa em certificados,
   NSS, `certutil` nem no proxy: se aparecer `ERR_CERT_AUTHORITY_INVALID` mesmo com
   `IGNORAR_TLS=1`, pare e reporte, não tente contornar de outra forma.
5. Teste com uma keyword só e `--paralelo 2` antes de rodar o lote todo. Escada anti-bloqueio:
   se vier `resultados: 0` ou `cards_lidos: 0`, espere 120s e repita com `--paralelo 1` e outra
   keyword conhecida. Se 3 keywords diferentes derem 0, a Biblioteca bloqueou o IP da nuvem:
   **pare, não invente ofertas, não crie tarefa no Todoist**, e reporte exatamente o que
   aconteceu (comandos, saídas, erros).

## Parâmetros do dia (fixos, não pergunte)

- Quantidade: até **3 para Brasil (pt-BR)** e até **3 para LATAM (espanhol neutro, validar com
  `--pais MX`)**, respeitando as vagas da Seção 0. Produtos **low ticket** (PDF/caixinha digital
  ou app barato).
- Preços padrão (usar na descrição da tarefa):
  - **BR**: Básico R$ 10 · Upgrade (popup) R$ 17 · Completo R$ 27.
  - **LATAM**: Básico US$ 5 · Upgrade (popup) US$ 10 · Completo US$ 15.
- Onde salvar: Todoist, projeto **Ofertas Mineradas**. Ofertas BR na seção **PESQUISA BR**,
  ofertas LATAM na seção **PESQUISA LATAM**. Usar as ferramentas MCP do Todoist disponíveis na
  sessão (ver "Acesso ao Todoist" abaixo) — a API REST direta via `curl` é bloqueada pela
  política de rede do sandbox, não tente contornar isso.

## O que já existe (checar antes de minerar)

- Ler TODOS os projetos e seções do Todoist do usuário com `find-projects` e `find-tasks`
  (`responsibleUserFiltering: "all"`, paginação até o fim) e anotar nome, nicho, público e
  formato de cada tarefa de oferta existente (qualquer prefixo: `OFERTA NOVA NN`, nome solto,
  etc.).
- **Oferta morta conta como feita.** Qualquer tarefa arquivada/concluída ou com "não validou"
  na descrição é uma ideia já testada que não vendeu: nunca proponha a mesma ideia, o mesmo
  público com o mesmo formato, nem variação próxima. Cite o motivo de morte (quando escrito)
  como aviso pro nicho inteiro.
- Regra de duplicata: mesmo público + mesmo formato = reprova, mesmo com tema um pouco
  diferente. Cite no relatório final qualquer ideia barrada por isso e qual tarefa causou a
  barra.
- Numeração: o maior `NN` usado em `OFERTA NOVA NN` em qualquer projeto define a numeração de
  hoje. Varie os nichos-semente em relação ao que já está no Todoist.

## Mineração

1. `CHROME=<chromium> IGNORAR_TLS=1 node biblioteca.js --pais BR --paralelo 2 --saida /home/user/scratch/bib-br.json "termo1" "termo2" ...`
   e o equivalente com `--pais MX` para LATAM.
2. Ler o JSON de saída: cada card tem `id`, `preco`, `trechoTexto`. Descartar cards de marcas
   grandes/genéricas (aparecem só por ranking de relevância, não pela keyword).
3. Para cards promissores, rodar `node oferta.js --id <id> --saida /home/user/scratch/oferta-<id>.json`
   pra ler o anúncio completo antes de decidir.
4. Modelar a ideia de oferta (nome, promessa, público, entregável) a partir do padrão observado,
   sem copiar literalmente texto do concorrente. Validar contra a seção "O que já existe" antes
   de aprovar. Parar ao atingir a meta do dia (Seção 0). Limite de 45 minutos de trabalho — se
   estourar, entregar o que já foi aprovado e dizer quantas faltaram.

## Acesso ao Todoist (ferramentas MCP)

Use sempre as ferramentas MCP do conector Todoist disponíveis na sessão — nunca `curl`/API REST
direta (`api.todoist.com` é bloqueado pela política de egress do sandbox; se aparecer erro de
rede numa tentativa de acesso direto, é esperado, não insista).

- Listar projetos: `find-projects`
- Listar tarefas: `find-tasks` (com `responsibleUserFiltering: "all"` e paginação até o fim)
- Criar tarefa: `add-tasks` com `content`, `description`, `project_id`, `section_id`,
  `priority` (1-4) e `labels: ["LATAM"]` quando aplicável

## Entrega

- Cada ideia aprovada vira uma tarefa no Todoist, projeto "Ofertas Mineradas", seção do mercado
  (PESQUISA BR ou PESQUISA LATAM):
  - Título: `OFERTA NOVA NN - <nome da oferta>`
  - Descrição: nicho, público, formato do entregável, preços padrão do mercado, e os 2 links
    obrigatórios (URL de busca do `biblioteca.js` + URL de detalhe do `oferta.js` que originou a
    ideia).
  - Prioridade padrão 3 (média).
  - Ofertas LATAM recebem também a etiqueta `LATAM`.
- Nunca ultrapassar 20 tarefas abertas numa seção de pesquisa.
- Não fazer commit nem push no repo.
- Responder em português, curto: vagas por seção (antes/depois), lista das aprovadas (nome +
  link da tarefa criada), lista das reprovadas com motivo em uma linha (inclusive as barradas
  por duplicata/oferta morta), e qualquer problema de ambiente (Chromium, bloqueio da
  Biblioteca). Não sugerir próximo passo de produção.
