<?php
// AvianVisitors - system / service / log JSON facade for the admin
// overlay (settings/system/logs/tools sections). Fetched by the
// frontend at /avian/api/birdnet-status.php?action=...
//
// Endpoints (?action=...):
//   system    - uptime / load / disk / mem / temp / audio device / db file age
//   services  - status of every birdnet_* unit + caddy + php-fpm
//   logs      - &unit=<name>&lines=N: last N lines of that unit's journal
//   restart   - GET/POST &unit=<name>: restart a single service (whitelisted)
//   diag      - everything in one go (system + services + recent logs)
//
// Default LAN deploy: returns data immediately, no auth.
// Forwarded deploy:  set AV_REQUIRE_AUTH=1 (env) AND configure Caddy
// basic_auth on /avian/api/ to gate everything.
//
// Service restart + journalctl need passwordless sudo for the caddy
// user that runs php-fpm. install_services.sh drops the matching
// sudoers rule at /etc/sudoers.d/020_avian-admin with an explicit
// command allowlist.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (getenv('AV_REQUIRE_AUTH') === '1' && empty($_SERVER['HTTP_AUTHORIZATION'])) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$action = $_GET['action'] ?? 'diag';

// Path layout: /home/{USER}/BirdNET-Pi/avian/api/birdnet-status.php
//   __DIR__              -> .../BirdNET-Pi/avian/api
//   dirname(__DIR__, 2)  -> .../BirdNET-Pi
//   dirname(__DIR__, 3)  -> /home/{USER}
$BIRDNETPI_DIR = dirname(__DIR__, 2);
$BIRDSONGS_DIR = dirname(__DIR__, 3) . '/BirdSongs';
$DB_PATH       = "$BIRDNETPI_DIR/scripts/birds.db";
$CONF_PATH     = "$BIRDNETPI_DIR/birdnet.conf";
$STREAM_DIR    = "$BIRDSONGS_DIR/StreamData";

function shellout(string $cmd): string {
    // Always merge stderr so a broken command shows what failed.
    $rc = 0; $out = [];
    exec($cmd . ' 2>&1', $out, $rc);
    return implode("\n", $out);
}

function read_uptime(): array {
    $up = @file_get_contents('/proc/uptime');
    $sec = $up ? (float)explode(' ', trim($up))[0] : 0;
    return [
        'seconds' => $sec,
        'pretty'  => human_duration((int)$sec),
        'load'    => sys_getloadavg(),
        'now'     => date('c'),
    ];
}

function human_duration(int $s): string {
    $d = intdiv($s, 86400); $s -= $d * 86400;
    $h = intdiv($s, 3600);  $s -= $h * 3600;
    $m = intdiv($s, 60);
    $parts = [];
    if ($d) $parts[] = $d . 'd';
    if ($h) $parts[] = $h . 'h';
    if ($m && !$d) $parts[] = $m . 'm';
    return $parts ? implode(' ', $parts) : '<1m';
}

function read_mem(): array {
    $info = @file_get_contents('/proc/meminfo') ?: '';
    preg_match('/MemTotal:\s+(\d+)/', $info, $t);
    preg_match('/MemAvailable:\s+(\d+)/', $info, $a);
    $tot = isset($t[1]) ? (int)$t[1] * 1024 : 0;
    $avail = isset($a[1]) ? (int)$a[1] * 1024 : 0;
    $used = $tot - $avail;
    return [
        'total_bytes' => $tot,
        'used_bytes'  => $used,
        'used_pct'    => $tot ? round($used / $tot * 100, 1) : 0,
    ];
}

function read_disk(string $path): array {
    if (!is_dir($path)) return ['path' => $path, 'error' => 'not found'];
    $tot = @disk_total_space($path);
    $free = @disk_free_space($path);
    if (!$tot) return ['path' => $path, 'error' => 'stat failed'];
    return [
        'path'        => $path,
        'total_bytes' => (int)$tot,
        'free_bytes'  => (int)$free,
        'used_pct'    => round(($tot - $free) / $tot * 100, 1),
    ];
}

