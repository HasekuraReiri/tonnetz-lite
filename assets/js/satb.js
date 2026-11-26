/* ==========================================================================
   satb.js — 严格四部和声（SATB）写作检查
   --------------------------------------------------------------------------
   说明：
   - 这是“辅助写作/检查”工具，不是替代人工四部和声写作的自动作曲器。
   - 先为每个和弦生成符合音域、声部次序、间距和重复音规则的 SATB 候选；
   - 再用动态规划寻找整条进行中硬性规则最少、声部进行最平滑的路径；
   - 硬性规则包括：平行五/八度、外声部隐伏五/八度、声部超越、交叉、
     音域、间距、导音重复等；软性规则（导音/七音解决、跳进等）会以提示列出。
   - 如果严格路径不存在，返回 best-effort 路径 + 具体问题 + 修改建议。
   ========================================================================== */

import { analyzeChord, degreeOf, keySpell, mod12, pcSet, pcName, ROMAN } from './core.js';

const RANGES = {
  S: [60, 79], // C4–G5
  A: [55, 74], // G3–D5
  T: [48, 67], // C3–G4
  B: [40, 60], // E2–C4
};
const VOICE_KEYS = ['S', 'A', 'T', 'B'];
const VOICE_ZH = { S: '女高音', A: '女低音', T: '男高音', B: '男低音' };
const MAX_CANDIDATES = 180;

function midiInRange(pc, range) {
  const out = [];
  for (let m = range[0]; m <= range[1]; m++) if (mod12(m) === mod12(pc)) out.push(m);
  return out;
}

function midiName(midi, spelling = 'flat') {
  const pc = mod12(midi);
  const oct = Math.floor(midi / 12) - 1;
  return `${pcName(pc, spelling)}${oct}`;
}

function leadingTonePc(key) {
  if (!key) return null;
  const lt = mod12(key.tonic + 11);
  return key.pcs && key.pcs.includes(lt) ? lt : null;
}

function tonePc(pcs, root, intervals) {
  return pcs.find(pc => intervals.includes(mod12(pc - root))) ?? null;
}

function seventhPcOf(pcs, chord) {
  if (!chord || !chord.found) return null;
  return tonePc(pcs, chord.root, chord.quality === 'dim7' ? [9] : [10, 11]);
}

function reduceChord(chord, bassPc, pcsIn) {
  const pcs = pcSet(pcsIn && pcsIn.length ? pcsIn : chord.pcs);
  const root = chord.root;
  const isDim7 = chord.quality === 'dim7';
  const third = tonePc(pcs, root, [3, 4]);
  const fifth = tonePc(pcs, root, [6, 7, 8]);
  const seventh = seventhPcOf(pcs, chord);
  const extensions = pcs.filter(pc => {
    const i = mod12(pc - root);
    if (isDim7 && i === 9) return false; // dim7 的九半音是七音
    return [1, 2, 5, 9].includes(i);
  });
  const essential = [];
  const add = pc => {
    if (pc != null && !essential.includes(pc)) essential.push(pc);
  };
  add(bassPc);
  add(root);
  add(third);
  add(seventh);
  // 优先保留最高的色彩延伸音（13/11/9/b9），再补五音
  const extSorted = extensions.slice().sort((a, b) => mod12(b - root) - mod12(a - root));
  for (const pc of extSorted) {
    if (essential.length >= 4) break;
    add(pc);
  }
  if (essential.length < 4) add(fifth);
  for (const pc of pcs) {
    if (essential.length >= 4) break;
    add(pc);
  }
  const omitted = pcs.filter(pc => !essential.includes(pc));
  return { pcs: essential.slice(0, 4), omitted };
}

