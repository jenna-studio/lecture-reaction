import { WebSocket } from 'ws';
const URL='ws://localhost:8787/ws';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=[];
function open(role){return new Promise((res,rej)=>{const w=new WebSocket(`${URL}?role=${role}`);w.msgs=[];w.on('message',d=>{const m=JSON.parse(d);w.msgs.push(m);log.push([role,m.t]);});w.on('open',()=>res(w));w.on('error',rej);});}
const send=(w,m)=>w.send(JSON.stringify(m));
const last=(w,t)=>[...w.msgs].reverse().find(m=>m.t===t);

const prof=await open('professor');
send(prof,{t:'session:create'});
await wait(300);
const created=last(prof,'session:created');
console.log('1. session:created code=%s (len %d, alphabet-safe %s)',created.code,created.code.length,/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(created.code));

// 30 students join and ALL press "confused" at once
const studs=[];
for(let i=0;i<30;i++){const s=await open('student');send(s,{t:'join',code:created.code,anonId:`anon-${i}`});studs.push(s);}
await wait(700);
console.log('2. presence after 30 joins = %d', last(prof,'presence').count);

prof.msgs.length=0;
studs.forEach(s=>send(s,{t:'reaction',type:'confused'}));
await wait(2400);
const bursts=prof.msgs.filter(m=>m.t==='reaction:burst');
console.log('3. 30 simultaneous reactions -> %d burst frame(s), count=%s', bursts.length, bursts.map(b=>b.count).join(','));

// rate limit: same student reacts twice immediately
studs[0].msgs.length=0;
send(studs[0],{t:'reaction',type:'understand'});
await wait(50);
send(studs[0],{t:'reaction',type:'understand'});
await wait(300);
console.log('4. 2nd reaction within 2s -> %s', studs[0].msgs.map(m=>m.t+(m.code?`(${m.code})`:'')).join(', '));

// questions + upvotes
send(studs[1],{t:'question:create',text:'Why is this O(n^2)?'});
await wait(300);
const q=last(prof,'question:upsert').question;
console.log('5. question reaches professor: votes=%d, leaks identity=%s', q.votes, Object.keys(q).some(k=>/anon|participant|author|voter|ip/i.test(k)));
for(let i=2;i<12;i++) send(studs[i],{t:'question:vote',questionId:q.id});
await wait(700);
console.log('6. after 10 upvotes: votes=%d', last(prof,'question:upsert').question.votes);
studs[2].msgs.length=0; send(studs[2],{t:'question:vote',questionId:q.id}); await wait(200);
console.log('7. duplicate vote -> %s', last(studs[2],'error')?.code);

// understanding check
send(prof,{t:'poll:start',kind:'understanding'});
await wait(300);
const poll=last(studs[0],'poll:open').poll;
console.log('8. poll:open reached students: "%s" opts=%s', poll.question, poll.options.map(o=>o.label).join('/'));
studs.slice(0,20).forEach((s,i)=>send(s,{t:'poll:answer',pollId:poll.id,optionId:poll.options[i<14?0:i<18?1:2].id}));
await wait(500);
const r=last(prof,'poll:results').results;
console.log('9. results n=%d -> %s', r.total, r.results.map(x=>`${x.label} ${x.pct}%`).join('  '));
// change of mind replaces, not adds
send(studs[0],{t:'poll:answer',pollId:poll.id,optionId:poll.options[2].id});
await wait(700);
console.log('10. after 1 student changes answer, total still %d', last(prof,'poll:results').results.total);

// resolve
send(prof,{t:'question:resolve',questionId:q.id});
await wait(300);
console.log('11. resolve seen by student: %s', !!last(studs[3],'question:resolved'));

// end class
send(prof,{t:'session:end'});
await wait(700);
console.log('12. session:ended reached students: %s', studs.filter(s=>last(s,'session:ended')).length+'/30');
const late=await open('student'); send(late,{t:'join',code:created.code}); await wait(300);
console.log('13. join after end -> %s', last(late,'error')?.code);
const bogus=await open('student'); send(bogus,{t:'join',code:'ZZZZZ'}); await wait(300);
console.log('14. join bogus code -> %s', last(bogus,'error')?.code);
process.exit(0);
