<?php
// AvianVisitors - JSON facade over BirdNET-Pi's birds.db. Read-only.
// Symlinked into the BirdNET-Pi Caddy site root at /avian/api/.
//
// Endpoints (?action=...):
//   stats       - totals (detections, unique species, today, last hour)
//   lifelist    - every species with first_seen, last_seen, total_count
//   recent      - &hours=N (default 24): species heard in the window
//   night       - &hours=N: species heard during configured night hours
//   species     - &sci=<sci_name>: per-species detail page
//   timeseries  - &days=N: daily detection counts per species
//   seasonality - weekly species detection counts across the calendar year
//   firstseen   - every species' earliest detection
//   seasonfirst - every species' first detection since Jan 1
//   ebird_nearby - eBird recent nearby reports, matched by scientific name
//   filter_eval - compare recent detections against the prior equal window
//   mic_eval    - compare detections before/after a mic hardware change
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
    $headers = function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : [];
    if (isset($headers[0]) && preg_match('/\s(\d{3})\s/', $headers[0], $m)) {
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
        $from = trim((string)($_GET['from'] ?? ''));
        $fromDate = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $from);
        $hasExactStart = $fromDate !== false && $fromDate->format('Y-m-d H:i:s') === $from;
        $windowWhere = $hasExactStart
          ? "Date||' '||Time >= :from AND Date||' '||Time <= DATETIME('now','localtime')"
          : "(julianday('now','localtime') - julianday(Date||' '||Time)) * 24 <= :hrs";
        $windowBind = $hasExactStart ? [':from' => $from] : [':hrs' => $hours];
        // species-collapsed view: one row per species seen in the window,
        // with the file of its highest-confidence detection inside the window.
        $rs = rows($db,
          "SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS n, MAX(Confidence) AS best_conf, "
        . "       MAX(Date||' '||Time) AS last_seen "
        . "FROM detections "
        . "WHERE $windowWhere "
        . "GROUP BY Sci_Name ORDER BY last_seen DESC",
          $windowBind
        );
        // for each row, attach the file of the top-confidence detection in the window
        foreach ($rs as &$r) {
            $best = one($db,
              "SELECT File_Name AS file, Date AS d, Time AS t, Confidence AS conf "
            . "FROM detections "
            . "WHERE Sci_Name = :sn "
            . "AND $windowWhere "
            . "ORDER BY Confidence DESC LIMIT 1",
              [':sn' => $r['sci']] + $windowBind
            );
            $r['top_file'] = $best['file'] ?? null;
            $r['top_at']   = isset($best['d']) ? ($best['d'].' '.$best['t']) : null;
        }
        echo json_encode(['hours' => $hours, 'from' => $hasExactStart ? $from : null, 'species' => $rs, 'as_of' => date('c')]);
        break;
    }

    case 'night': {
        $hours = max(1, min(1000000, (int)($_GET['hours'] ?? 168)));
        $limit = max(1, min(20, (int)($_GET['limit'] ?? 6)));
        $conf = read_birdnet_conf(dirname(__DIR__, 2) . '/birdnet.conf');
        $startHour = (int)($_GET['night_start'] ?? ($conf['AV_NIGHT_START'] ?? 21));
        $endHour = (int)($_GET['night_end'] ?? ($conf['AV_NIGHT_END'] ?? 5));
        $startHour = max(0, min(23, $startHour));
        $endHour = max(0, min(23, $endHour));
        $startTime = sprintf('%02d:00:00', $startHour);
        $endTime = sprintf('%02d:00:00', $endHour);
        if ($startHour === $endHour) {
            $nightWhere = '';
            $bind = [':hrs' => $hours, ':lim' => $limit];
        } elseif ($startHour < $endHour) {
            $nightWhere = "AND (Time >= :night_start AND Time < :night_end) ";
            $bind = [':hrs' => $hours, ':lim' => $limit, ':night_start' => $startTime, ':night_end' => $endTime];
        } else {
            $nightWhere = "AND (Time >= :night_start OR Time < :night_end) ";
            $bind = [':hrs' => $hours, ':lim' => $limit, ':night_start' => $startTime, ':night_end' => $endTime];
        }
        $rs = rows($db,
          "SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS n, MAX(Confidence) AS best_conf, "
        . "       MIN(Date||' '||Time) AS first_seen, MAX(Date||' '||Time) AS last_seen "
        . "FROM detections "
        . "WHERE (julianday('now','localtime') - julianday(Date||' '||Time)) * 24 <= :hrs "
        . $nightWhere
        . "GROUP BY Sci_Name "
        . "ORDER BY n DESC, last_seen DESC "
        . "LIMIT :lim",
          $bind
        );
        echo json_encode([
            'hours' => $hours,
            'window' => ['start_hour' => $startHour, 'end_hour' => $endHour],
            'species' => $rs,
            'as_of' => date('c'),
        ]);
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
        $byDay = rows($db,
          "SELECT Date AS date, COUNT(*) AS n "
        . "FROM detections WHERE Sci_Name = :sn AND Date >= DATE('now','localtime','-29 day') "
        . "GROUP BY Date ORDER BY Date",
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
            'daily_profile' => [
                'days' => 30,
                'dates' => $byDay,
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

    case 'seasonality': {
        // Weekly "migration calendar" buckets by day-of-year, aggregated
        // across all local detections. week_index is 0..51 so the frontend
        // can render a stable 52-column calendar even across leap years.
        $limit = max(1, min(120, (int)($_GET['limit'] ?? 60)));
        $minTotal = max(1, min(1000, (int)($_GET['min_total'] ?? 1)));
        $cacheKey = sprintf('avian-seasonality-%d-%d.json', $limit, $minTotal);
        $cachePath = sys_get_temp_dir() . '/' . $cacheKey;
        $cacheTtl = 5 * 60;
        $dbMtime = @filemtime($DB_PATH) ?: 0;
        if (is_readable($cachePath) && (time() - filemtime($cachePath)) < $cacheTtl && filemtime($cachePath) >= $dbMtime) {
            $cached = json_decode((string)file_get_contents($cachePath), true);
            if (is_array($cached)) {
                $cached['cache'] = 'hit';
                echo json_encode($cached);
                break;
            }
        }
        $species = rows($db,
          "SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS total, "
        . "       MIN(Date||' '||Time) AS first_seen, MAX(Date||' '||Time) AS last_seen "
        . "FROM detections "
        . "GROUP BY Sci_Name "
        . "HAVING total >= :min_total "
        . "ORDER BY total DESC, com ASC "
        . "LIMIT :lim",
          [':min_total' => $minTotal, ':lim' => $limit]
        );
        $weeks = rows($db,
          "SELECT Sci_Name AS sci, "
        . "       MIN(51, CAST((CAST(strftime('%j', Date) AS INT) - 1) / 7 AS INT)) AS week_index, "
        . "       COUNT(*) AS n "
        . "FROM detections "
        . "WHERE Sci_Name IN ("
        . "  SELECT Sci_Name FROM detections GROUP BY Sci_Name HAVING COUNT(*) >= :min_total "
        . "  ORDER BY COUNT(*) DESC, Com_Name ASC LIMIT :lim"
        . ") "
        . "GROUP BY Sci_Name, week_index "
        . "ORDER BY Sci_Name, week_index",
          [':min_total' => $minTotal, ':lim' => $limit]
        );
        $bySci = [];
        foreach ($species as $s) {
            $sci = (string)($s['sci'] ?? '');
            if ($sci === '') continue;
            $bySci[$sci] = array_merge($s, [
                'weeks' => array_fill(0, 52, 0),
                'peak_week' => null,
                'peak_count' => 0,
                'arrival_week' => null,
                'departure_week' => null,
            ]);
        }
        foreach ($weeks as $w) {
            $sci = (string)($w['sci'] ?? '');
            if (!isset($bySci[$sci])) continue;
            $idx = max(0, min(51, (int)($w['week_index'] ?? 0)));
            $n = (int)($w['n'] ?? 0);
            $bySci[$sci]['weeks'][$idx] = $n;
            if ($n > (int)$bySci[$sci]['peak_count']) {
                $bySci[$sci]['peak_count'] = $n;
                $bySci[$sci]['peak_week'] = $idx;
            }
        }
        foreach ($bySci as &$s) {
            $peak = max(1, (int)$s['peak_count']);
            $threshold = max(1, min(5, (int)ceil($peak * 0.15)));
            for ($i = 0; $i < 52; $i++) {
                if ((int)$s['weeks'][$i] >= $threshold) {
                    $s['arrival_week'] = $i;
                    break;
                }
            }
            for ($i = 51; $i >= 0; $i--) {
                if ((int)$s['weeks'][$i] >= $threshold) {
                    $s['departure_week'] = $i;
                    break;
                }
            }
        }
        unset($s);
        $total = (int)(one($db, 'SELECT COUNT(*) AS n FROM detections')['n'] ?? 0);
        $out = [
            'weeks' => 52,
            'species' => array_values($bySci),
            'total_detections' => $total,
            'as_of' => date('c'),
            'cache' => 'miss',
        ];
        @file_put_contents($cachePath, json_encode($out));
        echo json_encode($out);
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

    case 'seasonfirst': {
        // First detection per species since Jan 1 of the current local
        // calendar year. This is a backyard "season list" marker rather
        // than an all-time life-list marker.
        $limit = max(1, min(100, (int)($_GET['limit'] ?? 20)));
        $seasonStart = date('Y') . '-01-01';
        $rs = rows($db,
          "SELECT Sci_Name AS sci, Com_Name AS com, MIN(Date||' '||Time) AS first_seen, "
        . "       COUNT(*) AS season_total "
        . "FROM detections "
        . "WHERE Date >= :season_start "
        . "GROUP BY Sci_Name "
        . "ORDER BY first_seen DESC LIMIT :lim",
          [':season_start' => $seasonStart, ':lim' => $limit]
        );
        echo json_encode([
            'season_start' => $seasonStart,
            'species' => $rs,
            'as_of' => date('c'),
        ]);
        break;
    }

    case 'filter_eval': {
        // Compares the most recent window to the immediately preceding
        // equal window. Existing detections do not record whether the
        // audio filter was enabled, so this is a practical A/B signal,
        // not a controlled lab result.
        $hours = max(1, min(168, (int)($_GET['hours'] ?? 24)));
        $high = max(0.5, min(0.99, (float)($_GET['high'] ?? 0.80)));
        $low = max(0.01, min($high, (float)($_GET['low'] ?? 0.60)));
        $age = "(julianday('now','localtime') - julianday(Date||' '||Time)) * 24";

        $summary = function (float $minAge, float $maxAge) use ($db, $age, $high, $low, $hours): array {
            $r = one($db,
              "SELECT COUNT(*) AS detections, COUNT(DISTINCT Sci_Name) AS species, "
            . "       AVG(Confidence) AS avg_conf, "
            . "       SUM(CASE WHEN Confidence >= :high THEN 1 ELSE 0 END) AS high_count, "
            . "       SUM(CASE WHEN Confidence < :low THEN 1 ELSE 0 END) AS low_count, "
            . "       MIN(Date||' '||Time) AS oldest, MAX(Date||' '||Time) AS newest "
            . "FROM detections WHERE $age > :min_age AND $age <= :max_age",
              [':min_age' => $minAge, ':max_age' => $maxAge, ':high' => $high, ':low' => $low]
            ) ?: [];
            $detections = (int)($r['detections'] ?? 0);
            $highCount = (int)($r['high_count'] ?? 0);
            $lowCount = (int)($r['low_count'] ?? 0);
            return [
                'detections' => $detections,
                'species' => (int)($r['species'] ?? 0),
                'avg_conf' => $r['avg_conf'] === null ? null : round((float)$r['avg_conf'], 4),
                'high_count' => $highCount,
                'low_count' => $lowCount,
                'high_rate' => $detections ? round($highCount / $detections, 4) : null,
                'low_rate' => $detections ? round($lowCount / $detections, 4) : null,
                'detections_per_hour' => round($detections / max(1, $hours), 3),
                'oldest' => $r['oldest'] ?? null,
                'newest' => $r['newest'] ?? null,
            ];
        };

        $speciesRows = function (float $minAge, float $maxAge) use ($db, $age): array {
            return rows($db,
              "SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS n, "
            . "       AVG(Confidence) AS avg_conf, MAX(Confidence) AS best_conf, "
            . "       MAX(Date||' '||Time) AS last_seen "
            . "FROM detections WHERE $age > :min_age AND $age <= :max_age "
            . "GROUP BY Sci_Name ORDER BY n DESC, best_conf DESC",
              [':min_age' => $minAge, ':max_age' => $maxAge]
            );
        };

        $before = $summary((float)$hours, (float)$hours * 2);
        $after = $summary(0.0, (float)$hours);
        $beforeSpecies = $speciesRows((float)$hours, (float)$hours * 2);
        $afterSpecies = $speciesRows(0.0, (float)$hours);

        $beforeMap = [];
        foreach ($beforeSpecies as $s) $beforeMap[(string)$s['sci']] = $s;
        $afterMap = [];
        foreach ($afterSpecies as $s) $afterMap[(string)$s['sci']] = $s;
        $retained = 0;
        foreach ($afterMap as $sci => $_) if (isset($beforeMap[$sci])) $retained++;
        $lost = [];
        foreach ($beforeSpecies as $s) if (!isset($afterMap[(string)$s['sci']]) && count($lost) < 8) $lost[] = $s;
        $gained = [];
        foreach ($afterSpecies as $s) if (!isset($beforeMap[(string)$s['sci']]) && count($gained) < 8) $gained[] = $s;

        $deltaAvg = ($after['avg_conf'] === null || $before['avg_conf'] === null) ? null : round($after['avg_conf'] - $before['avg_conf'], 4);
        $deltaHigh = ($after['high_rate'] === null || $before['high_rate'] === null) ? null : round($after['high_rate'] - $before['high_rate'], 4);
        $deltaLow = ($after['low_rate'] === null || $before['low_rate'] === null) ? null : round($after['low_rate'] - $before['low_rate'], 4);
        $retention = count($beforeMap) ? round($retained / count($beforeMap), 4) : null;
        $score = 0.0;
        $enough = $before['detections'] >= 5 && $after['detections'] >= 5;
        if ($enough) {
            if ($deltaAvg !== null) $score += max(-10, min(10, $deltaAvg * 100));
            if ($deltaHigh !== null) $score += max(-8, min(8, $deltaHigh * 20));
            if ($deltaLow !== null) $score -= max(-8, min(8, $deltaLow * 20));
            if ($retention !== null) $score += max(-4, min(4, ($retention - 0.75) * 8));
        }
        if (!$enough) {
            $label = 'not enough data';
            $tone = 'neutral';
            $explain = 'Need at least 5 detections in both windows for a useful comparison.';
        } elseif ($score >= 4) {
            $label = 'likely helping';
            $tone = 'good';
            $explain = 'Recent detections look stronger than the previous comparable window.';
        } elseif ($score <= -4) {
            $label = 'possibly hurting';
            $tone = 'warn';
            $explain = 'Recent detections look weaker than the previous comparable window.';
        } else {
            $label = 'inconclusive';
            $tone = 'neutral';
            $explain = 'The confidence and species changes are too small to call.';
        }

        $conf = read_birdnet_conf(dirname(__DIR__, 2) . '/birdnet.conf');
        echo json_encode([
            'hours' => $hours,
            'thresholds' => ['high' => $high, 'low' => $low],
            'settings' => [
                'filter_enabled' => (int)($conf['AV_AUDIO_FILTER'] ?? 0) === 1,
                'highpass' => (int)($conf['AV_FILTER_HIGHPASS'] ?? 300),
                'lowpass' => (int)($conf['AV_FILTER_LOWPASS'] ?? 10000),
            ],
            'before' => $before,
            'after' => $after,
            'delta' => [
                'avg_conf' => $deltaAvg,
                'high_rate' => $deltaHigh,
                'low_rate' => $deltaLow,
                'species_retention' => $retention,
                'score' => round($score, 2),
            ],
            'species' => [
                'retained' => $retained,
                'lost' => $lost,
                'gained' => $gained,
            ],
            'verdict' => ['label' => $label, 'tone' => $tone, 'explain' => $explain],
            'as_of' => date('c'),
        ]);
        break;
    }

    case 'mic_eval': {
        // Hardware comparison: the user supplies the upgrade/change time,
        // and we compare an equal-length window before and after it.
        $hours = max(1, min(720, (int)($_GET['hours'] ?? 24)));
        $changedAtRaw = trim((string)($_GET['changed_at'] ?? ''));
        $upgradeLabel = trim((string)($_GET['label'] ?? ''));
        $upgradeLabel = substr($upgradeLabel, 0, 80);
        $high = max(0.5, min(0.99, (float)($_GET['high'] ?? 0.80)));
        $low = max(0.01, min($high, (float)($_GET['low'] ?? 0.60)));
        if ($changedAtRaw === '') {
            $changedAtDb = (string)(one($db, "SELECT strftime('%Y-%m-%d %H:%M:00','now','localtime') AS t")['t'] ?? '');
        } else {
            $changedAtDb = str_replace('T', ' ', $changedAtRaw);
            if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $changedAtDb)) {
                $changedAtDb .= ':00';
            }
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $changedAtDb)) {
            http_response_code(400);
            echo json_encode(['error' => 'invalid changed_at']);
            break;
        }
        $minus = '-' . $hours . ' hours';
        $plus = '+' . $hours . ' hours';
        $win = one($db,
          "SELECT datetime(:changed) AS changed_at, "
        . "       datetime(:changed, :minus) AS before_start, "
        . "       datetime(:changed) AS before_end, "
        . "       datetime(:changed) AS after_start, "
        . "       CASE WHEN julianday(datetime('now','localtime')) < julianday(datetime(:changed, :plus)) "
        . "            THEN strftime('%Y-%m-%d %H:%M:%S','now','localtime') "
        . "            ELSE datetime(:changed, :plus) END AS after_end, "
        . "       (julianday(datetime(:changed)) - julianday(datetime(:changed, :minus))) * 24.0 AS before_hours, "
        . "       (julianday(CASE WHEN julianday(datetime('now','localtime')) < julianday(datetime(:changed, :plus)) "
        . "            THEN strftime('%Y-%m-%d %H:%M:%S','now','localtime') "
        . "            ELSE datetime(:changed, :plus) END) - julianday(datetime(:changed))) * 24.0 AS after_hours",
          [':changed' => $changedAtDb, ':minus' => $minus, ':plus' => $plus]
        ) ?: [];
        if (empty($win['changed_at'])) {
            http_response_code(400);
            echo json_encode(['error' => 'invalid changed_at']);
            break;
        }
        $beforeStart = (string)$win['before_start'];
        $beforeEnd = (string)$win['before_end'];
        $afterStart = (string)$win['after_start'];
        $afterEnd = (string)$win['after_end'];
        $beforeHours = max(0.01, (float)($win['before_hours'] ?? $hours));
        $afterHours = max(0.01, (float)($win['after_hours'] ?? 0.01));

        $summary = function (string $start, string $end, float $spanHours) use ($db, $high, $low): array {
            $r = one($db,
              "SELECT COUNT(*) AS detections, COUNT(DISTINCT Sci_Name) AS species, "
            . "       AVG(Confidence) AS avg_conf, "
            . "       SUM(CASE WHEN Confidence >= :high THEN 1 ELSE 0 END) AS high_count, "
            . "       SUM(CASE WHEN Confidence < :low THEN 1 ELSE 0 END) AS low_count, "
            . "       MIN(Date||' '||Time) AS oldest, MAX(Date||' '||Time) AS newest "
            . "FROM detections WHERE Date||' '||Time >= :start AND Date||' '||Time < :end",
              [':start' => $start, ':end' => $end, ':high' => $high, ':low' => $low]
            ) ?: [];
            $detections = (int)($r['detections'] ?? 0);
            $highCount = (int)($r['high_count'] ?? 0);
            $lowCount = (int)($r['low_count'] ?? 0);
            return [
                'detections' => $detections,
                'species' => (int)($r['species'] ?? 0),
                'avg_conf' => $r['avg_conf'] === null ? null : round((float)$r['avg_conf'], 4),
                'high_count' => $highCount,
                'low_count' => $lowCount,
                'high_rate' => $detections ? round($highCount / $detections, 4) : null,
                'low_rate' => $detections ? round($lowCount / $detections, 4) : null,
                'detections_per_hour' => round($detections / max(0.01, $spanHours), 3),
                'oldest' => $r['oldest'] ?? null,
                'newest' => $r['newest'] ?? null,
                'hours_observed' => round($spanHours, 2),
            ];
        };

        $speciesRows = function (string $start, string $end) use ($db): array {
            return rows($db,
              "SELECT Sci_Name AS sci, Com_Name AS com, COUNT(*) AS n, "
            . "       AVG(Confidence) AS avg_conf, MAX(Confidence) AS best_conf, "
            . "       MAX(Date||' '||Time) AS last_seen "
            . "FROM detections WHERE Date||' '||Time >= :start AND Date||' '||Time < :end "
            . "GROUP BY Sci_Name ORDER BY n DESC, best_conf DESC",
              [':start' => $start, ':end' => $end]
            );
        };

        $before = $summary($beforeStart, $beforeEnd, $beforeHours);
        $after = $summary($afterStart, $afterEnd, $afterHours);
        $beforeSpecies = $speciesRows($beforeStart, $beforeEnd);
        $afterSpecies = $speciesRows($afterStart, $afterEnd);

        $beforeMap = [];
        foreach ($beforeSpecies as $s) $beforeMap[(string)$s['sci']] = $s;
        $afterMap = [];
        foreach ($afterSpecies as $s) $afterMap[(string)$s['sci']] = $s;
        $retained = 0;
        foreach ($afterMap as $sci => $_) if (isset($beforeMap[$sci])) $retained++;
        $lost = [];
        foreach ($beforeSpecies as $s) if (!isset($afterMap[(string)$s['sci']]) && count($lost) < 8) $lost[] = $s;
        $gained = [];
        foreach ($afterSpecies as $s) if (!isset($beforeMap[(string)$s['sci']]) && count($gained) < 8) $gained[] = $s;

        $deltaRate = round($after['detections_per_hour'] - $before['detections_per_hour'], 3);
        $deltaAvg = ($after['avg_conf'] === null || $before['avg_conf'] === null) ? null : round($after['avg_conf'] - $before['avg_conf'], 4);
        $deltaHigh = ($after['high_rate'] === null || $before['high_rate'] === null) ? null : round($after['high_rate'] - $before['high_rate'], 4);
        $deltaLow = ($after['low_rate'] === null || $before['low_rate'] === null) ? null : round($after['low_rate'] - $before['low_rate'], 4);
        $deltaSpecies = $after['species'] - $before['species'];
        $rateLift = $before['detections_per_hour'] > 0 ? round($deltaRate / $before['detections_per_hour'], 4) : null;

        $score = 0.0;
        $enough = $before['detections'] >= 5 && $after['detections'] >= 5;
        if ($enough) {
            if ($rateLift !== null) $score += max(-10, min(10, $rateLift * 12));
            if ($deltaAvg !== null) $score += max(-8, min(8, $deltaAvg * 100));
            if ($deltaHigh !== null) $score += max(-6, min(6, $deltaHigh * 18));
            if ($deltaLow !== null) $score -= max(-5, min(5, $deltaLow * 12));
            $score += max(-4, min(4, $deltaSpecies * 0.8));
        }
        if (!$enough) {
            $label = 'not enough data';
            $tone = 'neutral';
            $explain = 'Need at least 5 detections before and after the hardware change.';
        } elseif ($score >= 5) {
            $label = 'upgrade looks better';
            $tone = 'good';
            $explain = 'Detection rate, confidence, or species coverage improved after the change.';
        } elseif ($score <= -5) {
            $label = 'upgrade may be worse';
            $tone = 'warn';
            $explain = 'The after window is weaker than the baseline. Check gain, clipping, and aiming.';
        } else {
            $label = 'inconclusive';
            $tone = 'neutral';
            $explain = 'The before/after difference is not strong enough to call yet.';
        }

        echo json_encode([
            'hours' => $hours,
            'label' => $upgradeLabel,
            'changed_at' => str_replace(' ', 'T', substr((string)$win['changed_at'], 0, 16)),
            'thresholds' => ['high' => $high, 'low' => $low],
            'windows' => [
                'before' => ['start' => $beforeStart, 'end' => $beforeEnd],
                'after' => ['start' => $afterStart, 'end' => $afterEnd],
            ],
            'before' => $before,
            'after' => $after,
            'delta' => [
                'detections_per_hour' => $deltaRate,
                'rate_lift' => $rateLift,
                'avg_conf' => $deltaAvg,
                'high_rate' => $deltaHigh,
                'low_rate' => $deltaLow,
                'species' => $deltaSpecies,
                'score' => round($score, 2),
            ],
            'species' => [
                'retained' => $retained,
                'lost' => $lost,
                'gained' => $gained,
            ],
            'verdict' => ['label' => $label, 'tone' => $tone, 'explain' => $explain],
            'as_of' => date('c'),
        ]);
        break;
    }

    default:
        http_response_code(404);
        echo json_encode(['error' => 'unknown action']);
}
