import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * DocuTrans AI - Standalone Java HTTP Server
 * Uses standard Java SE HttpServer (No external dependencies required).
 * 
 * To compile and run:
 *   javac TranslateServer.java
 *   java TranslateServer
 */
public class TranslateServer {
    private static final int PORT = 8080;
    private static final String ROOT_DIR = System.getProperty("user.dir");

    public static void main(String[] args) throws IOException {
        int port = PORT;
        if (args.length > 0) {
            try {
                port = Integer.parseInt(args[0]);
            } catch (NumberFormatException ignored) {}
        }

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        
        // Static files handler
        server.createContext("/", new StaticFileHandler());
        
        // API Endpoint: /api/key
        server.createContext("/api/key", new ApiKeyHandler());

        // API Endpoint: /api/translate (보안 번역 프록시)
        server.createContext("/api/translate", new TranslateHandler());
        
        // API Endpoint: /api/health
        server.createContext("/api/health", exchange -> {
            byte[] response = "{\"status\":\"ok\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(response);
            }
        });

        server.setExecutor(null); // default executor
        server.start();

        System.out.println("==========================================================");
        System.out.println("  DocuTrans AI - 학술 논문 번역 서버가 시작되었습니다.");
        System.out.println("  로컬 주소: http://localhost:" + port + "/");
        System.out.println("  환경변수(.env) 파일: " + new File(ROOT_DIR, ".env").getAbsolutePath());
        System.out.println("  서버 종료는 Ctrl + C 를 누르세요.");
        System.out.println("==========================================================");
    }

    static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            if (path == null || path.equals("/") || path.isEmpty()) {
                path = "/index.html";
            }

            // Security: Prevent directory traversal
            path = path.replace("..", "");
            File file = new File(ROOT_DIR, path);

            if (!file.exists() || file.isDirectory()) {
                String notFound = "404 Not Found: " + path;
                exchange.sendResponseHeaders(404, notFound.length());
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(notFound.getBytes(StandardCharsets.UTF_8));
                }
                return;
            }

            String mime = getMimeType(file.getName());
            exchange.getResponseHeaders().set("Content-Type", mime);
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");

            long length = file.length();
            exchange.sendResponseHeaders(200, length);

            try (FileInputStream fis = new FileInputStream(file);
                 OutputStream os = exchange.getResponseBody()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = fis.read(buffer)) > 0) {
                    os.write(buffer, 0, count);
                }
            }
        }

        private String getMimeType(String fileName) {
            String lower = fileName.toLowerCase();
            if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=UTF-8";
            if (lower.endsWith(".css")) return "text/css; charset=UTF-8";
            if (lower.endsWith(".js")) return "application/javascript; charset=UTF-8";
            if (lower.endsWith(".json")) return "application/json; charset=UTF-8";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".svg")) return "image/svg+xml";
            if (lower.endsWith(".pdf")) return "application/pdf";
            if (lower.endsWith(".txt") || lower.equals(".env") || lower.endsWith(".env")) return "text/plain; charset=UTF-8";
            return "application/octet-stream";
        }
    }

    static class ApiKeyHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");

            String key = loadApiKey();

            String json = "{\"key\":\"" + escapeJson(key) + "\",\"exists\":" + (!key.isEmpty()) + "}";
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);

            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }

        private String loadApiKey() {
            // 1. OS 환경변수 확인
            String envKey = System.getenv("GEMINI_API_KEY");
            if (envKey != null && !envKey.trim().isEmpty()) {
                return envKey.trim();
            }

            // 2. .env 파일 확인
            Path envPath = Paths.get(ROOT_DIR, ".env");
            if (Files.exists(envPath)) {
                try {
                    for (String line : Files.readAllLines(envPath, StandardCharsets.UTF_8)) {
                        String trimmed = line.trim();
                        if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
                        int eqIdx = trimmed.indexOf('=');
                        if (eqIdx != -1) {
                            String varName = trimmed.substring(0, eqIdx).trim();
                            String varVal = trimmed.substring(eqIdx + 1).trim();
                            // 따옴표 제거 ("..." or '...')
                            if ((varVal.startsWith("\"") && varVal.endsWith("\"")) ||
                                (varVal.startsWith("'") && varVal.endsWith("'"))) {
                                varVal = varVal.substring(1, varVal.length() - 1).trim();
                            }
                            if ("GEMINI_API_KEY".equalsIgnoreCase(varName) || "API_KEY".equalsIgnoreCase(varName)) {
                                if (!varVal.isEmpty()) return varVal;
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            // 3. 하위 호환성: apikey/key.txt 확인
            Path legacyKeyPath = Paths.get(ROOT_DIR, "apikey", "key.txt");
            if (Files.exists(legacyKeyPath)) {
                try {
                    String legacyKey = new String(Files.readAllBytes(legacyKeyPath), StandardCharsets.UTF_8).trim();
                    if (!legacyKey.isEmpty()) return legacyKey;
                } catch (Exception ignored) {}
            }

            return "";
        }

        private String escapeJson(String s) {
            if (s == null) return "";
            return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "").replace("\r", "");
        }
    }

    static class TranslateHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
            exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "POST, OPTIONS");
            exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");

            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(200, -1);
                return;
            }

            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                byte[] err = "{\"error\":\"Method Not Allowed\"}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(405, err.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(err); }
                return;
            }

            ApiKeyHandler keyHandler = new ApiKeyHandler();
            String apiKey = keyHandler.loadApiKey();
            if (apiKey.isEmpty()) {
                byte[] err = "{\"error\":\".env 파일에 GEMINI_API_KEY가 설정되어 있지 않습니다.\"}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(500, err.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(err); }
                return;
            }

            // 요청 바디 읽기
            String reqBody;
            try (InputStream is = exchange.getRequestBody();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                reqBody = sb.toString();
            }

            // 모델 파싱 (기본값 gemini-2.5-flash)
            String model = "gemini-2.5-flash";
            int modelIdx = reqBody.indexOf("\"model\"");
            if (modelIdx != -1) {
                int colonIdx = reqBody.indexOf(':', modelIdx);
                int quote1 = reqBody.indexOf('"', colonIdx);
                if (quote1 != -1) {
                    int quote2 = reqBody.indexOf('"', quote1 + 1);
                    if (quote2 != -1) {
                        model = reqBody.substring(quote1 + 1, quote2);
                    }
                }
            }

            // prompt 파싱 및 Gemini API 요청 바디 구성
            String geminiPayload = reqBody;
            int promptIdx = reqBody.indexOf("\"prompt\"");
            if (promptIdx != -1 && !reqBody.contains("\"contents\"")) {
                int colonIdx = reqBody.indexOf(':', promptIdx);
                int quote1 = reqBody.indexOf('"', colonIdx);
                // JSON 문자열 파싱 (이스케이프 고려)
                int quote2 = -1;
                for (int i = quote1 + 1; i < reqBody.length(); i++) {
                    if (reqBody.charAt(i) == '"' && reqBody.charAt(i - 1) != '\\') {
                        quote2 = i;
                        break;
                    }
                }
                if (quote1 != -1 && quote2 != -1) {
                    String promptText = reqBody.substring(quote1 + 1, quote2);
                    geminiPayload = "{\"contents\":[{\"parts\":[{\"text\":\"" + promptText + "\"}]}],\"generationConfig\":{\"responseMimeType\":\"application/json\",\"temperature\":0.15}}";
                }
            }

            // Gemini API 호출
            try {
                String targetUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + 
                                   URLEncoder.encode(model, "UTF-8") + ":generateContent?key=" + apiKey;
                URL url = new URL(targetUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setDoOutput(true);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(60000);

                byte[] outBytes = geminiPayload.getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(outBytes);
                }

                int statusCode = conn.getResponseCode();
                InputStream stream = (statusCode >= 200 && statusCode < 300) ? conn.getInputStream() : conn.getErrorStream();
                byte[] respBytes;
                if (stream != null) {
                    try (InputStream is = stream) {
                        respBytes = is.readAllBytes();
                    }
                } else {
                    respBytes = "{\"error\":\"Empty response from Gemini\"}".getBytes(StandardCharsets.UTF_8);
                }

                exchange.sendResponseHeaders(statusCode, respBytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(respBytes);
                }
            } catch (Exception ex) {
                byte[] err = ("{\"error\":\"" + keyHandler.escapeJson(ex.getMessage()) + "\"}").getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(500, err.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(err); }
            }
        }
    }
}
