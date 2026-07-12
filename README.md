# 기억의 바다, 우리들의 여정
## 계기교육 OX 퀴즈 공개 웹앱

Google Apps Script를 웹 서버로, Google Sheets를 무료 응답 저장소로 사용하는 계기교육 OX 퀴즈입니다.

## 주요 기능

- 별명 입력 후 30문항 OX 퀴즈
- 10개 항해 구간을 순서대로 진행
- 각 문항을 선택하면 정답·해설·공식 출처를 즉시 표시
- 각 문항의 **최초 선택**을 서버에 저장하여 최종 점수에 반영
- 점수·소요시간·제출시각을 Google Sheets에 저장
- 점수 → 소요시간 → 제출시각 순으로 순위 산정
- 같은 별명은 최고 기록만 순위표에 표시
- 제출 후 전체 정답과 출처 다시 보기
- Google Sites 삽입 지원
- 휴대전화·태블릿·PC 반응형 디자인
- 실명·이메일·학번·IP를 저장하지 않고 별명만 수집

---

## 1. Apps Script에 등록할 파일

### 스크립트 파일

왼쪽 `파일` 옆 `+` → `스크립트`로 생성합니다.

- `Code.gs`
- `Questions.gs`
- `Questions_01_05.gs`
- `Questions_06_10.gs`
- `Feedback.gs`

### HTML 파일

왼쪽 `파일` 옆 `+` → `HTML`로 생성합니다.

- `Index.html`
- `Styles01.html`
- `Styles02.html`
- `Styles03.html`
- `FeedbackStyles.html`
- `Scripts01.html`
- `Scripts02.html`
- `FeedbackScripts.html`

파일 이름은 정확히 같아야 합니다. Apps Script에서 파일을 만들 때는 `.gs`, `.html` 확장자를 직접 입력하지 않아도 됩니다.

### Apps Script에 등록하지 않는 파일

다음 파일은 교사용 문서 또는 GitHub 관리 파일입니다.

- `README.md`
- `SOURCES.md`
- `quiz_questions_audit.csv`
- `.gitignore`

`appsscript.json`은 Apps Script가 자동으로 관리하므로 기본 설정 그대로 사용해도 됩니다.

---

## 2. 최초 설정

1. 브라우저에서 `script.new`를 엽니다.
2. 위 스크립트 파일과 HTML 파일을 같은 이름으로 추가합니다.
3. GitHub의 각 파일 내용을 해당 Apps Script 파일에 붙여넣습니다.
4. 전체 저장합니다.
5. 함수 선택 메뉴에서 `setupQuizProject`를 선택합니다.
6. `실행`을 누르고 Google 권한을 승인합니다.
7. 실행 로그에 표시되는 Google Sheets 주소를 확인합니다.

`setupQuizProject()`를 다시 실행해도 기존 응답은 삭제되지 않습니다.

---

## 3. 공개 배포

1. Apps Script 오른쪽 위 `배포` → `새 배포`
2. 유형: `웹 앱`
3. 실행 사용자: `나`
4. 액세스 권한: `모든 사용자`
5. 배포 후 생성된 `/exec` 주소를 복사
6. 시크릿 창에서 별명 입력, 즉시 피드백, 최종 저장, 순위를 확인

코드를 수정한 경우에는 다음 순서로 기존 공개 주소를 갱신합니다.

1. `배포` → `배포 관리`
2. 기존 웹 앱 오른쪽의 연필 아이콘
3. 버전을 `새 버전`으로 선택
4. `배포`

기존 `/exec` 주소는 그대로 유지됩니다.

---

## 4. Google Sites에 넣기

1. Google Sites 편집 화면에서 `삽입` → `삽입`
2. URL 탭에 Apps Script 웹 앱의 `/exec` 주소 입력
3. 페이지 폭에 맞게 늘리고 높이는 약 900~1100px로 설정
4. 독립 페이지처럼 보이게 하려면 전체 페이지 삽입 사용

`Code.gs`의 `ALLOWALL` 설정으로 iframe 삽입을 허용합니다.

---

## 5. 순위 및 채점 규칙

1. 문항별로 처음 고른 O 또는 X가 서버에 저장됩니다.
2. 피드백을 확인한 뒤 답을 바꿀 수 없습니다.
3. 최종 점수는 서버에 저장된 최초 선택으로 계산됩니다.
4. 점수가 높을수록 앞섭니다.
5. 점수가 같으면 소요시간이 짧은 기록이 앞섭니다.
6. 점수와 시간이 같으면 먼저 제출한 기록이 앞섭니다.
7. 동일 별명은 현재 퀴즈 버전의 최고 기록 1개만 표시됩니다.

---

## 6. 새 라운드 시작

`Code.gs` 위쪽의 값을 변경합니다.

```javascript
QUIZ_VERSION: '2026-계기교육-02'
```

새 버전으로 다시 배포하면 기존 응답은 보존되고, 순위표에는 새 버전 기록만 표시됩니다.

---

## 7. 문항 수정

문항은 다음 두 파일에 나누어 들어 있습니다.

- `Questions_01_05.gs`
- `Questions_06_10.gs`

문항 수정 시 다음 필드를 함께 검토하세요.

- `statement`: OX 진술
- `answer`: `true` 또는 `false`
- `explanation`: 정답 해설
- `sourceName`: 출처 기관과 자료명
- `sourceUrl`: 공식 원문 주소

학생에게 공개하기 전 `quiz_questions_audit.csv`를 활용해 최종 검수하는 것을 권장합니다.

---

## 8. 개인정보 및 운영 유의사항

- 학생에게 실명·학번·전화번호를 별명에 넣지 않도록 안내하세요.
- 응답 Google Sheets는 교사만 볼 수 있도록 유지하세요.
- 공개 사이트이므로 부적절한 별명이나 반복 응시를 관리해야 합니다.
- 현재 소스는 별명별 최대 20회로 제한합니다.
- Google Apps Script에는 실행시간과 일일 할당량이 있으므로 학교 단위 운영에 적합합니다.

## 저장소

- https://github.com/sh85952223/occasion-education-ox-quiz
