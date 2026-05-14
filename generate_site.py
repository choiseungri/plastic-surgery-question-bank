from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
CIRCLED = {chr(9312 + i): i + 1 for i in range(5)}


def clean_site() -> None:
    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "assets" / "questions").mkdir(parents=True)
    (SITE / "assets" / "explanations").mkdir(parents=True)


def find_pdfs() -> tuple[dict[str, Path], dict[str, Path]]:
    students: dict[str, Path] = {}
    solutions: dict[str, Path] = {}
    solution_prefix = {"1": "A", "2": "B", "3": "C", "4": "D"}
    for pdf in ROOT.glob("*.pdf"):
        size = pdf.stat().st_size
        if size < 1_000_000:
            for bank in "ABCD":
                if f"{bank}_" in pdf.name:
                    students[bank] = pdf
        elif pdf.name[:1] in solution_prefix:
            solutions[solution_prefix[pdf.name[0]]] = pdf
    missing = [b for b in "ABCD" if b not in students or b not in solutions]
    if missing:
        raise RuntimeError(f"Missing PDFs for banks: {missing}")
    return students, solutions


def line_text(line: dict) -> str:
    return "".join(span["text"] for span in line["spans"]).strip()


def parse_student_pdf(bank: str, pdf: Path) -> list[dict]:
    doc = fitz.open(pdf)
    question_dir = SITE / "assets" / "questions" / bank.lower()
    question_dir.mkdir(parents=True, exist_ok=True)
    questions: list[dict] = []
    image_counter = 1

    for page_index, page in enumerate(doc):
        mid_x = page.rect.width / 2
        lines: list[dict] = []
        image_blocks: list[dict] = []

        for block in page.get_text("dict")["blocks"]:
            if block["type"] == 0:
                for line in block["lines"]:
                    text = line_text(line)
                    if not text:
                        continue
                    x0, y0, x1, y1 = line["bbox"]
                    col = 0 if (x0 + x1) / 2 < mid_x else 1
                    lines.append({"text": text, "bbox": (x0, y0, x1, y1), "col": col})
            elif block["type"] == 1:
                x0, y0, x1, y1 = block["bbox"]
                col = 0 if (x0 + x1) / 2 < mid_x else 1
                image_blocks.append({"bbox": (x0, y0, x1, y1), "col": col})

        starts: list[tuple[int, dict]] = []
        for line in lines:
            match = re.match(r"^(\d{1,2})\.\s*", line["text"])
            if match:
                number = int(match.group(1))
                if 1 <= number <= 50:
                    starts.append((number, line))

        for col in (0, 1):
            col_starts = sorted(
                [(number, line) for number, line in starts if line["col"] == col],
                key=lambda item: item[1]["bbox"][1],
            )
            for idx, (number, start_line) in enumerate(col_starts):
                y0 = start_line["bbox"][1] - 0.5
                y1 = (
                    col_starts[idx + 1][1]["bbox"][1] - 0.5
                    if idx + 1 < len(col_starts)
                    else page.rect.height - 25
                )
                region_lines = sorted(
                    [
                        line
                        for line in lines
                        if line["col"] == col
                        and y0 <= (line["bbox"][1] + line["bbox"][3]) / 2 < y1
                    ],
                    key=lambda line: (line["bbox"][1], line["bbox"][0]),
                )
                region_images = [
                    image
                    for image in image_blocks
                    if image["col"] == col
                    and y0 <= (image["bbox"][1] + image["bbox"][3]) / 2 < y1
                ]

                prompt_parts: list[str] = []
                options: list[dict] = []
                current_option: dict | None = None
                for line in region_lines:
                    text = line["text"]
                    q_match = re.match(r"^(\d{1,2})\.\s*(.*)", text)
                    if q_match:
                        text = q_match.group(2).strip()
                    if text and text[0] in CIRCLED:
                        if current_option:
                            options.append(current_option)
                        current_option = {
                            "label": CIRCLED[text[0]],
                            "text": text[1:].strip(),
                        }
                    elif current_option:
                        current_option["text"] = f"{current_option['text']} {text}".strip()
                    else:
                        prompt_parts.append(text)
                if current_option:
                    options.append(current_option)

                assets: list[str] = []
                for image in region_images:
                    clip = fitz.Rect(image["bbox"])
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
                    rel_path = Path("assets") / "questions" / bank.lower() / f"q{number:02d}_{image_counter:02d}.png"
                    pix.save(SITE / rel_path)
                    assets.append(rel_path.as_posix())
                    image_counter += 1

                questions.append(
                    {
                        "id": f"{bank}{number}",
                        "bank": bank,
                        "number": number,
                        "prompt": " ".join(prompt_parts).strip(),
                        "options": options,
                        "images": assets,
                        "correct": None,
                    }
                )

    fallback = parse_plain_questions(doc)
    for question in questions:
        plain = fallback.get(question["number"])
        if plain and len(question["options"]) != 5:
            question["prompt"] = plain["prompt"]
            question["options"] = plain["options"]

    return sorted(questions, key=lambda item: item["number"])


