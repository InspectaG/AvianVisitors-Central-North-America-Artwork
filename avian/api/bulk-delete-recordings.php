<?php
// AvianVisitors - preview and bulk-delete BirdNET detection recordings.
//
// GET  ?action=preview&hours=N
// POST { "hours": N, "confirm": "DELETE" }
//
// N is a recent-hours window. Use 1000000 for all time, matching the
// frontend window picker convention.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (getenv('AV_REQUIRE_AUTH') === '1' && empty($_SERVER['HTTP_AUTHORIZATION'])) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$BIRDNETPI_DIR = dirname(__DIR__, 2);
$DB_PATH = $BIRDNETPI_DIR . '/scripts/birds.db';
$BY_DATE = dirname(__DIR__, 3) . '/BirdSongs/Extracted/By_Date';
$ALL_TIME_HOURS = 1000000;
$MAX_DELETE_ROWS = 250000;

function json_fail(int $code, string $message, array $extra = []): void {
    http_response_code($code);
    echo json_encode(['error' => $message] + $extra);
    exit;
}

function parse_hours($raw, int $allTimeHours): int {
    $hours = (int)$raw;
    if ($hours >= $allTimeHours) return $allTimeHours;
    return max(1, min($allTimeHours, $hours));
}

function window_where(int $hours, int $allTimeHours): array {
    if ($hours >= $allTimeHours) return ['', []];
    return [
        "WHERE (julianday('now','localtime') - julianday(Date||' '||Time)) * 24 <= :hrs",
        [':hrs' => $hours],
    ];
}

function bind_values(SQLite3Stmt $stmt, array $bind): void {
    foreach ($bind as $k => $v) {
        $stmt->bindValue($k, is_int($v) ? $v : (string)$v, is_int($v) ? SQLITE3_INTEGER : SQLITE3_TEXT);
    }
}

function rows(SQLite3 $db, string $sql, array $bind = []): array {
    $stmt = $db->prepare($sql);
    bind_values($stmt, $bind);
    $res = $stmt->execute();
    $out = [];
    while ($row = $res->fetchArray(SQLITE3_ASSOC)) $out[] = $row;
    return $out;
}

function find_recording_path(string $root, string $file, string $date): ?string {
    if ($file === '' || !preg_match("/^[A-Za-z0-9_.:'-]+\\.mp3$/", $file)) return null;
    if ($date === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return null;
    $dayDir = "$root/$date";
    if (!is_dir($dayDir)) return null;
    foreach (scandir($dayDir) ?: [] as $sub) {
        if ($sub === '' || $sub[0] === '.') continue;
        $p = "$dayDir/$sub/$file";
        if (is_file($p)) return $p;
    }
    return null;
}

function selected_summary(SQLite3 $db, int $hours, int $allTimeHours): array {
    [$where, $bind] = window_where($hours, $allTimeHours);
    $row = rows($db,
        "SELECT COUNT(*) AS detections, COUNT(DISTINCT Sci_Name) AS species, "
      . "MIN(Date||' '||Time) AS oldest, MAX(Date||' '||Time) AS newest "
      . "FROM detections $where",
        $bind
    )[0] ?? [];
    return [
        'detections' => (int)($row['detections'] ?? 0),
        'species' => (int)($row['species'] ?? 0),
        'oldest' => $row['oldest'] ?? null,
        'newest' => $row['newest'] ?? null,
    ];
}

if (!is_file($DB_PATH)) json_fail(500, 'birds.db not found');

try {
    $db = new SQLite3($DB_PATH, SQLITE3_OPEN_READWRITE);
    $db->busyTimeout(5000);
} catch (Throwable $e) {
    json_fail(500, 'db open failed');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $action = (string)($_GET['action'] ?? 'preview');
    if ($action !== 'preview') json_fail(400, 'unknown action');
    $hours = parse_hours($_GET['hours'] ?? 24, $ALL_TIME_HOURS);
    echo json_encode([
        'ok' => true,
        'hours' => $hours,
        'all_time' => $hours >= $ALL_TIME_HOURS,
        'summary' => selected_summary($db, $hours, $ALL_TIME_HOURS),
    ]);
    exit;
}

if ($method !== 'POST') json_fail(405, 'GET or POST required');

$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) json_fail(400, 'invalid json');

$hours = parse_hours($body['hours'] ?? 24, $ALL_TIME_HOURS);
$confirm = trim((string)($body['confirm'] ?? ''));
if ($confirm !== 'DELETE') json_fail(400, 'confirmation required');

[$where, $bind] = window_where($hours, $ALL_TIME_HOURS);
$summary = selected_summary($db, $hours, $ALL_TIME_HOURS);
if ($summary['detections'] === 0) {
    echo json_encode(['ok' => true, 'hours' => $hours, 'deleted' => ['detections' => 0, 'files' => 0, 'missing_files' => 0], 'summary' => $summary]);
    exit;
}
if ($summary['detections'] > $MAX_DELETE_ROWS) {
    json_fail(413, 'too many detections selected', ['limit' => $MAX_DELETE_ROWS, 'summary' => $summary]);
}

$records = rows($db,
    "SELECT rowid AS rid, Date AS d, Time AS t, Sci_Name AS sci, File_Name AS file "
  . "FROM detections $where ORDER BY Date DESC, Time DESC",
    $bind
);

$realRoot = realpath($BY_DATE);
if ($realRoot === false) json_fail(500, 'recording library not found');

$paths = [];
$missing = 0;
$blocked = [];
foreach ($records as $row) {
    $path = find_recording_path($BY_DATE, (string)($row['file'] ?? ''), (string)($row['d'] ?? ''));
    if ($path === null) {
        $missing += 1;
        continue;
    }
    $realPath = realpath($path);
    if ($realPath === false || strpos($realPath, $realRoot . DIRECTORY_SEPARATOR) !== 0) {
        $blocked[] = basename($path);
        continue;
    }
    if (!is_writable(dirname($realPath))) {
        $blocked[] = basename($realPath);
        continue;
    }
    $paths[] = $realPath;
}

if ($blocked) {
    json_fail(500, 'recordings are not writable', ['blocked' => array_slice($blocked, 0, 8)]);
}

$deletedFiles = 0;
$deletedPngs = 0;
$db->exec('BEGIN IMMEDIATE');
try {
    foreach ($paths as $realPath) {
        if (is_file($realPath) && !@unlink($realPath)) {
            throw new RuntimeException('file delete failed');
        }
        $deletedFiles += 1;
        $png = preg_replace('/\.mp3$/i', '.png', $realPath);
        if (is_string($png) && is_file($png) && @unlink($png)) $deletedPngs += 1;
    }
    $del = $db->prepare("DELETE FROM detections $where");
    bind_values($del, $bind);
    $del->execute();
    $db->exec('COMMIT');
} catch (Throwable $e) {
    $db->exec('ROLLBACK');
    json_fail(500, 'bulk delete failed');
}

echo json_encode([
    'ok' => true,
    'hours' => $hours,
    'deleted' => [
        'detections' => $summary['detections'],
        'files' => $deletedFiles,
        'spectrograms' => $deletedPngs,
        'missing_files' => $missing,
    ],
    'summary' => $summary,
]);
