/* ==========================================================================
   SISTEMA DE GESTÃO E VALIDAÇÃO DE ESCALAS 5X2 — PROPRIEDADE RURAL (ORDENHA)
   Arquivo: script.js  —  JavaScript puro (sem frameworks)

   Organização do código:
     1. Util ................ funções de data, horário, texto e formatação
     2. RegrasTrabalhistas .. MÓDULO INDEPENDENTE: parâmetros legais + VALIDADOR
                              TRABALHISTA (não acessa a tela nem o LocalStorage;
                              recebe os dados e devolve alertas e indicadores)
     3. Store ............... armazenamento no LocalStorage e pontos de restauração
     4. DadosExemplo ........ dados demonstrativos (sempre identificados como EXEMPLO)
   4b. SugestaoEscala ..... proposta de escala opcional (aplicada só com confirmação)
     5. Equipes / Escala .... regras de negócio (grupos, atribuições, folgas)
     6. UI .................. telas, modais, eventos e impressão
     7. Inicialização

   Princípio do sistema: o USUÁRIO monta a escala. O sistema NÃO decide quem
   trabalha ou folga; apenas verifica as escolhas e aponta problemas/sugestões.
   ========================================================================== */
'use strict';

/* ==========================================================================
   1. UTILITÁRIOS
   Datas são tratadas como "número do dia" (dias desde 01/01/1970, em UTC) para
   evitar erros de fuso/horário de verão. Horários são minutos absolutos:
   (número do dia × 1440) + minutos do dia. Assim, um turno que atravessa a
   meia-noite (21:00 → 02:00) vira um intervalo contínuo sem ambiguidade.
   ========================================================================== */
const Util = (() => {
  const DIA_MS = 86400000;
  const pad = (n) => String(n).padStart(2, '0');

  const isoParaDia = (iso) => {
    const [a, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(a, m - 1, d) / DIA_MS);
  };
  const diaParaIso = (n) => {
    const dt = new Date(n * DIA_MS);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  };
  /** 0 = domingo ... 6 = sábado (01/01/1970 foi uma quinta-feira) */
  const diaSemana = (n) => ((n + 4) % 7 + 7) % 7;
  const hhmmParaMin = (h) => {
    const [a, b] = String(h || '00:00').split(':').map(Number);
    return (a || 0) * 60 + (b || 0);
  };
  const minParaHHMM = (m) => {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  };
  /** 330 → "5h30"; 2400 → "40h" */
  const fmtHoras = (min) => {
    const neg = min < 0;
    min = Math.abs(Math.round(min));
    const h = Math.floor(min / 60);
    const r = min % 60;
    return `${neg ? '-' : ''}${h}h${r ? pad(r) : ''}`;
  };
  const fmtData = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
  const fmtDataCurta = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
  /** minuto absoluto → "02:00 de 06/12" */
  const fmtMinAbs = (abs) => `${minParaHHMM(abs)} de ${fmtDataCurta(diaParaIso(Math.floor(abs / 1440)))}`;
  const hojeIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const diasNoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const primeiroDiaMes = (ano, mes) => isoParaDia(`${ano}-${pad(mes)}-01`);
  /** Primeiro dia da semana que contém "dia" (inicioSem: 0 = domingo, 1 = segunda) */
  const inicioSemana = (dia, inicioSem) => dia - ((diaSemana(dia) - inicioSem + 7) % 7);
  const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Duração do turno em minutos, considerando a virada da meia-noite */
  const duracaoTurno = (t) => {
    let d = hhmmParaMin(t.fim) - hhmmParaMin(t.inicio);
    if (d <= 0) d += 1440;
    return d;
  };
  const atravessaMeiaNoite = (t) => hhmmParaMin(t.fim) <= hhmmParaMin(t.inicio);
  /** Lista de datas compacta: "01/12, 02/12, 05/12 e mais 3" */
  const listaDatas = (isos, max = 8) => {
    const ord = [...isos].sort();
    const txt = ord.slice(0, max).map(fmtDataCurta).join(', ');
    return ord.length > max ? `${txt} e mais ${ord.length - max}` : txt;
  };
  const primeiroNome = (nome) => {
    const p = String(nome || '').trim().split(/\s+/);
    return p.length > 1 ? `${p[0]} ${p[p.length - 1].charAt(0)}.` : p[0];
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const SIGLAS_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
    'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  return {
    pad, isoParaDia, diaParaIso, diaSemana, hhmmParaMin, minParaHHMM, fmtHoras, fmtData,
    fmtDataCurta, fmtMinAbs, hojeIso, diasNoMes, primeiroDiaMes, inicioSemana, uid, esc,
    duracaoTurno, atravessaMeiaNoite, listaDatas, primeiroNome, clone,
    NOMES_DIAS, SIGLAS_DIAS, NOMES_MESES,
  };
})();

/* ==========================================================================
   2. MÓDULO REGRAS TRABALHISTAS + VALIDADOR TRABALHISTA
   --------------------------------------------------------------------------
   Todas as regras legais estão centralizadas aqui. Para atualizar a legislação,
   altere configPadrao() (valores) e/ou validar() (lógica). Os valores também
   podem ser ajustados pelo usuário na tela "Configurações".

   Referências consideradas:
   - CF, art. 7º, XIII e XV, com redação da EC nº 141/2026 (DOU 16/10/2026):
     8h diárias; 42h semanais (2 meses após a publicação) e 40h (1 ano depois);
     2 dias de repouso semanal remunerado, um preferencialmente aos domingos.
   - Portaria MTE nº 2.041/2026 (divulgação oficial do MTE de 23/11/2026):
     vigência em 16/12/2026 (42h e 2 repousos) e 16/12/2027 (40h); repousos de
     24h consecutivas, consecutivos ou não; coincidência com o domingo ao menos
     1 vez a cada 4 semanas (demais atividades); revezamento quinzenal para
     empregadas que trabalham aos domingos (CLT, art. 386).
   - Lei nº 5.889/1973 (trabalho rural): art. 5º (11h entre jornadas e intervalo
     em trabalho contínuo acima de 6h, conforme usos e costumes da região);
     art. 7º (noturno na pecuária: 20h às 4h; adicional de 25%).
   - CLT (aplicação subsidiária ao rural): arts. 59, 66, 71 e 386.
   - TST: Súmula 110 (repouso semanal somado ao intervalo de 11h) e
     OJ 410 da SDI-1 (repouso concedido após o 7º dia consecutivo).
   A ferramenta é apoio à conferência — não substitui análise jurídica.
   ========================================================================== */
