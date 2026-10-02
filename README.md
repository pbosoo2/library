# Kagen 마법 도서관 — GitHub Pages + Notion 자동 동기화

이 저장소는 Notion의 `북로그 DB`를 **읽기 전용**으로 조회해 GitHub Pages용 JSON과 책 표지를 갱신합니다. 데이터베이스를 수정하는 API 호출은 없습니다.

## 1. Notion 연결 만들기
1. Notion에서 Internal integration(내부 연결)을 만듭니다.
2. 권한은 **Read content**만 허용합니다.
3. `My Reading Log`의 원본 `북로그 DB`와 `북 로그 리포트`가 들어 있는 페이지를 연결에 공유합니다.
4. 발급된 토큰을 복사합니다.

## 2. GitHub Secret 등록
저장소의 **Settings → Secrets and variables → Actions → New repository secret**에서 다음 값을 추가합니다.

- Name: `NOTION_TOKEN`
- Secret: Notion 내부 연결 토큰

토큰을 HTML, JSON 또는 소스 파일에 직접 넣지 마세요.

## 3. 첫 동기화
**Actions → Sync Notion Library → Run workflow**를 실행합니다. 이후 매시간 17분에 자동 동기화됩니다.

## 4. GitHub Pages 켜기
**Settings → Pages → Build and deployment**에서 `Deploy from a branch`, `main`, `/ (root)`를 선택합니다.

## 동작 방식
- 새 책 등록: 다음 동기화에서 카드가 자동 추가됩니다.
- 상태 변경: `완독` 상태만 연간 완독 목표에 집계됩니다.
- 목표 변경: `북 로그 리포트`의 `올해 목표 권수`가 반영됩니다.
- 표지: Actions가 `assets/covers`에 내려받아 만료 링크 문제를 방지합니다.
- 원본 데이터베이스: 읽기만 하며 수정하지 않습니다.
