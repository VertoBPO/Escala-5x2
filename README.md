# Escala 5x2 — Gestão e Validação

Sistema web para **montar e conferir escalas de trabalho 5x2** em propriedades rurais com ordenha. Você organiza colaboradores, equipes e turnos, monta a escala do mês e o sistema confere as escolhas com as regras trabalhistas: jornada, descansos, domingos e trabalho noturno. Os problemas aparecem como alertas, sempre com uma sugestão de ajuste.

> **Importante:** esta é uma ferramenta de apoio à organização e à conferência da jornada. Ela **não é garantia nem certificação de conformidade jurídica**. Situações sinalizadas devem ser conferidas na legislação e no instrumento coletivo (convenção ou acordo) aplicável.

## Como usar

Não é preciso instalar nada:

1. Baixe ou clone este repositório.
2. Abra o arquivo `index.html` no navegador (Chrome, Edge, Firefox ou Safari atualizados).
3. Na primeira abertura, escolha **"Ver com dados de exemplo"** para conhecer o sistema ou **"Começar sem dados"**.

Os dados ficam salvos automaticamente **no próprio navegador**, no computador em que o sistema foi aberto. Nada é enviado para a internet.

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Visão geral** | Resumo do mês: indicadores, situação dos alertas, escala do dia, regras aplicadas e horas por colaborador e por equipe. |
| **Colaboradores** | Cadastro com função, equipe, atividade, substituições e situação (ativo/inativo). |
| **Equipes** | Grupos de trabalho com turno fixo e turnos habilitados. Os grupos têm no mínimo 2 integrantes, exceto funções individuais (ex.: camas dos animais). |
| **Turnos** | Horários (Matutino, Vespertino e Noturno já vêm cadastrados), intervalo, cobertura mínima, atividades e cor. |
| **Montagem da escala** | Grade mensal ou semanal, por colaborador, por equipe ou por turno, com ferramentas de preenchimento rápido. |
| **Validação trabalhista** | Lista de alertas por gravidade, com motivo, sugestão e base legal. |
| **Relatórios** | Escala mensal, semanal, individual e por equipe, horas trabalhadas e irregularidades, prontos para imprimir ou salvar em PDF. |
| **Configurações** | Limites de jornada e descanso, regras por vigência, atividades, backup e restauração. |

### Montagem da escala

- **Escalar no turno do grupo:** um clique no dia escala o colaborador no turno fixo do grupo dele; outro clique desmarca. Dia sem marcação conta como folga.
- **Marcar mês/semana como trabalhado:** preenche todos os dias com o turno fixo. Depois, basta clicar nos dias de folga para desmarcá-los.
- **Ferramentas de turno, folga e limpar:** pincéis para marcar vários dias rapidamente.
- **Editar dia:** escolhe turnos, atividade ou folga de um colaborador em um dia.
- **Apoio a outro grupo na folga:** no dia de folga do grupo de origem, o colaborador pode cobrir outro grupo, com jornada de até **10h** no dia (o limite pode ser alterado em Configurações). O turno de apoio aparece com contorno dourado.
- **Sugerir escala:** gera uma proposta, que só é aplicada depois da sua confirmação.
- **Copiar semana**, **limpar período** e **pontos de restauração**, para desfazer alterações em massa.

### O que a validação confere

- Jornada diária e semanal (com regras por vigência: 44h, 42h e 40h semanais).
- Intervalo mínimo de 11h entre jornadas e intervalo dentro da jornada.
- Repousos semanais de 24h consecutivas (somados às 11h entre jornadas, conforme a Súmula 110 do TST).
- Máximo de dias consecutivos de trabalho.
- Revezamento dominical, incluindo o revezamento quinzenal das colaboradoras (CLT, art. 386).
- Trabalho noturno rural (Lei 5.889/1973).
- Cobertura mínima de turnos e atividades, sobreposição de turnos e coerência entre equipe, turno e atividade.

Os alertas são classificados em **vermelho** (possível irregularidade) e **amarelo** (atenção, conferir).

#### Base legal considerada

- [Emenda Constitucional nº 141/2026](https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm) e Portaria MTE nº 2.041/2026
- [Lei nº 5.889/1973 — trabalho rural](https://www.planalto.gov.br/ccivil_03/leis/l5889.htm)
- [CLT](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm), arts. 59, 66, 71 e 386 (aplicação subsidiária ao rural)
- TST: Súmula 110 e OJ 410 da SDI-1

## Backup dos dados

Como os dados ficam no navegador, faça backups com frequência:

- **Configurações → Exportar backup (.json):** salva um arquivo com todos os dados.
- **Configurações → Importar backup:** recupera os dados a partir desse arquivo. Antes de importar, o sistema cria um ponto de restauração.

Limpar os dados de navegação, usar uma janela anônima ou trocar de navegador ou computador faz os dados não aparecerem. Nesses casos, importe o backup.

## Estrutura do projeto

```
index.html   estrutura da página
style.css    aparência (paleta verde oliva e dourado), responsivo e impressão
script.js    regras trabalhistas, armazenamento, regras da escala e interface
AGENTS.md    guia técnico para quem for alterar o código
```

O projeto usa só HTML, CSS e JavaScript puro, sem frameworks, dependências ou etapa de build. Detalhes de arquitetura, modelo de dados e convenções estão no [AGENTS.md](AGENTS.md).