function read_temp(): ?float {
    $f = '/sys/class/thermal/thermal_zone0/temp';
    if (!is_readable($f)) return null;
    $raw = trim((string)@file_get_contents($f));
    return $raw === '' ? null : round((int)$raw / 1000, 1);
}

function read_cpu_totals(): ?array {
    $raw = @file_get_contents('/proc/stat');
    if (!$raw || !preg_match('/^cpu\s+(.+)$/m', $raw, $m)) return null;
    $parts = array_map('intval', preg_split('/\s+/', trim($m[1])) ?: []);
    if (count($parts) < 4) return null;
    $idle = ($parts[3] ?? 0) + ($parts[4] ?? 0);
    $total = array_sum($parts);
    return ['idle' => $idle, 'total' => $total];
}

function read_cpu_usage(): ?float {
    $a = read_cpu_totals();
    if (!$a) return null;
    usleep(120000);
    $b = read_cpu_totals();
    if (!$b) return null;
    $total = $b['total'] - $a['total'];
    $idle = $b['idle'] - $a['idle'];
    if ($total <= 0) return null;
    return round(max(0, min(100, (1 - ($idle / $total)) * 100)), 1);
}

function read_audio(): array {
    // Read /proc/asound/cards directly - works even when the capture
    // device is busy (arecord -l would fail with "no soundcards" if
    // birdnet_recording holds the mic). The file is two lines per card.
    $raw = @file_get_contents('/proc/asound/cards') ?: '';
    $lines = array_values(array_filter(array_map('rtrim', explode("\n", $raw)), 'strlen'));
    $cards = [];
    for ($i = 0; $i < count($lines); $i += 2) {
        $head = trim($lines[$i]);
        $detail = isset($lines[$i + 1]) ? trim($lines[$i + 1]) : '';
        $cards[] = $detail !== '' ? "$head - $detail" : $head;
    }
    $usb = shellout('lsusb');
    return [
        'arecord_l' => $cards,
        'usb' => array_values(array_filter(explode("\n", $usb), function ($l) {
            return $l !== '' && (
                stripos($l, 'audio') !== false ||
                stripos($l, 'microphone') !== false ||
                stripos($l, 'mic') !== false
            );
        })),
    ];
}

function read_streamdata(string $dir): array {
    if (!is_dir($dir)) return ['exists' => false];
    $files = @scandir($dir, SCANDIR_SORT_DESCENDING) ?: [];
    $wav = array_values(array_filter($files, function ($f) {
        return $f !== '.' && $f !== '..' && preg_match('/\.(wav|mp3|raw)$/i', $f);
    }));
    $newest_age = null;
    if (count($wav) > 0) {
        $newest_age = time() - (int)@filemtime("$dir/" . $wav[0]);
    }
    return [
        'exists'        => true,
        'file_count'    => count($wav),
        'newest_age_s'  => $newest_age,
        'newest_name'   => $wav[0] ?? null,
    ];
}

function read_db_age(string $db): array {
    if (!is_file($db)) return ['exists' => false];
    return [
        'exists'      => true,
        'size_bytes'  => (int)filesize($db),
        'modified_s'  => time() - (int)filemtime($db),
        'mtime'       => date('c', (int)filemtime($db)),
    ];
}

function latest_wav_file(string $dir): ?string {
    if (!is_dir($dir)) return null;
    $files = glob($dir . '/*.wav') ?: [];
    if (!$files) return null;
    usort($files, function ($a, $b) {
        return (int)@filemtime($b) <=> (int)@filemtime($a);
    });
    return $files[0] ?? null;
}

function dbfs(float $v): ?float {
    if ($v <= 0) return null;
    return round(20 * log10($v), 1);
}

