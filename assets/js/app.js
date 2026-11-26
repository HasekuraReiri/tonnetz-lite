/* ==========================================================================
   app.js — 应用控制器：状态、界面、和弦进行、路由、联动
   ========================================================================== */

import {
  analyzeChord, harmonicFunction, keySpell, makeKey, mod12, pcName, pcSet,
  pcMask, parseInput, REFERENCE_PAIRS, ROMAN, nameOf, MODE_DEFS, MODE_BY_ID,
  degreeOf, noteToPc, pairName, setInfo, FLAT_NAMES, relativeMajorOf, keySignature, functionColor,
} from './core.js';
import { audio } from './audio.js';
import { TonnetzView } from './tonnetz.js';
import { analyzeSatb, midiName } from './satb.js';
import { buildMidi, midiFilename } from './midi.js';

let satbTimers = [];
let satbPlayToken = 0;

const DEFAULT_STAGE_HINT = '<kbd>拖动</kbd> 平移 · <kbd>滚轮</kbd> 缩放 · <kbd>点击三角形</kbd> 选择和弦 · <kbd>点击音名/圆点</kbd> 选择音符';

const STEP_COLORS = [
  '#3457d5', '#b5483f', '#b07a22', '#25796b', '#6a5acd', '#c2547e',
  '#6f7f2a', '#3d7fa6', '#8a5a3b', '#8e4a86', '#3f7d4e', '#4e5a6a',
];

export const state = {
  naming: 'reference',
  keyEnabled: true,
  keyTonic: 0,
  keyMode: 'major',
  key: null,
  selection: null,
  steps: [],
  activeStep: -1,
  playing: false,
  seqEnded: false,
  loop: false,
  tempo: 84,
  sound: true,
  showFunctions: true,
  showDegrees: true,
  showChordNames: false,
  circleMode: 'fifths',
  satbMode: false,
  satb: null,
  satbSpeed: 1.6,
  satbHistory: 1,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const app = {
  state, audio,
  view: null,
  toast, showTooltip, hideTooltip, openModal, closeModal,
  selectTriad, toggleNote, selectStep,
  addSelectionToSequence, loadSequenceText, playSequence, stopSequence,
  playSelection, setKey, setNaming, refreshUI, formatKey,
  openSequenceEditor, openHelp, circleHover, setCircleMode,
  openSatbModal, openMidiExportModal, enableSatbMode, disableSatbMode,
  setSelection, clearSelection,
};

window.TN = app;

/* ---------------------------------------------------------------- boot */

let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  const loader = document.createElement('div');
  loader.className = 'boot-loading';
  loader.innerHTML = `<div class="boot-card">
      <div class="boot-anim"><span></span><span></span><span></span></div>
      <strong>Tonnetz Lite</strong>
      <small id="bootMsg">正在启动…</small>
    </div>`;
  document.body.appendChild(loader);
  try {
    state.key = state.keyEnabled ? makeKey(state.keyTonic, state.keyMode) : null;
    try {
      const savedCircle = localStorage.getItem('tonnetz-lite:circleMode');
      if (savedCircle === 'chromatic' || savedCircle === 'fifths') state.circleMode = savedCircle;
    } catch (e) { /* ignore */ }
    initNaming();
    initKeyPanel();
    initTonnetz();
    initCircleSwitch();
    initSelectionPanel();
    initInput();
    initSequence();
    initToggles();
    initSatbControls();
    initTopActions();
    refreshUI();
    applyDeepLinks();
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 420);
  } catch (err) {
    console.error(err);
    loader.remove();
    const box = $('#bootError');
    box.hidden = false;
    box.textContent = '启动失败：' + (err && err.message ? err.message : err) + '\n请通过启动器（本地服务器）打开，而不是直接双击 index.html。';
  }
}

/* --------------------------------------------------------------- naming */

function initNaming() {
  $$('#namingSwitch button').forEach(btn => {
    btn.addEventListener('click', () => setNaming(btn.dataset.naming));
  });
}

function setNaming(mode) {
  if (state.naming === mode) return;
  state.naming = mode;
  $$('#namingSwitch button').forEach(b => b.classList.toggle('on', b.dataset.naming === mode));
  if (app.view) app.view.setState({ naming: mode });
  refreshUI();
}

/* ------------------------------------------------------------------ key */

function initKeyPanel() {
  const toneSel = $('#keyTonic');
  toneSel.innerHTML = Array.from({ length: 12 }, (_, pc) => {
    const p = pairName(pc);
    const label = p[1] ? `${p[1]} / ${p[0]}` : p[0];
    return `<option value="${pc}">${label}</option>`;
  }).join('');
  toneSel.value = String(state.keyTonic);

  const modeSel = $('#keyMode');
  const groups = [
    ['大小调系统', ['major', 'minor', 'harmonicMinor', 'melodicMinor', 'harmonicMajor', 'melodicMajor']],
    ['教会调式', ['dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian']],
  ];
  modeSel.innerHTML = groups.map(([label, ids]) =>
    `<optgroup label="${label}">${ids.map(id => `<option value="${id}">${MODE_BY_ID[id].name}</option>`).join('')}</optgroup>`
  ).join('');
  modeSel.value = state.keyMode;

  toneSel.addEventListener('change', () => {
    state.keyTonic = Number(toneSel.value);
    setKey();
  });
  modeSel.addEventListener('change', () => {
    state.keyMode = modeSel.value;
    setKey();
  });
  $('#keyEnabled').addEventListener('change', ev => {
    state.keyEnabled = ev.target.checked;
    setKey();
  });
}

function setKey() {
  state.key = state.keyEnabled ? makeKey(state.keyTonic, state.keyMode) : null;
  recomputeKeyState();
  if (app.view) app.view.setState({ key: state.key });
  refreshUI();
  refreshSatbMode({ silent: true });
}

function formatKey(k) {
  if (!k) return '无调性';
  const sp = keySpell(k);
  const rel = relativeMajorOf(k);
  const sigObj = keySignature(rel);
  const sig = sigObj.sharps ? `♯×${sigObj.sharps}` : sigObj.flats ? `♭×${sigObj.flats}` : '♮';
  return `${sp.tonicName} ${k.mode.short} · ${sig}`;
}

/* -------------------------------------------------------------- tonnetz */

function initTonnetz() {
  const canvas = $('#tonnetzCanvas');
  const circleCanvas = $('#circleCanvas');
  app.view = new TonnetzView({ canvas, circleCanvas, app });
  app.view.setState({
    key: state.key, naming: state.naming, selection: state.selection,
    steps: state.steps, activeStep: state.activeStep,
    circleMode: state.circleMode,
    satbMode: state.satbMode, satb: state.satb, satbDur: state.satbSpeed, satbHistory: state.satbHistory,
    showFunctions: state.showFunctions, showDegrees: state.showDegrees, showChordNames: state.showChordNames,
  });
  app.onZoom = z => {
    const el = $('#zoomLabel');
    if (el) el.textContent = Math.round(z * 100) + '%';
  };
  $$('[data-zoom]').forEach(btn => btn.addEventListener('click', () => {
    const v = btn.dataset.zoom;
    if (v === 'in') app.view.zoomBy(1.18);
    else if (v === 'out') app.view.zoomBy(1 / 1.18);
    else app.view.resetView();
  }));
}

