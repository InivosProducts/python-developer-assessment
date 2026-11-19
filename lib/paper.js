// Shared server-side logic: build a paper from a seed, sanitise it for the browser,
// sign/verify the start token, and grade a submission.
const crypto = require("crypto");
const { MODULES, BANK } = require("./bank");

const TOTAL_QUESTIONS = 20;
const FREE_TEXT_COUNT = 6;
const MAX_DURATION_MS = 3 * 60 * 60 * 1000; // tokens older than 3 hours are rejected

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 8 modules x 2 questions = 16, plus 4 extra MCQs from 4 random modules = 20.
// 6 random modules contribute one free-text question each -> 14 MCQ + 6 free text.
function buildPaper(seed) {
  const r = mulberry32(seed);
  const mods = shuffle([...Array(MODULES.length).keys()], r);
  const ftMods = new Set(mods.slice(0, FREE_TEXT_COUNT));
  const extraMods = new Set(shuffle(mods, r).slice(0, TOTAL_QUESTIONS - 2 * MODULES.length));
  let out = [];
  mods.forEach((m) => {
    const mcq = shuffle(BANK.filter((q) => q.m === m && q.type === "mcq"), r);
    const ft = shuffle(BANK.filter((q) => q.m === m && q.type === "text"), r);
    const nMcq = (ftMods.has(m) ? 1 : 2) + (extraMods.has(m) ? 1 : 0);
    const picks = mcq.slice(0, nMcq).concat(ftMods.has(m) ? [ft[0]] : []);
    picks.forEach((q) => {
      const item = { ...q, id: BANK.indexOf(q) };
      if (q.type === "mcq") item.order = shuffle(q.options.map((_, i) => i), r);
      out.push(item);
    });
  });
  return shuffle(out, r);
}

// What the browser is allowed to see: no correct answers, explanations or marking keys.
function publicPaper(paper) {
  return paper.map((q) => ({
    type: q.type,
    module: MODULES[q.m],
    q: q.q,
    options: q.type === "mcq" ? q.order.map((oi) => q.options[oi]) : undefined,
  }));
}

function secret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 16) throw new Error("TOKEN_SECRET env var is missing or shorter than 16 characters");
  return s;
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac || ""), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
}

function autoScore(q, txt) {
  txt = typeof txt === "string" ? txt : "";
  const hits = q.keys.map((g) => g.some((k) => (k instanceof RegExp ? k.test(txt) : txt.toLowerCase().includes(k))));
  const frac = hits.filter(Boolean).length / hits.length;
  return { hits, pts: Math.round(frac * 4) / 2 }; // 0-2 in 0.5 steps
}

// answers: array indexed by question position. MCQ -> displayed option index (0-3); text -> string.
function grade(paper, answers) {
  answers = Array.isArray(answers) ? answers : [];
  let total = 0, max = 0;
  const byModule = {};
  const details = paper.map((q, i) => {
    const a = answers[i];
    let pts, mx, d;
    if (q.type === "mcq") {
      mx = 1;
      const chosen = Number.isInteger(a) && a >= 0 && a < q.order.length ? q.order[a] : null;
      pts = chosen === q.a ? 1 : 0;
      d = { chosen: chosen === null ? null : q.options[chosen], correct: q.options[q.a] };
    } else {
      mx = 2;
      const s = autoScore(q, a);
      pts = s.pts;
      d = {
        answer: typeof a === "string" ? a.slice(0, 5000) : "",
        keyPoints: q.keys.map((g, k) => ({ label: g[0] instanceof RegExp ? "correct comprehension syntax" : g[0], hit: s.hits[k] })),
        model: q.model,
      };
    }
    total += pts; max += mx;
    const mod = MODULES[q.m];
    byModule[mod] = byModule[mod] || { points: 0, max: 0 };
    byModule[mod].points += pts; byModule[mod].max += mx;
    return { n: i + 1, type: q.type, module: mod, question: q.q, points: pts, max: mx, src: q.src, ...d };
  });
  return { total, max, percent: Math.round((total / max) * 100), byModule, details };
}

module.exports = { buildPaper, publicPaper, sign, verify, secret, grade, MAX_DURATION_MS, MODULES };
