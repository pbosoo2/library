# 읽기 전용 실시간 도서관 배포

## Vercel
1. Add New → Project에서 `pbosoo2/library` 저장소를 Import합니다. 저장소가 안 보이면 GitHub 앱의 접근 허용 저장소에 library만 추가합니다.
2. Framework Preset은 Other, Root Directory는 저장소 루트로 설정합니다. vercel.json의 설정을 사용하며 별도 빌드 명령은 없습니다.
3. Environment Variables에 NOTION_TOKEN을 추가합니다. 노션 독서/목표 데이터베이스 읽기 권한이 있는 연결의 키입니다. 키는 서버 환경변수에만 보관하며 GitHub 코드나 채팅에 넣지 않습니다. 기존 GitHub Secret은 Vercel에 자동 복사되지 않습니다.
4. Deploy합니다. 환경변수를 배포 후 추가했다면 Redeploy해야 합니다.
5. 배포 주소에서 /api/library가 성공하는지, 도서관에서 자동 갱신되는지 확인합니다.

## 기존 GitHub Pages 주소 연결
성공한 Production 배포 주소의 `/api/library` URL을 `data/live.json`의 `apiUrl`에 넣습니다. 기본값이 비어 있어 배포 전에는 기존 정적 데이터로 정상 작동합니다. Vercel 기본 도메인에서는 동일 출처 API를 자동 사용합니다. 커스텀 도메인은 apiUrl 설정이 필요합니다.

## 보안과 동작
- 서버는 지정된 두 데이터 소스만 읽으며 페이지 본문, 원본 properties, 토큰은 반환하지 않습니다. 공개 도서관용 필드만 반환합니다. 이 API의 반환 데이터는 공개입니다. CORS 제한은 인증이 아닙니다.
- GET/OPTIONS만 받습니다. 클라이언트가 데이터 소스 ID나 노션 URL을 지정할 수 없습니다.
- 토큰은 NOTION_TOKEN 서버 환경변수에만 둡니다. 가능하면 노션 연결에는 필요한 데이터베이스만 읽기 권한을 줍니다.
- GitHub Pages 출처는 https://pbosoo2.github.io입니다. 필요 시 ALLOWED_ORIGIN에 쉼표로 구분한 허용 출처를 설정합니다.
- 화면은 보이는 동안 1시간마다 조회하고 도서 데이터/목표가 변경된 경우에만 화면을 갱신합니다. 변경 확인에도 노션 조회는 필요합니다. 간격은 data/live.json의 pollIntervalMs로 설정합니다. 서버/CDN 캐시는 각각 최대 10초입니다. 즉시 반영이나 1시간 내 반영을 보장하지 않으며 캐시·API 지연만큼 늦어질 수 있습니다.
- 숨겨진 탭에서는 조회를 건너뛰고 다시 열면 조회합니다. 오류 시 기존 데이터를 유지하고 재시도합니다.
- GitHub Actions는 수동 실행으로만 정적 백업을 갱신합니다. Vercel 사용량과 노션 API 제한을 모니터링하세요.
