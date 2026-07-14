<?php
// AvianVisitors - artwork helper.
//
// Endpoints:
//   status   - report configured keys, saved eBird region, active job, log tail
//   preview  - list eBird-region species missing bundled illustrations
//   sample   - POST: generate one isolated sample image for the active style
//   generate - POST: start the avian/scripts/pregen.py workflow

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
$DB_PATH = "$BIRDNETPI_DIR/scripts/birds.db";
$PREGEN = "$BIRDNETPI_DIR/avian/scripts/pregen.py";
$ASSET_DIR = "$BIRDNETPI_DIR/avian/assets";
$SAMPLE_DIR = "$ASSET_DIR/artwork-previews";
$JOB_PATH = sys_get_temp_dir() . '/avian-artwork-job.json';
$LOG_PATH = sys_get_temp_dir() . '/avian-artwork.log';
$PROGRESS_PATH = sys_get_temp_dir() . '/avian-artwork-progress.json';

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

function art_styles(): array {
    return [
        'gemini' => ['provider' => 'gemini', 'style' => '', 'dir' => 'illustrations', 'label' => 'classic Gemini'],
        'openai-watercolor' => ['provider' => 'openai', 'style' => 'watercolor', 'dir' => 'illustrations-openai-watercolor', 'label' => 'OpenAI watercolor'],
        'openai-ink' => ['provider' => 'openai', 'style' => 'ink', 'dir' => 'illustrations-openai-ink', 'label' => 'OpenAI ink'],
        'openai-paper-cut' => ['provider' => 'openai', 'style' => 'paper-cut', 'dir' => 'illustrations-openai-paper-cut', 'label' => 'OpenAI paper cut'],
        'openai-poster' => ['provider' => 'openai', 'style' => 'poster', 'dir' => 'illustrations-openai-poster', 'label' => 'OpenAI poster'],
        'openai-vintage' => ['provider' => 'openai', 'style' => 'vintage', 'dir' => 'illustrations-openai-vintage', 'label' => 'OpenAI vintage'],
        'openai-gouache' => ['provider' => 'openai', 'style' => 'gouache', 'dir' => 'illustrations-openai-gouache', 'label' => 'OpenAI gouache'],
        'openai-minimal' => ['provider' => 'openai', 'style' => 'minimal', 'dir' => 'illustrations-openai-minimal', 'label' => 'OpenAI minimal'],
    ];
}

function custom_art_styles(string $json): array {
    $rows = json_decode($json === '' ? '[]' : $json, true);
    if (!is_array($rows)) return [];
    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) continue;
        $id = strtolower(trim((string)($row['id'] ?? '')));
        $label = trim((string)($row['label'] ?? ''));
        $prompt = trim((string)($row['prompt'] ?? ''));
        if (!preg_match('/^openai-custom-[a-z0-9-]{1,48}$/', $id) || $prompt === '') continue;
        if ($label === '') $label = 'custom';
        $out[$id] = [
            'provider' => 'openai',
            'style' => 'custom',
            'dir' => 'illustrations-' . $id,
            'label' => 'OpenAI ' . $label,
            'custom_prompt' => $prompt,
        ];
    }
    return $out;
}

function daily_art_style(): string {
    $rotation = ['openai-watercolor', 'openai-ink', 'openai-paper-cut', 'openai-poster', 'openai-vintage', 'openai-gouache', 'openai-minimal'];
    return $rotation[(int)date('w') % count($rotation)];
}