function mic_verdict(array $m): array {
    $peak = $m['peak_dbfs'];
    $rms = $m['rms_dbfs'];
    $noise = $m['noise_floor_dbfs'];
    $clip = (float)$m['clipping_pct'];
    if ($clip > 0.1 || ($peak !== null && $peak > -1.0)) {
        return ['tone' => 'warn', 'label' => 'too hot', 'explain' => 'Input is clipping or near clipping. Reduce mic gain.'];
    }
    if (($peak !== null && $peak < -20.0) || ($rms !== null && $rms < -42.0)) {
        return ['tone' => 'warn', 'label' => 'too quiet', 'explain' => 'Bird calls may be buried. Increase mic gain or move the mic closer/outside.'];
    }
    if ($noise !== null && $noise > -34.0) {
        return ['tone' => 'warn', 'label' => 'noisy floor', 'explain' => 'Background noise is high. Check HVAC, wind, mounting vibration, and filter settings.'];
    }
    return ['tone' => 'good', 'label' => 'usable', 'explain' => 'Levels look usable for BirdNET. Compare detections after tuning confidence and sensitivity.'];
}

function alsa_cards(): array {
    $raw = @file_get_contents('/proc/asound/cards') ?: '';
    preg_match_all('/^\s*(\d+)\s+\[([^\]]+)\]/m', $raw, $m, PREG_SET_ORDER);
    return array_map(function ($r) {
        return ['id' => (int)$r[1], 'name' => trim($r[2])];
    }, $m);
}

function mixer_get(int $card, string $control): array {
    $raw = shellout('amixer -c ' . (int)$card . ' get ' . escapeshellarg($control));
    if (stripos($raw, 'cvolume') === false && stripos($raw, 'Capture channels') === false) {
        return [
            'ok' => false,
            'card' => $card,
            'control' => $control,
            'error' => 'not a capture control',
            'raw' => $raw,
        ];
    }
    $limits = [];
    if (preg_match('/Limits:.*?Capture\s+(\d+)\s+-\s+(\d+)/i', $raw, $lm)) {
        $limits = ['min' => (int)$lm[1], 'max' => (int)$lm[2]];
    }
    if (preg_match('/Capture\s+(\d+)\s+\[(\d+)%\]\s+(?:\[([+-]?\d+(?:\.\d+)?)dB\]\s+)?\[(on|off)\]/i', $raw, $m)) {
        return [
            'ok' => true,
            'card' => $card,
            'control' => $control,
            'value' => (int)$m[1],
            'percent' => (int)$m[2],
            'db' => isset($m[3]) && $m[3] !== '' ? (float)$m[3] : null,
            'enabled' => strtolower($m[4]) === 'on',
            'limits' => $limits,
            'step_count' => isset($limits['max']) ? ($limits['max'] - ($limits['min'] ?? 0) + 1) : null,
            'raw' => $raw,
        ];
    }
    if (preg_match('/Mono:.*?\[(\d+)%\].*?\[(on|off)\]/i', $raw, $m)) {
        return [
            'ok' => true,
            'card' => $card,
            'control' => $control,
            'percent' => (int)$m[1],
            'enabled' => strtolower($m[2]) === 'on',
            'limits' => $limits,
            'step_count' => isset($limits['max']) ? ($limits['max'] - ($limits['min'] ?? 0) + 1) : null,
            'raw' => $raw,
        ];
    }
    return [
        'ok' => false,
        'card' => $card,
        'control' => $control,
        'error' => trim($raw) ?: 'Capture mixer control not found',
    ];
}

function mixer_capture_elements(int $card, string $control): array {
    $raw = shellout('amixer -c ' . (int)$card . ' contents');
    $blocks = preg_split('/(?=numid=)/', $raw) ?: [];
    $volume = null;
    $switch = null;
    $wantVolume = [$control . ' Capture Volume', $control . ' Volume', 'Capture Volume'];
    $wantSwitch = [$control . ' Capture Switch', $control . ' Switch', 'Capture Switch'];
    foreach ($blocks as $block) {
        if (!preg_match('/numid=(\d+),.*?name=\'([^\']+)\'/s', $block, $m)) continue;
        $name = $m[2];
        if ($volume === null && in_array($name, $wantVolume, true) && stripos($block, 'type=INTEGER') !== false) {
            $volume = ['numid' => (int)$m[1], 'name' => $name];
        }
        if ($switch === null && in_array($name, $wantSwitch, true) && stripos($block, 'type=BOOLEAN') !== false) {
            $switch = ['numid' => (int)$m[1], 'name' => $name];
        }
    }
    return ['volume' => $volume, 'switch' => $switch];
}

