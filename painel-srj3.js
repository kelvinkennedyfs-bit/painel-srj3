/* =============================================================
   PAINEL OPERAÇÃO SRJ3 — Bookmarklet Chrome
   Single-file | Vanilla JS | CSP-safe | Sorting + LMS
   ============================================================= */
(function () {
  'use strict';

  // ── Singleton ──────────────────────────────────────────────
  var ROOT_ID = '__srj3bm__';
  if (document.getElementById(ROOT_ID)) {
    var ex = document.getElementById(ROOT_ID);
    ex.style.display = ex.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  // ── CONFIG ─────────────────────────────────────────────────
  var CFG = {
    facility       : 'SRJ3',
    lmsTarget      : 88,
    bufferAlertMin : 15,
    pkgAlertMax    : 500,
    refreshSec     : 60,
    baseSort : 'https://envios.adminml.com/logistics/sorting/api/monitoring',
    baseLMS  : 'https://lms.adminml.com/api'
  };

  // ── STATE ──────────────────────────────────────────────────
  var S = {
    groups: [], activeGroup: null,
    monitoring: null, heatmap: null,
    delayed: [], lmsLab: [], lmsCont: [],
    today: _today(), fetching: false,
    countdown: CFG.refreshSec, timer: null
  };

  // ── UTILS ──────────────────────────────────────────────────
  function _today() {
    var d = new Date();
    return d.getFullYear() + '-' +
      _p(d.getMonth() + 1) + '-' + _p(d.getDate());
  }
  function _p(n) { return String(n).padStart(2, '0'); }
  function _hhmm() {
    var d = new Date();
    return _p(d.getHours()) + ':' + _p(d.getMinutes());
  }
  function _hhmmss() {
    var d = new Date();
    return _p(d.getHours()) + ':' + _p(d.getMinutes()) + ':' + _p(d.getSeconds());
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _el(id) { return document.getElementById(id); }
  function _set(id, h) { var e = _el(id); if (e) e.innerHTML = h; }
  function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── FETCH ──────────────────────────────────────────────────
  function _fetch(url) {
    return fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
      return r.json();
    });
  }

  // ── FETCH GROUPS ───────────────────────────────────────────
  function fetchGroups() {
    return _fetch(CFG.baseSort + '/groups').then(function (d) {
      S.groups = Array.isArray(d) ? d : [];
      if (S.groups.length && !S.activeGroup)
        S.activeGroup = S.groups[S.groups.length - 1].id;
    }).catch(function(){});
  }

  // ── FETCH MONITORING ───────────────────────────────────────
  function fetchMonitoring(gid) {
    return _fetch(CFG.baseSort + '?group=' + encodeURIComponent(gid) + '&invalidateCache=false')
      .then(function (d) {
        var arr = Array.isArray(d) ? d : [];
        var total = 0, labelled = 0, problem = 0;
        arr.forEach(function (c) {
          total    += c.expectedContainerLoad   || 0;
          labelled += c.totalLabelled           || 0;
          problem  += c.totalNonConveyableLoad  || 0;
        });
        S.monitoring = {
          totalPackages : total,
          pending       : total - labelled,
          withProblem   : problem,
          pph           : 0,
          buffer        : 0
        };
      }).catch(function(){});
  }

  // ── FETCH HEATMAP ──────────────────────────────────────────
  function fetchHeatmap(gid) {
    return _fetch(CFG.baseSort + '/heatmap?groupName=' + encodeURIComponent(gid))
      .then(function (d) {
        S.heatmap = d || {};
        var islands = d && Array.isArray(d.islands) ? d.islands : [];
        var pphT = 0, bufCount = 0;
        islands.forEach(function (i) {
          pphT += i.pph || 0;
          var b = (i.receivedUnits || 0) - (i.sortedUnits || 0);
          if (b > 0) bufCount++;
        });
        if (S.monitoring) {
          S.monitoring.pph    = pphT;
          S.monitoring.buffer = bufCount;
        }
      }).catch(function(){});
  }

  // ── FETCH DELAYED ──────────────────────────────────────────
  function fetchDelayed(gid) {
    return _fetch(CFG.baseSort + '/delayed-packages?groupID=' + encodeURIComponent(gid))
      .then(function (d) { S.delayed = Array.isArray(d) ? d : []; })
      .catch(function(){});
  }

  // ── FETCH LMS ──────────────────────────────────────────────
  function fetchLMS(process) {
    var t = S.today;
    var url = CFG.baseLMS + '/process-monitor/get-reps-by-attributes' +
      '?date_from=' + t + '&date_to=' + t +
      '&time_slot_from=00%3A00%3A00-03%3A00' +
      '&time_slot_to=23%3A59%3A59-03%3A00' +
      '&aggregated_by=Hour&filter_by=&filter_value=' +
      '&facility=' + CFG.facility +
      '&processParent=' + encodeURIComponent(process) +
      '&process='       + encodeURIComponent(process);
    return _fetch(url).then(function (d) {
      var arr = d && d.operators ? d.operators
              : Array.isArray(d) ? d : [];
      if (process === 'labeling')         S.lmsLab  = arr;
      if (process === 'sorting') S.lmsCont = arr;
    }).catch(function(){});
  }

  // ── FETCH ALL ──────────────────────────────────────────────
  function fetchAll() {
    if (S.fetching) return;
    S.fetching = true;
    _dotColor('yellow');

    var onEnvios = location.hostname.includes('envios.adminml.com');
    var onLMS    = location.hostname.includes('lms.adminml.com');

    var promises = [];

    // Sorting — só funciona no envios.adminml.com
    if (onEnvios || (!onEnvios && !onLMS)) {
      promises.push(
        fetchGroups().then(function () {
          if (!S.activeGroup) return;
          var g = S.activeGroup;
          return Promise.all([
            fetchMonitoring(g),
            fetchHeatmap(g),
            fetchDelayed(g)
          ]);
        })
      );
    }

    // LMS — só funciona no lms.adminml.com
    if (onLMS || (!onEnvios && !onLMS)) {
      promises.push(fetchLMS('labeling'));
      promises.push(fetchLMS('sorting'));
    }

    // Se está no envios, tenta LMS também (pode funcionar em alguns casos)
    if (onEnvios) {
      promises.push(fetchLMS('labeling').catch(function(){}));
      promises.push(fetchLMS('sorting').catch(function(){}));
    }

    Promise.all(promises).then(_done).catch(_done);
  }

  function fetchGroup(gid) {
    S.activeGroup = gid;
    S.fetching = true;
    _dotColor('yellow');
    Promise.all([
      fetchMonitoring(gid),
      fetchHeatmap(gid),
      fetchDelayed(gid),
      fetchLMS('labeling').catch(function(){}),
      fetchLMS('sorting').catch(function(){})
    ]).then(_done).catch(_done);
  }

  function _done() {
    S.fetching = false;
    S.countdown = CFG.refreshSec;
    _dotColor('green');
    renderAll();
  }

  function _dotColor(c) {
    var d = _el(ROOT_ID + '_dot');
    if (!d) return;
    d.style.background = c === 'green' ? '#00a650' : c === 'yellow' ? '#f2b705' : '#f23d4f';
  }

  // ── HEATMAP HELPERS ────────────────────────────────────────
  function _hmClass(mins) {
    if (mins === 0)         return 'hm-done';
    if (mins == null)       return 'hm-0';
    if (mins <= 2)  return 'hm-1';  if (mins <= 4)  return 'hm-3';
    if (mins <= 6)  return 'hm-5';  if (mins <= 8)  return 'hm-7';
    if (mins <= 10) return 'hm-9';  if (mins <= 12) return 'hm-11';
    if (mins <= 14) return 'hm-13'; if (mins <= 16) return 'hm-15';
    if (mins <= 18) return 'hm-17'; return 'hm-19';
  }

  function _islMins(isl) {
    var buf = (isl.receivedUnits || 0) - (isl.sortedUnits || 0);
    if (buf <= 0) return 0;
    if (!isl.pph || isl.pph <= 0) return null;
    return Math.round((buf / isl.pph) * 60);
  }

  // ── LMS HELPERS ────────────────────────────────────────────
  function _opName(op) { return op.name || op.representativeName || op.id || '—'; }

  function _opUtil(op) {
    // Sem bipagem — não conta
    if ((!op.attributes || op.attributes === '') && (!op.effective_time || op.effective_time === 0)) return null;
    // no-rep — não conta na média (NÃO SE APLICA)
    if (op.behavioral_strategy === 'no-rep') return null;
    // Calcula utilização: effective_time em segundos / total segundos no turno
    // Usa 8h = 28800s como referência de turno completo
    if (op.effective_time != null && op.effective_time > 0) {
      var pct = Math.round((op.effective_time / 28800) * 100);
      return Math.min(pct, 100);
    }
    return 0;
  }

  function _opStatus(op) {
    if ((!op.attributes || op.attributes === '') && (!op.effective_time || op.effective_time === 0)) {
      return '<span style="background:#2a3a5c;color:#8a9bbf;padding:2px 8px;border-radius:10px;font-size:11px">Sem bipagem</span>';
    }
    if (op.behavioral_strategy === 'no-rep') {
      return '<span style="background:rgba(242,183,5,.15);color:#f2b705;padding:2px 8px;border-radius:10px;font-size:11px">N/A</span>';
    }
    var mins = op.effective_time ? Math.round(op.effective_time / 60) : 0;
    var h = Math.floor(mins / 60), m = mins % 60;
    var tempo = h > 0 ? h + 'h ' + m + 'min' : m + 'min';
    return '<span style="color:#00a650;font-weight:700">● ' + tempo + '</span>';
  }

  function _lmsAvg(arr) {
    if (!arr || !arr.length) return 0;
    var s = 0, c = 0;
    arr.forEach(function (op) {
      // Só conta quem tem rep e tem bipagem
      if (op.behavioral_strategy !== 'rep') return;
      if (!op.effective_time || op.effective_time === 0) return;
      if (!op.attributes || op.attributes === '') return;
      var mins = Math.round(op.effective_time / 60);
      // PPH como proxy de utilização relativa
      var pph = op.effective_productivity || 0;
      if (pph > 0) { s += pph; c++; }
    });
    return c > 0 ? Math.round(s / c) : 0;
  }

  function _lmsColor(pct) {
    return pct >= CFG.lmsTarget ? '#00a650' : pct >= 70 ? '#f2b705' : '#f23d4f';
  }

  function _lmsBar(pct) {
    var col = _lmsColor(pct);
    return '<div style="display:flex;align-items:center;gap:6px;min-width:120px">' +
      '<div style="flex:1;height:8px;background:#2a3a5c;border-radius:4px;overflow:hidden">' +
      '<div style="width:' + _clamp(pct,0,100) + '%;height:8px;background:' + col + '"></div></div>' +
      '<span style="color:' + col + ';font-weight:700;font-size:11px;min-width:34px">' + pct + '%</span>' +
      '</div>';
  }

  // ── KPI CARD ───────────────────────────────────────────────
  function _kpi(icon, label, value, color) {
    return '<div class="p3-kpi" style="--kc:' + color + '">' +
      '<div class="p3-kpi-icon">' + icon + '</div>' +
      '<div class="p3-kpi-val">' + _esc(value) + '</div>' +
      '<div class="p3-kpi-label">' + _esc(label) + '</div>' +
      '</div>';
  }

  // ── ALERT BANCADA ──────────────────────────────────────────
  function _alertBancada() {
    var m = S.monitoring;
    if (!m || m.buffer < CFG.bufferAlertMin || m.totalPackages > CFG.pkgAlertMax) return '';
    return '<div class="p3-alert">⚠️ Buffer alto (' + m.buffer + ' ilhas) com volume baixo (' +
      m.totalPackages + ' pkgs) — Considere <strong>fechar a bancada!</strong></div>';
  }

  // ── CYCLE SELECTOR ─────────────────────────────────────────
  function _cycles() {
    if (!S.groups.length) return '';
    var h = '<div class="p3-cycles">';
    S.groups.forEach(function (g) {
      var act = g.id === S.activeGroup ? ' p3-cycle-act' : '';
      h += '<button class="p3-cycle' + act + '" data-gid="' + _esc(g.id) + '">' +
        _esc(g.name || g.id) + '</button>';
    });
    return h + '</div>';
  }

  function _bindCycles(scopeId) {
    setTimeout(function () {
      var scope = _el(scopeId);
      if (!scope) return;
      scope.querySelectorAll('.p3-cycle').forEach(function (btn) {
        btn.addEventListener('click', function () { fetchGroup(btn.dataset.gid); });
      });
    }, 60);
  }

  // ── HEATMAP GRID ───────────────────────────────────────────
  function _hmGrid(mini) {
    var islands = S.heatmap && Array.isArray(S.heatmap.islands) ? S.heatmap.islands : [];
    if (!islands.length) return '<p class="p3-empty">Nenhuma ilha encontrada.</p>';
    var h = '<div class="p3-hm-grid">';
    islands.forEach(function (isl) {
      var mins = _islMins(isl);
      var buf  = Math.max(0, (isl.receivedUnits || 0) - (isl.sortedUnits || 0));
      var cls  = _hmClass(mins);
      var mLbl = mins === null ? '—' : mins === 0 ? '✓' : mins + 'min';
      h += '<div class="p3-island">' +
        '<div class="p3-isl-hdr ' + cls + '">' + _esc(isl.title || '?') + '</div>' +
        '<div class="p3-isl-bd">' +
        '<div class="p3-irow"><span>⏱</span><b>' + mLbl + '</b></div>' +
        '<div class="p3-irow"><span>📦</span><span>' + buf + '</span></div>' +
        (!mini ? '<div class="p3-irow"><span>⚡</span><span>' + (isl.pph || 0) + '</span></div>' : '') +
        '</div></div>';
    });
    return h + '</div>';
  }

  function _hmLegend() {
    var items = [
      ['hm-done','Concluído'],['hm-0','Sem PPH'],['hm-1','≤2min'],['hm-3','≤4min'],
      ['hm-5','≤6min'],['hm-7','≤8min'],['hm-9','≤10min'],['hm-11','≤12min'],
      ['hm-13','≤14min'],['hm-15','≤16min'],['hm-17','≤18min'],['hm-19','>18min']
    ];
    return '<div class="p3-legend">' + items.map(function (i) {
      return '<div class="p3-leg"><div class="p3-leg-dot ' + i[0] + '"></div><span>' + i[1] + '</span></div>';
    }).join('') + '</div>';
  }

  // ── LMS TABLE ──────────────────────────────────────────────
  function _lmsTable(arr) {
    if (!arr || !arr.length) return '<p class="p3-empty">Sem dados de operadores.</p>';
    
    // Separa: ativos (rep) / N/A (no-rep) / sem bipagem
    var ativos   = arr.filter(function(op){ return op.behavioral_strategy === 'rep' && op.effective_time > 0 && op.attributes; });
    var naAplica = arr.filter(function(op){ return op.behavioral_strategy === 'no-rep'; });
    var semBip   = arr.filter(function(op){ return (!op.attributes || op.attributes === '') && (!op.effective_time || op.effective_time === 0); });

    // Ordena ativos por PPH decrescente
    ativos.sort(function(a,b){ return (b.effective_productivity||0) - (a.effective_productivity||0); });

    var h = '<div class="p3-tbl-wrap"><table class="p3-tbl">' +
      '<thead><tr><th>#</th><th>Operador</th><th>PPH</th><th>Itens</th><th>Tempo Ativo</th><th>Tipo</th></tr></thead><tbody>';

    // Ativos
    ativos.forEach(function(op, i) {
      var pph  = Math.round(op.effective_productivity || 0);
      var mins = Math.round((op.effective_time || 0) / 60);
      var h2   = Math.floor(mins/60), m2 = mins%60;
      var tempo = h2 > 0 ? h2+'h '+m2+'min' : m2+'min';
      var tipo  = op.attributes && op.attributes.includes('non-routed') ? 
        '<span style="color:#9b59b6;font-size:11px">Manual</span>' : 
        '<span style="color:#3483fa;font-size:11px">Rota</span>';
      h += '<tr>' +
        '<td style="color:#6c7a99">' + (i+1) + '</td>' +
        '<td><strong>' + _esc(op.full_name || op.id) + '</strong></td>' +
        '<td><strong style="color:#00a650">' + pph + '</strong>/h</td>' +
        '<td>' + (op.item_count || 0) + '</td>' +
        '<td style="color:#00a650">' + tempo + '</td>' +
        '<td>' + tipo + '</td>' +
        '</tr>';
    });

    // N/A
    if (naAplica.length) {
      h += '<tr><td colspan="6" style="background:#1a2a3a;color:#8a9bbf;font-size:11px;padding:6px 12px;font-weight:700">NÃO SE APLICA — ' + naAplica.length + ' operador(es)</td></tr>';
      naAplica.forEach(function(op) {
        var pph = Math.round(op.effective_productivity || 0);
        var mins = Math.round((op.effective_time || 0) / 60);
        h += '<tr style="opacity:.6">' +
          '<td>—</td>' +
          '<td>' + _esc(op.full_name || op.id) + '</td>' +
          '<td>' + pph + '/h</td>' +
          '<td>' + (op.item_count || 0) + '</td>' +
          '<td>' + mins + 'min</td>' +
          '<td><span style="color:#f2b705;font-size:11px">N/A</span></td>' +
          '</tr>';
      });
    }

    // Sem bipagem
    if (semBip.length) {
      h += '<tr><td colspan="6" style="background:#1a2a3a;color:#8a9bbf;font-size:11px;padding:6px 12px;font-weight:700">SEM BIPAGEM — ' + semBip.length + ' operador(es)</td></tr>';
      semBip.forEach(function(op) {
        h += '<tr style="opacity:.4">' +
          '<td>—</td>' +
          '<td>' + _esc(op.full_name || op.id) + '</td>' +
          '<td colspan="3" style="color:#6c7a99;font-size:11px">Nenhuma bipagem hoje</td>' +
          '<td><span style="color:#6c7a99;font-size:11px">Inativo</span></td>' +
          '</tr>';
      });
    }

    return h + '</tbody></table></div>';
  }

  // ── RENDER ALL ─────────────────────────────────────────────
  function renderAll() {
    renderOverview();
    renderHeatmap();
    renderPendentes();
    renderBancada();
    renderRua();
    renderLMS();
    renderHora();
    renderExportar();
    var cd = _el(ROOT_ID + '_cd');
    if (cd) cd.textContent = S.countdown + 's';
  }

  // ── RENDER: OVERVIEW ───────────────────────────────────────
  function renderOverview() {
    var m = S.monitoring || {};
    var islands = S.heatmap && Array.isArray(S.heatmap.islands) ? S.heatmap.islands : [];
    var actIsl  = islands.filter(function (i) { return (i.pph || 0) > 0; }).length;
    var lmsB    = _lmsAvg(S.lmsLab);

    var h = _cycles() + _alertBancada() +
      '<div class="p3-kpis">' +
      _kpi('📦', 'Total Pacotes', m.totalPackages || 0, '#3483fa') +
      _kpi('⏳', 'Pendentes',     m.pending != null ? m.pending : '—', '#f2b705') +
      _kpi('⚡', 'PPH',           m.pph || 0, '#00a650') +
      _kpi('🗄️', 'Buffer',        m.buffer != null ? m.buffer : '—', m.buffer >= CFG.bufferAlertMin ? '#f23d4f' : '#ff7733') +
      _kpi('🏝️', 'Ilhas Ativas',  actIsl + ' / ' + islands.length, '#9b59b6') +
      _kpi('📊', 'LMS Bancada',   lmsB + '%', _lmsColor(lmsB)) +
      '</div>' +
      '<div class="p3-section-ttl">🗺️ Mapa de Calor (Preview)</div>' +
      _hmGrid(true);

    _set(ROOT_ID + '_b_overview', h);
    _bindCycles(ROOT_ID + '_b_overview');
  }

  // ── RENDER: HEATMAP ────────────────────────────────────────
  function renderHeatmap() {
    var h = _cycles() + _hmGrid(false) + _hmLegend();
    _set(ROOT_ID + '_b_heatmap', h);
    _bindCycles(ROOT_ID + '_b_heatmap');
  }

  // ── RENDER: PENDENTES ──────────────────────────────────────
  function renderPendentes() {
    var list = S.delayed;
    var h = '<div class="p3-kpis">' +
      _kpi('🚨', 'Atrasados', list.length, list.length > 20 ? '#f23d4f' : '#00a650') +
      '</div>';

    if (!list.length) {
      h += '<div class="p3-ok">✅ Nenhum pacote atrasado! Operação fluindo.</div>';
    } else {
      h += '<div class="p3-tbl-wrap"><table class="p3-tbl">' +
        '<thead><tr><th>#</th><th>ID / Referência</th><th>Assignment</th><th>Tipo</th><th>Data</th></tr></thead><tbody>';
      list.forEach(function (p, i) {
        var ref  = p.externalReference || p.packageId || p.id || '—';
        var asgn = p.assignment || p.container || p.cart || '—';
        var tipo = p.isNonConveyable ? 'Não Transportável' : (p.case || p.reason || '—');
        var dt   = p.eventDate ? p.eventDate.replace('T', ' ').slice(0, 16) : '—';
        h += '<tr>' +
          '<td style="color:#6c7a99">' + (i + 1) + '</td>' +
          '<td><code style="color:#f2b705;font-size:11px">' + _esc(ref) + '</code></td>' +
          '<td>' + _esc(asgn) + '</td>' +
          '<td><span class="p3-badge">' + _esc(tipo) + '</span></td>' +
          '<td style="font-size:11px;color:#8a9bbf">' + _esc(dt) + '</td>' +
          '</tr>';
      });
      h += '</tbody></table></div>';
    }
    _set(ROOT_ID + '_b_pendentes', h);
  }

  // ── RENDER: BANCADA ────────────────────────────────────────
  function renderBancada() {
    var m   = S.monitoring || {};
    var avg = _lmsAvg(S.lmsLab);
    var h = _alertBancada() +
      '<div class="p3-kpis">' +
      _kpi('👷', 'Operadores',  S.lmsLab.length, '#3483fa') +
      _kpi('⚡', 'PPH',         m.pph || 0, '#00a650') +
      _kpi('🗄️', 'Buffer',      m.buffer != null ? m.buffer : '—', '#ff7733') +
      _kpi('📊', 'LMS Bancada', avg + '%', _lmsColor(avg)) +
      '</div>' +
      '<div class="p3-section-ttl">👷 Operadores — Labeling</div>' +
      _lmsTable(S.lmsLab);
    _set(ROOT_ID + '_b_bancada', h);
  }

  // ── RENDER: RUA ────────────────────────────────────────────
  function renderRua() {
    var avg = _lmsAvg(S.lmsCont);
    var h = '<div class="p3-kpis">' +
      _kpi('👷', 'Operadores', S.lmsCont.length, '#3483fa') +
      _kpi('📊', 'LMS Rua',    avg + '%', _lmsColor(avg)) +
      '</div>' +
      '<div class="p3-section-ttl">🛣️ Operadores — Containerization</div>' +
      _lmsTable(S.lmsCont);
    _set(ROOT_ID + '_b_rua', h);
  }

  // ── RENDER: LMS ────────────────────────────────────────────
  function renderLMS() {
    var all  = S.lmsLab.concat(S.lmsCont);
    var avgG = _lmsAvg(all);
    var avgB = _lmsAvg(S.lmsLab);
    var avgR = _lmsAvg(S.lmsCont);
    var ofensores = all.filter(function (op) {
      var u = _opUtil(op);
      return u !== null && u < CFG.lmsTarget;
    });

    var h = '<div class="p3-kpis">' +
      _kpi('📈', 'Média Geral', avgG + '%', _lmsColor(avgG)) +
      _kpi('🏭', 'Bancada',    avgB + '%', _lmsColor(avgB)) +
      _kpi('🛣️', 'Rua',         avgR + '%', _lmsColor(avgR)) +
      _kpi('⚠️', 'Ofensores',  ofensores.length, ofensores.length ? '#f23d4f' : '#00a650') +
      '</div>';

    if (ofensores.length) {
      h += '<div class="p3-section-ttl" style="color:#f23d4f">⚠️ Abaixo de ' + CFG.lmsTarget + '%</div>';
      h += _lmsTable(ofensores);
    }

    h += '<div class="p3-section-ttl">🏭 Bancada Completo</div>' + _lmsTable(S.lmsLab);
    h += '<div class="p3-section-ttl">🛣️ Rua Completo</div>'     + _lmsTable(S.lmsCont);
    _set(ROOT_ID + '_b_lms', h);
  }

  // ── RENDER: HORA A HORA ────────────────────────────────────
  function renderHora() {
    var m = S.monitoring || {};
    var pph = m.pph || 0, pend = m.pending != null ? m.pending : 0;
    var avgB = _lmsAvg(S.lmsLab), avgR = _lmsAvg(S.lmsCont);
    var ciclo = S.activeGroup
      ? S.activeGroup.replace(/SRJ3_\d{8}_/, '').replace(/_0$/, '')
      : '—';

    var prevStr = '—';
    if (pph > 0 && pend > 0) {
      var fim = new Date(Date.now() + Math.ceil((pend / pph) * 60) * 60000);
      prevStr = _p(fim.getHours()) + ':' + _p(fim.getMinutes());
    } else if (pend === 0 && m.totalPackages > 0) {
      prevStr = 'Concluído ✅';
    }

    var msg =
      '*📦 Hora a Hora — SRJ3 | ' + ciclo + '*\n' +
      '🕐 ' + _hhmm() + ' | 📅 ' + S.today + '\n\n' +
      '• Total: *' + (m.totalPackages || 0) + '* pkgs\n' +
      '• Pendentes: *' + pend + '* pkgs\n' +
      '• PPH: *' + pph + '*/h\n' +
      '• Buffer: *' + (m.buffer || 0) + '* ilhas\n' +
      '• Atrasados: *' + S.delayed.length + '*\n' +
      '• LMS Bancada: *' + avgB + '%*\n' +
      '• LMS Rua: *' + avgR + '%*\n' +
      '• Previsão: *' + prevStr + '*\n\n' +
      '_Painel SRJ3 — T2_';

    var h = '<div class="p3-kpis">' +
      _kpi('🕐', 'Hora',       _hhmm(), '#3483fa') +
      _kpi('⏳', 'Pendentes',  pend, '#f2b705') +
      _kpi('⚡', 'PPH',        pph, '#00a650') +
      _kpi('🏁', 'Previsão',   prevStr, '#9b59b6') +
      '</div>' +
      '<div class="p3-section-ttl">💬 Mensagem WhatsApp</div>' +
      '<textarea id="' + ROOT_ID + '_msg" class="p3-ta">' + _esc(msg) + '</textarea>' +
      '<div class="p3-btn-row">' +
      '<button class="p3-btn" id="' + ROOT_ID + '_copy">📋 Copiar</button>' +
      '<button class="p3-btn p3-btn-sec" id="' + ROOT_ID + '_upd">🔄 Atualizar</button>' +
      '</div>';

    _set(ROOT_ID + '_b_hora', h);
    setTimeout(function () {
      var bc = _el(ROOT_ID + '_copy');
      var bu = _el(ROOT_ID + '_upd');
      if (bc) bc.addEventListener('click', _copyMsg);
      if (bu) bu.addEventListener('click', function () { fetchAll(); });
    }, 60);
  }

  function _copyMsg() {
    var ta = _el(ROOT_ID + '_msg');
    if (!ta) return;
    ta.select();
    try { document.execCommand('copy'); _toast('✅ Mensagem copiada!'); }
    catch (e) { navigator.clipboard && navigator.clipboard.writeText(ta.value).then(function(){ _toast('✅ Copiada!'); }); }
  }

  // ── RENDER: EXPORTAR ───────────────────────────────────────
  function renderExportar() {
    var cards = [
      { type: 'delayed',  icon: '🚨', title: 'Pendentes',   desc: 'Pacotes atrasados' },
      { type: 'labeling', icon: '🏭', title: 'LMS Bancada', desc: 'Operadores labeling' },
      { type: 'conteiner',icon: '🛣️', title: 'LMS Rua',     desc: 'Operadores containerization' },
      { type: 'overview', icon: '📊', title: 'KPIs Gerais', desc: 'Resumo do painel' }
    ];
    var h = '<div class="p3-exp-grid">';
    cards.forEach(function (c) {
      h += '<div class="p3-exp-card">' +
        '<div style="font-size:28px">' + c.icon + '</div>' +
        '<div style="font-weight:800;font-size:14px;color:#fff">' + c.title + '</div>' +
        '<div style="font-size:11px;color:#8a9bbf">' + c.desc + '</div>' +
        '<button class="p3-btn p3-exp-btn" data-type="' + c.type + '">⬇ Exportar CSV</button>' +
        '</div>';
    });
    h += '</div>';
    _set(ROOT_ID + '_b_exportar', h);
    setTimeout(function () {
      document.querySelectorAll('.' + ROOT_ID + ' .p3-exp-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { _exportCSV(btn.dataset.type); });
      });
    }, 60);
  }

  // ── EXPORT CSV ─────────────────────────────────────────────
  function _exportCSV(type) {
    var rows = [], fname = 'srj3_' + type + '_' + S.today + '.csv';

    if (type === 'delayed') {
      rows.push(['#', 'Referência', 'Assignment', 'Tipo', 'Data']);
      S.delayed.forEach(function (p, i) {
        rows.push([i+1,
          p.externalReference || p.packageId || p.id || '',
          p.assignment || p.container || p.cart || '',
          p.isNonConveyable ? 'Não Transportável' : (p.case || p.reason || ''),
          p.eventDate ? p.eventDate.slice(0, 16) : ''
        ]);
      });
    } else if (type === 'labeling' || type === 'conteiner') {
      var arr = type === 'labeling' ? S.lmsLab : S.lmsCont;
      rows.push(['Operador', 'LMS%', 'PPH Efetivo', 'PPH Líquido']);
      arr.forEach(function (op) {
        rows.push([_opName(op), _opUtil(op) != null ? _opUtil(op) : '',
          Math.round(op.effectiveProductivity || 0),
          Math.round(op.netProductivity || 0)]);
      });
    } else {
      var m = S.monitoring || {};
      rows = [['Campo','Valor'],
        ['Data', S.today], ['Ciclo', S.activeGroup || ''],
        ['Total Pacotes', m.totalPackages || 0],
        ['Pendentes', m.pending || 0],
        ['PPH', m.pph || 0],
        ['Buffer (ilhas)', m.buffer || 0],
        ['Pacotes Atrasados', S.delayed.length],
        ['LMS Bancada%', _lmsAvg(S.lmsLab)],
        ['LMS Rua%', _lmsAvg(S.lmsCont)]
      ];
    }

    var csv = rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
          ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');

    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
    a.download = fname;
    a.click();
    _toast('✅ ' + fname);
  }

  // ── TOAST ──────────────────────────────────────────────────
  function _toast(msg) {
    var t = document.createElement('div');
    t.className = 'p3-toast';
    t.textContent = msg;
    var panel = _el(ROOT_ID + '_panel');
    if (panel) {
      panel.appendChild(t);
      setTimeout(function () { t.remove(); }, 2500);
    }
  }

  // ── TABS ───────────────────────────────────────────────────
  var TABS = ['overview','heatmap','pendentes','bancada','rua','lms','hora','exportar'];

  function _activateTab(id) {
    TABS.forEach(function (t) {
      var btn  = _el(ROOT_ID + '_tab_' + t);
      var body = _el(ROOT_ID + '_b_' + t);
      if (btn)  btn.classList.toggle('p3-tab-act', t === id);
      if (body) body.classList.toggle('p3-body-act', t === id);
    });
  }

  // ── COUNTDOWN ──────────────────────────────────────────────
  function _startCD() {
    if (S.timer) clearInterval(S.timer);
    S.countdown = CFG.refreshSec;
    S.timer = setInterval(function () {
      S.countdown--;
      var cd = _el(ROOT_ID + '_cd');
      if (cd) cd.textContent = S.countdown + 's';
      if (S.countdown <= 0) { S.countdown = CFG.refreshSec; fetchAll(); }
    }, 1000);
  }

  // ── CSS ────────────────────────────────────────────────────
  function _injectCSS() {
    if (_el(ROOT_ID + '_css')) return;
    var s = document.createElement('style');
    s.id  = ROOT_ID + '_css';
    var R = '#' + ROOT_ID;
    var P = '#' + ROOT_ID + '_panel';
    s.textContent = [
      R + '{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(8,10,20,.8);backdrop-filter:blur(6px);font-family:\'Segoe UI\',Arial,sans-serif}',
      P + '{background:#1a1a2e;color:#dde4f0;width:min(98vw,1060px);max-height:94vh;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 60px rgba(0,0,0,.9);border:1.5px solid #2a3a5c;font-size:13px}',
      '.p3-hdr{background:linear-gradient(90deg,#f2b705,#d4a004);color:#1a1a2e;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}',
      '.p3-hdr-logo{font-weight:800;font-size:16px;flex:1}',
      '.p3-hdr-info{font-size:11px;opacity:.8}',
      '.p3-dot{width:9px;height:9px;border-radius:50%;background:#00a650;display:inline-block;margin-right:2px;transition:background .3s}',
      '.p3-btn-hdr{background:rgba(0,0,0,.18);border:none;color:#1a1a2e;width:30px;height:30px;border-radius:7px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center}',
      '.p3-btn-hdr:hover{background:rgba(0,0,0,.35)}',
      '.p3-tabs{background:#16213e;display:flex;overflow-x:auto;border-bottom:2px solid #2a3a5c;flex-shrink:0;scrollbar-width:thin}',
      '.p3-tabs::-webkit-scrollbar{height:3px}',
      '.p3-tab{padding:10px 14px;cursor:pointer;white-space:nowrap;background:none;border:none;color:#8a9bbf;font-size:12px;font-weight:600;border-bottom:3px solid transparent;transition:all .15s}',
      '.p3-tab:hover{color:#f2b705}',
      '.p3-tab-act{color:#f2b705!important;border-bottom-color:#f2b705!important}',
      '.p3-scroll{flex:1;overflow-y:auto;background:#1a1a2e}',
      '.p3-scroll::-webkit-scrollbar{width:5px}',
      '.p3-scroll::-webkit-scrollbar-thumb{background:#2a3a5c;border-radius:3px}',
      '.p3-body{display:none;padding:16px}',
      '.p3-body-act{display:block}',
      '.p3-kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}',
      '.p3-kpi{background:#16213e;border-radius:10px;border-top:3px solid var(--kc,#3483fa);padding:14px 16px;min-width:120px;flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
      '.p3-kpi-icon{font-size:20px}',
      '.p3-kpi-val{font-size:24px;font-weight:800;color:#fff;line-height:1}',
      '.p3-kpi-label{font-size:11px;color:#8a9bbf;text-align:center}',
      '.p3-section-ttl{color:#f2b705;font-size:13px;font-weight:700;margin:16px 0 8px;border-left:3px solid #f2b705;padding-left:8px}',
      '.p3-alert{background:#3a1a0e;border:1px solid #f2994a;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#f2994a;font-size:12px;font-weight:600}',
      '.p3-ok{background:#0a2a1a;border:1px solid #00a650;border-radius:8px;padding:24px;text-align:center;color:#00a650;font-weight:700;font-size:15px}',
      '.p3-empty{color:#8a9bbf;text-align:center;padding:28px;font-size:13px}',
      '.p3-cycles{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}',
      '.p3-cycle{background:#16213e;border:1px solid #2a3a5c;color:#8a9bbf;padding:5px 14px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s}',
      '.p3-cycle:hover,.p3-cycle-act{background:#f2b705!important;color:#1a1a2e!important;border-color:#f2b705!important}',
      '.p3-hm-grid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}',
      '.p3-island{background:#16213e;border-radius:8px;overflow:hidden;width:82px;border:1px solid #2a3a5c}',
      '.p3-isl-hdr{text-align:center;font-weight:800;font-size:16px;color:#fff;padding:6px 4px}',
      '.p3-isl-bd{padding:5px 6px}',
      '.p3-irow{display:flex;justify-content:space-between;font-size:10px;color:#ccd6f0;margin-bottom:2px}',
      '.p3-irow b{color:#fff}',
      '.hm-done{background:#3483fa}.hm-0{background:#6c7a99}',
      '.hm-1{background:#00a650}.hm-3{background:#2db84b}.hm-5{background:#6dd45e}',
      '.hm-7{background:#b5e877}.hm-9{background:#f2e84b}.hm-11{background:#f2c94c}',
      '.hm-13{background:#f2994a}.hm-15{background:#f26c4a}.hm-17{background:#e84040}.hm-19{background:#c0392b}',
      '.p3-legend{display:flex;flex-wrap:wrap;gap:8px;background:#16213e;padding:10px;border-radius:8px;border:1px solid #2a3a5c;margin-top:4px}',
      '.p3-leg{display:flex;align-items:center;gap:5px;font-size:11px;color:#8a9bbf}',
      '.p3-leg-dot{width:13px;height:13px;border-radius:3px;flex-shrink:0}',
      '.p3-tbl-wrap{overflow-x:auto;border-radius:8px;border:1px solid #2a3a5c}',
      '.p3-tbl{width:100%;border-collapse:collapse;font-size:12px}',
      '.p3-tbl thead tr{background:#0f3460}',
      '.p3-tbl th{padding:9px 12px;text-align:left;color:#8a9bbf;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #2a3a5c;white-space:nowrap}',
      '.p3-tbl td{padding:8px 12px;border-bottom:1px solid #1e2d4a;color:#ccd6f0}',
      '.p3-tbl tbody tr:hover td{background:rgba(242,183,5,.06)}',
      '.p3-tbl tbody tr:last-child td{border-bottom:none}',
      '.p3-row-bad td{color:#f26c4a!important}',
      '.p3-badge{background:rgba(242,183,5,.12);color:#f2b705;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}',
      '.p3-ta{width:100%;min-height:180px;background:#0f3460;border:1px solid #2a3a5c;border-radius:8px;color:#e0e6f0;padding:12px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;outline:none;margin-top:4px}',
      '.p3-btn-row{display:flex;gap:8px;margin-top:10px}',
      '.p3-btn{background:#f2b705;color:#1a1a2e;border:none;padding:9px 20px;border-radius:7px;cursor:pointer;font-weight:700;font-size:12px;transition:background .15s}',
      '.p3-btn:hover{background:#d4a004}',
      '.p3-btn-sec{background:#16213e;color:#f2b705;border:1px solid #f2b705}',
      '.p3-btn-sec:hover{background:#0f3460}',
      '.p3-exp-grid{display:flex;flex-wrap:wrap;gap:12px}',
      '.p3-exp-card{background:#16213e;border:1px solid #2a3a5c;border-radius:10px;padding:20px;flex:1;min-width:180px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}',
      '.p3-toast{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:#00a650;color:#fff;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:700;z-index:10;pointer-events:none;white-space:nowrap}'
    ].join(' ');
    document.head.appendChild(s);
  }

  // ── BUILD PANEL ────────────────────────────────────────────
  function _build() {
    _injectCSS();

    var tabDefs = [
      { id:'overview',  label:'🏠 Overview'     },
      { id:'heatmap',   label:'🌡️ Mapa de Calor' },
      { id:'pendentes', label:'⏳ Pendentes'     },
      { id:'bancada',   label:'🏭 Bancada'       },
      { id:'rua',       label:'🛣️ Rua'           },
      { id:'lms',       label:'📊 LMS'           },
      { id:'hora',      label:'🕐 Hora a Hora'   },
      { id:'exportar',  label:'📁 Exportar'      }
    ];

    var tabsH = tabDefs.map(function (t, i) {
      return '<button class="p3-tab' + (i === 0 ? ' p3-tab-act' : '') + '" id="' +
        ROOT_ID + '_tab_' + t.id + '">' + t.label + '</button>';
    }).join('');

    var bodiesH = tabDefs.map(function (t, i) {
      return '<div class="p3-body' + (i === 0 ? ' p3-body-act' : '') + '" id="' +
        ROOT_ID + '_b_' + t.id + '"><p class="p3-empty">Carregando...</p></div>';
    }).join('');

    var root = document.createElement('div');
    root.id  = ROOT_ID;
    root.innerHTML =
      '<div id="' + ROOT_ID + '_panel" style="position:relative">' +
        '<div class="p3-hdr">' +
          '<div class="p3-hdr-logo">📦 Painel Operação SRJ3</div>' +
          '<span class="p3-hdr-info" id="' + ROOT_ID + '_clock">' + _hhmmss() + '</span>' +
          '<span class="p3-hdr-info">⏱ <span id="' + ROOT_ID + '_cd">' + CFG.refreshSec + 's</span></span>' +
          '<span class="p3-dot" id="' + ROOT_ID + '_dot"></span>' +
          '<button class="p3-btn-hdr" id="' + ROOT_ID + '_ref" title="Atualizar">🔄</button>' +
          '<button class="p3-btn-hdr" id="' + ROOT_ID + '_cls" title="Fechar">✕</button>' +
        '</div>' +
        '<div class="p3-tabs">' + tabsH + '</div>' +
        '<div class="p3-scroll">' + bodiesH + '</div>' +
      '</div>';

    document.body.appendChild(root);
    _bindGlobal(root);

    // Relógio
    setInterval(function () {
      var cl = _el(ROOT_ID + '_clock');
      if (cl) cl.textContent = _hhmmss();
    }, 1000);
  }

  function _bindGlobal(root) {
    _el(ROOT_ID + '_cls').addEventListener('click', function () {
      root.style.display = 'none';
    });
    _el(ROOT_ID + '_ref').addEventListener('click', function () {
      S.countdown = CFG.refreshSec; fetchAll();
    });
    root.addEventListener('click', function (e) {
      if (e.target === root) root.style.display = 'none';
    });
    TABS.forEach(function (id) {
      var btn = _el(ROOT_ID + '_tab_' + id);
      if (btn) btn.addEventListener('click', function () { _activateTab(id); });
    });
  }

  // ── INIT ───────────────────────────────────────────────────
  _build();
  fetchAll();
  _startCD();

})();