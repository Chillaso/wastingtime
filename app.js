'use strict';

const WEEKS_PER_YEAR = 365.2425 / 7;
const DAY_NAMES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const STORE_KEY = 'tiempo-por-delante-v1';

const DEFAULTS = {
  age: 35,
  birth: '',
  lifeExp: 83,
  retire: 67,
  workDays: [true, true, true, true, true, false, false],
  workHours: 9,
  sleep: 7.5,
  basics: 3,
  vacation: 36,
  commits: [
    { name: 'Cuidar a un hijo', times: 1, per: 'day', hours: 4, days: [true, true, true, true, true, true, true], from: 36, to: 52 },
  ],
  acts: [
    { name: 'Subir una montaña', times: 2, per: 'year', hours: 10, days: [false, false, false, false, false, true, true], from: '', to: 72 },
    { name: 'Viaje largo', times: 1, per: 'year', hours: 120, days: [true, true, true, true, true, true, true], from: '', to: 80 },
    { name: 'Leer un libro', times: 1, per: 'month', hours: 8, days: [true, true, true, true, true, true, true], from: '', to: 90 },
  ],
};

let state = load();

/* ---------- persistencia ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate({ ...structuredClone(DEFAULTS), ...JSON.parse(raw) });
  } catch (_) { /* sin almacenamiento */ }
  return structuredClone(DEFAULTS);
}
// Compromisos y actividades comparten modelo: veces · periodo · horas/vez · días · edades
function normItem(it) {
  if (it.times === undefined) { it.times = 1; it.per = 'week'; } // compromisos antiguos: h/semana
  if (!it.per) it.per = 'year';
  if (!Array.isArray(it.days) || it.days.length !== 7) it.days = Array(7).fill(true);
  if (it.from === undefined) it.from = '';
  if (it.to === undefined) it.to = '';
  return it;
}
// Cada actividad guarda su propio color (slot 0-7): el color sigue a la actividad, no a su posición
function assignSlots(list) {
  const used = new Set(list.map((it) => it.slot).filter((x) => Number.isInteger(x) && x >= 0));
  list.forEach((it) => {
    if (Number.isInteger(it.slot)) return;
    let free = 0;
    while (used.has(free)) free++;
    it.slot = free < 8 ? free : -1; // a partir de 8 se agrupan en «Otras»
    if (it.slot >= 0) used.add(free);
  });
  return list;
}
const slotColor = (it) => (it.slot >= 0 && it.slot < 8 ? `--s${it.slot + 1}` : '--muted');

function migrate(st) {
  st.commits = (st.commits || []).map(normItem);
  st.acts = assignSlots((st.acts || []).map(normItem));
  return st;
}

