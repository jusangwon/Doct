/**
 * Application Main Controller
 * - PDF Load & Preview Management
 * - Key Auto-loading from .env (GEMINI_API_KEY)
 * - Translation Lifecycle & Progress
 * - Dual/Single View Synchronization & PDF Download
 */

document.addEventListener('DOMContentLoaded', () => {
    // State
    const state = {
        apiKey: '',
        pdfDoc: null,
        pdfFileName: '',
        pdfFileBytes: null,
        totalPages: 0,
        currentPage: 1,
        zoom: 1.0,
        viewMode: 'single', // 'single' | 'dual' | 'original'
        isTranslating: false,
        shouldCancel: false,
        timerInterval: null,
        startTime: null,
        // Cached canvases and translation data by page (1-based)
        pagesData: {}, // { [pageNum]: { originalCanvas, transCanvas, blocks, translationsMap } }
        translatedPdfBlob: null,
        lastTargetPages: [],
        downloadBlobCache: { translated: null, all: null }
    };

    const engine = new PdfTranslatorEngine();

    // DOM Elements
    const apiBadge = document.getElementById('apiBadge');
    const apiStatusText = document.getElementById('apiStatusText');
    const apiPulseDot = document.getElementById('apiPulseDot');
    const openKeyModalBtn = document.getElementById('openKeyModalBtn');
    const closeKeyModalBtn = document.getElementById('closeKeyModalBtn');
    const keyModalOverlay = document.getElementById('keyModalOverlay');
    const manualKeyInput = document.getElementById('manualKeyInput');
    const saveKeyBtn = document.getElementById('saveKeyBtn');
    const reloadKeyFileBtn = document.getElementById('reloadKeyFileBtn');
    const keyValidationResult = document.getElementById('keyValidationResult');

    const dropzone = document.getElementById('dropzone');
    const pdfFileInput = document.getElementById('pdfFileInput');
    const fileCard = document.getElementById('fileCard');
    const fileNameText = document.getElementById('fileNameText');
    const fileMetaText = document.getElementById('fileMetaText');
    const removeFileBtn = document.getElementById('removeFileBtn');

    const previewEmpty = document.getElementById('previewEmpty');
    const singleCanvasContainer = document.getElementById('singleCanvasContainer');
    const mainCanvas = document.getElementById('mainCanvas');
    const textOverlayLayer = document.getElementById('textOverlayLayer');
    const dualViewContainer = document.getElementById('dualViewContainer');
    const dualOrigCanvas = document.getElementById('dualOrigCanvas');
    const dualTransCanvas = document.getElementById('dualTransCanvas');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageIndicator = document.getElementById('pageIndicator');
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const fitWidthBtn = document.getElementById('fitWidthBtn');
    const zoomLevelText = document.getElementById('zoomLevelText');
    const viewModeTabs = document.getElementById('viewModeTabs');

    const sourceLangSelect = document.getElementById('sourceLangSelect');
    const targetLangSelect = document.getElementById('targetLangSelect');
    const modelTierSelect = document.getElementById('modelTierSelect');
    const customRangeInput = document.getElementById('customRangeInput');
    const startTranslateBtn = document.getElementById('startTranslateBtn');
    const progressCard = document.getElementById('progressCard');
    const progressStepTitle = document.getElementById('progressStepTitle');
    const progressStatusText = document.getElementById('progressStatusText');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressPageCountText = document.getElementById('progressPageCountText');
    const progressPercentText = document.getElementById('progressPercentText');
    const progressTimer = document.getElementById('progressTimer');
    const cancelTranslateBtn = document.getElementById('cancelTranslateBtn');

    const downloadBanner = document.getElementById('downloadBanner');
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    const downloadBtnText = document.getElementById('downloadBtnText');
    const downloadBannerDesc = document.getElementById('downloadBannerDesc');
    const bannerScopeTranslatedLabel = document.getElementById('bannerScopeTranslatedLabel');
    const bannerScopeAllLabel = document.getElementById('bannerScopeAllLabel');
    const compareViewBtn = document.getElementById('compareViewBtn');
    const bilingualTooltip = document.getElementById('bilingualTooltip');
    const tooltipOrig = document.getElementById('tooltipOrig');
    const tooltipTrans = document.getElementById('tooltipTrans');

    // =========================================================================
    // 1. API Key Loading (.env support)
    // =========================================================================
    function parseEnvFile(text) {
        if (!text) return '';
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
                const varName = trimmed.substring(0, eqIdx).trim();
                let varVal = trimmed.substring(eqIdx + 1).trim();
                // 따옴표 제거 ("..." or '...')
                if ((varVal.startsWith('"') && varVal.endsWith('"')) ||
                    (varVal.startsWith("'") && varVal.endsWith("'"))) {
                    varVal = varVal.substring(1, varVal.length - 1).trim();
                }
                if (varName === 'GEMINI_API_KEY' || varName === 'API_KEY') {
                    if (varVal.length > 5) return varVal;
                }
            }
        }
        // =이 없고 키만 적혀 있는 경우 대비
        if (text.trim().length > 10 && !text.includes('=')) {
            return text.trim();
        }
        return '';
    }

    async function loadApiKey() {
        try {
            apiStatusText.textContent = 'AI 엔진 연결 확인 중...';
            let key = '';
            let source = '';
            state.proxyReady = false;

            // 1. 서버 헬스체크 및 프록시 가용성 확인 (/api/health)
            try {
                const healthRes = await fetch('/api/health');
                if (healthRes.ok) {
                    state.proxyReady = true;
                }
            } catch (e) {}
            
            // 2. 백엔드 API 엔드포인트 시도 (/api/key)
            try {
                const resp = await fetch('/api/key');
                if (resp.ok) {
                    const json = await resp.json();
                    if (json && json.key) {
                        key = json.key.trim();
                        source = '서버 환경변수(.env) 연동됨';
                        state.proxyReady = true;
                    }
                }
            } catch (e) {}

            // 3. 브라우저 저장소(사용자가 직접 입력한 커스텀 키) 확인
            const customKey = localStorage.getItem('gemini_api_key');
            if (customKey && customKey.trim().length > 10) {
                key = customKey.trim();
                source = '개인 커스텀 키 사용 중';
            }

            // 4. 정적 .env 파일 직접 fetch 시도 (로컬 개발용)
            if (!key) {
                try {
                    const resp = await fetch('.env?t=' + Date.now());
                    if (resp.ok) {
                        const text = await resp.text();
                        const parsed = parseEnvFile(text);
                        if (parsed) {
                            key = parsed;
                            source = '.env 파일 연동됨';
                        }
                    }
                } catch (e) {}
            }

            if (key) {
                setApiKey(key, source);
            } else if (state.proxyReady) {
                // 키를 직접 노출하지 않는 보안 프록시(Vercel, Render) 환경
                engine.setApiKey('');
                state.apiKey = '';
                manualKeyInput.value = '';
                apiPulseDot.style.backgroundColor = '#10b981';
                apiStatusText.textContent = 'AI 번역 엔진 준비됨 (무료)';
            } else {
                apiPulseDot.style.backgroundColor = '#f59e0b';
                apiStatusText.textContent = 'API 키 설정 필요 (클릭)';
            }
        } catch (err) {
            console.error('Failed to load key:', err);
            apiPulseDot.style.backgroundColor = '#ef4444';
            apiStatusText.textContent = 'AI 엔진 연결 실패 (클릭)';
        }
    }

    function setApiKey(key, statusLabel) {
        state.apiKey = key.trim();
        engine.setApiKey(state.apiKey);
        localStorage.setItem('gemini_api_key', state.apiKey);
        manualKeyInput.value = state.apiKey;
        apiPulseDot.style.backgroundColor = '#10b981';
        apiStatusText.textContent = statusLabel || 'Gemini API 키 연결됨';
    }

    openKeyModalBtn.addEventListener('click', () => {
        keyModalOverlay.style.display = 'flex';
        manualKeyInput.value = state.apiKey;
    });

    apiBadge.addEventListener('click', () => {
        keyModalOverlay.style.display = 'flex';
        manualKeyInput.value = state.apiKey;
    });

    closeKeyModalBtn.addEventListener('click', () => {
        keyModalOverlay.style.display = 'none';
    });

    keyModalOverlay.addEventListener('click', (e) => {
        if (e.target === keyModalOverlay) keyModalOverlay.style.display = 'none';
    });

    saveKeyBtn.addEventListener('click', () => {
        const val = manualKeyInput.value.trim();
        if (!val) {
            // 개인 키 초기화 시 서버 기본 엔진으로 전환
            localStorage.removeItem('gemini_api_key');
            state.apiKey = '';
            engine.setApiKey('');
            if (state.proxyReady) {
                apiPulseDot.style.backgroundColor = '#10b981';
                apiStatusText.textContent = 'AI 번역 엔진 준비됨 (무료)';
                alert('개인 키가 제거되었습니다. 서버 기본 무료 AI 엔진으로 동작합니다.');
            } else {
                apiPulseDot.style.backgroundColor = '#f59e0b';
                apiStatusText.textContent = 'API 키 설정 필요 (클릭)';
            }
            keyModalOverlay.style.display = 'none';
            return;
        }
        setApiKey(val, '개인 커스텀 키 사용 중');
        alert('개인 Gemini API 키가 정상적으로 설정되었습니다.');
        keyModalOverlay.style.display = 'none';
    });

    reloadKeyFileBtn.addEventListener('click', async () => {
        await loadApiKey();
        keyValidationResult.style.display = 'block';
        if (state.apiKey || state.proxyReady) {
            keyValidationResult.style.background = '#ecfdf5';
            keyValidationResult.style.color = '#065f46';
            keyValidationResult.textContent = state.apiKey 
                ? '성공: 지정된 Gemini API 키가 유효합니다.' 
                : '성공: 서버 AI 번역 엔진과 정상 연결되었습니다. 별도 키 입력 없이 바로 사용 가능합니다!';
        } else {
            keyValidationResult.style.background = '#fef2f2';
            keyValidationResult.style.color = '#991b1b';
            keyValidationResult.textContent = '안내: 서버 엔진을 찾을 수 없습니다. 개인 API 키를 직접 입력하시거나 서버 상태를 확인해주세요.';
        }
    });

    // =========================================================================
    // 2. Drag & Drop and PDF File Handling
    // =========================================================================
    dropzone.addEventListener('click', () => pdfFileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handlePdfFile(files[0]);
        }
    });

    pdfFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handlePdfFile(e.target.files[0]);
        }
    });

    removeFileBtn.addEventListener('click', resetFileState);

    async function handlePdfFile(file) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            alert('PDF 파일(.pdf)만 업로드할 수 있습니다.');
            return;
        }

        resetFileState();
        state.pdfFileName = file.name;
        fileNameText.textContent = file.name;

        const sizeKb = Math.round(file.size / 1024);
        const sizeMb = (sizeKb / 1024).toFixed(1);
        const sizeStr = sizeKb < 1024 ? `${sizeKb} KB` : `${sizeMb} MB`;

        try {
            const buffer = await file.arrayBuffer();
            state.pdfFileBytes = buffer;

            // Load PDF with PDF.js
            const loadingTask = pdfjsLib.getDocument({ data: buffer });
            state.pdfDoc = await loadingTask.promise;
            state.totalPages = state.pdfDoc.numPages;
            state.currentPage = 1;

            fileMetaText.textContent = `${sizeStr} · 총 ${state.totalPages}페이지`;
            dropzone.style.display = 'none';
            fileCard.style.display = 'flex';
            startTranslateBtn.disabled = false;

            updatePagination();
            await renderCurrentPage();
        } catch (err) {
            console.error('PDF Load Error:', err);
            alert('PDF 문서를 불러오는 중 오류가 발생했습니다: ' + err.message);
            resetFileState();
        }
    }

    function resetFileState() {
        engine.resetDocState();
        state.pdfDoc = null;
        state.pdfFileName = '';
        state.pdfFileBytes = null;
        state.totalPages = 0;
        state.currentPage = 1;
        state.pagesData = {};
        state.translatedPdfBlob = null;
        state.lastTargetPages = [];
        state.downloadBlobCache = { translated: null, all: null };
        pdfFileInput.value = '';

        dropzone.style.display = 'block';
        fileCard.style.display = 'none';
        startTranslateBtn.disabled = true;
        downloadBanner.style.display = 'none';

        previewEmpty.style.display = 'block';
        singleCanvasContainer.style.display = 'none';
        dualViewContainer.style.display = 'none';
        pageIndicator.textContent = '- / -';
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
    }

    // =========================================================================
    // 3. Page Rendering & Interactive Viewer
    // =========================================================================
    async function renderCurrentPage() {
        if (!state.pdfDoc) return;

        previewEmpty.style.display = 'none';
        updatePagination();

        const pageNum = state.currentPage;
        let pageData = state.pagesData[pageNum];

        // If page has not been rendered yet, render original page
        if (!pageData || !pageData.originalCanvas) {
            const pdfPage = await state.pdfDoc.getPage(pageNum);
            const { canvas, viewport } = await engine.renderOriginalPage(pdfPage, engine.scale);
            const info = await engine.extractPageBlocks(pdfPage, viewport, { pageNum });

            pageData = {
                originalCanvas: canvas,
                transCanvas: null,
                blocks: info.blocks,
                figures: info.figures,
                bodyFont: info.bodyFont,
                pageNum: pageNum,
                translationsMap: null,
                viewport: viewport
            };
            state.pagesData[pageNum] = pageData;
        }

        renderViewMode();
    }

    function renderViewMode() {
        const pageData = state.pagesData[state.currentPage];
        if (!pageData) return;

        const effectiveCanvas = (state.viewMode === 'original' || !pageData.transCanvas)
            ? pageData.originalCanvas
            : pageData.transCanvas;

        if (state.viewMode === 'dual') {
            singleCanvasContainer.style.display = 'none';
            dualViewContainer.style.display = 'grid';

            // Draw original on left
            dualOrigCanvas.width = pageData.originalCanvas.width;
            dualOrigCanvas.height = pageData.originalCanvas.height;
            dualOrigCanvas.style.width = `${(pageData.originalCanvas.width / engine.scale) * state.zoom}px`;
            dualOrigCanvas.style.height = `${(pageData.originalCanvas.height / engine.scale) * state.zoom}px`;
            const ctxO = dualOrigCanvas.getContext('2d');
            ctxO.drawImage(pageData.originalCanvas, 0, 0);

            // Draw translated (or original if not yet translated) on right
            const targetCanvas = pageData.transCanvas || pageData.originalCanvas;
            dualTransCanvas.width = targetCanvas.width;
            dualTransCanvas.height = targetCanvas.height;
            dualTransCanvas.style.width = `${(targetCanvas.width / engine.scale) * state.zoom}px`;
            dualTransCanvas.style.height = `${(targetCanvas.height / engine.scale) * state.zoom}px`;
            const ctxT = dualTransCanvas.getContext('2d');
            ctxT.drawImage(targetCanvas, 0, 0);

        } else {
            dualViewContainer.style.display = 'none';
            singleCanvasContainer.style.display = 'block';

            mainCanvas.width = effectiveCanvas.width;
            mainCanvas.height = effectiveCanvas.height;
            mainCanvas.style.width = `${(effectiveCanvas.width / engine.scale) * state.zoom}px`;
            mainCanvas.style.height = `${(effectiveCanvas.height / engine.scale) * state.zoom}px`;
            const ctx = mainCanvas.getContext('2d');
            ctx.drawImage(effectiveCanvas, 0, 0);

            buildInteractiveTextOverlay(pageData);
        }
    }

    function buildInteractiveTextOverlay(pageData) {
        textOverlayLayer.innerHTML = '';
        if (!pageData.translationsMap || state.viewMode === 'original') return;

        const displayWidth = (pageData.originalCanvas.width / engine.scale) * state.zoom;
        const scaleFactor = displayWidth / pageData.originalCanvas.width;

        pageData.blocks.forEach(block => {
            const trans = pageData.translationsMap[block.id];
            if (!trans) return;

            const el = document.createElement('div');
            el.className = 'hover-block';
            el.style.left = `${block.x * scaleFactor}px`;
            el.style.top = `${block.y * scaleFactor}px`;
            el.style.width = `${block.width * scaleFactor}px`;
            el.style.height = `${block.height * scaleFactor}px`;

            el.addEventListener('mouseenter', (e) => {
                tooltipOrig.textContent = block.text;
                tooltipTrans.textContent = trans;
                bilingualTooltip.style.display = 'block';
                positionTooltip(e);
            });

            el.addEventListener('mousemove', (e) => positionTooltip(e));

            el.addEventListener('mouseleave', () => {
                bilingualTooltip.style.display = 'none';
            });

            textOverlayLayer.appendChild(el);
        });
    }

    function positionTooltip(e) {
        const offset = 14;
        let left = e.clientX + offset;
        let top = e.clientY + offset;

        const tooltipWidth = 380;
        if (left + tooltipWidth > window.innerWidth) {
            left = e.clientX - tooltipWidth - offset;
        }

        bilingualTooltip.style.left = `${Math.max(10, left)}px`;
        bilingualTooltip.style.top = `${Math.max(10, top)}px`;
    }

    // View mode switching
    viewModeTabs.querySelectorAll('.view-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            viewModeTabs.querySelectorAll('.view-mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.viewMode = tab.dataset.mode;
            renderViewMode();
        });
    });

    // Pagination
    prevPageBtn.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            renderCurrentPage();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
            state.currentPage++;
            renderCurrentPage();
        }
    });

    function updatePagination() {
        pageIndicator.textContent = state.totalPages > 0 ? `${state.currentPage} / ${state.totalPages}` : '- / -';
        prevPageBtn.disabled = state.currentPage <= 1;
        nextPageBtn.disabled = state.currentPage >= state.totalPages;
    }

    // Zoom controls
    zoomInBtn.addEventListener('click', () => {
        if (state.zoom < 2.5) {
            state.zoom = Math.round((state.zoom + 0.15) * 100) / 100;
            zoomLevelText.textContent = `${Math.round(state.zoom * 100)}%`;
            renderViewMode();
        }
    });

    zoomOutBtn.addEventListener('click', () => {
        if (state.zoom > 0.5) {
            state.zoom = Math.round((state.zoom - 0.15) * 100) / 100;
            zoomLevelText.textContent = `${Math.round(state.zoom * 100)}%`;
            renderViewMode();
        }
    });

    fitWidthBtn.addEventListener('click', () => {
        state.zoom = 1.0;
        zoomLevelText.textContent = '100%';
        renderViewMode();
    });

    // Page Range Radio
    document.querySelectorAll('input[name="pageRangeMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            customRangeInput.style.display = e.target.value === 'custom' ? 'block' : 'none';
        });
    });

    // =========================================================================
    // 4. Translation Execution & Progress
    // =========================================================================
    startTranslateBtn.addEventListener('click', runTranslation);
    cancelTranslateBtn.addEventListener('click', () => {
        state.shouldCancel = true;
        progressStatusText.textContent = '번역 취소 요청 중...';
    });

    function getTargetPages() {
        const mode = document.querySelector('input[name="pageRangeMode"]:checked')?.value || 'all';
        if (mode === 'current') return [state.currentPage];
        if (mode === 'all') {
            return Array.from({ length: state.totalPages }, (_, i) => i + 1);
        }
        // Custom range: "1-3, 5"
        const val = customRangeInput.value.trim();
        if (!val) return Array.from({ length: state.totalPages }, (_, i) => i + 1);

        const pages = new Set();
        val.split(',').forEach(part => {
            part = part.trim();
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(Number);
                if (!isNaN(start) && !isNaN(end)) {
                    for (let p = Math.min(start, end); p <= Math.max(start, end); p++) {
                        if (p >= 1 && p <= state.totalPages) pages.add(p);
                    }
                }
            } else {
                const p = Number(part);
                if (!isNaN(p) && p >= 1 && p <= state.totalPages) pages.add(p);
            }
        });

        return Array.from(pages).sort((a, b) => a - b);
    }

    async function runTranslation() {
        if (!state.pdfDoc) return;
        if (!state.apiKey && !state.proxyReady) {
            alert('AI 번역 엔진에 연결되지 않았습니다. 잠시 후 다시 시도하거나 우측 상단 설정을 확인해주세요.');
            keyModalOverlay.style.display = 'flex';
            return;
        }

        const targetPages = getTargetPages();
        if (targetPages.length === 0) {
            alert('번역할 대상 페이지가 없습니다.');
            return;
        }

        // Setup translation state
        state.isTranslating = true;
        state.shouldCancel = false;
        startTranslateBtn.disabled = true;
        progressCard.style.display = 'block';
        downloadBanner.style.display = 'none';

        startTimer();

        const targetLang = targetLangSelect.value;
        const totalTarget = targetPages.length;
        const chkFig = document.getElementById('chkFigureTextKeep');
        const chkRef = document.getElementById('chkRefPreserve');
        engine.setOptions({
            translateFigureText: chkFig ? !chkFig.checked : false,
            translateReferences: chkRef ? !chkRef.checked : false
        });
        let keptOriginalCount = 0;

        try {
            await engine.ensureFonts();
            for (let idx = 0; idx < totalTarget; idx++) {
                if (state.shouldCancel) {
                    alert('번역이 취소되었습니다.');
                    break;
                }

                const pageNum = targetPages[idx];
                const pct = Math.round(((idx) / totalTarget) * 100);
                updateProgress(pct, `페이지 ${idx + 1}/${totalTarget} 분석 및 번역 중 (p.${pageNum})`, pageNum, totalTarget);

                // 1. Ensure original canvas and blocks are extracted
                let pageData = state.pagesData[pageNum];
                if (!pageData || !pageData.originalCanvas) {
                    progressStepTitle.textContent = `[1/3] 페이지 ${pageNum} 레이아웃 및 2단 컬럼 파싱`;
                    const pdfPage = await state.pdfDoc.getPage(pageNum);
                    const { canvas, viewport } = await engine.renderOriginalPage(pdfPage, engine.scale);
                    const info = await engine.extractPageBlocks(pdfPage, viewport, { pageNum });
                    pageData = {
                        originalCanvas: canvas,
                        transCanvas: null,
                        blocks: info.blocks,
                        figures: info.figures,
                        bodyFont: info.bodyFont,
                        pageNum: pageNum,
                        translationsMap: null,
                        viewport: viewport
                    };
                    state.pagesData[pageNum] = pageData;
                }

                const blocks = pageData.blocks;
                if (!blocks || blocks.length === 0) {
                    console.log(`Page ${pageNum} has no text items.`);
                    pageData.transCanvas = pageData.originalCanvas;
                    continue;
                }

                // 2. Classify (role / translate policy) and translate only translatable blocks
                engine.classifyBlocks(pageData);
                const translatable = blocks.filter(b => b.translate);
                if (translatable.length === 0) {
                    pageData.transCanvas = pageData.originalCanvas;
                    continue;
                }

                progressStepTitle.textContent = `[2/3] 페이지 ${pageNum} Gemini AI 학술 번역 진행 중`;
                progressStatusText.textContent = `총 ${translatable.length}개 학술 텍스트 블록의 수식/용어 보존 번역을 요청 중입니다...`;

                const collect = (results, map) => {
                    if (Array.isArray(results)) {
                        results.forEach(item => {
                            if (item && item.id && item.translated) map[item.id] = item.translated;
                        });
                    }
                };

                const chunkSize = 25; // Reliable chunk size for JSON output
                const translationsMap = {};

                for (let c = 0; c < translatable.length; c += chunkSize) {
                    if (state.shouldCancel) break;
                    const chunk = translatable.slice(c, c + chunkSize);
                    const results = await engine.callGeminiTranslate(chunk, targetLang);
                    collect(results, translationsMap);
                }

                // 2-b. Shorten-retry loop for translations that would overflow their box
                for (let round = 0; round < 2 && !state.shouldCancel; round++) {
                    const overflow = engine.findOverflow(pageData, translationsMap);
                    if (overflow.length === 0) break;
                    progressStatusText.textContent = `페이지 ${pageNum}: ${overflow.length}개 블록 축약 재번역 중 (${round + 1}/2)`;
                    overflow.forEach(o => {
                        if (o.block.maxCharsStrict) o.block.maxCharsStrict = Math.floor(o.block.maxCharsStrict * 0.85);
                    });
                    const targets = overflow.map(o => o.block);
                    for (let c = 0; c < targets.length; c += 15) {
                        const chunk = targets.slice(c, c + 15);
                        try {
                            const results = await engine.callGeminiTranslate(chunk, targetLang, {
                                shorten: true,
                                currentTranslations: translationsMap
                            });
                            collect(results, translationsMap);
                        } catch (e) {
                            console.warn('Shorten retry failed:', e);
                        }
                    }
                }

                pageData.translationsMap = translationsMap;

                // 3. Render translated canvas with inpainting & Korean auto-fit
                progressStepTitle.textContent = `[3/3] 페이지 ${pageNum} 서식 보존 캔버스 재구성`;
                const transCanvas = engine.renderTranslatedCanvas(
                    pageData.originalCanvas,
                    pageData.blocks,
                    translationsMap,
                    engine.scale,
                    pageData.figures || []
                );
                if (transCanvas.layoutWarnings) keptOriginalCount += transCanvas.layoutWarnings.length;
                pageData.transCanvas = transCanvas;

                // Live update if user is looking at this page
                if (state.currentPage === pageNum) {
                    renderViewMode();
                }
            }

            if (!state.shouldCancel) {
                // Translation Completed!
                updateProgress(100, '모든 페이지 번역 및 서식 합성 완료!', totalTarget, totalTarget);
                progressStepTitle.textContent = '번역 완료';

                // Automatically switch to translated or dual view
                state.viewMode = 'dual';
                viewModeTabs.querySelectorAll('.view-mode-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.mode === 'dual');
                });
                renderViewMode();

                // Save translated target pages & reset cache
                state.lastTargetPages = [...targetPages];
                state.downloadBlobCache = { translated: null, all: null };

                // Prepare downloadable PDF based on user preference
                progressStatusText.textContent = '다운로드용 고해상도 PDF를 생성하고 있습니다...';
                const currentScope = getDownloadScopeMode();
                await prepareDownloadPdf(currentScope);
                updateDownloadButtonUI();

                progressStatusText.textContent = '번역본 PDF가 준비되었습니다!' +
                    (keptOriginalCount > 0 ? ` (${keptOriginalCount}개 블록은 레이아웃 보존을 위해 원문 유지)` : '');

                // Show download banner
                downloadBanner.style.display = 'block';
                downloadBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

        } catch (err) {
            console.error('Translation error:', err);
            alert('번역 중 오류가 발생했습니다: ' + err.message);
            progressStatusText.textContent = '오류: ' + err.message;
        } finally {
            stopTimer();
            state.isTranslating = false;
            startTranslateBtn.disabled = false;
        }
    }

    function updateProgress(percent, statusMsg, currentP, totalP) {
        progressBarFill.style.width = `${percent}%`;
        progressPercentText.textContent = `${percent}%`;
        progressStatusText.textContent = statusMsg;
        progressPageCountText.textContent = `${currentP} / ${totalP} 페이지`;
    }

    function startTimer() {
        state.startTime = Date.now();
        progressTimer.textContent = '00:00';
        clearInterval(state.timerInterval);
        state.timerInterval = setInterval(() => {
            const elapsedSec = Math.floor((Date.now() - state.startTime) / 1000);
            const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
            const s = String(elapsedSec % 60).padStart(2, '0');
            progressTimer.textContent = `${m}:${s}`;
        }, 1000);
    }

    function stopTimer() {
        clearInterval(state.timerInterval);
    }

    // =========================================================================
    // 5. Download & Export Management (Scope options)
    // =========================================================================
    function formatPageRangeString(pages) {
        if (!pages || pages.length === 0) return '';
        if (pages.length === 1) return `${pages[0]}`;
        const ranges = [];
        let start = pages[0];
        let prev = pages[0];
        for (let i = 1; i < pages.length; i++) {
            const curr = pages[i];
            if (curr === prev + 1) {
                prev = curr;
            } else {
                ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
                start = curr;
                prev = curr;
            }
        }
        ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
        return ranges.join(', ');
    }

    function getDownloadScopeMode() {
        const el = document.querySelector('input[name="downloadScopeMode"]:checked') ||
                   document.querySelector('input[name="bannerDownloadScope"]:checked');
        return el ? el.value : 'translated';
    }

    function setDownloadScopeMode(mode) {
        document.querySelectorAll('input[name="downloadScopeMode"]').forEach(r => {
            r.checked = (r.value === mode);
        });
        document.querySelectorAll('input[name="bannerDownloadScope"]').forEach(r => {
            r.checked = (r.value === mode);
        });
        updateDownloadButtonUI();
    }

    async function prepareDownloadPdf(mode) {
        if (!state.pdfDoc) return null;
        mode = mode || getDownloadScopeMode();

        if (state.downloadBlobCache && state.downloadBlobCache[mode]) {
            state.translatedPdfBlob = state.downloadBlobCache[mode];
            return state.translatedPdfBlob;
        }

        const isTranslatedOnly = (mode === 'translated');
        let pagesToExport = [];

        if (isTranslatedOnly) {
            pagesToExport = (state.lastTargetPages && state.lastTargetPages.length > 0)
                ? [...state.lastTargetPages]
                : [state.currentPage];
        } else {
            for (let p = 1; p <= state.totalPages; p++) {
                pagesToExport.push(p);
            }
        }

        const canvasesToExport = [];
        for (const p of pagesToExport) {
            const pData = state.pagesData[p];
            if (pData && pData.transCanvas) {
                canvasesToExport.push(pData.transCanvas);
            } else if (pData && pData.originalCanvas) {
                canvasesToExport.push(pData.originalCanvas);
            } else {
                const pdfPage = await state.pdfDoc.getPage(p);
                const { canvas } = await engine.renderOriginalPage(pdfPage, engine.scale);
                canvasesToExport.push(canvas);
            }
        }

        const blob = await engine.createPdfFromCanvases(canvasesToExport, state.pdfDoc);
        if (!state.downloadBlobCache) state.downloadBlobCache = {};
        state.downloadBlobCache[mode] = blob;
        state.translatedPdfBlob = blob;
        return blob;
    }

    function updateDownloadButtonUI() {
        const mode = getDownloadScopeMode();
        const hasHistory = state.lastTargetPages && state.lastTargetPages.length > 0;
        const targetCount = hasHistory ? state.lastTargetPages.length : 1;
        const total = state.totalPages || 0;

        if (bannerScopeTranslatedLabel) {
            const rangeStr = hasHistory ? ` (p.${formatPageRangeString(state.lastTargetPages)})` : '';
            bannerScopeTranslatedLabel.textContent = `번역 요청한 페이지만 [${targetCount}p]${rangeStr}`;
        }
        if (bannerScopeAllLabel) {
            bannerScopeAllLabel.textContent = `번역 안 된 페이지도 다운받기 [전체 ${total}p]`;
        }

        if (downloadBtnText) {
            if (mode === 'translated') {
                downloadBtnText.textContent = `번역된 ${targetCount}페이지 PDF 다운로드`;
            } else {
                downloadBtnText.textContent = `전체 ${total}페이지 PDF 다운로드 (원본 포함)`;
            }
        }
    }

    // Scope selection sync
    document.querySelectorAll('input[name="downloadScopeMode"], input[name="bannerDownloadScope"]').forEach(radio => {
        radio.addEventListener('change', async (e) => {
            const newMode = e.target.value;
            setDownloadScopeMode(newMode);
            if (state.lastTargetPages && state.lastTargetPages.length > 0 && downloadBanner.style.display !== 'none') {
                if (!state.downloadBlobCache || !state.downloadBlobCache[newMode]) {
                    if (downloadBtnText) downloadBtnText.textContent = 'PDF 생성 중...';
                    downloadPdfBtn.disabled = true;
                    try {
                        await prepareDownloadPdf(newMode);
                    } catch (err) {
                        console.error('PDF 생성 실패:', err);
                    } finally {
                        downloadPdfBtn.disabled = false;
                        updateDownloadButtonUI();
                    }
                } else {
                    state.translatedPdfBlob = state.downloadBlobCache[newMode];
                }
            }
        });
    });

    downloadPdfBtn.addEventListener('click', async () => {
        const mode = getDownloadScopeMode();
        let blob = (state.downloadBlobCache && state.downloadBlobCache[mode]) || state.translatedPdfBlob;

        if (!blob) {
            if (downloadBtnText) downloadBtnText.textContent = 'PDF 생성 중...';
            downloadPdfBtn.disabled = true;
            try {
                blob = await prepareDownloadPdf(mode);
            } catch (err) {
                alert('PDF 생성 중 오류가 발생했습니다: ' + err.message);
                return;
            } finally {
                downloadPdfBtn.disabled = false;
                updateDownloadButtonUI();
            }
        }

        if (!blob) {
            alert('번역된 PDF가 아직 준비되지 않았습니다.');
            return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const origBase = state.pdfFileName.replace(/\.pdf$/i, '');

        let filename = `[번역본]_${origBase}.pdf`;
        if (mode === 'translated' && state.lastTargetPages && state.lastTargetPages.length < state.totalPages) {
            const pageStr = formatPageRangeString(state.lastTargetPages).replace(/\s+/g, '');
            filename = `[번역본_p${pageStr}]_${origBase}.pdf`;
        } else if (mode === 'all') {
            filename = `[번역본_전체]_${origBase}.pdf`;
        }

        a.download = filename;
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

    compareViewBtn.addEventListener('click', () => {
        state.viewMode = 'dual';
        viewModeTabs.querySelectorAll('.view-mode-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === 'dual');
        });
        renderViewMode();
        previewEmpty.scrollIntoView({ behavior: 'smooth' });
    });

    // Initialize Key
    loadApiKey();
});
