<?php
// AvianVisitors - delete one specific BirdNET detection recording.
//
// POST JSON:
//   { "file": "...mp3", "sci": "Genus species", "date": "YYYY-MM-DD", "time": "HH:MM:SS" }
//
// The filename is resolved under BirdSongs/Extracted/By_Date only, then the
// matching birds.db row is removed by rowid. This intentionally does not
// support bulk deletion.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (getenv('AV_REQUIRE_AUTH') === '1' && empty($_SERVER['HTTP_AUTHORIZATION'])) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST required']);
    exit;
}

$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid json']);
    exit;
}

$file = trim((string)($body['file'] ?? ''));
$sci  = trim((string)($body['sci'] ?? ''));
$date = trim((string)($body['date'] ?? ''));
$time = trim((string)($body['time'] ?? ''));

if ($file === '' || !preg_match("/^[A-Za-z0-9_.:'-]+\\.mp3$/", $file)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid file']);
    exit;
}
if ($sci !== '' && !preg_match('/^[A-Za-z]{2,40}(?:[ ][a-z]{2,40}){1,3}$/', $sci)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid sci']);
    exit;
}
if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid date']);
    exit;
}
if ($time !== '' && !preg_match('/^\d{2}:\d{2}:\d{2}$/', $time)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid time']);
    exit;
}

$BIRDNETPI_DIR = dirname(__DIR__, 2);
$DB_PATH = $BIRDNETPI_DIR . '/scripts/birds.db';
$BY_DATE = dirname(__DIR__, 3) . '/BirdSongs/Extracted/By_Date';

function json_fail(int $code, string $message): void {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

function find_recording_path(string $root, string $file, string $date = ''): ?string {
    $dates = [];
    if ($date !== '') $dates[] = $date;
    if (is_dir($root)) {
        foreach (scandir($root, SCANDIR_SORT_DESCENDING) ?: [] as $d) {
            if ($d === '' || $d[0] === '.' || ($date !== '' && $d !== $date)) continue;
            if (!in_array($d, $dates, true)) $dates[] = $d;
        }
    }
    foreach ($dates as $d) {
        $dayDir = "$root/$d";
        if (!is_dir($dayDir)) continue;
        foreach (scandir($dayDir) ?: [] as $sub) {
            if ($sub === '' || $sub[0] === '.') continue;
            $p = "$dayDir/$sub/$file";
            if (is_file($p)) return $p;
        }
    }
    return null;
}

if (!is_file($DB_PATH)) json_fail(500, 'birds.db not found');
$path = find_recording_path($BY_DATE, $file, $date);
if ($path === null) json_fail(404, 'recording not found');

$realRoot = realpath($BY_DATE);
$realPath = realpath($path);
if ($realRoot === false || $realPath === false || strpos($realPath, $realRoot . DIRECTORY_SEPARATOR) !== 0) {
    json_fail(400, 'recording outside library');
}

try {
    $db = new SQLite3($DB_PATH, SQLITE3_OPEN_READWRITE);
    $db->busyTimeout(3000);
} catch (Throwable $e) {
    json_fail(500, 'db open failed');
}

$where = ['File_Name = :file'];
$bind = [':file' => $file];
if ($sci !== '')  { $where[] = 'Sci_Name = :sci'; $bind[':sci'] = $sci; }
if ($date !== '') { $where[] = 'Date = :date';     $bind[':date'] = $date; }
if ($time !== '') { $where[] = 'Time = :time';     $bind[':time'] = $time; }

$stmt = $db->prepare('SELECT rowid AS rid, Sci_Name AS sci, Date AS d, Time AS t, File_Name AS file FROM detections WHERE ' . implode(' AND ', $where) . ' ORDER BY Date DESC, Time DESC LIMIT 1');
foreach ($bind as $k => $v) $stmt->bindValue($k, $v, SQLITE3_TEXT);
$row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
if (!$row) json_fail(404, 'detection row not found');

$png = preg_replace('/\.mp3$/i', '.png', $realPath);
$deletedFiles = [];
$db->exec('BEGIN IMMEDIATE');
try {
    if (!@unlink($realPath)) {
        $db->exec('ROLLBACK');
        json_fail(500, 'could not delete recording');
    }
    $deletedFiles[] = basename($realPath);
    if (is_string($png) && is_file($png) && @unlink($png)) {
        $deletedFiles[] = basename($png);
    }

    $del = $db->prepare('DELETE FROM detections WHERE rowid = :rid');
    $del->bindValue(':rid', (int)$row['rid'], SQLITE3_INTEGER);
    $del->execute();
    $db->exec('COMMIT');
} catch (Throwable $e) {
    $db->exec('ROLLBACK');
    json_fail(500, 'delete failed');
}

echo json_encode([
    'ok' => true,
    'deleted' => [
        'file' => $file,
        'sci' => $row['sci'] ?? $sci,
        'date' => $row['d'] ?? $date,
        'time' => $row['t'] ?? $time,
        'files' => $deletedFiles,
    ],
]);

