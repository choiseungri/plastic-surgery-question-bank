성형외과학 문제은행 HTML 개정본

수정 내용
- index.html의 정답표 요약 섹션을 제거했습니다.
- 기존 assets/questions의 전체 문항 crop 이미지를 삭제했습니다.
- 새 assets/question_figures 폴더에는 각 문항에 실제로 포함된 사진/도식 이미지 블록만 추출해 넣었습니다.
- 각 문제 페이지에서는 발문 아래에 문항 figure/photo가 표시되고, 보기 선택 후 정답/오답이 표시됩니다. 해설 이미지는 해설 열기 버튼으로 확인합니다.
- 검색, 셔플, 오답만 보기, 정답만 표시, 전체 해설 열기, 초기화, 이미지 확대 모달을 추가했습니다.
- A-D 문제은행을 발문/정답 기준으로 중복 제거한 고유문항 91문항 페이지를 추가했습니다. 같은 발문에 보기 구성이 다른 버전이 있으면 해설 노트에 표시합니다.

주요 파일
- index.html
- bank_A.html, bank_B.html, bank_C.html, bank_D.html, bank_unique.html
- css/style.css
- js/app.js
- js/data.js
- assets/question_figures: 문항에 포함된 이미지 asset
- assets/explanations: 해설 PDF 렌더링 이미지

문항 figure 추출 개수
A: 16개
B: 19개
C: 14개
D: 12개
