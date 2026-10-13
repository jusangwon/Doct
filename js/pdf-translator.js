/**
 * PDF Academic Translator Engine (Layout-Preserving)
 * - Semantic Text Block Clustering (Single & Two-Column Support)
 * - Gemini Multilingual Academic Translation with Fallback
 * - Exact-Coordinate Inpainting & CJK Text Reflow
 * - jsPDF Multi-page High-Resolution PDF Builder
 */

class PdfTranslatorEngine {
    constructor(options = {}) {
        this.apiKey = options.apiKey || '';
        this.models = [
            'gemini-3.5-flash',
            'gemini-3.8-flash',
            'gemini-3.1-flash-lite',
            'gemini-3.8-flash-lite',
            'gemini-2.5-flash-lite'
        ];
        this.currentModelIndex = 0;
        this.scale = options.scale || 2.0; // High-DPI for crisp text and formulas
    }

    setApiKey(key) {
        this.apiKey = (key || '').trim();
    }

    /**
     * Call Gemini API (Prioritizes secure /api/translate serverless proxy)
     */
    async callGeminiTranslate(blocks, targetLang = 'ko', options = {}) {
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
                    // 정적 로컬 실행 등 프록시 엔드포인트가 없을 때 직접 호출로 폴백
                    console.log('/api/translate 미지원 환경 - 클라이언트 직접 호출로 폴백합니다.');
                } else {
                    const errJson = await proxyResp.json().catch(() => ({}));
                    console.warn(`Proxy attempt with ${modelName} returned ${proxyResp.status}:`, errJson);
                    // 모델 관련 에러(429, 503 등)일 경우 다음 모델 시도
                    if (proxyResp.status === 429 || proxyResp.status === 503) {
                        lastError = new Error(`모델 ${modelName} 일시적 과부하 (${proxyResp.status})`);
                        continue;
                    }
                }
            } catch (proxyErr) {
                console.log('Proxy request failed, checking direct client call:', proxyErr);
            }

            // 2. 폴백: 클라이언트에 키가 있는 경우 구글 엔드포인트 직접 호출
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

                    if (response.status === 404 || response.status === 503 || response.status === 429) {
                        const errText = await response.text();
                        console.warn(`Model ${modelName} returned ${response.status}, trying fallback...`, errText);
                        lastError = new Error(`모델 ${modelName} 응답 실패 (${response.status})`);
                        continue;
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

        throw lastError || new Error('번역 요청에 실패했습니다. Vercel 환경변수 또는 API 키 설정을 확인해주세요.');
    }

    buildPrompt(blocks, targetLang, options) {
        const langName = targetLang === 'ko' ? '한국어 (Korean)' : targetLang;
        return `You are a world-class academic paper translator specialized in science, engineering, and humanities journals.
Translate each text block from the paper into natural, publication-grade academic ${langName}.

CRITICAL RULES:
1. Maintain formal academic style (학술 논문 격식체: ~한다, ~이다, ~제안한다).
2. NEVER translate or alter:
   - Mathematical equations, symbols, and variables ($x$, $W$, $\\theta$, $E=mc^2$).
   - Citation markers ([1], [2-4], Smith et al., 2024).
   - Figure/Table/Equation references (Fig. 1, Table 2, Eq. 3).
   - Standard scientific acronyms (CNN, Transformer, DNA, API, etc.).
3. Match density and length: Korean text should be concise to fit inside original bounding boxes without layout overflow.
4. Input is a JSON array of blocks with "id" and "text".
5. Return ONLY a strict JSON array where each object has:
   [{"id": "...", "translated": "..."}]

Input:
${JSON.stringify(blocks.map(b => ({ id: b.id, text: b.text })))}`;
    }

    /**
     * Extract text items and cluster into paragraphs & blocks with layout coordinates
     */
    async extractPageBlocks(pdfPage, viewport) {
        const textContent = await pdfPage.getTextContent();
        const items = textContent.items;
        if (!items || items.length === 0) return { blocks: [], viewport };

        // 1. Convert all items to viewport coordinates
        const elements = [];
        for (const item of items) {
            if (!item.str || item.str.trim() === '') continue;

            // Transform matrix: [scaleX, skewY, skewX, scaleY, tx, ty]
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
                fontName: item.fontName || ''
            });
        }

        if (elements.length === 0) return { blocks: [], viewport };

        // 2. Sort by Y coordinate, then X coordinate
        elements.sort((a, b) => {
            if (Math.abs(a.y - b.y) <= 4) {
                return a.x - b.x;
            }
            return a.y - b.y;
        });

        // 3. Line grouping: group items with similar Y and reasonable horizontal gap
        const lines = [];
        let currentLine = null;

        for (const el of elements) {
            if (!currentLine) {
                currentLine = {
                    items: [el],
                    x: el.x,
                    y: el.y,
                    width: el.width,
                    height: el.height,
                    fontSize: el.fontSize,
                    maxX: el.x + el.width
                };
                lines.push(currentLine);
                continue;
            }

            const yDiff = Math.abs(el.y - currentLine.y);
            const xGap = el.x - currentLine.maxX;

            // Same line criteria: vertical diff <= 5px and not overlapping backwards
            if (yDiff <= 5 && xGap >= -10 && xGap <= 40) {
                currentLine.items.push(el);
                currentLine.maxX = Math.max(currentLine.maxX, el.x + el.width);
                currentLine.width = currentLine.maxX - currentLine.x;
                currentLine.height = Math.max(currentLine.height, el.height);
                currentLine.y = Math.min(currentLine.y, el.y);
            } else {
                currentLine = {
                    items: [el],
                    x: el.x,
                    y: el.y,
                    width: el.width,
                    height: el.height,
                    fontSize: el.fontSize,
                    maxX: el.x + el.width
                };
                lines.push(currentLine);
            }
        }

        // 4. Paragraph clustering: group lines within the same column into semantic blocks
        const pageWidth = viewport.width;
        const colThreshold = pageWidth * 0.45; // Column boundary approximation

        const blocks = [];
        let currentBlock = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineText = line.items.map(it => it.str).join(' ').trim();
            if (!lineText) continue;

            const lineRight = line.x + line.width;

            if (!currentBlock) {
                currentBlock = {
                    id: `b_${Date.now()}_${i}`,
                    lines: [line],
                    text: lineText,
                    x: line.x,
                    y: line.y,
                    width: line.width,
                    height: line.height,
                    fontSize: line.fontSize,
                    isHeading: line.fontSize > 15
                };
                blocks.push(currentBlock);
                continue;
            }

            const prevLine = currentBlock.lines[currentBlock.lines.length - 1];
            const vertGap = line.y - (prevLine.y + prevLine.height);
            const leftDiff = Math.abs(line.x - currentBlock.x);
            const fontDiff = Math.abs(line.fontSize - currentBlock.fontSize);

            // Same column check
            const sameColumn = (line.x < colThreshold && currentBlock.x < colThreshold) ||
                               (line.x >= colThreshold && currentBlock.x >= colThreshold) ||
                               (currentBlock.width > pageWidth * 0.6); // Full-width header/abstract

            // Criteria for joining into same paragraph:
            // 1) Same column
            // 2) Vertical gap between lines is within normal line-spacing (e.g. 0 to 14px)
            // 3) Similar font size
            // 4) Not a big heading jump
            const isParagraphContinuation = sameColumn &&
                                           vertGap >= -4 && vertGap <= (prevLine.height * 1.5) &&
                                           fontDiff <= 3 &&
                                           !currentBlock.isHeading &&
                                           line.fontSize <= 15;

            if (isParagraphContinuation) {
                currentBlock.lines.push(line);
                currentBlock.text += ' ' + lineText;
                const minX = Math.min(currentBlock.x, line.x);
                const maxX = Math.max(currentBlock.x + currentBlock.width, lineRight);
                const minY = Math.min(currentBlock.y, line.y);
                const maxY = Math.max(currentBlock.y + currentBlock.height, line.y + line.height);
                currentBlock.x = minX;
                currentBlock.y = minY;
                currentBlock.width = maxX - minX;
                currentBlock.height = maxY - minY;
            } else {
                currentBlock = {
                    id: `b_${Date.now()}_${i}`,
                    lines: [line],
                    text: lineText,
                    x: line.x,
                    y: line.y,
                    width: line.width,
                    height: line.height,
                    fontSize: line.fontSize,
                    isHeading: line.fontSize > 15
                };
                blocks.push(currentBlock);
            }
        }

        // Normalize spaces in text
        for (const block of blocks) {
            block.text = block.text.replace(/\s+/g, ' ').trim();
        }

        // Filter out blocks with empty text or just single symbols
        const validBlocks = blocks.filter(b => b.text.length > 0);
        return { blocks: validBlocks, viewport };
    }

    /**
     * Render the original PDF page to a high-res canvas
     */
    async renderOriginalPage(pdfPage, scale) {
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d', { alpha: false });

        // Fill crisp white background first
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await pdfPage.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;

        return { canvas, viewport };
    }

    /**
     * Composite translated text blocks on top of the original page canvas
     * Preserves layout, backgrounds, math equations, charts, and figures
     */
    renderTranslatedCanvas(originalCanvas, blocks, translationsMap, scale) {
        // Clone original canvas
        const transCanvas = document.createElement('canvas');
        transCanvas.width = originalCanvas.width;
        transCanvas.height = originalCanvas.height;
        const ctx = transCanvas.getContext('2d', { alpha: false });

        // Draw original page (includes all diagrams, equations, tables, plots)
        ctx.drawImage(originalCanvas, 0, 0);

        for (const block of blocks) {
            const transText = translationsMap[block.id];
            if (!transText) continue;

            const pad = 2; // subtle padding around text area
            const bx = Math.max(0, block.x - pad);
            const by = Math.max(0, block.y - pad);
            const bw = Math.min(transCanvas.width - bx, block.width + pad * 2);
            const bh = Math.min(transCanvas.height - by, block.height + pad * 2);

            // 1. Inpaint: Fill background matching paper white
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(bx, by, bw, bh);

            // 2. Reflow Korean text to fit inside original bounding box
            this.drawWrappedText(ctx, transText, {
                x: block.x,
                y: block.y,
                width: block.width,
                height: block.height,
                baseFontSize: block.fontSize,
                isHeading: block.isHeading
            });
        }

        return transCanvas;
    }

    /**
     * Auto-fitting CJK word-wrap text drawer
     */
    drawWrappedText(ctx, text, box) {
        const { x, y, width, height, baseFontSize, isHeading } = box;
        let fontSize = baseFontSize;
        const fontWeight = isHeading ? '700' : '400';
        const fontFamily = "'Noto Sans KR', 'Pretendard', sans-serif";

        // Iterative font size adjustment to fit height constraint
        let lines = [];
        let lineHeight = fontSize * 1.35;
        let attempts = 0;

        while (attempts < 5) {
            ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
            lineHeight = fontSize * 1.35;
            lines = this.breakTextIntoLines(ctx, text, width);
            const totalHeight = lines.length * lineHeight;

            if (totalHeight <= height * 1.15 || fontSize <= baseFontSize * 0.72) {
                break;
            }
            // Scale down font size slightly to fit
            fontSize = Math.max(baseFontSize * 0.72, fontSize * 0.92);
            attempts++;
        }

        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = '#111827'; // Dark charcoal for high contrast academic text
        ctx.textBaseline = 'top';

        let currentY = y + (height - lines.length * lineHeight) * 0.15; // vertical centering adjustment
        currentY = Math.max(y, currentY);

        for (const line of lines) {
            ctx.fillText(line, x, currentY);
            currentY += lineHeight;
        }
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
                    // Break characters
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
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

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
