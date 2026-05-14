# 성형외과 문제은행 정적 사이트

생성 결과물은 `site/` 폴더에 있습니다.

## GitHub Pages 배포

1. GitHub 저장소에 이 폴더를 push합니다.
2. 저장소 Settings -> Pages에서 source를 `main` branch의 `/site` 폴더로 지정합니다.
3. 배포 후 `index.html`에서 문제은행 A-D로 이동할 수 있습니다.

## 구성

- `site/index.html`: 메인 페이지
- `site/exam-a.html` - `site/exam-d.html`: 각 문제은행 시험지
- `site/style.css`: 공통 스타일
- `site/app.js`: 선택지 클릭 및 해설 표시 로직
- `site/data.js`: 파싱된 문항 데이터
- `site/assets/questions/`: 문항 도판 이미지
- `site/assets/explanations/`: 해설 PDF 렌더링 이미지

`generate_site.py`를 실행하면 원본 PDF에서 `site/`를 다시 생성합니다.
