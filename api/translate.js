// api/translate.js
// Vercel Serverless Function - Gemini Translation Proxy (API Key 은닉)

export default async function handler(req, res) {
    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Vercel 환경 변수에서 GEMINI_API_KEY 로드 (클라이언트 노출 방지)
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                error: 'Vercel 서버 환경변수에 GEMINI_API_KEY가 설정되어 있지 않습니다. Vercel 대시보드(Settings > Environment Variables)를 확인해주세요.'
            });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { prompt, model = 'gemini-2.5-flash', contents, generationConfig } = body;

        if (!prompt && !contents) {
            return res.status(400).json({ error: '요청 본문에 prompt 또는 contents가 누락되었습니다.' });
        }

        const payload = contents ? { contents, generationConfig } : {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: generationConfig || {
                temperature: 0.1,
                topP: 0.95
            }
        };

        // 지원 모델 목록 및 폴백
        const targetModel = model || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${apiKey}`;

        const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await geminiRes.json();

        if (!geminiRes.ok) {
            return res.status(geminiRes.status).json({
                error: data.error?.message || 'Gemini API 호출에 실패했습니다.',
                details: data
            });
        }

        return res.status(200).json(data);
    } catch (err) {
        console.error('Translation proxy error:', err);
        return res.status(500).json({ error: err.message || '서버 내부 오류가 발생했습니다.' });
    }
}