function prepareChord(step, index, key) {
  const spelling = key ? keySpell(key).pref : (step.spelling || 'flat');
  const rawPcs = pcSet(step.pcs || []);
  const label = step.label || (step.chord && step.chord.symbol) || `[${rawPcs.join(',')}]`;
  if (rawPcs.length < 3) {
    return {
      ok: false, index, label,
      message: `第 ${index + 1} 个环节「${label}」不是三和弦/七和弦（只有 ${rawPcs.length} 个音），无法写成四声部。`,
      suggestion: '请把它改成至少三个音的和弦；单音或二音音程不能作为严格四部和声的和弦。',
    };
  }
  const bassPc = step.bass != null ? mod12(step.bass) : null;
  let chord = step.chord;
  if (!chord || !chord.found) chord = analyzeChord(rawPcs, bassPc, spelling);
  if (!chord || !chord.found) {
    return {
      ok: false, index, label,
      message: `第 ${index + 1} 个环节「${label}」无法归入三度叠置和弦（音集/自由音集），严格四部和声无法直接处理。`,
      suggestion: '请改用三和弦或七和弦；若是音集/音块，请先改写为可作四声部的和弦。',
    };
  }
  if (bassPc == null || !rawPcs.includes(bassPc)) {
    return {
      ok: false, index, label,
      message: `第 ${index + 1} 个环节「${label}」的低音不是和弦音，四声部无法把它作为和弦低音。`,
      suggestion: '请把低音改为和弦音（根音/三音/五音/七音），或去掉非和弦低音。',
    };
  }
  const reduced = rawPcs.length > 4 ? reduceChord(chord, bassPc, rawPcs) : { pcs: rawPcs, omitted: [] };
  const pcs = pcSet(reduced.pcs);
  const reducedChord = { ...chord, pcs, bass: bassPc };
  const lead = leadingTonePc(key);
  const third = tonePc(rawPcs, chord.root, [3, 4]);
  const fifth = tonePc(rawPcs, chord.root, [6, 7, 8]);
  const seventh = seventhPcOf(rawPcs, chord);
  const isTriad = pcs.length === 3;
  const bassIsRoot = bassPc === chord.root;
  const bassIsThird = third != null && bassPc === third;
  const bassIsFifth = fifth != null && bassPc === fifth;
  return {
    ok: true, index, label,
    step, rawPcs, pcs, bassPc, chord: reducedChord, originalChord: chord,
    root: chord.root, third, fifth, seventh, lead,
    omitted: reduced.omitted || [],
    reduced: reduced.omitted && reduced.omitted.length > 0,
    isTriad, bassIsRoot, bassIsThird, bassIsFifth,
    spelling,
    degree: key ? degreeOf(key, chord.root) : -1,
    roman: key && degreeOf(key, chord.root) >= 0 ? ROMAN[degreeOf(key, chord.root)] : '',
  };
}

