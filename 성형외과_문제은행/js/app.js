
const circled = ['①','②','③','④','⑤'];
const state = {
  bank: null,
  term: '',
  wrongOnly: false,
  shuffleOn: false,
  shufflePlans: {},
  responses: {}
};

const UNIQUE_BANK = 'UNIQUE';

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function normalizeForUnique(value){
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[.,;:()[\]{}·ㆍ\-–—_]/g, '')
    .toLowerCase();
}
function promptKey(q){
  return normalizeForUnique(q.prompt);
}
function optionSignature(q){
  return (q.options || []).map(o => normalizeForUnique(o.text)).join('|');
}
function answerIndexSignature(q){
  return (q.answer || []).join('|');
}
function answerValueSignature(q){
  return (q.answer || [])
    .map(n => normalizeForUnique(q.options?.[n - 1]?.text || ''))
    .sort()
    .join('|');
}
function answerValueSet(q){
  return new Set(
    (q.answer || [])
      .map(n => normalizeForUnique(q.options?.[n - 1]?.text || ''))
      .filter(Boolean)
  );
}
function answersOverlap(a, b){
  const aValues = answerValueSet(a.q);
  const bValues = answerValueSet(b.q);
  if(!aValues.size || !bValues.size) return answerIndexSignature(a.q) === answerIndexSignature(b.q);
  return [...aValues].some(value => bValues.has(value));
}
function splitByAnswerOverlap(group){
  if(group.length < 2) return [group];
  const parent = group.map((_, idx) => idx);
  const find = idx => parent[idx] === idx ? idx : (parent[idx] = find(parent[idx]));
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if(rootA !== rootB) parent[rootB] = rootA;
  };
  for(let i = 0; i < group.length; i++){
    for(let j = i + 1; j < group.length; j++){
      if(answersOverlap(group[i], group[j])) union(i, j);
    }
  }
  const parts = new Map();
  group.forEach((item, idx) => {
    const root = find(idx);
    if(!parts.has(root)) parts.set(root, []);
    parts.get(root).push(item);
  });
  return [...parts.values()];
}
function sourceRef(item){
  return `${item.bank}-${String(item.q.num).padStart(2, '0')}`;
}
function uniqueBy(values, keyFn){
  const seen = new Set();
  return values.filter(value => {
    const key = keyFn(value);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function cloneQuestion(q){
  return {
    ...q,
    options: (q.options || []).map(o => ({ ...o })),
    answer: [...(q.answer || [])],
    explanations: (q.explanations || []).map(e => ({ ...e })),
    images: [...(q.images || [])]
  };
}
function buildUniqueQuestion(group, num, samePromptOtherRefs = []){
  const representative = group[0];
  const q = cloneQuestion(representative.q);
  const sourceRefs = group.map(sourceRef);
  const notes = uniqueBy(
    group.map(item => item.q.note).filter(Boolean),
    note => note
  );
  const optionSigs = new Set(group.map(item => optionSignature(item.q)));
  const answerValueSigs = new Set(group.map(item => answerValueSignature(item.q)));
  const answerIndexSigs = new Set(group.map(item => answerIndexSignature(item.q)));
  const sourceText = sourceRefs.join(', ');

  q.num = num;
  q.sourceLabel = sourceRefs.length > 4
    ? `출처 ${sourceRefs.length}개 · ${sourceRefs.slice(0, 3).join(' · ')} 외`
    : sourceRefs.join(' · ');
  q.explanations = uniqueBy(
    group.flatMap(item => item.q.explanations || []),
    e => `${e.bank}|${e.page}|${e.src}|${e.extra ? 1 : 0}`
  ).map(e => ({ ...e }));

  if(optionSigs.size > 1 && answerValueSigs.size === 1){
    notes.push(`동일 발문 중 보기 구성이 달라진 버전이 있습니다. 정답 문구는 동일합니다. 출처: ${sourceText}.`);
  } else if(optionSigs.size > 1 && answerIndexSigs.size === 1){
    notes.push(`동일 발문 중 보기 구성이 달라진 버전이 있습니다. 정답 번호는 같지만 보기 문구가 달라 대표 문항(${sourceRefs[0]}) 기준으로 표시합니다. 출처: ${sourceText}.`);
  } else if(optionSigs.size > 1){
    notes.push(`동일 발문 중 보기 또는 정답 구성이 다른 버전이 있어 대표 문항(${sourceRefs[0]}) 기준으로 표시합니다. 출처: ${sourceText}.`);
  }
  if(samePromptOtherRefs.length){
    notes.push(`동일 발문이지만 정답 구성이 다른 버전은 별도 고유문항으로 분리했습니다. 다른 출처: ${samePromptOtherRefs.join(', ')}.`);
  }

  q.note = notes.join(' ');
  return q;
}
function buildUniqueQuestions(){
  if(window.BANK_DATA?.[UNIQUE_BANK]) return window.BANK_DATA[UNIQUE_BANK];
  const groups = new Map();
  ['A', 'B', 'C', 'D'].forEach(bank => {
    (window.BANK_DATA?.[bank] || []).forEach(q => {
      const key = promptKey(q);
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ bank, q });
    });
  });
  const groupedQuestions = [];
  groups.forEach(promptGroup => {
    const parts = splitByAnswerOverlap(promptGroup);
    parts.forEach(part => {
      const partSet = new Set(part);
      groupedQuestions.push({
        group: part,
        samePromptOtherRefs: parts.length > 1
          ? promptGroup.filter(item => !partSet.has(item)).map(sourceRef)
          : []
      });
    });
  });
  const questions = groupedQuestions.map((item, idx) => buildUniqueQuestion(item.group, idx + 1, item.samePromptOtherRefs));
  if(window.BANK_DATA) window.BANK_DATA[UNIQUE_BANK] = questions;
  return questions;
}
function getQuestionsForBank(bank){
  if(bank === UNIQUE_BANK) return buildUniqueQuestions();
  return (window.BANK_DATA && window.BANK_DATA[bank]) || [];
}
function bankLabel(bank){
  return bank === UNIQUE_BANK ? '고유' : bank;
}
function defaultOptionOrder(q){
  return q.options.map((_, idx) => idx);
}
function answerText(q, optionOrder = defaultOptionOrder(q)){
  return q.answer.map(n => {
    const optionIdx = n - 1;
    const displayIdx = optionOrder.indexOf(optionIdx);
    const labelIdx = displayIdx >= 0 ? displayIdx : optionIdx;
    return `${circled[labelIdx] || q.options[optionIdx]?.label || n} ${q.options[optionIdx]?.text || ''}`;
  }).join(' / ');
}
function questionSearchText(q){
  return [q.num, q.prompt, ...q.options.map(o => o.text), answerText(q), q.note || ''].join(' ').toLowerCase();
}
function shuffleArray(values){
  const shuffled = [...values];
  for(let i = shuffled.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if(shuffled.length > 1 && shuffled.every((value, idx) => value === values[idx])){
    shuffled.push(shuffled.shift());
  }
  return shuffled;
}
function createShufflePlan(questions){
  return {
    questionNums: shuffleArray(questions.map(q => q.num)),
    optionsByQuestion: Object.fromEntries(
      questions.map(q => [q.num, shuffleArray(defaultOptionOrder(q))])
    )
  };
}
function getRenderItems(bank, questions){
  if(!state.shuffleOn){
    return questions.map(q => ({ q, optionOrder: defaultOptionOrder(q) }));
  }
  if(!state.shufflePlans[bank]){
    state.shufflePlans[bank] = createShufflePlan(questions);
  }
  const plan = state.shufflePlans[bank];
  const byNum = new Map(questions.map(q => [q.num, q]));
  return plan.questionNums
    .map(num => byNum.get(num))
    .filter(Boolean)
    .map(q => ({ q, optionOrder: plan.optionsByQuestion[q.num] || defaultOptionOrder(q) }));
}
function responseKey(qnum){
  return `${state.bank}-${qnum}`;
}
function getResponse(qnum){
  return state.responses[responseKey(qnum)] || {};
}
function setResponse(qnum, patch){
  state.responses[responseKey(qnum)] = { ...getResponse(qnum), ...patch };
}
function clearBankResponses(bank = state.bank){
  Object.keys(state.responses).forEach(key => {
    if(key.startsWith(`${bank}-`)) delete state.responses[key];
  });
}
function figureHtml(q, bank){
  const imgs = Array.isArray(q.images) ? q.images : [];
  if(!imgs.length) return '';
  return `<div class="figure-strip" aria-label="문항 시각자료">
    ${imgs.map((src, idx) => `
      <button class="figure-frame" type="button" data-img="${escapeHtml(src)}" title="이미지 크게 보기">
        <img src="${escapeHtml(src)}" alt="${bank}-${String(q.num).padStart(2,'0')} 문항 figure ${idx+1}">
      </button>`).join('')}
  </div>`;
}
function choicesHtml(q, optionOrder){
  return optionOrder.map((optionIdx, displayIdx) => {
    const o = q.options[optionIdx];
    const label = circled[displayIdx] || o?.label || String(displayIdx + 1);
    return `<button class="choice" type="button" data-choice="${optionIdx + 1}"><span class="choice-label">${escapeHtml(label)}</span><span>${escapeHtml(o?.text || '')}</span></button>`;
  }).join('');
}
function explanationHtml(q){
  if(!q.explanations?.length) return '<p class="muted">연결된 해설 이미지가 없습니다.</p>';
  return q.explanations.map(e => `
    <figure class="exp-figure">
      <figcaption>문제은행 ${escapeHtml(e.bank)} 해설 p.${escapeHtml(e.page)}${e.extra ? ' · 추가/정정 참고' : ''}</figcaption>
      <button class="exp-image-button" type="button" data-img="${escapeHtml(e.src)}" title="해설 이미지 크게 보기">
        <img src="${escapeHtml(e.src)}" alt="${escapeHtml(e.bank)} 해설 ${escapeHtml(e.page)}쪽">
      </button>
    </figure>`).join('');
}
function renderBank(bank){
  state.bank = bank;
  const root = document.getElementById('question-root');
  const questions = getQuestionsForBank(bank);
  const renderItems = getRenderItems(bank, questions);
  document.getElementById('countText').textContent = `${questions.length}문항`;
  root.innerHTML = renderItems.map(({ q, optionOrder }) => `
    <article class="question-card" id="q${q.num}" data-q="${q.num}" data-text="${escapeHtml(questionSearchText(q))}">
      <div class="question-head">
        <div>
          <div class="question-kicker">Question</div>
          <h2>${bankLabel(bank)}-${String(q.num).padStart(2,'0')}</h2>
        </div>
        <a class="source-chip" href="#q${q.num}" title="문항 고유 링크">${escapeHtml(q.sourceLabel || `PDF p.${q.sourcePage}`)}</a>
      </div>
      <div class="question-content">
        <p class="prompt">${escapeHtml(q.prompt)}</p>
        ${figureHtml(q, bank)}
        <div class="choices" role="group" aria-label="${bank}-${q.num} 선택지">
          ${choicesHtml(q, optionOrder)}
        </div>
        <button class="explanation-toggle" type="button" aria-expanded="false" aria-controls="feedback-${bank}-${q.num}">해설 열기</button>
        <section class="feedback" id="feedback-${bank}-${q.num}" aria-live="polite">
          <div class="result"></div>
          <div class="answer-line">정답 <strong>${escapeHtml(answerText(q, optionOrder))}</strong></div>
          ${q.note ? `<div class="note"><strong>노트</strong><span>${escapeHtml(q.note)}</span></div>` : ''}
          <div class="explanations">${explanationHtml(q)}</div>
        </section>
      </div>
    </article>`).join('');
  attachChoiceEvents();
  attachExplanationToggleEvents();
  attachImageModalEvents();
  restoreRenderedState();
  updateShuffleControl();
  applyFilter();
}
function setExplanationOpen(card, isOpen, persist = true){
  const feedback = card.querySelector('.feedback');
  const toggle = card.querySelector('.explanation-toggle');
  feedback?.classList.toggle('show', isOpen);
  if(toggle){
    toggle.textContent = isOpen ? '해설 닫기' : '해설 열기';
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
  if(persist) setResponse(Number(card.dataset.q), { explanationOpen: isOpen });
}
function renderCardState(card){
  const qnum = Number(card.dataset.q);
  const q = getQuestionsForBank(state.bank).find(item => item.num === qnum);
  const response = getResponse(qnum);
  const chosen = Number(response.chosen);
  const hasChoice = Number.isInteger(chosen) && chosen > 0;
  const isCorrect = hasChoice && q.answer.includes(chosen);
  const shouldReveal = hasChoice || response.revealed;
  const result = card.querySelector('.result');

  card.classList.remove('answered', 'answered-correct', 'answered-wrong');
  delete card.dataset.answered;
  delete card.dataset.correct;
  if(result){
    result.textContent = '';
    result.className = 'result';
  }

  card.querySelectorAll('.choice').forEach(choice => {
    choice.classList.remove('correct', 'wrong', 'dim');
    choice.removeAttribute('aria-pressed');
  });

  if(shouldReveal){
    card.classList.add('answered');
    card.dataset.answered = '1';
    if(hasChoice){
      card.classList.add(isCorrect ? 'answered-correct' : 'answered-wrong');
      card.dataset.correct = isCorrect ? '1' : '0';
      if(result){
        result.textContent = isCorrect ? '정답입니다' : '오답입니다';
        result.className = 'result ' + (isCorrect ? 'good' : 'bad');
      }
    }
    card.querySelectorAll('.choice').forEach(choice => {
      const val = Number(choice.dataset.choice);
      choice.setAttribute('aria-pressed', hasChoice && val === chosen ? 'true' : 'false');
      if(q.answer.includes(val)) choice.classList.add('correct');
      else if(hasChoice && val === chosen) choice.classList.add('wrong');
      else choice.classList.add('dim');
    });
  }

  setExplanationOpen(card, Boolean(response.explanationOpen), false);
}
function restoreRenderedState(){
  document.querySelectorAll('.question-card').forEach(renderCardState);
}
function attachChoiceEvents(){
  document.querySelectorAll('.question-card').forEach(card => {
    const qnum = Number(card.dataset.q);
    const q = getQuestionsForBank(state.bank).find(item => item.num === qnum);
    card.querySelectorAll('.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = Number(btn.dataset.choice);
        const isCorrect = q.answer.includes(chosen);
        setResponse(qnum, { chosen, correct: isCorrect, revealed: true });
        renderCardState(card);
        updateStats();
      });
    });
  });
}
function attachExplanationToggleEvents(){
  document.querySelectorAll('.explanation-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.question-card');
      if(!card) return;
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      setExplanationOpen(card, !isOpen);
    });
  });
}
function updateStats(){
  const visibleCards = [...document.querySelectorAll('.question-card:not(.hidden)')];
  const allCards = [...document.querySelectorAll('.question-card')];
  const answered = allCards.filter(card => card.dataset.answered === '1').length;
  const correct = allCards.filter(card => card.dataset.correct === '1').length;
  const stats = document.getElementById('stats');
  const progress = document.getElementById('progressBar');
  stats.textContent = `표시 ${visibleCards.length} · 풀이 ${answered} · 정답 ${correct}`;
  progress.style.width = allCards.length ? `${Math.round(answered / allCards.length * 100)}%` : '0%';
}
function applyFilter(){
  const term = (document.getElementById('search')?.value || '').trim().toLowerCase();
  state.term = term;
  document.querySelectorAll('.question-card').forEach(card => {
    const matchesText = !term || card.dataset.text.includes(term) || String(card.dataset.q) === term;
    const matchesWrong = !state.wrongOnly || card.dataset.correct === '0';
    card.classList.toggle('hidden', !(matchesText && matchesWrong));
  });
  updateStats();
}
function initControls(){
  ensureShuffleControl();
  document.getElementById('search')?.addEventListener('input', applyFilter);
  document.getElementById('shuffleToggle')?.addEventListener('click', () => {
    state.shuffleOn = !state.shuffleOn;
    if(state.shuffleOn){
      const questions = getQuestionsForBank(state.bank);
      state.shufflePlans[state.bank] = createShufflePlan(questions);
    }
    renderBank(state.bank);
  });
  document.getElementById('wrongOnly')?.addEventListener('click', event => {
    state.wrongOnly = !state.wrongOnly;
    const btn = event.currentTarget;
    btn.dataset.on = state.wrongOnly ? '1' : '0';
    btn.textContent = state.wrongOnly ? '오답만 보기 해제' : '오답만 보기';
    applyFilter();
  });
  document.getElementById('showAnswers')?.addEventListener('click', () => {
    document.querySelectorAll('.question-card').forEach(card => {
      const qnum = Number(card.dataset.q);
      setResponse(qnum, { revealed: true, explanationOpen: false });
      renderCardState(card);
    });
    updateStats();
  });
  document.getElementById('showAll')?.addEventListener('click', () => {
    document.querySelectorAll('.question-card').forEach(card => {
      const qnum = Number(card.dataset.q);
      setResponse(qnum, { revealed: true, explanationOpen: true });
      renderCardState(card);
    });
    updateStats();
  });
  document.getElementById('resetAll')?.addEventListener('click', () => {
    clearBankResponses();
    state.wrongOnly = false;
    const wrongBtn = document.getElementById('wrongOnly');
    if(wrongBtn){ wrongBtn.dataset.on = '0'; wrongBtn.textContent = '오답만 보기'; }
    const search = document.getElementById('search');
    if(search) search.value = '';
    renderBank(state.bank);
  });
}
function ensureShuffleControl(){
  const wrongBtn = document.getElementById('wrongOnly');
  if(!wrongBtn || document.getElementById('shuffleToggle')) return;
  const btn = document.createElement('button');
  btn.id = 'shuffleToggle';
  btn.className = 'tool-btn shuffle-toggle';
  btn.type = 'button';
  btn.dataset.on = '0';
  btn.textContent = '셔플 켜기';
  wrongBtn.before(btn);
}
function updateShuffleControl(){
  const btn = document.getElementById('shuffleToggle');
  if(!btn) return;
  btn.dataset.on = state.shuffleOn ? '1' : '0';
  btn.textContent = state.shuffleOn ? '셔플 끄기' : '셔플 켜기';
  btn.setAttribute('aria-pressed', state.shuffleOn ? 'true' : 'false');
}
function attachImageModalEvents(){
  document.querySelectorAll('[data-img]').forEach(btn => {
    btn.addEventListener('click', () => openImageModal(btn.dataset.img));
  });
}
function openImageModal(src){
  const modal = document.getElementById('imageModal');
  if(!modal) return;
  const img = modal.querySelector('.modal-img');
  img.src = src;
  modal.hidden = false;
  document.body.classList.add('modal-open');
}
function closeImageModal(){
  const modal = document.getElementById('imageModal');
  if(!modal) return;
  modal.hidden = true;
  modal.querySelector('.modal-img').src = '';
  document.body.classList.remove('modal-open');
}
document.addEventListener('click', event => {
  if(event.target.matches('.modal, .modal-close')) closeImageModal();
});
document.addEventListener('keydown', event => {
  if(event.key === 'Escape') closeImageModal();
});
document.addEventListener('DOMContentLoaded', () => {
  initControls();
  if(window.CURRENT_BANK) renderBank(window.CURRENT_BANK);
});
