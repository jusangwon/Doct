// server.js
// DocuTrans AI - Standalone Production Node.js Web Server (Zero-dependency for Render)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

// MIME 타입 매핑
const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=UTF-8'
};

// .env 로컬 파싱 (로컬 실행 대비)
function loadLocalEnv() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx !== -1) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    let val = trimmed.slice(eqIdx + 1).trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            }
        }
    } catch (e) {}
}
loadLocalEnv();

const server = http.createServer(async (req, res) => {
    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;

    // 1. Health check 엔드포인트
    if (pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // 2. 보안 번역 프록시 엔드포인트 (/api/translate)
    if (pathname === '/api/translate') {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: '서버에 GEMINI_API_KEY가 설정되어 있지 않습니다. Render 대시보드의 Environment Variables를 확인해주세요.'
            }));
            return;
        }

        let bodyData = '';
        req.on('data', chunk => { bodyData += chunk; });
        req.on('end', async () => {
            try {
                const parsed = JSON.parse(bodyData || '{}');
                const { prompt, model = 'gemini-2.5-flash', contents, generationConfig } = parsed;

                if (!prompt && !contents) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '요청 본문에 prompt가 누락되었습니다.' }));
                    return;
                }

                const payload = contents ? { contents, generationConfig } : {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: generationConfig || {
                        responseMimeType: "application/json",
                        temperature: 0.15
                    }
                };

                const targetModel = model || 'gemini-2.5-flash';
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${apiKey}`;

                const geminiRes = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await geminiRes.json();
                res.writeHead(geminiRes.status, { 'Content-Type': 'application/json; charset=UTF-8' });
                res.end(JSON.stringify(data));
            } catch (err) {
                console.error('Translation error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
                res.end(JSON.stringify({ error: err.message || '번역 처리 중 오류가 발생했습니다.' }));
            }
        });
        return;
    }

    // 3. 정적 파일 서빙
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(__dirname, filePath);

    fs.stat(absolutePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(absolutePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(absolutePath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`==========================================================`);
    console.log(`  DocuTrans AI (Doct) 서버가 시작되었습니다.`);
    console.log(`  포트: ${PORT}`);
    console.log(`  GEMINI_API_KEY 상태: ${process.env.GEMINI_API_KEY ? '정상 로드됨' : '미설정'}`);
    console.log(`==========================================================`);
});