function initCircleSwitch() {
  const wrap = $('#circleSwitch');
  if (!wrap) return;
  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => setCircleMode(btn.dataset.circle));
  });
  syncCircleModeUI();
}

function syncCircleModeUI() {
  const wrap = $('#circleSwitch');
  if (wrap) {
    wrap.querySelectorAll('button').forEach(btn => btn.classList.toggle('on', btn.dataset.circle === state.circleMode));
  }
  const title = $('#circleTitle');
  if (title) title.textContent = state.circleMode === 'chromatic' ? '十二平均律圈' : '五度圈';
}

function setCircleMode(mode) {
  if (mode !== 'fifths' && mode !== 'chromatic') return;
  if (state.circleMode === mode) { syncCircleModeUI(); return; }
  state.circleMode = mode;
  try { localStorage.setItem('tonnetz-lite:circleMode', mode); } catch (e) { /* ignore */ }
  syncCircleModeUI();
  if (app.view) app.view.setState({ circleMode: mode });
  toast(mode === 'fifths' ? '已切换到五度圈' : '已切换到十二平均律圈 · 功能与五度圈一致');
}

function initToggles() {  const map = [
    ['tglFunctions', 'showFunctions'],
    ['tglDegrees', 'showDegrees'],
    ['tglChordNames', 'showChordNames'],
  ];
  for (const [id, key] of map) {
    const el = $('#' + id);
    el.checked = state[key];
    el.addEventListener('change', () => {
      state[key] = el.checked;
      if (app.view) app.view.setState({ [key]: el.checked });
    });
  }
  const satb = $('#tglSatb');
  if (satb) {
    satb.checked = !!state.satbMode;
    satb.addEventListener('change', () => {
      if (satb.checked) enableSatbMode();
      else disableSatbMode();
    });
  }
  syncSatbUI();
}

/* ------------------------------------------------------- satb grid mode */

function initSatbControls() {
  const speed = $('#satbSpeed');
  const speedVal = $('#satbSpeedVal');
  const retain = $('#satbRetain');
  if (!speed || !retain) return;
  speed.value = String(state.satbSpeed);
  if (speedVal) speedVal.textContent = state.satbSpeed.toFixed(1) + 's';
  retain.value = String(state.satbHistory);
  speed.addEventListener('input', () => {
    state.satbSpeed = Number(speed.value);
    if (speedVal) speedVal.textContent = state.satbSpeed.toFixed(1) + 's';
    if (app.view) app.view.setSatbDuration(state.satbSpeed);
  });
  retain.addEventListener('change', () => {
    state.satbHistory = Number(retain.value);
    if (app.view) app.view.setState({ satbHistory: state.satbHistory });
  });
  syncSatbUI();
}

function syncSatbUI() {
  const tgl = $('#tglSatb');
  if (tgl) tgl.checked = !!state.satbMode;
  const strip = $('#satbControls');
  if (strip) strip.hidden = !state.satbMode;
  const speed = $('#satbSpeed');
  const speedVal = $('#satbSpeedVal');
  if (speed) speed.value = String(state.satbSpeed);
  if (speedVal) speedVal.textContent = state.satbSpeed.toFixed(1) + 's';
  const retain = $('#satbRetain');
  if (retain) retain.value = String(state.satbHistory);
  const hint = $('.stage-hint');
  if (hint) {
    hint.classList.toggle('satb-hint', !!state.satbMode);
    if (state.satbMode) {
      const warn = state.satb && !state.satb.strictOk ? ' · <b>最佳近似</b>' : '';
      hint.innerHTML = `<i class="sv sv-S">S</i> 女高音 · <i class="sv sv-A">A</i> 女低音 · <i class="sv sv-T">T</i> 男高音 · <i class="sv sv-B">B</i> 男低音 · 播放时显示声部移动${warn}`;
    } else {
      hint.innerHTML = DEFAULT_STAGE_HINT;
    }
  }
}

function enableSatbMode(opts = {}) {
  const silent = !!opts.silent;
  if (!state.steps.length) {
    state.satbMode = false;
    state.satb = null;
    syncSatbUI();
    if (!silent) toast('请先编辑和弦进行，再开启四声部');
    return false;
  }
  const res = analyzeSatb(state.steps, { key: state.key, tempo: state.tempo });
  if (!res.ok || !res.voices.length) {
    state.satbMode = false;
    state.satb = null;
    if (app.view) app.view.setState({ satbMode: false, satb: null });
    syncSatbUI();
    if (!silent) {
      toast('当前进行无法生成四声部，已打开检查面板');
      openSatbModal();
    }
    return false;
  }
  state.satbMode = true;
  state.satb = res;
  if (app.view) app.view.setState({ satbMode: true, satb: res });
  if (state.activeStep < 0 || state.activeStep >= state.steps.length) {
    selectStep(0, { play: false });
  } else {
    if (app.view) app.view.setState({ activeStep: state.activeStep });
  }
  syncSatbUI();
  if (!silent) {
    toast(res.strictOk ? '四声部已显示在网格上' : '四声部已显示；当前为最佳近似，严格检查见「四部和声」');
  }
  return true;
}

function disableSatbMode(opts = {}) {
  const silent = !!opts.silent;
  state.satbMode = false;
  state.satb = null;
  if (app.view) app.view.setState({ satbMode: false, satb: null });
  syncSatbUI();
  if (!silent) toast('已关闭四声部显示');
}

function refreshSatbMode(opts = {}) {
  if (!state.satbMode) return;
  if (!state.steps.length) {
    disableSatbMode({ silent: true });
    return;
  }
  const res = analyzeSatb(state.steps, { key: state.key, tempo: state.tempo });
  if (!res.ok || !res.voices.length) {
    disableSatbMode({ silent: true });
    if (!opts.silent) toast('四声部已关闭：当前进行没有可用的四声部');
    return;
  }
  state.satb = res;
  if (app.view) app.view.setState({ satbMode: true, satb: res });
  syncSatbUI();
  if (!res.strictOk && !opts.silent) toast('当前四声部为最佳近似，严格问题见「四部和声」');
}

function playStepAudio(step, i, duration) {
  if (!step) return;
  const dur = duration || Math.min(2.2, stepSeconds() * 0.95);
  if (state.satbMode && state.satb && state.satb.voices && state.satb.voices[i]) {
    const v = state.satb.voices[i];
    audio.playVoicing([v.S, v.A, v.T, v.B], { duration: dur, timbre: 'strings', velocity: 0.8 });
  } else {
    audio.playChord(step.pcs, step.bass, { duration: dur, velocity: 0.9 });
  }
}