function active_art_style(array $conf): array {
    $custom = custom_art_styles((string)($conf['AV_ART_CUSTOM_STYLES'] ?? '[]'));
    $styles = art_styles() + $custom;
    $key = strtolower(trim((string)($conf['AV_ART_STYLE'] ?? 'gemini')));
    if ($key === 'daily') $key = daily_art_style();
    if (!isset($styles[$key])) $key = 'gemini';
    $style = $styles[$key];
    $style['key'] = $key;
    return $style;
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

function detected_species(int $limit = 0): array {
    global $DB_PATH;
    if (!is_readable($DB_PATH) || !class_exists('SQLite3')) return [];
    try {
        $db = new SQLite3($DB_PATH, SQLITE3_OPEN_READONLY);
        $db->busyTimeout(2000);
        $sql = "SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS n, MAX(Date||' '||Time) AS last_seen "
            . "FROM detections GROUP BY Sci_Name ORDER BY n DESC, last_seen DESC";
        if ($limit > 0) $sql .= " LIMIT " . max(1, min(1000, $limit));
        $res = $db->query($sql);
        $out = [];
        while ($res && ($r = $res->fetchArray(SQLITE3_ASSOC))) {
            $sci = trim((string)($r['sci'] ?? ''));
            $com = trim((string)($r['com'] ?? ''));
            if ($sci !== '') $out[$sci] = $com ?: $sci;
        }
        return $out;
    } catch (Throwable $e) {
        return [];
    }
}

function artwork_scope(): string {
    $scope = strtolower(trim((string)($_GET['scope'] ?? $_POST['scope'] ?? 'detected')));
    return in_array($scope, ['detected', 'top25', 'top100', 'regional'], true) ? $scope : 'detected';
}

function artwork_poses(): array {
    $poses = strtolower(trim((string)($_GET['poses'] ?? $_POST['poses'] ?? 'perched')));
    return $poses === 'both' ? [1, 2] : [1];
}

function scope_label(string $scope): string {
    return [
        'detected' => 'detected birds',
        'top25' => 'top 25 detected',
        'top100' => 'top 100 detected',
        'regional' => 'all regional birds',
    ][$scope] ?? 'detected birds';
}

function species_for_scope(string $scope, array $cfg, array $labels): array {
    if ($scope === 'detected') return detected_species(0);
    if ($scope === 'top25') return detected_species(25);
    if ($scope === 'top100') return detected_species(100);

    if ($cfg['ebird_key'] === '') return [];
    if ($cfg['region'] === '') return [];
    $region = ebird_species_for_region($cfg['region'], $cfg['ebird_key']);
    if (empty($region['ok'])) return [];
    $out = [];
    foreach ($region['species'] as $sci => $com) {
        if (isset($labels[$sci])) $out[$sci] = $labels[$sci] ?: $com;
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
    $style = active_art_style($conf);
    return [
        'ebird_key' => trim((string)($conf['EBIRD_API_KEY'] ?? '')),
        'gemini_key' => trim((string)($conf['GEMINI_API_KEY'] ?? '')),
        'openai_key' => trim((string)($conf['OPENAI_API_KEY'] ?? '')),
        'region' => normalize_ebird_region((string)($conf['EBIRD_REGION'] ?? '')),
        'art_style' => $style,
        'art_style_configured' => strtolower(trim((string)($conf['AV_ART_STYLE'] ?? 'gemini'))),
        'art_custom_styles' => custom_art_styles((string)($conf['AV_ART_CUSTOM_STYLES'] ?? '[]')),
    ];
}

function artwork_theme_catalog(): array {
    global $ASSET_DIR;
    $cfg = configured();
    $styles = art_styles() + $cfg['art_custom_styles'];
    $detected = detected_species();
    $themes = [];
    foreach ($styles as $key => $style) {
        $dir = $ASSET_DIR . '/' . $style['dir'];
        $files = is_dir($dir) ? (glob($dir . '/*.png') ?: []) : [];
        if (!$files) continue;
        $coverage = 0;
        foreach ($detected as $sci => $_com) {
            $path = $dir . '/' . slugify_sci($sci) . '.png';
            if (is_file($path) && filesize($path) >= 1024) $coverage++;
        }
        $themes[] = [
            'key' => $key,
            'label' => $style['label'],
            'loaded_images' => count($files),
            'detected_coverage' => $coverage,
        ];
    }
    usort($themes, static function (array $a, array $b): int {
        if ($a['key'] === 'gemini') return -1;
        if ($b['key'] === 'gemini') return 1;
        return strcasecmp($a['label'], $b['label']);
    });
    return ['ok' => true, 'themes' => $themes];
}

function job_status(): array {
    global $JOB_PATH, $LOG_PATH, $PROGRESS_PATH;
    $job = is_readable($JOB_PATH) ? (json_decode((string)file_get_contents($JOB_PATH), true) ?: []) : [];
    $pid = (int)($job['pid'] ?? 0);
    $running = false;
    if ($pid > 0) {
        $running = function_exists('posix_kill') ? @posix_kill($pid, 0) : is_dir('/proc/' . $pid);
    }
    $progress = is_readable($PROGRESS_PATH) ? (json_decode((string)file_get_contents($PROGRESS_PATH), true) ?: []) : [];
    if ($progress) {
        $updatedRaw = (string)($progress['updated_at'] ?? '');
        $updatedTs = $updatedRaw ? strtotime($updatedRaw) : 0;
        $age = $updatedTs ? max(0, time() - $updatedTs) : null;
        $progress['age_seconds'] = $age;
        if ($running && $age !== null && $age > 300) {
            $progress['state'] = 'stalled';
            $progress['state_label'] = 'possibly stuck';
        } elseif ($running) {
            $progress['state'] = 'running';
            $progress['state_label'] = 'working';
        } else {
            $status = (string)($progress['status'] ?? '');
            $progress['state'] = $status === 'error' ? 'error' : ($status === 'done' ? 'done' : 'idle');
            $progress['state_label'] = $status === 'error' ? 'error' : ($status === 'done' ? 'done' : 'idle');
        }
        $total = max(0, (int)($progress['total'] ?? 0));
        $current = max(0, (int)($progress['current'] ?? 0));
        $progress['percent'] = $total > 0 ? min(100, round(($current / $total) * 100, 1)) : 0;
    }
    $tail = '';
    if (is_readable($LOG_PATH)) {
        $lines = file($LOG_PATH, FILE_IGNORE_NEW_LINES) ?: [];
        $tail = implode("\n", array_slice($lines, -80));
    }
    if (!$running && !$progress && $tail && preg_match('/(?:Traceback|PermissionError|HTTPError|URLError|RuntimeError|error:)/i', $tail)) {
        $progress = [
            'status' => 'error',
            'state' => 'error',
            'state_label' => 'error',
            'total' => (int)($job['preview']['missing_images'] ?? 0),
            'current' => 0,
            'generated' => 0,
            'skipped' => 0,
            'failed' => 1,
            'percent' => 0,
            'message' => 'generator exited with an error; see log below',
        ];
    }
    return [
        'running' => $running,
        'job' => $job,
        'progress' => $progress,
        'log_tail' => $tail,
        'log_path' => $LOG_PATH,
        'progress_path' => $PROGRESS_PATH,
    ];
}

function preview_missing(?string $scope = null, ?array $poses = null, bool $limitRows = true): array {
    global $LABELS_PATH, $ASSET_DIR;
    $cfg = configured();
    $scope = $scope ?: artwork_scope();
    $poses = $poses ?: artwork_poses();
    $labels = parse_labels($LABELS_PATH);
    if (!$labels) return ['ok' => false, 'error' => 'labels.txt not found or empty'];
    if ($scope === 'regional' && $cfg['ebird_key'] === '') return ['ok' => false, 'error' => 'eBird API key is not configured'];
    if ($scope === 'regional' && $cfg['region'] === '') return ['ok' => false, 'error' => 'eBird region is not configured'];
    $species = species_for_scope($scope, $cfg, $labels);
    if (!$species && $scope !== 'regional') return ['ok' => false, 'error' => 'No detected birds found yet'];
    $missing = [];
    $matched = 0;
    foreach ($species as $sci => $com) {
        if (!isset($labels[$sci]) && $scope === 'regional') continue;
        $matched++;
        $slug = slugify_sci($sci);
        $need = [];
        foreach ($poses as $pose) {
            $file = $ASSET_DIR . '/' . $cfg['art_style']['dir'] . '/' . $slug . ($pose === 1 ? '' : '-' . $pose) . '.png';
            if (!is_file($file) || filesize($file) < 1024) $need[] = $pose;
        }
        if ($need) $missing[] = ['sci' => $sci, 'com' => $labels[$sci] ?: $com, 'slug' => $slug, 'missing_poses' => $need];
    }
    return [
        'ok' => true,
        'region' => $cfg['region'],
        'art_style' => $cfg['art_style']['key'],
        'art_style_label' => $cfg['art_style']['label'],
        'provider' => $cfg['art_style']['provider'],
        'custom_style_configured' => !empty($cfg['art_style']['custom_prompt']),
        'scope' => $scope,
        'scope_label' => scope_label($scope),
        'poses' => $poses,
        'pose_label' => count($poses) === 1 ? 'perched only' : 'perched + flight',
        'region_species' => count($species),
        'matched_labels' => $matched,
        'missing_species' => count($missing),
        'missing_images' => array_sum(array_map(fn($r) => count($r['missing_poses']), $missing)),
        'missing' => $limitRows ? array_slice($missing, 0, 80) : $missing,
        'truncated' => $limitRows && count($missing) > 80,
    ];
}

function first_sample_species(array $preview): array {
    global $LABELS_PATH;
    $missing = $preview['missing'] ?? [];
    if (is_array($missing) && isset($missing[0]) && is_array($missing[0])) {
        return [
            'sci' => (string)($missing[0]['sci'] ?? ''),
            'com' => (string)($missing[0]['com'] ?? ''),
        ];
    }
    $labels = parse_labels($LABELS_PATH);
    foreach ($labels as $sci => $com) return ['sci' => $sci, 'com' => $com];
    return ['sci' => 'Cardinalis cardinalis', 'com' => 'Northern Cardinal'];
}

$action = (string)($_GET['action'] ?? 'status');
$cfg = configured();

if ($action === 'themes') {
    json_out(artwork_theme_catalog());
}

if ($action === 'status') {
    json_out([
        'ok' => true,
        'configured' => [
            'ebird_key' => $cfg['ebird_key'] !== '',
            'gemini_key' => $cfg['gemini_key'] !== '',
            'openai_key' => $cfg['openai_key'] !== '',
            'region' => $cfg['region'] !== '',
        ],
        'region' => $cfg['region'],
        'art_style' => $cfg['art_style']['key'],
        'art_style_label' => $cfg['art_style']['label'],
        'provider' => $cfg['art_style']['provider'],
        'custom_style_configured' => !empty($cfg['art_style']['custom_prompt']),
        'style_setting' => $cfg['art_style_configured'],
        'job' => job_status(),
    ]);
}

if ($action === 'preview') {
    json_out(preview_missing(), 200);
}

if ($action === 'sample') {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') json_out(['ok' => false, 'error' => 'POST required'], 405);
    if ($cfg['art_style']['provider'] === 'gemini' && $cfg['gemini_key'] === '') json_out(['ok' => false, 'error' => 'Gemini API key is not configured'], 400);
    if ($cfg['art_style']['provider'] === 'openai' && $cfg['openai_key'] === '') json_out(['ok' => false, 'error' => 'OpenAI API key is not configured'], 400);
    if ($cfg['art_style']['style'] === 'custom' && empty($cfg['art_style']['custom_prompt'])) json_out(['ok' => false, 'error' => 'Custom OpenAI art style is not configured'], 400);
    $preview = preview_missing();
    if (empty($preview['ok'])) json_out($preview, 400);
    $sp = first_sample_species($preview);
    if ($sp['sci'] === '') json_out(['ok' => false, 'error' => 'No sample species available'], 500);
    $sampleDir = $SAMPLE_DIR . '/' . $cfg['art_style']['key'];
    if (!is_dir($sampleDir) && !@mkdir($sampleDir, 0775, true)) {
        json_out(['ok' => false, 'error' => 'Cannot create sample artwork folder: ' . $sampleDir], 500);
    }
    if (!is_writable($sampleDir)) json_out(['ok' => false, 'error' => 'Sample artwork folder is not writable: ' . $sampleDir], 500);
    $slug = slugify_sci($sp['sci']);
    $samplePath = $sampleDir . '/' . $slug . '.png';
    $cmd = 'cd ' . escapeshellarg($BIRDNETPI_DIR)
        . ' && python3 ' . escapeshellarg($PREGEN)
        . ' --provider ' . escapeshellarg($cfg['art_style']['provider'])
        . ' --species ' . escapeshellarg($sp['sci'] . '|' . ($sp['com'] ?: $sp['sci']))
        . ' --poses 1'
        . ' --force'
        . ' --sleep 0'
        . ' --out ' . escapeshellarg($sampleDir)
        . ($cfg['art_style']['provider'] === 'openai' ? ' --style ' . escapeshellarg($cfg['art_style']['style']) : '')
        . ($cfg['art_style']['style'] === 'custom' ? ' --custom-style ' . escapeshellarg((string)$cfg['art_style']['custom_prompt']) : '');
    $env = [
        'GEMINI_API_KEY' => $cfg['gemini_key'],
        'OPENAI_API_KEY' => $cfg['openai_key'],
        'EBIRD_API_KEY' => $cfg['ebird_key'],
        'PATH' => getenv('PATH') ?: '/usr/local/bin:/usr/bin:/bin',
        'HOME' => dirname($BIRDNETPI_DIR),
    ];
    $desc = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = proc_open($cmd, $desc, $pipes, $BIRDNETPI_DIR, $env);
    if (!is_resource($proc)) json_out(['ok' => false, 'error' => 'failed to start sample generator'], 500);
    $stdout = trim((string)stream_get_contents($pipes[1]));
    $stderr = trim((string)stream_get_contents($pipes[2]));
    fclose($pipes[1]);
    fclose($pipes[2]);
    $rc = proc_close($proc);
    if ($rc !== 0 || !is_file($samplePath) || filesize($samplePath) < 1024) {
        json_out(['ok' => false, 'error' => 'sample generation failed', 'stdout' => $stdout, 'stderr' => $stderr], 500);
    }
    json_out([
        'ok' => true,
        'sample' => [
            'sci' => $sp['sci'],
            'com' => $sp['com'],
            'art_style' => $cfg['art_style']['key'],
            'art_style_label' => $cfg['art_style']['label'],
            'provider' => $cfg['art_style']['provider'],
            'image_data' => 'data:image/png;base64,' . base64_encode((string)file_get_contents($samplePath)),
            'bytes' => filesize($samplePath),
        ],
    ]);
}

if ($action === 'generate') {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') json_out(['ok' => false, 'error' => 'POST required'], 405);
    if ($cfg['art_style']['provider'] === 'gemini' && $cfg['gemini_key'] === '') json_out(['ok' => false, 'error' => 'Gemini API key is not configured'], 400);
    if ($cfg['art_style']['provider'] === 'openai' && $cfg['openai_key'] === '') json_out(['ok' => false, 'error' => 'OpenAI API key is not configured'], 400);
    if ($cfg['art_style']['style'] === 'custom' && empty($cfg['art_style']['custom_prompt'])) json_out(['ok' => false, 'error' => 'Custom OpenAI art style is not configured'], 400);
    $scope = artwork_scope();
    $poses = artwork_poses();
    $preview = preview_missing($scope, $poses, false);
    if (empty($preview['ok'])) json_out($preview, 400);
    if (($preview['missing_images'] ?? 0) <= 0) json_out(['ok' => true, 'started' => false, 'message' => 'No missing illustrations for ' . $preview['scope_label'] . ' / ' . $preview['pose_label'], 'preview' => $preview]);
    $status = job_status();
    if (!empty($status['running'])) json_out(['ok' => false, 'error' => 'Artwork generation is already running', 'job' => $status], 409);
    if (!is_file($PREGEN)) json_out(['ok' => false, 'error' => 'pregen.py not found'], 500);
    $outDir = $ASSET_DIR . '/' . $cfg['art_style']['dir'];
    if (!is_dir($outDir) && !@mkdir($outDir, 0775, true)) {
        json_out(['ok' => false, 'error' => 'Cannot create artwork folder: ' . $outDir . ' (check permissions on avian/assets)'], 500);
    }
    if (!is_writable($outDir)) {
        json_out(['ok' => false, 'error' => 'Artwork folder is not writable: ' . $outDir], 500);
    }
    $speciesFile = sys_get_temp_dir() . '/avian-artwork-species-' . getmypid() . '-' . time() . '.txt';
    $lines = [];
    foreach (($preview['missing'] ?? []) as $row) {
        if (!is_array($row)) continue;
        $sci = trim((string)($row['sci'] ?? ''));
        $com = trim((string)($row['com'] ?? ''));
        if ($sci !== '') $lines[$sci] = $sci . '|' . ($com ?: $sci);
    }
    if (!$lines || @file_put_contents($speciesFile, implode("\n", array_values($lines)) . "\n") === false) {
        json_out(['ok' => false, 'error' => 'Could not prepare the selected species list for artwork generation'], 500);
    }
    @file_put_contents($LOG_PATH, '[' . date('c') . "] starting {$cfg['art_style']['label']} artwork generation for {$preview['scope_label']} ({$preview['pose_label']})\n");
    @file_put_contents($PROGRESS_PATH, json_encode([
        'status' => 'starting',
        'state' => 'running',
        'provider' => $cfg['art_style']['provider'],
        'style' => $cfg['art_style']['key'],
        'scope' => $preview['scope'],
        'scope_label' => $preview['scope_label'],
        'pose_label' => $preview['pose_label'],
        'total' => (int)($preview['missing_images'] ?? 0),
        'current' => 0,
        'generated' => 0,
        'skipped' => 0,
        'failed' => 0,
        'message' => 'starting',
        'updated_at' => date('c'),
    ]));
    $cmd = 'cd ' . escapeshellarg($BIRDNETPI_DIR)
        . ' && nohup python3 ' . escapeshellarg($PREGEN)
        . ' --provider ' . escapeshellarg($cfg['art_style']['provider'])
        . ' --labels ' . escapeshellarg($speciesFile)
        . ' --poses ' . implode(' ', array_map('escapeshellarg', $poses))
        . ' --out ' . escapeshellarg($outDir)
        . ' --progress ' . escapeshellarg($PROGRESS_PATH)
        . ($cfg['art_style']['provider'] === 'openai' ? ' --style ' . escapeshellarg($cfg['art_style']['style']) : '')
        . ($cfg['art_style']['style'] === 'custom' ? ' --custom-style ' . escapeshellarg((string)$cfg['art_style']['custom_prompt']) : '')
        . ' >> ' . escapeshellarg($LOG_PATH) . ' 2>&1 & echo $!';
    $env = [
        'GEMINI_API_KEY' => $cfg['gemini_key'],
        'OPENAI_API_KEY' => $cfg['openai_key'],
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
        'art_style' => $cfg['art_style']['key'],
        'provider' => $cfg['art_style']['provider'],
        'scope' => $preview['scope'],
        'scope_label' => $preview['scope_label'],
        'pose_label' => $preview['pose_label'],
        'species_file' => $speciesFile,
        'custom_style_configured' => !empty($cfg['art_style']['custom_prompt']),
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
