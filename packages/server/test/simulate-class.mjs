// Dev tool: simulates a class of 24 students against a live session so the
// professor overlay can be exercised without 24 phones.
//
//   node test/simulate-class.mjs <CLASS CODE>
//
// Posts four questions with different vote weights, answers any understanding
// check, and keeps a steady flow of reaction waves running.
import { WebSocket } from 'ws';
const code = process.argv[2];
const wait = ms => new Promise(r => setTimeout(r, ms));
function open() {
  return new Promise(res => {
    const w = new WebSocket('ws://localhost:8787/ws?role=student');
    w.msgs = [];
    w.on('message', d => w.msgs.push(JSON.parse(d)));
    w.on('open', () => res(w));
  });
}
const send = (w, m) => w.send(JSON.stringify(m));

const studs = [];
for (let i = 0; i < 24; i++) { const s = await open(); send(s, { t: 'join', code, anonId: `sim-${i}` }); studs.push(s); }
await wait(600);
console.log('joined', studs.length);

// Post questions from four different students.
const qs = [
  'Will this be on the exam?',
  'Why is this O(n^2) and not O(n log n)?',
  'Can you explain recursion again?',
  'What does this algorithm actually do?',
];
for (let i = 0; i < qs.length; i++) { send(studs[i], { t: 'question:create', text: qs[i] }); await wait(350); }
await wait(700);

// Learn the ids, then drive each to a distinct vote weight.
const known = new Map();
for (const m of studs[5].msgs) {
  if (m.t === 'question:upsert') known.set(m.question.text, m.question.id);
  if (m.t === 'questions:sync') m.questions.forEach(q => known.set(q.text, q.id));
}
const weights = { [qs[2]]: 16, [qs[1]]: 8, [qs[3]]: 5, [qs[0]]: 2 };
for (const [text, target] of Object.entries(weights)) {
  const id = known.get(text);
  if (!id) continue;
  for (let i = 4; i < 4 + target; i++) send(studs[i % 24], { t: 'question:vote', questionId: id });
  await wait(200);
}
console.log('questions posted and upvoted');

// Answer any understanding check the professor opens, with a realistic spread.
for (const s of studs) {
  s.on('message', d => {
    const m = JSON.parse(d);
    if (m.t !== 'poll:open') return;
    const i = studs.indexOf(s);
    const opts = m.poll.options;
    // ~62% got it, ~25% almost, ~13% lost
    const pick = i % 8 < 5 ? 0 : i % 8 < 7 ? 1 : 2;
    setTimeout(() => send(s, { t: 'poll:answer', pollId: m.poll.id, optionId: opts[Math.min(pick, opts.length - 1)].id }), 200 + i * 40);
  });
}

// Keep a calm but continuous reaction flow so the overlay always has floaters.
const waves = [
  ['confused', 22], ['understand', 9], ['too_fast', 4],
  ['interesting', 7], ['again', 12], ['understand', 15], ['too_slow', 3],
];
for (let round = 0; round < 30; round++) {
  const [type, n] = waves[round % waves.length];
  studs.slice(0, n).forEach(s => send(s, { t: 'reaction', type }));
  await wait(2100);
}
process.exit(0);