const RegrasTrabalhistas = (() => {
  const {
    isoParaDia, diaParaIso, diaSemana, hhmmParaMin, fmtHoras, fmtData, fmtDataCurta, fmtMinAbs,
    diasNoMes, primeiroDiaMes, inicioSemana, duracaoTurno, listaDatas,
  } = Util;

  const AVISO_CONFERENCIA = 'Esta situação exige conferência da legislação específica e do instrumento coletivo aplicável.';

  const FONTES = {
    EC141: 'CF, art. 7º, XIII e XV (redação da EC nº 141/2026)',
    PORTARIA: 'Portaria MTE nº 2.041/2026',
    RURAL_ART5: 'Lei nº 5.889/1973 (trabalho rural), art. 5º',
    RURAL_ART7: 'Lei nº 5.889/1973 (trabalho rural), art. 7º',
    CLT59: 'CLT, art. 59 (horas extras)',
    CLT66: 'CLT, art. 66',
    CLT71: 'CLT, art. 71',
    CLT386: 'CLT, art. 386',
    SUM110: 'Súmula 110 do TST',
    OJ410: 'OJ 410 da SDI-1 do TST',
    OPERACIONAL: 'Regra operacional da propriedade (configurável)',
  };

  const LINKS = [
    { rotulo: 'Emenda Constitucional nº 141/2026 (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm' },
    { rotulo: 'Portaria MTE nº 2.041/2026 — notícia oficial do MTE', url: 'https://www.gov.br/trabalho-e-emprego/pt-br/noticias-e-conteudo/2026/novembro/governo-federal-publica-portaria-com-regras-complementares-para-aplicacao-da-escala-5x2' },
    { rotulo: 'Lei nº 5.889/1973 — trabalho rural (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l5889.htm' },
    { rotulo: 'Consolidação das Leis do Trabalho — CLT (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm' },
  ];

  /** Parâmetros legais e operacionais padrão (editáveis em Configurações). */
  function configPadrao() {
    return {
      propriedade: '',
      inicioSemana: 1,                    // 1 = semana de segunda a domingo; 0 = domingo a sábado
      limiteDiarioH: 8,                   // CF, art. 7º, XIII
      interjornadaH: 11,                  // Lei 5.889/1973, art. 5º; CLT, art. 66
      maxDiasConsecutivos: 6,             // OJ 410 SDI-1 TST; Portaria 2.041 (1 descanso a cada 6 dias)
      somarInterjornadaAoRepouso: true,   // Súmula 110 TST: repouso de 24h + 11h = 35h
      apuracao: 'semanal',                // 'semanal' | 'mensal' (média mensal só com instrumento coletivo)
      regraMulheresArt386: true,          // CLT, art. 386 (revezamento quinzenal aos domingos)
      diaSemTurnoEhFolga: true,           // dia sem marcação na escala = folga (não exige marcar "F")
      sugestao: { folgasPorDia: 3, incluirFuncoes: true }, // parâmetros do botão "Sugerir escala"
      intrajornada: {
        acima6hMin: 60,                   // trabalho contínuo > 6h (rural: usos e costumes da região)
        de4a6hMin: 15,                    // CLT, art. 71, §1º (aplicação ao rural a conferir)
        maxEntreTurnosMin: 120,           // CLT, art. 71 (máximo de 2h, salvo acordo / costume rural)
      },
      noturno: { inicio: '20:00', fim: '04:00', perfil: 'pecuaria' }, // Lei 5.889/1973, art. 7º
      tamanhoPadraoEquipe: 3,
      vigencias: [
        {
          id: 'v_anterior', inicio: '', semanalH: 44, dsr: 1, domingoSemanas: 7,
          descricao: 'Regra anterior à EC 141/2026: 44h semanais e 1 repouso semanal (revezamento dominical em até 7 semanas — conferir)',
        },
        {
          id: 'v_2026', inicio: '2026-12-16', semanalH: 42, dsr: 2, domingoSemanas: 4,
          descricao: 'EC 141/2026 (art. 6º, I) e Portaria MTE 2.041/2026: 42h semanais e 2 repousos de 24h',
        },
        {
          id: 'v_2027', inicio: '2027-12-16', semanalH: 40, dsr: 2, domingoSemanas: 4,
          descricao: 'EC 141/2026 (art. 6º, II) e Portaria MTE 2.041/2026: 40h semanais e 2 repousos de 24h',
        },
      ],
      atividades: [
        { id: 'ordenha', nome: 'Ordenha', coberturaMinDia: 0, grupoUnitario: false, fixa: true },
        { id: 'camas', nome: 'Camas dos animais', coberturaMinDia: 1, grupoUnitario: true, fixa: true }, // função exercida por 1 pessoa
        { id: 'alimentacao', nome: 'Alimentação dos animais', coberturaMinDia: 1, grupoUnitario: false, fixa: true },
        { id: 'outra', nome: 'Outra', coberturaMinDia: 0, grupoUnitario: false, fixa: true },
      ],
      instrumentoColetivo: '',
    };
  }

  /** Regra (vigência) aplicável a uma data ISO. */
  function regraVigente(cfg, iso) {
    const lista = [...(cfg.vigencias || [])].sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
    let r = lista[0];
    for (const v of lista) if (!v.inicio || v.inicio <= iso) r = v;
    return r || { semanalH: 44, dsr: 1, domingoSemanas: 7, descricao: 'Sem regra configurada' };
  }

  /** Regras distintas que incidem sobre um mês (para exibição). */
  function regrasDoMes(cfg, ano, mes) {
    const ini = primeiroDiaMes(ano, mes);
    const res = [];
    for (let d = ini; d < ini + diasNoMes(ano, mes); d++) {
      const r = regraVigente(cfg, diaParaIso(d));
      const ult = res[res.length - 1];
      if (!ult || ult.regra !== r) res.push({ regra: r, de: diaParaIso(d), ate: diaParaIso(d) });
      else ult.ate = diaParaIso(d);
    }
    return res;
  }

  /**
   * VALIDADOR TRABALHISTA
   * Analisa a escala de um mês (com contexto das semanas vizinhas) e devolve:
   *   { alertas, resumoColab, semanas, limiteMensalMin, totalAlertas }
   * Cada alerta: nivel ('vermelho'|'amarelo'), colaborador, data, turno, regra,
   * motivo, sugestao, fonte, conferir (exibe o aviso de conferência), isos.
   */
  function validar(estado, ano, mes) {
    const cfg = estado.config;
    const alertas = [];
    const agrupados = new Map();

    const novo = (a) => {
      alertas.push(Object.assign({
        nivel: 'amarelo', colabId: null, colaborador: '—', iso: null, isos: [], data: '—',
        turno: '—', regra: '', motivo: '', sugestao: '', fonte: '', conferir: false,
      }, a, { isos: a.isos || (a.iso ? [a.iso] : []) }));
    };
    /** Agrupa ocorrências repetidas (mesma regra/colaborador) em um único alerta com várias datas */
    const agrupar = (chave, base, iso) => {
      let a = agrupados.get(chave);
      if (!a) { a = Object.assign({}, base, { isos: [] }); agrupados.set(chave, a); }
      if (iso && !a.isos.includes(iso)) a.isos.push(iso);
    };

    const diaIni = primeiroDiaMes(ano, mes);
    const diaFim = diaIni + diasNoMes(ano, mes) - 1;
    const noMes = (d) => d >= diaIni && d <= diaFim;
    const LIM_DIA = Number(cfg.limiteDiarioH) * 60;
    const INTER = Number(cfg.interjornadaH) * 60;
    const EXTRA_DSR = cfg.somarInterjornadaAoRepouso ? INTER : 0;
    const MAX_CONSEC = Number(cfg.maxDiasConsecutivos) || 6;
    // Contexto: 8 semanas antes (revezamento dominical) e 2 semanas depois do mês
    const ini = inicioSemana(diaIni, cfg.inicioSemana) - 7 * 8;
    const fim = inicioSemana(diaFim, cfg.inicioSemana) + 13;

    const turnos = new Map(estado.turnos.map((t) => [t.id, t]));
    const equipes = new Map(estado.equipes.map((e) => [e.id, e]));
    const atividades = new Map(cfg.atividades.map((a) => [a.id, a]));
    const nomeAtiv = (id) => atividades.get(id)?.nome || id || '—';

    /* ---- Monta os "itens de trabalho" de cada colaborador (minutos absolutos) ---- */
    const diasComDados = new Set();
    const itensPorColab = new Map();
    const folgasPorColab = new Map();
    for (const [iso, dia] of Object.entries(estado.escala)) {
      const d = isoParaDia(iso);
      let tem = false;
      for (const [tid, lista] of Object.entries(dia.t || {})) {
        const t = turnos.get(tid);
        if (!t || !lista.length) continue;
        tem = true;
        if (d < ini - 1 || d > fim + 1) continue;
        const dur = duracaoTurno(t);
        const inicio = d * 1440 + hhmmParaMin(t.inicio);
        for (const e of lista) {
          if (!itensPorColab.has(e.c)) itensPorColab.set(e.c, []);
          itensPorColab.get(e.c).push({
            dia: d, iso, turno: t, inicio, fim: inicio + dur,
            trabalho: Math.max(0, dur - (Number(t.intervaloMin) || 0)), atividade: e.a,
          });
        }
      }
      for (const c of dia.f || []) {
        tem = true;
        if (!folgasPorColab.has(c)) folgasPorColab.set(c, new Set());
        folgasPorColab.get(c).add(d);
      }
      if (tem) diasComDados.add(d);
    }
    /** Dia "conhecido": dentro do mês ou, fora dele, com alguma escala lançada */
    const conhecido = (d) => noMes(d) || diasComDados.has(d);

    let limiteMensalMin = 0;
    for (let d = diaIni; d <= diaFim; d++) limiteMensalMin += regraVigente(cfg, diaParaIso(d)).semanalH * 60 / 7;

    const semanas = [];
    for (let ws = inicioSemana(diaIni, cfg.inicioSemana); ws <= diaFim; ws += 7) semanas.push(ws);

    const resumoColab = new Map();
    const diasComDadosMes = [...diasComDados].filter(noMes).sort((a, b) => a - b);

    /* ======================= ANÁLISE POR COLABORADOR ======================= */
    for (const c of estado.colaboradores) {
      const itens = (itensPorColab.get(c.id) || []).sort((a, b) => a.inicio - b.inicio);
      const itensMes = itens.filter((i) => noMes(i.dia));
      const folgasMarcadas = folgasPorColab.get(c.id) || new Set();
      const base = { colabId: c.id, colaborador: c.nome };
      const resumo = {
        minMes: 0, diasTrab: 0, descansos: 0, folgasMarcadas: 0, semanas: [],
        noturnoMin: 0, domingosFolga: 0, domingosTrab: 0, dsrValidosMes: 0,
      };
      resumoColab.set(c.id, resumo);

      // Colaborador inativo escalado
      if (!c.ativo && itensMes.length) {
        for (const it of itensMes) {
          agrupar(`inativo|${c.id}`, {
            ...base, nivel: 'amarelo', regra: 'Colaborador inativo escalado',
            motivo: 'O colaborador está cadastrado como inativo, mas aparece na escala.',
            sugestao: 'Retire-o da escala ou altere a situação para "ativo" no cadastro.',
            fonte: FONTES.OPERACIONAL,
          }, it.iso);
        }
      }

      /* ---- (a) Sobreposição / trabalho simultâneo ---- */
      for (let i = 0; i < itens.length; i++) {
        for (let j = i + 1; j < itens.length && itens[j].inicio < itens[i].fim; j++) {
          const a = itens[i]; const b = itens[j];
          if (!noMes(a.dia) && !noMes(b.dia)) continue;
          const locais = a.atividade !== b.atividade;
          novo({
            ...base, nivel: 'vermelho', iso: b.iso, data: fmtData(b.iso),
            turno: `${a.turno.nome} × ${b.turno.nome}`,
            regra: locais ? 'Funcionário escalado em dois locais simultaneamente' : 'Sobreposição de turnos',
            motivo: `${a.turno.nome} (${fmtMinAbs(a.inicio)} às ${fmtMinAbs(a.fim)} — ${nomeAtiv(a.atividade)}) coincide com ${b.turno.nome} (${fmtMinAbs(b.inicio)} às ${fmtMinAbs(b.fim)} — ${nomeAtiv(b.atividade)}).`,
            sugestao: 'Mantenha apenas um dos turnos para este colaborador e escale outra pessoa no turno que ficar descoberto.',
            fonte: FONTES.OPERACIONAL,
          });
        }
      }

      /* ---- (b) Jornada diária, intervalos no mesmo dia e intrajornada ---- */
      const porDia = new Map();
      for (const it of itens) {
        if (!porDia.has(it.dia)) porDia.set(it.dia, []);
        porDia.get(it.dia).push(it);
      }
      const diasOrd = [...porDia.keys()].sort((a, b) => a - b);

      for (const d of diasOrd) {
        if (!noMes(d)) continue;
        const lista = porDia.get(d);
        const total = lista.reduce((s, i) => s + i.trabalho, 0);
        const iso = diaParaIso(d);
        resumo.minMes += total;
        resumo.diasTrab++;
        const nomesT = lista.map((i) => i.turno.nome).join(' + ');

        if (total > LIM_DIA) {
          novo({
            ...base, nivel: 'vermelho', iso, data: fmtData(iso), turno: nomesT,
            regra: 'Jornada diária acima do limite normal',
            motivo: `Soma de ${fmtHoras(total)} de trabalho no dia (${lista.map((i) => `${i.turno.nome} ${i.turno.inicio}–${i.turno.fim}`).join(' + ')}). Limite normal: ${fmtHoras(LIM_DIA)}. O tempo entre um turno e outro não foi contado como trabalho.`,
            sugestao: `Mantenha apenas um turno neste dia ou reduza a jornada para até ${fmtHoras(LIM_DIA)}. Excedente de ${fmtHoras(total - LIM_DIA)}: prorrogação só é possível com acordo, até 2h extras por dia e pagamento do adicional.`,
            fonte: `${FONTES.EC141}; ${FONTES.CLT59}`, conferir: true,
          });
        }
        for (let k = 1; k < lista.length; k++) {
          const gap = lista[k].inicio - lista[k - 1].fim;
          if (gap > Number(cfg.intrajornada.maxEntreTurnosMin)) {
            novo({
              ...base, nivel: 'amarelo', iso, data: fmtData(iso),
              turno: `${lista[k - 1].turno.nome} + ${lista[k].turno.nome}`,
              regra: 'Intervalo entre turnos do mesmo dia acima do usual',
              motivo: `Intervalo de ${fmtHoras(gap)} entre ${lista[k - 1].turno.nome} e ${lista[k].turno.nome}. Esse período NÃO é contado como trabalho, mas intervalos acima de ${fmtHoras(cfg.intrajornada.maxEntreTurnosMin)} dependem de previsão em acordo ou dos usos e costumes da região.`,
              sugestao: 'Confirme se a jornada fracionada está prevista no contrato/instrumento coletivo ou concentre o trabalho em um único turno.',
              fonte: `${FONTES.RURAL_ART5}; ${FONTES.CLT71}`, conferir: true,
            });
          }
        }
        // Trabalho contínuo (turnos com pausa menor que o intervalo mínimo formam um bloco contínuo)
        const avaliarBloco = (bloco) => {
          const trab = bloco.reduce((s, i) => s + i.trabalho, 0);
          let maiorPausa = Math.max(...bloco.map((i) => Number(i.turno.intervaloMin) || 0));
          for (let k = 1; k < bloco.length; k++) maiorPausa = Math.max(maiorPausa, bloco[k].inicio - bloco[k - 1].fim);
          if (trab > 360 && maiorPausa < Number(cfg.intrajornada.acima6hMin)) {
            agrupar(`intra|${c.id}|${bloco.map((i) => i.turno.id).join('+')}`, {
              ...base, nivel: 'vermelho', turno: bloco.map((i) => i.turno.nome).join(' + '),
              regra: 'Intervalo intrajornada insuficiente',
              motivo: `Trabalho contínuo de ${fmtHoras(trab)} sem intervalo de pelo menos ${cfg.intrajornada.acima6hMin} min para repouso/alimentação.`,
              sugestao: 'Cadastre o intervalo dentro do turno (tela Turnos) ou divida a jornada em turnos com pausa adequada.',
              fonte: `${FONTES.RURAL_ART5}; ${FONTES.CLT71}`, conferir: true,
            }, iso);
          }
        };
        let bloco = [lista[0]];
        for (let k = 1; k < lista.length; k++) {
          if (lista[k].inicio - lista[k - 1].fim < Number(cfg.intrajornada.acima6hMin)) bloco.push(lista[k]);
          else { avaliarBloco(bloco); bloco = [lista[k]]; }
        }
        avaliarBloco(bloco);
      }

      /* ---- (c) Intervalo mínimo entre jornadas (11h) ---- */
      for (let k = 1; k < diasOrd.length; k++) {
        const d1 = diasOrd[k - 1]; const d2 = diasOrd[k];
        if (!noMes(d1) && !noMes(d2)) continue;
        const fimJ = Math.max(...porDia.get(d1).map((i) => i.fim));
        const iniJ = Math.min(...porDia.get(d2).map((i) => i.inicio));
        const gap = iniJ - fimJ;
        if (gap >= 0 && gap < INTER) {
          const it1 = porDia.get(d1).find((i) => i.fim === fimJ);
          const it2 = porDia.get(d2).find((i) => i.inicio === iniJ);
          const iso2 = diaParaIso(d2);
          const opcoes = estado.turnos
            .filter((t) => d2 * 1440 + hhmmParaMin(t.inicio) - fimJ >= INTER)
            .map((t) => `${t.nome} (${t.inicio})`);
          novo({
            ...base, nivel: 'vermelho', iso: iso2, data: fmtData(iso2),
            turno: `${it1.turno.nome} → ${it2.turno.nome}`,
            regra: `Intervalo entre jornadas inferior a ${fmtHoras(INTER)}`,
            motivo: `O turno ${it1.turno.nome} termina às ${fmtMinAbs(fimJ)} e o turno ${it2.turno.nome} começa às ${fmtMinAbs(iniJ)}: apenas ${fmtHoras(gap)} de descanso entre as jornadas.`,
            sugestao: opcoes.length
              ? `Em ${fmtDataCurta(iso2)}, os turnos que respeitam ${fmtHoras(INTER)} de descanso são: ${opcoes.join(', ')}. Outra opção é marcar folga ou trocar com outro colaborador.`
              : `Marque folga em ${fmtDataCurta(iso2)} ou troque o turno com outro colaborador.`,
            fonte: `${FONTES.RURAL_ART5}; ${FONTES.CLT66}`,
          });
        }
      }

      /* ---- (d) Dias consecutivos de trabalho ---- */
      const diasTrab = new Set(diasOrd);
      let seq = 0; let inicioSeq = null; let alertado = false;
      for (let d = ini; d <= diaFim; d++) {
        if (diasTrab.has(d)) {
          if (seq === 0) { inicioSeq = d; alertado = false; }
          seq++;
          if (seq > MAX_CONSEC && !alertado && noMes(d)) {
            alertado = true;
            const iso = diaParaIso(d);
            novo({
              ...base, nivel: 'vermelho', iso, data: fmtData(iso), turno: porDia.get(d).map((i) => i.turno.nome).join(' + '),
              regra: `Mais de ${MAX_CONSEC} dias consecutivos de trabalho`,
              motivo: `Trabalho sem repouso de ${fmtDataCurta(diaParaIso(inicioSeq))} a ${fmtDataCurta(iso)}: este é o ${seq}º dia seguido.`,
              sugestao: `Marque uma folga em algum dia entre ${fmtDataCurta(diaParaIso(inicioSeq))} e ${fmtDataCurta(iso)}. Exceções dependem de compensação prevista em convenção ou acordo coletivo.`,
              fonte: `${FONTES.EC141}; ${FONTES.OJ410}; ${FONTES.PORTARIA}`,
            });
          }
        } else seq = 0;
      }

      /* ---- (e) Repouso semanal: blocos de folga e repousos válidos ----
         Dia de descanso = dia em que nenhum turno COMEÇA (o final de um Noturno
         iniciado na véspera não transforma o dia seguinte em dia trabalhado).
         Um bloco de k dias de descanso só vale como k repousos se o descanso
         contínuo real (fim do último turno antes → início do primeiro turno
         depois) for >= k × 24h (+ 11h entre jornadas, se "Súmula 110" ativa).
         Ex.: Noturno termina 02:00, folga, Matutino às 05:00 do dia seguinte =
         27h contínuas → NÃO completa 24h + 11h. */
      const livre = (d) => conhecido(d) && !diasTrab.has(d);
      const creditados = new Set();
      const blocosFalhos = [];
      for (let d = ini; d <= fim; d++) {
        if (!livre(d)) continue;
        const b0 = d;
        while (d + 1 <= fim && livre(d + 1)) d++;
        const b1 = d;
        const k = b1 - b0 + 1;
        const antes = itens.filter((i) => i.inicio < b0 * 1440);
        const depois = itens.filter((i) => i.inicio >= (b1 + 1) * 1440);
        // Sem turno conhecido antes/depois do bloco (ex.: mês seguinte ainda sem escala) → não penaliza
        const prevEnd = diasTrab.has(b0 - 1) && antes.length ? Math.max(...antes.map((i) => i.fim)) : -Infinity;
        const nextStart = diasTrab.has(b1 + 1) && depois.length ? Math.min(...depois.map((i) => i.inicio)) : Infinity;
        const descanso = nextStart - prevEnd;
        const credito = Math.max(0, Math.min(k, Math.floor((descanso - EXTRA_DSR) / 1440)));
        for (let x = 0; x < credito; x++) creditados.add(b0 + x);
        if (credito < k) blocosFalhos.push({ b0, b1, k, credito, descanso, prevEnd, nextStart });
      }

      for (const ws of semanas) {
        const we = ws + 6;
        const rI = regraVigente(cfg, diaParaIso(ws));
        const rF = regraVigente(cfg, diaParaIso(we));
        let validos = 0; let desconhecidos = 0; let descansos = 0; let dTrab = 0;
        for (let x = ws; x <= we; x++) {
          if (!conhecido(x)) { desconhecidos++; continue; }
          if (creditados.has(x)) validos++;
          if (diasTrab.has(x)) dTrab++; else descansos++;
        }
        const minSem = itens.filter((i) => i.dia >= ws && i.dia <= we).reduce((s, i) => s + i.trabalho, 0);
        const periodo = `Semana de ${fmtDataCurta(diaParaIso(ws))} a ${fmtDataCurta(diaParaIso(we))}`;
        const isoRef = diaParaIso(Math.max(ws, diaIni));
        resumo.semanas.push({
          ws, min: minSem, limite: rF.semanalH * 60, dsrValidos: validos, dsrExig: rF.dsr,
          diasTrab: dTrab, descansos, parcial: desconhecidos > 0,
        });

        // Repousos insuficientes
        if (dTrab > 0 && validos < rF.dsr) {
          const falhas = blocosFalhos.filter((b) => b.b1 >= ws && b.b0 <= we);
          const detalhe = falhas.map((b) => {
            const rot = b.k > 1 ? `as folgas de ${fmtDataCurta(diaParaIso(b.b0))} a ${fmtDataCurta(diaParaIso(b.b1))}` : `a folga de ${fmtDataCurta(diaParaIso(b.b0))}`;
            return `${rot} tiveram ${fmtHoras(b.descanso)} de descanso contínuo (de ${fmtMinAbs(b.prevEnd)} até ${fmtMinAbs(b.nextStart)}); o mínimo é ${fmtHoras(b.k * 1440 + EXTRA_DSR)}`;
          }).join('; ');
          let nivel = 'vermelho'; let obs = '';
          if (desconhecidos > 0 && validos + desconhecidos >= rF.dsr) {
            nivel = 'amarelo';
            obs = ' Parte da semana está fora do mês selecionado e ainda não tem escala lançada — confira junto com o mês vizinho.';
          } else if (rI.dsr !== rF.dsr && validos >= rI.dsr) {
            nivel = 'amarelo';
            obs = ` Semana de transição: a regra muda em ${fmtData(rF.inicio)} (de ${rI.dsr} para ${rF.dsr} repousos).`;
          }
          novo({
            ...base, nivel, iso: isoRef, isos: [], data: periodo, turno: '—',
            regra: 'Ausência de descanso semanal obrigatório',
            motivo: `${validos} repouso(s) válido(s) de 24h consecutivas${EXTRA_DSR ? ' (somadas às 11h entre jornadas)' : ''}; exigido(s): ${rF.dsr}.${detalhe ? ` Detalhe: ${detalhe}.` : ''}${obs}`,
            sugestao: falhas.length
              ? 'Evite escalar Noturno/Vespertino na véspera da folga ou Matutino logo depois dela, ou acrescente uma folga nesta semana (de preferência no domingo).'
              : `Marque mais ${rF.dsr - validos} folga(s) nesta semana, preferencialmente no domingo. As folgas podem ser seguidas ou separadas.`,
            fonte: `${FONTES.EC141}; ${FONTES.PORTARIA}${EXTRA_DSR ? `; ${FONTES.SUM110}` : ''}`,
            conferir: nivel === 'amarelo',
          });
        }

        // Jornada semanal
        if (minSem > rF.semanalH * 60) {
          let nivel = 'vermelho'; let obs = '';
          if (cfg.apuracao === 'mensal') {
            nivel = 'amarelo';
            obs = ' A apuração está configurada pela média mensal (exige compensação prevista em convenção ou acordo coletivo).';
          } else if (rI.semanalH !== rF.semanalH && minSem <= rI.semanalH * 60) {
            nivel = 'amarelo';
            obs = ` Semana de transição: o limite muda de ${rI.semanalH}h para ${rF.semanalH}h em ${fmtData(rF.inicio)}.`;
          }
          const exc = minSem - rF.semanalH * 60;
          novo({
            ...base, nivel, iso: isoRef, isos: [], data: periodo, turno: '—',
            regra: 'Jornada semanal acima do limite normal',
            motivo: `${fmtHoras(minSem)} de trabalho na semana; limite: ${rF.semanalH}h. Horas excedentes: ${fmtHoras(exc)}.${obs}`,
            sugestao: `Reduza ${fmtHoras(exc)} nesta semana (por exemplo, troque um turno por folga). Horas extras exigem acordo e pagamento do adicional.`,
            fonte: `${FONTES.EC141}; ${FONTES.PORTARIA}`, conferir: nivel === 'amarelo',
          });
        }
      }

      // Totais do mês
      for (let d = diaIni; d <= diaFim; d++) {
        if (!diasTrab.has(d)) resumo.descansos++;
        if (creditados.has(d)) resumo.dsrValidosMes++;
        if (folgasMarcadas.has(d)) resumo.folgasMarcadas++;
      }
      if (cfg.apuracao === 'mensal' && resumo.minMes > limiteMensalMin) {
        novo({
          ...base, nivel: 'vermelho', iso: diaParaIso(diaIni), isos: [], data: 'Mês inteiro', turno: '—',
          regra: 'Média semanal do mês acima do limite',
          motivo: `${fmtHoras(resumo.minMes)} no mês; o limite proporcional ao mês é ${fmtHoras(limiteMensalMin)}.`,
          sugestao: `Reduza ${fmtHoras(resumo.minMes - limiteMensalMin)} ao longo do mês.`,
          fonte: `${FONTES.EC141}; ${FONTES.PORTARIA}`, conferir: true,
        });
      }

      // Dias do mês com escala lançada em que o colaborador ativo ficou sem turno e sem folga
      // (desligado quando a configuração considera o dia sem marcação como folga)
      if (c.ativo && !cfg.diaSemTurnoEhFolga) {
        for (const d of diasComDadosMes) {
          if (!diasTrab.has(d) && !folgasMarcadas.has(d)) {
            agrupar(`indef|${c.id}`, {
              ...base, nivel: 'amarelo', regra: 'Dia sem turno e sem folga definidos',
              motivo: 'Nestes dias a escala já foi iniciada, mas o colaborador não tem turno nem folga marcada.',
              sugestao: 'Defina um turno ou marque folga, para que a distribuição de descansos fique explícita.',
              fonte: FONTES.OPERACIONAL,
            }, diaParaIso(d));
          }
        }
      }

      /* ---- (f) Domingos: revezamento e preferência ---- */
      let seqDom = 0;
      for (let s = ini; s <= diaFim; s++) {
        if (diaSemana(s) !== 0) continue;
        if (!conhecido(s)) { seqDom = 0; continue; }
        if (!diasTrab.has(s)) { seqDom = 0; if (noMes(s)) resumo.domingosFolga++; continue; }
        seqDom++;
        if (noMes(s)) resumo.domingosTrab++;
        const iso = diaParaIso(s);
        const r = regraVigente(cfg, iso);
        if (r.domingoSemanas && seqDom === Number(r.domingoSemanas) && noMes(s)) {
          novo({
            ...base, nivel: 'vermelho', iso, data: fmtData(iso), turno: (porDia.get(s) || []).map((i) => i.turno.nome).join(' + ') || '—',
            regra: 'Descumprimento da regra de revezamento dominical',
            motivo: `${seqDom} domingos seguidos com trabalho (até ${fmtDataCurta(iso)}). A regra configurada exige que o repouso coincida com o domingo pelo menos 1 vez a cada ${r.domingoSemanas} semanas.`,
            sugestao: `Programe folga no domingo ${fmtDataCurta(iso)} ou ajuste os domingos anteriores.`,
            fonte: FONTES.PORTARIA, conferir: true,
          });
        }
        if (c.sexo === 'F' && cfg.regraMulheresArt386 && seqDom === 2 && noMes(s)) {
          novo({
            ...base, nivel: 'vermelho', iso, data: fmtData(iso), turno: (porDia.get(s) || []).map((i) => i.turno.nome).join(' + ') || '—',
            regra: 'Revezamento quinzenal aos domingos (colaboradora)',
            motivo: `A colaboradora trabalhou em 2 domingos seguidos (${fmtDataCurta(diaParaIso(s - 7))} e ${fmtDataCurta(iso)}). Havendo trabalho aos domingos, a escala deve ser de revezamento quinzenal, favorecendo o repouso dominical.`,
            sugestao: `Marque folga em um dos domingos (${fmtDataCurta(diaParaIso(s - 7))} ou ${fmtDataCurta(iso)}). Uma preferência operacional não substitui esta obrigação.`,
            fonte: `${FONTES.CLT386}; ${FONTES.PORTARIA}`, conferir: true,
          });
        }
      }
      if (itensMes.length && resumo.domingosTrab > 0 && resumo.domingosFolga === 0) {
        novo({
          ...base, nivel: 'amarelo', iso: diaParaIso(diaIni), isos: [], data: 'Mês inteiro', turno: '—',
          regra: 'Ausência de folga aos domingos no mês',
          motivo: `Trabalhou em ${resumo.domingosTrab} domingo(s) e não teve nenhum domingo livre no mês. Um dos repousos deve ser, preferencialmente, aos domingos.`,
          sugestao: 'Escolha ao menos um domingo de folga para este colaborador, alternando com os colegas.',
          fonte: FONTES.EC141,
        });
      }

      /* ---- (g) Trabalho noturno (avaliar enquadramento rural) ---- */
      const ns = hhmmParaMin(cfg.noturno.inicio);
      const durN = ((hhmmParaMin(cfg.noturno.fim) - ns) + 1440) % 1440 || 1440;
      const isosNoite = [];
      for (const it of itensMes) {
        let m = 0;
        for (let dd = it.dia - 1; dd <= it.dia + 1; dd++) {
          const a = dd * 1440 + ns;
          m += Math.max(0, Math.min(a + durN, it.fim) - Math.max(a, it.inicio));
        }
        if (m > 0) { resumo.noturnoMin += m; isosNoite.push(it.iso); }
      }
      if (resumo.noturnoMin > 0) {
        novo({
          ...base, nivel: 'amarelo', iso: isosNoite[0], isos: isosNoite, data: listaDatas(isosNoite),
          turno: [...new Set(itensMes.filter((i) => isosNoite.includes(i.iso)).map((i) => i.turno.nome))].join(', '),
          regra: 'Trabalho noturno — avaliar adicional',
          motivo: `${fmtHoras(resumo.noturnoMin)} no mês dentro do período noturno configurado (${cfg.noturno.inicio} às ${cfg.noturno.fim}). Para o trabalhador rural, a Lei 5.889/1973 define o noturno como 21h–5h na lavoura e 20h–4h na pecuária, com adicional de 25%; a lei rural não prevê a hora noturna reduzida da CLT urbana.`,
          sugestao: 'Verifique o enquadramento (lavoura ou pecuária), o pagamento do adicional noturno e eventuais cláusulas do instrumento coletivo.',
          fonte: FONTES.RURAL_ART7, conferir: true,
        });
      }

      /* ---- (h) Coerência com equipe, turno e atividade ---- */
      for (const it of itensMes) {
        const eq = c.equipeId ? equipes.get(c.equipeId) : null;
        if (eq && !(eq.turnos || []).includes(it.turno.id)) {
          agrupar(`eqturno|${c.id}|${it.turno.id}`, {
            ...base, nivel: 'amarelo', turno: it.turno.nome, regra: 'Turno não habilitado para a equipe',
            motivo: `O grupo "${eq.nome}" não está habilitado para o turno ${it.turno.nome}.`,
            sugestao: 'Habilite o turno para o grupo (tela Equipes) ou escale outro colaborador.',
            fonte: FONTES.OPERACIONAL,
          }, it.iso);
        }
        if (it.atividade && !(it.turno.atividades || []).includes(it.atividade)) {
          agrupar(`ativturno|${c.id}|${it.turno.id}|${it.atividade}`, {
            ...base, nivel: 'amarelo', turno: it.turno.nome, regra: 'Atividade não atendida pelo turno',
            motivo: `Escalado para ${nomeAtiv(it.atividade)}, mas o turno ${it.turno.nome} não está configurado para essa atividade.`,
            sugestao: 'Ajuste as atividades atendidas pelo turno (tela Turnos) ou altere a atividade na escala.',
            fonte: FONTES.OPERACIONAL,
          }, it.iso);
        }
        if (it.atividade && it.atividade !== c.atividade && !(c.substitutoEm || []).includes(it.atividade)) {
          agrupar(`ativcad|${c.id}|${it.atividade}`, {
            ...base, nivel: 'amarelo', turno: it.turno.nome, regra: 'Atividade diferente da cadastrada',
            motivo: `Escalado para ${nomeAtiv(it.atividade)}, mas o cadastro indica ${nomeAtiv(c.atividade)} e não o registra como substituto dessa atividade.`,
            sugestao: 'Confirme a função exercida ou registre o colaborador como substituto no cadastro.',
            fonte: FONTES.OPERACIONAL,
          }, it.iso);
        }
      }
    }

    /* ======================= ANÁLISES GERAIS DO MÊS ======================= */
    const ativos = estado.colaboradores.filter((c) => c.ativo);
    const ocupacaoNoDia = (cid, d, t) => {
      const a = d * 1440 + hhmmParaMin(t.inicio);
      const b = a + duracaoTurno(t);
      return (itensPorColab.get(cid) || []).find((i) => i.inicio < b && a < i.fim);
    };
    const habilitado = (c, t) => {
      const eq = c.equipeId ? equipes.get(c.equipeId) : null;
      return !eq || (eq.turnos || []).includes(t.id);
    };

    for (const d of diasComDadosMes) {
      const iso = diaParaIso(d);
      const dia = estado.escala[iso] || { t: {}, f: [] };
      const emFolga = new Set(dia.f || []);

      // Cobertura mínima de cada turno
      for (const t of estado.turnos) {
        const n = (dia.t?.[t.id] || []).length;
        const min = Number(t.minimo) || 0;
        if (n < min) {
          const disp = ativos.filter((c) => habilitado(c, t) && !emFolga.has(c.id) && !ocupacaoNoDia(c.id, d, t)).map((c) => c.nome);
          novo({
            nivel: 'amarelo', iso, data: fmtData(iso), turno: t.nome,
            regra: 'Cobertura do turno abaixo do mínimo',
            motivo: `${n} de ${min} colaborador(es) mínimo(s) escalado(s) no turno ${t.nome} (${t.inicio}–${t.fim}).`,
            sugestao: disp.length
              ? `Colaboradores habilitados e sem conflito de horário: ${disp.slice(0, 6).join(', ')}${disp.length > 6 ? '…' : ''}. Se algum deles estiver de folga neste dia, confira o descanso semanal antes de escalá-lo.`
              : 'Nenhum colaborador habilitado está livre neste horário; avalie remanejar folgas ou habilitar outro grupo.',
            fonte: FONTES.OPERACIONAL,
          });
        }
      }

      // Cobertura de atividades (camas, alimentação...)
      for (const a of cfg.atividades) {
        const min = Number(a.coberturaMinDia) || 0;
        if (!min) continue;
        const pessoas = new Set();
        for (const lista of Object.values(dia.t || {})) for (const e of lista) if (e.a === a.id) pessoas.add(e.c);
        if (pessoas.size < min) {
          const candidatos = ativos.filter((c) => c.atividade === a.id || (c.substitutoEm || []).includes(a.id));
          const desc = candidatos.map((c) => {
            const papel = c.atividade === a.id ? 'responsável' : 'substituto';
            let st = cfg.diaSemTurnoEhFolga ? 'de folga' : 'sem turno neste dia';
            if (emFolga.has(c.id)) st = 'de folga';
            else {
              const tur = Object.entries(dia.t || {}).filter(([, l]) => l.some((e) => e.c === c.id)).map(([tid]) => turnos.get(tid)?.nome);
              if (tur.length) st = `escalado em ${tur.join(', ')} em outra atividade`;
            }
            return `${c.nome} (${papel}, ${st})`;
          });
          novo({
            nivel: 'amarelo', iso, data: fmtData(iso), turno: '—',
            regra: `Cobertura de ${a.nome} insuficiente`,
            motivo: `${pessoas.size} de ${min} pessoa(s) escalada(s) para ${a.nome} neste dia.`,
            sugestao: desc.length
              ? `Escale o responsável ou o substituto, sem colocá-lo em dois trabalhos ao mesmo tempo: ${desc.join('; ')}.`
              : `Cadastre um responsável e um substituto para ${a.nome} (tela Colaboradores).`,
            fonte: FONTES.OPERACIONAL,
          });
        }
      }

      // Concentração de folgas no mesmo dia
      const escaladosDia = new Set(Object.values(dia.t || {}).flat().map((e) => e.c));
      const folgasAtivos = cfg.diaSemTurnoEhFolga
        ? ativos.filter((c) => !escaladosDia.has(c.id)).map((c) => c.id)
        : [...emFolga].filter((id) => ativos.some((c) => c.id === id));
      if (ativos.length >= 4 && folgasAtivos.length > ativos.length / 2) {
        novo({
          nivel: 'amarelo', iso, data: fmtData(iso), turno: '—',
          regra: 'Distribuição de folgas pouco equilibrada',
          motivo: `${folgasAtivos.length} de ${ativos.length} colaboradores ativos estão de folga neste dia.`,
          sugestao: 'Avalie distribuir parte dessas folgas em outros dias da semana para não comprometer a cobertura.',
          fonte: FONTES.OPERACIONAL,
        });
      }
    }

    // Turnos com 4h–6h de trabalho sem intervalo cadastrado (aplicação subsidiária da CLT ao rural)
    for (const t of estado.turnos) {
      const usado = [...itensPorColab.values()].some((l) => l.some((i) => i.turno.id === t.id && noMes(i.dia)));
      if (!usado) continue;
      const trab = duracaoTurno(t) - (Number(t.intervaloMin) || 0);
      if (trab > 240 && trab <= 360 && (Number(t.intervaloMin) || 0) < Number(cfg.intrajornada.de4a6hMin)) {
        novo({
          nivel: 'amarelo', iso: null, data: 'Todo o mês', turno: t.nome, colaborador: 'Todos os escalados no turno',
          regra: 'Intervalo intrajornada a conferir (jornada entre 4h e 6h)',
          motivo: `O turno ${t.nome} tem ${fmtHoras(trab)} de trabalho contínuo e ${Number(t.intervaloMin) || 0} min de intervalo cadastrado. A Lei 5.889/1973 exige intervalo para trabalho contínuo acima de 6h; o intervalo de 15 min da CLT (art. 71, §1º) para jornadas entre 4h e 6h pode ser aplicado de forma subsidiária.`,
          sugestao: 'Se houver pausa dentro do turno, cadastre-a em Turnos (campo "Intervalo"). Confirme a regra aplicável no instrumento coletivo.',
          fonte: `${FONTES.RURAL_ART5}; ${FONTES.CLT71}`, conferir: true,
        });
      }
    }

    // Equipes
    for (const e of estado.equipes) {
      const membros = estado.colaboradores.filter((c) => c.equipeId === e.id);
      const ativGrupo = atividades.get(e.atividade || 'ordenha');
      if (membros.length === 1 && !(ativGrupo && ativGrupo.grupoUnitario)) {
        novo({
          nivel: 'vermelho', iso: null, data: '—', turno: '—', colaborador: membros[0].nome,
          regra: 'Grupo com apenas 1 integrante',
          motivo: `O grupo "${e.nome}" (${nomeAtiv(e.atividade || 'ordenha')}) está com um único integrante. Apenas grupos de atividades individuais (ex.: Camas dos animais) podem ter 1 integrante.`,
          sugestao: 'Adicione pelo menos mais um integrante, transfira este colaborador para outro grupo ou, se for uma função individual, altere a atividade do grupo (tela Equipes).',
          fonte: FONTES.OPERACIONAL,
        });
      } else if (membros.length === 0) {
        novo({
          nivel: 'amarelo', iso: null, data: '—', turno: '—',
          regra: 'Grupo sem integrantes',
          motivo: `O grupo "${e.nome}" não possui integrantes.`,
          sugestao: 'Adicione ao menos 2 integrantes ou exclua o grupo.',
          fonte: FONTES.OPERACIONAL,
        });
      }
    }

    // Responsável por atividades com cobertura obrigatória
    for (const a of cfg.atividades) {
      if (!(Number(a.coberturaMinDia) > 0)) continue;
      if (!ativos.some((c) => c.atividade === a.id)) {
        novo({
          nivel: 'amarelo', iso: null, data: '—', turno: '—',
          regra: `Responsável por ${a.nome} não identificado`,
          motivo: `Nenhum colaborador ativo está cadastrado com a atividade "${a.nome}".`,
          sugestao: 'Identifique o responsável (e um substituto) no cadastro de colaboradores.',
          fonte: FONTES.OPERACIONAL,
        });
      }
    }

    // Converte os alertas agrupados
    for (const a of agrupados.values()) {
      a.isos.sort();
      novo(Object.assign(a, { iso: a.isos[0] || null, data: a.isos.length ? listaDatas(a.isos) : '—' }));
    }

    const ordemNivel = { vermelho: 0, amarelo: 1 };
    alertas.sort((a, b) => (ordemNivel[a.nivel] - ordemNivel[b.nivel])
      || String(a.iso || '9').localeCompare(String(b.iso || '9'))
      || a.colaborador.localeCompare(b.colaborador));

    return { alertas, resumoColab, semanas, limiteMensalMin };
  }

  return { AVISO_CONFERENCIA, FONTES, LINKS, configPadrao, regraVigente, regrasDoMes, validar };
})();

/* ==========================================================================
   3. ARMAZENAMENTO (LocalStorage)
   - Salvamento automático a cada alteração.
   - Pontos de restauração (até 8): criados manualmente e antes de operações
     em massa (copiar semana, limpar mês, importar, carregar exemplos).
   ========================================================================== */
const Store = (() => {
  const CHAVE = 'escala5x2.dados.v1';
  const CHAVE_PONTOS = 'escala5x2.pontos.v1';
  const MAX_PONTOS = 8;
  let estado = null;

  function turnosIniciais() {
    // Horários definidos pela propriedade. Mínimo e atividades são ajustáveis em "Turnos".
    const todas = ['ordenha', 'camas', 'alimentacao', 'outra'];
    return [
      { id: 't_matutino', nome: 'Matutino', sigla: 'M', inicio: '05:00', fim: '10:30', intervaloMin: 0, minimo: 2, atividades: [...todas], cor: '#2F7FC1' },
      { id: 't_vespertino', nome: 'Vespertino', sigla: 'V', inicio: '13:00', fim: '18:30', intervaloMin: 0, minimo: 2, atividades: [...todas], cor: '#C46F1C' },
      { id: 't_noturno', nome: 'Noturno', sigla: 'N', inicio: '21:00', fim: '02:00', intervaloMin: 0, minimo: 2, atividades: [...todas], cor: '#5B4BA8' },
    ];
  }

  function vazio() {
    return {
      versao: 1, config: RegrasTrabalhistas.configPadrao(),
      colaboradores: [], equipes: [], turnos: turnosIniciais(), escala: {}, salvoEm: null,
    };
  }

  /** Garante que dados antigos/importados tenham todos os campos esperados */
  function normalizar(d) {
    const pad = RegrasTrabalhistas.configPadrao();
    const e = Object.assign(vazio(), d || {});
    e.config = Object.assign({}, pad, e.config || {});
    e.config.intrajornada = Object.assign({}, pad.intrajornada, e.config.intrajornada || {});
    e.config.noturno = Object.assign({}, pad.noturno, e.config.noturno || {});
    if (!Array.isArray(e.config.vigencias) || !e.config.vigencias.length) e.config.vigencias = pad.vigencias;
    if (!Array.isArray(e.config.atividades) || !e.config.atividades.length) e.config.atividades = pad.atividades;
    e.colaboradores = (e.colaboradores || []).map((c) => Object.assign({
      nome: '', sexo: 'M', funcao: '', equipeId: '', atividade: 'ordenha', substitutoEm: [], turnoPadrao: '', admissao: '', ativo: true, exemplo: false,
    }, c));
    e.equipes = (e.equipes || []).map((q) => Object.assign({ nome: 'Grupo', turnos: [], atividade: 'ordenha', turnoFixo: '', exemplo: false }, q));
    for (const a of e.config.atividades) if (a.grupoUnitario === undefined) a.grupoUnitario = a.id === 'camas';
    e.turnos = (e.turnos || []).map((t) => Object.assign({ sigla: (t.nome || 'T').charAt(0), intervaloMin: 0, minimo: 1, atividades: [], cor: '#2F7FC1' }, t));
    e.escala = e.escala || {};
    for (const dia of Object.values(e.escala)) { dia.t = dia.t || {}; dia.f = dia.f || []; }
    return e;
  }

  function carregar() {
    try {
      const raw = localStorage.getItem(CHAVE);
      estado = raw ? normalizar(JSON.parse(raw)) : null;
    } catch (err) {
      console.error('Falha ao ler o LocalStorage', err);
      estado = null;
    }
    return estado;
  }

  function salvar() {
    estado.salvoEm = new Date().toISOString();
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
      return true;
    } catch (err) {
      console.error('Falha ao salvar no LocalStorage', err);
      return false;
    }
  }

  function listarPontos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_PONTOS) || '[]'); } catch { return []; }
  }

  function criarPonto(motivo) {
    const pontos = listarPontos();
    pontos.unshift({ em: new Date().toISOString(), motivo, dados: estado });
    while (pontos.length > MAX_PONTOS) pontos.pop();
    try { localStorage.setItem(CHAVE_PONTOS, JSON.stringify(pontos)); return true; } catch { return false; }
  }

  function restaurarPonto(indice) {
    const p = listarPontos()[indice];
    if (!p) return false;
    estado = normalizar(p.dados);
    salvar();
    return true;
  }

  function substituir(novo) { estado = normalizar(novo); salvar(); }
  function reiniciar() { estado = vazio(); salvar(); }

  return {
    get estado() { return estado; },
    carregar, salvar, criarPonto, listarPontos, restaurarPonto, substituir, reiniciar, vazio, normalizar,
  };
})();

