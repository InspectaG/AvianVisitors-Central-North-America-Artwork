<?php
// AvianVisitors - Birdfy camera integration.
//
// This endpoint keeps Birdfy credentials server-side, probes the Netvue/Birdfy
// API, and exposes locally stored camera sightings for the collage eye badge.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

$BIRDNETPI_DIR = dirname(__DIR__, 2);
$CONF_PATH = "$BIRDNETPI_DIR/birdnet.conf";
$DB_PATH = "$BIRDNETPI_DIR/scripts/birds.db";

function json_out(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function read_conf(string $path): array {
    if (!is_readable($path)) return [];
    $out = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES) as $line) {
        if (!$line || $line[0] === '#') continue;
        if (preg_match('/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i', $line, $m)) {
            $val = trim($m[2]);
            if (strlen($val) >= 2 && $val[0] === '"' && substr($val, -1) === '"') {
                $val = stripcslashes(substr($val, 1, -1));
            }
            $out[$m[1]] = $val;
        }
    }
    return $out;
}

function birdfy_conf(): array {
    global $CONF_PATH;
    $conf = read_conf($CONF_PATH);
    return [
        'enabled' => (int)($conf['BIRDFY_ENABLED'] ?? 0) === 1,
        'email' => trim((string)($conf['BIRDFY_EMAIL'] ?? '')),
        'password' => (string)($conf['BIRDFY_PASSWORD'] ?? ''),
        'window_hours' => max(1, min(168, (int)($conf['BIRDFY_IMPORT_WINDOW_HOURS'] ?? 24))),
        'ucid' => '41f33045b1',
        'udid' => substr(hash('sha256', ($conf['SITE_NAME'] ?? 'avian-visitors') . '|birdfy'), 0, 32),
    ];
}

function db_open(bool $write): SQLite3 {
    global $DB_PATH;
    if (!is_file($DB_PATH)) json_out(['ok' => false, 'error' => 'birds.db not found'], 500);
    $flags = $write ? SQLITE3_OPEN_READWRITE : SQLITE3_OPEN_READONLY;
    try {
        return new SQLite3($DB_PATH, $flags);
    } catch (Throwable $e) {
        json_out(['ok' => false, 'error' => 'database open failed', 'detail' => $e->getMessage()], 500);
    }
}

function ensure_visual_table(SQLite3 $db): void {
    $db->exec("
        CREATE TABLE IF NOT EXISTS visual_detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL DEFAULT 'birdfy',
            external_id TEXT,
            Sci_Name TEXT,
            Com_Name TEXT NOT NULL,
            Confidence REAL,
            Image_URL TEXT,
            Event_Time TEXT NOT NULL,
            Raw_JSON TEXT,
            Created_At TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
    ");
    $db->exec("CREATE UNIQUE INDEX IF NOT EXISTS visual_detections_source_external ON visual_detections(source, external_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS visual_detections_time ON visual_detections(Event_Time DESC)");
    $db->exec("CREATE INDEX IF NOT EXISTS visual_detections_sci ON visual_detections(Sci_Name)");
}

function visual_summary(int $hours): void {
    $conf = birdfy_conf();
    $db = db_open(true);
    ensure_visual_table($db);
    $hours = max(1, min(1000000, $hours));
    $sql = "
        SELECT
            COALESCE(NULLIF(Sci_Name, ''), '') AS sci,
            Com_Name AS com,
            COUNT(*) AS n,
            MAX(Event_Time) AS last_seen,
            MAX(COALESCE(Confidence, 0)) AS best_conf,
            MAX(COALESCE(Image_URL, '')) AS image_url
        FROM visual_detections
        WHERE (:hours >= 1000000)
           OR ((julianday('now','localtime') - julianday(Event_Time)) * 24.0 <= :hours)
        GROUP BY COALESCE(NULLIF(Sci_Name, ''), Com_Name), Com_Name
        ORDER BY last_seen DESC
    ";
    $stmt = $db->prepare($sql);
    $stmt->bindValue(':hours', $hours, SQLITE3_INTEGER);
    $rows = [];
    $res = $stmt->execute();
    while ($r = $res->fetchArray(SQLITE3_ASSOC)) {
        $rows[] = [
            'sci' => (string)$r['sci'],
            'com' => (string)$r['com'],
            'n' => (int)$r['n'],
            'last_seen' => (string)$r['last_seen'],
            'best_conf' => (float)$r['best_conf'],
            'image_url' => (string)$r['image_url'],
        ];
    }
    json_out([
        'ok' => true,
        'configured' => $conf['email'] !== '' && $conf['password'] !== '',
        'enabled' => $conf['enabled'],
        'hours' => $hours,
        'species' => $rows,
        'as_of' => date('c'),
    ]);
}

function http_json(string $method, string $url, array $headers, ?array $body = null): array {
    $headerLines = [];
    foreach ($headers as $k => $v) $headerLines[] = $k . ': ' . $v;
    $opts = [
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headerLines),
            'timeout' => 12,
            'ignore_errors' => true,
        ],
    ];
    if ($body !== null) $opts['http']['content'] = json_encode($body);
    $raw = @file_get_contents($url, false, stream_context_create($opts));
    $status = 0;
    $responseHeaders = function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : ($http_response_header ?? []);
    if (isset($responseHeaders[0]) && preg_match('/\s(\d{3})\s/', $responseHeaders[0], $m)) {
        $status = (int)$m[1];
    }
    $json = json_decode((string)$raw, true);
    return ['status' => $status, 'raw' => (string)$raw, 'json' => is_array($json) ? $json : null];
}

