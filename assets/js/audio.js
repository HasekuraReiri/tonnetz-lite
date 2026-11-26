/* ==========================================================================
   audio.js — Web Audio 合成器：和弦、音阶、进行播放
   ========================================================================== */

import { midiFreq, makeVoicing, pcSet } from './core.js';

const TIMBRES = {
  piano: {
    name: '钢琴',
    partials: [
      { ratio: 1, gain: 1, type: 'sine' },
      { ratio: 2, gain: 0.32, type: 'sine' },
      { ratio: 3, gain: 0.14, type: 'sine' },
      { ratio: 4.02, gain: 0.06, type: 'sine' },
    ],
    attack: 0.006, decay: 0.5, sustain: 0.22, release: 0.75, filter: 5200, strum: 0.012,
  },
  sine: {
    name: '正弦',
    partials: [
      { ratio: 1, gain: 1, type: 'sine' },
      { ratio: 2, gain: 0.12, type: 'sine' },
    ],
    attack: 0.02, decay: 0.2, sustain: 0.75, release: 0.9, filter: 8000, strum: 0,
  },
  organ: {
    name: '管风琴',
    partials: [
      { ratio: 1, gain: 0.8, type: 'sine' },
      { ratio: 2, gain: 0.4, type: 'sine' },
      { ratio: 3, gain: 0.25, type: 'sine' },
      { ratio: 4, gain: 0.16, type: 'sine' },
      { ratio: 6, gain: 0.06, type: 'sine' },
    ],
    attack: 0.08, decay: 0.15, sustain: 0.8, release: 0.7, filter: 4800, strum: 0,
  },
  strings: {
    name: '弦乐',
    partials: [
      { ratio: 1, gain: 0.5, type: 'sawtooth' },
      { ratio: 1.003, gain: 0.35, type: 'sawtooth' },
      { ratio: 2, gain: 0.12, type: 'sine' },
    ],
    attack: 0.24, decay: 0.3, sustain: 0.72, release: 1.2, filter: 2600, strum: 0.02,
  },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.dry = null;
    this.wet = null;
    this.compressor = null;
    this.convolver = null;
    this.volume = 0.72;
    this.enabled = true;
    this.timbre = 'piano';
    this.active = [];
    this.started = false;
  }

  get timbres() {
    return Object.entries(TIMBRES).map(([id, t]) => ({ id, name: t.name }));
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('当前浏览器不支持 Web Audio');
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 22;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    const dry = ctx.createGain();
    dry.gain.value = 0.92;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(ctx, 2.1, 2.8);
    dry.connect(comp);
    wet.connect(conv);
    conv.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.dry = dry;
    this.wet = wet;
    this.compressor = comp;
    this.convolver = conv;
    this.started = true;
    return ctx;
  }

  makeImpulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  async resume() {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.04);
    }
    if (!this.enabled) this.stopAll();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.04);
  }

  setTimbre(id) {
    if (TIMBRES[id]) this.timbre = id;
  }

  stopAll(fade = 0.08) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.active) {
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0.0001, t, fade / 3);
        for (const o of v.oscs) {
          try { o.stop(t + fade + 0.05); } catch (e) { /* already stopped */ }
        }
      } catch (e) { /* ignore */ }
    }
    this.active = [];
  }

  /**
   * 播放一个和弦 / 音集
   * @param {number[]} pcs 音级集合
   * @param {number|null} bassPc 低音
   * @param {object} opts { duration, velocity, timbre, low, strum }
   */
  async playChord(pcs, bassPc = null, opts = {}) {
    if (!this.enabled) return;
    try {
      await this.resume();
    } catch (e) { return; }
    const duration = opts.duration ?? 2.1;
    const velocity = opts.velocity ?? 0.85;
    const timbreId = opts.timbre || this.timbre;
    const t0 = this.ctx.currentTime + 0.015;
    const voicing = makeVoicing(pcSet(pcs), bassPc, { low: opts.low ?? 48 });
    if (!voicing.notes.length) return;
    const def = TIMBRES[timbreId] || TIMBRES.piano;
    this.stopAll(0.05);
    voicing.notes.forEach((n, i) => {
      const start = t0 + (def.strum ? i * def.strum : 0);
      const vel = velocity * (i === 0 ? 0.92 : 0.78);
      this.voice(n.midi, start, duration, vel, def, opts);
    });
  }

  /**
   * 直接播放一组 MIDI 音高（用于四部和声试听）。
   */
  async playVoicing(midis, opts = {}) {
    if (!this.enabled) return;
    try { await this.resume(); } catch (e) { return; }
    const list = (midis || []).filter(m => Number.isFinite(m) && m >= 0 && m <= 127);
    if (!list.length) return;
    const duration = opts.duration ?? 2.1;
    const velocity = opts.velocity ?? 0.8;
    const def = TIMBRES[opts.timbre || 'strings'] || TIMBRES.piano;
    this.stopAll(0.05);
    const t0 = this.ctx.currentTime + 0.02;
    list.forEach((midi, i) => {
      this.voice(midi, t0, duration, velocity * (i === 0 ? 0.95 : 0.8), def, opts);
    });
  }

  async playNote(midi, opts = {}) {    if (!this.enabled) return;
    try { await this.resume(); } catch (e) { return; }
    const def = TIMBRES[opts.timbre || this.timbre] || TIMBRES.piano;
    this.stopAll(0.03);
    this.voice(midi, this.ctx.currentTime + 0.01, opts.duration ?? 1.1, opts.velocity ?? 0.8, def, opts);
  }

  async playScale(pcs, opts = {}) {
    if (!this.enabled) return;
    try { await this.resume(); } catch (e) { return; }
    const def = TIMBRES[opts.timbre || this.timbre] || TIMBRES.piano;
    this.stopAll(0.04);
    const t0 = this.ctx.currentTime + 0.02;
    const step = opts.step ?? 0.28;
    pcs.forEach((pc, i) => {
      const midi = 60 + pc + (i >= pcs.length - 1 && pc === pcs[0] ? 12 : 0);
      this.voice(midi, t0 + i * step, Math.max(0.3, step * 2.4), 0.62, def, opts);
    });
  }

  voice(midi, time, duration, velocity, def, opts) {
    const ctx = this.ctx;
    const freq = midiFreq(midi);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = def.filter;
    filter.Q.value = 0.4;
    gain.connect(filter);
    filter.connect(this.dry);
    filter.connect(this.wet);

    const oscs = [];
    const peak = Math.max(0.0001, velocity * 0.24);
    const sustain = Math.max(0.0001, peak * def.sustain);
    const attack = def.attack;
    const decay = def.decay;
    const release = def.release;
    const t = Math.max(time, ctx.currentTime + 0.001);
    const end = t + Math.max(0.08, duration);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.setTargetAtTime(sustain, t + attack, Math.max(0.02, decay / 3));
    const relStart = Math.max(t + attack + 0.02, end);
    gain.gain.setValueAtTime(Math.max(0.0001, sustain * 0.9), relStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, relStart + release);

    for (const p of def.partials) {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = freq * p.ratio;
      o.detune.value = (Math.random() - 0.5) * 3;
      const g = ctx.createGain();
      g.gain.value = p.gain;
      o.connect(g);
      g.connect(gain);
      o.start(t);
      o.stop(relStart + release + 0.1);
      oscs.push(o);
    }
    const rec = { gain, oscs, midi };
    this.active.push(rec);
    const last = oscs[oscs.length - 1];
    if (last) {
      last.onended = () => {
        this.active = this.active.filter(x => x !== rec);
        try { gain.disconnect(); filter.disconnect(); } catch (e) { /* ignore */ }
      };
    }
  }
}

export const audio = new AudioEngine();
