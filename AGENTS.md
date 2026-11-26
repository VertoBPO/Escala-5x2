# AGENTS.md — Escala 5x2

Sistema web de gestão, montagem e validação de escalas de trabalho 5x2 para propriedade rural com ordenha. Toda a interface e o código estão em **português do Brasil**: nomes de variáveis, funções, mensagens e comentários. Mantenha esse padrão.

## Visão geral

- **Sem build, sem dependências, sem servidor.** São três arquivos estáticos: [index.html](index.html), [script.js](script.js) e [style.css](style.css). Para rodar, abra o `index.html` no navegador.
- JavaScript puro (`'use strict'`, ES2020+), sem frameworks nem bibliotecas externas. Não adicione dependências sem pedido explícito.
- Os dados ficam só no **LocalStorage** do navegador. Não há backend.
- **Princípio do sistema:** o usuário monta a escala. O sistema não decide quem trabalha ou folga; ele verifica as escolhas e aponta problemas e sugestões. Operações automáticas (sugerir escala, marcar período como trabalhado, copiar semana) só agem com confirmação e criam um ponto de restauração antes.
- O sistema é uma ferramenta de apoio à conferência da jornada, não uma certificação jurídica. Não remova os avisos de conferência nem afrouxe regras trabalhistas para "fazer o alerta sumir".

## Estrutura do `script.js`

Os módulos são IIFEs globais, nesta ordem (as seções são numeradas no próprio arquivo):

| Módulo | Responsabilidade |
|---|---|
| `Util` | Datas, horários, formatação e escape de HTML. |
| `RegrasTrabalhistas` | Parâmetros legais (`configPadrao`, vigências) e o **validador** `validar(estado, ano, mes)`. **Não acessa a tela nem o LocalStorage**: recebe os dados e devolve `{ alertas, resumoColab, semanas, limiteMensalMin }`. Mantenha-o puro. |
| `Store` | Persistência no LocalStorage, `normalizar()` de dados antigos ou importados e pontos de restauração. |
| `DadosExemplo` | Dados demonstrativos, sempre marcados com `exemplo: true` e nomes iniciados por "Exemplo". |
| `SugestaoEscala` | Proposta automática de escala (`gerar` / `aplicar`). |
| `Equipes` | Regras de grupos (mínimo de 2 integrantes, exceto atividades com `grupoUnitario`). |
| `Escala` | Regras de atribuição: `atribuir`, `definirDia`, `definirFolga`, conflitos de horário e apoio a outro grupo. |
| `UI` | Telas (`RENDER.<pagina>`), modais, eventos, relatórios e impressão. |

## Convenções importantes

### Datas e horários

- Uma data é um "número do dia" (dias desde 01/01/1970 em UTC). Converta com `Util.isoParaDia` / `Util.diaParaIso`. Nunca use `Date` local para aritmética de datas.
- Um horário é um minuto absoluto: `dia × 1440 + minutos`. Um turno que atravessa a meia-noite (21:00 → 02:00) vira um intervalo contínuo.
- O trabalho efetivo de um turno é a duração menos o `intervaloMin`. Use `Escala.trabalhoTurno(t)`.

### Modelo de dados (`Store.estado`)

```js
{
  versao, config,                    // config: ver RegrasTrabalhistas.configPadrao()
  colaboradores: [{ id, nome, sexo, equipeId, atividade, substitutoEm, turnoPadrao, ativo, exemplo }],
  equipes:       [{ id, nome, atividade, turnos: [idTurno], turnoFixo, exemplo }],
  turnos:        [{ id, nome, sigla, inicio, fim, intervaloMin, minimo, atividades, cor }],
  escala: {
    'AAAA-MM-DD': {
      t: { [idTurno]: [{ c: idColab, a: idAtividade, g?: idEquipeApoiada }] },
      f: [idColab]                   // folgas marcadas explicitamente ("F")
    }
  }
}
```