/* veces por semana de un compromiso/actividad */
function perWeek(it) {
  const n = num(it.times);
  switch (it.per) {
    case 'day': return n * it.days.filter(Boolean).length;
    case 'week': return n;
    case 'month': return (n * 12) / WEEKS_PER_YEAR;
    default: return n / WEEKS_PER_YEAR;
  }
}
const activeAt = (it, a) => a >= num(it.from, 0) && a < num(it.to, 999);
const PER_TXT = { day: 'al día', week: 'a la semana', month: 'al mes', year: 'al año' };
// los días solo tienen sentido con periodo diario
const usesDays = (it) => it.per === 'day';
function daysTxt(days) {
  const sel = DAY_NAMES.filter((_, i) => days[i]);
  if (sel.length === 7) return 'cualquier día';
  if (sel.join('') === 'LMXJV') return 'de lunes a viernes';
  if (sel.join('') === 'SD') return 'fines de semana';
  return sel.length ? sel.join(' ') : 'ningún día';
}
function describe(it) {
  const h = num(it.hours);
  const from = num(it.from, 0) > 0 ? ` desde los ${fmt(num(it.from))}` : '';
  const to = num(it.to, 0) > 0 ? ` hasta los ${fmt(num(it.to))}` : '';
  return `${fmt(num(it.times), 1)} ${it.times == 1 ? 'vez' : 'veces'} ${PER_TXT[it.per] || 'al año'} · ${fmt(h, 1)} h/vez${usesDays(it) ? ' · ' + daysTxt(it.days) : ''}${from}${to}`;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const num = (v, d = 0) => (Number.isFinite(+v) && v !== '' ? +v : d);
const fmt = (n, dec = 0) =>
  n.toLocaleString('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function currentAge() {
  if (state.birth) {
    const b = new Date(state.birth + 'T00:00:00');
    if (!isNaN(b)) return Math.max(0, (Date.now() - b.getTime()) / (365.2425 * 864e5));
  }
  return Math.max(0, num(state.age));
}

/* ---------- cálculo ---------- */
// Recorre semana a semana desde hoy hasta la esperanza de vida.
function compute() {
  const age = currentAge();
  const lifeExp = num(state.lifeExp, 80);
  const retire = num(state.retire, 67);
  const workDaysN = state.workDays.filter(Boolean).length;
  const offPerWeek = num(state.vacation) / WEEKS_PER_YEAR;
  const effWorkDays = Math.max(0, workDaysN - offPerWeek);
  const sleepW = num(state.sleep) * 7;
  const basicsW = num(state.basics) * 7;
  const workHours = num(state.workHours);

  const t = {
    age, lifeExp, retire,
    weeks: 0, sleep: 0, basics: 0, work: 0, commit: 0, free: 0,
    workFreeDays: 0, workingWeeks: 0, workDaysCount: workDaysN,
    acts: state.acts.map(() => ({ count: 0, hours: 0 })),
    commitsByName: state.commits.map(() => 0),
    over: false,
    years: new Map(),
  };

  const yearsLeft = Math.max(0, lifeExp - age);
  const totalWeeks = yearsLeft * WEEKS_PER_YEAR;
  const fullWeeks = Math.floor(totalWeeks);
  const step = 1 / WEEKS_PER_YEAR;

  for (let i = 0; i < Math.ceil(totalWeeks); i++) {
    const w = i < fullWeeks ? 1 : totalWeeks - fullWeeks; // peso de la última semana parcial
    const a = age + i * step;
    const working = a < retire && workDaysN > 0;
    const work = working ? effWorkDays * workHours : 0;

    let commit = 0;
    state.commits.forEach((c, j) => {
      if (activeAt(c, a)) {
        const h = perWeek(c) * num(c.hours);
        commit += h;
        t.commitsByName[j] += h * w;
      }
    });

    let free = 168 - sleepW - basicsW - work - commit;
    if (free < 0) { t.over = true; free = 0; }

    t.weeks += w;
    t.sleep += sleepW * w;
    t.basics += basicsW * w;
    t.work += work * w;
    t.commit += commit * w;
    t.free += free * w;
    t.workFreeDays += (working ? 7 - effWorkDays : 7) * w;
    if (working) t.workingWeeks += w;

    const yk = Math.floor(a);
    const y = t.years.get(yk) || { weeks: 0, work: 0, commit: 0, free: 0, fixed: 0 };
    y.weeks += w; y.work += work * w; y.commit += commit * w; y.free += free * w;
    y.fixed += (sleepW + basicsW) * w;
    t.years.set(yk, y);

    state.acts.forEach((ac, j) => {
      if (activeAt(ac, a)) {
        const c = perWeek(ac) * w;
        t.acts[j].count += c;
        t.acts[j].hours += c * num(ac.hours);
      }
    });
  }
  return t;
}

/* ---------- render de resultados ---------- */
function render() {
  const t = compute();
  const days = t.weeks * 7;

  $('daysLeft').textContent = fmt(Math.round(days));
  const pct = t.lifeExp > 0 ? Math.min(100, (t.age / t.lifeExp) * 100) : 100;
  $('lifeBar').style.width = pct + '%';
  $('lifePct').textContent =
    `Has vivido el ${fmt(pct, 1)} % · tienes ${fmt(t.age, 1)} años · te quedan ${fmt(Math.max(0, t.lifeExp - t.age), 1)} años`;

  const yearsLeft = Math.max(0, t.lifeExp - t.age);
  const stats = [
    { v: fmt(Math.round(t.free / 24)), l: 'días libres reales (24 h)', cls: 'free' },
    { v: fmt(Math.round(t.free / 16)), l: 'días despierto libres (16 h)', cls: 'free' },
    { v: fmt(Math.round(t.free)), l: 'horas libres en total' },
    { v: fmt(Math.floor(t.weeks)), l: 'fines de semana' },
    { v: fmt(Math.round(t.workFreeDays)), l: 'días sin trabajar' },
    { v: fmt(Math.floor(yearsLeft)), l: 'veranos e inviernos' },
  ];
  $('stats').innerHTML = stats
    .map((s) => `<div class="stat ${s.cls || ''}"><b>${s.v}</b><span>${s.l}</span></div>`)
    .join('');

  // barra de reparto
  const total = t.sleep + t.basics + t.work + t.commit + t.free || 1;
  const parts = [
    { k: 'Dormir', v: t.sleep, c: '--c-sleep' },
    { k: 'Trabajo', v: t.work, c: '--c-work' },
    { k: 'Tareas básicas', v: t.basics, c: '--c-basics' },
    { k: 'Compromisos', v: t.commit, c: '--c-commit' },
    { k: 'Libre', v: t.free, c: '--c-free' },
  ].filter((p) => p.v > 0);
  $('stack').innerHTML = parts
    .map((p) => `<div title="${p.k}: ${fmt(p.v / 24)} días" style="flex-grow:${p.v};background:var(${p.c})"></div>`)
    .join('');
  $('legend').innerHTML = parts
    .map((p) => `<li><i style="background:var(${p.c})"></i>${p.k} <em>${fmt((p.v / total) * 100, 0)} % · ${fmt(p.v / 24)} días</em></li>`)
    .join('');

  const freeWeekNow = t.weeks > 0 ? t.free / t.weeks : 0;
  let note = `De media tendrás unas ${fmt(freeWeekNow, 1)} h libres por semana.`;
  if (t.workingWeeks > 0) {
    note += ` Mientras trabajes (${fmt(t.workingWeeks / WEEKS_PER_YEAR, 1)} años más), el tiempo libre se concentra en ${7 - t.workDaysCount} días por semana y en vacaciones.`;
  }
  if (t.over) note += ' ⚠️ En alguna etapa tus compromisos superan las horas disponibles de la semana.';
  $('freeNote').textContent = note;

  renderVs(t);
  renderAgeChart(t);
  renderActs(t);
  drawGrid(t);
}

/* ---------- obligaciones vs libre ---------- */
function renderVs(t) {
  const oblig = t.work + t.commit;
  const ratio = t.free > 0 ? oblig / t.free : 0;
  $('vs').innerHTML = `
    <div class="side"><b>${fmt(oblig / 24)}</b><span><i style="background:var(--c-work)"></i>días de trabajo + compromisos</span></div>
    <div class="mid">${t.free > 0 ? `<b>${fmt(ratio, 2)} : 1</b>` : '<b>—</b>'}horas de obligación<br>por hora libre</div>
    <div class="side"><b>${fmt(t.free / 24)}</b><span><i style="background:var(--c-free)"></i>días de tiempo libre real</span></div>`;

  const max = Math.max(oblig, t.free, 1);
  const seg = (v, c, tip) =>
    v > 0 ? `<div style="width:${(v / max) * 100}%;background:var(${c})" data-tip="${tip}"></div>` : '';
  const hd = (v) => `${fmt(v)} h · ${fmt(v / 24)} días`;
  $('vsBars').innerHTML = `
    <div class="vs-row"><span>Obligaciones</span><div class="vs-track">
      ${seg(t.work, '--c-work', `<b>Trabajo</b><br>${hd(t.work)}`)}
      ${seg(t.commit, '--c-commit', `<b>Compromisos</b><br>${hd(t.commit)}`)}
    </div></div>
    <div class="vs-row"><span>Tiempo libre</span><div class="vs-track">
      ${seg(t.free, '--c-free', `<b>Tiempo libre real</b><br>${hd(t.free)}`)}
    </div></div>`;

  // medias semanales antes y después de jubilarte
  const agg = (pred) => {
    let wk = 0, ob = 0, fr = 0;
    t.years.forEach((y, a) => { if (pred(a)) { wk += y.weeks; ob += y.work + y.commit; fr += y.free; } });
    return wk > 0 ? { ob: ob / wk, fr: fr / wk } : null;
  };
  const before = agg((a) => a < t.retire);
  const after = agg((a) => a >= t.retire);
  const parts = [];
  if (before) parts.push(`Hasta jubilarte: ${fmt(before.ob, 1)} h/semana de obligaciones frente a ${fmt(before.fr, 1)} h libres.`);
  if (after) parts.push(`Después: ${fmt(after.ob, 1)} h de obligaciones y ${fmt(after.fr, 1)} h libres por semana.`);
  $('vsNote').textContent = parts.join(' ');
}

/* ---------- gráfico por edad ---------- */
function renderAgeChart(t) {
  const rows = [...t.years.entries()]
    .filter(([, y]) => y.weeks > 0.5)
    .sort((a, b) => a[0] - b[0])
    .map(([age, y]) => ({ age, work: y.work / y.weeks, commit: y.commit / y.weeks, free: y.free / y.weeks }));
  const box = $('ageChart');
  if (!rows.length) { box.innerHTML = '<p class="empty">No quedan años que mostrar.</p>'; $('ageLegend').innerHTML = ''; return; }

  const W = 600, H = 210, padL = 30, padR = 4, padT = 8, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(...rows.map((r) => r.work + r.commit + r.free), 1);
  const stepV = maxV > 100 ? 20 : 10;
  const top = Math.ceil(maxV / stepV) * stepV;
  const y = (v) => padT + plotH - (v / top) * plotH;
  const bw = plotW / rows.length;
  const gap = bw > 6 ? 2 : bw > 3 ? 1 : 0;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas por semana de trabajo, compromisos y tiempo libre según la edad">`;
  svg += '<g class="grid">';
  for (let v = 0; v <= top; v += stepV) {
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  }
  svg += '</g>';

  rows.forEach((r, i) => {
    const x = padL + i * bw;
    const w = Math.max(0.5, bw - gap);
    let acc = 0;
    let g = `<g class="col" data-tip="<b>${r.age} años</b><br>Trabajo: ${fmt(r.work, 1)} h/sem<br>Compromisos: ${fmt(r.commit, 1)} h/sem<br>Libre: ${fmt(r.free, 1)} h/sem">`;
    [['work', '--c-work'], ['commit', '--c-commit'], ['free', '--c-free']].forEach(([k, c]) => {
      const v = r[k];
      if (v <= 0) return;
      const y0 = y(acc), y1 = y(acc + v);
      const h = Math.max(0, y0 - y1 - (acc > 0 ? 1 : 0));
      g += `<rect class="seg" x="${x}" y="${y1}" width="${w}" height="${h}" fill="var(${c})"/>`;
      acc += v;
    });
    g += `<rect x="${x}" y="${padT}" width="${bw}" height="${plotH}" fill="transparent"/></g>`;
    svg += g;
    if (r.age % 10 === 0 || i === 0) {
      svg += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${r.age}</text>`;
    }
  });

  const ri = rows.findIndex((r) => r.age >= t.retire);
  if (ri > 0) {
    const x = padL + ri * bw;
    svg += `<line class="now" x1="${x}" x2="${x}" y1="${padT}" y2="${padT + plotH}"/>`;
    svg += `<text x="${x + 4}" y="${padT + 10}">jubilación</text>`;
  }
  svg += '</svg>';
  box.innerHTML = svg;

  $('ageLegend').innerHTML = [
    ['--c-work', 'Trabajo'], ['--c-commit', 'Compromisos'], ['--c-free', 'Tiempo libre'],
  ].map(([c, l]) => `<li><i style="background:var(${c})"></i>${l}</li>`).join('') +
    '<li><em>Sin contar sueño ni tareas básicas</em></li>';
}

/* ---------- actividades sobre el tiempo libre ---------- */
function renderActs(t) {
  const items = state.acts
    .map((ac, j) => ({ ac, r: t.acts[j], j }))
    .filter(({ ac }) => ac.name || num(ac.times));

  if (!items.length) {
    $('actHint').textContent = '';
    $('actStack').innerHTML = '';
    $('actLegend').innerHTML = '';
    $('actResults').innerHTML = '<p class="empty">Añade algo que quieras hacer para ver cuántas veces te queda y cuánto tiempo libre ocupa.</p>';
    return;
  }

  // el orden de la lista manda en la gráfica; el color va con cada actividad
  const color = (j) => slotColor(state.acts[j]);
  const segs = [];
  let others = 0;
  items.forEach(({ ac, r, j }) => {
    if (ac.slot >= 0) segs.push({ name: ac.name || 'Sin nombre', h: r.hours, c: color(j) });
    else others += r.hours;
  });
  if (others > 0) segs.push({ name: 'Otras', h: others, c: '--muted' });
  const planned = segs.reduce((s, x) => s + x.h, 0);
  const rest = Math.max(0, t.free - planned);
  const base = Math.max(t.free, planned, 1);
  const totalLife = t.weeks * 168;
  const pctF = (h) => (t.free > 0 ? fmt((h / t.free) * 100, 1) : '—');
  const pctL = (h) => (totalLife > 0 ? fmt((h / totalLife) * 100, 1) : '—');

  $('actHint').textContent =
    `Tu tiempo libre real son ${fmt(t.free)} h (${fmt(t.free / 24)} días). Tus planes ocupan ${pctF(planned)} % de él.`;

  const stackSegs = segs.filter((s) => s.h > 0).map((s) => ({ ...s, v: s.h }));
  if (rest > 0) stackSegs.push({ name: 'Libre sin planificar', h: rest, v: rest, c: '--c-unplanned' });
  $('actStack').innerHTML = stackSegs
    .map((s) => `<div style="flex-grow:${s.v / base};background:var(${s.c})"
      data-tip="<b>${esc(esc(s.name))}</b><br>${fmt(s.h)} h · ${fmt(s.h / 24, 1)} días<br>${pctF(s.h)} % de tu tiempo libre<br>${pctL(s.h)} % de todo el tiempo que te queda"></div>`)
    .join('');
  $('actLegend').innerHTML = stackSegs
    .map((s) => `<li><i style="background:var(${s.c})"></i>${esc(s.name)} <em>${pctF(s.h)} %</em></li>`)
    .join('');
  const warn = planned > t.free ? '<p class="warn">⚠️ Tus planes necesitan más horas de las que tienes libres.</p>' : '';

  const maxH = Math.max(...items.map(({ r }) => r.hours), 1);
  $('actResults').innerHTML = warn + items.map(({ ac, r, j }) => {
    const onlyWork = usesDays(ac) && state.workDays.some(Boolean) &&
      ac.days.some(Boolean) && ac.days.every((d, i) => !d || state.workDays[i]);
    const n = Math.floor(r.count);
    const detail = n === 0
      ? 'Ya no te quedan, según tu configuración'
      : `${esc(describe(ac))}<br>${fmt(r.hours)} h (${fmt(r.hours / 24, 1)} días) · ${pctF(r.hours)} % de tu tiempo libre` +
        (onlyWork ? '<br><span class="warn-inline">⚠️ Solo en días que trabajas</span>' : '');
    return `<div class="act"><div class="n">${fmt(n)}</div><div class="info">
      <div class="t"><span class="sw" style="background:var(${color(j)})"></span>${esc(ac.name || 'Sin nombre')}</div>
      <div class="d">${detail}</div>
      <div class="bar"><div style="width:${(r.hours / maxH) * 100}%;background:var(${color(j)})"></div></div>
    </div></div>`;
  }).join('');
}

/* ---------- tooltip ---------- */
(function initTip() {
  const tip = $('tip');
  const show = (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = el.getAttribute('data-tip');
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, yy = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, yy) + 'px';
  };
  document.addEventListener('pointermove', show);
  document.addEventListener('pointerdown', show);
  document.addEventListener('pointerleave', () => { tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
})();

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- cuadrícula de semanas ---------- */
function drawGrid(t) {
  // Horizontal: cada columna es un año, cada fila una semana (52 por año)
  const cv = $('grid');
  const years = Math.max(1, Math.ceil(t.lifeExp));
  const rows = 52;
  const width = cv.clientWidth || 800;
  const padL = 22, padB = 16;
  const cell = (width - padL) / years;      // ancho de cada año
  const rowH = Math.min(cell, 9);            // alto de cada semana
  const gap = cell > 4 ? Math.max(1, cell * 0.2) : 0.5;
  const gapY = rowH > 4 ? Math.max(1, rowH * 0.2) : 0.5;
  const plotH = rows * rowH;
  const height = plotH + padB;
  const dpr = window.devicePixelRatio || 1;
  cv.width = width * dpr;
  cv.height = height * dpr;
  cv.style.height = height + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const cPast = css('--c-past');
  const cWork = css('--c-work');
  const cFree = css('--c-retired');
  const cCommit = css('--c-commit');
  const cNow = css('--accent');
  const cMuted = css('--muted');
  const nowWeek = Math.floor(t.age * WEEKS_PER_YEAR);
  const hasWork = state.workDays.some(Boolean);

  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = cMuted;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  [1, 26, 52].forEach((wk) => ctx.fillText(String(wk), padL - 5, (wk - 0.5) * rowH));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  for (let y = 0; y < years; y++) {
    const x = padL + y * cell;
    if (y % 10 === 0) { ctx.fillStyle = cMuted; ctx.fillText(String(y), x + cell / 2, height - 3); }
    for (let w = 0; w < rows; w++) {
      const a = y + w / rows;
      if (a >= t.lifeExp) break;
      const weekIdx = Math.floor(a * WEEKS_PER_YEAR);
      let color;
      if (weekIdx < nowWeek) color = cPast;
      else if (weekIdx === nowWeek) color = cNow;
      else if (state.commits.some((c) => activeAt(c, a) && perWeek(c) * num(c.hours) > 0)) color = cCommit;
      else if (a < t.retire && hasWork) color = cWork;
      else color = cFree;
      ctx.fillStyle = color;
      ctx.fillRect(x, w * rowH, cell - gap, rowH - gapY);
    }
  }

  $('gridLegend').innerHTML = [
    ['--c-past', 'Vivido'],
    ['--accent', 'Esta semana'],
    ['--c-work', 'Trabajando'],
    ['--c-commit', 'Con compromisos'],
    ['--c-retired', 'Jubilado / libre'],
  ].map(([c, l]) => `<li><i style="background:var(${c})"></i>${l}</li>`).join('');
}

/* ---------- formulario ---------- */
const SIMPLE = ['age', 'birth', 'lifeExp', 'retire', 'workHours', 'sleep', 'basics', 'vacation'];

function bindForm() {
  SIMPLE.forEach((k) => {
    const el = $(k);
    el.value = state[k] ?? '';
    el.addEventListener('input', () => {
      state[k] = el.value;
      if (k === 'birth') syncAgeField();
      update();
    });
  });
  syncAgeField();

  const wd = $('workDays');
  wd.innerHTML = '';
  DAY_NAMES.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d;
    b.className = state.workDays[i] ? 'on' : '';
    b.setAttribute('aria-pressed', state.workDays[i]);
    b.addEventListener('click', () => {
      state.workDays[i] = !state.workDays[i];
      b.className = state.workDays[i] ? 'on' : '';
      b.setAttribute('aria-pressed', state.workDays[i]);
      update();
    });
    wd.appendChild(b);
  });

  renderRows('commits', 'itemTpl', state.commits);
  renderRows('acts', 'itemTpl', state.acts);
}

function syncAgeField() {
  const ageEl = $('age');
  if (state.birth) {
    ageEl.disabled = true;
    ageEl.value = currentAge().toFixed(1);
  } else {
    ageEl.disabled = false;
  }
}

let dragState = null;

function renderRows(containerId, tplId, list) {
  const box = $(containerId);
  box.innerHTML = '';
  const tpl = $(tplId);
  list.forEach((item, idx) => {
    const row = tpl.content.firstElementChild.cloneNode(true);
    normItem(item);
    const dbox = row.querySelector('.row-days');
    DAY_NAMES.forEach((d, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d;
      const sync = () => { b.className = item.days[i] ? 'on' : ''; b.setAttribute('aria-pressed', item.days[i]); };
      sync();
      b.addEventListener('click', () => { item.days[i] = !item.days[i]; sync(); update(); });
      dbox.appendChild(b);
    });
    const syncDays = () => { dbox.hidden = !usesDays(item); };
    syncDays();
    row.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      el.value = item[k] ?? '';
      el.addEventListener('input', () => { item[k] = el.value; update(); });
      el.addEventListener('change', () => { item[k] = el.value; syncDays(); update(); });
    });
    row.querySelector('.del').addEventListener('click', () => {
      list.splice(idx, 1);
      renderRows(containerId, tplId, list);
      update();
    });

    // color de la actividad junto a su nombre
    const sw = row.querySelector('.row-sw');
    if (list === state.acts) { assignSlots(list); sw.style.background = `var(${slotColor(item)})`; }
    else sw.remove();

    // reordenar: flechas y arrastrar desde el asa
    const move = (to) => {
      if (to < 0 || to >= list.length || to === idx) return;
      const [it] = list.splice(idx, 1);
      list.splice(to, 0, it);
      renderRows(containerId, tplId, list);
      update();
      const btn = box.children[to]?.querySelector(to < idx ? '.up' : '.down');
      (btn && !btn.disabled ? btn : box.children[to]?.querySelector('.name'))?.focus();
    };
    const up = row.querySelector('.up'), down = row.querySelector('.down');
    up.disabled = idx === 0;
    down.disabled = idx === list.length - 1;
    up.addEventListener('click', () => move(idx - 1));
    down.addEventListener('click', () => move(idx + 1));

    const handle = row.querySelector('.handle');
    handle.addEventListener('pointerdown', () => { row.draggable = true; });
    handle.addEventListener('pointerup', () => { row.draggable = false; });
    row.addEventListener('dragstart', (e) => {
      dragState = { list, idx };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      box.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
      dragState = null;
    });
    row.addEventListener('dragover', (e) => {
      if (!dragState || dragState.list !== list) return;
      e.preventDefault();
      const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      if (!dragState || dragState.list !== list) return;
      e.preventDefault();
      const from = dragState.idx;
      let to = idx + (row.classList.contains('drop-after') ? 1 : 0);
      if (from < to) to--;
      if (from !== to) {
        const [it] = list.splice(from, 1);
        list.splice(to, 0, it);
        renderRows(containerId, tplId, list);
        update();
      }
    });

    box.appendChild(row);
  });
}

function update() {
  assignSlots(state.acts);
  save();
  render();
}

$('addCommit').addEventListener('click', () => {
  const a = Math.round(currentAge());
  state.commits.push(normItem({ name: '', times: 1, per: 'day', hours: 2, from: a, to: a + 5 }));
  renderRows('commits', 'itemTpl', state.commits);
  update();
  $('commits').lastElementChild.querySelector('.name').focus();
});
$('addAct').addEventListener('click', () => {
  state.acts.push(normItem({ name: '', times: 1, per: 'year', hours: 4, to: Math.round(num(state.lifeExp, 80)) }));
  renderRows('acts', 'itemTpl', state.acts);
  update();
  $('acts').lastElementChild.querySelector('.name').focus();
});
$('reset').addEventListener('click', () => {
  if (!confirm('¿Restablecer todos los valores de ejemplo? Perderás tu configuración.')) return;
  state = structuredClone(DEFAULTS);
  bindForm();
  update();
});

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 120); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);

bindForm();
render();
