<?php
// AvianVisitors - JSON facade over BirdNET-Pi's birds.db. Read-only.
// Symlinked into the BirdNET-Pi Caddy site root at /avian/api/.
//
// Endpoints (?action=...):
//   stats       - totals (detections, unique species, today, last hour)
//   lifelist    - every species with first_seen, last_seen, total_count
//   recent      - &hours=N (default 24): species heard in the window
//   species     - &sci=<sci_name>: per-species detail page
//   timeseries  - &days=N: daily detection counts per species
//   firstseen   - every species' earliest detection
//   ebird_nearby - eBird recent nearby reports, matched by scientific name
//
// Default LAN deploy ships without auth. If you've exposed the Pi via
// Cloudflare or a tunnel, add a Caddy `basic_auth` matcher around the
// /avian/api/* path - see avian/forwarding/.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=30');

// PHP resolves __DIR__ through symlinks to the realpath. This script
// lives at $HOME/BirdNET-Pi/avian/api/birdnet-api.php (served via the
// ${EXTRACTED}/avian symlink). dirname(..., 2) walks to the BirdNET-Pi
// install root. Works under any username because we never bake the
// home directory in. getenv('HOME') would resolve to /var/lib/caddy
// under PHP-FPM (BirdNET-Pi runs it as the caddy user), so it can't
// be relied on.
$DB_PATH = dirname(__DIR__, 2) . '/scripts/birds.db';

if (!file_exists($DB_PATH)) {
    http_response_code(503);
    echo json_encode(['error' => 'birds.db not found']);
    exit;
}

try {
    $db = new SQLite3($DB_PATH, SQLITE3_OPEN_READONLY);
    $db->busyTimeout(2000);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'db open failed']);
    exit;
}

function rows(SQLite3 $db, string $sql, array $bind = []): array {
    $stmt = $db->prepare($sql);
    foreach ($bind as $k => $v) $stmt->bindValue($k, $v);
    $res = $stmt->execute();
    $out = [];
    while ($r = $res->fetchArray(SQLITE3_ASSOC)) $out[] = $r;
    return $out;
}
function one(SQLite3 $db, string $sql, array $bind = []) {
    $r = rows($db, $sql, $bind);
    return $r[0] ?? null;
}

function read_birdnet_conf(string $path): array {
    if (!is_readable($path)) return [];
    $out = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES) as $line) {
        if (!$line || $line[0] === '#') continue;
        if (preg_match('/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i', $line, $m)) {
            $val = trim($m[2]);
            if (strlen($val) >= 2 && $val[0] === '"' && substr($val, -1) === '"') {
                $val = substr($val, 1, -1);
            }
            $out[$m[1]] = $val;
        }
    }
    return $out;
}

function ebird_token(array $conf): string {
    foreach (['EBIRD_API_KEY', 'EBIRD_TOKEN', 'EBIRD_API_TOKEN'] as $k) {
        $v = getenv($k);
        if (is_string($v) && trim($v) !== '') return trim($v);
        if (isset($conf[$k]) && trim((string)$conf[$k]) !== '') return trim((string)$conf[$k]);
    }
    return '';
}

function http_json_get(string $url, array $headers, int $timeout = 8): array {
    $headerLines = [];
    foreach ($headers as $k => $v) $headerLines[] = $k . ': ' . $v;
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headerLines),
            'timeout' => $timeout,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $status = (int)$m[1];
    }
    if ($raw === false) return ['ok' => false, 'status' => $status, 'error' => 'request failed'];
    $data = json_decode($raw, true);
    if ($status < 200 || $status >= 300) return ['ok' => false, 'status' => $status, 'error' => 'eBird returned HTTP ' . $status];
    if (!is_array($data)) return ['ok' => false, 'status' => $status, 'error' => 'bad eBird json'];
    return ['ok' => true, 'status' => $status, 'data' => $data];
}