def parse_plain_questions(doc: fitz.Document) -> dict[int, dict]:
    text = "\n".join(page.get_text("text") for page in doc)
    parsed: dict[int, dict] = {}
    for number in range(1, 51):
        pattern = rf"(?ms)^\s*{number}\.\s*(.*?)(?=^\s*{number + 1}\.\s|\Z)"
        match = re.search(pattern, text)
        if not match:
            continue
        lines = [line.strip() for line in match.group(1).splitlines() if line.strip()]
        prompt_parts: list[str] = []
        options: list[dict] = []
        current: dict | None = None
        for line in lines:
            if line and line[0] in CIRCLED:
                if current:
                    options.append(current)
                current = {"label": CIRCLED[line[0]], "text": line[1:].strip()}
            elif current:
                current["text"] = f"{current['text']} {line}".strip()
            else:
                prompt_parts.append(line)
        if current:
            options.append(current)
        parsed[number] = {"prompt": " ".join(prompt_parts).strip(), "options": options}
    return parsed


def render_explanations(bank: str, pdf: Path) -> list[str]:
    doc = fitz.open(pdf)
    out_dir = SITE / "assets" / "explanations" / bank.lower()
    out_dir.mkdir(parents=True, exist_ok=True)
    pages: list[str] = []
    for index, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=fitz.Matrix(1.65, 1.65), alpha=False)
        rel_path = Path("assets") / "explanations" / bank.lower() / f"page-{index:02d}.png"
        pix.save(SITE / rel_path)
        pages.append(rel_path.as_posix())
    return pages


