<?php
// AvianVisitors - Gemini artwork helper.
//
// Endpoints:
//   status   - report configured keys, saved eBird region, active job, log tail
//   preview  - list eBird-region species missing bundled illustrations
//   generate - POST: start the existing avian/scripts/pregen.py workflow

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (getenv('AV_REQUIRE_AUTH') === '1' && empty($_SERVER['HTTP_AUTHORIZATION'])) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$BIRDNETPI_DIR = dirname(__DIR__, 2);
$CONF_PATH = "$BIRDNETPI_DIR/birdnet.conf";
$LABELS_PATH = "$BIRDNETPI_DIR/model/labels.txt";
$PREGEN = "$BIRDNETPI_DIR/avian/scripts/pregen.py";
$ILLUSTRATIONS = "$BIRDNETPI_DIR/avian/assets/illustrations";
$JOB_PATH = sys_get_temp_dir() . '/avian-artwork-job.json';
$LOG_PATH = sys_get_temp_dir() . '/avian-artwork-gemini.log';

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

function normalize_ebird_region(string $v): string {
    $v = strtoupper(trim($v));
    if ($v === '') return '';
    if (preg_match('/^[A-Z]{2}$/', $v)) return 'US-' . $v;
    return $v;
}

function slugify_sci(string $sci): string {
    $s = strtolower($sci);
    $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
    return trim($s, '-');
}

function parse_labels(string $path): array {
    if (!is_readable($path)) return [];
    $out = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES) as $line) {
        $line = trim((string)$line);
        if ($line === '' || $line[0] === '#') continue;
        foreach (['|', '_', ','] as $sep) {
            if (strpos($line, $sep) !== false) {
                [$sci, $com] = explode($sep, $line, 2);
                $sci = trim($sci);
                $com = trim($com);
                if ($sci !== '' && $com !== '') $out[$sci] = $com;
                break;
            }
        }
    }
    return $out;
}

