const data = window.QUESTION_BANK_DATA;
const circled = ["①", "②", "③", "④", "⑤"];

function bankFromPage() {
  const name = location.pathname.split("/").pop().toLowerCase();
  const match = name.match(/exam-([a-d])\.html/);
  return match ? match[1].toUpperCase() : null;
}

function renderIndex() {
  const root = document.querySelector("[data-index]");
  if (!root) return;
  root.innerHTML = Object.keys(data.banks).map(bank => `
    <a class="bank-card" href="exam-${bank.toLowerCase()}.html">
      <strong>문제은행 ${bank}</strong>
      <span>${data.banks[bank].questions.length}문항 · 해설 이미지 ${data.banks[bank].explanations.length}쪽</span>
    </a>
  `).join("");
}

function renderExam() {
  const bank = bankFromPage();
  const mount = document.querySelector("[data-exam]");
  if (!bank || !mount) return;
  const bankData = data.banks[bank];
  document.title = `문제은행 ${bank}`;
  document.querySelectorAll("[data-bank-title]").forEach(el => { el.textContent = `문제은행 ${bank}`; });
  document.querySelectorAll(".nav a").forEach(a => {
    if (a.getAttribute("href") === `exam-${bank.toLowerCase()}.html`) a.classList.add("active");
  });

  const nav = bankData.questions.map(q => `<a href="#${q.id}" data-qnav="${q.id}">${q.number}</a>`).join("");
  const questions = bankData.questions.map(q => `
    <section class="question" id="${q.id}" data-question="${q.id}" data-correct="${q.correct ?? ""}">
      <h2>${q.number}. 문항</h2>
      <div class="prompt">${escapeHtml(q.prompt)}</div>
      ${q.images.length ? `<div class="figures">${q.images.map(src => `<img src="${src}" loading="lazy" alt="문항 ${q.number} 이미지">`).join("")}</div>` : ""}
      <div class="options">
        ${q.options.map(opt => `
          <button class="option" type="button" data-choice="${opt.label}">
            <span class="badge">${circled[opt.label - 1]}</span>
            <span>${escapeHtml(opt.text)}</span>
          </button>
        `).join("")}
      </div>
      <div class="feedback" data-feedback></div>
      <button class="button explain-toggle" type="button" data-toggle-explain="${q.id}">해설 이미지 열기</button>
      <div class="explain-panel" data-explain="${q.id}">
        ${bankData.explanations.map((src, idx) => `<img src="${src}" loading="lazy" alt="문제은행 ${bank} 해설 ${idx + 1}쪽">`).join("")}
      </div>
    </section>
  `).join("");

  mount.innerHTML = `
    <aside class="sidebar">
      <strong>문항 이동</strong>
      <div class="qnav" style="margin-top:10px">${nav}</div>
      <div class="tools">
        <button class="button" type="button" data-show-all>해설 전체 열기</button>
      </div>
    </aside>
    <main>${questions}</main>
  `;

  mount.addEventListener("click", event => {
    const option = event.target.closest(".option");
    if (option) handleChoice(option);
    const toggle = event.target.closest("[data-toggle-explain]");
    if (toggle) {
      const panel = document.querySelector(`[data-explain="${toggle.dataset.toggleExplain}"]`);
      panel.classList.toggle("show");
    }
    if (event.target.closest("[data-show-all]")) {
      document.querySelectorAll(".explain-panel").forEach(panel => panel.classList.add("show"));
    }
  });
}

function handleChoice(button) {
  const question = button.closest("[data-question]");
  const correct = Number(question.dataset.correct);
  const chosen = Number(button.dataset.choice);
  question.querySelectorAll(".option").forEach(btn => btn.classList.remove("correct", "wrong"));
  const feedback = question.querySelector("[data-feedback]");
  feedback.className = "feedback show";

  if (correct) {
    if (chosen === correct) {
      button.classList.add("correct");
      feedback.classList.add("good");
      feedback.textContent = "정답입니다. 아래 해설 이미지에서 근거를 확인하세요.";
    } else {
      button.classList.add("wrong");
      const right = question.querySelector(`[data-choice="${correct}"]`);
      if (right) right.classList.add("correct");
      feedback.classList.add("bad");
      feedback.textContent = `오답입니다. 정답은 ${circled[correct - 1]}입니다.`;
    }
  } else {
    feedback.classList.add("warn");
    feedback.textContent = "선택을 기록했습니다. 이 문항은 해설 원본 이미지의 표시를 기준으로 정답을 확인하세요.";
  }
  const panel = question.querySelector(".explain-panel");
  panel.classList.add("show");
  const nav = document.querySelector(`[data-qnav="${question.dataset.question}"]`);
  if (nav) nav.classList.add("done");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderIndex();
renderExam();
