/* ==========================================================================
   midi.js — 标准 MIDI 文件（SMF）导出
   --------------------------------------------------------------------------
   - 一般（流行）：钢琴柱式和弦，1 个音乐轨；
   - 严格四部和声（古典）：S/A/T/B 四个声部各自一个轨，Choir Aahs 音色；
   - 每个和弦 4 拍（4/4），速度取当前进行速度。
   ========================================================================== */

import { makeVoicing, pcSet } from './core.js';

const TPQ = 480;
const BEATS_PER_CHORD = 4;

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function textEvent(text) {
  const bytes = [...text].map(ch => ch.charCodeAt(0) & 0x7f);
  return [0xff, 0x03, bytes.length, ...bytes];
}

function trackChunk(events) {
  const sorted = events.slice().sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return (a.priority || 0) - (b.priority || 0);
  });
  let last = 0;
  const body = [];
  for (const ev of sorted) {
    const delta = Math.max(0, ev.tick - last);
    body.push(...vlq(delta), ...ev.bytes);
    last = ev.tick;
  }
  body.push(...vlq(Math.max(0, last - last)), 0xff, 0x2f, 0x00);
  const len = body.length;
  return [
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...body,
  ];
}

function tempoTrack(tempo, name = 'Tempo') {
  const bpm = Math.max(30, Math.min(240, Number(tempo) || 84));
  const us = Math.round(60000000 / bpm);
  const events = [
    { tick: 0, priority: 0, bytes: textEvent(name) },
    { tick: 0, priority: 0, bytes: [0xff, 0x51, 0x03, (us >>> 16) & 0xff, (us >>> 8) & 0xff, us & 0xff] },
    { tick: 0, priority: 0, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] },
  ];
  return trackChunk(events);
}

function noteTrack(name, channel, program, notesByChord) {
  const events = [
    { tick: 0, priority: 0, bytes: textEvent(name) },
    { tick: 0, priority: 1, bytes: [0xc0 | (channel & 0x0f), program & 0x7f] },
  ];
  const chordTicks = BEATS_PER_CHORD * TPQ;
  notesByChord.forEach((notes, i) => {
    const start = i * chordTicks;
    const end = start + chordTicks - 30;
    for (const midi of notes) {
      if (!Number.isFinite(midi) || midi < 0 || midi > 127) continue;
      events.push({ tick: start, priority: 3, bytes: [0x90 | (channel & 0x0f), midi & 0x7f, 82] });
      events.push({ tick: end, priority: 2, bytes: [0x80 | (channel & 0x0f), midi & 0x7f, 0] });
    }
  });
  return trackChunk(events);
}

function header(ntrks) {
  return [
    0x4d, 0x54, 0x68, 0x64, // MThd
    0x00, 0x00, 0x00, 0x06, // length
    0x00, 0x01,             // format 1
    (ntrks >>> 8) & 0xff, ntrks & 0xff,
    0x01, 0xe0,             // 480 TPQ
  ];
}

function popVoicing(step) {
  const pcs = pcSet(step && step.pcs ? step.pcs : []);
  if (!pcs.length) return [];
  const bass = step.bass != null ? step.bass : null;
  return makeVoicing(pcs, bass, { low: 36 }).notes.map(n => n.midi);
}

/**
 * 生成完整 SMF 字节。
 * @param {Array} steps 和弦进行
 * @param {Object} opts { mode:'pop'|'satb', tempo, voices }
 * @returns {Uint8Array}
 */
export function buildMidi(steps, opts = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const mode = opts.mode === 'satb' ? 'satb' : 'pop';
  const tempo = opts.tempo || 84;
  let tracks;
  if (mode === 'satb') {
    const voices = opts.voices || [];
    if (voices.length !== list.length) throw new Error('SATB voices do not match progression length');
    const keys = ['S', 'A', 'T', 'B'];
    const names = ['Soprano', 'Alto', 'Tenor', 'Bass'];
    tracks = keys.map((k, idx) =>
      noteTrack(names[idx], idx, 52, voices.map(v => [v[k]]))
    );
  } else {
    tracks = [
      noteTrack('Piano', 0, 0, list.map(step => popVoicing(step))),
    ];
  }
  const chunks = [tempoTrack(tempo), ...tracks];
  const bytes = [...header(chunks.length), ...chunks.flat()];
  return new Uint8Array(bytes);
}

export function midiFilename(mode) {
  return mode === 'satb' ? 'tonnetz-progression-satb.mid' : 'tonnetz-progression-pop.mid';
}

export { TPQ, BEATS_PER_CHORD };
