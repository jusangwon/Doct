# Doct (DocuTrans AI) - 학술 논문 PDF 번역 서비스
> **원본 레이아웃과 서식(수식, 도표, 2단 다단)을 100% 보존하는 AI 논문 번역기**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-웹에서%20바로%20사용하기-2563eb?style=for-the-badge&logo=googlechrome&logoColor=white)](https://doct-kn62.onrender.com/)
[![Version](https://img.shields.io/badge/version-v1.3.2-emerald?style=for-the-badge)]()
[![License](https://img.shields.io/badge/license-MIT-slate?style=for-the-badge)]()

### 🌐 [온라인 웹 서비스 바로가기 (클릭)]: https://doct-kn62.onrender.com/
> 💡 **별도의 프로그램 설치나 API 키 발급 없이**, 위 링크로 접속하시면 웹 브라우저에서 즉시 학술 논문 PDF를 번역하고 실시간 2단 대조 뷰어로 열람하실 수 있습니다!

---

## 🚀 빠른 시작 (Getting Started)

사용자 환경에 맞추어 **가장 쉬운 방법부터** 선택하여 바로 이용하실 수 있습니다.

### 방법 1. 🌐 웹 브라우저에서 바로 사용 (가장 추천 / 무설치)
별도의 개발 도구(Node.js, Git 등) 설치나 복잡한 설정 없이 **링크 클릭 한 번으로 즉시 사용**할 수 있습니다.

1. 웹 브라우저에서 **[https://doct-kn62.onrender.com/](https://doct-kn62.onrender.com/)** 에 접속합니다.
2. 번역할 학술 논문 PDF 파일을 드래그하여 업로드합니다.
3. 원하는 번역 페이지 범위(예: `1-3`)를 지정하고 **[AI 논문 번역 시작]** 버튼을 클릭합니다.
4. 번역 완료 후 **나란히 대조 뷰어**로 원문과 비교하거나 **[번역된 PDF 다운로드]**를 클릭합니다.

> 💡 **Tip**: PC 웹 브라우저(Chrome, Edge 등)로 접속하시면 2단 양면 대조 및 전체화면 모드를 가장 쾌적하게 사용하실 수 있습니다.

---

### 방법 2. ⚡ 윈도우 원클릭 로컬 실행 (Windows 사용자 추천)
내 컴퓨터(PC)에서 로컬로 간편하게 실행하고 싶을 때 사용합니다.

1. 깃허브 상단의 **`Code` > `Download ZIP`**을 클릭하여 프로젝트 압축파일을 다운로드하고 압축을 풉니다.
2. 폴더 내 **`run.bat`** 파일을 더블클릭합니다.
3. 웹 브라우저가 자동으로 실행되며 `http://localhost:8080/`으로 열립니다.

---

### 방법 3. 💻 로컬 개발 환경 실행 (Node.js & Git)
로컬에서 직접 개발하거나 본인 소유의 개인 Gemini API 키를 직접 연동하여 실행하고 싶은 경우 사용합니다.

#### 1) 저장소 복제 (Clone)
```bash
git clone https://github.com/jusangwon/Doct.git
cd Doct
```

#### 2) API 키 환경변수 설정 (선택 사항)
`.env.example`을 복사하여 `.env` 파일을 생성하고 본인의 Google Gemini API 키를 입력합니다.
```bash
cp .env.example .env
```
`.env` 파일 내용:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
*(개인 키를 입력하지 않아도 웹 애플리케이션 화면에서 직접 입력하거나 기본 프록시를 이용할 수 있습니다.)*

#### 3) Node.js 서버 실행
```bash
node server.js
```
브라우저에서 `http://localhost:8080/`으로 접속합니다.

---

### 방법 4. ☕ Java 서버로 실행 (Java 환경)
Node.js 없이 JDK(Java) 환경만 설치되어 있는 경우 순수 Java 표준 서버로 구동할 수 있습니다.
```bash
javac TranslateServer.java
java TranslateServer
```
브라우저에서 `http://localhost:8080/`으로 접속합니다.

---

## 🌟 주요 특징 및 차별점

1. **원본 레이아웃 & 2단 다단 컬럼 완벽 보존**
   - PDF.js를 활용하여 문서의 텍스트 좌표, 줄 간격, 컬럼 경계를 분석하고 의미 단위(단락)로 군집화합니다.
   - 원본 문서의 배경, 그림(Figure), 도표(Table), 플롯, 테두리를 완벽하게 보존한 상태에서 텍스트 바운딩 박스 영역만 정밀 인페인팅 후 번역문을 합성합니다.

2. **수식 및 LaTeX 수식 기호 원형 유지**
   - 논문에 포함된 수식($E=mc^2, x, W, \theta$), 수식 번호((1), (2)), 참고문헌 인용구([1], [2-4]), 그림 캡션(Fig. 1)을 파괴하지 않고 원형 그대로 보존합니다.

3. **최신 Gemini Flash & Pro AI 학술 번역 & 과부하 자동 복구(Resilience)**
   - **Flash (초고속 추천)** 및 **Pro (심층 정밀 학술 번역)** 모드를 자유롭게 선택할 수 있습니다.
   - Pro 선택 시 최신 플래그십 모델(`gemini-pro-latest`, `gemini-3.1-pro-preview`)을 우선 활용하여 높은 번역 퀄리티를 보장합니다.
   - 트래픽 과밀(429/503) 또는 일일 쿼터 초과 시 **지수 백오프(Exponential Backoff)** 및 고가용성 Flash 9종 풀 자동 순환 폴백으로 중단 없는 번역을 지원합니다.

4. **연속 스크롤(Continuous Multi-Page Scroll) & 나란히 비교 동기화**
   - 페이지 넘김 버튼을 누르지 않아도 **마우스 휠이나 터치 스크롤로 모든 페이지를 연속으로 쭉 이어서 열람**할 수 있습니다.
   - **나란히 비교(Dual Split)** 모드에서는 원본과 번역본 양면 컬럼이 1:1로 함께 스크롤되어 대조 읽기가 매우 편리합니다.
   - 단일 보기 / 나란히 비교 / 원본만 보기 및 브라우저 화면에 꽉 차는 **전체화면 크게보기**를 지원합니다.
   - 마우스를 올리면 원문(English)과 번역문(Korean)을 함께 보여주는 영한 대조 툴팁이 제공됩니다.

5. **서식 보존 번역본 PDF 원클릭 다운로드**
   - 고해상도(High-DPI) 캔버스를 기반으로 다중 페이지 PDF를 클라이언트에서 생성하여 다운로드할 수 있습니다.
   - 번역 요청한 페이지만 다운로드하거나 전체 페이지를 다운로드하는 옵션을 기본값으로 자유롭게 선택할 수 있습니다.

---

## 📁 프로젝트 폴더 구성

```
Doct/
│
├── .env                       # Gemini API 키 환경변수 파일 (보안 제외)
├── .env.example               # 환경변수 예시 템플릿
├── .gitignore                 # 보안 및 환경 파일 제외 설정
│
├── css/
│   └── style.css              # 현대적이고 직관적인 논문 뷰어 UI 스타일
│
├── js/
│   ├── pdf-translator.js      # 레이아웃 보존, 단락 군집화, 캔버스 합성, jsPDF 엔진
│   └── app.js                 # UI 컨트롤러, 파일 업로드, 실시간 뷰어, 진행률 제어
│
├── index.html                 # 메인 웹 애플리케이션
├── server.js                  # 무의존성 경량 Node.js 프록시 서버 (Render 배포 및 로컬 실행)
├── TranslateServer.java       # 순수 표준 Java SE 기반 HTTP 웹 서버
├── package.json               # 프로젝트 설정
├── run.bat                    # 윈도우 원클릭 자동 실행 스크립트
├── CHANGELOG.md               # 버전별 누적 변경 이력
└── README.md                  # 사용 설명서
```

---

## 📝 업데이트 내역 (Changelog)

> 💡 이전 버전의 전체 누적 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에서 확인하실 수 있습니다.

### [Latest] v1.4.1 (2026.10) - Gemini Pro 정밀 번역 엔진 연동 및 Flash 하이브리드 폴백
- 💎 **Gemini Pro 모델 엔진 연동**: '프로' 선택 시 최신 플래그십 Pro 모델(`gemini-pro-latest`, `gemini-3.1-pro-preview`)을 1순위로 우선 호출하여 심층 학술 번역 지원.
- 🛡️ **하이브리드 자동 순환 폴백 (Hybrid Resilience)**: Pro 모델 쿼터 소진 시 대기 없이 즉시 Flash 9종 풀로 자동 순환 폴백되어 끊김 없는 번역 완료 보장.

---

### v1.4.0 (2026.10) - 연속 스크롤 뷰어 및 나란히 비교 양방향 동기화 스크롤
- 📜 **연속 스크롤(Continuous Multi-Page Scroll) 도입**: 페이지 넘김 버튼(`nextPageBtn`)을 누르지 않고도 마우스 휠 및 터치 스크롤로 모든 페이지를 연속으로 쭉 이어서 열람 가능.
- 🔄 **나란히 비교(Dual View) 양방향 동기화 스크롤**: 원본(Original)과 번역본(Translated) 양면 컬럼이 1:1로 함께 스크롤되어 문단 위치가 항상 일치.
- ⚡ **스마트 지연 렌더링 & 실시간 페이지 툴바 연동**: IntersectionObserver 기반으로 화면 근처 페이지만 지연 렌더링하여 빠른 속도를 유지하고, 스크롤 위치에 맞춰 툴바 페이지 표시기(`2 / 5`) 자동 갱신.

---

### v1.3.2 (2026.10) - Gemini Flash 9종 풀 확장 및 즉시 전환 최적화
- 🔄 **가용 Gemini Flash 9종 풀(Pool) 전면 개편**: 최신 검증 모델군(`gemini-flash-lite-latest`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-flash-latest`) 총 9개로 모델 풀 대폭 확대.
- ⚡ **일일 쿼터 초과 시 즉시 전환 (Fast-Failover)**: 무료 한도 소진(`Quota exceeded`) 감지 시 대기 지연 없이 즉시 다음 정상 Flash 모델로 패스하여 불필요한 대기 시간 제거.
- 🚀 **서버 기본 모델 최신화**: `server.js` 기본 폴백 모델을 고가용성의 `gemini-flash-lite-latest`로 교체.

