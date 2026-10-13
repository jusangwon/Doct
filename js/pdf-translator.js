/**
 * PDF Academic Translator Engine (Layout-Preserving)
 *
 * Pipeline
 *  1. Page structure analysis  : figure regions (images + vector graphics), column gutter
 *  2. Line / paragraph building: column-aware reading order, heading / list / caption aware
 *  3. Role classification      : title, heading, body, caption, math, meta, reference, figure
 *  4. Context-aware translation: role + character budget aware prompts, "shorten" retry mode
 *  5. Layout-fit rendering     : per-line masking with sampled background, overflow-safe fitting
 *  6. Quality check            : overflow / figure-overlap detection (original text is kept on failure)
 *  7. jsPDF multi-page high-resolution PDF builder
 */

const CAPTION_RE = /^(fig\.?|figure|table|scheme|chart|그림|표)\s*\.?\s*[A-Z]?\d+/i;
const LIST_START_RE = /^(\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}\.(?=\s)|[•▪◦·*]|[-–—](?=\s))\s*/;
const REF_HEADING_RE = /^(\d+\.?\s*)?(references?|bibliography|works cited|참고\s*문헌)\s*$/i;

class PdfTranslatorEngine {
    constructor(options = {}) {
        this.apiKey = options.apiKey || '';
        this.flashModels = [
            'gemini-flash-lite-latest',
            'gemini-3.5-flash-lite',
            'gemini-3.1-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.8-flash',
            'gemini-3.7-flash',
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-flash-latest'
        ];
        this.proModels = [
            'gemini-pro-latest',
            'gemini-3.1-pro-preview'
        ];
        this.modelTier = options.modelTier || 'flash';
        this.models = this.getModelList(this.modelTier);
        this.currentModelIndex = 0;
        this.scale = options.scale || 2.0; // High-DPI for crisp text and formulas
        this.fontFamily = "'Noto Sans KR', 'Pretendard', 'Malgun Gothic', sans-serif";

        // Translation policy options (default: keep figure text / references in the original language)
        this.options = {
            translateFigureText: false,
            translateReferences: false
        };
        this.docState = { refStartPage: null };
        this._measureCtx = null;
        this._fontBoldCache = new Map();
    }

    setModelTier(tier) {
        const normalized = tier === 'pro' ? 'pro' : 'flash';
        if (this.modelTier !== normalized) {
            this.modelTier = normalized;
            this.models = this.getModelList(this.modelTier);
            this.currentModelIndex = 0;
        }
    }

    getModelList(tier) {
        if (tier === 'pro') {
            // Pro 선택 시: 최신 Pro 모델 우선 호출 -> 한도 초과/과부하 시 Flash 풀로 안전 폴백
            return [...this.proModels, ...this.flashModels];
        }
        return [...this.flashModels];
    }

    setApiKey(key) {
        this.apiKey = (key || '').trim();
    }

    setOptions(opts = {}) {
        Object.assign(this.options, opts);
    }