function discover_mic_gain(): array {
    $cards = alsa_cards();
    $preferred = ['Capture', 'Mic', 'Digital', 'Input'];
    foreach ($cards as $card) {
        $controlsRaw = shellout('amixer -c ' . (int)$card['id'] . ' scontrols');
        preg_match_all("/Simple mixer control '([^']+)'/i", $controlsRaw, $m);
        $controls = $m[1] ?? [];
        $ordered = array_values(array_unique(array_merge(
            array_values(array_filter($preferred, fn($c) => in_array($c, $controls, true))),
            $controls
        )));
        foreach ($ordered as $control) {
            $gain = mixer_get((int)$card['id'], $control);
            if (!empty($gain['ok'])) {
                $gain['card_name'] = $card['name'];
                $gain['controls'] = $controls;
                return $gain;
            }
        }
    }
    return ['ok' => false, 'error' => 'No capture gain mixer control found', 'cards' => $cards];
}

function read_hardware_agc(?int $card = null): array {
    $cards = $card === null ? alsa_cards() : [['id' => $card, 'name' => '']];
    foreach ($cards as $c) {
        $raw = shellout('amixer -c ' . (int)$c['id'] . ' get ' . escapeshellarg('Auto Gain Control'));
        if (preg_match('/Playback\s+\[(on|off)\]/i', $raw, $m)) {
            return ['ok' => true, 'card' => (int)$c['id'], 'enabled' => strtolower($m[1]) === 'on', 'raw' => $raw];
        }
    }
    return ['ok' => false, 'error' => 'Auto Gain Control mixer switch not found'];
}

function read_mic_gain(): array {
    $gain = discover_mic_gain();
    if (!empty($gain['ok'])) $gain['hardware_agc'] = read_hardware_agc((int)$gain['card']);
    return $gain;
}

function set_mic_gain(int $percent): array {
    $percent = max(0, min(100, $percent));
    $current = read_mic_gain();
    if (empty($current['ok'])) return $current + ['requested_percent' => $percent, 'set_ok' => false];
    $rc = 0; $out = [];
    $elements = mixer_capture_elements((int)$current['card'], (string)$current['control']);
    if (!empty($elements['volume']['numid'])) {
        if (!empty($elements['switch']['numid'])) {
            exec('amixer -q -c ' . (int)$current['card'] . ' cset numid=' . (int)$elements['switch']['numid'] . ' on 2>&1', $out, $switchRc);
        }
        exec('amixer -q -c ' . (int)$current['card'] . ' cset numid=' . (int)$elements['volume']['numid'] . ' ' . $percent . '% 2>&1', $out, $rc);
    } else {
        exec(
            'amixer -q -c ' . (int)$current['card'] . ' sset ' . escapeshellarg($current['control']) . ' ' . $percent . '% cap 2>&1',
            $out,
            $rc
        );
    }
    $gain = read_mic_gain();
    $gain['requested_percent'] = $percent;
    $gain['set_ok'] = $rc === 0;
    $gain['set_target'] = $elements;
    if ($rc !== 0) $gain['error'] = implode("\n", $out) ?: 'amixer failed';
    return $gain;
}

function auto_mic_gain(string $dir): array {
    $health = read_mic_health($dir);
    $gain = read_mic_gain();
    if (empty($health['ok'])) {
        return ['ok' => false, 'error' => $health['error'] ?? 'mic health unavailable', 'health' => $health, 'gain' => $gain];
    }
    if (empty($gain['ok'])) {
        return ['ok' => false, 'error' => $gain['error'] ?? 'mic gain unavailable', 'health' => $health, 'gain' => $gain];
    }
    $current = (int)$gain['percent'];
    $target = $current;
    $reason = 'already in target range';
    $peak = $health['peak_dbfs'];
    $clip = (float)$health['clipping_pct'];
    if ($clip > 0.1 || ($peak !== null && $peak > -3.0)) {
        $target = max(0, $current - 10);
        $reason = 'reduced gain to avoid clipping';
    } elseif ($peak !== null && $peak < -24.0) {
        $target = min(100, $current + 15);
        $reason = $target === $current ? 'gain is already at maximum' : 'increased gain for quiet input';
    } elseif ($peak !== null && $peak < -16.0) {
        $target = min(100, $current + 5);
        $reason = $target === $current ? 'gain is already at maximum' : 'nudged gain upward';
    }
    $set = $target !== $current ? set_mic_gain($target) : $gain;
    return [
        'ok' => !empty($set['ok']) || !empty($gain['ok']),
        'changed' => $target !== $current,
        'reason' => $reason,
        'from_percent' => $current,
        'to_percent' => $target,
        'health' => $health,
        'gain' => $set,
    ];
}