function uniquePermutations(arr) {
  const out = [];
  const used = new Array(arr.length).fill(false);
  const cur = [];
  const rec = () => {
    if (cur.length === arr.length) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      if (used[i]) continue;
      if (i > 0 && arr[i] === arr[i - 1] && !used[i - 1]) continue;
      used[i] = true;
      cur.push(arr[i]);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return out;
}

function doublingOptions(info) {
  const { pcs, bassPc, chord, lead, third, fifth, isTriad, bassIsThird, bassIsFifth } = info;
  if (!isTriad) {
    // 四个不同音：四声部各取一个，不重复
    return [{ dbl: null, cost: 0, upper: pcs.filter(pc => pc !== bassPc) }];
  }
  const opts = [];
  for (const pc of pcs) {
    if (pc === lead) continue; // 绝不重复导音
    let cost = 0;
    if (chord.quality === 'dim') {
      if (pc === third) cost = 0;
      else if (pc === fifth) cost = 2;
      else cost = 6;
    } else if (bassIsThird) {
      if (pc === third) continue; // 第一转位不重复低音三音
      cost = pc === info.root ? 0 : pc === fifth ? 2 : 4;
    } else if (bassIsFifth) {
      if (pc === third) continue;
      cost = pc === fifth ? 0 : pc === info.root ? 4 : 5;
    } else {
      cost = pc === info.root ? 0 : pc === fifth ? 2 : 6;
    }
    const upper = pcs.filter(p => p !== bassPc).concat([pc]);
    opts.push({ dbl: pc, cost, upper });
  }
  // 去重（不同 dbl 可能生成同一个 upper 多重集？不会，但保留保险）
  const seen = new Set();
  return opts.filter(o => {
    const k = o.upper.slice().sort((a, b) => a - b).join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function makeCandidates(info) {
  const { pcs, bassPc, isTriad, chord } = info;
  if (!isTriad && pcs.length !== 4) return [];
  const bassPitches = midiInRange(bassPc, RANGES.B);
  if (!bassPitches.length) return [];
  const dbls = doublingOptions(info);
  const byBass = [];
  for (const b of bassPitches) {
    for (const dbl of dbls) {
      const upperPcs = dbl.upper;
      if (upperPcs.length !== 3) continue;
      const perms = uniquePermutations(upperPcs.slice().sort((a, b) => a - b));
      for (const [sp, ap, tp] of perms) {
        const sList = midiInRange(sp, RANGES.S);
        const aList = midiInRange(ap, RANGES.A);
        const tList = midiInRange(tp, RANGES.T);
        for (const s of sList) {
          for (const a of aList) {
            if (a > s) continue;
            if (s - a > 12) continue;
            for (const t of tList) {
              if (t > a) continue;
              if (a - t > 12) continue;
              if (t <= b) continue;
              if (t - b > 19) continue;
              if (s === a && a === t && b === t) continue;
              const midi = [s, a, t, b];
              let cost = dbl.cost;
              cost += (s === a ? 2.2 : 0) + (a === t ? 2.2 : 0);
              cost += Math.max(0, (s - a) - 9) * 0.35;
              cost += Math.max(0, (a - t) - 7) * 0.35;
              cost += Math.max(0, (t - b) - 12) * 0.15;
              cost += Math.abs(a - 64) * 0.012 + Math.abs(t - 55) * 0.012;
              cost += Math.max(0, s - 76) * 0.2 + Math.max(0, 60 - s) * 0.1;
              cost += Math.max(0, 48 - b) * 0.05;
              byBass.push({
                midi, S: s, A: a, T: t, B: b,
                dbl: dbl.dbl, cost,
              });
            }
          }
        }
      }
    }
  }
  // 去重 + 剪枝
  const seen = new Set();
  const out = [];
  for (const c of byBass) {
    const k = c.midi.join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  out.sort((a, b) => a.cost - b.cost);
  return out.slice(0, MAX_CANDIDATES);
}

function transition(prev, curr, prevInfo, currInfo, key, strict) {
  const hard = [];
  const warnings = [];
  const [ps, pa, pt, pb] = prev.midi;
  const [s, a, t, b] = curr.midi;
  const prevChord = prevInfo.chord;
  const currChord = currInfo.chord;
  const prevPcs = prevInfo.pcs;
  const currPcs = currInfo.pcs;

  // 声部超越（voice overlap）
  if (s < pa || a > ps || a < pt || t > pa || t < pb || b > pt) {
    hard.push({ type: 'overlap', text: '出现声部超越（某声部越过相邻声部的前一个音）' });
  }

  // 平行五/八度：任意两个声部，同向进行且音程保持纯五/八度
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const ip = mod12(prev.midi[i] - prev.midi[j]);
      const ic = mod12(curr.midi[i] - curr.midi[j]);
      const d1 = curr.midi[i] - prev.midi[i];
      const d2 = curr.midi[j] - prev.midi[j];
      if ((ip === 0 || ip === 7) && ip === ic && d1 !== 0 && d2 !== 0 && Math.sign(d1) === Math.sign(d2)) {
        hard.push({
          type: ip === 7 ? 'parallel-fifth' : 'parallel-octave',
          voices: [VOICE_KEYS[i], VOICE_KEYS[j]],
          text: `${VOICE_KEYS[i]}/${VOICE_KEYS[j]} 形成平行${ip === 7 ? '五度' : '八度'}`,
          step: currInfo.index,
        });
      }
    }
  }

  // 外声部隐伏五/八度：同向到达纯五/八度，且女高音跳进
  const ds = s - ps;
  const db = b - pb;
  const outerPrev = mod12(ps - pb);
  const outerCurr = mod12(s - b);
  if ((outerCurr === 0 || outerCurr === 7) && ds !== 0 && db !== 0 &&
      Math.sign(ds) === Math.sign(db) && Math.abs(ds) > 2) {
    hard.push({
      type: 'direct',
      text: `外声部同向到达${outerCurr === 7 ? '纯五度' : '八度'}（女高音跳进），构成隐伏${outerCurr === 7 ? '五度' : '八度'}`,
      step: currInfo.index,
    });
  }

  // 导音解决（严格：当后一和弦含主音时，导音必须上行到主音）
  if (key && prevInfo.lead != null && currPcs.includes(mod12(key.tonic))) {
    const tonic = mod12(key.tonic);
    for (let i = 0; i < 4; i++) {
      if (mod12(prev.midi[i]) !== prevInfo.lead) continue;
      if (mod12(curr.midi[i]) !== tonic) {
        hard.push({
          type: 'leading-tone',
          step: currInfo.index,
          voice: VOICE_KEYS[i],
          text: `${VOICE_KEYS[i]} 的导音 ${midiName(prev.midi[i], prevInfo.spelling)} 未上行解决到主音`,
        });
      }
    }
  }

  // 七音下行解决（严格：后一和弦变化时，七音必须下行级进）
  if (prevInfo.seventh != null && prevChord && currChord &&
      prevInfo.label !== currInfo.label) {
    for (let i = 0; i < 4; i++) {
      if (mod12(prev.midi[i]) !== prevInfo.seventh) continue;
      const d = curr.midi[i] - prev.midi[i];
      if (d !== -1 && d !== -2) {
        hard.push({
          type: 'seventh',
          step: currInfo.index,
          voice: VOICE_KEYS[i],
          text: `${VOICE_KEYS[i]} 的和弦七音 ${midiName(prev.midi[i], prevInfo.spelling)} 未下行级进解决`,
        });
      }
    }
  }

  // 声部进行代价
  let cost = 0;
  const weights = { S: 0.62, A: 0.48, T: 0.36, B: 0.24 };
  for (let i = 0; i < 4; i++) {
    const d = Math.abs(curr.midi[i] - prev.midi[i]);
    cost += d * weights[VOICE_KEYS[i]];
    if (i === 0) {
      if (d > 4) cost += (d - 4) * 1.2;
      if (d > 7) cost += (d - 7) * 1.5;
    } else if (i === 3) {
      if (d > 7) cost += (d - 7) * 0.6;
    } else if (d > 7) {
      cost += (d - 7) * 0.5;
    }
    if (d === 6) cost += 1.6; // 三全音跳进，给一点压力
    if (d > 12) cost += (d - 12) * 2;
  }
  if (ds * db < 0) cost -= 0.5;
  else if (ds !== 0 && db !== 0) cost += 0.2;

  if (strict) {
    return { ok: hard.length === 0, cost, hard, warnings };
  }
  return { ok: true, cost: cost + hard.length * 60, hard, warnings };
}

function collectSuggestions(result) {
  const set = new Set();
  for (const it of result.issues) {
    if (it.type === 'parallel-fifth' || it.type === 'parallel-octave') {
      set.add('平行五/八度：尝试改变其中一个声部的音区或和弦转位，或插入经过和弦/中介和弦。');
    } else if (it.type === 'direct') {
      set.add('隐伏五/八度：让外声部反向进行，或把女高音改成级进。');
    } else if (it.type === 'overlap') {
      set.add('声部超越/交叉：缩小相邻声部的间距，或把某个声部移高/移低八度。');
    } else if (it.type === 'leading-tone') {
      set.add('导音解决：让导音上行半音到主音，或调整后一和弦。');
    } else if (it.type === 'seventh') {
      set.add('七音解决：让和弦七音下行级进到后一和弦的和弦音。');
    } else if (it.type === 'range' || it.type === 'spacing') {
      set.add('音域/间距：尝试转位、移高/移低八度，或把和弦音重新分配给相邻声部。');
    } else if (it.type === 'unsupported') {
      set.add('该环节不是三度叠置和弦：请改为三和弦/七和弦，或先省略延伸音。');
    } else if (it.type === 'no-candidate') {
      set.add('该和弦在严格音域/间距内无法排列：请转位、移高/移低八度，或减少和弦音。');
    }
  }
  if (!result.strictOk) {
    set.add('整体建议：先简化进行（减少九/十一/十三和弦与密集转位），再逐步加入色彩音；必要时用经过和弦替代平行进行。');
  }
  return [...set].slice(0, 8);
}

/**
 * 分析整条和弦进行，生成四声部。
 * @param {Array} steps 和弦进行环节（含 pcs/bass/label/chord）
 * @param {Object} opts { key, tempo }
 * @returns {Object}
 */
export function analyzeSatb(steps, opts = {}) {
  const key = opts.key || null;
  const list = Array.isArray(steps) ? steps : [];
  const base = {
    ok: false, strictOk: false, chords: [], voices: [],
    issues: [], warnings: [], suggestions: [], key, tempo: opts.tempo || 84,
  };
  if (!list.length) {
    base.issues.push({ type: 'empty', text: '和弦进行为空。' });
    base.suggestions = ['请先在「编辑列表」中加入至少两个和弦。'];
    return base;
  }
  const infos = [];
  for (let i = 0; i < list.length; i++) {
    const info = prepareChord(list[i], i, key);
    if (!info.ok) {
      base.issues.push({
        type: info.message.includes('不是三和弦') || info.message.includes('三度叠置') ? 'unsupported' : 'no-candidate',
        step: i,
        text: info.message,
      });
      if (info.suggestion) base.suggestions.push(info.suggestion);
      continue;
    }
    if (info.omitted.length) {
      base.warnings.push({
        type: 'reduction',
        step: i,
        text: `第 ${i + 1} 个和弦「${info.label}」含 ${info.rawPcs.length} 个音级；四声部省略了 ${info.omitted.map(pc => pcName(pc, info.spelling)).join('、')}。`,
      });
    }
    const cands = makeCandidates(info);
    if (!cands.length) {
      base.issues.push({
        type: 'no-candidate',
        step: i,
        text: `第 ${i + 1} 个和弦「${info.label}」在 SATB 音域/间距/重复音规则内没有可用排列。`,
      });
      base.suggestions.push(`第 ${i + 1} 个和弦：尝试转位、移高/移低八度，或减少和弦音。`);
    }
    infos.push({ ...info, candidates: cands });
  }

  if (infos.length !== list.length) {
    base.suggestions = [...new Set(base.suggestions)].slice(0, 8);
    return base;
  }

  // 严格 DP
  const n = infos.length;
  let dp = new Array(n);
  let back = new Array(n);
  dp[0] = infos[0].candidates.map(c => c.cost);
  back[0] = infos[0].candidates.map(() => -1);
  let strictAlive = true;
  for (let k = 1; k < n; k++) {
    const prevC = infos[k - 1].candidates;
    const currC = infos[k].candidates;
    dp[k] = new Array(currC.length).fill(Infinity);
    back[k] = new Array(currC.length).fill(-1);
    let any = false;
    for (let ci = 0; ci < currC.length; ci++) {
      let best = Infinity, bestPi = -1;
      for (let pi = 0; pi < prevC.length; pi++) {
        if (dp[k - 1][pi] === Infinity) continue;
        const tr = transition(prevC[pi], currC[ci], infos[k - 1], infos[k], key, true);
        if (!tr.ok) continue;
        const val = dp[k - 1][pi] + currC[ci].cost + tr.cost;
        if (val < best) { best = val; bestPi = pi; }
      }
      if (bestPi >= 0) {
        dp[k][ci] = best;
        back[k][ci] = bestPi;
        any = true;
      }
    }
    if (!any) { strictAlive = false; break; }
  }

  let strictPath = null;
  if (strictAlive) {
    let bestEnd = -1, bestVal = Infinity;
    for (let i = 0; i < dp[n - 1].length; i++) {
      if (dp[n - 1][i] < bestVal) { bestVal = dp[n - 1][i]; bestEnd = i; }
    }
    if (bestEnd >= 0) {
      strictPath = [];
      let idx = bestEnd;
      for (let k = n - 1; k >= 0; k--) {
        strictPath.unshift(idx);
        idx = back[k][idx];
      }
    }
  }

  let path = strictPath;
  let strictOk = !!strictPath;
  let hardIssues = [];

  if (!path) {
    // 最佳近似 DP：允许硬性违规，但重罚
    dp = new Array(n);
    back = new Array(n);
    dp[0] = infos[0].candidates.map(c => c.cost);
    back[0] = infos[0].candidates.map(() => -1);
    for (let k = 1; k < n; k++) {
      const prevC = infos[k - 1].candidates;
      const currC = infos[k].candidates;
      dp[k] = new Array(currC.length).fill(Infinity);
      back[k] = new Array(currC.length).fill(-1);
      for (let ci = 0; ci < currC.length; ci++) {
        for (let pi = 0; pi < prevC.length; pi++) {
          if (dp[k - 1][pi] === Infinity) continue;
          const tr = transition(prevC[pi], currC[ci], infos[k - 1], infos[k], key, false);
          const val = dp[k - 1][pi] + currC[ci].cost + tr.cost;
          if (val < dp[k][ci]) {
            dp[k][ci] = val;
            back[k][ci] = pi;
          }
        }
      }
    }
    let bestEnd = -1, bestVal = Infinity;
    for (let i = 0; i < dp[n - 1].length; i++) {
      if (dp[n - 1][i] < bestVal) { bestVal = dp[n - 1][i]; bestEnd = i; }
    }
    if (bestEnd < 0) {
      base.issues.push({ type: 'no-candidate', text: '无法为整条进行生成任何四声部路径。' });
      base.suggestions = [...new Set(base.suggestions)].slice(0, 8);
      return base;
    }
    path = [];
    let idx = bestEnd;
    for (let k = n - 1; k >= 0; k--) {
      path.unshift(idx);
      idx = back[k][idx];
    }
  }

  // 组装
  const voices = path.map((ci, k) => {
    const c = infos[k].candidates[ci];
    return { S: c.S, A: c.A, T: c.T, B: c.B, midi: c.midi };
  });
  const chords = infos.map(info => ({
    label: info.label, pcs: info.pcs, bass: info.bassPc,
    root: info.root, quality: info.chord.quality,
    reduced: info.reduced, omitted: info.omitted,
    roman: info.roman, degree: info.degree,
    spelling: info.spelling,
    step: info.step,
  }));

  // 未启用调性时的提示
  if (!key) {
    base.warnings.push({
      type: 'no-key',
      text: '未启用调性：导音、级数与七音解决检查不可用；建议先选择和声调性。',
    });
  }
  // 重复三音/导音等纵向提示
  for (let k = 0; k < n; k++) {
    const info = infos[k];
    if (!info.isTriad) continue;
    const counts = {};
    for (const midi of voices[k].midi) {
      const pc = mod12(midi);
      counts[pc] = (counts[pc] || 0) + 1;
    }
    for (const [pcStr, count] of Object.entries(counts)) {
      if (count < 2) continue;
      const pc = Number(pcStr);
      if (pc === info.lead) {
        base.warnings.push({
          type: 'doubled-leading',
          step: k,
          text: `第 ${k + 1} 个和弦：导音被重复（严格四部和声中应避免）。`,
        });
      } else if (pc === info.third && info.chord.quality !== 'dim') {
        base.warnings.push({
          type: 'doubled-third',
          step: k,
          text: `第 ${k + 1} 个和弦：重复了三音；通常优先重复根音或五音。`,
        });
      }
    }
  }

  // 收集路径上的硬性/软性问题
  if (!strictOk) {
    for (let k = 1; k < n; k++) {
      const tr = transition(infos[k - 1].candidates[path[k - 1]], infos[k].candidates[path[k]], infos[k - 1], infos[k], key, true);
      for (const h of tr.hard) {
        hardIssues.push({
          ...h,
          text: `第 ${k}→${k + 1} 个和弦：${h.text}`,
          step: k,
        });
      }
    }
    // 去重最多 12 条
    const seen = new Set();
    base.issues = hardIssues.filter(h => {
      const key = h.type + ':' + (h.voices || []).join(',') + ':' + h.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  }

  const warnings = [];
  for (let k = 1; k < n; k++) {
    const tr = transition(infos[k - 1].candidates[path[k - 1]], infos[k].candidates[path[k]], infos[k - 1], infos[k], key, false);
    warnings.push(...tr.warnings);
  }
  // 去重 & 限制
  const seenW = new Set();
  base.warnings = [...base.warnings, ...warnings].filter(w => {
    const key = w.type + ':' + w.step + ':' + w.voice + ':' + w.text;
    if (seenW.has(key)) return false;
    seenW.add(key);
    return true;
  }).slice(0, 10);

  base.ok = true;
  base.strictOk = strictOk;
  base.chords = chords;
  base.voices = voices;
  base.issues = strictOk ? [] : base.issues;
  base.suggestions = collectSuggestions(base);
  return base;
}

export { VOICE_ZH, RANGES, midiName, VOICE_KEYS };
