# Changelog

All notable changes to this project will be documented in this file.  
이 프로젝트의 모든 버전별 변경 내역은 이 문서에 체계적으로 누적 기록됩니다.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.3.2] - 2026-10-13

### ⚡ Improved & Resilient (Gemini Flash 9종 풀 확장 및 즉시 전환 최적화)
- **가용 Gemini Flash 9종 풀(Pool) 전면 개편**: 서비스 종료된 구버전(404)을 완전 제거하고, 실제 응답이 검증된 최신 모델군(`gemini-flash-lite-latest`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-flash-latest`) 총 9개로 모델 풀 대폭 확대.
- **일일 쿼터 초과 시 초고속 즉시 전환 (Fast-Failover)**: 무료 티어 일일 20회 한도 소진(`Quota exceeded`) 감지 시 대기 지연 없이 즉시 다음 정상 Flash 모델로 패스하여 불필요한 대기 시간 제거.
- **서버 기본 모델 최신화**: `server.js` 기본 폴백 모델을 고가용성의 `gemini-flash-lite-latest`로 교체.

---

## [v1.3.1] - 2026-10-13

### ⚡ Improved & Resilient (Gemini 모델 과부하 자동 복구 및 온라인 서비스 배포)
- **공식 온라인 웹 서비스 오픈**: 별도 프로그램 설치나 복잡한 설정 없이 브라우저에서 바로 사용 가능한 클라우드 서비스([https://doct-kn62.onrender.com/](https://doct-kn62.onrender.com/)) 배포 및 연동.
- **지수 백오프(Exponential Backoff) 자동 재시도**: Gemini API 429(Rate Limit) 또는 503(Overloaded) 발생 시 즉시 실패하지 않고 1.0~1.5초 지수 백오프 대기 후 1회 자동 재시도.
- **6단계 다중 모델 연속 폴백(Fallback) 체계**: 특정 모델 과부하 지속 시 차세대 고성능 모델군으로 자동 전환하여 중단 없는 번역 보장.
- **실시간 과부하 복구 상태 안내 UI**: 과부하 감지 및 재시도 대기 상태를 번역 진행창에 실시간 텍스트(`모델 일시적 과부하 감지 - N초 후 자동 재시도...`)로 투명하게 표시.

---

## [v1.3.0] - 2026-10-13

### 📱 Added (모바일 최적화 및 안내)
- **모바일 접속 시 PC 대화면 권장 안내 팝업**: 스마트폰 등 모바일 기기 접속 시 2단 서식 대조를 위한 PC 환경 안내 및 원클릭 '링크 복사' 기능 제공.
- **모바일 상단 슬림 안내 배너**: 모바일 뷰 상단에 PC 링크 복사 퀵 버튼이 포함된 슬림 띠 배너 상시 제공.
- **모바일 전용 반응형 레이아웃 튜닝**: 모바일 접속 시 '단일 보기' 자동 최적화, 1열 스택 정렬 및 터치 조작 친화적 뷰어 높이/패딩 적용.

---

## [v1.2.0] - 2026-10-13

### 🌟 Added (새로운 기능)
- **전체화면 크게보기 모드**: 문서 뷰어를 웹 브라우저 전체(100vw × 100vh)로 확장하는 기능 추가 (ESC 키 및 툴바 토글 지원).
- **스마트 가로 맞춤 (Auto-Fit)**: 전체화면 및 일반 모드에서 창 너비에 맞춰 최적 줌 배율을 자동 계산하는 기능 적용.
- **선택적 PDF 다운로드 범위**: 일부 페이지만 번역 요청 시(예: 1-2p) 해당 페이지만 묶어 다운로드하는 옵션을 기본값으로 제공하며, 미번역 원본 포함 전체 다운로드도 선택 가능.
- **설정 옵션 세분화**: '그림 속 글자 원문 유지', '참고문헌 원문 유지' 토글 추가.
- **Node.js 경량 프록시 서버 (`server.js`)**: Render 클라우드 배포 및 로컬 실행을 위한 무의존성 프록시 서버 탑재.

### ⚡ Changed & Improved (개선 및 변경)
- **학술 레이아웃 보존 엔진 고도화**:
  - PDF operatorList(이미지 및 벡터 패스) 기반 그림/도표 영역 자동 감지.
  - 2단 다단 컬럼 경계를 넘지 않는 안전한 단락 군집화 알고리즘 개선.
  - 텍스트 박스 인페인팅 시 주변 배경색 자동 샘플링 적용.
- **국내 학술 표준(KCI 등재지 표기 관례) 반영**:
  - 캡션("그림 1. 설명", "표 2. 설명"), 본문 참조("그림", "표", "식"), 주요 섹션("초록", "서론", "결론") 표준 양식 자동 변환.
- **글자 수 예산 기반 단문 재번역 (Shorten Retry)**: 번역문이 바운딩 박스를 초과할 위험이 있을 때 AI가 학술적 사실을 유지한 채 15%씩 압축 재번역(최대 2회).

---

## [v1.1.0] - 2026-10-13

### 🛡️ Security & Deployment (보안 및 배포)
- **클라우드 배포 환경 구축**: Render 웹 서비스 배포 설정 완료.
- **API Key 보안 강화**: `.env` 환경변수 관리 및 `.gitignore` 설정으로 깃헙 키 노출 방지.
- **키 입력 없는 사용자 경험**: 서버 프록시(`/api/translate`)를 통해 방문자가 API 키를 입력하지 않아도 바로 이용 가능하도록 개선.

---

## [v1.0.0] - 2026-10-13

### 🚀 Initial Release (초기 출시)
- **Doct (DocuTrans AI) 서비스 런칭**
- PDF.js 기반 텍스트 추출 및 Gemini AI 학술 번역 연동
- 수식($E=mc^2$) 및 LaTeX 기호 원형 보존 기능
- 실시간 인터랙티브 뷰어 (단일 보기 / 나란히 비교 / 원본만 보기)
- 마우스 호버 영한 대조 툴팁
- jsPDF 기반 번역본 PDF 생성 및 원클릭 다운로드