function wav_mic_health(string $path): array {
    $raw = @file_get_contents($path);
    if ($raw === false || strlen($raw) < 44) return ['ok' => false, 'error' => 'wav read failed'];
    if (substr($raw, 0, 4) !== 'RIFF' || substr($raw, 8, 4) !== 'WAVE') {
        return ['ok' => false, 'error' => 'not a RIFF/WAVE file'];
    }
    $pos = 12;
    $fmt = null;
    $dataPos = null;
    $dataLen = null;
    $len = strlen($raw);
    while ($pos + 8 <= $len) {
        $id = substr($raw, $pos, 4);
        $size = unpack('V', substr($raw, $pos + 4, 4))[1];
        $chunk = $pos + 8;
        if ($id === 'fmt ' && $size >= 16) {
            $u = unpack('vformat/vchannels/VsampleRate/VbyteRate/vblockAlign/vbitsPerSample', substr($raw, $chunk, 16));
            $fmt = $u;
        } elseif ($id === 'data') {
            $dataPos = $chunk;
            $dataLen = min($size, $len - $chunk);
            break;
        }
        $pos = $chunk + $size + ($size % 2);
    }
    if (!$fmt || $dataPos === null || $dataLen === null) return ['ok' => false, 'error' => 'wav missing fmt/data chunk'];
    if ((int)$fmt['format'] !== 1 || (int)$fmt['bitsPerSample'] !== 16) {
        return ['ok' => false, 'error' => 'only 16-bit PCM wav is supported'];
    }
    $samples = intdiv($dataLen, 2);
    if ($samples <= 0) return ['ok' => false, 'error' => 'wav has no samples'];
    $sumSq = 0.0;
    $peak = 0;
    $clipped = 0;
    $windowSamples = max(1, (int)$fmt['sampleRate'] * max(1, (int)$fmt['channels']) / 20);
    $winSq = 0.0;
    $winN = 0;
    $windows = [];
    for ($i = 0; $i < $samples; $i += 1) {
        $off = $dataPos + ($i * 2);
        $u = unpack('v', substr($raw, $off, 2))[1];
        $s = $u >= 32768 ? $u - 65536 : $u;
        $a = abs($s);
        if ($a > $peak) $peak = $a;
        if ($a >= 32760) $clipped += 1;
        $norm = $s / 32768.0;
        $sq = $norm * $norm;
        $sumSq += $sq;
        $winSq += $sq;
        $winN += 1;
        if ($winN >= $windowSamples) {
            $windows[] = sqrt($winSq / $winN);
            $winSq = 0.0;
            $winN = 0;
        }
    }
    if ($winN > 0) $windows[] = sqrt($winSq / $winN);
    sort($windows);
    $noiseRms = $windows ? $windows[(int)floor((count($windows) - 1) * 0.10)] : 0;
    $peakNorm = min(1.0, $peak / 32768.0);
    $rmsNorm = sqrt($sumSq / $samples);
    $duration = $samples / max(1, (int)$fmt['sampleRate'] * max(1, (int)$fmt['channels']));
    $metrics = [
        'ok' => true,
        'file' => basename($path),
        'age_s' => time() - (int)@filemtime($path),
        'duration_s' => round($duration, 1),
        'sample_rate' => (int)$fmt['sampleRate'],
        'channels' => (int)$fmt['channels'],
        'peak_dbfs' => dbfs($peakNorm),
        'rms_dbfs' => dbfs($rmsNorm),
        'noise_floor_dbfs' => dbfs($noiseRms),
        'clipping_pct' => round($clipped / $samples * 100, 3),
    ];
    $metrics['verdict'] = mic_verdict($metrics);
    return $metrics;
}

