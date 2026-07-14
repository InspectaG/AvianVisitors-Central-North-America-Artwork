<?php
// AvianVisitors - read/write a small, whitelisted subset of BirdNET-Pi
// settings from the admin overlay's settings panel. Fetched by the
// frontend at /avian/api/config.php.
//
// Endpoints:
//   GET  -> returns current values as JSON.
//   POST -> JSON body with any whitelisted key. Writes through to
//           birdnet.conf and restarts birdnet_analysis + birdnet_recording
//           so the changes take effect immediately.
//
// Default LAN deploy: returns data immediately, no auth.
// Forwarded deploy:  set AV_REQUIRE_AUTH=1 (env) AND configure Caddy
// basic_auth on /avian/api/.
//
// Restart requires passwordless sudo for the caddy user that runs
// php-fpm, dropped in place by install_services.sh at
// /etc/sudoers.d/020_avian-admin.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (getenv('AV_REQUIRE_AUTH') === '1' && empty($_SERVER['HTTP_AUTHORIZATION'])) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

// Path layout: /home/{USER}/BirdNET-Pi/avian/api/config.php
$BIRDNETPI_DIR = dirname(__DIR__, 2);
$CONF_PATH     = "$BIRDNETPI_DIR/birdnet.conf";

// Whitelist: { config_key => { type, min?, max?, restart? } }
$ALLOWED = [
    'CONFIDENCE'         => ['type' => 'float', 'min' => 0.05, 'max' => 0.99, 'restart' => true],
    'SENSITIVITY'        => ['type' => 'float', 'min' => 0.5,  'max' => 1.5,  'restart' => true],
    'SF_THRESH'          => ['type' => 'float', 'min' => 0.0,  'max' => 1.0,  'restart' => true],
    'OVERLAP'            => ['type' => 'float', 'min' => 0.0,  'max' => 2.5,  'restart' => true],
    'MAX_FILES_SPECIES'  => ['type' => 'int',   'min' => 0,    'max' => 100000],
    'FULL_DISK'          => ['type' => 'enum',  'values' => ['purge', 'keep']],
    'PURGE_THRESHOLD'    => ['type' => 'int',   'min' => 50,   'max' => 99],
    'LATITUDE'           => ['type' => 'float', 'min' => -90,  'max' => 90, 'restart' => true],
    'LONGITUDE'          => ['type' => 'float', 'min' => -180, 'max' => 180, 'restart' => true],
    'SITE_NAME'          => ['type' => 'string', 'maxlen' => 60],
    'EBIRD_API_KEY'      => ['type' => 'secret', 'maxlen' => 120],
    'GEMINI_API_KEY'     => ['type' => 'secret', 'maxlen' => 180],
    'OPENAI_API_KEY'     => ['type' => 'secret', 'maxlen' => 220],
    'EBIRD_REGION'       => ['type' => 'region', 'maxlen' => 32],
    'AV_ART_STYLE'       => ['type' => 'art_style', 'maxlen' => 80],
    'AV_ART_CUSTOM_STYLES' => ['type' => 'json_text', 'maxlen' => 4000],
    'BIRDFY_ENABLED'     => ['type' => 'int',   'min' => 0,    'max' => 1],
    'BIRDFY_EMAIL'       => ['type' => 'secret_text', 'maxlen' => 180],
    'BIRDFY_PASSWORD'    => ['type' => 'secret_text', 'maxlen' => 220],
    'BIRDFY_IMPORT_WINDOW_HOURS' => ['type' => 'int', 'min' => 1, 'max' => 168],
    'AV_NIGHT_START'     => ['type' => 'int',   'min' => 0,    'max' => 23],
    'AV_NIGHT_END'       => ['type' => 'int',   'min' => 0,    'max' => 23],
    'AV_AUDIO_FILTER'    => ['type' => 'int',   'min' => 0,    'max' => 1, 'restart' => true],
    'AV_FILTER_HIGHPASS' => ['type' => 'int',   'min' => 20,   'max' => 3000, 'restart' => true],
    'AV_FILTER_LOWPASS'  => ['type' => 'int',   'min' => 1000, 'max' => 20000, 'restart' => true],
    'AV_DISPLAY_REFRESH_SECONDS' => ['type' => 'int', 'min' => 5, 'max' => 300],
];

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

function write_conf(string $path, array $updates): bool {
    if (!is_writable($path) && !is_writable(dirname($path))) return false;
    $lines = is_readable($path) ? file($path, FILE_IGNORE_NEW_LINES) : [];
    $seen = [];
    foreach ($lines as $i => $line) {
        if (preg_match('/^\s*([A-Z_][A-Z0-9_]*)\s*=/i', $line, $m)) {
            $k = $m[1];
            if (array_key_exists($k, $updates)) {
                $lines[$i] = $k . '=' . quote_val($updates[$k]);
                $seen[$k] = true;
            }
        }
    }
    foreach ($updates as $k => $v) {
        if (empty($seen[$k])) $lines[] = $k . '=' . quote_val($v);
    }
    $tmp = $path . '.tmp.' . getmypid();
    if (file_put_contents($tmp, implode("\n", $lines) . "\n") === false) return false;
    return rename($tmp, $path);
}

