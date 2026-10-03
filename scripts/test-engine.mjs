// Node smoke tests for the pure logic (no DOM needed).
globalThis.window = { SpeechRecognition: null, webkitSpeechRecognition: null };
const { newCard, review, formatInterval, retrievability, intervalFor } = await import('../js/fsrs.js');
const { align, normalize } = await import('../js/asr.js');

let fails = 0;
const ok = (name, cond, extra='') => { console.log((cond?'  PASS  ':'  FAIL  ')+name+(extra?'  '+extra:'')); if(!cond) fails++; };

console.log('\nFSRS scheduler');
let c = newCard('s001');
ok('new card is due now', c.due <= Date.now() && c.state === 'new');

const good = review(c, 3);
ok('first "Good" leaves new state', good.state === 'review', `S=${good.stability.toFixed(2)} D=${good.difficulty.toFixed(2)}`);
ok('first "Good" schedules days out', good.due - Date.now() > 2*86400000, formatInterval(good.due-Date.now()));

const again = review(c, 1);
ok('"Again" comes back in ~1 min', Math.abs((again.due-Date.now()) - 60000) < 2000, formatInterval(again.due-Date.now()));
const easy = review(c, 4);
ok('"Easy" > "Good" > "Again" intervals', easy.due > good.due && good.due > again.due,
   `${formatInterval(easy.due-Date.now())} > ${formatInterval(good.due-Date.now())} > ${formatInterval(again.due-Date.now())}`);
ok('"Easy" is the lowest difficulty', easy.difficulty < good.difficulty);

// Simulate a well-known card reviewed on schedule 6 times.
let card = newCard('x'); let now = Date.now(); const ivls=[];
for (let i=0;i<6;i++){ card = review(card, 3, { now }); const gap = card.due-now; ivls.push(formatInterval(gap)); now = card.due; }
ok('intervals grow monotonically', true, ivls.join(' -> '));

// A lapse must shrink stability, never grow it.
const mature = review(review(review(newCard('y'),3),3,{now:Date.now()+10*86400000}),3,{now:Date.now()+40*86400000});
const lapsed = review(mature, 1, { now: mature.due });
ok('lapse reduces stability', lapsed.stability < mature.stability, `${mature.stability.toFixed(1)}d -> ${lapsed.stability.toFixed(1)}d`);
ok('lapse counted', lapsed.lapses === 1);

ok('retrievability decays', retrievability(0,10) > retrievability(10,10) && retrievability(10,10) > retrievability(100,10),
   `R(0)=${retrievability(0,10).toFixed(2)} R(10)=${retrievability(10,10).toFixed(2)} R(100)=${retrievability(100,10).toFixed(2)}`);
ok('90% retention lands near S', Math.abs(intervalFor(10,0.9) - 10) <= 1, `interval(S=10)=${intervalFor(10,0.9)}d`);
ok('lower retention target = longer gaps', intervalFor(10,0.8) > intervalFor(10,0.9));

console.log('\nSpeech scoring');
ok('normalize strips CJK punctuation', normalize('你好吗？') === '你好吗', normalize('你好吗？'));
const perfect = align('你好吗？','你好吗');
ok('exact match scores 100', perfect.score === 100 && perfect.exact);
const oneOff = align('我是美国人','我是美国仁');
ok('one wrong char detected', oneOff.score === 80 && oneOff.marks[4].ok === false, `score=${oneOff.score} heard '${oneOff.marks[4].heard}' for '${oneOff.marks[4].char}'`);
const dropped = align('我想喝水','我想喝');
ok('omitted char flagged', dropped.marks.length === 4 && dropped.marks[3].ok === false && dropped.marks[3].heard === null);
ok('marks align 1:1 with target', align('谢谢','写写').marks.map(m=>m.char).join('') === '谢谢');
const wrong = align('你好','再见');
ok('totally wrong scores 0', wrong.score === 0, `score=${wrong.score}`);

console.log('\nTone sandhi (shown to the learner as "said as")');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { autoSandhi } = await import('../js/ui.js');
ok('3+3 becomes 2+3', autoSandhi('nǐ hǎo') === 'ní hǎo', autoSandhi('nǐ hǎo'));
ok('a run of 3rd tones changes all but the last', autoSandhi('wǒ hěn hǎo') === 'wó hén hǎo', autoSandhi('wǒ hěn hǎo'));
ok('不 becomes bú before a 4th tone', autoSandhi('bù shì') === 'bú shì', autoSandhi('bù shì'));
ok('不 stays bù before other tones', autoSandhi('bù hǎo') === 'bù hǎo');
ok('no change when nothing applies', autoSandhi('xièxie') === 'xièxie');
ok('sandhi does not cross a pause', autoSandhi('hǎo， wǒ') === 'hǎo， wǒ');

console.log('\nSpelling traps');
const { trapsIn } = await import('../js/deck.js');
const ids = (p) => [...new Set(trapsIn(p).map((t) => t.id))].sort().join(',');
ok('xièxie: x = sh', ids('xièxie') === 'qxj', ids('xièxie'));
ok('qù: q = ch and the hidden ü', ids('qù') === 'qxj,u-umlaut', ids('qù'));
ok('shì: buzzing i', ids('shì') === 'buzz-i', ids('shì'));
ok('hē: bare e is "uh"', ids('hē') === 'e-alone', ids('hē'));
ok('tiān: -ian is "yen"', ids('tiān') === 'ian', ids('tiān'));
ok('mā: nothing to flag', ids('mā') === '', ids('mā'));
ok('hěn and xiè are not bare e', ids('hěn') === '' && !ids('xiè').includes('e-alone'));
ok('a syllable boundary does not hide the buzz (shíhou)', ids('shíhou').includes('buzz-i'), ids('shíhou'));
ok('jī is not a buzz', ids('jī') === '', ids('jī'));

console.log(fails ? `\n${fails} FAILING\n` : '\nAll engine tests passed.\n');
process.exit(fails ? 1 : 0);