function read_mic_health(string $dir): array {
    $file = latest_wav_file($dir);
    if (!$file) {
        return [
            'ok' => false,
            'error' => 'no recent wav segments found',
            'message' => 'BirdNET has not written a StreamData wav segment yet.',
            'as_of' => date('c'),
        ];
    }
    $m = wav_mic_health($file);
    $m['as_of'] = date('c');
    $m['source'] = 'latest StreamData segment';
    $m['gain'] = read_mic_gain();
    if (!empty($m['age_s']) && $m['age_s'] > 300) {
        $m['stale'] = true;
        $m['message'] = 'Latest recording segment is older than five minutes; restart birdnet_recording if this stays stale.';
    }
    return $m;
}

function read_conf_summary(string $p): array {
    if (!is_readable($p)) return ['readable' => false];
    $keys = [
        'CONFIDENCE','SENSITIVITY','OVERLAP','REC_CARD','LATITUDE','LONGITUDE',
        'MODEL','SITE_NAME','RTSP_STREAM',
    ];
    $vals = [];
    foreach (file($p, FILE_IGNORE_NEW_LINES) as $line) {
        if (!$line || $line[0] === '#') continue;
        if (preg_match('/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i', $line, $m)) {
            if (in_array($m[1], $keys, true)) {
                $v = trim($m[2]);
                if (strlen($v) >= 2 && $v[0] === '"' && substr($v, -1) === '"') $v = substr($v, 1, -1);
                $vals[$m[1]] = $v;
            }
        }
    }
    return ['readable' => true, 'values' => $vals];
}

// Whitelisted units we'll surface in the system page + allow restart on.
// Includes both 8.2 and 8.4 php-fpm so older Debian + Trixie both report
// the right unit name; missing units come back as "inactive (not-found)".
const ALLOWED_UNITS = [
    'birdnet_recording',
    'birdnet_analysis',
    'birdnet_log',
    'birdnet_stats',
    'spectrogram_viewer',
    'livestream',
    'chart_viewer',
    'icecast2',
    'caddy',
    'php8.4-fpm',
    'php8.3-fpm',
    'php8.2-fpm',
];

function services_status(): array {
    $out = [];
    foreach (ALLOWED_UNITS as $u) {
        $state = trim(shellout('systemctl is-active ' . escapeshellarg($u)));
        // Skip units that systemd doesn't know about at all (e.g. php8.2-fpm
        // on a Trixie box that ships php8.4). Keeps the table tidy.
        if ($state === 'inactive') {
            $exists = trim(shellout('systemctl cat ' . escapeshellarg($u) . ' >/dev/null 2>&1 && echo Y || echo N'));
            if ($exists !== 'Y') continue;
        }
        $enabled = trim(shellout('systemctl is-enabled ' . escapeshellarg($u)));
        $since = trim(shellout("systemctl show -p ActiveEnterTimestamp --value " . escapeshellarg($u)));
        $out[$u] = [
            'active'  => $state,
            'enabled' => $enabled,
            'since'   => $since ?: null,
        ];
    }
    return $out;
}

function logs_for(string $unit, int $lines): array {
    if (!in_array($unit, ALLOWED_UNITS, true)) {
        http_response_code(400);
        return ['error' => 'unit not allowed', 'allowed' => ALLOWED_UNITS];
    }
    $lines = max(10, min(500, $lines));
    $out = shellout(
        'sudo /bin/journalctl -u ' . escapeshellarg($unit) .
        ' --no-pager -n ' . $lines . ' -o short-iso'
    );
    return [
        'unit'  => $unit,
        'lines' => $lines,
        'text'  => $out,
    ];
}