function http_json_get(string $url, array $headers, int $timeout = 40): array {
    $lines = [];
    foreach ($headers as $k => $v) $lines[] = $k . ': ' . $v;
    $ctx = stream_context_create(['http' => [
        'method' => 'GET',
        'header' => implode("\r\n", $lines),
        'timeout' => $timeout,
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($url, false, $ctx);
    $status = 0;
    $responseHeaders = function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : ($http_response_header ?? []);
    if (isset($responseHeaders[0]) && preg_match('/\s(\d{3})\s/', $responseHeaders[0], $m)) $status = (int)$m[1];
    $json = json_decode((string)$raw, true);
    if ($raw === false || $status < 200 || $status >= 300 || !is_array($json)) {
        return ['ok' => false, 'status' => $status, 'error' => 'eBird request failed'];
    }
    return ['ok' => true, 'json' => $json];
}

function ebird_species_for_region(string $region, string $key): array {
    $codes = http_json_get('https://api.ebird.org/v2/product/spplist/' . rawurlencode($region), ['X-eBirdApiToken' => $key], 30);
    if (!$codes['ok']) return ['ok' => false, 'error' => $codes['error'], 'status' => $codes['status'] ?? 0];
    $tax = http_json_get('https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json', ['X-eBirdApiToken' => $key], 70);
    if (!$tax['ok']) return ['ok' => false, 'error' => $tax['error'], 'status' => $tax['status'] ?? 0];
    $want = array_flip(array_map('strval', $codes['json']));
    $out = [];
    foreach ($tax['json'] as $row) {
        $code = (string)($row['speciesCode'] ?? '');
        if ($code === '' || !isset($want[$code])) continue;
        $sci = (string)($row['sciName'] ?? '');
        $com = (string)($row['comName'] ?? '');
        if ($sci !== '') $out[$sci] = $com;
    }
    ksort($out);
    return ['ok' => true, 'species' => $out];
}

function configured(): array {
    global $CONF_PATH;
    $conf = read_conf($CONF_PATH);
    return [
        'ebird_key' => trim((string)($conf['EBIRD_API_KEY'] ?? '')),
        'gemini_key' => trim((string)($conf['GEMINI_API_KEY'] ?? '')),
        'region' => normalize_ebird_region((string)($conf['EBIRD_REGION'] ?? '')),
    ];
}

function job_status(): array {
    global $JOB_PATH, $LOG_PATH;
    $job = is_readable($JOB_PATH) ? (json_decode((string)file_get_contents($JOB_PATH), true) ?: []) : [];
    $pid = (int)($job['pid'] ?? 0);
    $running = false;
    if ($pid > 0) {
        $running = function_exists('posix_kill') ? @posix_kill($pid, 0) : is_dir('/proc/' . $pid);
    }
    $tail = '';
    if (is_readable($LOG_PATH)) {
        $lines = file($LOG_PATH, FILE_IGNORE_NEW_LINES) ?: [];
        $tail = implode("\n", array_slice($lines, -80));
    }
    return [
        'running' => $running,
        'job' => $job,
        'log_tail' => $tail,
        'log_path' => $LOG_PATH,
    ];
}

function preview_missing(): array {
    global $LABELS_PATH, $ILLUSTRATIONS;
    $cfg = configured();
    if ($cfg['ebird_key'] === '') return ['ok' => false, 'error' => 'eBird API key is not configured'];
    if ($cfg['region'] === '') return ['ok' => false, 'error' => 'eBird region is not configured'];
    $labels = parse_labels($LABELS_PATH);
    if (!$labels) return ['ok' => false, 'error' => 'labels.txt not found or empty'];
    $region = ebird_species_for_region($cfg['region'], $cfg['ebird_key']);
    if (!$region['ok']) return $region;
    $missing = [];
    $matched = 0;
    foreach ($region['species'] as $sci => $com) {
        if (!isset($labels[$sci])) continue;
        $matched++;
        $slug = slugify_sci($sci);
        $need = [];
        foreach ([1, 2] as $pose) {
            $file = $ILLUSTRATIONS . '/' . $slug . ($pose === 1 ? '' : '-' . $pose) . '.png';
            if (!is_file($file) || filesize($file) < 1024) $need[] = $pose;
        }
        if ($need) $missing[] = ['sci' => $sci, 'com' => $labels[$sci] ?: $com, 'slug' => $slug, 'missing_poses' => $need];
    }
    return [
        'ok' => true,
        'region' => $cfg['region'],
        'region_species' => count($region['species']),
        'matched_labels' => $matched,
        'missing_species' => count($missing),
        'missing_images' => array_sum(array_map(fn($r) => count($r['missing_poses']), $missing)),
        'missing' => array_slice($missing, 0, 80),
        'truncated' => count($missing) > 80,
    ];
}

$action = (string)($_GET['action'] ?? 'status');
$cfg = configured();

if ($action === 'status') {
    json_out([
        'ok' => true,
        'configured' => [
            'ebird_key' => $cfg['ebird_key'] !== '',
            'gemini_key' => $cfg['gemini_key'] !== '',
            'region' => $cfg['region'] !== '',
        ],
        'region' => $cfg['region'],
        'job' => job_status(),
    ]);
}

if ($action === 'preview') {
    json_out(preview_missing(), 200);
}

if ($action === 'generate') {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') json_out(['ok' => false, 'error' => 'POST required'], 405);
    if ($cfg['gemini_key'] === '') json_out(['ok' => false, 'error' => 'Gemini API key is not configured'], 400);
    $preview = preview_missing();
    if (empty($preview['ok'])) json_out($preview, 400);
    if (($preview['missing_images'] ?? 0) <= 0) json_out(['ok' => true, 'started' => false, 'message' => 'No missing illustrations for ' . $cfg['region'], 'preview' => $preview]);
    $status = job_status();
    if (!empty($status['running'])) json_out(['ok' => false, 'error' => 'Artwork generation is already running', 'job' => $status], 409);
    if (!is_file($PREGEN)) json_out(['ok' => false, 'error' => 'pregen.py not found'], 500);
    @file_put_contents($LOG_PATH, '[' . date('c') . "] starting artwork generation for {$cfg['region']}\n");
    $cmd = 'cd ' . escapeshellarg($BIRDNETPI_DIR)
        . ' && nohup python3 ' . escapeshellarg($PREGEN)
        . ' --labels ' . escapeshellarg($LABELS_PATH)
        . ' --ebird-region ' . escapeshellarg($cfg['region'])
        . ' --out ' . escapeshellarg($ILLUSTRATIONS)
        . ' >> ' . escapeshellarg($LOG_PATH) . ' 2>&1 & echo $!';
    $env = [
        'GEMINI_API_KEY' => $cfg['gemini_key'],
        'EBIRD_API_KEY' => $cfg['ebird_key'],
        'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
        'HOME' => dirname($BIRDNETPI_DIR),
    ];
    $desc = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = proc_open($cmd, $desc, $pipes, $BIRDNETPI_DIR, $env);
    if (!is_resource($proc)) json_out(['ok' => false, 'error' => 'failed to start artwork job'], 500);
    $pid = trim((string)stream_get_contents($pipes[1]));
    $err = trim((string)stream_get_contents($pipes[2]));
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    $job = [
        'pid' => (int)$pid,
        'region' => $cfg['region'],
        'started_at' => date('c'),
        'preview' => [
            'missing_species' => $preview['missing_species'],
            'missing_images' => $preview['missing_images'],
        ],
    ];
    @file_put_contents($JOB_PATH, json_encode($job));
    json_out(['ok' => true, 'started' => true, 'pid' => (int)$pid, 'stderr' => $err, 'preview' => $preview, 'job' => job_status()]);
}

json_out(['ok' => false, 'error' => 'unknown action'], 404);