/* ==========================================================================
   4. DADOS DE EXEMPLO (demonstração)
   Nomes iniciados por "Exemplo" e marcados com exemplo:true. A semana de exemplo
   é a primeira semana completa sob a nova regra (a partir de 16/12/2026) e
   contém situações propositais para demonstrar os alertas.
   ========================================================================== */
const DadosExemplo = (() => {
  function semanaExemplo(cfg) {
    const { isoParaDia, hojeIso, inicioSemana } = Util;
    const ref = Math.max(isoParaDia(hojeIso()), isoParaDia('2026-12-16'));
    let ws = inicioSemana(ref, cfg.inicioSemana);
    if (ws < ref) ws += 7;
    return ws;
  }

  function carregar(estado) {
    const { diaParaIso, diaSemana } = Util;
    const turnos = estado.turnos.map((t) => t.id);
    const idT = (nome) => (estado.turnos.find((t) => t.nome === nome) || {}).id;
    const M = idT('Matutino'); const V = idT('Vespertino'); const N = idT('Noturno');

    const eqA = { id: 'eq_ex_a', nome: 'Grupo 1 (exemplo)', turnos: [...turnos], turnoFixo: M, exemplo: true };
    const eqB = { id: 'eq_ex_b', nome: 'Grupo 2 (exemplo)', turnos: [...turnos], turnoFixo: V, exemplo: true };
    const eqC = { id: 'eq_ex_c', nome: 'Grupo 3 (exemplo)', turnos: [...turnos], turnoFixo: N, exemplo: true };
    const eqCam = { id: 'eq_ex_cam', nome: 'Camas (exemplo)', atividade: 'camas', turnos: [...turnos], turnoFixo: M, exemplo: true };
    eqA.atividade = 'ordenha'; eqB.atividade = 'ordenha'; eqC.atividade = 'ordenha';
    estado.equipes.push(eqA, eqB, eqC, eqCam);

    const col = (id, nome, sexo, equipeId, atividade, funcao, substitutoEm = []) => ({
      id, nome, sexo, equipeId, atividade, funcao, substitutoEm, admissao: '', ativo: true, exemplo: true,
    });
    const lista = [
      col('c_ex_a1', 'Exemplo Ordenha A1', 'M', eqA.id, 'ordenha', 'Ordenhador'),
      col('c_ex_a2', 'Exemplo Ordenha A2', 'F', eqA.id, 'ordenha', 'Ordenhadora'),
      col('c_ex_a3', 'Exemplo Ordenha A3', 'M', eqA.id, 'ordenha', 'Ordenhador'),
      col('c_ex_b1', 'Exemplo Ordenha B1', 'F', eqB.id, 'ordenha', 'Ordenhadora'),
      col('c_ex_b2', 'Exemplo Ordenha B2', 'M', eqB.id, 'ordenha', 'Ordenhador', ['camas']),
      col('c_ex_b3', 'Exemplo Ordenha B3', 'M', eqB.id, 'ordenha', 'Ordenhador'),
      col('c_ex_c1', 'Exemplo Ordenha C1', 'F', eqC.id, 'ordenha', 'Ordenhadora'),
      col('c_ex_c2', 'Exemplo Ordenha C2', 'M', eqC.id, 'ordenha', 'Ordenhador'),
      col('c_ex_c3', 'Exemplo Ordenha C3', 'M', eqC.id, 'ordenha', 'Ordenhador'),
      col('c_ex_cam', 'Exemplo Camas (responsável)', 'M', 'eq_ex_cam', 'camas', 'Responsável pelas camas'),
      col('c_ex_al1', 'Exemplo Alimentação 1', 'M', '', 'alimentacao', 'Tratador'),
      col('c_ex_al2', 'Exemplo Alimentação 2', 'F', '', 'alimentacao', 'Tratadora'),
      col('c_ex_al3', 'Exemplo Alimentação 3', 'M', '', 'alimentacao', 'Tratador'),
    ];
    // Funções sem grupo de ordenha: turno pré-definido no próprio cadastro
    const tpad = { c_ex_al1: M, c_ex_al2: M, c_ex_al3: V };
    lista.forEach((c) => { c.turnoPadrao = tpad[c.id] || ''; });
    estado.colaboradores.push(...lista);

    // Escala da semana de exemplo: [colaborador, turno, atividade, dias de folga (0=dom..6=sáb)]
    const plano = [
      ['c_ex_a1', M, 'ordenha', [0, 1]], ['c_ex_a2', M, 'ordenha', [3, 4]], ['c_ex_a3', M, 'ordenha', [5, 6]],
      ['c_ex_b1', V, 'ordenha', [0, 2]], ['c_ex_b2', V, 'ordenha', [4, 5]], ['c_ex_b3', V, 'ordenha', [6, 1]],
      ['c_ex_c1', N, 'ordenha', [0, 3]], ['c_ex_c2', N, 'ordenha', [1, 2]], ['c_ex_c3', N, 'ordenha', [4, 6]],
      ['c_ex_cam', M, 'camas', [6, 0]],
      ['c_ex_al1', M, 'alimentacao', [6, 0]], ['c_ex_al2', M, 'alimentacao', [1, 2]], ['c_ex_al3', V, 'alimentacao', [3, 4]],
    ];
    const ws = semanaExemplo(estado.config);
    const put = (iso, tid, c, a) => {
      const d = estado.escala[iso] || (estado.escala[iso] = { t: {}, f: [] });
      (d.t[tid] = d.t[tid] || []).push({ c, a });
    };
    for (let o = 0; o < 7; o++) {
      const dia = ws + o; const iso = diaParaIso(dia); const dsem = diaSemana(dia);
      for (const [c, tid, a, folgas] of plano) {
        if (folgas.includes(dsem)) continue; // dia sem marcação = folga
        // Situação proposital 1: C2 faz Matutino na quinta, logo após o Noturno de quarta (intervalo de 3h)
        if (c === 'c_ex_c2' && dsem === 4) { put(iso, M, c, 'ordenha'); continue; }
        put(iso, tid, c, a);
      }
    }
    // B2 trabalha sábado (camas, matutino) e domingo (vespertino); folga qui/sex.
    const isoDe = (dsem) => diaParaIso(ws + ((dsem - Util.diaSemana(ws) + 7) % 7));
    const sab = isoDe(6);
    const dSab = estado.escala[sab];
    dSab.t[V] = dSab.t[V].filter((e) => e.c !== 'c_ex_b2');
    put(sab, M, 'c_ex_b2', 'camas');
    // Situação proposital 2: B2 também no Noturno de quarta (dois turnos no mesmo dia → 10h30)
    put(isoDe(3), N, 'c_ex_b2', 'ordenha');
    return ws;
  }

  function remover(estado) {
    const ids = new Set(estado.colaboradores.filter((c) => c.exemplo).map((c) => c.id));
    estado.colaboradores = estado.colaboradores.filter((c) => !c.exemplo);
    estado.equipes = estado.equipes.filter((e) => !e.exemplo);
    const eqIds = new Set(estado.equipes.map((e) => e.id));
    for (const c of estado.colaboradores) if (c.equipeId && !eqIds.has(c.equipeId)) c.equipeId = '';
    for (const [iso, d] of Object.entries(estado.escala)) {
      for (const k of Object.keys(d.t)) { d.t[k] = d.t[k].filter((e) => !ids.has(e.c)); if (!d.t[k].length) delete d.t[k]; }
      d.f = d.f.filter((c) => !ids.has(c));
      if (!Object.keys(d.t).length && !d.f.length) delete estado.escala[iso];
    }
  }

  const existe = (estado) => estado.colaboradores.some((c) => c.exemplo) || estado.equipes.some((e) => e.exemplo);

  return { carregar, remover, existe, semanaExemplo };
})();

/* ==========================================================================
   4b. SUGESTÃO DE ESCALA (ajuda opcional ao preenchimento)
   --------------------------------------------------------------------------
   Gera uma PROPOSTA — nada é gravado até o usuário confirmar. Regras usadas:
   - cada pessoa trabalha no turno pré-definido (turno fixo do grupo ou do cadastro);
   - grupos de ordenha: exatamente N pessoas de folga por dia (padrão 3),
     distribuídas entre os grupos (com 3 grupos: 1 folga por grupo);
   - funções fora dos grupos (camas, alimentação): folgas escalonadas,
     preservando a cobertura mínima da atividade sempre que possível;
   - prioridade às regras legais: repousos semanais exigidos pela vigência,
     máximo de dias consecutivos, 11h entre jornadas, revezamento dominical e
     revezamento quinzenal das colaboradoras (CLT, art. 386). Quando a regra
     legal exige, a pessoa folga mesmo que isso ultrapasse N no dia (é informado).
   - preferência por folgas seguidas e rodízio justo de domingos.
   ========================================================================== */
const SugestaoEscala = (() => {
  const { diaParaIso, diaSemana, hhmmParaMin, duracaoTurno, inicioSemana } = Util;

  function turnoPadrao(estado, c) {
    const existe = (id) => estado.turnos.some((t) => t.id === id);
    if (c.turnoPadrao && existe(c.turnoPadrao)) return c.turnoPadrao;
    const eq = estado.equipes.find((e) => e.id === c.equipeId);
    return eq && eq.turnoFixo && existe(eq.turnoFixo) ? eq.turnoFixo : '';
  }

  function gerar(estado, d0, d1, opcoes) {
    const cfg = estado.config;
    const N = Math.max(0, Number(opcoes.folgasPorDia) || 0);
    const INTER = Number(cfg.interjornadaH) * 60;
    const MAX = Number(cfg.maxDiasConsecutivos) || 6;
    const turnos = new Map(estado.turnos.map((t) => [t.id, t]));
    const turnosDe = (iso, cid) => Object.entries(estado.escala[iso]?.t || {})
      .filter(([tid, l]) => turnos.has(tid) && l.some((e) => e.c === cid)).map(([tid]) => turnos.get(tid));
    const ativos = estado.colaboradores.filter((c) => c.ativo);
    const semTurno = ativos.filter((c) => !turnoPadrao(estado, c));

    const gruposOrd = estado.equipes
      .filter((e) => (e.atividade || 'ordenha') === 'ordenha')
      .map((e) => ({ tipo: 'grupo', nome: e.nome, membros: ativos.filter((c) => c.equipeId === e.id && turnoPadrao(estado, c)) }))
      .filter((g) => g.membros.length);
    const idsGrupo = new Set(gruposOrd.flatMap((g) => g.membros.map((c) => c.id)));
    const funcoes = [];
    if (opcoes.incluirFuncoes) {
      const porAtiv = new Map();
      for (const c of ativos) {
        if (idsGrupo.has(c.id) || !turnoPadrao(estado, c)) continue;
        if (!porAtiv.has(c.atividade)) porAtiv.set(c.atividade, []);
        porAtiv.get(c.atividade).push(c);
      }
      for (const [a, m] of porAtiv) {
        const at = cfg.atividades.find((x) => x.id === a);
        funcoes.push({ tipo: 'funcao', nome: at?.nome || a, membros: m, cobertura: Number(at?.coberturaMinDia) || 0 });
      }
    }
    const pools = [...gruposOrd, ...funcoes];

    // Situação de cada pessoa antes do período (escala já lançada)
    const st = new Map();
    const ws0 = inicioSemana(d0, cfg.inicioSemana);
    for (const p of pools) {
      p.membros.forEach((c, idx) => {
        let streak = 0;
        for (let d = d0 - 1; d >= d0 - 30; d--) {
          const iso = diaParaIso(d);
          if (!estado.escala[iso] || !turnosDe(iso, c.id).length) break;
          streak++;
        }
        let lastEnd = -Infinity;
        for (let d = d0 - 2; d <= d0 - 1; d++) {
          for (const t of turnosDe(diaParaIso(d), c.id)) lastEnd = Math.max(lastEnd, d * 1440 + hhmmParaMin(t.inicio) + duracaoTurno(t));
        }
        let domStreak = 0;
        for (let x = d0 - 1; x >= d0 - 56; x--) {
          if (diaSemana(x) !== 0) continue;
          const iso = diaParaIso(x);
          if (!estado.escala[iso] || !turnosDe(iso, c.id).length) break;
          domStreak++;
        }
        let offsWeek = 0; let unknownWeek = 0;
        for (let d = ws0; d < d0; d++) {
          const iso = diaParaIso(d);
          if (!estado.escala[iso]) unknownWeek++;
          else if (!turnosDe(iso, c.id).length) offsWeek++;
        }
        const isoAnt = diaParaIso(d0 - 1);
        st.set(c.id, {
          idx, streak, lastEnd, domStreak, offsWeek, unknownWeek, offsTotal: 0, domOffs: 0,
          offYesterday: !!estado.escala[isoAnt] && !turnosDe(isoAnt, c.id).length,
        });
      });
    }

    const plano = new Map();
    const excedentes = [];
    const folgasPorDia = [];
    const totalOrd = gruposOrd.reduce((a, g) => a + g.membros.length, 0);

    for (let d = d0; d <= d1; d++) {
      const iso = diaParaIso(d);
      const ws = inicioSemana(d, cfg.inicioSemana); const we = ws + 6;
      if (d === ws && d !== d0) for (const s of st.values()) { s.offsWeek = 0; s.unknownWeek = 0; }
      const regraSem = RegrasTrabalhistas.regraVigente(cfg, diaParaIso(we));
      const regraDia = RegrasTrabalhistas.regraVigente(cfg, iso);
      const diasRest = Math.min(we, d1) - d + 1;
      const diasDepois = Math.max(0, we - d1);
      const domingo = diaSemana(d) === 0;

      // Distribui as N folgas do dia entre os grupos de ordenha (proporcional, com rodízio do resto)
      const alvo = new Map();
      if (gruposOrd.length && totalOrd) {
        const base = gruposOrd.map((g) => Math.floor(N * g.membros.length / totalOrd));
        let resto = Math.min(N, totalOrd) - base.reduce((a, b) => a + b, 0);
        for (let k = 0; k < gruposOrd.length * 2 && resto > 0; k++) {
          const gi = (d + k) % gruposOrd.length;
          if (base[gi] < gruposOrd[gi].membros.length) { base[gi]++; resto--; }
        }
        gruposOrd.forEach((g, i) => alvo.set(g, Math.min(base[i], g.membros.length)));
      }

      let folgasOrdDia = 0;
      for (const p of pools) {
        const info = p.membros.map((c) => {
          const s = st.get(c.id);
          const t = turnos.get(turnoPadrao(estado, c));
          const ini = d * 1440 + hhmmParaMin(t.inicio);
          const need = Math.max(0, regraSem.dsr - s.offsWeek - s.unknownWeek - diasDepois);
          let motivo = null;
          if (need > 0 && need >= diasRest) motivo = 'garantir os repousos semanais';
          else if (s.streak >= MAX) motivo = `não passar de ${MAX} dias seguidos`;
          else if (ini - s.lastEnd < INTER) motivo = 'respeitar 11h entre jornadas';
          else if (domingo && Number(regraDia.domingoSemanas) > 0 && s.domStreak >= Number(regraDia.domingoSemanas) - 1) motivo = 'revezamento dominical';
          else if (domingo && c.sexo === 'F' && cfg.regraMulheresArt386 && s.domStreak >= 1) motivo = 'revezamento quinzenal aos domingos (art. 386)';
          let score = s.offsWeek * 10;
          if (s.offYesterday && s.offsWeek < regraSem.dsr) score -= 12;   // prefere folgas seguidas
          if (need === 0) score += 20;                                      // já tem os repousos da semana
          score -= s.streak * 0.3;
          score += s.offsTotal * 0.2;
          if (domingo) score += s.domOffs * 2 - s.domStreak * 3;            // rodízio de domingos
          score += ((s.idx + Math.floor((d - d0) / 7)) % p.membros.length) * 0.01;
          return { c, s, t, ini, need, motivo, score };
        });
        const k = p.tipo === 'grupo'
          ? alvo.get(p)
          : Math.max(0, Math.min(p.membros.length - p.cobertura, Math.ceil(info.reduce((a, x) => a + x.need, 0) / diasRest)));
        const forcados = info.filter((x) => x.motivo);
        const folga = new Set(forcados.map((x) => x.c.id));
        for (const x of info.filter((y) => !y.motivo).sort((a, b) => a.score - b.score)) {
          if (folga.size >= k) break;
          folga.add(x.c.id);
        }
        if (p.tipo === 'grupo' && folga.size > k) {
          excedentes.push({ iso, grupo: p.nome, extra: folga.size - k, motivos: forcados.map((x) => `${x.c.nome} — ${x.motivo}`) });
        }
        for (const x of info) {
          if (!plano.has(x.c.id)) plano.set(x.c.id, new Map());
          if (folga.has(x.c.id)) {
            plano.get(x.c.id).set(d, null);
            x.s.streak = 0; x.s.offsWeek++; x.s.offsTotal++; x.s.offYesterday = true;
            if (domingo) { x.s.domStreak = 0; x.s.domOffs++; }
            if (p.tipo === 'grupo') folgasOrdDia++;
          } else {
            plano.get(x.c.id).set(d, x.t.id);
            x.s.streak++; x.s.lastEnd = x.ini + duracaoTurno(x.t); x.s.offYesterday = false;
            if (domingo) x.s.domStreak++;
          }
        }
      }
      folgasPorDia.push({ iso, n: folgasOrdDia });
    }
    return { plano, gruposOrd, funcoes, semTurno, excedentes, folgasPorDia, N, d0, d1 };
  }

  /** Grava a proposta no estado informado (substitui turnos/folgas dessas pessoas no período) */
  function aplicar(estado, r) {
    const marcarFolga = !estado.config.diaSemTurnoEhFolga;
    for (let d = r.d0; d <= r.d1; d++) {
      const iso = diaParaIso(d);
      if (!estado.escala[iso]) estado.escala[iso] = { t: {}, f: [] };
    }
    for (const [cid, dias] of r.plano) {
      const c = estado.colaboradores.find((x) => x.id === cid);
      for (const [d, tid] of dias) {
        const dia = estado.escala[diaParaIso(d)];
        for (const k of Object.keys(dia.t)) dia.t[k] = dia.t[k].filter((e) => e.c !== cid);
        dia.f = dia.f.filter((x) => x !== cid);
        if (tid) {
          const t = estado.turnos.find((x) => x.id === tid);
          const ativ = (t.atividades || []).includes(c.atividade) || !(t.atividades || []).length ? c.atividade : t.atividades[0];
          (dia.t[tid] = dia.t[tid] || []).push({ c: cid, a: ativ });
        } else if (marcarFolga) dia.f.push(cid);
      }
    }
    for (let d = r.d0; d <= r.d1; d++) {
      const dia = estado.escala[diaParaIso(d)];
      for (const k of Object.keys(dia.t)) if (!dia.t[k].length) delete dia.t[k];
    }
  }

  return { gerar, aplicar, turnoPadrao };
})();

/* ==========================================================================
   5. REGRAS DE NEGÓCIO — EQUIPES E ESCALA
   ========================================================================== */
const Equipes = (() => {
  const E = () => Store.estado;
  const membros = (eid) => E().colaboradores.filter((c) => c.equipeId === eid);
  const nome = (eid) => E().equipes.find((e) => e.id === eid)?.nome || 'Sem equipe';
  /** Grupos de atividade individual (ex.: Camas dos animais) podem ter 1 integrante */
  const permiteUm = (eid) => {
    const eq = E().equipes.find((e) => e.id === eid);
    const at = E().config.atividades.find((a) => a.id === (eq?.atividade || 'ordenha'));
    return !!(at && at.grupoUnitario);
  };
  const minimo = (eid) => (permiteUm(eid) ? 1 : 2);

  /**
   * Verifica se mover "cids" para "destino" deixaria algum grupo com 1 integrante.
   * "novos" = quantidade de colaboradores ainda não cadastrados entrando no destino.
   */
  function simular(cids, destino, novos = 0) {
    const cont = new Map(E().equipes.map((e) => [e.id, membros(e.id).length]));
    const afetadas = new Set();
    for (const cid of cids) {
      const c = E().colaboradores.find((x) => x.id === cid);
      const origem = c ? c.equipeId : '';
      if (origem === destino) continue;
      if (origem) { cont.set(origem, cont.get(origem) - 1); afetadas.add(origem); }
      if (destino) { cont.set(destino, (cont.get(destino) || 0) + 1); afetadas.add(destino); }
    }
    if (destino && novos) { cont.set(destino, (cont.get(destino) || 0) + novos); afetadas.add(destino); }
    for (const eid of afetadas) {
      if (cont.get(eid) === 1 && !permiteUm(eid)) {
        const n = nome(eid);
        const atual = membros(eid).length;
        const dica = atual === 0
          ? 'Para começar um grupo, adicione pelo menos 2 integrantes de uma vez (tela Equipes → "Adicionar integrantes").'
          : 'Adicione outro integrante ao grupo antes, ou exclua o grupo para liberar os integrantes.';
        return { ok: false, msg: `O grupo "${n}" ficaria com apenas 1 integrante, o que não é permitido. ${dica}` };
      }
    }
    return { ok: true };
  }

  function mover(cids, destino) {
    const r = simular(cids, destino);
    if (!r.ok) return r;
    for (const cid of cids) {
      const c = E().colaboradores.find((x) => x.id === cid);
      if (c) c.equipeId = destino;
    }
    return r;
  }

  return { membros, nome, simular, mover, permiteUm, minimo };
})();