switch ($action) {

    case 'system': {
        echo json_encode([
            'uptime'      => read_uptime(),
            'mem'         => read_mem(),
            'disk_root'   => read_disk('/'),
            'disk_birds'  => read_disk($BIRDSONGS_DIR),
            'temp_c'      => read_temp(),
            'cpu_pct'     => read_cpu_usage(),
            'audio'       => read_audio(),
            'stream_data' => read_streamdata($STREAM_DIR),
            'birds_db'    => read_db_age($DB_PATH),
            'conf'        => read_conf_summary($CONF_PATH),
            'hostname'    => trim(shellout('hostname')),
            'kernel'      => trim(shellout('uname -r')),
            'as_of'       => date('c'),
        ]);
        break;
    }

    case 'services': {
        echo json_encode(['services' => services_status(), 'as_of' => date('c')]);
        break;
    }

    case 'mic_health': {
        echo json_encode(read_mic_health($STREAM_DIR));
        break;
    }

    case 'mic_gain': {
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
            $body = json_decode((string)file_get_contents('php://input'), true);
            $percent = is_array($body) ? (int)($body['percent'] ?? -1) : -1;
            if ($percent < 0 || $percent > 100) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => 'percent must be 0-100']);
                break;
            }
            echo json_encode(set_mic_gain($percent));
        } else {
            echo json_encode(read_mic_gain());
        }
        break;
    }

    case 'mic_auto_gain': {
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            http_response_code(405);
            echo json_encode(['ok' => false, 'error' => 'POST required']);
            break;
        }
        echo json_encode(auto_mic_gain($STREAM_DIR));
        break;
    }

    case 'logs': {
        $unit = (string)($_GET['unit'] ?? 'birdnet_recording');
        $lines = (int)($_GET['lines'] ?? 60);
        echo json_encode(logs_for($unit, $lines));
        break;
    }

    case 'restart': {
        // POST-only: blocks a stray <img src="...?action=restart...">
        // tag on any LAN-reachable page from disrupting the recording
        // pipeline. The frontend already POSTs; only thing this rejects
        // is a passive cross-page GET.
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'POST required']);
            break;
        }
        $unit = (string)($_GET['unit'] ?? '');
        if (!in_array($unit, ALLOWED_UNITS, true)) {
            http_response_code(400);
            echo json_encode(['error' => 'unit not allowed', 'allowed' => ALLOWED_UNITS]);
            break;
        }
        // Sudoers rule (dropped in by install_services.sh):
        //   caddy ALL=(root) NOPASSWD: /bin/systemctl restart birdnet_*, ...
        $rc = 0; $out = [];
        exec('sudo /bin/systemctl restart ' . escapeshellarg($unit) . ' 2>&1', $out, $rc);
        echo json_encode([
            'unit' => $unit,
            'ok'   => $rc === 0,
            'rc'   => $rc,
            'out'  => implode("\n", $out),
        ]);
        break;
    }

    case 'diag': {
        // Everything a /system page wants in one fetch.
        $svc = services_status();
        $key_units = ['birdnet_recording', 'birdnet_analysis'];
        $recent_logs = [];
        foreach ($key_units as $u) {
            $recent_logs[$u] = trim(shellout(
                'sudo /bin/journalctl -u ' . escapeshellarg($u) .
                ' --no-pager -n 20 -o short-iso'
            ));
        }
        echo json_encode([
            'system'      => [
                'uptime'      => read_uptime(),
                'mem'         => read_mem(),
                'disk_root'   => read_disk('/'),
                'disk_birds'  => read_disk($BIRDSONGS_DIR),
                'temp_c'      => read_temp(),
                'cpu_pct'     => read_cpu_usage(),
                'audio'       => read_audio(),
                'stream_data' => read_streamdata($STREAM_DIR),
                'birds_db'    => read_db_age($DB_PATH),
                'conf'        => read_conf_summary($CONF_PATH),
                'hostname'    => trim(shellout('hostname')),
                'kernel'      => trim(shellout('uname -r')),
            ],
            'services'    => $svc,
            'recent_logs' => $recent_logs,
            'as_of'       => date('c'),
        ]);
        break;
    }

    default:
        http_response_code(404);
        echo json_encode(['error' => 'unknown action']);
}