function playSatbOnGrid(res) {
  if (!res || !res.voices || !res.voices.length) return;
  state.satb = res;
  state.satbMode = true;
  if (app.view) app.view.setState({ satbMode: true, satb: res });
  syncSatbUI();
  closeModal();
  if (state.playing) stopSequence();
  state.activeStep = 0;
  state.seqEnded = false;
  playSequence();
}

/* ----------------------------------------------------------- selection */

function initSelectionPanel() {
  $('#playSelBtn').addEventListener('click', () => playSelection());
  $('#clearSelBtn').addEventListener('click', () => clearSelection());
  $('#selBody').addEventListener('click', ev => {
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'add-seq') addSelectionToSequence();
    if (act.dataset.act === 'play') playSelection();
    if (act.dataset.act === 'copy') {
      if (navigator.clipboard && state.selection) {
        navigator.clipboard.writeText(state.selection.chord ? state.selection.chord.symbol : state.selection.pcs.join(','));
        toast('已复制和弦名');
      }
    }
  });
}

function buildSelection({ kind = 'chord', pcs, bass = null, chord = null, source = 'input', tri = null, color = null, spelling = null }) {
  if (!pcs || !pcs.length) return null;
  pcs = pcSet(pcs);
  const spell = spelling || (state.key ? keySpell(state.key) : 'flat');
  const c = chord || (pcs.length > 1 ? analyzeChord(pcs, bass, spell) : null);
  const fn = state.key && c ? harmonicFunction(c, state.key) : null;
  const useBass = bass != null ? bass : (c && c.root != null ? c.root : null);
  return {
    kind, pcs, bass: useBass, chord: c, fn, tri, source,
    color: color || (fn && fn.group && fn.group !== '?' ? functionColor(fn.group) : '#3457d5'),
    spelling: spell,
    set: setInfo(pcs),
    displayLabel: c ? c.symbol : (kind === 'note' ? nameOf(pcs[0], spell) : `[${pcs.join(',')}]`),
  };
}

function recomputeKeyState() {
  const spell = state.key ? keySpell(state.key) : 'flat';
  if (state.selection) {
    const sel = state.selection;
    if (sel.pcs.length > 1) {
      const c = analyzeChord(sel.pcs, sel.bass, spell);
      sel.chord = c;
      sel.fn = state.key ? harmonicFunction(c, state.key) : null;
      sel.displayLabel = c ? c.symbol : sel.displayLabel;
    } else {
      sel.chord = null;
      sel.fn = null;
      sel.displayLabel = nameOf(sel.pcs[0], spell);
    }
    sel.spelling = spell;
    if (sel.source !== 'sequence') {
      sel.color = sel.fn && sel.fn.group && sel.fn.group !== '?' ? functionColor(sel.fn.group) : '#3457d5';
    }
  }
  for (const step of state.steps) {
    if (step.pcs.length > 1) {
      const c = analyzeChord(step.pcs, step.bass, spell);
      step.chord = c;
      step.fn = state.key ? harmonicFunction(c, state.key) : null;
      step.label = c ? c.symbol : step.label;
    } else {
      step.chord = null;
      step.fn = null;
      step.label = nameOf(step.pcs[0], spell);
    }
    step.spelling = spell;
  }
}

function setSelection(sel, opts = {}) {
  state.selection = sel;
  if (sel && sel.tri && app.view) {
    /* 点击三角形时滚动到中心附近，防止选中区域在视口外 */
  }
  if (app.view) {
    app.view.setState({ selection: sel });
  }
  refreshSelectionUI();
  refreshSequenceUI();
  if (opts.play) playSelection();
}

function clearSelection() {
  setSelection(null);
  setInputs('');
  if ($('#inputError')) $('#inputError').textContent = '';
}

function selectTriad(hit) {
  const { pcs, root } = hit;
  const sel = buildSelection({
    kind: 'chord', pcs, bass: root, source: 'grid',
    tri: { i: hit.i, j: hit.j, up: hit.up },
  });
  setSelection(sel, { play: true });
  setInputs(sel.chord ? sel.chord.symbol : '');
}

function toggleNote(pc, ev) {
  pc = mod12(pc);
  let pcs = state.selection ? [...state.selection.pcs] : [];
  const had = pcs.includes(pc);
  if (had) pcs = pcs.filter(x => x !== pc);
  else pcs.push(pc);
  if (!pcs.length) { clearSelection(); return; }
  const bass = state.selection && state.selection.bass != null && pcs.includes(state.selection.bass)
    ? state.selection.bass : null;
  const sel = buildSelection({ kind: pcs.length === 1 ? 'note' : 'set', pcs, bass, source: 'grid' });
  setSelection(sel, { play: false });
  if (pcs.length === 1) audio.playNote(60 + pc);
  else playSelection();
  setInputs(pcs.map(p => (state.naming === 'integer' ? p : pcName(p, sel.spelling))).join(' '));
}

function playSelection() {
  const sel = state.selection;
  if (!sel) { toast('先选择一个和弦或音集'); return; }
  audio.playChord(sel.pcs, sel.bass, { duration: 2.0, velocity: 0.9 });
}

/* --------------------------------------------------------------- input */

function initInput() {
  $('#inputForm').addEventListener('submit', ev => {
    ev.preventDefault();
    applyInput($('#selInput').value);
  });
  const quickForm = $('#quickInputForm');
  if (quickForm) {
    quickForm.addEventListener('submit', ev => {
      ev.preventDefault();
      const v = $('#quickInput').value.trim();
      if (!v) return;
      applyInput(v);
    });
  }
  $$('#inputExamples button').forEach(btn => {
    btn.addEventListener('click', () => {
      setInputs(btn.dataset.sample);
      applyInput(btn.dataset.sample);
      $('#selInput').focus();
    });
  });
}

function setInputs(value) {
  for (const sel of ['#selInput', '#quickInput']) {
    const el = $(sel);
    if (el && document.activeElement !== el) el.value = value;
  }
}

function applyInput(raw, opts = {}) {
  const spell = state.key ? keySpell(state.key) : 'flat';
  const parsed = parseInput(raw, spell);
  const errEl = $('#inputError');
  if (!parsed.ok) {
    if (errEl) errEl.textContent = parsed.error;
    toast(parsed.error);
    return;
  }
  if (errEl) errEl.textContent = '';
  setInputs(raw);
  const sel = buildSelection({
    kind: parsed.kind, pcs: parsed.pcs, bass: parsed.bass,
    chord: parsed.chord, source: 'input',
  });
  setSelection(sel, { play: opts.play !== false });
}

/* --------------------------------------------------------------- refresh */

