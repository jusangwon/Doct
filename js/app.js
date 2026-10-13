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
    const dualViewContainer = document.getElementById('dualViewContainer');
    const dualOrigPane = document.getElementById('dualOrigPane');
    const dualTransPane = document.getElementById('dualTransPane');
    const dualOrigPagesList = document.getElementById('dualOrigPagesList');
    const dualTransPagesList = document.getElementById('dualTransPagesList');
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
    const previewCard = document.getElementById('previewCard');
    const previewBody = document.getElementById('previewBody');
    const toggleFullscreenBtn = document.getElementById('toggleFullscreenBtn');
    const fullscreenBtnText = document.getElementById('fullscreenBtnText');
    const iconExpand = toggleFullscreenBtn?.querySelector('.icon-expand');
    const iconCompress = toggleFullscreenBtn?.querySelector('.icon-compress');
    const bilingualTooltip = document.getElementById('bilingualTooltip');
    const tooltipOrig = document.getElementById('tooltipOrig');
    const tooltipTrans = document.getElementById('tooltipTrans');

    const mobileNoticeBar = document.getElementById('mobileNoticeBar');
    const mobileQuickCopyBtn = document.getElementById('mobileQuickCopyBtn');
    const mobileGuideModalOverlay = document.getElementById('mobileGuideModalOverlay');
    const closeMobileGuideBtn = document.getElementById('closeMobileGuideBtn');
    const copyPcLinkBtn = document.getElementById('copyPcLinkBtn');
    const continueMobileBtn = document.getElementById('continueMobileBtn');
    const mobileCopyToast = document.getElementById('mobileCopyToast');

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

            await ensurePageData(1);
            setupContinuousPages();
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
        if (pageObserver) {
            pageObserver.disconnect();
            pageObserver = null;
        }
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
        singleCanvasContainer.innerHTML = '';
        dualViewContainer.style.display = 'none';
        if (dualOrigPagesList) dualOrigPagesList.innerHTML = '';
        if (dualTransPagesList) dualTransPagesList.innerHTML = '';
        pageIndicator.textContent = '- / -';
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
    }

    // =========================================================================
    // 3. Page Rendering & Interactive Continuous Viewer
    // =========================================================================

    let pageObserver = null;
    let isSyncingDualScroll = false;
    let scrollThrottleTimer = null;

    async function ensurePageData(pageNum) {
        if (!state.pdfDoc || pageNum < 1 || pageNum > state.totalPages) return null;
        let pageData = state.pagesData[pageNum];
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
        return pageData;
    }

    function buildPageCardDOM(pageNum) {
        const baseW = state.pagesData[1]?.originalCanvas
            ? (state.pagesData[1].originalCanvas.width / engine.scale) * state.zoom
            : 600 * state.zoom;
        const baseH = state.pagesData[1]?.originalCanvas
            ? (state.pagesData[1].originalCanvas.height / engine.scale) * state.zoom
            : 850 * state.zoom;

        // 1. Single View Card
        let singleWrapper = document.getElementById(`singlePage-${pageNum}`);
        if (!singleWrapper) {
            singleWrapper = document.createElement('div');
            singleWrapper.className = 'pdf-page-wrapper';
            singleWrapper.id = `singlePage-${pageNum}`;
            singleWrapper.dataset.page = pageNum;
            singleWrapper.innerHTML = `
                <div class="page-badge-header">
                    <span class="page-badge-pill" id="singleBadge-${pageNum}">페이지 ${pageNum} / ${state.totalPages}</span>
                </div>
                <div class="pdf-page-card" id="singleCard-${pageNum}">
                    <canvas id="singleCanvas-${pageNum}"></canvas>
                    <div class="text-overlay-layer" id="singleOverlay-${pageNum}"></div>
                </div>
            `;
            singleCanvasContainer.appendChild(singleWrapper);
            const sCanvas = document.getElementById(`singleCanvas-${pageNum}`);
            if (sCanvas) {
                sCanvas.style.width = `${baseW}px`;
                sCanvas.style.height = `${baseH}px`;
            }
        }

        // 2. Dual Orig Card
        let dualOrigWrapper = document.getElementById(`dualOrigPage-${pageNum}`);
        if (!dualOrigWrapper && dualOrigPagesList) {
            dualOrigWrapper = document.createElement('div');
            dualOrigWrapper.className = 'pdf-page-wrapper';
            dualOrigWrapper.id = `dualOrigPage-${pageNum}`;
            dualOrigWrapper.dataset.page = pageNum;
            dualOrigWrapper.innerHTML = `
                <div class="page-badge-header">
                    <span class="page-badge-pill">페이지 ${pageNum} (원문)</span>
                </div>
                <div class="pdf-page-card" id="dualOrigCard-${pageNum}">
                    <canvas id="dualOrigCanvas-${pageNum}"></canvas>
                </div>
            `;
            dualOrigPagesList.appendChild(dualOrigWrapper);
            const dOrigCanvas = document.getElementById(`dualOrigCanvas-${pageNum}`);
            if (dOrigCanvas) {
                dOrigCanvas.style.width = `${baseW}px`;
                dOrigCanvas.style.height = `${baseH}px`;
            }
        }

        // 3. Dual Trans Card
        let dualTransWrapper = document.getElementById(`dualTransPage-${pageNum}`);
        if (!dualTransWrapper && dualTransPagesList) {
            dualTransWrapper = document.createElement('div');
            dualTransWrapper.className = 'pdf-page-wrapper';
            dualTransWrapper.id = `dualTransPage-${pageNum}`;
            dualTransWrapper.dataset.page = pageNum;
            dualTransWrapper.innerHTML = `
                <div class="page-badge-header">
                    <span class="page-badge-pill" id="dualTransBadge-${pageNum}">페이지 ${pageNum} (대기)</span>
                </div>
                <div class="pdf-page-card" id="dualTransCard-${pageNum}">
                    <canvas id="dualTransCanvas-${pageNum}"></canvas>
                </div>
            `;
            dualTransPagesList.appendChild(dualTransWrapper);
            const dTransCanvas = document.getElementById(`dualTransCanvas-${pageNum}`);
            if (dTransCanvas) {
                dTransCanvas.style.width = `${baseW}px`;
                dTransCanvas.style.height = `${baseH}px`;
            }
        }
    }

    function setupContinuousPages() {
        if (!state.pdfDoc || state.totalPages <= 0) return;
        singleCanvasContainer.innerHTML = '';
        if (dualOrigPagesList) dualOrigPagesList.innerHTML = '';
        if (dualTransPagesList) dualTransPagesList.innerHTML = '';

        for (let p = 1; p <= state.totalPages; p++) {
            buildPageCardDOM(p);
        }

        if (pageObserver) {
            pageObserver.disconnect();
            pageObserver = null;
        }

        pageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const pageNum = parseInt(entry.target.dataset.page, 10);
                    if (pageNum) {
                        renderPageItem(pageNum);
                    }
                }
            });
        }, {
            root: null,
            rootMargin: '600px 0px' // Preload 600px ahead
        });

        document.querySelectorAll('.pdf-page-wrapper').forEach(wrapper => {
            pageObserver.observe(wrapper);
        });
    }

    async function renderPageItem(pageNum) {
        if (!state.pdfDoc || pageNum < 1 || pageNum > state.totalPages) return;
        const pageData = await ensurePageData(pageNum);
        if (!pageData || !pageData.originalCanvas) return;

        const effectiveCanvas = (state.viewMode === 'original' || !pageData.transCanvas)
            ? pageData.originalCanvas
            : pageData.transCanvas;

        const targetW = (effectiveCanvas.width / engine.scale) * state.zoom;
        const targetH = (effectiveCanvas.height / engine.scale) * state.zoom;

        // 1. Single View Canvas
        const sCanvas = document.getElementById(`singleCanvas-${pageNum}`);
        if (sCanvas) {
            if (sCanvas.width !== effectiveCanvas.width || sCanvas.height !== effectiveCanvas.height || sCanvas._renderedCanvas !== effectiveCanvas) {
                sCanvas.width = effectiveCanvas.width;
                sCanvas.height = effectiveCanvas.height;
                sCanvas._renderedCanvas = effectiveCanvas;
                const sCtx = sCanvas.getContext('2d');
                sCtx.drawImage(effectiveCanvas, 0, 0);
            }
            sCanvas.style.width = `${targetW}px`;
            sCanvas.style.height = `${targetH}px`;

            const sOverlay = document.getElementById(`singleOverlay-${pageNum}`);
            if (sOverlay) {
                buildOverlayForPage(pageData, sOverlay, targetW);
            }

            const sBadge = document.getElementById(`singleBadge-${pageNum}`);
            if (sBadge) {
                if (pageData.transCanvas && state.viewMode !== 'original') {
                    sBadge.textContent = `페이지 ${pageNum} / ${state.totalPages} (번역 완료)`;
                    sBadge.classList.add('translated');
                } else {
                    sBadge.textContent = `페이지 ${pageNum} / ${state.totalPages}`;
                    sBadge.classList.remove('translated');
                }
            }
        }

        // 2. Dual Orig Canvas
        const dOrigCanvas = document.getElementById(`dualOrigCanvas-${pageNum}`);
        if (dOrigCanvas) {
            const origW = (pageData.originalCanvas.width / engine.scale) * state.zoom;
            const origH = (pageData.originalCanvas.height / engine.scale) * state.zoom;
            if (dOrigCanvas.width !== pageData.originalCanvas.width || dOrigCanvas.height !== pageData.originalCanvas.height) {
                dOrigCanvas.width = pageData.originalCanvas.width;
                dOrigCanvas.height = pageData.originalCanvas.height;
                const dCtxO = dOrigCanvas.getContext('2d');
                dCtxO.drawImage(pageData.originalCanvas, 0, 0);
            }
            dOrigCanvas.style.width = `${origW}px`;
            dOrigCanvas.style.height = `${origH}px`;
        }

        // 3. Dual Trans Canvas
        const dTransCanvas = document.getElementById(`dualTransCanvas-${pageNum}`);
        if (dTransCanvas) {
            const transTarget = pageData.transCanvas || pageData.originalCanvas;
            const transW = (transTarget.width / engine.scale) * state.zoom;
            const transH = (transTarget.height / engine.scale) * state.zoom;
            if (dTransCanvas.width !== transTarget.width || dTransCanvas.height !== transTarget.height || dTransCanvas._renderedCanvas !== transTarget) {
                dTransCanvas.width = transTarget.width;
                dTransCanvas.height = transTarget.height;
                dTransCanvas._renderedCanvas = transTarget;
                const dCtxT = dTransCanvas.getContext('2d');
                dCtxT.drawImage(transTarget, 0, 0);
            }
            dTransCanvas.style.width = `${transW}px`;
            dTransCanvas.style.height = `${transH}px`;

            const dBadge = document.getElementById(`dualTransBadge-${pageNum}`);
            if (dBadge) {
                if (pageData.transCanvas) {
                    dBadge.textContent = `페이지 ${pageNum} (번역 완료)`;
                    dBadge.classList.add('translated');
                } else {
                    dBadge.textContent = `페이지 ${pageNum} (번역 대기)`;
                    dBadge.classList.remove('translated');
                }
            }
        }
    }

    function buildOverlayForPage(pageData, overlayEl, displayWidth) {
        overlayEl.innerHTML = '';
        if (!pageData.translationsMap || state.viewMode === 'original') return;

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
            overlayEl.appendChild(el);
        });
    }

    function renderViewMode() {
        if (!state.pdfDoc || state.totalPages <= 0) return;

        if (state.viewMode === 'dual') {
            singleCanvasContainer.style.display = 'none';
            dualViewContainer.style.display = 'grid';
        } else {
            dualViewContainer.style.display = 'none';
            singleCanvasContainer.style.display = 'flex';
        }

        const baseW = state.pagesData[1]?.originalCanvas
            ? (state.pagesData[1].originalCanvas.width / engine.scale) * state.zoom
            : 600 * state.zoom;
        const baseH = state.pagesData[1]?.originalCanvas
            ? (state.pagesData[1].originalCanvas.height / engine.scale) * state.zoom
            : 850 * state.zoom;

        // Re-scale/render all pages for zoom or viewMode change
        for (let p = 1; p <= state.totalPages; p++) {
            if (state.pagesData[p]?.originalCanvas) {
                renderPageItem(p);
            } else {
                const s = document.getElementById(`singleCanvas-${p}`);
                if (s) { s.style.width = `${baseW}px`; s.style.height = `${baseH}px`; }
                const doC = document.getElementById(`dualOrigCanvas-${p}`);
                if (doC) { doC.style.width = `${baseW}px`; doC.style.height = `${baseH}px`; }
                const dtC = document.getElementById(`dualTransCanvas-${p}`);
                if (dtC) { dtC.style.width = `${baseW}px`; dtC.style.height = `${baseH}px`; }
            }
        }
    }

    async function renderCurrentPage() {
        if (!state.pdfDoc) return;
        previewEmpty.style.display = 'none';
        updatePagination();

        await renderPageItem(state.currentPage || 1);
        renderViewMode();

        if (state.currentPage < state.totalPages) {
            renderPageItem(state.currentPage + 1);
        }
    }

    function updateCurrentPageFromScroll(scrollContainer) {
        if (!state.totalPages || state.totalPages <= 0) return;
        if (scrollThrottleTimer) return;

        scrollThrottleTimer = setTimeout(() => {
            scrollThrottleTimer = null;
            const selector = state.viewMode === 'dual'
                ? '#dualOrigPagesList .pdf-page-wrapper'
                : '#singleCanvasContainer .pdf-page-wrapper';
            const wrappers = document.querySelectorAll(selector);
            if (!wrappers || wrappers.length === 0) return;

            const containerRect = scrollContainer.getBoundingClientRect();
            const focalY = containerRect.top + Math.min(180, containerRect.height * 0.35);

            let bestPage = state.currentPage;
            let bestDist = Infinity;

            wrappers.forEach(el => {
                const rect = el.getBoundingClientRect();
                const dist = Math.abs(rect.top - focalY);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestPage = parseInt(el.dataset.page, 10);
                }
            });

            if (bestPage && bestPage !== state.currentPage && bestPage >= 1 && bestPage <= state.totalPages) {
                state.currentPage = bestPage;
                updatePagination();
            }
        }, 60);
    }

    // Scroll listeners
    previewBody.addEventListener('scroll', () => {
        if (state.viewMode !== 'dual') {
            updateCurrentPageFromScroll(previewBody);
        }
    }, { passive: true });

    if (dualOrigPane && dualTransPane) {
        dualOrigPane.addEventListener('scroll', () => {
            if (isSyncingDualScroll) return;
            isSyncingDualScroll = true;
            dualTransPane.scrollTop = dualOrigPane.scrollTop;
            updateCurrentPageFromScroll(dualOrigPane);
            isSyncingDualScroll = false;
        }, { passive: true });

        dualTransPane.addEventListener('scroll', () => {
            if (isSyncingDualScroll) return;
            isSyncingDualScroll = true;
            dualOrigPane.scrollTop = dualTransPane.scrollTop;
            updateCurrentPageFromScroll(dualTransPane);
            isSyncingDualScroll = false;
        }, { passive: true });
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
            scrollToPage(state.currentPage, false);
        });
    });

    // Pagination & Smooth Page Navigation
    function scrollToPage(pageNum, smooth = true) {
        if (pageNum < 1 || pageNum > state.totalPages) return;
        state.currentPage = pageNum;
        updatePagination();

        const selector = state.viewMode === 'dual'
            ? `#dualOrigPage-${pageNum}`
            : `#singlePage-${pageNum}`;
        const targetEl = document.querySelector(selector);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
        }
        renderPageItem(pageNum);
    }

    prevPageBtn.addEventListener('click', () => {
        if (state.currentPage > 1) {
            scrollToPage(state.currentPage - 1);
        }
    });

    nextPageBtn.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
            scrollToPage(state.currentPage + 1);
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

    function autoFitWidth() {
        const pageData = state.pagesData[state.currentPage];
        if (!pageData || !pageData.originalCanvas) {
            state.zoom = 1.0;
            zoomLevelText.textContent = '100%';
            renderViewMode();
            return;
        }

        const origW = pageData.originalCanvas.width / engine.scale;
        if (!origW || origW <= 0) return;

        let targetZoom = 1.0;
        if (state.viewMode === 'dual') {
            const paneW = dualOrigPane ? (dualOrigPane.clientWidth - 48) : ((previewBody.clientWidth / 2) - 48);
            if (paneW > 100) {
                targetZoom = Math.floor((paneW / origW) * 100) / 100;
            }
        } else {
            const bodyW = previewBody.clientWidth - 64;
            if (bodyW > 100) {
                targetZoom = Math.floor((bodyW / origW) * 100) / 100;
            }
        }

        targetZoom = Math.max(0.4, Math.min(2.5, targetZoom));
        state.zoom = targetZoom;
        zoomLevelText.textContent = `${Math.round(state.zoom * 100)}%`;
        renderViewMode();
    }

    fitWidthBtn.addEventListener('click', autoFitWidth);

    // Fullscreen View Mode Toggle
    function toggleFullscreen(forceState) {
        if (!previewCard) return;
        const isCurrentlyFull = previewCard.classList.contains('fullscreen-mode');
        const willBeFull = typeof forceState === 'boolean' ? forceState : !isCurrentlyFull;

        if (willBeFull) {
            previewCard.classList.add('fullscreen-mode');
            if (iconExpand) iconExpand.style.display = 'none';
            if (iconCompress) iconCompress.style.display = 'inline-block';
            if (fullscreenBtnText) fullscreenBtnText.textContent = '원래 크기로 [ESC]';
            document.body.style.overflow = 'hidden';
            setTimeout(() => {
                autoFitWidth();
            }, 60);
        } else {
            previewCard.classList.remove('fullscreen-mode');
            if (iconExpand) iconExpand.style.display = 'inline-block';
            if (iconCompress) iconCompress.style.display = 'none';
            if (fullscreenBtnText) fullscreenBtnText.textContent = '전체화면 크게보기';
            document.body.style.overflow = '';
            setTimeout(() => {
                autoFitWidth();
            }, 60);
        }
    }

    if (toggleFullscreenBtn) {
        toggleFullscreenBtn.addEventListener('click', () => toggleFullscreen());
    }

    // ESC to exit fullscreen
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && previewCard?.classList.contains('fullscreen-mode')) {
            toggleFullscreen(false);
        }
    });

    // Window resize handler
    window.addEventListener('resize', () => {
        if (previewCard?.classList.contains('fullscreen-mode')) {
            renderViewMode();
        }
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
                    const results = await engine.callGeminiTranslate(chunk, targetLang, {
                        onStatusUpdate: (msg) => {
                            if (progressStatusText) progressStatusText.textContent = msg;
                        }
                    });
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
                                currentTranslations: translationsMap,
                                onStatusUpdate: (msg) => {
                                    if (progressStatusText) progressStatusText.textContent = msg;
                                }
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

                // Live update continuous page item immediately
                renderPageItem(pageNum);
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
        previewCard.scrollIntoView({ behavior: 'smooth' });
    });

    // =========================================================================
    // 6. Mobile Experience & Guidance
    // =========================================================================
    function isMobileDevice() {
        return window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    function checkMobileGuidance() {
        if (!isMobileDevice()) return;

        // 모바일 접속 시 화면 너비 제약으로 기본 뷰를 '단일 보기'로 최적화
        state.viewMode = 'single';
        viewModeTabs.querySelectorAll('.view-mode-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.mode === 'single');
        });

        // 이번 방문 중 첫 접속인지 확인
        const hasSeenMobileGuide = sessionStorage.getItem('doct_mobile_guide_seen');
        if (!hasSeenMobileGuide && mobileGuideModalOverlay) {
            mobileGuideModalOverlay.style.display = 'flex';
        }
    }

    function copyCurrentUrl(toastEl) {
        const url = window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                if (toastEl) {
                    toastEl.style.display = 'block';
                    setTimeout(() => {
                        toastEl.style.display = 'none';
                    }, 4000);
                } else {
                    alert('링크가 복사되었습니다! PC 브라우저에 붙여넣어 열어보세요.');
                }
            }).catch(() => {
                prompt('아래 링크를 복사하여 PC에서 열어보세요:', url);
            });
        } else {
            prompt('아래 링크를 복사하여 PC에서 열어보세요:', url);
        }
    }

    if (copyPcLinkBtn) {
        copyPcLinkBtn.addEventListener('click', () => {
            copyCurrentUrl(mobileCopyToast);
        });
    }

    if (mobileQuickCopyBtn) {
        mobileQuickCopyBtn.addEventListener('click', () => {
            copyCurrentUrl();
        });
    }

    if (continueMobileBtn) {
        continueMobileBtn.addEventListener('click', () => {
            sessionStorage.setItem('doct_mobile_guide_seen', 'true');
            if (mobileGuideModalOverlay) mobileGuideModalOverlay.style.display = 'none';
        });
    }

    if (closeMobileGuideBtn) {
        closeMobileGuideBtn.addEventListener('click', () => {
            sessionStorage.setItem('doct_mobile_guide_seen', 'true');
            if (mobileGuideModalOverlay) mobileGuideModalOverlay.style.display = 'none';
        });
    }

    // Initialize Key & Device Mode
    loadApiKey();
    checkMobileGuidance();
});