const Escala = (() => {
  const { isoParaDia, diaParaIso, hhmmParaMin, duracaoTurno, fmtDataCurta } = Util;
  const E = () => Store.estado;
  const turno = (id) => E().turnos.find((t) => t.id === id);
  const nomeColab = (id) => E().colaboradores.find((c) => c.id === id)?.nome || 'Colaborador';

  function dia(iso, criar) {
    const esc = E().escala;
    if (!esc[iso] && criar) esc[iso] = { t: {}, f: [] };
    return esc[iso];
  }
  function limparVazios(iso) {
    const d = E().escala[iso];
    if (!d) return;
    for (const k of Object.keys(d.t)) if (!d.t[k].length) delete d.t[k];
    if (!Object.keys(d.t).length && !d.f.length) delete E().escala[iso];
  }
  /** Turnos de um colaborador em uma data: [{turnoId, atividade}] (na ordem dos turnos cadastrados) */
  function turnosDoColab(iso, cid) {
    const d = dia(iso);
    if (!d) return [];
    return E().turnos
      .filter((t) => (d.t[t.id] || []).some((e) => e.c === cid))
      .map((t) => ({ turnoId: t.id, atividade: d.t[t.id].find((e) => e.c === cid).a }));
  }
  const emFolga = (iso, cid) => !!dia(iso)?.f.includes(cid);
  /** Folga = marcada com "F" ou (configuração padrão) dia com escala lançada em que a pessoa não tem turno */
  const ehFolga = (iso, cid) => emFolga(iso, cid)
    || (!!E().config.diaSemTurnoEhFolga && !!E().escala[iso] && !turnosDoColab(iso, cid).length);
  /** Turno pré-definido: o do próprio colaborador (se houver) ou o turno fixo do grupo */
  function turnoPadraoDe(c) {
    if (c.turnoPadrao && turno(c.turnoPadrao)) return c.turnoPadrao;
    const eq = c.equipeId ? E().equipes.find((e) => e.id === c.equipeId) : null;
    return eq && eq.turnoFixo && turno(eq.turnoFixo) ? eq.turnoFixo : '';
  }
  function intervalo(iso, t) {
    const a = isoParaDia(iso) * 1440 + hhmmParaMin(t.inicio);
    return [a, a + duracaoTurno(t)];
  }

  /** Atribuições do colaborador (dia anterior, mesmo dia e seguinte) que se sobrepõem ao turno informado */
  function conflitos(cid, iso, turnoId, ignorarMesmoDia = false) {
    const t = turno(turnoId);
    if (!t) return [];
    const [a, b] = intervalo(iso, t);
    const d = isoParaDia(iso);
    const res = [];
    for (let x = d - 1; x <= d + 1; x++) {
      if (ignorarMesmoDia && x === d) continue;
      const isoX = diaParaIso(x);
      for (const it of turnosDoColab(isoX, cid)) {
        if (x === d && it.turnoId === turnoId) continue;
        const t2 = turno(it.turnoId);
        const [c2, d2] = intervalo(isoX, t2);
        if (a < d2 && c2 < b) res.push({ iso: isoX, turno: t2 });
      }
    }
    return res;
  }
  const msgConflito = (cid, cf) => `${nomeColab(cid)} já está no turno ${cf.turno.nome} de ${fmtDataCurta(cf.iso)} (${cf.turno.inicio}–${cf.turno.fim}) no mesmo horário. Uma pessoa não pode estar em dois trabalhos ao mesmo tempo.`;

  function atribuir(iso, turnoId, cid, atividade) {
    const cf = conflitos(cid, iso, turnoId);
    if (cf.length) return { ok: false, msg: msgConflito(cid, cf[0]) };
    const d = dia(iso, true);
    if (!d.t[turnoId]) d.t[turnoId] = [];
    const ex = d.t[turnoId].find((e) => e.c === cid);
    if (ex) ex.a = atividade; else d.t[turnoId].push({ c: cid, a: atividade });
    d.f = d.f.filter((x) => x !== cid);
    return { ok: true };
  }
  function remover(iso, turnoId, cid) {
    const d = dia(iso);
    if (!d || !d.t[turnoId]) return;
    d.t[turnoId] = d.t[turnoId].filter((e) => e.c !== cid);
    limparVazios(iso);
  }
  function definirFolga(iso, cid, ligar) {
    const d = dia(iso, true);
    if (ligar) {
      for (const k of Object.keys(d.t)) d.t[k] = d.t[k].filter((e) => e.c !== cid);
      if (!d.f.includes(cid)) d.f.push(cid);
    } else d.f = d.f.filter((x) => x !== cid);
    limparVazios(iso);
  }
  function limparDiaColab(iso, cid) {
    const d = dia(iso);
    if (!d) return;
    for (const k of Object.keys(d.t)) d.t[k] = d.t[k].filter((e) => e.c !== cid);
    d.f = d.f.filter((x) => x !== cid);
    limparVazios(iso);
  }

  /** Define o dia inteiro de um colaborador (turnos selecionados ou folga), validando simultaneidade */
  function definirDia(iso, cid, selecao, folga) {
    if (folga && selecao.length) return { ok: false, msg: 'Escolha turnos OU folga para o dia, não os dois.' };
    for (let i = 0; i < selecao.length; i++) {
      for (let j = i + 1; j < selecao.length; j++) {
        const [a1, b1] = intervalo(iso, turno(selecao[i].turnoId));
        const [a2, b2] = intervalo(iso, turno(selecao[j].turnoId));
        if (a1 < b2 && a2 < b1) return { ok: false, msg: `Os turnos ${turno(selecao[i].turnoId).nome} e ${turno(selecao[j].turnoId).nome} acontecem ao mesmo tempo.` };
      }
      const cf = conflitos(cid, iso, selecao[i].turnoId, true);
      if (cf.length) return { ok: false, msg: msgConflito(cid, cf[0]) };
    }
    limparDiaColab(iso, cid);
    if (folga) definirFolga(iso, cid, true);
    for (const s of selecao) atribuir(iso, s.turnoId, cid, s.atividade);
    return { ok: true };
  }

  function usoColaborador(cid) {
    let turnos = 0; let folgas = 0;
    for (const d of Object.values(E().escala)) {
      for (const l of Object.values(d.t)) if (l.some((e) => e.c === cid)) turnos++;
      if (d.f.includes(cid)) folgas++;
    }
    return { turnos, folgas };
  }
  function removerColaborador(cid) {
    for (const [iso, d] of Object.entries(E().escala)) {
      for (const k of Object.keys(d.t)) d.t[k] = d.t[k].filter((e) => e.c !== cid);
      d.f = d.f.filter((x) => x !== cid);
      limparVazios(iso);
    }
  }
  function usoTurno(tid) {
    let n = 0;
    for (const d of Object.values(E().escala)) n += (d.t[tid] || []).length;
    return n;
  }
  function removerTurno(tid) {
    for (const [iso, d] of Object.entries(E().escala)) { delete d.t[tid]; limparVazios(iso); }
  }
  /** Copia 7 dias a partir de origemDia para destinoDia (substitui o destino) */
  function copiarSemana(origemDia, destinoDia) {
    for (let o = 0; o < 7; o++) {
      const src = E().escala[diaParaIso(origemDia + o)];
      const dst = diaParaIso(destinoDia + o);
      if (src) E().escala[dst] = Util.clone(src); else delete E().escala[dst];
    }
  }
  function limparPeriodo(d0, d1) {
    for (let d = d0; d <= d1; d++) delete E().escala[diaParaIso(d)];
  }

  return {
    dia, turnosDoColab, emFolga, ehFolga, turnoPadraoDe, intervalo, conflitos, atribuir, remover, definirFolga, limparDiaColab,
    definirDia, usoColaborador, removerColaborador, usoTurno, removerTurno, copiarSemana, limparPeriodo,
  };
})();

/* ==========================================================================
   6. INTERFACE
   ========================================================================== */