function refreshUI() {
  const badge = $('#stageBadge');
  if (badge) badge.textContent = formatKey(state.key);
  const keyScale = $('#keyScale');
  if (keyScale) {
    if (!state.key) {
      keyScale.innerHTML = '<span class="key-off">功能分析已关闭</span>';
    } else {
      const spell = keySpell(state.key);
      keyScale.innerHTML = state.key.pcs.map((pc, i) =>
        `<span class="${pc === state.key.tonic ? 'tonic' : ''}">${esc(nameOf(pc, spell))}${i === 0 ? '' : ''}</span>`
      ).join('');
    }
  }
  const fl = $('#funcLegend');
  if (fl) {
    fl.innerHTML = state.key
      ? `<span><i style="background:var(--tone-t)"></i>T 主</span><span><i style="background:var(--tone-s)"></i>S 下属</span><span><i style="background:var(--tone-d)"></i>D 属</span><span><i style="background:#b9b4a6"></i>调外 / 变化</span>`
      : '';
  }
  const cml = $('#circleModeLabel');
  if (cml) cml.textContent = state.key ? formatKey(state.key) : '无调性';
  refreshSelectionUI();
  refreshSequenceUI();
  if (app.view) app.view.setState({ key: state.key, selection: state.selection, naming: state.naming });
}

function refreshSelectionUI() {
  const body = $('#selBody');
  if (!body) return;
  const sel = state.selection;
  if (!sel) {
    body.innerHTML = `<div class="sel-empty">在图中点击三角形选择和弦，<br>或在上方输入和弦 / 音集。</div>
      <div class="chips" style="margin-top:8px">
        <button data-act="play">试听</button>
      </div>`;
    $('#setTheory').innerHTML = '';
    if (app.view) app.view.circle.setState({ selection: null, mode: state.circleMode });
    return;
  }
  const chord = sel.chord;
  const fn = sel.fn;
  const noteText = pc => (state.naming === 'integer' ? String(mod12(pc)) : nameOf(pc, sel.spelling));
  const integerHint = state.naming === 'integer' ? `[${sel.pcs.join(',')}]` : '';
  const symbol = chord ? chord.symbol : (sel.kind === 'note' ? noteText(sel.pcs[0]) : `{${sel.pcs.join(',')}}`);
  const subParts = [];
  if (chord) {
    subParts.push(chord.qualityZh);
    if (sel.bass != null && chord.root != null && sel.bass !== chord.root) {
      subParts.push(`低音 ${noteText(sel.bass)}`);
    }
    if (chord.inversion > 0) subParts.push(chord.inversionName);
  } else if (sel.kind === 'note') {
    subParts.push('单音');
  } else {
    subParts.push(`${sel.pcs.length} 音音集`);
  }
  if (integerHint) subParts.push(integerHint);
  const fnHtml = fn
    ? `<div class="sel-func ${fn.group}"><span>${esc(fn.roman)}</span><small>${esc(fn.func || '—')}</small></div>`
    : (state.key ? `<div class="sel-func N"><span>—</span><small>调外</small></div>` : `<div class="sel-func N"><span>—</span><small>无调性</small></div>`);

  const pcHtml = sel.pcs.map(pc => {
    const isBass = sel.bass != null && pc === sel.bass;
    return `<span class="pc-pill ${isBass ? 'bass' : ''}">${esc(noteText(pc))}${isBass ? '<small>BASS</small>' : ''}</span>`;
  }).join('');

  const meta = [];
  if (chord) {
    meta.push(['根音', noteText(chord.root)]);
    meta.push(['转位', chord.inversion > 0 ? chord.inversionName : '原位']);
  }
  meta.push(['低音', sel.bass != null ? noteText(sel.bass) : '—']);
  meta.push(['性质', chord ? chord.qualityZh : '音集']);
  if (chord && chord.intervals) meta.push(['音程', chord.intervals.join(' · ')]);

  let desc = '';
  if (fn) {
    desc = `<b>${esc(fn.roman)}</b> ${esc(fn.func || '')} · ${esc(fn.desc)}`;
  } else if (chord) {
    desc = `根音 ${esc(noteText(chord.root))}，${esc(chord.qualityZh)}${sel.bass != null && sel.bass !== chord.root ? `，低音 ${esc(noteText(sel.bass))}` : ''}。`;
  }
  if (sel.set && (sel.kind === 'set' || sel.kind === 'note')) {
    desc += `<br><span class="sel-setline">normal ${esc(sel.set.normalString)} · prime ${esc(sel.set.primeString)} · IV ${esc(sel.set.ivString)}</span>`;
  }

  body.innerHTML = `
    <div class="sel-hero">
      <div>
        <div class="sel-symbol">${esc(symbol)}</div>
        <div class="sel-sub">${esc(subParts.filter(Boolean).join(' · '))}</div>
      </div>
      ${fnHtml}
    </div>
    <div class="sel-pcs">${pcHtml}</div>
    <div class="sel-meta">${meta.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${desc ? `<div class="sel-desc">${desc}</div>` : ''}
    <div class="sel-actions">
      <button class="mini-btn" data-act="play">▶ 试听</button>
      <button class="mini-btn" data-act="add-seq">＋ 加入进行</button>
      <button class="mini-btn" data-act="copy">复制</button>
    </div>`;

  const st = $('#setTheory');
  if (st) {
    if (sel.set) {
      st.innerHTML = `
        <div><span>音集</span><b>${esc(sel.set.pcs.join(' '))}</b></div>
        <div><span>基数</span><b>${sel.set.cardinality}</b></div>
        <div><span>normal form</span><b>${esc(sel.set.normalString)}</b></div>
        <div><span>prime form</span><b>${esc(sel.set.primeString)}</b></div>
        <div><span>interval vector</span><b>${esc(sel.set.ivString)}</b></div>`;
    } else {
      st.innerHTML = '';
    }
  }

  if (app.view) {
    app.view.circle.setState({ selection: sel, key: state.key, naming: state.naming, steps: state.steps, activeStep: state.activeStep, mode: state.circleMode });
  }
}

function refreshSequenceUI() {
  const track = $('#seqTrack');
  if (!track) return;
  const count = $('#seqCount');
  if (count) count.textContent = `${state.steps.length} 个环节`;
  const cur = $('#seqCurrentNote');
  if (cur) {
    if (state.steps.length && state.activeStep >= 0) {
      const s = state.steps[state.activeStep];
      const fn = s.fn ? ` · ${s.fn.roman}` : '';
      cur.textContent = `第 ${state.activeStep + 1} / ${state.steps.length} 环节 · ${s.label}${fn}`;
    } else cur.textContent = '';
  }
  if (!state.steps.length) {
    track.innerHTML = `<div class="seq-empty">还没有和弦进行。点击「编辑列表」粘贴若干和弦，或在图中依次点击三角形。</div>`;
  } else {
    track.innerHTML = state.steps.map((s, i) => `
      <div class="seq-chip ${i === state.activeStep ? 'on' : ''}" data-index="${i}" style="--chip-color:${s.color}">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <span class="name">${esc(s.label)}</span>
        <span class="fn">${s.fn ? esc(s.fn.roman + ' · ' + (s.fn.func || '')) : ''}</span>
      </div>`).join('');
    track.querySelectorAll('.seq-chip').forEach(el => {
      el.addEventListener('click', () => {
        if (state.playing) stopSequence();
        selectStep(Number(el.dataset.index), { play: true });
      });
    });
  }
  const playBtn = $('#seqPlay');
  if (playBtn) playBtn.textContent = state.playing ? '❚❚ 暂停' : '▶ 播放';
  const prev = $('#seqPrev'), next = $('#seqNext');
  if (prev) prev.disabled = !state.steps.length;
  if (next) next.disabled = !state.steps.length;
  if (app.view) app.view.setState({ steps: state.steps, activeStep: state.activeStep, satbMode: state.satbMode, satb: state.satb, satbDur: state.satbSpeed, satbHistory: state.satbHistory });
}