function quote_val($v): string {
    $s = (string)$v;
    // Bare value if it's all "shell-safe" characters.
    if ($s === '' || preg_match('/[^A-Za-z0-9._\/+-]/', $s)) {
        // Quoted form: escape backslash, double-quote, dollar, and backtick.
        // birdnet.conf is `source`d by BirdNET-Pi shell scripts and bash
        // expands $(), $VAR, `cmd` inside double-quotes - without these
        // escapes a controlled string field becomes command injection.
        return '"' . addcslashes($s, "\\\"\$`") . '"';
    }
    return $s;
}

// Tight allowlist for string fields (currently SITE_NAME). Defence in
// depth on top of quote_val: even if shell escaping ever regresses, the
// only characters that reach birdnet.conf are letters, digits, and a
// short list of punctuation that shell won't interpret.
function safe_string_value(string $v): bool {
    return (bool)preg_match("/^[A-Za-z0-9 _.,'-]*$/u", $v);
}

function safe_secret_value(string $v): bool {
    return $v === '' || (bool)preg_match('/^[A-Za-z0-9_.:-]+$/', $v);
}

function safe_secret_text_value(string $v): bool {
    return $v === '' || (bool)preg_match('/^[\x20-\x7E]+$/', $v);
}

function safe_json_text_value(string $v): bool {
    return $v === '' || (bool)preg_match('/^[\x20-\x7E]+$/', $v);
}

function safe_art_style_value(string $v): bool {
    $allowed = ['gemini', 'openai-watercolor', 'openai-ink', 'openai-paper-cut', 'openai-poster', 'openai-vintage', 'openai-gouache', 'openai-minimal', 'daily'];
    return in_array($v, $allowed, true) || (bool)preg_match('/^openai-custom-[a-z0-9-]{1,48}$/', $v);
}

function normalize_ebird_region(string $v): string {
    $v = strtoupper(trim($v));
    if ($v === '') return '';
    // Friendly US state shorthand: "MO" -> "US-MO". Full eBird region
    // codes such as US-MO or US-MO-189 pass through unchanged.
    if (preg_match('/^[A-Z]{2}$/', $v)) return 'US-' . $v;
    return $v;
}

function safe_region_value(string $v): bool {
    return $v === '' || (bool)preg_match('/^[A-Z0-9]{2,3}(?:-[A-Z0-9]{2,4}){0,3}$/', $v);
}

