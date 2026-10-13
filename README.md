# Doct (DocuTrans AI) - 학술 논문 PDF 번역 서비스
> **원본 레이아웃과 서식(수식, 도표, 2단 다단)을 100% 보존하는 AI 논문 번역기**

---

## 🌟 주요 특징 및 차별점

1. **원본 레이아웃 & 2단 다단 컬럼 완벽 보존**
   - PDF.js를 활용하여 문서의 텍스트 좌표, 줄 간격, 컬럼 경계를 분석하고 의미 단위(단락)로 군집화합니다.
   - 원본 문서의 배경, 그림(Figure), 도표(Table), 플롯, 테두리를 완벽하게 보존한 상태에서 텍스트 바운딩 박스 영역만 정밀 인페인팅 후 번역문을 합성합니다.

2. **수식 및 LaTeX 수식 기호 원형 유지**
   - 논문에 포함된 수식($E=mc^2, x, W, \theta$), 수식 번호((1), (2)), 참고문헌 인용구([1], [2-4]), 그림 캡션(Fig. 1)을 파괴하지 않고 원형 그대로 보존합니다.

3. **최신 Gemini 3.5 / 3.8 Flash AI 학술 번역 엔진**
   - 구글의 최신 Gemini API를 사용하여 SCI급 학술 논문에 최적화된 고급 번역을 제공합니다.
   - 트래픽 과밀 시 자동으로 대체 모델(Fallback)로 전환되는 무중단 아키텍처가 적용되어 있습니다.

4. **실시간 인터랙티브 뷰어 (나란히 대조 & 툴팁)**
   - **단일 보기 / 나란히 비교(Dual Split) / 원본만 보기** 모드를 지원합니다.
   - 마우스를 올리면 원문(English)과 번역문(Korean)을 함께 보여주는 툴팁 기능이 제공됩니다.

5. **서식 보존 번역본 PDF 원클릭 다운로드**
   - 고해상도(High-DPI) 캔버스를 기반으로 다중 페이지 PDF를 클라이언트에서 생성하여 다운로드할 수 있습니다.

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
└── README.md                  # 사용 설명서
```

---

## 🚀 빠른 시작 (Getting Started)

### 1. 저장소 복제 (Clone)
```bash
git clone https://github.com/jusangwon/Doct.git
cd Doct
```

### 2. API Key 환경변수 설정
`.env.example`을 복사하여 `.env` 파일을 생성하고 Google AI Studio에서 발급받은 API 키를 입력합니다:
```bash
cp .env.example .env
```
`.env` 파일 내용:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. 애플리케이션 실행

#### 방법 A. Node.js 서버 실행 (추천 / Render 배포 표준)
```bash
node server.js
```
브라우저에서 `http://localhost:8080/`으로 접속합니다. (API 키는 서버에서 안전하게 프록시 처리됩니다.)

#### 방법 B. 원클릭 실행 (Windows)
- `run.bat` 파일을 더블클릭합니다.

#### 방법 C. Java 서버로 실행
```bash
javac TranslateServer.java
java TranslateServer
```

---

## 📝 업데이트 내역 (Changelog)

> 💡 이전 버전의 전체 누적 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에서 확인하실 수 있습니다.

### [Latest] v1.3.0 (2026.10) - 모바일 환경 안내 및 반응형 UI 최적화
- 📱 **모바일 접속 시 PC 대화면 권장 안내 팝업**: 스마트폰으로 접속 시 2단 컬럼 및 수식 대조에 최적화된 PC 환경 안내와 'PC 링크 복사' 기능 제공.
- 💻 **모바일 전용 상단 띠 배너**: 모바일 화면 상단에 원클릭 링크 복사 퀵 버튼이 포함된 슬림 안내 배너 상시 노출.
- 📐 **모바일 1단 반응형 레이아웃 튜닝**: 모바일 접속 시 뷰어를 '단일 보기' 모드로 자동 최적화하고, 터치 스크롤에 맞춘 컴팩트 뷰어 높이 및 컨트롤 배치 적용.