/* ------------------------------------------------------------- sequence */

function makeStepFromSelection(sel, colorIndex = null) {
  if (!sel) return null;
  const idx = colorIndex != null ? colorIndex : state.steps.length;
  return {
    pcs: [...sel.pcs], bass: sel.bass,
    chord: sel.chord, fn: sel.fn,
    label: sel.chord ? sel.chord.symbol : (sel.kind === 'note' ? nameOf(sel.pcs[0], sel.spelling) : `[${sel.pcs.join(',')}]`),
    color: STEP_COLORS[idx % STEP_COLORS.length],
    spelling: sel.spelling,
    raw: sel.chord ? sel.chord.symbol : sel.pcs,
  };
}

function parseSequenceText(text) {
  /* A '#' starts a comment only at line start or after whitespace, so chord
     names such as F#dim7 and C#m7 keep their accidental. */
  const stripComment = s => s.replace(/(^|\s)#.*$/, '$1').trim();
  const lines = String(text).split(/[\n;|]+/).map(stripComment).filter(Boolean);
  const steps = [];
  const errors = [];
  for (const line of lines) {
    const parsed = parseInput(line, state.key ? keySpell(state.key) : 'flat');
    if (!parsed.ok) { errors.push(line); continue; }
    const sel = buildSelection({
      kind: parsed.kind, pcs: parsed.pcs, bass: parsed.bass,
      chord: parsed.chord, source: 'sequence',
    });
    const step = makeStepFromSelection(sel, steps.length);
    step.raw = line;
    steps.push(step);
  }
  return { steps, errors };
}

function loadSequenceText(text, opts = {}) {
  const { steps, errors } = parseSequenceText(text);
  if (!steps.length) {
    toast('没有可用的和弦，请检查输入');
    return false;
  }
  state.steps = steps;
  state.activeStep = 0;
  state.seqEnded = false;
  refreshSatbMode({ silent: true });
  stopSequence();
  selectStep(0, { play: !!opts.play });
  refreshSequenceUI();
  if (errors.length) toast(`已载入 ${steps.length} 个环节，忽略 ${errors.length} 行无法识别的内容`);
  else toast(`已载入 ${steps.length} 个环节`);
  return true;
}

function addSelectionToSequence() {
  if (!state.selection) { toast('先选择一个和弦'); return; }
  const step = makeStepFromSelection(state.selection, state.steps.length);
  state.steps.push(step);
  state.activeStep = state.steps.length - 1;
  refreshSatbMode({ silent: true });
  refreshSequenceUI();
  toast(`已加入进行：${step.label}`);
}

function selectStep(i, opts = {}) {
  if (i < 0 || i >= state.steps.length) return;
  state.activeStep = i;
  state.seqEnded = false;
  const step = state.steps[i];
  const sel = buildSelection({
    kind: step.pcs.length === 1 ? 'note' : 'chord',
    pcs: step.pcs, bass: step.bass,
    chord: step.chord, source: 'sequence',
    color: step.color,
    spelling: state.key ? keySpell(state.key) : 'flat',
  });
  if (sel && step.chord) {
    sel.chord = analyzeChord(step.pcs, step.bass, sel.spelling);
    sel.fn = state.key ? harmonicFunction(sel.chord, state.key) : null;
    sel.displayLabel = sel.chord.symbol;
  }
  setSelection(sel, { play: false });
  if (opts.play) playStepAudio(step, i, Math.min(2.2, stepSeconds() * 0.95));
  refreshSequenceUI();
}

function stepSeconds() {
  return (60 / state.tempo) * 2;
}

let seqTimer = null;

async function playSequence() {
  if (state.playing) { stopSequence(); return; }
  if (!state.steps.length) { openSequenceEditor(); return; }
  if (state.satbMode && (!state.satb || !state.satb.voices)) refreshSatbMode({ silent: true });
  await audio.resume();
  state.playing = true;
  let start = state.activeStep;
  if (state.seqEnded || start < 0 || start >= state.steps.length) start = 0;
  state.seqEnded = false;
  refreshSequenceUI();
  playStepAt(start);
}

function playStepAt(i) {
  if (!state.playing) return;
  if (i >= state.steps.length) {
    if (state.loop) i = 0;
    else { state.seqEnded = true; stopSequence(); return; }
  }
  state.activeStep = i;
  const step = state.steps[i];
  const sel = buildSelection({
    kind: step.pcs.length === 1 ? 'note' : 'chord',
    pcs: step.pcs, bass: step.bass, chord: step.chord,
    source: 'sequence', color: step.color,
    spelling: state.key ? keySpell(state.key) : 'flat',
  });
  if (sel && step.chord) {
    sel.chord = analyzeChord(step.pcs, step.bass, sel.spelling);
    sel.fn = state.key ? harmonicFunction(sel.chord, state.key) : null;
    sel.displayLabel = sel.chord.symbol;
  }
  setSelection(sel, { play: false });
  refreshSequenceUI();
  playStepAudio(step, i, stepSeconds() * 0.92);
  seqTimer = setTimeout(() => {
    if (!state.playing) return;
    playStepAt(i + 1);
  }, stepSeconds() * 1000);
}

function stopSequence() {
  state.playing = false;
  if (seqTimer) { clearTimeout(seqTimer); seqTimer = null; }
  audio.stopAll(0.12);
  refreshSequenceUI();
}

function initSequence() {
  $('#seqPrev').addEventListener('click', () => {
    if (!state.steps.length) return;
    if (state.playing) stopSequence();
    selectStep(Math.max(0, state.activeStep - 1), { play: true });
  });
  $('#seqNext').addEventListener('click', () => {
    if (!state.steps.length) return;
    if (state.playing) stopSequence();
    selectStep(Math.min(state.steps.length - 1, state.activeStep + 1), { play: true });
  });
  $('#seqPlay').addEventListener('click', playSequence);
  $('#seqLoop').addEventListener('change', ev => { state.loop = ev.target.checked; });
  $('#seqTempo').addEventListener('input', ev => {
    state.tempo = Number(ev.target.value);
    $('#seqTempoVal').textContent = String(state.tempo);
  });
  $('#seqEdit').addEventListener('click', openSequenceEditor);
  $('#satbBtn')?.addEventListener('click', openSatbModal);
  $('#exportMidiBtn')?.addEventListener('click', () => openMidiExportModal('pop'));
}

/* ------------------------------------------------------- four-part / MIDI */

function satbStatusHtml(res) {
  let cls = 'ok', icon = '✓', title = '严格四部和声：可用', detail = '';
  if (!res.ok) {
    cls = 'bad'; icon = '✕'; title = '无法生成四部和声';
    detail = `${res.issues.length} 个环节需要修改。`;
  } else if (!res.strictOk) {
    cls = 'bad'; icon = '✕'; title = '严格四部和声无解';
    detail = `以下是硬性规则最少的最佳近似；发现 ${res.issues.length} 处问题。`;
  } else if (res.warnings.length) {
    cls = 'warn'; icon = '△'; title = '严格硬性规则通过';
    detail = `有 ${res.warnings.length} 处需要复核。`;
  } else {
    detail = '音域、间距、平行/隐伏五八度、声部超越/交叉与导音重复检查通过。';
  }
  const keyTxt = res.key ? formatKey(res.key) : '未启用调性';
  return `<div class="satb-status ${cls}"><span class="ico">${icon}</span><div><b>${title}</b><br>${detail}<br><span class="satb-meta">${esc(keyTxt)} · ${res.tempo} BPM · 每和弦 4 拍</span></div></div>`;
}

function satbTableHtml(res, spell) {
  const rows = res.chords.map((c, i) => {
    const v = res.voices[i];
    if (!v) return '';
    const omitted = c.omitted && c.omitted.length
      ? ` title="省略：${esc(c.omitted.map(pc => pcName(pc, spell)).join('、'))}"`
      : '';
    const mark = c.reduced ? `<span class="reduced"${omitted}>*</span>` : '';
    const roman = c.roman ? esc(c.roman) : '—';
    return `<tr>
      <td class="col-n">${i + 1}</td>
      <td class="col-chord">${esc(c.label)}${mark}</td>
      <td class="voice voice-S">${midiName(v.S, spell)}</td>
      <td class="voice voice-A">${midiName(v.A, spell)}</td>
      <td class="voice voice-T">${midiName(v.T, spell)}</td>
      <td class="voice voice-B">${midiName(v.B, spell)}</td>
      <td class="col-fn">${roman}</td>
    </tr>`;
  }).join('');
  return `
    <div class="satb-subhead"><h4>四声部整理</h4><span class="satb-meta">S 女高音 · A 女低音 · T 男高音 · B 男低音</span></div>
    <table class="satb-table">
      <thead><tr>
        <th class="col-n">#</th><th>和弦</th><th class="voice-S">S</th><th class="voice-A">A</th>
        <th class="voice-T">T</th><th class="voice-B">B</th><th class="col-fn">功能</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function satbIssuesHtml(res) {
  let html = '';
  if (res.issues.length) {
    html += `<div class="satb-subhead"><h4>问题点</h4><span class="satb-meta">${res.issues.length} 条</span></div>
      <ul class="satb-issues">${res.issues.map(x => `<li>${esc(x.text)}</li>`).join('')}</ul>`;
  }
  if (res.warnings.length) {
    html += `<div class="satb-subhead"><h4>需要复核</h4><span class="satb-meta">${res.warnings.length} 条</span></div>
      <ul class="satb-sugg">${res.warnings.map(x => `<li>${esc(x.text)}</li>`).join('')}</ul>`;
  }
  if (res.suggestions.length) {
    html += `<div class="satb-subhead"><h4>修改建议</h4></div>
      <ul class="satb-sugg">${res.suggestions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }
  return html;
}

function openSatbModal() {
  if (!state.steps.length) {
    toast('还没有和弦进行，请先点击「编辑列表」加入和弦');
    return;
  }
  stopSatbPlayback();
  const res = analyzeSatb(state.steps, { key: state.key, tempo: state.tempo });
  const spell = state.key ? keySpell(state.key).pref : 'flat';
  const body = `
    ${satbStatusHtml(res)}
    ${res.voices.length ? satbTableHtml(res, spell) : ''}
    ${satbIssuesHtml(res)}
    <div class="satb-export-note">严格四部和声按音域、声部次序与间距、平行/隐伏五八度、声部超越/交叉、导音重复等规则检查。无解时给出最佳近似与修改建议；不建议把最佳近似直接当作严格答案。每和弦按 4 拍、4/4 在 MIDI 中导出。点击「在网格播放四声部」会关闭面板，在 Tonnetz 上显示四声部并逐和弦播放声部移动；网格左上可调移动速度与保留原位置次数。</div>`;
  const foot = `
    <button class="mini-btn" data-satb-play ${res.voices.length ? '' : 'disabled'}>▶ 在网格播放四声部</button>
    <button class="mini-btn" data-satb-midi ${res.strictOk ? '' : 'disabled'} title="${res.strictOk ? '打开严格四部和声 MIDI 导出' : '严格四部和声当前无解'}">导出 MIDI</button>
    <button class="mini-btn" data-satb-copy ${res.voices.length ? '' : 'disabled'}>复制四声部</button>
    <button class="mini-btn primary" data-close>关闭</button>`;
  const modal = openModal({ title: '四部和声（SATB）', body, foot, wide: true });
  modal.querySelector('[data-close]')?.addEventListener('click', closeModal);
  const play = modal.querySelector('[data-satb-play]');
  if (play && !play.disabled) play.addEventListener('click', () => playSatbOnGrid(res));
  const midi = modal.querySelector('[data-satb-midi]');
  if (midi && !midi.disabled) midi.addEventListener('click', () => openMidiExportModal('satb'));
  const copy = modal.querySelector('[data-satb-copy]');
  if (copy && !copy.disabled) copy.addEventListener('click', () => copySatb(res));
}

function stopSatbPlayback() {
  satbPlayToken++;
  if (satbTimers.length) {
    satbTimers.forEach(id => clearTimeout(id));
    satbTimers = [];
    try { audio.stopAll(0.05); } catch (e) { /* ignore */ }
  }
}

function playSatb(res) {
  if (!res.voices.length) return;
  stopSatbPlayback();
  const token = satbPlayToken;
  const stepSec = 4 * 60 / Math.max(30, state.tempo);
  res.voices.forEach((v, i) => {
    const id = setTimeout(() => {
      if (token !== satbPlayToken) return;
      audio.playVoicing([v.S, v.A, v.T, v.B], {
        duration: stepSec * 0.94,
        timbre: 'strings',
        velocity: 0.75,
      });
    }, i * stepSec * 1000);
    satbTimers.push(id);
  });
  toast('试听四声部…');
}

function copySatb(res) {
  const spell = state.key ? keySpell(state.key).pref : 'flat';
  const head = `四部和声 · ${res.key ? formatKey(res.key) : '未启用调性'} · ${res.tempo} BPM`;
  const lines = res.chords.map((c, i) => {
    const v = res.voices[i];
    if (!v) return '';
    return `${i + 1}. ${c.label} | S ${midiName(v.S, spell)} | A ${midiName(v.A, spell)} | T ${midiName(v.T, spell)} | B ${midiName(v.B, spell)}${c.roman ? ` | ${c.roman}` : ''}`;
  }).filter(Boolean);
  const text = [head, ...lines].join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('四声部已复制')).catch(() => toast('复制失败'));
  } else {
    toast('当前浏览器不支持剪贴板复制');
  }
}