- **Folga implícita:** com `config.diaSemTurnoEhFolga = true` (padrão), um dia com escala lançada em que a pessoa não tem turno conta como folga. Use `Escala.ehFolga()`; `Escala.emFolga()` cobre só a folga marcada com "F".
- **Apoio / cobertura de outro grupo (`g`):** no dia de folga do grupo de origem, o colaborador pode trabalhar por **um** outro grupo, sem turno do próprio grupo no mesmo dia, até `config.limiteApoioH` (10h por padrão).
  - `g` só é gravado quando difere do `equipeId` do colaborador. Leia-o sempre por `Escala.grupoApoio()`, que também trata grupo excluído e colaborador transferido.
  - Sem escolha explícita, `Escala.grupoSugerido()` deduz o grupo: o turno fixo de outro grupo, num dia de folga, conta como cobertura.
- Campo novo em `config`, colaborador, equipe ou turno: inclua o valor padrão em `configPadrao()` ou em `Store.normalizar()`, para que dados já salvos continuem funcionando.

### Interface e eventos

- **Cliques:** elementos com `data-acao="nome"` chamam `ACOES.nome(el, ev)`, por delegação no `document`. Para adicionar um botão, crie a entrada em `ACOES`; não use `onclick` nem listeners avulsos.
- **Mudanças em campos:** `data-change="nome"` chama `MUDANCAS.nome`. Campos de configuração usam `data-cfg="caminho.da.chave"` com `data-tipo="num|bool"` e são tratados automaticamente por `aoMudarConfig`. Buscas usam `data-input`.
- **Telas:** cada página é `RENDER.<pagina>()` e devolve uma string HTML. Depois de alterar dados, chame `commit(msg?)`, que salva, revalida e re-renderiza tudo.
- **Sempre escape** texto do usuário com `esc()` ao montar HTML.
- Modais usam `Modal.abrir({ titulo, corpo, botoes, aoAbrir })` e `Modal.confirmar(...)`. Avisos rápidos usam `toast(msg, 'sucesso' | 'erro' | 'info')`.
- Operações em massa devem chamar `Store.criarPonto('Antes de …')` antes de alterar a escala.

### Validação trabalhista

- Cada alerta tem `nivel` (`'vermelho'` = possível irregularidade, `'amarelo'` = atenção), `regra`, `motivo`, `sugestao`, `fonte` e `conferir`.
- Cite a base legal com as constantes de `FONTES`. Use `agrupar()` para ocorrências repetidas.
- Regras de descanso (repouso semanal, 11h entre jornadas, dias consecutivos, domingos) valem também para dias de apoio a outro grupo. Não as desative.

### CSS

- Paleta em variáveis no `:root` do [style.css](style.css): `--oliva` (cor principal), `--oliva-escuro`, `--oliva-claro`, `--dourado` (destaque) e as cores de status `--verde`, `--amarelo` e `--vermelho`. Use as variáveis em vez de cores fixas.
- As cores de status têm significado: verde = conformidade, amarelo = atenção, vermelho = possível irregularidade. Não as use para decoração.
- Responsivo: abaixo de 860px o menu lateral vira gaveta (☰). Acima disso, ele pode ser recolhido (classe `sidebar-recolhida` no `<html>`, salva na chave `escala5x2-sidebar`).
- O CSS de impressão fica em `@media print`; os relatórios são renderizados em `#printRaiz`.

### LocalStorage

| Chave | Conteúdo |
|---|---|
| `escala5x2.dados.v1` | Estado completo |
| `escala5x2.pontos.v1` | Pontos de restauração (até 8) |
| `escala5x2-sidebar` | `recolhida` / `expandida` |

## Como verificar alterações

Não há suíte de testes no repositório. Antes de concluir uma alteração:

1. Confira a sintaxe com `node --check script.js`.
2. Abra o `index.html` no navegador, escolha **"Ver com dados de exemplo"** e exercite o fluxo alterado. Os dados de exemplo trazem situações propositais que geram alertas.
3. Abra o console do navegador e confirme que não há erros.
4. Para mudanças em regras, confira a tela **Validação trabalhista** e o selo de alertas no menu.

Para testes automatizados pontuais, o `playwright-core` com o Chrome instalado funciona bem contra `file:///…/index.html`. Instale-o fora do projeto, para não criar `package.json` nem `node_modules` no repositório.

## Git

- Mensagens de commit em português, com título curto no imperativo ou descritivo (ex.: "Barra lateral recolhível") e corpo explicando o porquê.
- O remoto é `origin` (GitHub). Não faça push nem merge na `main` sem pedido explícito.