function days_since_obs(?string $obsDt): ?int {
    if (!$obsDt) return null;
    try {
        $d = new DateTime($obsDt);
        $today = new DateTime('now');
        return max(0, (int)$today->diff($d)->format('%r%a') * -1);
    } catch (Throwable $e) {
        return null;
    }
}

$action = $_GET['action'] ?? 'stats';

switch ($action) {

    case 'stats': {
        $total       = (int)(one($db, 'SELECT COUNT(*) AS n FROM detections')['n'] ?? 0);
        $species     = (int)(one($db, 'SELECT COUNT(DISTINCT Sci_Name) AS n FROM detections')['n'] ?? 0);
        $today       = (int)(one($db, "SELECT COUNT(*) AS n FROM detections WHERE Date = DATE('now','localtime')")['n'] ?? 0);
        $todaySpec   = (int)(one($db, "SELECT COUNT(DISTINCT Sci_Name) AS n FROM detections WHERE Date = DATE('now','localtime')")['n'] ?? 0);
        $lastHour    = (int)(one($db, "SELECT COUNT(*) AS n FROM detections WHERE Date = DATE('now','localtime') AND Time >= TIME('now','localtime','-1 hour')")['n'] ?? 0);
        $week        = (int)(one($db, "SELECT COUNT(*) AS n FROM detections WHERE Date >= DATE('now','localtime','-7 day')")['n'] ?? 0);
        $weekSpec    = (int)(one($db, "SELECT COUNT(DISTINCT Sci_Name) AS n FROM detections WHERE Date >= DATE('now','localtime','-7 day')")['n'] ?? 0);
        $first       = one($db, 'SELECT MIN(Date) AS d FROM detections');
        echo json_encode([
            'totals'    => ['detections' => $total, 'species' => $species],
            'today'     => ['detections' => $today, 'species' => $todaySpec],
            'last_hour' => ['detections' => $lastHour],
            'week'      => ['detections' => $week,  'species' => $weekSpec],
            'started'   => $first['d'] ?? null,
            'as_of'     => date('c'),
        ]);
        break;
    }

    case 'lifelist': {
        // n = total calls (matches the `recent` action's alias so the
        // frontend can read either response interchangeably).
        $rs = rows($db,
          "SELECT Sci_Name AS sci, Com_Name AS com, MIN(Date||' '||Time) AS first_seen, "
        . "       MAX(Date||' '||Time) AS last_seen, COUNT(*) AS n, MAX(Confidence) AS best_conf "
        . "FROM detections GROUP BY Sci_Name ORDER BY first_seen ASC"
        );
        echo json_encode(['species' => $rs, 'as_of' => date('c')]);
        break;
    }

    case 'recent': {
        // Cap raised to 1,000,000 hours (~114 years) so the frontend's
        // "ALL" button can turn off the time filter without needing a
        // separate code path.
        $hours = max(1, min(1000000, (int)($_GET['hours'] ?? 24)));
        // species-collapsed view: one row per species seen in the window,
        // with the file of its highest-confidence detection inside the window.
        $rs = rows($db,
          "SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS n, MAX(Confidence) AS best_conf, "
        . "       MAX(Date||' '||Time) AS last_seen "
        . "FROM detections "
        . "WHERE (julianday('now','localtime') - julianday(Date||' '||Time)) * 24 <= :hrs "
        . "GROUP BY Sci_Name ORDER BY last_seen DESC",
          [':hrs' => $hours]
        );
        // for each row, attach the file of the top-confidence detection in the window
        foreach ($rs as &$r) {
            $best = one($db,
              "SELECT File_Name AS file, Date AS d, Time AS t, Confidence AS conf "
            . "FROM detections "
            . "WHERE Sci_Name = :sn "
            . "AND (julianday('now','localtime') - julianday(Date||' '||Time)) * 24 <= :hrs "
            . "ORDER BY Confidence DESC LIMIT 1",
              [':sn' => $r['sci'], ':hrs' => $hours]
            );
            $r['top_file'] = $best['file'] ?? null;
            $r['top_at']   = isset($best['d']) ? ($best['d'].' '.$best['t']) : null;
        }
        echo json_encode(['hours' => $hours, 'species' => $rs, 'as_of' => date('c')]);
        break;
    }

    case 'species': {
        $sci = $_GET['sci'] ?? '';
        if ($sci === '') { http_response_code(400); echo json_encode(['error' => 'sci= required']); break; }
        $detections = rows($db,
          "SELECT Date AS d, Time AS t, File_Name AS file, Confidence AS conf "
        . "FROM detections WHERE Sci_Name = :sn ORDER BY Date DESC, Time DESC LIMIT 500",
          [':sn' => $sci]
        );
        $summary = one($db,
          "SELECT Com_Name AS com, COUNT(*) AS total, MIN(Date||' '||Time) AS first_seen, "
        . "       MAX(Date||' '||Time) AS last_seen, MAX(Confidence) AS best_conf "
        . "FROM detections WHERE Sci_Name = :sn",
          [':sn' => $sci]
        );
        $byHour = rows($db,
          "SELECT CAST(strftime('%H', Time) AS INT) AS hour, COUNT(*) AS n "
        . "FROM detections WHERE Sci_Name = :sn GROUP BY hour ORDER BY hour",
          [':sn' => $sci]
        );
        $bestHour = null;
        $bestCount = 0;
        $profileTotal = 0;
        foreach ($byHour as $h) {
            $n = (int)($h['n'] ?? 0);
            $profileTotal += $n;
            if ($n > $bestCount) {
                $bestCount = $n;
                $bestHour = (int)$h['hour'];
            }
        }
        echo json_encode([
            'sci' => $sci,
            'summary' => $summary,
            'detections' => $detections,
            'time_profile' => [
                'total' => $profileTotal,
                'best_hour' => $bestHour,
                'hours' => $byHour,
            ],
        ]);
        break;
    }

    case 'timeseries': {
        // Aggregated time-bucketed counts for the stats charts.
        //   daily   - last $days days, detections + unique species per day
        //   by_hour - detections grouped by hour of day, last 30 days
        // The frontend backfills missing dates with zero - sparse data days
        // are otherwise dropped by the GROUP BY.
        $days = max(1, min(90, (int)($_GET['days'] ?? 30)));
        $daily = rows($db,
          "SELECT Date AS date, COUNT(*) AS detections, COUNT(DISTINCT Sci_Name) AS species "
        . "FROM detections "
        . "WHERE Date >= DATE('now','localtime','-".($days - 1)." day') "
        . "GROUP BY Date ORDER BY Date"
        );
        $by_hour = rows($db,
          "SELECT CAST(strftime('%H', Time) AS INT) AS hour, COUNT(*) AS detections "
        . "FROM detections "
        . "WHERE Date >= DATE('now','localtime','-30 day') "
        . "GROUP BY hour ORDER BY hour"
        );
        echo json_encode([
            'days'    => $days,
            'daily'   => $daily,
            'by_hour' => $by_hour,
            'as_of'   => date('c'),
        ]);
        break;
    }


    case 'ebird_nearby': {
        $confPath = dirname(__DIR__, 2) . '/birdnet.conf';
        $conf = read_birdnet_conf($confPath);
        $lat = isset($conf['LATITUDE']) ? (float)$conf['LATITUDE'] : NAN;
        $lng = isset($conf['LONGITUDE']) ? (float)$conf['LONGITUDE'] : NAN;
        $token = ebird_token($conf);
        $dist = max(1, min(50, (int)($_GET['dist'] ?? 25)));
        $back = max(1, min(30, (int)($_GET['back'] ?? 14)));

        if ($token === '') {
            echo json_encode(['configured' => false, 'species' => new stdClass(), 'message' => 'Set EBIRD_API_KEY on the Pi to enable nearby reports.']);
            break;
        }
        if (!is_finite($lat) || !is_finite($lng) || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
            echo json_encode(['configured' => false, 'species' => new stdClass(), 'message' => 'Set LATITUDE and LONGITUDE in birdnet.conf to enable nearby reports.']);
            break;
        }

        $cacheKey = sprintf('avian-ebird-nearby-%s-%s-%d-%d.json', round($lat, 3), round($lng, 3), $dist, $back);
        $cachePath = sys_get_temp_dir() . '/' . preg_replace('/[^A-Za-z0-9_.-]/', '-', $cacheKey);
        $cacheTtl = 6 * 60 * 60;
        if (is_readable($cachePath) && (time() - filemtime($cachePath)) < $cacheTtl) {
            $cached = json_decode((string)file_get_contents($cachePath), true);
            if (is_array($cached)) {
                $cached['cache'] = 'hit';
                echo json_encode($cached);
                break;
            }
        }

        $url = 'https://api.ebird.org/v2/data/obs/geo/recent?' . http_build_query([
            'lat' => $lat,
            'lng' => $lng,
            'dist' => $dist,
            'back' => $back,
            'includeProvisional' => 'true',
        ]);
        $resp = http_json_get($url, [
            'X-eBirdApiToken' => $token,
            'Accept' => 'application/json',
        ]);
        if (!$resp['ok']) {
            http_response_code(502);
            echo json_encode(['configured' => true, 'species' => new stdClass(), 'error' => $resp['error'] ?? 'eBird request failed']);
            break;
        }

        $bySci = [];
        foreach ($resp['data'] as $obs) {
            if (!is_array($obs)) continue;
            $sci = trim((string)($obs['sciName'] ?? ''));
            if ($sci === '') continue;
            $existing = $bySci[$sci] ?? null;
            $obsDt = (string)($obs['obsDt'] ?? '');
            $reports = $existing ? ((int)$existing['reports'] + 1) : 1;
            $howMany = (int)($obs['howMany'] ?? 0);
            $count = ($existing ? (int)$existing['count'] : 0) + max(0, $howMany);
            if (!$existing || strcmp($obsDt, (string)$existing['last_observed']) > 0) {
                $bySci[$sci] = [
                    'sci' => $sci,
                    'com' => (string)($obs['comName'] ?? ''),
                    'species_code' => (string)($obs['speciesCode'] ?? ''),
                    'last_observed' => $obsDt,
                    'days_ago' => days_since_obs($obsDt),
                    'location' => (string)($obs['locName'] ?? ''),
                    'reports' => $reports,
                    'count' => $count,
                ];
            } else {
                $bySci[$sci]['reports'] = $reports;
                $bySci[$sci]['count'] = $count;
            }
        }

        $out = [
            'configured' => true,
            'dist_km' => $dist,
            'back_days' => $back,
            'species' => $bySci,
            'as_of' => date('c'),
            'cache' => 'miss',
        ];
        @file_put_contents($cachePath, json_encode($out));
        echo json_encode($out);
        break;
    }

    case 'firstseen': {
        // Most recent additions to the life list - first detection per
        // species, sorted by first_seen DESC. Powers the "First Detections"
        // section on the stats view.
        $limit = max(1, min(50, (int)($_GET['limit'] ?? 10)));
        $rs = rows($db,
          "SELECT Sci_Name AS sci, Com_Name AS com, MIN(Date||' '||Time) AS first_seen, "
        . "       COUNT(*) AS total "
        . "FROM detections GROUP BY Sci_Name ORDER BY first_seen DESC LIMIT :lim",
          [':lim' => $limit]
        );
        echo json_encode(['species' => $rs, 'as_of' => date('c')]);
        break;
    }

    default:
        http_response_code(404);
        echo json_encode(['error' => 'unknown action']);
}