    resetDocState() {
        this.docState = { refStartPage: null };
        this._fontBoldCache.clear();
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async ensureFonts() {
        try {
            if (document.fonts && document.fonts.load) {
                await Promise.all(['400', '700'].map(w =>
                    document.fonts.load(`${w} 16px "Noto Sans KR"`, '가나다라 한글')
                ));
            }
        } catch (e) { /* font loading is best-effort */ }
    }

    // =========================================================================
    // Gemini translation
    // =========================================================================

    /**
     * Call Gemini API with Exponential Backoff & Multi-Model Fallback Queue
     * options.shorten = true  -> ask for shorter rewrites of options.currentTranslations
     * options.onStatusUpdate  -> callback to report retry/fallback progress
     */
    async callGeminiTranslate(blocks, targetLang = 'ko', options = {}) {
        if (options.modelTier) {
            this.setModelTier(options.modelTier);
        }
        const prompt = this.buildPrompt(blocks, targetLang, options);
        let lastError = null;

        for (let i = 0; i < this.models.length; i++) {
            const modelName = this.models[(this.currentModelIndex + i) % this.models.length];

            const payload = {
                prompt: prompt,
                model: modelName,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.15
                }
            };

            // 모델별 최대 2회 시도 (과부하 발생 시 1.5초 지수 백오프 후 1회 재시도, 지속 실패 시 다음 모델로 전환)
            for (let attempt = 1; attempt <= 2; attempt++) {
                // 1. 보안 서버리스 프록시 (/api/translate) 우선 호출
                try {
                    const proxyResp = await fetch('/api/translate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (proxyResp.ok) {
                        const data = await proxyResp.json();
                        const contentText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (contentText) {
                            const translations = JSON.parse(contentText);
                            this.currentModelIndex = (this.currentModelIndex + i) % this.models.length;
                            return translations;
                        }
                    } else if (proxyResp.status === 404 && this.apiKey) {
                        console.log('/api/translate 미지원 환경 - 클라이언트 직접 호출로 폴백합니다.');
                    } else {
                        const errJson = await proxyResp.json().catch(() => ({}));
                        const errMsg = (errJson?.error?.message || errJson?.error || JSON.stringify(errJson)).toLowerCase();
                        console.warn(`Proxy attempt with ${modelName} (시도 ${attempt}) returned ${proxyResp.status}:`, errJson);

                        // 1) 404 Not Found (지원 종료된 모델): 재시도 없이 즉시 다음 모델로 전환
                        if (proxyResp.status === 404) {
                            lastError = new Error(`모델 ${modelName} 미지원 (${proxyResp.status})`);
                            break;
                        }

                        // 2) 일일 쿼터 초과 (Quota exceeded / limit: 20 등): 재시도해도 불가하므로 지연 없이 즉시 다음 모델로 전환
                        const isQuotaExceeded = errMsg.includes('quota') || errMsg.includes('exceeded') || errMsg.includes('limit:');
                        if (proxyResp.status === 429 && isQuotaExceeded) {
                            if (typeof options.onStatusUpdate === 'function') {
                                const nextModel = this.models[(this.currentModelIndex + i + 1) % this.models.length];
                                options.onStatusUpdate(`모델 ${modelName} 한도 도달 - 대체 모델(${nextModel})로 즉시 전환 중...`);
                            }
                            lastError = new Error(`모델 ${modelName} 일일 쿼터 한도 초과`);
                            break; // 딜레이 없이 즉시 다음 모델로 전환
                        }

                        // 3) 일시적 과부하 (503 Overloaded, 순간 429 Rate Limit, 500 등): 지수 백오프 대기 후 1회 재시도
                        if (proxyResp.status === 429 || proxyResp.status === 503 || proxyResp.status === 500) {
                            const backoffMs = (proxyResp.status === 429 ? 1200 : 1000) * attempt;
                            if (typeof options.onStatusUpdate === 'function') {
                                options.onStatusUpdate(`모델 ${modelName} 일시적 과부하 (${proxyResp.status}) 감지 - ${Math.round(backoffMs / 100) / 10}초 후 자동 재시도...`);
                            }
                            await this._sleep(backoffMs);

                            if (attempt < 2) {
                                continue; // 동일 모델로 1회 더 재시도
                            } else {
                                lastError = new Error(`모델 ${modelName} 일시적 과부하 (${proxyResp.status})`);
                                break; // 다음 대체 모델로 순환
                            }
                        }
                    }
                } catch (proxyErr) {
                    console.log('Proxy request failed, checking direct client call:', proxyErr);
                }

                // 2. 폴백: 클라이언트에 직접 키가 있는 경우 구글 엔드포인트 직접 호출
                if (this.apiKey) {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;
                    const directPayload = {
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: payload.generationConfig
                    };

                    try {
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(directPayload)
                        });

                        if (response.status === 404) {
                            lastError = new Error(`모델 ${modelName} 미지원 (404)`);
                            break;
                        }

                        if (response.status === 429 || response.status === 503) {
                            const errText = await response.text();
                            console.warn(`Direct model ${modelName} (시도 ${attempt}) returned ${response.status}:`, errText);
                            const errMsg = errText.toLowerCase();

                            // 일일 쿼터 초과 시 즉시 다음 모델로 전환
                            if (response.status === 429 && (errMsg.includes('quota') || errMsg.includes('exceeded') || errMsg.includes('limit:'))) {
                                if (typeof options.onStatusUpdate === 'function') {
                                    const nextModel = this.models[(this.currentModelIndex + i + 1) % this.models.length];
                                    options.onStatusUpdate(`모델 ${modelName} 한도 도달 - 대체 모델(${nextModel})로 즉시 전환 중...`);
                                }
                                lastError = new Error(`모델 ${modelName} 일일 쿼터 한도 초과`);
                                break;
                            }

                            const backoffMs = (response.status === 429 ? 1200 : 1000) * attempt;

                            if (typeof options.onStatusUpdate === 'function') {
                                options.onStatusUpdate(`모델 ${modelName} 일시적 과부하 (${response.status}) 감지 - ${Math.round(backoffMs / 100) / 10}초 후 자동 재시도...`);
                            }
                            await this._sleep(backoffMs);

                            if (attempt < 2) {
                                continue;
                            } else {
                                lastError = new Error(`모델 ${modelName} 응답 실패 (${response.status})`);
                                break;
                            }
                        }

                        if (!response.ok) {
                            const errData = await response.json().catch(() => ({}));
                            const msg = errData?.error?.message || `HTTP ${response.status}`;
                            throw new Error(`Gemini API 오류 (${msg})`);
                        }

                        const data = await response.json();
                        const contentText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!contentText) {
                            throw new Error('Gemini 응답 내용이 비어있습니다.');
                        }

                        const translations = JSON.parse(contentText);
                        this.currentModelIndex = (this.currentModelIndex + i) % this.models.length;
                        return translations;
                    } catch (err) {
                        lastError = err;
                        console.warn(`Direct attempt with ${modelName} failed:`, err);
                    }
                }
            }
        }

        throw lastError || new Error('번역 요청에 실패했습니다. 서버 환경변수 또는 API 키 설정을 확인해주세요.');
    }

    buildPrompt(blocks, targetLang, options = {}) {
        const langName = targetLang === 'ko' ? '한국어 (Korean)' : targetLang;
        const shorten = !!options.shorten;
        const current = options.currentTranslations || {};

        const items = blocks.map(b => {
            const item = {
                id: b.id,
                role: b.role || 'body',
                maxChars: shorten ? (b.maxCharsStrict || b.maxChars) : b.maxChars,
                text: b.text
            };
            if (shorten && current[b.id]) item.currentTranslation = current[b.id];
            return item;
        });

        const shortenRules = shorten ? `
SHORTEN MODE:
- Each item already has a "currentTranslation" that is TOO LONG to fit its original space.
- Rewrite it so that it is at most "maxChars" characters (including spaces).
- Keep all facts, numbers, symbols, citations and technical terms. Use concise academic wording
  (drop redundant words, prefer noun-ending phrases, avoid repeating the subject).
` : '';

        return `You are a world-class academic paper translator specialized in science, engineering, and humanities journals.
Translate each text block from the paper into natural, publication-grade academic ${langName}.

CRITICAL RULES:
1. Maintain formal academic style (학술 논문 격식체: ~한다, ~이다, ~제안한다).
2. NEVER translate or alter:
   - Mathematical equations, symbols, and variables ($x$, $W$, $\\\\theta$, $E=mc^2$).
   - Citation markers ([1], [2-4], Smith et al., 2024).
   - Figure/Table/Equation NUMBERS (keep the number, e.g. Fig. 1 -> 그림 1, Table 2 -> 표 2, Eq. 3 -> 식 (3)).
     Follow Korean academic-society (KCI journal) convention: "Fig./Figure" -> "그림", "Table" -> "표", "Eq./Equation" -> "식".
   - Standard scientific acronyms (CNN, Transformer, DNA, API, etc.).
   - Section numbers at the start of headings (e.g. "2.1 Method" -> "2.1 방법").
3. Each item has a "role": title | heading | body | caption.
   - title/heading: short noun phrase, no sentence ending.
   - caption: Korean society style "그림 1. 설명" / "표 2. 설명" (label + number + period, then translated title).
   - Section labels: "Abstract" -> "초록", "Keywords" -> "주제어", "References" -> "참고문헌", "Introduction" -> "서론", "Conclusion" -> "결론".
4. LENGTH LIMIT: every item has "maxChars". The translation (including spaces) MUST NOT exceed it,
   because the Korean text has to fit into the original layout. Be concise, but never drop facts.
5. Use consistent terminology for the same technical term throughout the document.
6. Input is a JSON array of items. Return ONLY a strict JSON array where each object has:
   [{"id": "...", "translated": "..."}]
${shortenRules}
Input:
${JSON.stringify(items)}`;
    }

    // =========================================================================
    // Small helpers
    // =========================================================================
    static median(arr) {
        if (!arr.length) return 0;
        const a = [...arr].sort((x, y) => x - y);
        const m = a.length >> 1;
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }

    static percentile(arr, p) {
        if (!arr.length) return 0;
        const a = [...arr].sort((x, y) => x - y);
        const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
        return a[idx];
    }

    _getMeasureCtx() {
        if (!this._measureCtx) {
            const c = document.createElement('canvas');
            c.width = 16;
            c.height = 16;
            this._measureCtx = c.getContext('2d');
        }
        return this._measureCtx;
    }

    _isBoldFont(pdfPage, fontName) {
        if (!fontName) return false;
        if (this._fontBoldCache.has(fontName)) return this._fontBoldCache.get(fontName);
        let bold = false;
        try {
            if (pdfPage.commonObjs && pdfPage.commonObjs.has(fontName)) {
                const f = pdfPage.commonObjs.get(fontName);
                bold = !!(f && (f.bold || /bold|black|heavy|semibold|demi/i.test(f.name || '')));
            }
        } catch (e) { /* font object not resolved yet */ }
        this._fontBoldCache.set(fontName, bold);
        return bold;
    }

    // =========================================================================
    // 1. Page structure analysis: figure regions
    // =========================================================================

    /**
     * Detect figure regions (raster images + dense vector graphics) from the PDF operator list.
     * Returns [{x, y, w, h, type, core:{x0,y0,x1,y1}, ext:{x0,y0,x1,y1}}] in viewport coordinates.
     */
    async detectFigureRegions(pdfPage, viewport) {
        const W = viewport.width;
        const H = viewport.height;
        const pageArea = W * H;
        const items = [];
        const MAX_ITEMS = 60000;

        try {
            const opList = await pdfPage.getOperatorList();
            const OPS = pdfjsLib.OPS;
            const U = pdfjsLib.Util;
            const vt = viewport.transform;

            let ctm = [1, 0, 0, 1, 0, 0];
            const stack = [];
            const paintOps = new Set([
                OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill,
                OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke
            ]);
            const imageOps = new Set([
                OPS.paintImageXObject, OPS.paintInlineImageXObject,
                OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject
            ].filter(v => v !== undefined));

            const bboxOf = (pts, m) => {
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                for (const p of pts) {
                    const q = U.applyTransform(p, m);
                    if (q[0] < x0) x0 = q[0];
                    if (q[0] > x1) x1 = q[0];
                    if (q[1] < y0) y0 = q[1];
                    if (q[1] > y1) y1 = q[1];
                }
                return { x0, y0, x1, y1 };
            };

            for (let i = 0; i < opList.fnArray.length && items.length < MAX_ITEMS; i++) {
                const fn = opList.fnArray[i];
                const args = opList.argsArray[i];

                if (fn === OPS.save) {
                    stack.push(ctm.slice());
                } else if (fn === OPS.restore) {
                    if (stack.length) ctm = stack.pop();
                } else if (fn === OPS.transform) {
                    ctm = U.transform(ctm, args);
                } else if (fn === OPS.paintFormXObjectBegin) {
                    stack.push(ctm.slice());
                    if (args && args[0]) ctm = U.transform(ctm, args[0]);
                } else if (fn === OPS.paintFormXObjectEnd) {
                    if (stack.length) ctm = stack.pop();
                } else if (imageOps.has(fn)) {
                    const m = U.transform(vt, ctm);
                    const b = bboxOf([[0, 0], [1, 0], [0, 1], [1, 1]], m);
                    const w = b.x1 - b.x0;
                    const h = b.y1 - b.y0;
                    // Ignore tiny images (icons / glyph bitmaps)
                    if (w >= 30 && h >= 30 && w * h >= pageArea * 0.004) {
                        items.push({ ...b, image: true });
                    }
                } else if (fn === OPS.constructPath) {
                    const next = opList.fnArray[i + 1];
                    if (!paintOps.has(next)) continue; // clip-only / invisible path

                    const pathOps = args[0];
                    const coords = args[1];
                    const pts = [];
                    let ci = 0;
                    for (const op of pathOps) {
                        if (op === OPS.moveTo || op === OPS.lineTo) {
                            pts.push([coords[ci], coords[ci + 1]]);
                            ci += 2;
                        } else if (op === OPS.curveTo) {
                            pts.push([coords[ci], coords[ci + 1]], [coords[ci + 2], coords[ci + 3]], [coords[ci + 4], coords[ci + 5]]);
                            ci += 6;
                        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
                            pts.push([coords[ci], coords[ci + 1]], [coords[ci + 2], coords[ci + 3]]);
                            ci += 4;
                        } else if (op === OPS.rectangle) {
                            pts.push([coords[ci], coords[ci + 1]], [coords[ci] + coords[ci + 2], coords[ci + 1] + coords[ci + 3]]);
                            ci += 4;
                        }
                    }
                    if (!pts.length) continue;
                    const m = U.transform(vt, ctm);
                    const b = bboxOf(pts, m);
                    const w = b.x1 - b.x0;
                    const h = b.y1 - b.y0;
                    // Skip page backgrounds and page-wide rules
                    if (w * h > pageArea * 0.6) continue;
                    if ((w > W * 0.8 && h < 6) || (h > H * 0.8 && w < 6)) continue;
                    items.push({ ...b, image: false });
                }
            }
        } catch (err) {
            console.warn('Figure region detection failed:', err);
            return [];
        }

        if (items.length === 0) return [];

        // Rasterize items on a coarse grid and label connected components
        const cell = 16;
        const gw = Math.ceil(W / cell);
        const gh = Math.ceil(H / cell);
        const occ = new Uint8Array(gw * gh);
        const grow = 12;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        for (const it of items) {
            const cx0 = clamp(Math.floor((it.x0 - grow) / cell), 0, gw - 1);
            const cx1 = clamp(Math.floor((it.x1 + grow) / cell), 0, gw - 1);
            const cy0 = clamp(Math.floor((it.y0 - grow) / cell), 0, gh - 1);
            const cy1 = clamp(Math.floor((it.y1 + grow) / cell), 0, gh - 1);
            for (let cy = cy0; cy <= cy1; cy++) {
                for (let cx = cx0; cx <= cx1; cx++) occ[cy * gw + cx] = 1;
            }
        }

        const comp = new Int32Array(gw * gh);
        let compCount = 0;
        const stack = [];
        for (let s = 0; s < occ.length; s++) {
            if (!occ[s] || comp[s]) continue;
            compCount++;
            comp[s] = compCount;
            stack.push(s);
            while (stack.length) {
                const cur = stack.pop();
                const cx = cur % gw;
                const cy = (cur / gw) | 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
                        const ni = ny * gw + nx;
                        if (occ[ni] && !comp[ni]) {
                            comp[ni] = compCount;
                            stack.push(ni);
                        }
                    }
                }
            }
        }

        const stats = new Map();
        for (const it of items) {
            const ccx = clamp(Math.floor(((it.x0 + it.x1) / 2) / cell), 0, gw - 1);
            const ccy = clamp(Math.floor(((it.y0 + it.y1) / 2) / cell), 0, gh - 1);
            const id = comp[ccy * gw + ccx];
            if (!id) continue;
            let st = stats.get(id);
            if (!st) {
                st = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, count: 0, images: 0 };
                stats.set(id, st);
            }
            st.x0 = Math.min(st.x0, it.x0);
            st.y0 = Math.min(st.y0, it.y0);
            st.x1 = Math.max(st.x1, it.x1);
            st.y1 = Math.max(st.y1, it.y1);
            st.count++;
            if (it.image) st.images++;
        }

        const regions = [];
        for (const st of stats.values()) {
            const x0 = clamp(st.x0, 0, W);
            const y0 = clamp(st.y0, 0, H);
            const x1 = clamp(st.x1, 0, W);
            const y1 = clamp(st.y1, 0, H);
            const bw = x1 - x0;
            const bh = y1 - y0;
            const area = bw * bh;
            if (area > pageArea * 0.85) continue; // scanned page / full-page background

            const isImage = st.images > 0;
            const isVector = !isImage && st.count >= 12 && bw >= 60 && bh >= 40 && area >= pageArea * 0.015;
            if (!isImage && !isVector) continue;

            regions.push({
                x: x0, y: y0, w: bw, h: bh,
                type: isImage ? 'image' : 'vector',
                core: { x0: x0 - 3, y0: y0 - 3, x1: x1 + 3, y1: y1 + 3 },
                ext: { x0: x0 - 24, y0: y0 - 24, x1: x1 + 24, y1: y1 + 24 }
            });
        }
        return regions;
    }

    // =========================================================================
    // 1b. Column gutter detection
    // =========================================================================
    detectGutter(elements, pageWidth) {
        const body = elements.filter(e => e.width < pageWidth * 0.55);
        if (body.length < 20) return null;

        const bin = 2;
        const nb = Math.ceil(pageWidth / bin);
        const cov = new Array(nb).fill(0);
        for (const e of body) {
            const a = Math.max(0, Math.floor(e.x / bin));
            const b = Math.min(nb - 1, Math.floor((e.x + e.width) / bin));
            for (let i = a; i <= b; i++) cov[i]++;
        }

        const tol = Math.max(1, Math.floor(body.length * 0.03));
        const lo = Math.floor((pageWidth * 0.3) / bin);
        const hi = Math.floor((pageWidth * 0.7) / bin);

        let bestStart = -1, bestLen = 0, runStart = -1;
        for (let i = lo; i <= hi + 1; i++) {
            const empty = i <= hi && cov[i] <= tol;
            if (empty && runStart < 0) runStart = i;
            if (!empty && runStart >= 0) {
                const len = i - runStart;
                if (len > bestLen) { bestLen = len; bestStart = runStart; }
                runStart = -1;
            }
        }

        const minW = Math.max(10, pageWidth * 0.012);
        if (bestLen * bin < minW) return null;

        const gx = (bestStart + bestLen / 2) * bin;
        const left = body.filter(e => e.x + e.width / 2 < gx).length;
        const right = body.length - left;
        if (Math.min(left, right) < body.length * 0.2) return null;

        return { x: gx, w: bestLen * bin };
    }

    // =========================================================================
    // 2. Lines and paragraphs
    // =========================================================================
    groupLines(elements, gutter) {
        const sorted = [...elements].sort((a, b) =>
            (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x);
        const lines = [];

        for (const el of sorted) {
            const cy = el.y + el.height / 2;
            let target = null;

            for (let k = lines.length - 1; k >= 0 && k >= lines.length - 60; k--) {
                const L = lines[k];
                const tol = Math.max(4, 0.45 * Math.max(L.height, el.height));
                if (Math.abs(cy - L.cy) > tol) continue;

                const fs = Math.max(L.fontSize, el.fontSize);
                const elRight = el.x >= L.x;
                const gap = elRight ? el.x - L.maxX : L.x - (el.x + el.width);
                if (gap < -fs * 0.6 || gap > Math.max(14, fs * 1.6)) continue;

                if (gutter && gap >= gutter.w * 0.6) {
                    const leftPieceRight = elRight ? L.maxX : el.x + el.width;
                    const rightPieceLeft = elRight ? el.x : L.x;
                    if (leftPieceRight <= gutter.x + 2 && rightPieceLeft >= gutter.x - 2) continue;
                }
                target = L;
                break;
            }

            const len = Math.max(1, el.str.length);
            if (target) {
                target.items.push(el);
                target.x = Math.min(target.x, el.x);
                target.maxX = Math.max(target.maxX, el.x + el.width);
                target.y = Math.min(target.y, el.y);
                target.bottom = Math.max(target.bottom, el.y + el.height);
                target.height = target.bottom - target.y;
                target.cy = (target.y + target.bottom) / 2;
                target.fsSum += el.fontSize * len;
                target.chars += len;
                if (el.bold) target.boldChars += len;
            } else {
                lines.push({
                    items: [el],
                    x: el.x,
                    maxX: el.x + el.width,
                    y: el.y,
                    bottom: el.y + el.height,
                    height: el.height,
                    cy,
                    fsSum: el.fontSize * len,
                    chars: len,
                    boldChars: el.bold ? len : 0
                });
            }
        }

        for (const L of lines) {
            L.items.sort((a, b) => a.x - b.x);
            L.fontSize = L.fsSum / L.chars;
            L.bold = L.boldChars / L.chars >= 0.5;
            L.width = L.maxX - L.x;

            let text = '';
            let prev = null;
            for (const it of L.items) {
                if (prev) {
                    const gap = it.x - (prev.x + prev.width);
                    const needSpace = gap > Math.max(it.fontSize, prev.fontSize) * 0.12 &&
                        !/\s$/.test(text) && !/^\s/.test(it.str);
                    if (needSpace) text += ' ';
                }
                text += it.str;
                prev = it;
            }
            L.text = text.replace(/\s+/g, ' ').trim();
        }
        return lines.filter(L => L.text.length > 0).sort((a, b) => a.cy - b.cy);
    }

    isHeadingLine(line, bodyFont) {
        const t = line.text;
        const len = t.length;
        if (line.fontSize > bodyFont * 1.14 && len < 160) return true;
        if (line.bold && len <= 90 && (
            /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+\S/.test(t) ||
            /^(abstract|introduction|references?|conclusions?|acknowledg|appendix|keywords?|background|methods?|results?|discussion)\b/i.test(t)
        )) return true;
        const letters = t.replace(/[^A-Za-z]/g, '');
        if (letters.length >= 4 && len <= 60 && letters === letters.toUpperCase() && line.fontSize >= bodyFont * 0.95) {
            return true;
        }
        return false;
    }

    isFigureLine(line, figures, bodyFont) {
        for (const f of figures) {
            let core = 0, ext = 0;
            for (const it of line.items) {
                const cx = it.x + it.width / 2;
                const cy = it.y + it.height / 2;
                if (cx >= f.core.x0 && cx <= f.core.x1 && cy >= f.core.y0 && cy <= f.core.y1) core++;
                else if (cx >= f.ext.x0 && cx <= f.ext.x1 && cy >= f.ext.y0 && cy <= f.ext.y1) ext++;
            }
            const n = line.items.length;
            if (core / n >= 0.5) return true;
            // Axis ticks / short labels just outside the graphic, but never captions
            if ((core + ext) / n >= 0.5 &&
                line.text.length <= 30 &&
                !CAPTION_RE.test(line.text) &&
                line.fontSize <= bodyFont * 1.05) {
                return true;
            }
        }
        return false;
    }

    joinLines(lines) {
        let text = '';
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].text;
            if (i === 0) { text = t; continue; }
            if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(t)) {
                text = text.slice(0, -1) + t; // de-hyphenate "trans-" + "lation"
            } else {
                text += ' ' + t;
            }
        }
        return text.replace(/\s+/g, ' ').trim();
    }

    buildBlocks(lines, gutter, bodyFont, viewport, pageNum) {
        const W = viewport.width;

        // Column assignment
        for (const L of lines) {
            if (!gutter) { L.col = 0; continue; }
            const half = gutter.w / 2 + 4;
            if (L.maxX <= gutter.x + half) L.col = 0;
            else if (L.x >= gutter.x - half) L.col = 1;
            else L.col = 'full';
        }

        // Reading order: full-width lines act as separators between column groups
        const ordered = [];
        let left = [], right = [];
        const flush = () => {
            left.sort((a, b) => a.cy - b.cy);
            right.sort((a, b) => a.cy - b.cy);
            ordered.push(...left, ...right);
            left = []; right = [];
        };
        for (const L of lines) {
            if (L.col === 'full') { flush(); ordered.push(L); }
            else if (L.col === 0) left.push(L);
            else right.push(L);
        }
        flush();

        // Column bounds
        const bounds = {};
        for (const col of [0, 1, 'full']) {
            const ls = lines.filter(l => l.col === col);
            if (ls.length) {
                bounds[col] = {
                    left: PdfTranslatorEngine.percentile(ls.map(l => l.x), 10),
                    right: PdfTranslatorEngine.percentile(ls.map(l => l.maxX), 90)
                };
            }
        }

        // Paragraph clustering
        const rawBlocks = [];
        let cur = null;
        for (const line of ordered) {
            const col = line.col;
            const b = bounds[col];
            const lineHeading = this.isHeadingLine(line, bodyFont);
            const cap = CAPTION_RE.test(line.text);
            const lst = LIST_START_RE.test(line.text);

            let join = false;
            if (cur && cur.col === col) {
                const prev = cur.lines[cur.lines.length - 1];
                const pitch = line.cy - prev.cy;
                const fsMax = Math.max(prev.fontSize, line.fontSize);
                const fontClose = Math.abs(line.fontSize - cur.fontSize) <= Math.max(1.2, 0.1 * cur.fontSize);
                const pitchOk = pitch > -1 && pitch <= fsMax * 1.6;

                if (cur.isHeading) {
                    join = lineHeading && fontClose && pitchOk && cur.lines.length < 3 && !cap;
                } else {
                    const colW = b ? b.right - b.left : 0;
                    const prevShort = b && (prev.maxX < b.right - Math.max(0.12 * colW, fsMax * 1.5));
                    const indented = b && (line.x - cur.left) > fsMax * 0.8 && !cur.listStart;
                    join = !lineHeading && !cap && !lst && fontClose && pitchOk && !prevShort && !indented;
                }
            }

            if (join) {
                cur.lines.push(line);
                cur.left = Math.min(cur.left, line.x);
            } else {
                cur = {
                    lines: [line],
                    col,
                    isHeading: lineHeading,
                    listStart: lst,
                    fontSize: line.fontSize,
                    left: line.x
                };
                rawBlocks.push(cur);
            }
        }

        // Finalize geometry
        const blocks = [];
        rawBlocks.forEach((rb, idx) => {
            const L = rb.lines;
            const x = Math.min(...L.map(l => l.x));
            const right = Math.max(...L.map(l => l.maxX));
            const y = Math.min(...L.map(l => l.y));
            const bottom = Math.max(...L.map(l => l.bottom));
            const fontSize = PdfTranslatorEngine.median(L.map(l => l.fontSize));
            const pitches = [];
            for (let i = 1; i < L.length; i++) pitches.push(L[i].cy - L[i - 1].cy);
            let pitch = pitches.length ? PdfTranslatorEngine.median(pitches) : fontSize * 1.3;
            pitch = Math.min(fontSize * 1.8, Math.max(fontSize * 1.1, pitch));

            const b = bounds[rb.col];
            const colW = b ? b.right - b.left : (right - x);
            const cx = (x + right) / 2;
            const colCx = b ? (b.left + b.right) / 2 : W / 2;
            const width = right - x;

            const centered = rb.isHeading &&
                L.every(l => Math.abs((l.x + l.maxX) / 2 - cx) <= Math.max(6, fontSize * 0.5)) &&
                Math.abs(cx - colCx) <= Math.max(10, fontSize) &&
                width < colW * 0.92;

            let layoutWidth = width;
            if (centered) {
                const halfSpan = b ? Math.min(cx - b.left, b.right - cx) : width / 2;
                layoutWidth = Math.max(width, 2 * halfSpan);
            } else if (b) {
                layoutWidth = Math.max(width, b.right - x);
            }

            blocks.push({
                id: `b${pageNum}_${idx}`,
                lines: L,
                text: this.joinLines(L),
                x, y, width,
                right,
                bottom,
                height: bottom - y,
                fontSize,
                pitch,
                col: rb.col,
                isHeading: rb.isHeading,
                bold: L.some(l => l.bold),
                centered,
                cx,
                layoutWidth,
                role: 'body',
                translate: true
            });
        });

        return blocks.filter(b => b.text.length > 0);
    }

    /**
     * Extract text items and cluster into column-aware paragraphs with layout geometry.
     * Returns { blocks, viewport, figures, bodyFont, pageNum }
     */
    async extractPageBlocks(pdfPage, viewport, opts = {}) {
        const pageNum = opts.pageNum || pdfPage.pageNumber || 0;
        const textContent = await pdfPage.getTextContent();
        const items = textContent.items;
        const empty = { blocks: [], viewport, figures: [], bodyFont: 12, pageNum };
        if (!items || items.length === 0) return empty;

        // 1. Convert all items to viewport coordinates
        const elements = [];
        for (const item of items) {
            if (!item.str || item.str.trim() === '') continue;

            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const x = tx[4];
            const y = tx[5]; // Baseline Y in viewport
            const fontSize = Math.hypot(tx[0], tx[1]) || 12;
            const width = item.width * (viewport.scale || 1.0);
            const height = fontSize * 1.15;

            elements.push({
                str: item.str,
                x: Math.round(x),
                y: Math.round(y - height * 0.85), // Top Y in viewport
                width: Math.round(width),
                height: Math.round(height),
                fontSize: Math.round(fontSize * 10) / 10,
                fontName: item.fontName || '',
                bold: this._isBoldFont(pdfPage, item.fontName)
            });
        }
        if (elements.length === 0) return empty;

        // 2. Figure regions
        let figures = await this.detectFigureRegions(pdfPage, viewport);
        figures = figures.filter(f => {
            if (f.type !== 'vector') return true;
            let inside = 0;
            for (const e of elements) {
                const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
                if (cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) inside++;
            }
            // A "vector figure" that swallows most of the page text is a decoration / big table box
            return inside / elements.length <= 0.55;
        });

        const inCore = (e) => figures.some(f => {
            const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
            return cx >= f.core.x0 && cx <= f.core.x1 && cy >= f.core.y0 && cy <= f.core.y1;
        });

        // 3. Column gutter (ignoring figure content)
        const gutter = this.detectGutter(elements.filter(e => !inCore(e)), viewport.width);

        // 4. Lines
        const allLines = this.groupLines(elements, gutter);

        // 5. Body font = most common font size weighted by text length
        const fsHist = new Map();
        for (const L of allLines) {
            if (L.items.every(inCore)) continue;
            const k = Math.round(L.fontSize);
            fsHist.set(k, (fsHist.get(k) || 0) + L.text.length);
        }
        let bodyFont = 12, bestCount = -1;
        for (const [k, v] of fsHist) {
            if (v > bestCount) { bestCount = v; bodyFont = k; }
        }

        // 6. Split figure lines / text lines
        const textLines = [];
        const figureLines = [];
        for (const L of allLines) {
            if (figures.length && this.isFigureLine(L, figures, bodyFont)) figureLines.push(L);
            else textLines.push(L);
        }

        // 7. Blocks
        const blocks = this.buildBlocks(textLines, gutter, bodyFont, viewport, pageNum);

        // Figure text becomes per-line blocks (translated only when the option is enabled)
        figureLines.forEach((L, i) => {
            blocks.push({
                id: `b${pageNum}_f${i}`,
                lines: [L],
                text: L.text,
                x: L.x, y: L.y, width: L.width, right: L.maxX,
                bottom: L.bottom, height: L.height,
                fontSize: L.fontSize,
                pitch: L.fontSize * 1.25,
                col: 'fig',
                isHeading: false,
                bold: L.bold,
                centered: false,
                cx: (L.x + L.maxX) / 2,
                layoutWidth: L.width,
                role: 'figure',
                translate: false
            });
        });

        const pageInfo = { blocks, viewport, figures, bodyFont, pageNum };
        this.classifyBlocks(pageInfo);
        return pageInfo;
    }

    // =========================================================================
    // 3. Role classification
    // =========================================================================
    isReferenceLike(t) {
        if (/^\[\d{1,3}\]\s/.test(t)) return true;
        if (/^\d{1,3}\.\s+[A-Z]/.test(t) && /\b(19|20)\d{2}\b/.test(t)) return true;
        if (t.length < 500 && /^[A-Z][A-Za-z'\-]+,\s+[A-Z]\./.test(t) && /\b(19|20)\d{2}\b/.test(t)) return true;
        return false;
    }

    /**
     * Assign role / translate policy / character budget to each block.
     * Safe to call again right before translation (document state may have changed).
     */
    classifyBlocks(pageInfo) {
        const { blocks, viewport, bodyFont, pageNum } = pageInfo;
        const H = viewport.height;

        // Abstract position on the first page (everything above it that is body text = authors / affiliations)
        let abstractY = null;
        if (pageNum <= 1) {
            for (const b of blocks) {
                if (b.role === 'figure') continue;
                if (/^abstract\b/i.test(b.text) || (b.text.length > 350 && !b.isHeading)) {
                    abstractY = b.y;
                    break;
                }
            }
        }

        // Page-level fallback: a page that is mostly numbered reference entries
        const nonHeading = blocks.filter(b => b.role !== 'figure' && !b.isHeading);
        const refLikeCount = nonHeading.filter(b => this.isReferenceLike(b.text)).length;
        const pageIsRefs = nonHeading.length >= 4 && refLikeCount / nonHeading.length >= 0.5;
        if (pageIsRefs && (this.docState.refStartPage == null || pageNum < this.docState.refStartPage)) {
            this.docState.refStartPage = pageNum;
        }

        let afterRef = pageIsRefs ||
            (this.docState.refStartPage != null && pageNum > this.docState.refStartPage);

        for (const b of blocks) {
            if (b.role === 'figure') {
                b.translate = !!this.options.translateFigureText;
                this.computeBudget(b);
                continue;
            }

            const t = b.text;
            let role = b.isHeading ? 'heading' : (CAPTION_RE.test(t) ? 'caption' : 'body');

            if (b.isHeading && pageNum <= 1 && b.y < H * 0.45 && b.fontSize >= bodyFont * 1.35) {
                role = 'title';
            }

            if (b.isHeading && REF_HEADING_RE.test(t)) {
                if (this.docState.refStartPage == null || pageNum < this.docState.refStartPage) {
                    this.docState.refStartPage = pageNum;
                }
                afterRef = true;
                b.role = 'heading';
                b.translate = true;
                this.computeBudget(b);
                continue;
            }

            const alpha = (t.match(/[A-Za-z\u00C0-\u024F\uAC00-\uD7A3]/g) || []).length;
            const words3 = (t.match(/[A-Za-z]{3,}/g) || []).length;
            const isTiny = t.replace(/[\s\d().,\-–]/g, '').length === 0 || t.length <= 3;
            const nearEdge = (b.y + b.height < H * 0.065) || (b.y > H * 0.94);

            if (role !== 'title' && (isTiny || (nearEdge && t.length <= 120 && !b.isHeading))) {
                role = 'meta'; // page numbers, running headers / footers
            } else if (role !== 'title' && role !== 'heading' && role !== 'caption' &&
                /@|https?:\/\/|doi\.org|\bwww\./i.test(t) && t.length < 220) {
                role = 'meta'; // emails, URLs, DOIs
            } else if (role === 'body' && pageNum <= 1 && abstractY != null && b.y < abstractY - 2 && t.length < 400) {
                role = 'meta'; // authors / affiliations
            } else if (role === 'body' && alpha / Math.max(1, t.length) < 0.4 && words3 < 4) {
                role = 'math'; // equations and symbol soup
            } else if (role === 'body' && (afterRef || this.isReferenceLike(t))) {
                role = 'reference';
            }

            b.role = role;
            b.translate = role === 'title' || role === 'heading' || role === 'body' || role === 'caption' ||
                (role === 'reference' && !!this.options.translateReferences);
            this.computeBudget(b);
        }
    }

    /**
     * Estimate how many Korean characters fit into the original block.
     */
    computeBudget(block) {
        const est = (block.lines.length * block.layoutWidth) / (block.fontSize * 0.9);
        block.maxChars = Math.max(6, Math.floor(est * 1.25));
        block.maxCharsStrict = Math.max(5, Math.floor(est * 1.0));
    }

    // =========================================================================
    // 5. Rendering
    // =========================================================================

    /**
     * Render the original PDF page to a high-res canvas
     */
    async renderOriginalPage(pdfPage, scale) {
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

        // Fill crisp white background first
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await pdfPage.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;

        return { canvas, viewport };
    }

    /** Free vertical space below a block before the next obstacle (block / figure / page end) */
    freeBelow(block, pageInfo) {
        const bottom = block.y + block.height;
        let limit = pageInfo.viewport.height * 0.97;
        const overlapX = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

        for (const o of pageInfo.blocks) {
            if (o === block || o.y < bottom - 2) continue;
            if (overlapX(block.x, block.x + block.layoutWidth, o.x, o.x + o.width) <
                Math.min(block.layoutWidth, o.width) * 0.2) continue;
            limit = Math.min(limit, o.y);
        }
        for (const f of pageInfo.figures || []) {
            if (f.y < bottom - 2) continue;
            if (overlapX(block.x, block.x + block.layoutWidth, f.x, f.x + f.w) <
                Math.min(block.layoutWidth, f.w) * 0.2) continue;
            limit = Math.min(limit, f.y);
        }
        return Math.max(0, limit - bottom - 2);
    }

    overlapsFigure(block, figures) {
        const area = Math.max(1, block.width * block.height);
        for (const f of figures || []) {
            const ix = Math.min(block.x + block.width, f.x + f.w) - Math.max(block.x, f.x);
            const iy = Math.min(block.y + block.height, f.y + f.h) - Math.max(block.y, f.y);
            if (ix > 0 && iy > 0 && (ix * iy) / area > 0.12) return true;
        }
        return false;
    }

    /**
     * Fit Korean text into the block: shrink font gradually, keep original leading ratio.
     */
    fitText(text, block, extraH = 0) {
        const ctx = this._getMeasureCtx();
        const weight = (block.role === 'heading' || block.role === 'title' || block.isHeading) ? '700' : '400';
        const base = block.fontSize;
        const ratio = Math.min(1.45, Math.max(1.15, (block.pitch || base * 1.3) / base));
        const minScale = block.role === 'figure' ? 0.6 : 0.68;
        const maxH = block.height + extraH + 1;
        let last = null;

        for (let scale = 1.0; scale >= minScale - 0.001; scale -= 0.04) {
            const fs = base * scale;
            ctx.font = `${weight} ${fs}px ${this.fontFamily}`;
            const lh = fs * ratio;
            const lines = this.breakTextIntoLines(ctx, text, block.layoutWidth);
            last = { lines, fontSize: fs, lineHeight: lh, weight, scale };
            if (lines.length * lh <= maxH) {
                last.fits = true;
                return last;
            }
        }
        last.fits = false;
        return last;
    }

    /**
     * Decide what happens to one block: 'ok' | 'overflow' | 'figure'
     */
    evaluateBlock(block, text, pageInfo) {
        if (this.overlapsFigure(block, pageInfo.figures) && block.role !== 'figure') {
            return { status: 'figure' };
        }
        const free = this.freeBelow(block, pageInfo);
        const isHead = block.role === 'heading' || block.role === 'title';
        const extraH = block.role === 'figure'
            ? 0
            : Math.min(free * (isHead ? 0.5 : 0.75), block.pitch * (isHead ? 1 : 2.5));
        const fit = this.fitText(text, block, extraH);
        return { status: fit.fits ? 'ok' : 'overflow', fit };
    }

    /** Blocks whose translation does not fit (used for the "shorten" retry loop) */
    findOverflow(pageInfo, translationsMap) {
        const out = [];
        for (const b of pageInfo.blocks) {
            if (!b.translate) continue;
            const text = translationsMap[b.id];
            if (!text) continue;
            const ev = this.evaluateBlock(b, text, pageInfo);
            if (ev.status === 'overflow') out.push({ block: b, text, ev });
        }
        return out;
    }

    sampleBackground(srcCtx, block, cw, ch) {
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const x0 = clamp(Math.floor(block.x) - 4, 0, cw - 1);
        const x1 = clamp(Math.ceil(block.x + block.width) + 4, 1, cw);
        const y0 = clamp(Math.floor(block.y) - 4, 0, ch - 1);
        const y1 = clamp(Math.ceil(block.y + block.height) + 4, 1, ch);
        const strips = [
            [x0, y0, x1 - x0, 2],
            [x0, Math.max(y0, y1 - 2), x1 - x0, 2],
            [x0, y0, 2, y1 - y0],
            [Math.max(x0, x1 - 2), y0, 2, y1 - y0]
        ];

        const rs = [], gs = [], bs = [];
        try {
            for (const [sx, sy, sw, sh] of strips) {
                if (sw <= 0 || sh <= 0) continue;
                const d = srcCtx.getImageData(sx, sy, sw, sh).data;
                const step = Math.max(1, Math.floor(d.length / 4 / 400)) * 4;
                for (let i = 0; i < d.length; i += step) {
                    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
                }
            }
        } catch (e) {
            return { color: '#ffffff', isDark: false };
        }
        if (!rs.length) return { color: '#ffffff', isDark: false };

        const r = Math.round(PdfTranslatorEngine.median(rs));
        const g = Math.round(PdfTranslatorEngine.median(gs));
        const b = Math.round(PdfTranslatorEngine.median(bs));
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return { color: `rgb(${r},${g},${b})`, isDark: lum < 0.45 };
    }

    /** Erase the original text line by line (never the whole bounding box) */
    maskBlock(ctx, block, color) {
        ctx.fillStyle = color;
        const L = block.lines;
        for (let i = 0; i < L.length; i++) {
            const line = L[i];
            const prev = L[i - 1];
            const next = L[i + 1];
            const top = prev ? (prev.bottom + line.y) / 2 : line.y - 2;
            const bottom = next ? (line.bottom + next.y) / 2 : line.bottom + 2;
            const x = Math.max(0, line.x - 3);
            ctx.fillRect(x, top, line.width + 6, Math.max(1, bottom - top));
        }
    }

    drawFitText(ctx, fit, block, isDark) {
        ctx.font = `${fit.weight} ${fit.fontSize}px ${this.fontFamily}`;
        ctx.fillStyle = isDark ? '#f3f4f6' : '#111827';
        ctx.textBaseline = 'top';

        let y = block.y;
        for (const line of fit.lines) {
            let x = block.x;
            if (block.centered) {
                x = block.cx - ctx.measureText(line).width / 2;
            }
            ctx.fillText(line, x, y);
            y += fit.lineHeight;
        }
    }

    /**
     * Composite translated text blocks on top of the original page canvas.
     * Blocks that would overflow or overlap a figure keep their original text.
     * The returned canvas has .layoutWarnings = [{id, reason}]
     */
    renderTranslatedCanvas(originalCanvas, blocks, translationsMap, scale, figures = []) {
        const transCanvas = document.createElement('canvas');
        transCanvas.width = originalCanvas.width;
        transCanvas.height = originalCanvas.height;
        const ctx = transCanvas.getContext('2d', { alpha: false });
        const srcCtx = originalCanvas.getContext('2d');

        // Draw original page (includes all diagrams, equations, tables, plots)
        ctx.drawImage(originalCanvas, 0, 0);

        const pageInfo = {
            blocks,
            figures,
            viewport: { width: originalCanvas.width, height: originalCanvas.height }
        };
        const warnings = [];

        for (const block of blocks) {
            if (!block.translate) continue;
            const transText = translationsMap[block.id];
            if (!transText) continue;

            const ev = this.evaluateBlock(block, transText, pageInfo);
            if (ev.status !== 'ok') {
                warnings.push({ id: block.id, reason: ev.status });
                continue; // keep the original text rather than breaking the layout
            }

            const bg = this.sampleBackground(srcCtx, block, originalCanvas.width, originalCanvas.height);
            this.maskBlock(ctx, block, bg.color);
            this.drawFitText(ctx, ev.fit, block, bg.isDark);
        }

        transCanvas.layoutWarnings = warnings;
        return transCanvas;
    }

    /**
     * Korean / CJK syllable and word break algorithm
     */
    breakTextIntoLines(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width <= maxWidth) {
                currentLine = testLine;
            } else {
                // If a single word itself exceeds maxWidth (common in Korean compound words)
                if (!currentLine) {
                    let subWord = '';
                    for (const char of word) {
                        if (ctx.measureText(subWord + char).width <= maxWidth) {
                            subWord += char;
                        } else {
                            if (subWord) lines.push(subWord);
                            subWord = char;
                        }
                    }
                    currentLine = subWord;
                } else {
                    lines.push(currentLine);
                    currentLine = word;
                    // the new word itself may be too long
                    if (ctx.measureText(currentLine).width > maxWidth) {
                        let subWord = '';
                        for (const char of currentLine) {
                            if (ctx.measureText(subWord + char).width <= maxWidth) {
                                subWord += char;
                            } else {
                                if (subWord) lines.push(subWord);
                                subWord = char;
                            }
                        }
                        currentLine = subWord;
                    }
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    // =========================================================================
    // 7. PDF export
    // =========================================================================

    /**
     * Create downloadable PDF from an array of high-res canvases using jsPDF
     */
    async createPdfFromCanvases(canvases, pdfDoc) {
        if (!canvases || canvases.length === 0) {
            throw new Error('생성할 번역 페이지가 없습니다.');
        }

        const { jsPDF } = window.jspdf;
        let doc = null;

        for (let i = 0; i < canvases.length; i++) {
            const canvas = canvases[i];
            const widthPt = canvas.width / this.scale;
            const heightPt = canvas.height / this.scale;
            const orientation = widthPt > heightPt ? 'l' : 'p';

            if (i === 0) {
                doc = new jsPDF({
                    orientation: orientation,
                    unit: 'pt',
                    format: [widthPt, heightPt]
                });
            } else {
                doc.addPage([widthPt, heightPt], orientation);
            }

            const imgData = canvas.toDataURL('image/jpeg', 0.94);
            doc.addImage(imgData, 'JPEG', 0, 0, widthPt, heightPt, undefined, 'FAST');
        }

        return doc.output('blob');
    }
}

window.PdfTranslatorEngine = PdfTranslatorEngine;