const UI = (() => {
  const U = Util;
  const { esc, fmtHoras, fmtData, fmtDataCurta, diaParaIso, isoParaDia, diaSemana } = Util;
  const E = () => Store.estado;
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  const hoje = new Date();
  const ui = {
    pagina: 'visao', ano: hoje.getFullYear(), mes: hoje.getMonth() + 1,
    modo: 'colaborador', periodo: 'mes', semanaIni: null, pincel: 'auto', filtroEquipe: '',
    filtroNivel: '', filtroColab: '', filtroRegra: '', busca: '', buscaColab: '',
    relTipo: 'mensal', relColab: '', relEquipe: '', relSemana: null,
    diaPainel: null, semanaPainel: null, destaque: null,
  };
  let resultado = null;
  let mapaAlertas = new Map();

  const TITULOS = {
    visao: 'Visão geral', colaboradores: 'Colaboradores', equipes: 'Equipes', turnos: 'Turnos',
    escala: 'Montagem da escala', validacao: 'Validação trabalhista', relatorios: 'Relatórios', config: 'Configurações',
  };
  const ROTULO_NIVEL = { vermelho: 'Possível irregularidade', amarelo: 'Atenção', verde: 'Conformidade' };

  /* ----------------------------- Auxiliares ----------------------------- */
  const atividadeNome = (id) => E().config.atividades.find((a) => a.id === id)?.nome || '—';
  const turnoPorId = (id) => E().turnos.find((t) => t.id === id);
  const colabPorId = (id) => E().colaboradores.find((c) => c.id === id);
  const diaIniMes = () => U.primeiroDiaMes(ui.ano, ui.mes);
  const diaFimMes = () => diaIniMes() + U.diasNoMes(ui.ano, ui.mes) - 1;
  const opcoes = (lista, sel) => lista.map(([v, r]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(r)}</option>`).join('');
  const seloExemplo = (o) => (o && o.exemplo ? ' <span class="selo selo-exemplo">Exemplo</span>' : '');
  const nivelGeral = () => {
    if (!resultado) return 'verde';
    if (resultado.alertas.some((a) => a.nivel === 'vermelho')) return 'vermelho';
    if (resultado.alertas.some((a) => a.nivel === 'amarelo')) return 'amarelo';
    return 'verde';
  };
  const contar = (nivel) => (resultado ? resultado.alertas.filter((a) => a.nivel === nivel).length : 0);
  const pill = (nivel, texto) => `<span class="pill pill-${nivel}"><span class="pill-ico" aria-hidden="true">${nivel === 'vermelho' ? '!' : nivel === 'amarelo' ? '•' : '✓'}</span>${esc(texto || ROTULO_NIVEL[nivel])}</span>`;
  const colabsOrdenados = (somenteAtivos = false) => [...E().colaboradores]
    .filter((c) => !somenteAtivos || c.ativo)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  /** Minutos de trabalho de um colaborador em um intervalo de dias (turnos que COMEÇAM no período) */
  function minutosPeriodo(cid, d0, d1) {
    let m = 0;
    for (let d = d0; d <= d1; d++) {
      for (const it of Escala.turnosDoColab(diaParaIso(d), cid)) {
        const t = turnoPorId(it.turnoId);
        m += Math.max(0, U.duracaoTurno(t) - (Number(t.intervaloMin) || 0));
      }
    }
    return m;
  }
  function semanasDoMes() {
    const res = [];
    for (let ws = U.inicioSemana(diaIniMes(), E().config.inicioSemana); ws <= diaFimMes(); ws += 7) res.push(ws);
    return res;
  }
  const rotuloSemana = (ws) => `${fmtDataCurta(diaParaIso(ws))} a ${fmtDataCurta(diaParaIso(ws + 6))}`;

  /* ------------------------------- Toast -------------------------------- */
  function toast(msg, tipo = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('saindo'), tipo === 'erro' ? 6500 : 3500);
    setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 4000);
  }

  /* ------------------------------- Modal -------------------------------- */
  const Modal = {
    abrir({ titulo, corpo, botoes = [], largo = false, aoAbrir }) {
      const raiz = $('#modalRaiz');
      raiz.innerHTML = `
        <div class="modal-fundo" data-fechar-modal>
          <div class="modal${largo ? ' modal-largo' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitulo">
            <div class="modal-cab"><h2 id="modalTitulo">${titulo}</h2>
              <button class="btn-icone" data-fechar-modal aria-label="Fechar">×</button></div>
            <div class="modal-corpo">${corpo}</div>
            <div class="modal-rodape">${botoes.map((b, i) => `<button class="btn ${b.classe || ''}" data-modal-btn="${i}">${esc(b.rotulo)}</button>`).join('')}</div>
          </div>
        </div>`;
      const fundo = $('.modal-fundo', raiz);
      fundo.addEventListener('click', (ev) => {
        if (ev.target.hasAttribute('data-fechar-modal') || ev.target.closest('.modal-cab [data-fechar-modal]')) Modal.fechar();
        const b = ev.target.closest('[data-modal-btn]');
        if (b) {
          const def = botoes[Number(b.dataset.modalBtn)];
          const r = def.acao ? def.acao() : true;
          if (r !== false) Modal.fechar();
        }
      });
      Modal.aberto = true;
      if (aoAbrir) aoAbrir($('.modal', raiz));
      const foco = $('.modal input, .modal select, .modal textarea, .modal [data-modal-btn]', raiz);
      if (foco) foco.focus();
    },
    fechar() { $('#modalRaiz').innerHTML = ''; Modal.aberto = false; },
    confirmar(mensagem, { titulo = 'Confirmar', rotulo = 'Confirmar', perigo = false } = {}) {
      return new Promise((resolve) => {
        let decidido = false;
        Modal.abrir({
          titulo: esc(titulo),
          corpo: `<div class="texto-confirmacao">${mensagem}</div>`,
          botoes: [
            { rotulo: 'Cancelar', classe: 'btn-sec', acao: () => { decidido = true; resolve(false); } },
            { rotulo, classe: perigo ? 'btn-perigo' : 'btn-pri', acao: () => { decidido = true; resolve(true); } },
          ],
        });
        const obs = new MutationObserver(() => { if (!$('#modalRaiz').children.length) { obs.disconnect(); if (!decidido) resolve(false); } });
        obs.observe($('#modalRaiz'), { childList: true });
      });
    },
  };

  /* ---------------------- Salvar + revalidar + redesenhar ---------------------- */
  function revalidar() {
    resultado = RegrasTrabalhistas.validar(E(), ui.ano, ui.mes);
    mapaAlertas = new Map();
    for (const a of resultado.alertas) {
      if (!a.colabId) continue;
      for (const iso of a.isos || []) {
        const k = `${a.colabId}|${iso}`;
        const lst = mapaAlertas.get(k) || [];
        lst.push(a);
        mapaAlertas.set(k, lst);
      }
    }
  }
  function commit(msg) {
    const ok = Store.salvar();
    revalidar();
    renderTudo();
    atualizarStatusSalvo(ok);
    if (msg) toast(msg, 'sucesso');
  }
  function atualizarStatusSalvo(ok = true) {
    const el = $('#statusSalvo');
    if (!ok) { el.textContent = '⚠ Não foi possível salvar no navegador'; el.className = 'status-salvo erro'; return; }
    const s = E().salvoEm ? new Date(E().salvoEm) : null;
    el.textContent = s ? `✓ Salvo automaticamente às ${U.pad(s.getHours())}:${U.pad(s.getMinutes())}` : '';
    el.className = 'status-salvo';
  }

  function renderTudo() {
    $('#tituloPagina').textContent = TITULOS[ui.pagina];
    $$('.nav-item').forEach((b) => b.classList.toggle('ativo', b.dataset.pagina === ui.pagina));
    $$('.pagina').forEach((p) => { p.hidden = p.id !== `pg-${ui.pagina}`; });
    $('#selMes').innerHTML = opcoes(U.NOMES_MESES.map((n, i) => [i + 1, n]), ui.mes);
    $('#inpAno').value = ui.ano;
    $('#nomePropriedade').textContent = E().config.propriedade || 'Gestão e validação';
    const v = contar('vermelho'); const a = contar('amarelo');
    const badge = $('#badgeAlertas');
    badge.textContent = v || a ? String(v + a) : '✓';
    badge.className = `badge badge-${nivelGeral()}`;
    badge.title = `${v} possível(is) irregularidade(s), ${a} ponto(s) de atenção`;
    const faixa = $('#faixaExemplo');
    if (DadosExemplo.existe(E())) {
      faixa.hidden = false;
      faixa.innerHTML = `<span><strong>Dados de exemplo.</strong> Os nomes iniciados por "Exemplo" são fictícios, apenas para demonstração; a semana de exemplo contém situações propositais para mostrar os alertas.</span>
        <button class="btn btn-mini" data-acao="removerExemplo">Remover dados de exemplo</button>`;
    } else faixa.hidden = true;
    const r = RENDER[ui.pagina];
    if (r) $(`#pg-${ui.pagina}`).innerHTML = r();
  }

  /* =============================== TELAS =============================== */
  const RENDER = {};

  /* ----------------------------- 1. Visão geral ----------------------------- */
  RENDER.visao = () => {
    const est = E();
    const ativos = est.colaboradores.filter((c) => c.ativo);
    const d0 = diaIniMes(); const d1 = diaFimMes();
    if (!ui.diaPainel || isoParaDia(ui.diaPainel) < d0 || isoParaDia(ui.diaPainel) > d1) {
      const h = isoParaDia(U.hojeIso());
      const comDados = Object.keys(est.escala).filter((iso) => isoParaDia(iso) >= d0 && isoParaDia(iso) <= d1).sort();
      ui.diaPainel = h >= d0 && h <= d1 ? U.hojeIso() : (comDados[0] || diaParaIso(d0));
    }
    const sem = semanasDoMes();
    if (!sem.includes(ui.semanaPainel)) {
      const ref = isoParaDia(ui.diaPainel);
      ui.semanaPainel = sem.find((w) => ref >= w && ref <= w + 6) ?? sem[0];
    }
    const iso = ui.diaPainel;
    const escalados = new Set(); const porTurno = [];
    for (const t of est.turnos) {
      const l = (est.escala[iso]?.t[t.id] || []);
      l.forEach((e) => escalados.add(e.c));
      porTurno.push({ t, nomes: l.map((e) => colabPorId(e.c)?.nome || '?') });
    }
    const folgas = colabsOrdenados().filter((c) => (c.ativo || Escala.emFolga(iso, c.id)) && Escala.ehFolga(iso, c.id)).map((c) => c.nome);
    const escaladosMes = new Set();
    for (const [k, d] of Object.entries(est.escala)) {
      const n = isoParaDia(k);
      if (n < d0 || n > d1) continue;
      Object.values(d.t).forEach((l) => l.forEach((e) => escaladosMes.add(e.c)));
    }
    const incompletas = est.equipes.filter((e) => !Equipes.permiteUm(e.id) && Equipes.membros(e.id).length < est.config.tamanhoPadraoEquipe).length;
    const ng = nivelGeral();
    const regras = RegrasTrabalhistas.regrasDoMes(est.config, ui.ano, ui.mes);

    // Tabela por colaborador (semana selecionada)
    const linhas = colabsOrdenados().filter((c) => c.ativo || resultado.resumoColab.get(c.id)?.minMes).map((c) => {
      const r = resultado.resumoColab.get(c.id);
      const s = r.semanas.find((w) => w.ws === ui.semanaPainel) || { min: 0, limite: 0, diasTrab: 0, descansos: 0, dsrValidos: 0, dsrExig: 0 };
      const alertasSem = resultado.alertas.filter((a) => a.colabId === c.id && (
        (a.isos || []).some((i) => isoParaDia(i) >= ui.semanaPainel && isoParaDia(i) <= ui.semanaPainel + 6)
        || (a.data || '').startsWith(`Semana de ${fmtDataCurta(diaParaIso(ui.semanaPainel))}`)));
      let sit = 'verde'; let txt = 'Regular';
      if (!s.diasTrab) { sit = 'neutro'; txt = 'Sem escala'; }
      if (alertasSem.some((a) => a.nivel === 'amarelo')) { sit = 'amarelo'; txt = 'Atenção'; }
      if (alertasSem.some((a) => a.nivel === 'vermelho')) { sit = 'vermelho'; txt = 'Possível irregularidade'; }
      const pct = s.limite ? Math.min(100, (s.min / s.limite) * 100) : 0;
      return `<tr>
        <td><strong>${esc(c.nome)}</strong>${seloExemplo(c)}<div class="sub">${esc(Equipes.nome(c.equipeId))}</div></td>
        <td class="num"><div class="medidor" title="${fmtHoras(s.min)} de ${fmtHoras(s.limite)}"><span style="width:${pct}%" class="${s.min > s.limite ? 'excede' : ''}"></span></div>${fmtHoras(s.min)} <span class="sub">/ ${fmtHoras(s.limite)}</span></td>
        <td class="num">${s.diasTrab}</td>
        <td class="num">${s.descansos}</td>
        <td class="num">${s.dsrValidos} <span class="sub">/ ${s.dsrExig}</span></td>
        <td class="num">${fmtHoras(r.minMes)}</td>
        <td>${sit === 'neutro' ? '<span class="pill pill-neutro">Sem escala</span>' : pill(sit, txt)}</td>
      </tr>`;
    }).join('');

    const linhasEq = [...est.equipes.map((e) => ({ id: e.id, nome: e.nome, ex: e.exemplo })), { id: '', nome: 'Sem equipe (funções específicas)' }].map((e) => {
      const m = est.colaboradores.filter((c) => (c.equipeId || '') === e.id);
      if (!m.length && e.id === '') return '';
      const semMin = m.reduce((s, c) => s + (resultado.resumoColab.get(c.id).semanas.find((w) => w.ws === ui.semanaPainel)?.min || 0), 0);
      const mesMin = m.reduce((s, c) => s + resultado.resumoColab.get(c.id).minMes, 0);
      return `<tr><td><strong>${esc(e.nome)}</strong>${e.ex ? seloExemplo({ exemplo: true }) : ''}</td><td class="num">${m.length}</td>
        <td class="num">${fmtHoras(semMin)}</td><td class="num">${fmtHoras(mesMin)}</td>
        <td class="num">${m.length ? fmtHoras(mesMin / m.length) : '—'}</td></tr>`;
    }).join('');

    return `
      <div class="cards">
        <div class="card kpi"><span class="kpi-rot">Colaboradores</span><span class="kpi-val">${est.colaboradores.length}</span><span class="kpi-sub">${ativos.length} ativos · ${est.colaboradores.length - ativos.length} inativos</span></div>
        <div class="card kpi"><span class="kpi-rot">Equipes</span><span class="kpi-val">${est.equipes.length}</span><span class="kpi-sub">${incompletas} grupo(s) de ordenha abaixo de ${est.config.tamanhoPadraoEquipe} integrantes</span></div>
        <div class="card kpi"><span class="kpi-rot">Turnos cadastrados</span><span class="kpi-val">${est.turnos.length}</span><span class="kpi-sub">${est.turnos.map((t) => esc(t.nome)).join(' · ')}</span></div>
        <div class="card kpi"><span class="kpi-rot">Escalados no mês</span><span class="kpi-val">${escaladosMes.size}</span><span class="kpi-sub">${U.NOMES_MESES[ui.mes - 1]} de ${ui.ano}</span></div>
        <div class="card kpi"><span class="kpi-rot">Alertas</span><span class="kpi-val">${contar('vermelho') + contar('amarelo')}</span><span class="kpi-sub"><span class="txt-vermelho">${contar('vermelho')} irregularidades</span> · <span class="txt-amarelo">${contar('amarelo')} atenção</span></span></div>
        <div class="card kpi kpi-status kpi-${ng}" data-acao="navegar" data-pagina="validacao" role="button" tabindex="0">
          <span class="kpi-rot">Situação geral da escala</span>${pill(ng)}<span class="kpi-sub">Clique para ver a validação</span></div>
      </div>

      <div class="grid-2">
        <section class="card">
          <div class="card-cab"><h2>Escala do dia</h2>
            <label class="campo-inline">Dia <input type="date" value="${iso}" min="${diaParaIso(d0)}" max="${diaParaIso(d1)}" data-change="diaPainel"></label></div>
          <p class="sub">${U.NOMES_DIAS[diaSemana(isoParaDia(iso))]}, ${fmtData(iso)} — <strong>${escalados.size}</strong> escalado(s) · <strong>${folgas.length}</strong> de folga</p>
          <ul class="lista-dia">
            ${porTurno.map(({ t, nomes }) => `<li><span class="chip" style="--cor:${t.cor}">${esc(t.sigla)}</span>
              <div><strong>${esc(t.nome)}</strong> <span class="sub">${t.inicio}–${t.fim} · ${nomes.length}/${t.minimo} mín.</span>
              <div>${nomes.length ? nomes.map(esc).join(', ') : '<span class="sub">Ninguém escalado</span>'}</div></div></li>`).join('')}
            <li><span class="chip-folga">F</span><div><strong>De folga</strong><div>${folgas.length ? folgas.map(esc).join(', ') : '<span class="sub">Nenhuma folga marcada</span>'}</div></div></li>
          </ul>
        </section>
        <section class="card">
          <div class="card-cab"><h2>Regras aplicadas no mês</h2></div>
          <ul class="lista-regras">${regras.map((r) => `<li><strong>${fmtDataCurta(r.de)} a ${fmtDataCurta(r.ate)}:</strong> até ${E().config.limiteDiarioH}h por dia, ${r.regra.semanalH}h por semana, ${r.regra.dsr} repouso(s) semanal(is) de 24h consecutivas.<div class="sub">${esc(r.regra.descricao)}</div></li>`).join('')}</ul>
          <p class="aviso-legal">Ferramenta de apoio à organização e conferência da jornada — não é garantia nem certificação de conformidade jurídica.</p>
        </section>
      </div>

      <section class="card">
        <div class="card-cab"><h2>Jornada por colaborador</h2>
          <label class="campo-inline">Semana <select data-change="semanaPainel">${opcoes(sem.map((w) => [w, rotuloSemana(w)]), ui.semanaPainel)}</select></label></div>
        <div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>Colaborador</th><th class="num">Horas semanais</th><th class="num">Dias trabalhados</th><th class="num">Folgas</th><th class="num" title="Repousos de 24h consecutivas que cumprem o intervalo mínimo">Repousos válidos</th><th class="num">Horas no mês</th><th>Situação</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="7" class="vazio">Nenhum colaborador cadastrado.</td></tr>'}</tbody>
        </table></div>
        <p class="sub">Horas = soma dos turnos efetivamente trabalhados (intervalos entre turnos não são contados). "Folgas" = dias da semana sem turno; "Repousos válidos" = folgas que completam 24h${E().config.somarInterjornadaAoRepouso ? ' + 11h' : ''} de descanso contínuo.</p>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Horas por equipe</h2></div>
        <div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>Equipe</th><th class="num">Integrantes</th><th class="num">Horas na semana (${rotuloSemana(ui.semanaPainel)})</th><th class="num">Horas no mês</th><th class="num">Média no mês por integrante</th></tr></thead>
          <tbody>${linhasEq || '<tr><td colspan="5" class="vazio">Nenhuma equipe cadastrada.</td></tr>'}</tbody>
        </table></div>
      </section>`;
  };

  /* ----------------------------- 2. Colaboradores ----------------------------- */
  RENDER.colaboradores = () => {
    const est = E();
    const b = ui.buscaColab.trim().toLowerCase();
    const lista = colabsOrdenados().filter((c) => !b || c.nome.toLowerCase().includes(b) || (c.funcao || '').toLowerCase().includes(b));
    return `
      <div class="barra">
        <button class="btn btn-pri" data-acao="novoColab">+ Novo colaborador</button>
        <input type="search" class="busca" placeholder="Buscar por nome ou função" value="${esc(ui.buscaColab)}" data-input="buscaColab" aria-label="Buscar colaborador">
      </div>
      <section class="card">
        <div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>Nome</th><th>Sexo</th><th>Função</th><th>Equipe</th><th>Atividade</th><th>Admissão</th><th>Situação</th><th class="acoes">Ações</th></tr></thead>
          <tbody>${lista.map((c) => `<tr class="${c.ativo ? '' : 'inativo'}">
            <td><strong>${esc(c.nome)}</strong>${seloExemplo(c)}</td>
            <td>${c.sexo === 'F' ? 'Feminino' : 'Masculino'}</td>
            <td>${esc(c.funcao || '—')}</td>
            <td>${esc(Equipes.nome(c.equipeId))}</td>
            <td>${esc(atividadeNome(c.atividade))}${(c.substitutoEm || []).length ? `<div class="sub">Substituto: ${c.substitutoEm.map(atividadeNome).map(esc).join(', ')}</div>` : ''}</td>
            <td>${c.admissao ? fmtData(c.admissao) : '—'}</td>
            <td>${c.ativo ? '<span class="pill pill-verde">Ativo</span>' : '<span class="pill pill-neutro">Inativo</span>'}</td>
            <td class="acoes"><button class="btn btn-mini" data-acao="editarColab" data-id="${c.id}">Editar</button>
              <button class="btn btn-mini btn-perigo-txt" data-acao="excluirColab" data-id="${c.id}">Excluir</button></td>
          </tr>`).join('') || `<tr><td colspan="8" class="vazio">${est.colaboradores.length ? 'Nenhum resultado para a busca.' : 'Nenhum colaborador cadastrado. Clique em "+ Novo colaborador".'}</td></tr>`}</tbody>
        </table></div>
      </section>`;
  };

  function formColab(c) {
    const est = E();
    const eqOpts = [['', 'Sem equipe'], ...est.equipes.map((e) => [e.id, `${e.nome} (${Equipes.membros(e.id).length} integrantes)`])];
    return `
      <div class="form-grid">
        <label class="campo col-2">Nome completo *<input id="fNome" value="${esc(c.nome)}" maxlength="120" required></label>
        <label class="campo">Sexo *<select id="fSexo">${opcoes([['F', 'Feminino'], ['M', 'Masculino']], c.sexo)}</select></label>
        <label class="campo">Função exercida<input id="fFuncao" value="${esc(c.funcao)}" placeholder="Ex.: Ordenhador" maxlength="80"></label>
        <label class="campo">Equipe vinculada<select id="fEquipe">${opcoes(eqOpts, c.equipeId)}</select></label>
        <label class="campo">Turno pré-definido<select id="fTurnoPadrao">${opcoes([['', 'Usar o turno fixo do grupo'], ...est.turnos.map((t) => [t.id, `${t.nome} (${t.inicio}–${t.fim})`])], c.turnoPadrao || '')}</select></label>
        <label class="campo">Tipo de atividade<select id="fAtividade">${opcoes(est.config.atividades.map((a) => [a.id, a.nome]), c.atividade)}</select></label>
        <fieldset class="campo col-2"><legend>Substituto em (pode cobrir as folgas do responsável)</legend>
          <div class="checks">${est.config.atividades.filter((a) => a.id !== 'outra').map((a) => `<label class="check"><input type="checkbox" name="fSubst" value="${a.id}"${(c.substitutoEm || []).includes(a.id) ? ' checked' : ''}> ${esc(a.nome)}</label>`).join('')}</div>
        </fieldset>
        <label class="campo">Data de admissão (opcional)<input id="fAdmissao" type="date" value="${esc(c.admissao)}"></label>
        <label class="campo">Situação<select id="fAtivo">${opcoes([['1', 'Ativo'], ['0', 'Inativo']], c.ativo ? '1' : '0')}</select></label>
      </div>
      <p class="sub">O sexo é usado para aplicar automaticamente a regra de revezamento quinzenal aos domingos (CLT, art. 386).</p>`;
  }

  function abrirFormColab(id) {
    const novo = !id;
    const c = novo ? { nome: '', sexo: 'M', funcao: '', equipeId: '', atividade: 'ordenha', substitutoEm: [], turnoPadrao: '', admissao: '', ativo: true } : colabPorId(id);
    Modal.abrir({
      titulo: novo ? 'Novo colaborador' : 'Editar colaborador',
      corpo: formColab(c),
      largo: true,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Salvar', classe: 'btn-pri',
          acao: () => {
            const nome = $('#fNome').value.trim();
            if (!nome) { toast('Informe o nome completo.', 'erro'); $('#fNome').focus(); return false; }
            const equipeId = $('#fEquipe').value;
            const r = novo ? Equipes.simular([], equipeId, equipeId ? 1 : 0) : Equipes.simular([id], equipeId);
            if (!r.ok) { toast(r.msg, 'erro'); return false; }
            const dados = {
              nome, sexo: $('#fSexo').value, funcao: $('#fFuncao').value.trim(), equipeId,
              atividade: $('#fAtividade').value,
              substitutoEm: $$('input[name="fSubst"]:checked').map((i) => i.value).filter((v) => v !== $('#fAtividade').value),
              turnoPadrao: $('#fTurnoPadrao').value,
              admissao: $('#fAdmissao').value, ativo: $('#fAtivo').value === '1',
            };
            if (novo) E().colaboradores.push({ id: U.uid('c'), exemplo: false, ...dados });
            else Object.assign(c, dados);
            commit(novo ? 'Colaborador cadastrado.' : 'Colaborador atualizado.');
            return true;
          },
        },
      ],
    });
  }

  async function excluirColab(id) {
    const c = colabPorId(id);
    const uso = Escala.usoColaborador(id);
    const eq = c.equipeId ? E().equipes.find((e) => e.id === c.equipeId) : null;
    const restantes = eq ? Equipes.membros(eq.id).filter((x) => x.id !== id) : [];
    let msg = `<p>Excluir <strong>${esc(c.nome)}</strong>?</p>`;
    if (uso.turnos || uso.folgas) {
      msg += `<div class="aviso aviso-amarelo"><strong>Este colaborador está vinculado à escala.</strong> Serão removidos ${uso.turnos} lançamento(s) de turno e ${uso.folgas} folga(s). Os turnos ficarão com menos pessoas e os indicadores e alertas serão recalculados. Se ele apenas deixou de trabalhar, prefira marcá-lo como <em>inativo</em> no cadastro.</div>`;
    }
    if (restantes.length === 1 && !Equipes.permiteUm(eq.id)) {
      msg += `<div class="aviso aviso-vermelho">O grupo "${esc(eq.nome)}" ficaria com apenas 1 integrante, o que não é permitido. <strong>${esc(restantes[0].nome)}</strong> será desvinculado do grupo (ficará "sem equipe") para que você o realoque.</div>`;
    }
    const ok = await Modal.confirmar(msg, { titulo: 'Excluir colaborador', rotulo: 'Excluir', perigo: true });
    if (!ok) return;
    if (uso.turnos || uso.folgas) Store.criarPonto(`Antes de excluir ${c.nome}`);
    if (restantes.length === 1 && !Equipes.permiteUm(eq.id)) restantes[0].equipeId = '';
    Escala.removerColaborador(id);
    E().colaboradores = E().colaboradores.filter((x) => x.id !== id);
    commit('Colaborador excluído.');
  }

  /* ----------------------------- 3. Equipes ----------------------------- */
  RENDER.equipes = () => {
    const est = E();
    const semEquipe = colabsOrdenados().filter((c) => !c.equipeId);
    const destinos = [['', 'Sem equipe'], ...est.equipes.map((e) => [e.id, e.nome])];
    const cards = est.equipes.map((e, idx) => {
      const m = Equipes.membros(e.id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      const individual = Equipes.permiteUm(e.id);
      const incompleto = !individual && m.length < est.config.tamanhoPadraoEquipe;
      const invalido = m.length === 1 && !individual;
      return `<article class="card equipe">
        <div class="card-cab">
          <h2>${esc(e.nome)}${seloExemplo(e)}</h2>
          <span class="pill ${invalido ? 'pill-vermelho' : incompleto ? 'pill-amarelo' : m.length ? 'pill-verde' : 'pill-neutro'}">${m.length} integrante(s)${individual ? ' · função individual' : incompleto ? ' · incompleto' : ''}</span>
        </div>
        <label class="campo-inline">Atividade do grupo
          <select data-change="atividadeEquipe" data-eq="${e.id}">${opcoes(est.config.atividades.map((a) => [a.id, `${a.nome}${a.grupoUnitario ? ' (individual)' : ''}`]), e.atividade || 'ordenha')}</select></label>
        <label class="campo-inline campo-turno-fixo">Turno fixo do grupo
          <select data-change="turnoFixoEquipe" data-eq="${e.id}">${opcoes([['', 'Sem turno fixo'], ...est.turnos.map((t) => [t.id, `${t.nome} (${t.inicio}–${t.fim})`])], e.turnoFixo || '')}</select></label>
        <ul class="membros">${m.map((c) => `<li>
            <span><strong>${esc(c.nome)}</strong> <span class="sub">${c.sexo === 'F' ? 'F' : 'M'} · ${esc(atividadeNome(c.atividade))}${c.ativo ? '' : ' · inativo'}</span></span>
            <span class="membro-acoes">
              <select aria-label="Transferir ${esc(c.nome)}" data-change="transferir" data-id="${c.id}">${opcoes(destinos.map(([v, r]) => [v, v === e.id ? 'Transferir para…' : r]), e.id)}</select>
              <button class="btn btn-mini btn-perigo-txt" data-acao="removerDaEquipe" data-id="${c.id}">Remover</button>
            </span></li>`).join('') || `<li class="vazio">Sem integrantes. Adicione pelo menos ${Equipes.minimo(e.id)}.</li>`}</ul>
        <div class="turnos-hab"><span class="sub">Turnos que o grupo pode realizar:</span>
          ${est.turnos.map((t) => `<label class="check"><input type="checkbox" data-change="turnoEquipe" data-eq="${e.id}" value="${t.id}"${(e.turnos || []).includes(t.id) ? ' checked' : ''}> <span class="chip" style="--cor:${t.cor}">${esc(t.sigla)}</span> ${esc(t.nome)}</label>`).join('')}
        </div>
        <div class="card-acoes">
          <button class="btn btn-mini btn-pri" data-acao="addMembros" data-id="${e.id}">+ Adicionar integrantes</button>
          <button class="btn btn-mini" data-acao="renomearEquipe" data-id="${e.id}">Renomear</button>
          <button class="btn btn-mini" data-acao="moverEquipe" data-id="${e.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} aria-label="Mover para cima">↑</button>
          <button class="btn btn-mini" data-acao="moverEquipe" data-id="${e.id}" data-dir="1" ${idx === est.equipes.length - 1 ? 'disabled' : ''} aria-label="Mover para baixo">↓</button>
          <button class="btn btn-mini btn-perigo-txt" data-acao="excluirEquipe" data-id="${e.id}">Excluir</button>
        </div>
      </article>`;
    }).join('');
    return `
      <div class="barra">
        <button class="btn btn-pri" data-acao="novaEquipe">+ Novo grupo</button>
        <span class="sub">Defina o turno fixo de cada grupo (ex.: Grupo 1 = Matutino, Grupo 2 = Vespertino, Grupo 3 = Noturno). Grupos de ordenha: 2, 3 ou mais integrantes — nunca apenas 1. Grupos de função individual (ex.: Camas dos animais) podem ter 1 integrante. Tamanho de referência da ordenha: ${est.config.tamanhoPadraoEquipe} (ajustável em Configurações).</span>
      </div>
      <div class="grade-cards">${cards || '<div class="card vazio">Nenhum grupo cadastrado. Clique em "+ Novo grupo".</div>'}</div>
      <section class="card">
        <div class="card-cab"><h2>Colaboradores sem equipe</h2><span class="pill pill-neutro">${semEquipe.length}</span></div>
        <p class="sub">Normalmente quem exerce função específica (camas, alimentação). Uma pessoa pode ter função específica e também pertencer a um grupo.</p>
        <ul class="membros">${semEquipe.map((c) => `<li><span><strong>${esc(c.nome)}</strong> <span class="sub">${esc(atividadeNome(c.atividade))}</span></span></li>`).join('') || '<li class="vazio">Todos os colaboradores estão em algum grupo.</li>'}</ul>
      </section>`;
  };

  function abrirFormEquipe(id) {
    const novo = !id;
    const e = novo ? { nome: '', atividade: 'ordenha', turnos: E().turnos.map((t) => t.id) } : E().equipes.find((x) => x.id === id);
    const cand = colabsOrdenados(true);
    Modal.abrir({
      titulo: novo ? 'Novo grupo' : 'Renomear grupo',
      largo: novo,
      corpo: `<label class="campo">Nome do grupo *<input id="fEqNome" value="${esc(e.nome)}" maxlength="60" placeholder="Ex.: Grupo 1"></label>
        ${novo ? `<label class="campo">Atividade do grupo<select id="fEqAtiv">${opcoes(E().config.atividades.map((a) => [a.id, `${a.nome}${a.grupoUnitario ? ' (individual)' : ''}`]), 'ordenha')}</select></label>
          <label class="campo">Turno fixo do grupo<select id="fEqTurno">${opcoes([['', 'Sem turno fixo'], ...E().turnos.map((t) => [t.id, `${t.nome} (${t.inicio}–${t.fim})`])], '')}</select></label>
          <fieldset class="campo"><legend>Integrantes (ordenha: 0 ou pelo menos 2; função individual: 1 ou mais)</legend>
          <div class="checks checks-col">${cand.map((c) => `<label class="check"><input type="checkbox" name="fEqMembro" value="${c.id}"> ${esc(c.nome)} <span class="sub">(${esc(Equipes.nome(c.equipeId))})</span></label>`).join('') || '<span class="sub">Cadastre colaboradores primeiro.</span>'}</div></fieldset>` : ''}`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Salvar', classe: 'btn-pri',
          acao: () => {
            const nome = $('#fEqNome').value.trim();
            if (!nome) { toast('Informe o nome do grupo.', 'erro'); return false; }
            if (!novo) { e.nome = nome; commit('Grupo renomeado.'); return true; }
            const sel = $$('input[name="fEqMembro"]:checked').map((i) => i.value);
            const atividade = $('#fEqAtiv').value;
            const unit = !!E().config.atividades.find((a) => a.id === atividade)?.grupoUnitario;
            if (sel.length === 1 && !unit) { toast('Um grupo de ordenha não pode ter apenas 1 integrante. Selecione pelo menos 2 (ou nenhum), ou escolha uma atividade individual, como Camas dos animais.', 'erro'); return false; }
            const nova = { id: U.uid('eq'), nome, atividade, turnoFixo: $('#fEqTurno').value, turnos: E().turnos.map((t) => t.id), exemplo: false };
            E().equipes.push(nova);
            const r = Equipes.mover(sel, nova.id);
            if (!r.ok) { E().equipes.pop(); toast(r.msg, 'erro'); return false; }
            commit('Grupo criado.');
            return true;
          },
        },
      ],
    });
  }

  function abrirAddMembros(eid) {
    const e = E().equipes.find((x) => x.id === eid);
    const cand = colabsOrdenados(true).filter((c) => c.equipeId !== eid);
    Modal.abrir({
      titulo: `Adicionar integrantes — ${esc(e.nome)}`,
      corpo: `<p class="sub">Colaboradores de outros grupos serão transferidos. ${Equipes.membros(eid).length === 0 && !Equipes.permiteUm(eid) ? '<strong>O grupo está vazio: selecione pelo menos 2.</strong>' : ''}</p>
        <div class="checks checks-col">${cand.map((c) => `<label class="check"><input type="checkbox" name="fAdd" value="${c.id}"> ${esc(c.nome)} <span class="sub">(${esc(Equipes.nome(c.equipeId))})</span></label>`).join('') || '<span class="sub">Não há outros colaboradores ativos.</span>'}</div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Adicionar', classe: 'btn-pri',
          acao: () => {
            const sel = $$('input[name="fAdd"]:checked').map((i) => i.value);
            if (!sel.length) { toast('Selecione ao menos um colaborador.', 'erro'); return false; }
            const r = Equipes.mover(sel, eid);
            if (!r.ok) { toast(r.msg, 'erro'); return false; }
            commit('Integrantes adicionados.');
            return true;
          },
        },
      ],
    });
  }

  /* ----------------------------- 4. Turnos ----------------------------- */
  RENDER.turnos = () => {
    const est = E();
    return `
      <div class="barra"><button class="btn btn-pri" data-acao="novoTurno">+ Novo turno</button>
        <span class="sub">Turnos que atravessam a meia-noite são calculados como uma jornada contínua iniciada no dia de entrada.</span></div>
      <section class="card"><div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Turno</th><th>Início</th><th>Término</th><th class="num">Duração</th><th class="num">Intervalo</th><th class="num">Trabalho efetivo</th><th class="num">Mínimo</th><th>Atividades</th><th>Equipes habilitadas</th><th class="acoes">Ações</th></tr></thead>
        <tbody>${est.turnos.map((t) => {
          const dur = U.duracaoTurno(t);
          const eqs = est.equipes.filter((e) => (e.turnos || []).includes(t.id)).map((e) => e.nome);
          return `<tr>
            <td><span class="chip" style="--cor:${t.cor}">${esc(t.sigla)}</span> <strong>${esc(t.nome)}</strong></td>
            <td>${t.inicio}</td>
            <td>${t.fim}${U.atravessaMeiaNoite(t) ? ' <span class="selo">dia seguinte</span>' : ''}</td>
            <td class="num">${fmtHoras(dur)}</td>
            <td class="num">${Number(t.intervaloMin) || 0} min</td>
            <td class="num">${fmtHoras(dur - (Number(t.intervaloMin) || 0))}</td>
            <td class="num">${t.minimo}</td>
            <td>${(t.atividades || []).map(atividadeNome).map(esc).join(', ') || '—'}</td>
            <td>${eqs.map(esc).join(', ') || '<span class="sub">Nenhuma</span>'}</td>
            <td class="acoes"><button class="btn btn-mini" data-acao="editarTurno" data-id="${t.id}">Editar</button>
              <button class="btn btn-mini btn-perigo-txt" data-acao="excluirTurno" data-id="${t.id}">Excluir</button></td></tr>`;
        }).join('') || '<tr><td colspan="10" class="vazio">Nenhum turno cadastrado.</td></tr>'}</tbody>
      </table></div></section>`;
  };

  function abrirFormTurno(id) {
    const est = E();
    const novo = !id;
    const t = novo ? { nome: '', sigla: '', inicio: '06:00', fim: '11:00', intervaloMin: 0, minimo: 1, atividades: ['ordenha'], cor: '#2E8A6E' } : turnoPorId(id);
    const eqHab = novo ? est.equipes.map((e) => e.id) : est.equipes.filter((e) => (e.turnos || []).includes(t.id)).map((e) => e.id);
    Modal.abrir({
      titulo: novo ? 'Novo turno' : `Editar turno — ${esc(t.nome)}`,
      largo: true,
      corpo: `<div class="form-grid">
        <label class="campo">Nome *<input id="tNome" value="${esc(t.nome)}" maxlength="40"></label>
        <label class="campo">Sigla (até 3 letras) *<input id="tSigla" value="${esc(t.sigla)}" maxlength="3"></label>
        <label class="campo">Horário inicial *<input id="tIni" type="time" value="${t.inicio}"></label>
        <label class="campo">Horário final *<input id="tFim" type="time" value="${t.fim}"></label>
        <label class="campo">Intervalo dentro do turno (min)<input id="tIntervalo" type="number" min="0" max="600" value="${Number(t.intervaloMin) || 0}"></label>
        <label class="campo">Quantidade mínima de colaboradores<input id="tMin" type="number" min="0" max="50" value="${t.minimo}"></label>
        <label class="campo">Cor na escala<input id="tCor" type="color" value="${t.cor}"></label>
        <div class="campo"><span>Duração calculada</span><output id="tDur" class="destaque-calc"></output></div>
        <fieldset class="campo col-2"><legend>Atividade(s) atendida(s)</legend><div class="checks">${est.config.atividades.map((a) => `<label class="check"><input type="checkbox" name="tAtiv" value="${a.id}"${(t.atividades || []).includes(a.id) ? ' checked' : ''}> ${esc(a.nome)}</label>`).join('')}</div></fieldset>
        <fieldset class="campo col-2"><legend>Equipes habilitadas</legend><div class="checks">${est.equipes.map((e) => `<label class="check"><input type="checkbox" name="tEq" value="${e.id}"${eqHab.includes(e.id) ? ' checked' : ''}> ${esc(e.nome)}</label>`).join('') || '<span class="sub">Nenhuma equipe cadastrada.</span>'}</div></fieldset>
      </div>`,
      aoAbrir: (m) => {
        const atualizar = () => {
          const tt = { inicio: $('#tIni', m).value, fim: $('#tFim', m).value };
          if (!tt.inicio || !tt.fim) { $('#tDur', m).textContent = '—'; return; }
          const dur = U.duracaoTurno(tt);
          const iv = Number($('#tIntervalo', m).value) || 0;
          $('#tDur', m).textContent = `${fmtHoras(dur)} de permanência · ${fmtHoras(Math.max(0, dur - iv))} de trabalho${U.atravessaMeiaNoite(tt) ? ' · termina no dia seguinte' : ''}`;
        };
        ['#tIni', '#tFim', '#tIntervalo'].forEach((s) => $(s, m).addEventListener('input', atualizar));
        atualizar();
      },
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Salvar', classe: 'btn-pri',
          acao: () => {
            const nome = $('#tNome').value.trim(); const sigla = $('#tSigla').value.trim().toUpperCase();
            const inicio = $('#tIni').value; const fim = $('#tFim').value;
            if (!nome || !sigla || !inicio || !fim) { toast('Preencha nome, sigla e horários.', 'erro'); return false; }
            if (inicio === fim) { toast('O horário final deve ser diferente do inicial.', 'erro'); return false; }
            const intervaloMin = Math.max(0, Number($('#tIntervalo').value) || 0);
            if (intervaloMin >= U.duracaoTurno({ inicio, fim })) { toast('O intervalo não pode ser maior que a duração do turno.', 'erro'); return false; }
            const dados = {
              nome, sigla, inicio, fim, intervaloMin, minimo: Math.max(0, Number($('#tMin').value) || 0),
              cor: $('#tCor').value, atividades: $$('input[name="tAtiv"]:checked').map((i) => i.value),
            };
            let alvo = t;
            if (novo) { alvo = { id: U.uid('t'), ...dados }; est.turnos.push(alvo); } else Object.assign(t, dados);
            const eqSel = $$('input[name="tEq"]:checked').map((i) => i.value);
            for (const e of est.equipes) {
              e.turnos = (e.turnos || []).filter((x) => x !== alvo.id);
              if (eqSel.includes(e.id)) e.turnos.push(alvo.id);
            }
            commit(novo ? 'Turno cadastrado.' : 'Turno atualizado. A validação foi recalculada com os novos horários.');
            return true;
          },
        },
      ],
    });
  }

  async function excluirTurno(id) {
    const t = turnoPorId(id);
    const uso = Escala.usoTurno(id);
    const ok = await Modal.confirmar(`<p>Excluir o turno <strong>${esc(t.nome)}</strong>?</p>${uso ? `<div class="aviso aviso-amarelo">Existem ${uso} lançamento(s) deste turno na escala, que serão removidos.</div>` : ''}`, { titulo: 'Excluir turno', rotulo: 'Excluir', perigo: true });
    if (!ok) return;
    if (uso) Store.criarPonto(`Antes de excluir o turno ${t.nome}`);
    Escala.removerTurno(id);
    E().turnos = E().turnos.filter((x) => x.id !== id);
    E().equipes.forEach((e) => { e.turnos = (e.turnos || []).filter((x) => x !== id); if (e.turnoFixo === id) e.turnoFixo = ''; });
    E().colaboradores.forEach((c) => { if (c.turnoPadrao === id) c.turnoPadrao = ''; });
    commit('Turno excluído.');
  }

  /* ----------------------------- 5. Montagem da escala ----------------------------- */
  function diasVisiveis() {
    if (ui.periodo === 'semana') {
      if (ui.semanaIni == null) ui.semanaIni = U.inicioSemana(diaIniMes(), E().config.inicioSemana);
      return Array.from({ length: 7 }, (_, i) => ui.semanaIni + i);
    }
    const d0 = diaIniMes();
    return Array.from({ length: U.diasNoMes(ui.ano, ui.mes) }, (_, i) => d0 + i);
  }

  function cabecalhoDias(dias) {
    const hojeN = isoParaDia(U.hojeIso());
    const marcos = new Set(E().config.vigencias.filter((v) => v.inicio).map((v) => v.inicio));
    return dias.map((d) => {
      const iso = diaParaIso(d); const ds = diaSemana(d);
      const cls = [ds === 0 ? 'dom' : '', d === hojeN ? 'hoje' : '', marcos.has(iso) ? 'marco' : ''].join(' ');
      return `<th class="dia ${cls}" title="${U.NOMES_DIAS[ds]}, ${fmtData(iso)}${marcos.has(iso) ? ' — início de nova regra de jornada' : ''}"><span>${U.SIGLAS_DIAS[ds]}</span><strong>${iso.slice(8)}</strong></th>`;
    }).join('');
  }

  function celulaColab(c, d, detalhado) {
    const iso = diaParaIso(d);
    const its = Escala.turnosDoColab(iso, c.id);
    const folga = Escala.emFolga(iso, c.id);
    const folgaImplicita = !folga && !its.length && Escala.ehFolga(iso, c.id);
    const alertas = mapaAlertas.get(`${c.id}|${iso}`) || [];
    const nivel = alertas.some((a) => a.nivel === 'vermelho') ? 'vermelho' : alertas.length ? 'amarelo' : '';
    // turno noturno do dia anterior que invade este dia
    const ant = Escala.turnosDoColab(diaParaIso(d - 1), c.id).map((x) => turnoPorId(x.turnoId)).filter((t) => U.atravessaMeiaNoite(t));
    const chips = its.map((x) => {
      const t = turnoPorId(x.turnoId);
      const outra = x.atividade !== c.atividade ? ` · ${atividadeNome(x.atividade)}` : '';
      return detalhado
        ? `<span class="chip chip-largo" style="--cor:${t.cor}" title="${esc(t.nome)} ${t.inicio}–${t.fim}${esc(outra)}">${esc(t.sigla)} <small>${t.inicio}–${t.fim}${esc(outra)}</small></span>`
        : `<span class="chip" style="--cor:${t.cor}" title="${esc(t.nome)} ${t.inicio}–${t.fim}${esc(outra)}">${esc(t.sigla)}${outra ? '*' : ''}</span>`;
    }).join('');
    const titulo = alertas.map((a) => `${ROTULO_NIVEL[a.nivel]}: ${a.regra}`).join('\n');
    const destaque = ui.destaque && ui.destaque.cid === c.id && ui.destaque.iso === iso ? ' destaque' : '';
    return `<td class="cel ${diaSemana(d) === 0 ? 'dom' : ''} ${nivel ? `alerta-${nivel}` : ''}${destaque}" data-acao="celula" data-c="${c.id}" data-d="${iso}" tabindex="0" title="${esc(titulo)}">
      ${ant.length ? `<span class="cont-noite" title="Continuação do ${esc(ant[0].nome)} iniciado na véspera (até ${ant[0].fim})">↳${ant[0].fim.slice(0, 2)}h</span>` : ''}
      ${chips}${folga ? '<span class="chip-folga" title="Folga">F</span>' : ''}${folgaImplicita ? '<span class="chip-folga implicita" title="Sem turno neste dia = folga">F</span>' : ''}${nivel ? `<span class="marca-alerta marca-${nivel}" aria-label="${ROTULO_NIVEL[nivel]}"></span>` : ''}</td>`;
  }

  function linhaColab(c, dias, detalhado) {
    const min = minutosPeriodo(c.id, dias[0], dias[dias.length - 1]);
    const descansos = dias.filter((d) => Escala.ehFolga(diaParaIso(d), c.id)).length;
    const tp = turnoPorId(Escala.turnoPadraoDe(c));
    return `<tr><th class="col-nome" scope="row"><span class="nome">${esc(c.nome)}</span>${c.sexo === 'F' ? ' <span class="selo" title="Colaboradora — revezamento quinzenal aos domingos (CLT, art. 386)">fem.</span>' : ''}${c.ativo ? '' : ' <span class="selo">inativo</span>'}
      <span class="sub">${esc(atividadeNome(c.atividade))}${tp ? ` · turno fixo: <span class="chip chip-mini" style="--cor:${tp.cor}">${esc(tp.sigla)}</span>` : ' · sem turno fixo'}</span></th>
      ${dias.map((d) => celulaColab(c, d, detalhado)).join('')}
      <td class="num tot">${fmtHoras(min)}</td><td class="num tot">${descansos}</td></tr>`;
  }

  function rodapeCobertura(dias) {
    return E().turnos.map((t) => `<tr class="linha-cob"><th class="col-nome" scope="row"><span class="chip" style="--cor:${t.cor}">${esc(t.sigla)}</span> ${esc(t.nome)} <span class="sub">mín. ${t.minimo}</span></th>
      ${dias.map((d) => {
        const n = (E().escala[diaParaIso(d)]?.t[t.id] || []).length;
        const iniciado = !!E().escala[diaParaIso(d)];
        return `<td class="num ${iniciado && n < t.minimo ? 'falta' : ''}" title="${n} de ${t.minimo} no ${esc(t.nome)}">${n}</td>`;
      }).join('')}<td></td><td></td></tr>`).join('');
  }

  function gradeColaboradores(dias) {
    const detalhado = ui.periodo === 'semana';
    const visiveis = (c) => (c.ativo || dias.some((d) => Escala.turnosDoColab(diaParaIso(d), c.id).length))
      && (!ui.filtroEquipe || (ui.filtroEquipe === '_sem' ? !c.equipeId : c.equipeId === ui.filtroEquipe));
    let corpo = '';
    if (ui.modo === 'equipe') {
      const grupos = [...E().equipes.map((e) => ({ id: e.id, nome: e.nome })), { id: '', nome: 'Sem equipe' }];
      for (const g of grupos) {
        const m = colabsOrdenados().filter((c) => (c.equipeId || '') === g.id && visiveis(c));
        if (!m.length) continue;
        corpo += `<tr class="linha-grupo"><th class="col-nome" colspan="1">${esc(g.nome)} <span class="sub">(${m.length})</span></th><td colspan="${dias.length + 2}"></td></tr>`;
        corpo += m.map((c) => linhaColab(c, dias, detalhado)).join('');
      }
    } else {
      corpo = colabsOrdenados().filter(visiveis).map((c) => linhaColab(c, dias, detalhado)).join('');
    }
    if (!corpo) corpo = `<tr><td class="vazio" colspan="${dias.length + 3}">Nenhum colaborador para exibir. Cadastre colaboradores em "Colaboradores".</td></tr>`;
    return `<table class="grade ${detalhado ? 'grade-semana' : ''}">
      <thead><tr><th class="col-nome">Colaborador</th>${cabecalhoDias(dias)}<th class="num tot">Horas</th><th class="num tot">Folgas</th></tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr class="linha-grupo"><th class="col-nome">Cobertura por turno</th><td colspan="${dias.length + 2}"></td></tr>${rodapeCobertura(dias)}</tfoot>
    </table>`;
  }

  function gradeTurnos(dias) {
    const linhas = E().turnos.map((t) => `<tr>
      <th class="col-nome" scope="row"><span class="chip" style="--cor:${t.cor}">${esc(t.sigla)}</span> <strong>${esc(t.nome)}</strong><span class="sub">${t.inicio}–${t.fim} · mín. ${t.minimo}</span></th>
      ${dias.map((d) => {
        const iso = diaParaIso(d);
        const lst = (E().escala[iso]?.t[t.id] || []).filter((e) => !ui.filtroEquipe || (ui.filtroEquipe === '_sem' ? !colabPorId(e.c)?.equipeId : colabPorId(e.c)?.equipeId === ui.filtroEquipe));
        const n = (E().escala[iso]?.t[t.id] || []).length;
        const iniciado = !!E().escala[iso];
        return `<td class="cel cel-turno ${diaSemana(d) === 0 ? 'dom' : ''} ${iniciado && n < t.minimo ? 'falta' : ''}" data-acao="celulaTurno" data-t="${t.id}" data-d="${iso}" tabindex="0">
          <span class="contagem">${n}/${t.minimo}</span>
          ${lst.map((e) => { const c = colabPorId(e.c); return `<span class="nome-chip" style="--cor:${t.cor}" title="${esc(c?.nome)} · ${esc(atividadeNome(e.a))}">${esc(U.primeiroNome(c?.nome))}${e.a !== 'ordenha' ? ` <small>${esc(atividadeNome(e.a).split(' ')[0])}</small>` : ''}</span>`; }).join('')}
        </td>`;
      }).join('')}</tr>`).join('');
    const folgas = `<tr><th class="col-nome" scope="row"><span class="chip-folga">F</span> <strong>Folgas</strong></th>${dias.map((d) => {
      const f = colabsOrdenados().filter((c) => (c.ativo || Escala.emFolga(diaParaIso(d), c.id)) && Escala.ehFolga(diaParaIso(d), c.id)).map((c) => c.id);
      return `<td class="cel cel-turno ${diaSemana(d) === 0 ? 'dom' : ''}"><span class="contagem">${f.length}</span>${f.map((id) => `<span class="nome-chip folga">${esc(U.primeiroNome(colabPorId(id)?.nome))}</span>`).join('')}</td>`;
    }).join('')}</tr>`;
    return `<table class="grade grade-turnos"><thead><tr><th class="col-nome">Turno</th>${cabecalhoDias(dias)}</tr></thead><tbody>${linhas}${folgas}</tbody></table>`;
  }

  RENDER.escala = () => {
    const est = E();
    const dias = diasVisiveis();
    const eqOpts = [['', 'Todas as equipes'], ...est.equipes.map((e) => [e.id, e.nome]), ['_sem', 'Sem equipe']];
    const pinceis = [['auto', '✓', 'Escalar no turno do grupo', ''], ['editar', '✎', 'Editar dia', ''], ...est.turnos.map((t) => [t.id, t.sigla, t.nome, t.cor]), ['folga', 'F', 'Folga', ''], ['limpar', '⌫', 'Limpar', '']];
    const modoTurno = ui.modo === 'turno';
    return `
      <div class="barra barra-escala">
        <div class="segmentado" role="group" aria-label="Visualizar por">
          ${[['colaborador', 'Por colaborador'], ['equipe', 'Por equipe'], ['turno', 'Por turno']].map(([v, r]) => `<button class="seg ${ui.modo === v ? 'ativo' : ''}" data-acao="modoEscala" data-v="${v}">${r}</button>`).join('')}
        </div>
        <div class="segmentado" role="group" aria-label="Período">
          ${[['mes', 'Mês'], ['semana', 'Semana']].map(([v, r]) => `<button class="seg ${ui.periodo === v ? 'ativo' : ''}" data-acao="periodoEscala" data-v="${v}">${r}</button>`).join('')}
        </div>
        ${ui.periodo === 'semana' ? `<div class="nav-semana"><button class="btn-icone" data-acao="semana" data-dir="-1" aria-label="Semana anterior">‹</button><strong>${rotuloSemana(dias[0])}</strong><button class="btn-icone" data-acao="semana" data-dir="1" aria-label="Próxima semana">›</button></div>` : ''}
        <select data-change="filtroEquipe" aria-label="Filtrar equipe">${opcoes(eqOpts, ui.filtroEquipe)}</select>
      </div>
      ${modoTurno ? '<p class="dica">Clique em uma célula para escolher quem trabalha naquele turno e dia.</p>' : `
      <div class="barra pinceis" role="toolbar" aria-label="Ferramenta de preenchimento">
        <span class="sub">Ferramenta:</span>
        ${pinceis.map(([v, s, r, cor]) => `<button class="pincel ${ui.pincel === v ? 'ativo' : ''}" data-acao="pincel" data-v="${v}" title="${esc(r)}">${cor ? `<span class="chip" style="--cor:${cor}">${esc(s)}</span>` : v === 'folga' ? '<span class="chip-folga">F</span>' : `<span class="ico">${s}</span>`} ${esc(r)}</button>`).join('')}
        <span class="dica">${ui.pincel === 'auto' ? 'Clique no dia para escalar o colaborador no turno fixo do grupo (Grupo 1 = Matutino, 2 = Vespertino, 3 = Noturno, conforme cadastrado). Clique de novo para desmarcar. Dia sem marcação = folga.' : ui.pincel === 'editar' ? 'Clique em uma célula para escolher turnos, atividade ou folga.' : ui.pincel === 'folga' ? 'Clique nas células para marcar/desmarcar folga.' : ui.pincel === 'limpar' ? 'Clique nas células para apagar turno e folga do dia.' : 'Clique nas células para incluir/retirar este turno.'}</span>
      </div>`}
      <div class="barra">
        <button class="btn btn-dourado" data-acao="sugerirEscala">✦ Sugerir escala…</button>
        <button class="btn" data-acao="copiarSemana">Copiar semana…</button>
        <button class="btn" data-acao="limparMes">Limpar ${ui.periodo === 'semana' ? 'semana' : 'mês'}…</button>
        <button class="btn" data-acao="salvarPonto">Salvar ponto de restauração</button>
        <button class="btn" data-acao="restaurar">Recuperar escala salva…</button>
        <button class="btn" data-acao="imprimirGrade">Imprimir</button>
        <span class="resumo-alertas">${pill(nivelGeral(), `${contar('vermelho')} irregularidade(s) · ${contar('amarelo')} atenção`)} <button class="btn btn-mini" data-acao="navegar" data-pagina="validacao">Ver alertas</button></span>
      </div>
      <div class="legenda">${est.turnos.map((t) => `<span><span class="chip" style="--cor:${t.cor}">${esc(t.sigla)}</span> ${esc(t.nome)} ${t.inicio}–${t.fim}</span>`).join('')}
        <span><span class="chip-folga">F</span> Folga marcada</span><span><span class="chip-folga implicita">F</span> Sem turno = folga</span><span><span class="cont-noite">↳02h</span> continuação do turno da véspera</span>
        <span><span class="marca-alerta marca-vermelho"></span> possível irregularidade</span><span><span class="marca-alerta marca-amarelo"></span> atenção</span>
        <span>* atividade diferente da habitual</span></div>
      <div class="grade-wrap" id="gradeEscala">${modoTurno ? gradeTurnos(dias) : gradeColaboradores(dias)}</div>`;
  };

  function aoClicarCelula(cid, iso) {
    const c = colabPorId(cid);
    const p = ui.pincel;
    if (p === 'auto') {
      // Já escalado no dia → desmarca (o dia volta a ser folga)
      if (Escala.turnosDoColab(iso, cid).length) { Escala.limparDiaColab(iso, cid); Escala.dia(iso, true); commit(); return; }
      const tp = Escala.turnoPadraoDe(c);
      if (!tp) {
        toast(`${c.nome} não tem turno pré-definido (grupo sem turno fixo). Escolha o turno nesta janela ou defina o turno fixo em Equipes.`, 'info');
        abrirEditorDia(cid, iso);
        return;
      }
      const tt = turnoPorId(tp);
      const ativ = (tt.atividades || []).includes(c.atividade) || !(tt.atividades || []).length ? c.atividade : tt.atividades[0];
      const r = Escala.atribuir(iso, tp, cid, ativ);
      if (!r.ok) { toast(r.msg, 'erro'); return; }
      commit();
      return;
    }
    if (p === 'editar') { abrirEditorDia(cid, iso); return; }
    if (p === 'folga') { Escala.definirFolga(iso, cid, !Escala.emFolga(iso, cid)); commit(); return; }
    if (p === 'limpar') { Escala.limparDiaColab(iso, cid); commit(); return; }
    const t = turnoPorId(p);
    if (!t) return;
    if (Escala.turnosDoColab(iso, cid).some((x) => x.turnoId === p)) { Escala.remover(iso, p, cid); commit(); return; }
    const ativ = (t.atividades || []).includes(c.atividade) || !(t.atividades || []).length ? c.atividade : t.atividades[0];
    const r = Escala.atribuir(iso, p, cid, ativ);
    if (!r.ok) { toast(r.msg, 'erro'); return; }
    commit();
  }

  function abrirEditorDia(cid, iso) {
    const c = colabPorId(cid);
    const its = Escala.turnosDoColab(iso, cid);
    const folga = Escala.emFolga(iso, cid);
    const alertas = mapaAlertas.get(`${cid}|${iso}`) || [];
    const ativOpts = E().config.atividades.map((a) => [a.id, a.nome]);
    Modal.abrir({
      titulo: `${esc(c.nome)} — ${U.NOMES_DIAS[diaSemana(isoParaDia(iso))]}, ${fmtData(iso)}`,
      largo: true,
      corpo: `
        <label class="check check-grande"><input type="checkbox" id="eFolga"${folga ? ' checked' : ''}> <span class="chip-folga">F</span> Folga neste dia</label>
        <div id="eTurnos" class="lista-turnos">
          ${E().turnos.map((t) => {
            const sel = its.find((x) => x.turnoId === t.id);
            const cf = Escala.conflitos(cid, iso, t.id, true);
            const eq = c.equipeId ? E().equipes.find((e) => e.id === c.equipeId) : null;
            const naoHab = eq && !(eq.turnos || []).includes(t.id);
            return `<div class="linha-turno">
              <label class="check"><input type="checkbox" name="eTurno" value="${t.id}"${sel ? ' checked' : ''}${cf.length ? ' disabled' : ''}>
                <span class="chip" style="--cor:${t.cor}">${esc(t.sigla)}</span> <strong>${esc(t.nome)}</strong> <span class="sub">${t.inicio}–${t.fim}${U.atravessaMeiaNoite(t) ? ' (dia seguinte)' : ''} · ${fmtHoras(U.duracaoTurno(t) - (Number(t.intervaloMin) || 0))}</span></label>
              <select name="eAtiv" data-t="${t.id}" aria-label="Atividade no turno ${esc(t.nome)}">${opcoes(ativOpts, sel ? sel.atividade : c.atividade)}</select>
              ${cf.length ? `<span class="nota nota-vermelho">Indisponível: já está no ${esc(cf[0].turno.nome)} de ${fmtDataCurta(cf[0].iso)} no mesmo horário</span>` : ''}
              ${naoHab ? '<span class="nota nota-amarelo">Turno não habilitado para a equipe deste colaborador</span>' : ''}
            </div>`;
          }).join('')}
        </div>
        ${alertas.length ? `<div class="alertas-celula"><strong>Alertas deste dia</strong>${alertas.map((a) => `<div class="alerta-mini alerta-${a.nivel}">${pill(a.nivel, a.regra)}<div>${esc(a.motivo)}</div><div class="sub"><strong>Sugestão:</strong> ${esc(a.sugestao)}</div></div>`).join('')}</div>` : ''}`,
      aoAbrir: (m) => {
        const sync = () => {
          const f = $('#eFolga', m).checked;
          $$('input[name="eTurno"]', m).forEach((i) => { if (f) i.checked = false; i.closest('.linha-turno').classList.toggle('desativada', f); });
        };
        $('#eFolga', m).addEventListener('change', sync);
        $$('input[name="eTurno"]', m).forEach((i) => i.addEventListener('change', () => { if (i.checked) { $('#eFolga', m).checked = false; sync(); } }));
        sync();
      },
      botoes: [
        { rotulo: 'Limpar dia', classe: 'btn-sec', acao: () => { Escala.limparDiaColab(iso, cid); commit(); return true; } },
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Aplicar', classe: 'btn-pri',
          acao: () => {
            const selecao = $$('input[name="eTurno"]:checked').map((i) => ({ turnoId: i.value, atividade: $(`select[name="eAtiv"][data-t="${i.value}"]`).value }));
            const r = Escala.definirDia(iso, cid, selecao, $('#eFolga').checked);
            if (!r.ok) { toast(r.msg, 'erro'); return false; }
            commit();
            return true;
          },
        },
      ],
    });
  }

  function abrirEditorTurno(tid, iso) {
    const t = turnoPorId(tid);
    const atuais = E().escala[iso]?.t[tid] || [];
    const ativOpts = E().config.atividades.map((a) => [a.id, a.nome]);
    const lista = colabsOrdenados(true).map((c) => {
      const eq = c.equipeId ? E().equipes.find((e) => e.id === c.equipeId) : null;
      const hab = !eq || (eq.turnos || []).includes(tid);
      const cf = Escala.conflitos(c.id, iso, tid);
      const sel = atuais.find((e) => e.c === c.id);
      return { c, hab, cf, sel, folga: Escala.emFolga(iso, c.id) };
    }).sort((a, b) => (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || (b.hab ? 1 : 0) - (a.hab ? 1 : 0) || (a.cf.length - b.cf.length));
    Modal.abrir({
      titulo: `${esc(t.nome)} (${t.inicio}–${t.fim}) — ${U.NOMES_DIAS[diaSemana(isoParaDia(iso))]}, ${fmtData(iso)}`,
      largo: true,
      corpo: `<p class="sub">Mínimo configurado: ${t.minimo}. Selecione quem trabalha neste turno.</p>
        <div class="lista-turnos">${lista.map(({ c, hab, cf, sel, folga }) => `<div class="linha-turno${cf.length ? ' desativada' : ''}">
          <label class="check"><input type="checkbox" name="tcColab" value="${c.id}"${sel ? ' checked' : ''}${cf.length ? ' disabled' : ''}> <strong>${esc(c.nome)}</strong> <span class="sub">${esc(Equipes.nome(c.equipeId))}</span></label>
          <select name="tcAtiv" data-c="${c.id}" aria-label="Atividade de ${esc(c.nome)}">${opcoes(ativOpts, sel ? sel.a : c.atividade)}</select>
          ${cf.length ? `<span class="nota nota-vermelho">Já está no ${esc(cf[0].turno.nome)} de ${fmtDataCurta(cf[0].iso)}</span>` : ''}
          ${folga ? '<span class="nota nota-amarelo">Está de folga — ao selecionar, a folga será retirada</span>' : ''}
          ${!hab ? '<span class="nota nota-amarelo">Equipe não habilitada para este turno</span>' : ''}
        </div>`).join('') || '<span class="sub">Nenhum colaborador ativo.</span>'}</div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Aplicar', classe: 'btn-pri',
          acao: () => {
            const sel = $$('input[name="tcColab"]:checked').map((i) => i.value);
            for (const e of [...atuais]) if (!sel.includes(e.c)) Escala.remover(iso, tid, e.c);
            const erros = [];
            for (const cid of sel) {
              const r = Escala.atribuir(iso, tid, cid, $(`select[name="tcAtiv"][data-c="${cid}"]`).value);
              if (!r.ok) erros.push(r.msg);
            }
            commit();
            if (erros.length) toast(erros[0], 'erro');
            return true;
          },
        },
      ],
    });
  }

  /* ----------------------------- Sugestão de escala ----------------------------- */
  function abrirSugestao() {
    const est = E();
    const cfgS = Object.assign({ folgasPorDia: 3, incluirFuncoes: true }, est.config.sugestao || {});
    const sems = semanasDoMes();
    const opPeriodo = [['mes', `Mês inteiro — ${U.NOMES_MESES[ui.mes - 1]}/${ui.ano}`], ...sems.map((w) => [`s${w}`, `Semana de ${rotuloSemana(w)}`])];
    const padrao = ui.periodo === 'semana' && ui.semanaIni != null && sems.includes(ui.semanaIni) ? `s${ui.semanaIni}` : 'mes';
    let ultimo = null;

    const intervalo = (v) => {
      if (v === 'mes') return [diaIniMes(), diaFimMes()];
      const w = Number(v.slice(1));
      return [w, w + 6];
    };

    const previa = (m) => {
      const [d0, d1] = intervalo($('#sgPeriodo', m).value);
      const opcoesS = { folgasPorDia: Number($('#sgFolgas', m).value) || 0, incluirFuncoes: $('#sgFuncoes', m).checked };
      const r = SugestaoEscala.gerar(est, d0, d1, opcoesS);
      ultimo = { r, opcoesS };
      const alvo = $('#sgPrevia', m);
      if (!r.gruposOrd.length && !r.funcoes.length) {
        alvo.innerHTML = '<div class="aviso aviso-amarelo">Nenhum colaborador com turno pré-definido. Defina o <strong>turno fixo</strong> de cada grupo em Equipes (ex.: Grupo 1 = Matutino) para usar a sugestão.</div>';
        return;
      }
      const copia = U.clone(est);
      SugestaoEscala.aplicar(copia, r);
      const val = RegrasTrabalhistas.validar(copia, ui.ano, ui.mes);
      const ids = new Set(r.plano.keys());
      const verm = val.alertas.filter((a) => a.nivel === 'vermelho');
      const amar = val.alertas.filter((a) => a.nivel === 'amarelo');
      const diasOk = r.folgasPorDia.filter((x) => x.n === r.N).length;
      const dias = Array.from({ length: d1 - d0 + 1 }, (_, i) => d0 + i);
      const pessoas = [...r.gruposOrd.flatMap((g) => g.membros.map((c) => ({ c, g: g.nome }))), ...r.funcoes.flatMap((f) => f.membros.map((c) => ({ c, g: f.nome })))];
      alvo.innerHTML = `
        <div class="sg-resumo">
          <div><span class="kpi-rot">Folgas/dia na ordenha</span><strong>${r.N} em ${diasOk} de ${dias.length} dias</strong></div>
          <div><span class="kpi-rot">Previsão após aplicar</span>${pill(verm.length ? 'vermelho' : amar.length ? 'amarelo' : 'verde', `${verm.length} irregularidade(s) · ${amar.length} atenção`)}</div>
        </div>
        <p class="sub">Grupos de ordenha: ${r.gruposOrd.map((g) => `${esc(g.nome)} (${g.membros.length})`).join(', ') || 'nenhum'}${r.funcoes.length ? ` · Funções: ${r.funcoes.map((f) => `${esc(f.nome)} (${f.membros.length})`).join(', ')}` : ''}.</p>
        ${r.semTurno.length ? `<div class="aviso aviso-amarelo">Fora da sugestão por não terem turno pré-definido: ${r.semTurno.map((c) => esc(c.nome)).join(', ')}. Os lançamentos deles não serão alterados.</div>` : ''}
        ${r.excedentes.length ? `<div class="aviso aviso-amarelo"><strong>Dias com mais de ${r.N} folgas</strong> para cumprir regra legal (a lei tem prioridade sobre a meta de folgas):<ul>${r.excedentes.slice(0, 8).map((x) => `<li>${fmtDataCurta(x.iso)} — ${esc(x.grupo)}: ${x.motivos.map(esc).join('; ')}</li>`).join('')}</ul>${r.excedentes.length > 8 ? `<span class="sub">e mais ${r.excedentes.length - 8} dia(s).</span>` : ''}</div>` : ''}
        ${verm.length ? `<div class="aviso aviso-vermelho"><strong>Pontos que ainda exigirão ajuste:</strong><ul>${verm.slice(0, 6).map((a) => `<li>${esc(a.colaborador)} · ${esc(a.data)} — ${esc(a.regra)}</li>`).join('')}</ul>${verm.some((a) => !ids.has(a.colabId)) ? '<span class="sub">Alguns se referem a pessoas fora da sugestão.</span>' : ''}</div>` : ''}
        <div class="tabela-wrap sg-grade"><table class="tabela tabela-grade-rel"><thead><tr><th>Colaborador</th>${dias.map((d) => `<th class="${diaSemana(d) === 0 ? 'dom' : ''}">${U.SIGLAS_DIAS[diaSemana(d)].charAt(0)}<br>${diaParaIso(d).slice(8)}</th>`).join('')}<th>Folgas</th></tr></thead>
          <tbody>${pessoas.map(({ c, g }) => {
            const pl = r.plano.get(c.id);
            return `<tr><td>${esc(c.nome)} <span class="sub">${esc(g)}</span></td>${dias.map((d) => {
              const tid = pl.get(d); const t = tid ? turnoPorId(tid) : null;
              return `<td class="${diaSemana(d) === 0 ? 'dom' : ''}">${t ? `<span class="chip chip-print" style="--cor:${t.cor}">${esc(t.sigla)}</span>` : '<span class="chip-folga">F</span>'}</td>`;
            }).join('')}<td class="num">${dias.filter((d) => !pl.get(d)).length}</td></tr>`;
          }).join('')}
          <tr class="linha-total"><td><strong>Folgas na ordenha</strong></td>${r.folgasPorDia.map((x) => `<td class="num ${x.n !== r.N ? 'excede-txt' : ''}">${x.n}</td>`).join('')}<td></td></tr></tbody></table></div>`;
    };

    Modal.abrir({
      titulo: 'Sugerir escala',
      largo: true,
      corpo: `
        <p class="sub">O sistema propõe uma escala com base no turno fixo de cada grupo e nas regras configuradas. <strong>Nada é gravado até você clicar em "Aplicar sugestão"</strong>; depois, tudo continua editável.</p>
        <div class="form-grid form-grid-3">
          <label class="campo">Período<select id="sgPeriodo">${opcoes(opPeriodo, padrao)}</select></label>
          <label class="campo">Pessoas de folga por dia (grupos de ordenha)<input id="sgFolgas" type="number" min="0" max="50" value="${cfgS.folgasPorDia}"></label>
          <label class="check" style="align-self:end"><input type="checkbox" id="sgFuncoes"${cfgS.incluirFuncoes ? ' checked' : ''}> Incluir funções fora dos grupos (camas, alimentação)</label>
        </div>
        <div id="sgPrevia" class="sg-previa"></div>
        <div class="aviso aviso-amarelo">Ao aplicar, os turnos e folgas <strong>das pessoas incluídas</strong> no período são substituídos pela sugestão. Um ponto de restauração é criado antes.</div>`,
      aoAbrir: (m) => {
        ['#sgPeriodo', '#sgFolgas', '#sgFuncoes'].forEach((sel) => $(sel, m).addEventListener('change', () => previa(m)));
        $('#sgFolgas', m).addEventListener('input', () => previa(m));
        previa(m);
      },
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Aplicar sugestão', classe: 'btn-pri',
          acao: () => {
            if (!ultimo || !ultimo.r.plano.size) { toast('Não há sugestão para aplicar. Defina o turno fixo dos grupos em Equipes.', 'erro'); return false; }
            Store.criarPonto('Antes de aplicar a sugestão de escala');
            E().config.sugestao = ultimo.opcoesS;
            SugestaoEscala.aplicar(E(), ultimo.r);
            commit('Sugestão aplicada. Revise e ajuste livremente; use "Recuperar escala salva" para desfazer.');
            return true;
          },
        },
      ],
    });
  }

  function abrirCopiarSemana() {
    const est = E();
    const ini = U.inicioSemana(diaIniMes(), est.config.inicioSemana);
    const sems = [];
    for (let w = ini - 14; w <= diaFimMes() + 14; w += 7) sems.push(w);
    const origemPad = ui.periodo === 'semana' && ui.semanaIni != null ? ui.semanaIni : ini;
    const ops = sems.map((w) => [w, `${rotuloSemana(w)}${Object.keys(est.escala).some((k) => isoParaDia(k) >= w && isoParaDia(k) <= w + 6) ? ' • com escala' : ''}`]);
    Modal.abrir({
      titulo: 'Copiar programação de uma semana',
      corpo: `<div class="form-grid">
        <label class="campo">Semana de origem<select id="cpOrigem">${opcoes(ops, origemPad)}</select></label>
        <label class="campo">Semana de destino<select id="cpDestino">${opcoes(ops, origemPad + 7)}</select></label>
        <label class="check col-2"><input type="checkbox" id="cpRepetir"> Repetir também nas semanas seguintes até o fim do mês exibido</label>
      </div>
      <div class="aviso aviso-amarelo">Turnos e folgas da semana de destino serão <strong>substituídos</strong>. Um ponto de restauração é criado automaticamente antes da cópia. Depois, cada dia continua editável individualmente.</div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-sec' },
        {
          rotulo: 'Copiar', classe: 'btn-pri',
          acao: () => {
            const o = Number($('#cpOrigem').value); const d = Number($('#cpDestino').value);
            if (o === d) { toast('Escolha semanas diferentes.', 'erro'); return false; }
            Store.criarPonto(`Antes de copiar a semana ${rotuloSemana(o)}`);
            const destinos = [d];
            if ($('#cpRepetir').checked) for (let w = d + 7; w <= diaFimMes(); w += 7) if (w !== o) destinos.push(w);
            destinos.forEach((w) => Escala.copiarSemana(o, w));
            commit(`Semana copiada para ${destinos.length} semana(s). Confira os alertas: a virada entre semanas pode gerar intervalos curtos.`);
            return true;
          },
        },
      ],
    });
  }

  /* ----------------------------- 6. Validação ----------------------------- */
  RENDER.validacao = () => {
    const est = E();
    const ng = nivelGeral();
    const todos = resultado.alertas;
    const regrasLista = [...new Set(todos.map((a) => a.regra))].sort();
    const colabsLista = [...new Set(todos.map((a) => a.colaborador))].sort();
    const busca = ui.busca.trim().toLowerCase();
    const filtrados = todos.filter((a) => (!ui.filtroNivel || a.nivel === ui.filtroNivel)
      && (!ui.filtroColab || a.colaborador === ui.filtroColab)
      && (!ui.filtroRegra || a.regra === ui.filtroRegra)
      && (!busca || `${a.colaborador} ${a.motivo} ${a.regra} ${a.turno}`.toLowerCase().includes(busca)));
    const grupos = new Map();
    for (const a of filtrados) { if (!grupos.has(a.regra)) grupos.set(a.regra, []); grupos.get(a.regra).push(a); }
    const regras = RegrasTrabalhistas.regrasDoMes(est.config, ui.ano, ui.mes);
    return `
      <div class="cards">
        <div class="card kpi kpi-status kpi-${ng}"><span class="kpi-rot">Situação geral — ${U.NOMES_MESES[ui.mes - 1]}/${ui.ano}</span>${pill(ng, ng === 'verde' ? 'Conformidade com os limites configurados' : ROTULO_NIVEL[ng])}
          <span class="kpi-sub">${ng === 'verde' ? 'Descansos respeitados e sem sobreposição de turnos.' : 'Revise os itens abaixo e valide novamente.'}</span></div>
        <div class="card kpi"><span class="kpi-rot">Possíveis irregularidades</span><span class="kpi-val txt-vermelho">${contar('vermelho')}</span><span class="kpi-sub">Nível vermelho</span></div>
        <div class="card kpi"><span class="kpi-rot">Pontos de atenção</span><span class="kpi-val txt-amarelo">${contar('amarelo')}</span><span class="kpi-sub">Nível amarelo</span></div>
        <div class="card kpi"><span class="kpi-rot">Limites aplicados</span>${regras.map((r) => `<span class="kpi-sub"><strong>${fmtDataCurta(r.de)}–${fmtDataCurta(r.ate)}:</strong> ${est.config.limiteDiarioH}h/dia · ${r.regra.semanalH}h/semana · ${r.regra.dsr} repouso(s)</span>`).join('')}</div>
      </div>
      <div class="barra">
        <button class="btn btn-pri" data-acao="revalidar">↻ Executar validação novamente</button>
        <select data-change="filtroNivel" aria-label="Filtrar nível">${opcoes([['', 'Todos os níveis'], ['vermelho', 'Somente vermelho'], ['amarelo', 'Somente amarelo']], ui.filtroNivel)}</select>
        <select data-change="filtroColab" aria-label="Filtrar colaborador">${opcoes([['', 'Todos os colaboradores'], ...colabsLista.map((c) => [c, c])], ui.filtroColab)}</select>
        <select data-change="filtroRegra" aria-label="Filtrar regra">${opcoes([['', 'Todas as regras'], ...regrasLista.map((r) => [r, r])], ui.filtroRegra)}</select>
        <input type="search" class="busca" placeholder="Buscar nos alertas" value="${esc(ui.busca)}" data-input="busca" aria-label="Buscar nos alertas">
        <button class="btn" data-acao="relIrregularidades">Imprimir relatório</button>
      </div>
      ${filtrados.length ? [...grupos.entries()].map(([regra, lst]) => `
        <details class="grupo-alertas" open>
          <summary>${pill(lst[0].nivel, regra)} <span class="sub">${lst.length} ocorrência(s)</span></summary>
          <div class="lista-alertas">${lst.map(cardAlerta).join('')}</div>
        </details>`).join('') : `<div class="card vazio-ok">${todos.length ? 'Nenhum alerta para os filtros escolhidos.' : `${pill('verde')} <p>Nenhuma irregularidade ou ponto de atenção encontrado para ${U.NOMES_MESES[ui.mes - 1]}/${ui.ano} com os parâmetros configurados.</p>`}</div>`}
      <section class="card nota-juridica">
        <h2>Precaução jurídica</h2>
        <p>O validador aplica os parâmetros cadastrados em <em>Configurações</em>: CF art. 7º (EC 141/2026), Portaria MTE 2.041/2026, Lei 5.889/1973 (trabalho rural) e, de forma subsidiária, a CLT. A EC 141/2026 e a divulgação oficial da Portaria 2.041 não trazem regra específica para o trabalhador rural; regimes diferenciados, compensações e cláusulas de convenção ou acordo coletivo podem alterar o resultado.</p>
        <p><strong>${esc(RegrasTrabalhistas.AVISO_CONFERENCIA)}</strong></p>
        ${est.config.instrumentoColetivo ? `<p><strong>Anotações sobre o instrumento coletivo:</strong> ${esc(est.config.instrumentoColetivo)}</p>` : ''}
        <p class="sub">Esta é uma ferramenta de apoio à organização e conferência da jornada, não uma garantia ou certificação automática de conformidade jurídica.</p>
      </section>`;
  };

  function cardAlerta(a) {
    return `<article class="alerta alerta-${a.nivel}">
      <div class="alerta-cab">${pill(a.nivel)} <strong>${esc(a.regra)}</strong>${a.iso && a.colabId ? `<button class="btn btn-mini" data-acao="irParaData" data-d="${a.iso}" data-c="${a.colabId}">Ver na escala</button>` : a.iso ? `<button class="btn btn-mini" data-acao="irParaData" data-d="${a.iso}">Ver na escala</button>` : ''}</div>
      <dl class="alerta-campos">
        <div><dt>Colaborador</dt><dd>${esc(a.colaborador)}</dd></div>
        <div><dt>Data</dt><dd>${esc(a.data)}</dd></div>
        <div><dt>Turno</dt><dd>${esc(a.turno)}</dd></div>
        <div class="largo"><dt>Regra identificada</dt><dd>${esc(a.regra)} <span class="sub">— ${esc(a.fonte)}</span></dd></div>
        <div class="largo"><dt>Motivo do alerta</dt><dd>${esc(a.motivo)}</dd></div>
        <div class="largo"><dt>Sugestão de correção</dt><dd>${esc(a.sugestao)}</dd></div>
      </dl>
      ${a.conferir ? `<p class="aviso-conferir">${esc(RegrasTrabalhistas.AVISO_CONFERENCIA)}</p>` : ''}
    </article>`;
  }

  /* ----------------------------- 7. Relatórios ----------------------------- */
  const TIPOS_REL = [['mensal', 'Escala mensal'], ['semanal', 'Escala semanal'], ['individual', 'Escala individual'], ['equipe', 'Escala por equipe'], ['horas', 'Horas trabalhadas'], ['irregularidades', 'Irregularidades']];

  RENDER.relatorios = () => {
    const est = E();
    const sem = semanasDoMes();
    if (!sem.includes(ui.relSemana)) ui.relSemana = sem[0];
    if (!ui.relColab || !colabPorId(ui.relColab)) ui.relColab = colabsOrdenados()[0]?.id || '';
    if (!ui.relEquipe || !est.equipes.some((e) => e.id === ui.relEquipe)) ui.relEquipe = est.equipes[0]?.id || '';
    const extra = {
      semanal: `<select data-change="relSemana" aria-label="Semana">${opcoes(sem.map((w) => [w, rotuloSemana(w)]), ui.relSemana)}</select>`,
      individual: `<select data-change="relColab" aria-label="Colaborador">${opcoes(colabsOrdenados().map((c) => [c.id, c.nome]), ui.relColab)}</select>`,
      equipe: `<select data-change="relEquipe" aria-label="Equipe">${opcoes(est.equipes.map((e) => [e.id, e.nome]), ui.relEquipe)}</select>`,
    }[ui.relTipo] || '';
    return `
      <div class="barra">
        <div class="segmentado" role="group" aria-label="Tipo de relatório">${TIPOS_REL.map(([v, r]) => `<button class="seg ${ui.relTipo === v ? 'ativo' : ''}" data-acao="relTipo" data-v="${v}">${r}</button>`).join('')}</div>
        ${extra}
        <button class="btn btn-pri" data-acao="imprimirRelatorio">Imprimir / salvar em PDF</button>
      </div>
      <p class="dica">Para gerar o PDF, clique em "Imprimir / salvar em PDF" e escolha "Salvar como PDF" no destino da impressão.</p>
      <section class="card relatorio" id="areaRelatorio">${conteudoRelatorio()}</section>`;
  };

  function cabRelatorio(titulo, sub) {
    const p = E().config.propriedade;
    return `<header class="rel-cab"><div><h2>${esc(titulo)}</h2><p>${esc(sub)}</p></div><div class="rel-meta">${p ? `<strong>${esc(p)}</strong><br>` : ''}Emitido em ${fmtData(U.hojeIso())}</div></header>`;
  }
  const rodapeRelatorio = () => `<footer class="rel-rodape">Documento gerado pelo Sistema de Gestão e Validação de Escalas 5x2 — ferramenta de apoio à organização e conferência da jornada, sem garantia ou certificação de conformidade jurídica. ${esc(RegrasTrabalhistas.AVISO_CONFERENCIA)}</footer>`;

  function tabelaGrade(colabs, dias) {
    return `<table class="tabela tabela-grade-rel"><thead><tr><th>Colaborador</th>${dias.map((d) => `<th class="${diaSemana(d) === 0 ? 'dom' : ''}">${U.SIGLAS_DIAS[diaSemana(d)].charAt(0)}<br>${diaParaIso(d).slice(8)}</th>`).join('')}<th>Horas</th><th>Folgas</th></tr></thead>
      <tbody>${colabs.map((c) => `<tr><td>${esc(c.nome)}</td>${dias.map((d) => {
        const iso = diaParaIso(d);
        const its = Escala.turnosDoColab(iso, c.id);
        if (its.length) return `<td class="${diaSemana(d) === 0 ? 'dom' : ''}">${its.map((x) => { const t = turnoPorId(x.turnoId); return `<span class="chip chip-print" style="--cor:${t.cor}">${esc(t.sigla)}</span>`; }).join('')}</td>`;
        return `<td class="${diaSemana(d) === 0 ? 'dom' : ''}">${Escala.ehFolga(iso, c.id) ? '<span class="chip-folga">F</span>' : ''}</td>`;
      }).join('')}<td class="num">${fmtHoras(minutosPeriodo(c.id, dias[0], dias[dias.length - 1]))}</td><td class="num">${dias.filter((d) => Escala.ehFolga(diaParaIso(d), c.id)).length}</td></tr>`).join('') || `<tr><td colspan="${dias.length + 3}" class="vazio">Sem colaboradores.</td></tr>`}</tbody></table>
      <p class="legenda-rel">${E().turnos.map((t) => `<span class="chip chip-print" style="--cor:${t.cor}">${esc(t.sigla)}</span> ${esc(t.nome)} (${t.inicio}–${t.fim})`).join(' · ')} · <span class="chip-folga">F</span> Folga</p>`;
  }

  function conteudoRelatorio() {
    const est = E();
    const mesTxt = `${U.NOMES_MESES[ui.mes - 1]} de ${ui.ano}`;
    const d0 = diaIniMes(); const d1 = diaFimMes();
    const diasMes = Array.from({ length: d1 - d0 + 1 }, (_, i) => d0 + i);
    const ativosOuEscalados = colabsOrdenados().filter((c) => c.ativo || minutosPeriodo(c.id, d0, d1));
    switch (ui.relTipo) {
      case 'mensal':
        return cabRelatorio('Escala mensal', mesTxt) + tabelaGrade(ativosOuEscalados, diasMes) + rodapeRelatorio();
      case 'semanal': {
        const ws = ui.relSemana;
        const dias = Array.from({ length: 7 }, (_, i) => ws + i);
        const corpo = est.turnos.map((t) => `<tr><th><span class="chip chip-print" style="--cor:${t.cor}">${esc(t.sigla)}</span> ${esc(t.nome)}<br><small>${t.inicio}–${t.fim}</small></th>${dias.map((d) => {
          const l = est.escala[diaParaIso(d)]?.t[t.id] || [];
          return `<td>${l.map((e) => `${esc(colabPorId(e.c)?.nome)}${e.a !== 'ordenha' ? ` <small>(${esc(atividadeNome(e.a))})</small>` : ''}`).join('<br>') || '<span class="sub">—</span>'}</td>`;
        }).join('')}</tr>`).join('');
        const folgas = `<tr><th><span class="chip-folga">F</span> Folgas</th>${dias.map((d) => `<td>${colabsOrdenados().filter((c) => c.ativo && Escala.ehFolga(diaParaIso(d), c.id)).map((c) => esc(c.nome)).join('<br>') || '<span class="sub">—</span>'}</td>`).join('')}</tr>`;
        return `${cabRelatorio('Escala semanal', `Semana de ${fmtData(diaParaIso(ws))} a ${fmtData(diaParaIso(ws + 6))}`)}
          <table class="tabela tabela-semanal"><thead><tr><th>Turno</th>${dias.map((d) => `<th>${U.NOMES_DIAS[diaSemana(d)]}<br>${fmtDataCurta(diaParaIso(d))}</th>`).join('')}</tr></thead><tbody>${corpo}${folgas}</tbody></table>${rodapeRelatorio()}`;
      }
      case 'individual': {
        const c = colabPorId(ui.relColab);
        if (!c) return '<p class="vazio">Cadastre colaboradores para gerar este relatório.</p>';
        const r = resultado.resumoColab.get(c.id);
        const linhas = diasMes.map((d) => {
          const iso = diaParaIso(d);
          const its = Escala.turnosDoColab(iso, c.id);
          const min = its.reduce((s, x) => { const t = turnoPorId(x.turnoId); return s + U.duracaoTurno(t) - (Number(t.intervaloMin) || 0); }, 0);
          const al = mapaAlertas.get(`${c.id}|${iso}`) || [];
          return `<tr class="${diaSemana(d) === 0 ? 'dom' : ''}"><td>${fmtDataCurta(iso)}</td><td>${U.SIGLAS_DIAS[diaSemana(d)]}</td>
            <td>${its.map((x) => esc(turnoPorId(x.turnoId).nome)).join(' + ') || (Escala.ehFolga(iso, c.id) ? '<strong>Folga</strong>' : '—')}</td>
            <td>${its.map((x) => { const t = turnoPorId(x.turnoId); return `${t.inicio}–${t.fim}`; }).join(' / ')}</td>
            <td>${its.map((x) => esc(atividadeNome(x.atividade))).join(', ')}</td>
            <td class="num">${min ? fmtHoras(min) : ''}</td>
            <td>${al.map((a) => esc(a.regra)).join('; ')}</td></tr>`;
        }).join('');
        const semanas = r.semanas.map((s) => `<tr><td>${rotuloSemana(s.ws)}${s.parcial ? ' <small>(parcial)</small>' : ''}</td><td class="num">${fmtHoras(s.min)}</td><td class="num">${fmtHoras(s.limite)}</td><td class="num">${s.diasTrab}</td><td class="num">${s.descansos}</td><td class="num">${s.dsrValidos}/${s.dsrExig}</td></tr>`).join('');
        return `${cabRelatorio(`Escala individual — ${c.nome}`, `${mesTxt} · ${Equipes.nome(c.equipeId)} · ${atividadeNome(c.atividade)}`)}
          <table class="tabela"><thead><tr><th>Data</th><th>Dia</th><th>Turno</th><th>Horário</th><th>Atividade</th><th class="num">Horas</th><th>Alertas</th></tr></thead><tbody>${linhas}</tbody></table>
          <h3>Resumo semanal</h3>
          <table class="tabela"><thead><tr><th>Semana</th><th class="num">Horas</th><th class="num">Limite</th><th class="num">Dias trabalhados</th><th class="num">Folgas</th><th class="num">Repousos válidos</th></tr></thead><tbody>${semanas}</tbody></table>
          <p><strong>Total no mês:</strong> ${fmtHoras(r.minMes)} · ${r.diasTrab} dia(s) trabalhado(s) · ${r.domingosFolga} domingo(s) de folga${r.noturnoMin ? ` · ${fmtHoras(r.noturnoMin)} em período noturno` : ''}</p>${rodapeRelatorio()}`;
      }
      case 'equipe': {
        const e = est.equipes.find((x) => x.id === ui.relEquipe);
        if (!e) return '<p class="vazio">Cadastre equipes para gerar este relatório.</p>';
        return cabRelatorio(`Escala por equipe — ${e.nome}`, mesTxt) + tabelaGrade(Equipes.membros(e.id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), diasMes) + rodapeRelatorio();
      }
      case 'horas': {
        const sem = resultado.semanas;
        const linhas = ativosOuEscalados.map((c) => {
          const r = resultado.resumoColab.get(c.id);
          return `<tr><td>${esc(c.nome)}</td>${r.semanas.map((s) => `<td class="num ${s.min > s.limite ? 'excede-txt' : ''}">${fmtHoras(s.min)}</td>`).join('')}<td class="num"><strong>${fmtHoras(r.minMes)}</strong></td><td class="num">${r.diasTrab}</td><td class="num">${r.descansos}</td><td class="num">${r.noturnoMin ? fmtHoras(r.noturnoMin) : '—'}</td></tr>`;
        }).join('');
        const eqs = est.equipes.map((e) => {
          const m = Equipes.membros(e.id);
          return `<tr><td>${esc(e.nome)}</td>${sem.map((w) => `<td class="num">${fmtHoras(m.reduce((s, c) => s + (resultado.resumoColab.get(c.id).semanas.find((x) => x.ws === w)?.min || 0), 0))}</td>`).join('')}<td class="num"><strong>${fmtHoras(m.reduce((s, c) => s + resultado.resumoColab.get(c.id).minMes, 0))}</strong></td></tr>`;
        }).join('');
        return `${cabRelatorio('Relatório de horas trabalhadas', `${mesTxt} · limite proporcional do mês: ${fmtHoras(resultado.limiteMensalMin)} por colaborador`)}
          <table class="tabela"><thead><tr><th>Colaborador</th>${sem.map((w) => `<th class="num">${rotuloSemana(w)}<br><small>lim. ${RegrasTrabalhistas.regraVigente(est.config, diaParaIso(w + 6)).semanalH}h</small></th>`).join('')}<th class="num">Mês</th><th class="num">Dias trab.</th><th class="num">Dias sem turno</th><th class="num">Noturno</th></tr></thead><tbody>${linhas || '<tr><td class="vazio" colspan="9">Sem dados.</td></tr>'}</tbody></table>
          <h3>Por equipe</h3>
          <table class="tabela"><thead><tr><th>Equipe</th>${sem.map((w) => `<th class="num">${rotuloSemana(w)}</th>`).join('')}<th class="num">Mês</th></tr></thead><tbody>${eqs || '<tr><td class="vazio">Sem equipes.</td></tr>'}</tbody></table>
          <p class="sub">Horas = soma dos turnos (menos o intervalo cadastrado dentro do turno), atribuídas à semana em que o turno começa. Valores em destaque excedem o limite semanal.</p>${rodapeRelatorio()}`;
      }
      case 'irregularidades': {
        const lst = resultado.alertas;
        return `${cabRelatorio('Relatório de irregularidades e pontos de atenção', `${mesTxt} · ${contar('vermelho')} possível(is) irregularidade(s) · ${contar('amarelo')} ponto(s) de atenção`)}
          <table class="tabela tabela-alertas"><thead><tr><th>Nível</th><th>Colaborador</th><th>Data</th><th>Turno</th><th>Regra</th><th>Motivo</th><th>Sugestão</th></tr></thead>
          <tbody>${lst.map((a) => `<tr><td>${pill(a.nivel)}</td><td>${esc(a.colaborador)}</td><td>${esc(a.data)}</td><td>${esc(a.turno)}</td><td>${esc(a.regra)}<br><small>${esc(a.fonte)}</small></td><td>${esc(a.motivo)}${a.conferir ? `<br><em>${esc(RegrasTrabalhistas.AVISO_CONFERENCIA)}</em>` : ''}</td><td>${esc(a.sugestao)}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum alerta no mês.</td></tr>'}</tbody></table>${rodapeRelatorio()}`;
      }
      default: return '';
    }
  }

  /** Impressão: copia o conteúdo para #printRaiz (o CSS de impressão mostra apenas ele) */
  function imprimir(html) {
    $('#printRaiz').innerHTML = html;
    document.body.classList.add('imprimindo');
    const limpar = () => { document.body.classList.remove('imprimindo'); $('#printRaiz').innerHTML = ''; window.removeEventListener('afterprint', limpar); };
    window.addEventListener('afterprint', limpar);
    setTimeout(() => window.print(), 50);
  }

  /* ----------------------------- 8. Configurações ----------------------------- */
  RENDER.config = () => {
    const c = E().config;
    const pontos = Store.listarPontos();
    return `
      <section class="card">
        <div class="card-cab"><h2>Propriedade</h2></div>
        <label class="campo">Nome da propriedade (aparece nos relatórios)<input data-cfg="propriedade" value="${esc(c.propriedade)}" maxlength="100"></label>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Parâmetros de jornada e descanso</h2></div>
        <div class="form-grid form-grid-3">
          <label class="campo">Limite normal diário (horas)<input type="number" step="0.5" min="1" max="24" data-cfg="limiteDiarioH" data-tipo="num" value="${c.limiteDiarioH}"></label>
          <label class="campo">Intervalo mínimo entre jornadas (horas)<input type="number" step="0.5" min="0" max="48" data-cfg="interjornadaH" data-tipo="num" value="${c.interjornadaH}"></label>
          <label class="campo">Máximo de dias consecutivos de trabalho<input type="number" min="1" max="14" data-cfg="maxDiasConsecutivos" data-tipo="num" value="${c.maxDiasConsecutivos}"></label>
          <label class="campo">Semana considerada<select data-cfg="inicioSemana" data-tipo="num">${opcoes([[1, 'Segunda a domingo'], [0, 'Domingo a sábado']], c.inicioSemana)}</select></label>
          <label class="campo">Apuração do limite semanal<select data-cfg="apuracao">${opcoes([['semanal', 'Por semana (padrão)'], ['mensal', 'Média mensal (requer instrumento coletivo)']], c.apuracao)}</select></label>
          <label class="campo">Tamanho de referência das equipes<input type="number" min="2" max="20" data-cfg="tamanhoPadraoEquipe" data-tipo="num" value="${c.tamanhoPadraoEquipe}"></label>
          <label class="campo">Intervalo mínimo — trabalho contínuo acima de 6h (min)<input type="number" min="0" max="240" data-cfg="intrajornada.acima6hMin" data-tipo="num" value="${c.intrajornada.acima6hMin}"></label>
          <label class="campo">Intervalo de referência — jornada de 4h a 6h (min)<input type="number" min="0" max="120" data-cfg="intrajornada.de4a6hMin" data-tipo="num" value="${c.intrajornada.de4a6hMin}"></label>
          <label class="campo">Intervalo usual máximo entre turnos do mesmo dia (min)<input type="number" min="0" max="720" data-cfg="intrajornada.maxEntreTurnosMin" data-tipo="num" value="${c.intrajornada.maxEntreTurnosMin}"></label>
        </div>
        <label class="check"><input type="checkbox" data-cfg="somarInterjornadaAoRepouso" data-tipo="bool"${c.somarInterjornadaAoRepouso ? ' checked' : ''}> Somar as 11h entre jornadas às 24h de cada repouso (Súmula 110 do TST: descanso mínimo de 35h em torno de uma folga)</label>
        <label class="check"><input type="checkbox" data-cfg="diaSemTurnoEhFolga" data-tipo="bool"${c.diaSemTurnoEhFolga ? ' checked' : ''}> Dia sem turno marcado na escala conta como folga (não é preciso marcar "F")</label>
        <label class="check"><input type="checkbox" data-cfg="regraMulheresArt386" data-tipo="bool"${c.regraMulheresArt386 ? ' checked' : ''}> Aplicar revezamento quinzenal aos domingos para colaboradoras (CLT, art. 386)</label>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Período noturno (trabalhador rural)</h2></div>
        <div class="form-grid form-grid-3">
          <label class="campo">Enquadramento<select data-change="perfilNoturno">${opcoes([['pecuaria', 'Pecuária — 20h às 4h'], ['lavoura', 'Lavoura — 21h às 5h'], ['personalizado', 'Personalizado']], c.noturno.perfil)}</select></label>
          <label class="campo">Início<input type="time" data-cfg="noturno.inicio" value="${c.noturno.inicio}"></label>
          <label class="campo">Fim<input type="time" data-cfg="noturno.fim" value="${c.noturno.fim}"></label>
        </div>
        <p class="sub">Lei 5.889/1973, art. 7º. O sistema apenas sinaliza as horas no período noturno para avaliação do adicional; não aplica automaticamente regras do trabalho noturno urbano (como a hora reduzida).</p>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Vigência das regras legais</h2><button class="btn btn-mini" data-acao="addVigencia">+ Adicionar regra</button></div>
        <p class="sub">O limite semanal, a quantidade de repousos e o revezamento dominical são aplicados automaticamente conforme a data da escala.</p>
        <div class="tabela-wrap"><table class="tabela tabela-form">
          <thead><tr><th>Válida a partir de</th><th>Horas/semana</th><th>Repousos/semana</th><th>Domingo de folga ao menos 1× a cada (semanas)</th><th>Descrição / fundamento</th><th></th></tr></thead>
          <tbody>${c.vigencias.map((v, i) => `<tr>
            <td><input type="date" data-vig="${i}" data-campo="inicio" value="${v.inicio}" aria-label="Início da vigência"></td>
            <td><input type="number" min="1" max="60" step="0.5" data-vig="${i}" data-campo="semanalH" value="${v.semanalH}" aria-label="Horas semanais"></td>
            <td><input type="number" min="1" max="7" data-vig="${i}" data-campo="dsr" value="${v.dsr}" aria-label="Repousos por semana"></td>
            <td><input type="number" min="0" max="12" data-vig="${i}" data-campo="domingoSemanas" value="${v.domingoSemanas}" aria-label="Semanas para domingo de folga"></td>
            <td><input data-vig="${i}" data-campo="descricao" value="${esc(v.descricao)}" aria-label="Descrição"></td>
            <td><button class="btn btn-mini btn-perigo-txt" data-acao="remVigencia" data-i="${i}" ${c.vigencias.length < 2 ? 'disabled' : ''}>Remover</button></td></tr>`).join('')}</tbody>
        </table></div>
        <p class="sub">Linha com data em branco = regra aplicada antes das demais. "0" no revezamento dominical desativa essa verificação.</p>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Atividades e cobertura diária</h2><button class="btn btn-mini" data-acao="addAtividade">+ Nova atividade</button></div>
        <div class="tabela-wrap"><table class="tabela tabela-form"><thead><tr><th>Atividade</th><th>Mínimo de pessoas por dia</th><th>Grupo pode ter 1 integrante</th><th></th></tr></thead>
          <tbody>${c.atividades.map((a, i) => `<tr><td><input data-ativ="${i}" data-campo="nome" value="${esc(a.nome)}" aria-label="Nome da atividade"></td>
            <td><input type="number" min="0" max="20" data-ativ="${i}" data-campo="coberturaMinDia" value="${a.coberturaMinDia}" aria-label="Cobertura mínima"></td>
            <td><label class="check"><input type="checkbox" data-ativ="${i}" data-campo="grupoUnitario"${a.grupoUnitario ? ' checked' : ''}> função individual</label></td>
            <td>${a.fixa ? '<span class="sub">padrão</span>' : `<button class="btn btn-mini btn-perigo-txt" data-acao="remAtividade" data-i="${i}">Remover</button>`}</td></tr>`).join('')}</tbody></table></div>
        <p class="sub">A cobertura da ordenha é controlada pelo mínimo de cada turno (tela Turnos). "Função individual" permite grupos com 1 integrante para essa atividade; grupos de ordenha continuam exigindo pelo menos 2.</p>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Convenção / acordo coletivo</h2></div>
        <label class="campo">Anotações sobre o instrumento coletivo aplicável (compensações, regimes especiais etc.)<textarea rows="3" data-cfg="instrumentoColetivo" maxlength="2000">${esc(c.instrumentoColetivo)}</textarea></label>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Dados e segurança</h2></div>
        <p class="sub">Tudo é salvo automaticamente neste navegador (LocalStorage). Use o backup para levar os dados a outro computador.</p>
        <div class="barra">
          <button class="btn" data-acao="exportar">Exportar backup (.json)</button>
          <label class="btn">Importar backup<input type="file" accept="application/json,.json" data-change="importar" hidden></label>
          <button class="btn" data-acao="salvarPonto">Salvar ponto de restauração</button>
          <button class="btn" data-acao="restaurar">Recuperar escala salva… (${pontos.length})</button>
        </div>
        <div class="barra">
          <button class="btn" data-acao="carregarExemplo">Carregar dados de exemplo</button>
          <button class="btn" data-acao="removerExemplo" ${DadosExemplo.existe(E()) ? '' : 'disabled'}>Remover dados de exemplo</button>
          <button class="btn btn-perigo" data-acao="apagarTudo">Apagar todos os dados</button>
        </div>
      </section>

      <section class="card">
        <div class="card-cab"><h2>Referências legais consultadas</h2></div>
        <ul class="lista-links">${RegrasTrabalhistas.LINKS.map((l) => `<li><a href="${l.url}" target="_blank" rel="noopener">${esc(l.rotulo)}</a></li>`).join('')}</ul>
        <p class="sub">As regras ficam centralizadas no módulo <code>RegrasTrabalhistas</code> do arquivo script.js, para facilitar futuras atualizações. ${esc(RegrasTrabalhistas.AVISO_CONFERENCIA)}</p>
      </section>`;
  };

  function abrirRestaurar() {
    const pontos = Store.listarPontos();
    Modal.abrir({
      titulo: 'Recuperar escala salva',
      corpo: pontos.length ? `<p class="sub">Escolha um ponto de restauração. Os dados atuais serão substituídos (um novo ponto com o estado atual é criado antes).</p>
        <ul class="lista-pontos">${pontos.map((p, i) => { const d = new Date(p.em); return `<li><div><strong>${U.pad(d.getDate())}/${U.pad(d.getMonth() + 1)}/${d.getFullYear()} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}</strong><div class="sub">${esc(p.motivo)} · ${p.dados.colaboradores.length} colaboradores · ${Object.keys(p.dados.escala).length} dias com escala</div></div><button class="btn btn-mini btn-pri" data-acao="restaurarPonto" data-i="${i}">Restaurar</button></li>`; }).join('')}</ul>`
        : '<p>Nenhum ponto de restauração ainda. Eles são criados ao clicar em "Salvar ponto de restauração" e automaticamente antes de copiar semanas, limpar períodos, importar ou excluir registros vinculados à escala.</p><p class="sub">Lembrete: a escala atual já fica salva automaticamente e é recuperada ao reabrir o navegador.</p>',
      botoes: [{ rotulo: 'Fechar', classe: 'btn-sec' }],
    });
  }

  /* =============================== AÇÕES (cliques) =============================== */
  const ACOES = {
    navegar: (el) => { ui.pagina = el.dataset.pagina; document.body.classList.remove('menu-aberto'); renderTudo(); window.scrollTo(0, 0); },
    alternarMenu: () => document.body.classList.toggle('menu-aberto'),
    mesAnterior: () => { ui.mes--; if (ui.mes < 1) { ui.mes = 12; ui.ano--; } mudouMes(); },
    mesSeguinte: () => { ui.mes++; if (ui.mes > 12) { ui.mes = 1; ui.ano++; } mudouMes(); },

    novoColab: () => abrirFormColab(null),
    editarColab: (el) => abrirFormColab(el.dataset.id),
    excluirColab: (el) => excluirColab(el.dataset.id),

    novaEquipe: () => abrirFormEquipe(null),
    renomearEquipe: (el) => abrirFormEquipe(el.dataset.id),
    addMembros: (el) => abrirAddMembros(el.dataset.id),
    removerDaEquipe: (el) => { const r = Equipes.mover([el.dataset.id], ''); if (!r.ok) toast(r.msg, 'erro'); else commit('Colaborador removido do grupo.'); },
    moverEquipe: (el) => {
      const lst = E().equipes; const i = lst.findIndex((e) => e.id === el.dataset.id); const j = i + Number(el.dataset.dir);
      if (j < 0 || j >= lst.length) return;
      [lst[i], lst[j]] = [lst[j], lst[i]];
      commit();
    },
    excluirEquipe: async (el) => {
      const e = E().equipes.find((x) => x.id === el.dataset.id);
      const m = Equipes.membros(e.id);
      const ok = await Modal.confirmar(`<p>Excluir o grupo <strong>${esc(e.nome)}</strong>?</p>${m.length ? `<p>Os ${m.length} integrante(s) ficarão "sem equipe". A escala lançada não é apagada.</p>` : ''}`, { titulo: 'Excluir grupo', rotulo: 'Excluir', perigo: true });
      if (!ok) return;
      m.forEach((c) => { c.equipeId = ''; });
      E().equipes = E().equipes.filter((x) => x.id !== e.id);
      commit('Grupo excluído.');
    },

    novoTurno: () => abrirFormTurno(null),
    editarTurno: (el) => abrirFormTurno(el.dataset.id),
    excluirTurno: (el) => excluirTurno(el.dataset.id),

    modoEscala: (el) => { ui.modo = el.dataset.v; renderTudo(); },
    periodoEscala: (el) => {
      ui.periodo = el.dataset.v;
      if (ui.periodo === 'semana') {
        const h = isoParaDia(U.hojeIso());
        const ref = h >= diaIniMes() && h <= diaFimMes() ? h : diaIniMes();
        ui.semanaIni = U.inicioSemana(ref, E().config.inicioSemana);
      }
      renderTudo();
    },
    semana: (el) => {
      ui.semanaIni += 7 * Number(el.dataset.dir);
      const meio = ui.semanaIni + 3;
      const iso = diaParaIso(meio);
      const [a, m] = iso.split('-').map(Number);
      if (a !== ui.ano || m !== ui.mes) { ui.ano = a; ui.mes = m; revalidar(); }
      renderTudo();
    },
    pincel: (el) => { ui.pincel = el.dataset.v; renderTudo(); },
    celula: (el) => aoClicarCelula(el.dataset.c, el.dataset.d),
    celulaTurno: (el) => abrirEditorTurno(el.dataset.t, el.dataset.d),
    sugerirEscala: () => abrirSugestao(),
    copiarSemana: () => abrirCopiarSemana(),
    limparMes: async () => {
      const dias = diasVisiveis();
      const rot = ui.periodo === 'semana' ? `a semana de ${rotuloSemana(dias[0])}` : `${U.NOMES_MESES[ui.mes - 1]}/${ui.ano}`;
      const ok = await Modal.confirmar(`<p>Apagar todos os turnos e folgas de <strong>${rot}</strong>?</p><p class="sub">Um ponto de restauração será criado antes, para você poder desfazer.</p>`, { titulo: 'Limpar escala', rotulo: 'Apagar', perigo: true });
      if (!ok) return;
      Store.criarPonto(`Antes de limpar ${rot}`);
      Escala.limparPeriodo(dias[0], dias[dias.length - 1]);
      commit('Período limpo. Use "Recuperar escala salva" se precisar desfazer.');
    },
    salvarPonto: () => { if (Store.criarPonto('Ponto salvo manualmente')) { toast('Ponto de restauração salvo.', 'sucesso'); renderTudo(); } else toast('Não foi possível salvar (armazenamento cheio?).', 'erro'); },
    restaurar: () => abrirRestaurar(),
    restaurarPonto: async (el) => {
      Modal.fechar();
      const ok = await Modal.confirmar('<p>Substituir os dados atuais por este ponto de restauração?</p>', { titulo: 'Recuperar escala', rotulo: 'Recuperar' });
      if (!ok) return;
      const pontos = Store.listarPontos();
      const alvo = pontos[Number(el.dataset.i)];
      Store.criarPonto('Antes de recuperar um ponto anterior');
      const idx = Store.listarPontos().findIndex((p) => p.em === alvo.em);
      Store.restaurarPonto(idx);
      commit('Escala recuperada.');
    },
    imprimirGrade: () => {
      const dias = diasVisiveis();
      const sub = ui.periodo === 'semana' ? `Semana de ${fmtData(diaParaIso(dias[0]))} a ${fmtData(diaParaIso(dias[6]))}` : `${U.NOMES_MESES[ui.mes - 1]} de ${ui.ano}`;
      imprimir(`<div class="relatorio">${cabRelatorio(`Escala — visão ${ui.modo === 'turno' ? 'por turno' : ui.modo === 'equipe' ? 'por equipe' : 'por colaborador'}`, sub)}<div class="grade-print">${$('#gradeEscala').innerHTML}</div>${rodapeRelatorio()}</div>`);
    },

    revalidar: () => { revalidar(); renderTudo(); toast(`Validação executada: ${contar('vermelho')} irregularidade(s), ${contar('amarelo')} ponto(s) de atenção.`, 'info'); },
    irParaData: (el) => {
      const iso = el.dataset.d;
      const [a, m] = iso.split('-').map(Number);
      ui.ano = a; ui.mes = m; ui.pagina = 'escala'; ui.periodo = 'semana';
      ui.semanaIni = U.inicioSemana(isoParaDia(iso), E().config.inicioSemana);
      if (ui.modo === 'turno') ui.modo = 'colaborador';
      ui.filtroEquipe = '';
      ui.destaque = el.dataset.c ? { cid: el.dataset.c, iso } : null;
      revalidar(); renderTudo(); window.scrollTo(0, 0);
      const alvo = $('.cel.destaque');
      if (alvo) alvo.scrollIntoView({ block: 'center', inline: 'center' });
    },
    relIrregularidades: () => { ui.pagina = 'relatorios'; ui.relTipo = 'irregularidades'; renderTudo(); },

    relTipo: (el) => { ui.relTipo = el.dataset.v; renderTudo(); },
    imprimirRelatorio: () => imprimir(`<div class="relatorio">${$('#areaRelatorio').innerHTML}</div>`),

    addVigencia: () => { E().config.vigencias.push({ id: U.uid('v'), inicio: '', semanalH: 40, dsr: 2, domingoSemanas: 4, descricao: 'Nova regra (descreva o fundamento)' }); commit(); },
    remVigencia: (el) => { E().config.vigencias.splice(Number(el.dataset.i), 1); commit('Regra removida.'); },
    addAtividade: () => { E().config.atividades.push({ id: U.uid('a'), nome: 'Nova atividade', coberturaMinDia: 0, grupoUnitario: false, fixa: false }); commit(); },
    remAtividade: async (el) => {
      const a = E().config.atividades[Number(el.dataset.i)];
      const emUso = E().colaboradores.some((c) => c.atividade === a.id) || E().equipes.some((q) => q.atividade === a.id) || Object.values(E().escala).some((d) => Object.values(d.t).some((l) => l.some((e) => e.a === a.id)));
      if (emUso) { toast(`A atividade "${a.nome}" está em uso por colaboradores ou na escala. Altere esses registros antes de removê-la.`, 'erro'); return; }
      E().config.atividades.splice(Number(el.dataset.i), 1);
      E().turnos.forEach((t) => { t.atividades = (t.atividades || []).filter((x) => x !== a.id); });
      commit('Atividade removida.');
    },
    exportar: () => {
      const blob = new Blob([JSON.stringify(E(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `escala5x2-backup-${U.hojeIso()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Backup exportado.', 'sucesso');
    },
    carregarExemplo: async () => {
      if (DadosExemplo.existe(E())) { toast('Os dados de exemplo já estão carregados.', 'info'); return; }
      const ok = await Modal.confirmar('<p>Adicionar 13 colaboradores e 4 grupos <strong>de exemplo</strong> (3 de ordenha e 1 de camas) (nomes iniciados por "Exemplo"), com uma semana de escala demonstrativa?</p><p class="sub">Seus dados atuais são mantidos. Os exemplos podem ser removidos depois com um clique.</p>', { titulo: 'Carregar exemplos', rotulo: 'Carregar' });
      if (!ok) return;
      Store.criarPonto('Antes de carregar dados de exemplo');
      irParaExemplo(DadosExemplo.carregar(E()));
      commit('Dados de exemplo carregados.');
    },
    removerExemplo: async () => {
      const ok = await Modal.confirmar('<p>Remover todos os colaboradores, grupos e lançamentos de escala <strong>de exemplo</strong>?</p><p class="sub">Os seus dados reais não são alterados.</p>', { titulo: 'Remover exemplos', rotulo: 'Remover' });
      if (!ok) return;
      Store.criarPonto('Antes de remover dados de exemplo');
      DadosExemplo.remover(E());
      commit('Dados de exemplo removidos.');
    },
    apagarTudo: async () => {
      const ok = await Modal.confirmar('<p><strong>Apagar todos os colaboradores, equipes, turnos e escalas</strong> e voltar à configuração inicial?</p><p class="sub">Um ponto de restauração é criado antes. Para guardar uma cópia fora do navegador, exporte o backup primeiro.</p>', { titulo: 'Apagar todos os dados', rotulo: 'Apagar tudo', perigo: true });
      if (!ok) return;
      Store.criarPonto('Antes de apagar todos os dados');
      Store.reiniciar();
      commit('Dados apagados.');
    },
    iniciarComExemplo: () => { Modal.fechar(); irParaExemplo(DadosExemplo.carregar(E())); commit('Dados de exemplo carregados. Substitua-os pelos dados reais quando quiser.'); },
    iniciarVazio: () => { Modal.fechar(); ui.pagina = 'colaboradores'; commit('Comece cadastrando os colaboradores.'); },
  };

  function irParaExemplo(ws) {
    const iso = diaParaIso(ws);
    const [a, m] = iso.split('-').map(Number);
    ui.ano = a; ui.mes = m; ui.pagina = 'escala'; ui.periodo = 'semana'; ui.semanaIni = ws; ui.modo = 'equipe';
  }

  /* =============================== MUDANÇAS (inputs) =============================== */
  const MUDANCAS = {
    mudarMes: (el) => { ui.mes = Number(el.value); mudouMes(); },
    mudarAno: (el) => { const a = Number(el.value); if (a >= 2000 && a <= 2100) { ui.ano = a; mudouMes(); } },
    diaPainel: (el) => { if (el.value) { ui.diaPainel = el.value; renderTudo(); } },
    semanaPainel: (el) => { ui.semanaPainel = Number(el.value); renderTudo(); },
    filtroEquipe: (el) => { ui.filtroEquipe = el.value; renderTudo(); },
    filtroNivel: (el) => { ui.filtroNivel = el.value; renderTudo(); },
    filtroColab: (el) => { ui.filtroColab = el.value; renderTudo(); },
    filtroRegra: (el) => { ui.filtroRegra = el.value; renderTudo(); },
    relSemana: (el) => { ui.relSemana = Number(el.value); renderTudo(); },
    relColab: (el) => { ui.relColab = el.value; renderTudo(); },
    relEquipe: (el) => { ui.relEquipe = el.value; renderTudo(); },
    transferir: (el) => {
      const r = Equipes.mover([el.dataset.id], el.value);
      if (!r.ok) { toast(r.msg, 'erro'); renderTudo(); return; }
      commit('Colaborador transferido.');
    },
    turnoFixoEquipe: (el) => {
      const e = E().equipes.find((x) => x.id === el.dataset.eq);
      e.turnoFixo = el.value;
      if (el.value && !(e.turnos || []).includes(el.value)) e.turnos = [...(e.turnos || []), el.value];
      commit(el.value ? `Turno fixo de "${e.nome}": ${turnoPorId(el.value).nome}. Na montagem, um clique escala os integrantes nesse turno.` : 'Turno fixo removido.');
    },
    atividadeEquipe: (el) => {
      const e = E().equipes.find((x) => x.id === el.dataset.eq);
      const anterior = e.atividade || 'ordenha';
      e.atividade = el.value;
      if (Equipes.membros(e.id).length === 1 && !Equipes.permiteUm(e.id)) {
        e.atividade = anterior;
        toast('Este grupo tem apenas 1 integrante. Para usar uma atividade que exige 2 ou mais, adicione outro integrante antes.', 'erro');
        renderTudo();
        return;
      }
      commit('Atividade do grupo atualizada.');
    },
    turnoEquipe: (el) => {
      const e = E().equipes.find((x) => x.id === el.dataset.eq);
      e.turnos = (e.turnos || []).filter((t) => t !== el.value);
      if (el.checked) e.turnos.push(el.value);
      commit();
    },
    perfilNoturno: (el) => {
      const n = E().config.noturno;
      n.perfil = el.value;
      if (el.value === 'pecuaria') { n.inicio = '20:00'; n.fim = '04:00'; }
      if (el.value === 'lavoura') { n.inicio = '21:00'; n.fim = '05:00'; }
      commit('Período noturno atualizado.');
    },
    importar: (el) => {
      const arq = el.files[0];
      if (!arq) return;
      const leitor = new FileReader();
      leitor.onload = async () => {
        try {
          const dados = JSON.parse(leitor.result);
          if (!dados || !Array.isArray(dados.colaboradores) || !Array.isArray(dados.turnos)) throw new Error('formato');
          const ok = await Modal.confirmar(`<p>Importar o backup <strong>${esc(arq.name)}</strong> (${dados.colaboradores.length} colaboradores)? Os dados atuais serão substituídos.</p><p class="sub">Um ponto de restauração é criado antes.</p>`, { titulo: 'Importar backup', rotulo: 'Importar' });
          if (!ok) return;
          Store.criarPonto('Antes de importar backup');
          Store.substituir(dados);
          commit('Backup importado.');
        } catch {
          toast('Arquivo inválido: selecione um backup .json exportado por este sistema.', 'erro');
        }
      };
      leitor.readAsText(arq);
      el.value = '';
    },
  };

  /** Campos de configuração (data-cfg="caminho"), vigências e atividades */
  function aoMudarConfig(el) {
    const cfg = E().config;
    if (el.dataset.cfg) {
      const caminho = el.dataset.cfg.split('.');
      let alvo = cfg;
      for (let i = 0; i < caminho.length - 1; i++) alvo = alvo[caminho[i]];
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.tipo === 'num') { v = Number(v); if (!Number.isFinite(v)) { toast('Valor inválido.', 'erro'); renderTudo(); return; } }
      alvo[caminho[caminho.length - 1]] = v;
      if (el.dataset.cfg.startsWith('noturno.')) cfg.noturno.perfil = 'personalizado';
      commit();
      return true;
    }
    if (el.dataset.vig != null) {
      const v = cfg.vigencias[Number(el.dataset.vig)];
      const campo = el.dataset.campo;
      v[campo] = ['semanalH', 'dsr', 'domingoSemanas'].includes(campo) ? Number(el.value) || 0 : el.value;
      commit('Regra de vigência atualizada. A validação foi recalculada.');
      return true;
    }
    if (el.dataset.ativ != null) {
      const a = cfg.atividades[Number(el.dataset.ativ)];
      const campo = el.dataset.campo;
      if (campo === 'grupoUnitario') {
        // Não permite desligar se algum grupo dessa atividade já tem só 1 integrante
        if (!el.checked && E().equipes.some((q) => (q.atividade || 'ordenha') === a.id && Equipes.membros(q.id).length === 1)) {
          toast(`Há grupo de "${a.nome}" com apenas 1 integrante. Ajuste esse grupo antes de desligar esta opção.`, 'erro');
          renderTudo();
          return true;
        }
        a.grupoUnitario = el.checked;
      } else a[campo] = campo === 'coberturaMinDia' ? Math.max(0, Number(el.value) || 0) : (el.value.trim() || a.nome);
      commit();
      return true;
    }
    return false;
  }

  function mudouMes() {
    ui.semanaIni = U.inicioSemana(diaIniMes(), E().config.inicioSemana);
    ui.destaque = null;
    revalidar();
    renderTudo();
  }

  /* =============================== EVENTOS =============================== */
  function ligarEventos() {
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('#modalRaiz') && !ev.target.closest('[data-acao]')) return;
      const el = ev.target.closest('[data-acao]');
      if (!el || el.disabled) return;
      const fn = ACOES[el.dataset.acao];
      if (fn) { ev.preventDefault(); fn(el, ev); }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && Modal.aberto) { Modal.fechar(); return; }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('td[data-acao], div[data-acao]')) {
        ev.preventDefault();
        ev.target.click();
      }
    });
    document.addEventListener('change', (ev) => {
      const el = ev.target;
      if (el.closest('#modalRaiz')) return;
      if (el.dataset.change && MUDANCAS[el.dataset.change]) { MUDANCAS[el.dataset.change](el, ev); return; }
      aoMudarConfig(el);
    });
    let tmr = null;
    document.addEventListener('input', (ev) => {
      const el = ev.target;
      if (!el.dataset.input) return;
      clearTimeout(tmr);
      tmr = setTimeout(() => {
        ui[el.dataset.input] = el.value;
        const pos = el.selectionStart;
        renderTudo();
        const novo = $(`[data-input="${el.dataset.input}"]`);
        if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch { /* campo sem seleção */ } }
      }, 200);
    });
  }

  function boasVindas() {
    Modal.abrir({
      titulo: 'Bem-vindo ao sistema de escalas 5x2',
      corpo: `<p>Aqui você organiza colaboradores, equipes e turnos, monta a escala <strong>manualmente</strong> e o sistema confere as escolhas com as regras trabalhistas cadastradas, mostrando alertas e sugestões — sem alterar nada sozinho.</p>
        <p>Os turnos Matutino (05:00–10:30), Vespertino (13:00–18:30) e Noturno (21:00–02:00) já vêm cadastrados e podem ser editados. Cada grupo pode ter um turno fixo: na montagem, basta clicar no dia para escalar a pessoa nesse turno; o dia sem marcação conta como folga.</p>
        <p>Como deseja começar?</p>
        <div class="escolhas">
          <button class="btn btn-pri" data-acao="iniciarComExemplo">Ver com dados de exemplo</button>
          <button class="btn" data-acao="iniciarVazio">Começar sem dados</button>
        </div>
        <p class="sub">Dados de exemplo são identificados como "Exemplo" e podem ser removidos a qualquer momento.</p>`,
      botoes: [],
    });
  }

  function iniciar() {
    const existia = !!Store.carregar();
    if (!existia) Store.reiniciar();
    ui.semanaIni = U.inicioSemana(diaIniMes(), E().config.inicioSemana);
    ligarEventos();
    revalidar();
    renderTudo();
    atualizarStatusSalvo(true);
    if (!existia) boasVindas();
  }

  return { iniciar, _ui: ui, get resultado() { return resultado; } };
})();

/* ==========================================================================
   7. INICIALIZAÇÃO
   ========================================================================== */
document.addEventListener('DOMContentLoaded', UI.iniciar);