function downloadMidi(bytes, filename) {
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function openMidiExportModal(prefer = 'pop') {
  if (!state.steps.length) {
    toast('还没有和弦进行，请先点击「编辑列表」加入和弦');
    return;
  }
  stopSatbPlayback();
  const res = analyzeSatb(state.steps, { key: state.key, tempo: state.tempo });
  const strictOk = !!(res.ok && res.strictOk);
  const selected = prefer === 'satb' && strictOk ? 'satb' : 'pop';
  const keyTxt = state.key ? formatKey(state.key) : '未启用调性';
  const body = `
    <p style="margin-top:0">将当前 <b>${state.steps.length}</b> 个和弦导出为 MIDI 文件（SMF format 1，4/4，每和弦 4 拍，速度 <b>${state.tempo}</b> BPM）。</p>
    <div class="midi-mode">
      <label>
        <input type="radio" name="midiMode" value="pop" ${selected === 'pop' ? 'checked' : ''}>
        <span><b>一般（流行）</b><small>钢琴柱式和弦；按当前和弦音与低音直接排列，适合快速试听或导入 DAW。</small></span>
      </label>
      <label class="${strictOk ? '' : 'disabled'}">
        <input type="radio" name="midiMode" value="satb" ${selected === 'satb' ? 'checked' : ''} ${strictOk ? '' : 'disabled'}>
        <span><b>严格四部和声（古典）</b><small>S / A / T / B 四个独立轨，Choir Aahs 音色；当前进行${strictOk ? '已生成严格四声部' : '没有严格解'}。</small></span>
      </label>
    </div>
    ${strictOk ? '' : '<div class="midi-warn">严格四部和声当前无解，不能导出为严格 SATB。请先在「四部和声」面板查看问题点与修改建议；也可以先导出一般（流行）版本。</div>'}
    <div class="satb-export-note">调性：${esc(keyTxt)}。严格四部和声导出包含 4 个声部轨；一般（流行）导出为 1 个钢琴轨。文件可直接拖入 DAW 或播放器。</div>
    <div class="satb-actions"><button class="link-btn" id="midiOpenSatb">查看四部和声检查 →</button></div>`;
  const foot = `<button class="mini-btn" data-close>取消</button>
    <button class="primary-btn sm" id="midiExportGo">导出 .mid</button>`;
  const modal = openModal({ title: '导出 MIDI', body, foot });
  modal.querySelector('[data-close]')?.addEventListener('click', closeModal);
  modal.querySelector('#midiOpenSatb')?.addEventListener('click', openSatbModal);
  modal.querySelector('#midiExportGo')?.addEventListener('click', () => {
    const mode = modal.querySelector('input[name="midiMode"]:checked')?.value || 'pop';
    if (mode === 'satb' && !strictOk) {
      toast('严格四部和声当前无解，请先查看问题点');
      return;
    }
    try {
      const bytes = mode === 'satb'
        ? buildMidi(state.steps, { mode: 'satb', tempo: state.tempo, voices: res.voices })
        : buildMidi(state.steps, { mode: 'pop', tempo: state.tempo });
      downloadMidi(bytes, midiFilename(mode));
      closeModal();
      toast(mode === 'satb' ? '已导出严格四部和声 MIDI' : '已导出一般（流行）MIDI');
    } catch (err) {
      console.error(err);
      toast('MIDI 导出失败：' + (err && err.message ? err.message : '未知错误'));
    }
  });
}


function openSequenceEditor() {
  const current = state.steps.map(s => s.raw && typeof s.raw === 'string' ? s.raw : s.label).join('\n');
  const body = `
    <p style="margin-top:0">每行一个和弦、音符列表或音集，也支持用 <code>|</code> 或 <code>;</code> 分隔。解析后会在 Tonnetz 中按时间顺序编号显示。</p>
    <textarea id="seqText" spellcheck="false" placeholder="Cmaj7&#10;Am7&#10;Dm7&#10;G7">${esc(current || 'Cmaj7\nAm7\nDm7\nG7')}</textarea>
    <div class="chips" style="margin-top:8px">
      <button data-fill="Cmaj7&#10;Am7&#10;Dm7&#10;G7">ii–V–I</button>
      <button data-fill="C&#10;Am&#10;F&#10;G">C–Am–F–G</button>
      <button data-fill="C G Am Em F C F G">卡农（音名列表）</button>
      <button data-fill="C | Am | F | G">竖线分隔</button>
      <button data-fill="[0,2,4,5,9]&#10;[0,2,3,5,7,9,10]&#10;[0,1,4,6]">音集</button>
    </div>
    <div class="input-error" id="seqError" style="min-height:16px"></div>`;
  const foot = `<button class="mini-btn" data-close>取消</button>
    <button class="primary-btn sm" id="seqLoad">解析并载入</button>`;
  const modal = openModal({ title: '编辑和弦进行', body, foot });
  modal.querySelectorAll('[data-fill]').forEach(btn => {
    btn.addEventListener('click', () => { modal.querySelector('#seqText').value = btn.dataset.fill; });
  });
  modal.querySelector('[data-close]').addEventListener('click', closeModal);
  modal.querySelector('#seqLoad').addEventListener('click', () => {
    const text = modal.querySelector('#seqText').value;
    const { steps, errors } = parseSequenceText(text);
    if (!steps.length) {
      modal.querySelector('#seqError').textContent = '没有可识别的和弦，请参考示例格式。';
      return;
    }
    state.steps = steps;
    state.activeStep = 0;
    state.seqEnded = false;
    stopSequence();
    closeModal();
    selectStep(0, { play: true });
    refreshSequenceUI();
    if (errors.length) toast(`已载入 ${steps.length} 个，忽略 ${errors.length} 行`);
    else toast(`已载入 ${steps.length} 个环节`);
  });
}

/* ---------------------------------------------------------------- tools */

let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function showTooltip(html, x, y, canvas) {
  const el = $('#tooltip');
  if (!el) return;
  el.innerHTML = html;
  el.classList.add('on');
  const rect = canvas.getBoundingClientRect();
  const px = rect.left + x;
  const py = rect.top + y;
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = px + 16, top = py + 16;
  if (left + w > window.innerWidth - 8) left = px - w - 16;
  if (top + h > window.innerHeight - 8) top = py - h - 16;
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = Math.max(8, top) + 'px';
}

function hideTooltip() {
  const el = $('#tooltip');
  if (el) el.classList.remove('on');
}

function circleHover(pc, x, y, circle) {
  if (pc == null || pc < 0) { hideTooltip(); return; }
  const deg = state.key ? degreeOf(state.key, pc) : -1;
  let nm;
  if (state.naming === 'integer') nm = String(pc);
  else if (REFERENCE_PAIRS[pc] && circle.mode === 'chromatic') nm = pcName(pc, 'sharp') + '/' + pcName(pc, 'flat');
  else if (REFERENCE_PAIRS[pc]) nm = pcName(pc, 'flat') + '/' + pcName(pc, 'sharp');
  else nm = pcName(pc, state.key ? keySpell(state.key).pref : 'flat');
  showTooltip(`<div class="tt-name">${esc(nm)}</div><div class="tt-sub">${deg >= 0 ? ROMAN[deg] + ' 级' : '调外音'} · 点击加入 / 移出音集</div>`, x, y, circle.canvas);
}

function openModal({ title, body, foot = '', wide = false }) {
  closeModal();
  const root = $('#modalRoot');
  const wrapper = document.createElement('div');
  wrapper.className = 'modal-backdrop';
  wrapper.innerHTML = `<div class="modal" style="${wide ? 'width:min(980px,100%)' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn sm" data-modal-close>✕</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  root.appendChild(wrapper);
  wrapper.querySelector('[data-modal-close]').addEventListener('click', closeModal);
  wrapper.addEventListener('click', ev => { if (ev.target === wrapper) closeModal(); });
  return wrapper;
}

function closeModal() {
  stopSatbPlayback();
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}

function openHelp() {
  const body = `
    <h4>这是什么</h4>
    <p>Tonnetz（音网）把十二平均律中的三和弦排成一张可无限延伸的网格：横向是纯五度，右上斜线是大三度，右下虚线是小三度。每个三角形就是一个三和弦，朝上的三角形是大三和弦，朝下的是小三和弦。本页为 Tonnetz Lite 独立精简版，仅保留和弦网；不加载任何外部模板数据，也不依赖外部程序。</p>
    <h4>和弦网</h4>
    <ul>
      <li><b>拖动</b> 平移，<b>滚轮</b> 缩放，左上角「归位」回到中心。</li>
      <li>点击三角形：选择和弦、填色、显示名称并试听；点击音名或圆点：加入 / 移出音集。</li>
      <li>输入框支持 <code>Cmaj7</code>、<code>Am7/E</code>、<code>C E G B♭</code>、<code>[0,2,4,5,9]</code>。</li>
      <li>选择若干音后，程序会在网络中寻找面积最小、离中心最近的封闭区域（凸包）并半透明填色。</li>
      <li>「调性」选择主音与调式后，所有三角形按 T / S / D 功能着色并显示罗马数字，右侧面板给出功能分析。</li>
      <li>「和弦进行」支持编辑多行和弦，按时间顺序编号显示；「上一个 / 下一个 / 播放」会同步网格、音级圈与右侧读数。</li>
      <li>音级圈可在「五度圈 / 十二平均律圈」之间切换，两种模式功能一致：点击音级加入/移出音集，颜色对应 T / S / D 功能，罗马数字与进行色点同步；切换调性时圆圈会旋转，使主音位于最上方，音名与罗马数字始终保持水平。</li>
      <li><b>四部和声</b>：按严格 SATB 规范整理出女高音 / 女低音 / 男高音 / 男低音四个声部，并检查音域、间距、平行/隐伏五八度、声部超越与导音重复；若严格无解，会列出问题点与修改方案，不建议把最佳近似直接当作严格答案。</li>
      <li><b>四声部网格</b>：打开网格工具条的「四声部」开关，四个声部会显示在当前进行和弦的音级节点上；播放 / 上一个 / 下一个时，各声部会从上一音移动到下一音（如 G→C），显示轨迹与「G4→C5」标签。网格左上控制条可调声部移动速度（0.6–3.0 秒，默认 1.6 秒）和保留原位置次数（0–3 次，默认 1 次；原位置以虚线圈保留）。也可在「四部和声」面板点「在网格播放四声部」。</li>
      <li><b>导出 MIDI</b>：可选择「一般（流行）」钢琴柱式和弦，或「严格四部和声（古典）」四个独立声部轨。</li>
    </ul>
    <h4>快捷键</h4>
    <div class="help-grid">
      <dt>空格</dt><dd>播放 / 暂停和弦进行</dd>
      <dt>← / →</dt><dd>上一个 / 下一个和弦</dd>
      <dt>Esc</dt><dd>关闭弹窗 / 清除提示</dd>
      <dt>?</dt><dd>打开使用说明</dd>
    </div>`;
  openModal({ title: '使用说明', body, wide: true, foot: `<button class="primary-btn sm" data-close>知道了</button>` })
    .querySelector('[data-close]').addEventListener('click', closeModal);
}

/* ------------------------------------------------------------ top actions */

function initTopActions() {
  $('#soundBtn').addEventListener('click', () => {
    state.sound = !state.sound;
    audio.setEnabled(state.sound);
    $('#soundBtn').classList.toggle('off', !state.sound);
    $('#soundBtn').setAttribute('aria-pressed', String(state.sound));
    toast(state.sound ? '声音已开启' : '声音已关闭');
  });
  $('#helpBtn').addEventListener('click', openHelp);
  document.addEventListener('keydown', ev => {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (ev.key === ' ') { ev.preventDefault(); playSequence(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); if (state.playing) stopSequence(); selectStep(Math.max(0, state.activeStep - 1), { play: true }); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); if (state.playing) stopSequence(); selectStep(Math.min(state.steps.length - 1, state.activeStep + 1), { play: true }); }
    else if (ev.key === 'Escape') { closeModal(); hideTooltip(); }
    else if (ev.key === '?') openHelp();
  });
}

/* ------------------------------------------------------------ deep links */

function applyDeepLinks() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('naming') === 'integer') setNaming('integer');
    const circleParam = params.get('circle');
    if (circleParam === 'fifths' || circleParam === 'chromatic') setCircleMode(circleParam);
    const tonic = params.get('tonic');
    const mode = params.get('mode');
    if (tonic != null && mode && MODE_BY_ID[mode]) {
      state.keyTonic = Number(tonic) % 12;
      state.keyMode = mode;
      const ts = $('#keyTonic'); if (ts) ts.value = String(state.keyTonic);
      const ms = $('#keyMode'); if (ms) ms.value = mode;
      state.key = makeKey(state.keyTonic, state.keyMode);
      if (app.view) app.view.setState({ key: state.key });
          refreshUI();
    }
    const chord = params.get('chord');
    if (chord) {
      const input = $('#selInput');
      if (input) input.value = chord;
      applyInput(chord, { play: false });
    }
    const seq = params.get('seq');
    if (seq) loadSequenceText(seq, { play: false });
    if (params.get('satb') === '1') enableSatbMode({ silent: true });
  } catch (e) {
    console.warn('deep link failed', e);
  }
}

/* --------------------------------------------------------------- start */

document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();

export default app;