function nvs_signature(string $token, string $ucid, string $udid, string $userId, string $time): string {
    $k1 = hash_hmac('sha256', $ucid, 'nvs1' . $token);
    $k2 = hash_hmac('sha256', $udid, $k1);
    $k3 = hash_hmac('sha256', $userId, $k2);
    $k4 = hash_hmac('sha256', $time, $k3);
    return hash_hmac('sha256', 'nvs1_request', $k4);
}

function birdfy_login(array $conf): array {
    if ($conf['email'] === '' || $conf['password'] === '') {
        return ['ok' => false, 'error' => 'Birdfy credentials are not configured'];
    }
    $headers = [
        'Content-Type' => 'application/json',
        'accept-language' => 'en',
        'x-nvs-version' => '{"signature":2}',
        'x-nvs-ucid' => $conf['ucid'],
        'x-nvs-udid' => $conf['udid'],
    ];
    $body = [
        'username' => $conf['email'],
        'password' => md5($conf['password']),
        'locale' => 'en',
        'platform' => 0,
    ];
    $res = http_json('POST', 'https://localweb.netvue.co/v1/users/login', $headers, $body);
    $j = $res['json'] ?? [];
    if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($j)) {
        return ['ok' => false, 'error' => 'Birdfy login failed', 'status' => $res['status']];
    }
    if ((int)($j['ret'] ?? 0) !== 0) {
        return ['ok' => false, 'error' => (string)($j['msg'] ?? 'Birdfy login failed'), 'ret' => (int)($j['ret'] ?? -1)];
    }
    $data = is_array($j['data'] ?? null) ? $j['data'] : $j;
    $token = (string)($data['token'] ?? $data['accessToken'] ?? '');
    $userId = (string)($data['userId'] ?? $data['id'] ?? '');
    if ($token === '' || $userId === '') {
        return ['ok' => false, 'error' => 'Birdfy login response did not include token/user id'];
    }
    return ['ok' => true, 'token' => $token, 'userId' => $userId, 'raw' => $data];
}

function birdfy_signed_get(string $path, array $conf, array $auth): array {
    $time = (string)time();
    $headers = [
        'Content-Type' => 'application/json',
        'accept-language' => 'en',
        'x-nvs-version' => '{"signature":2}',
        'x-nvs-ucid' => $conf['ucid'],
        'x-nvs-udid' => $conf['udid'],
        'x-nvs-userid' => $auth['userId'],
        'x-nvs-time' => $time,
        'x-nvs-signature' => nvs_signature($auth['token'], $conf['ucid'], $conf['udid'], $auth['userId'], $time),
    ];
    return http_json('GET', 'https://localweb.netvue.co/v1/' . ltrim($path, '/'), $headers);
}

function birdfy_probe(): void {
    $conf = birdfy_conf();
    $login = birdfy_login($conf);
    if (!$login['ok']) json_out(['ok' => false, 'configured' => $conf['email'] !== '' && $conf['password'] !== '', 'error' => $login['error'], 'detail' => $login], 200);
    $devices = birdfy_signed_get('devices/v3', $conf, $login);
    $j = $devices['json'] ?? [];
    json_out([
        'ok' => true,
        'configured' => true,
        'enabled' => $conf['enabled'],
        'devices_status' => $devices['status'],
        'devices' => is_array($j['data'] ?? null) ? $j['data'] : $j,
    ]);
}

function birdfy_status(): void {
    $conf = birdfy_conf();
    $db = db_open(true);
    ensure_visual_table($db);
    $count = (int)$db->querySingle("SELECT COUNT(*) FROM visual_detections");
    $last = (string)$db->querySingle("SELECT MAX(Event_Time) FROM visual_detections");
    json_out([
        'ok' => true,
        'configured' => $conf['email'] !== '' && $conf['password'] !== '',
        'enabled' => $conf['enabled'],
        'window_hours' => $conf['window_hours'],
        'local_count' => $count,
        'last_seen' => $last ?: null,
        'event_import_supported' => false,
        'message' => 'Birdfy settings and local visual detections are ready. Remote event import is pending until the Birdfy event API is identified.',
    ]);
}

function birdfy_sync(): void {
    $conf = birdfy_conf();
    $db = db_open(true);
    ensure_visual_table($db);
    if (!$conf['enabled']) {
        json_out(['ok' => false, 'configured' => $conf['email'] !== '' && $conf['password'] !== '', 'enabled' => false, 'error' => 'Birdfy import is disabled in Settings']);
    }
    $login = birdfy_login($conf);
    if (!$login['ok']) json_out(['ok' => false, 'configured' => $conf['email'] !== '' && $conf['password'] !== '', 'enabled' => true, 'error' => $login['error'], 'detail' => $login]);
    $devices = birdfy_signed_get('devices/v3', $conf, $login);
    json_out([
        'ok' => true,
        'configured' => true,
        'enabled' => true,
        'imported' => 0,
        'devices_status' => $devices['status'],
        'event_import_supported' => false,
        'message' => 'Logged in and probed devices. Birdfy web Events is still a coming-soon stub, so event import will be enabled after the event endpoint is identified.',
    ]);
}

$action = $_GET['action'] ?? 'visual_summary';
if ($action === 'visual_summary') visual_summary((int)($_GET['hours'] ?? 24));
if ($action === 'status') birdfy_status();
if ($action === 'probe') birdfy_probe();
if ($action === 'sync') birdfy_sync();

json_out(['ok' => false, 'error' => 'unknown action'], 400);