function mask_secret(string $v): array {
    $v = trim($v);
    if ($v === '') return ['configured' => false, 'masked' => ''];
    $tail = substr($v, -4);
    return ['configured' => true, 'masked' => '••••' . $tail];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $conf = read_conf($CONF_PATH);
    $conf += [
        'AV_NIGHT_START' => '21',
        'AV_NIGHT_END' => '5',
        'AV_AUDIO_FILTER' => '0',
        'AV_FILTER_HIGHPASS' => '300',
        'AV_FILTER_LOWPASS' => '10000',
        'BIRDFY_ENABLED' => '0',
        'BIRDFY_EMAIL' => '',
        'BIRDFY_PASSWORD' => '',
        'BIRDFY_IMPORT_WINDOW_HOURS' => '24',
        'AV_DISPLAY_REFRESH_SECONDS' => '30',
        'GEMINI_API_KEY' => '',
        'OPENAI_API_KEY' => '',
        'EBIRD_REGION' => '',
        'AV_ART_STYLE' => 'gemini',
        'AV_ART_CUSTOM_STYLES' => '[]',
    ];
    $out = [];
    foreach ($ALLOWED as $k => $spec) {
        if (!array_key_exists($k, $conf)) continue;
        $v = $conf[$k];
        if ($spec['type'] === 'float') $v = (float)$v;
        elseif ($spec['type'] === 'int') $v = (int)$v;
        elseif ($spec['type'] === 'secret' || $spec['type'] === 'secret_text') { $out[$k] = mask_secret((string)$v); continue; }
        $out[$k] = $v;
    }
    echo json_encode([
        'values'   => $out,
        'meta'     => $ALLOWED,
        'preserve' => (int)($conf['MAX_FILES_SPECIES'] ?? 0) >= 10000,
    ]);
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode((string)$raw, true);
    if (!is_array($body)) {
        http_response_code(400);
        echo json_encode(['error' => 'bad json']);
        exit;
    }
    $updates = [];
    $errors = [];
    foreach ($body as $k => $v) {
        // 'preserve' is a UI-side convenience flag handled below - skip it here.
        if ($k === 'preserve') continue;
        if (!isset($ALLOWED[$k])) { $errors[$k] = 'unknown'; continue; }
        $spec = $ALLOWED[$k];
        if ($spec['type'] === 'float') {
            $v = (float)$v;
            if ($v < ($spec['min'] ?? -INF) || $v > ($spec['max'] ?? INF)) { $errors[$k] = 'out of range'; continue; }
        } elseif ($spec['type'] === 'int') {
            $v = (int)$v;
            if ($v < ($spec['min'] ?? -PHP_INT_MAX) || $v > ($spec['max'] ?? PHP_INT_MAX)) { $errors[$k] = 'out of range'; continue; }
        } elseif ($spec['type'] === 'enum') {
            if (!in_array($v, $spec['values'], true)) { $errors[$k] = 'invalid value'; continue; }
        } elseif ($spec['type'] === 'string') {
            $v = (string)$v;
            if (strlen($v) > ($spec['maxlen'] ?? 200)) { $errors[$k] = 'too long'; continue; }
            // String fields land in birdnet.conf which is sourced by bash;
            // reject anything outside a known-safe punctuation set so a
            // bash metacharacter can't get there even if quote_val regresses.
            if (!safe_string_value($v)) { $errors[$k] = 'invalid characters'; continue; }
        } elseif ($spec['type'] === 'secret' || $spec['type'] === 'secret_text') {
            $v = trim((string)$v);
            if (strlen($v) > ($spec['maxlen'] ?? 200)) { $errors[$k] = 'too long'; continue; }
            if ($spec['type'] === 'secret' && !safe_secret_value($v)) { $errors[$k] = 'invalid characters'; continue; }
            if ($spec['type'] === 'secret_text' && !safe_secret_text_value($v)) { $errors[$k] = 'invalid characters'; continue; }
        } elseif ($spec['type'] === 'json_text') {
            $v = trim((string)$v);
            if (strlen($v) > ($spec['maxlen'] ?? 4000)) { $errors[$k] = 'too long'; continue; }
            if (!safe_json_text_value($v)) { $errors[$k] = 'invalid characters'; continue; }
            $decoded = json_decode($v === '' ? '[]' : $v, true);
            if (!is_array($decoded)) { $errors[$k] = 'invalid json'; continue; }
        } elseif ($spec['type'] === 'art_style') {
            $v = strtolower(trim((string)$v));
            if (strlen($v) > ($spec['maxlen'] ?? 80)) { $errors[$k] = 'too long'; continue; }
            if (!safe_art_style_value($v)) { $errors[$k] = 'invalid art style'; continue; }
        } elseif ($spec['type'] === 'region') {
            $v = normalize_ebird_region((string)$v);
            if (strlen($v) > ($spec['maxlen'] ?? 32)) { $errors[$k] = 'too long'; continue; }
            if (!safe_region_value($v)) { $errors[$k] = 'invalid eBird region'; continue; }
        }
        $updates[$k] = $v;
    }
    if ($errors) {
        http_response_code(400);
        echo json_encode(['error' => 'validation', 'fields' => $errors]);
        exit;
    }

    // Convenience flag: "preserve" toggle in the UI sets a high recording cap.
    if (isset($body['preserve'])) {
        $updates['MAX_FILES_SPECIES'] = $body['preserve'] ? 99999 : 50;
    }

    if (!write_conf($CONF_PATH, $updates)) {
        http_response_code(500);
        echo json_encode(['error' => 'write failed (check perms on birdnet.conf)']);
        exit;
    }

    // Restart services if any setting requires it.
    $needsRestart = false;
    foreach (array_keys($updates) as $k) {
        if (!empty($ALLOWED[$k]['restart'])) { $needsRestart = true; break; }
    }
    $restarted = [];
    if ($needsRestart) {
        foreach (['birdnet_analysis', 'birdnet_recording'] as $svc) {
            // Pre-baked sudoers rule: caddy NOPASSWD: /bin/systemctl restart birdnet_*
            $rc = 0; $out = [];
            exec('sudo /bin/systemctl restart ' . escapeshellarg($svc) . ' 2>&1', $out, $rc);
            $restarted[$svc] = $rc === 0;
        }
    }
    $responseUpdates = $updates;
    foreach ($responseUpdates as $k => $v) {
        if (isset($ALLOWED[$k]) && in_array($ALLOWED[$k]['type'], ['secret', 'secret_text'], true)) {
            $responseUpdates[$k] = mask_secret((string)$v);
        }
    }
    echo json_encode(['ok' => true, 'updates' => $responseUpdates, 'restarted' => $restarted]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'method not allowed']);