def write_static_files(data: dict) -> None:
    (SITE / "data.js").write_text(
        "window.QUESTION_BANK_DATA = "
        + json.dumps(data, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )

    css = r"""
:root {
  color-scheme: light;
  --ink: #1f2933;
  --muted: #607083;
  --line: #d9e0e8;
  --soft: #f5f7fa;
  --accent: #146c94;
  --good: #177245;
  --bad: #b42318;
  --warn: #8a5a00;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--ink);
  background: #ffffff;
}
a { color: inherit; }
.shell { max-width: 1180px; margin: 0 auto; padding: 28px 20px 48px; }
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.brand { font-size: 22px; font-weight: 750; letter-spacing: 0; }
.nav { display: flex; flex-wrap: wrap; gap: 8px; }
.nav a, .button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  text-decoration: none;
  font-weight: 650;
}
.nav a.active, .button.primary { background: var(--accent); color: white; border-color: var(--accent); }
.intro { padding: 28px 0 18px; color: var(--muted); line-height: 1.65; }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.bank-card {
  display: block;
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 18px;
  background: var(--soft);
}
.bank-card strong { display: block; font-size: 24px; margin-bottom: 8px; }
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 22px; margin-top: 22px; }
.sidebar {
  position: sticky;
  top: 12px;
  align-self: start;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}
.qnav { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.qnav a {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border-radius: 6px;
  border: 1px solid var(--line);
  text-decoration: none;
  font-size: 13px;
}
.qnav a.done { background: #e8f5ef; border-color: #a7d9bf; }
.question {
  border-bottom: 1px solid var(--line);
  padding: 24px 0;
  scroll-margin-top: 12px;
}
.question h2 { margin: 0 0 12px; font-size: 18px; }
.prompt { white-space: pre-wrap; line-height: 1.65; font-size: 17px; }
.figures { display: grid; gap: 10px; margin: 14px 0; }
.figures img {
  max-width: min(100%, 520px);
  border: 1px solid var(--line);
  border-radius: 6px;
  background: white;
}
.options { display: grid; gap: 8px; margin-top: 16px; }
.option {
  width: 100%;
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 8px;
  text-align: left;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.option:hover { border-color: #8ab7ca; }
.option.correct { border-color: #55b17d; background: #eef9f3; }
.option.wrong { border-color: #e29a92; background: #fff3f1; }
.badge { font-weight: 800; color: var(--accent); }
.feedback {
  display: none;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--soft);
}
.feedback.show { display: block; }
.feedback.good { color: var(--good); border-color: #a7d9bf; background: #f0faf4; }
.feedback.bad { color: var(--bad); border-color: #efb3ac; background: #fff6f4; }
.feedback.warn { color: var(--warn); border-color: #e5c06a; background: #fff9e8; }
.explain-toggle { margin-top: 10px; }
.explain-panel { display: none; margin-top: 14px; }
.explain-panel.show { display: block; }
.explain-panel img {
  width: min(100%, 900px);
  display: block;
  margin: 0 0 16px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.tools { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
@media (max-width: 860px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; }
}
@media (max-width: 520px) {
  .shell { padding: 20px 14px 36px; }
  .topbar { align-items: flex-start; flex-direction: column; }
  .grid { grid-template-columns: 1fr; }
  .qnav { grid-template-columns: repeat(10, 1fr); }
}
"""
    (SITE / "style.css").write_text(css.lstrip(), encoding="utf-8")

    js = r"""
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
"""
    (SITE / "app.js").write_text(js.lstrip(), encoding="utf-8")

    nav = "".join([f'<a href="exam-{b.lower()}.html">문제은행 {b}</a>' for b in "ABCD"])
    index_html = f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>성형외과 문제은행</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">성형외과 문제은행</div>
      <nav class="nav">{nav}</nav>
    </header>
    <p class="intro">문제은행 A-D를 HTML로 재구성했습니다. 각 시험지에는 문항 텍스트, 원본 도판 이미지, 선택지, 해설 PDF 렌더링 이미지가 포함됩니다.</p>
    <section class="grid" data-index></section>
  </div>
  <script src="data.js"></script>
  <script src="app.js"></script>
</body>
</html>
"""
    (SITE / "index.html").write_text(index_html, encoding="utf-8")

    for bank in "ABCD":
        exam_html = f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>문제은행 {bank}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="index.html" data-bank-title>문제은행 {bank}</a>
      <nav class="nav">{nav}</nav>
    </header>
    <div class="layout" data-exam></div>
  </div>
  <script src="data.js"></script>
  <script src="app.js"></script>
</body>
</html>
"""
        (SITE / f"exam-{bank.lower()}.html").write_text(exam_html, encoding="utf-8")


def main() -> None:
    clean_site()
    students, solutions = find_pdfs()
    data = {"banks": {}}
    for bank in "ABCD":
        questions = parse_student_pdf(bank, students[bank])
        explanations = render_explanations(bank, solutions[bank])
        data["banks"][bank] = {
            "sourcePdf": students[bank].name,
            "solutionPdf": solutions[bank].name,
            "questions": questions,
            "explanations": explanations,
        }
    write_static_files(data)
    print(f"Wrote {SITE}")


if __name__ == "__main__":
    main()
