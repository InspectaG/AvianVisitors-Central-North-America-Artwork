<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

$DB_PATH = dirname(__DIR__, 2) . '/scripts/birds.db';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST required']);
    exit;
}

$raw = file_get_contents('php://input');
$body = json_decode((string)$raw, true);
$range = trim((string)($body['range'] ?? ''));

if (!in_array($range, ['1d', '1w', 'all'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'range must be "1d", "1w", or "all"']);
    exit;
}

if (!file_exists($DB_PATH)) {
    http_response_code(503);
    echo json_encode(['error' => 'birds.db not found']);
    exit;
}

try {
    $db = new SQLite3($DB_PATH);
    $db->busyTimeout(5000);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'db open failed']);
    exit;
}

switch ($range) {
    case '1d':
        $count = $db->querySingle("SELECT COUNT(*) FROM detections WHERE Date = DATE('now','localtime')");
        $db->exec("DELETE FROM detections WHERE Date = DATE('now','localtime')");
        break;
    case '1w':
        $count = $db->querySingle("SELECT COUNT(*) FROM detections WHERE Date >= DATE('now','localtime','-7 day')");
        $db->exec("DELETE FROM detections WHERE Date >= DATE('now','localtime','-7 day')");
        break;
    case 'all':
        $count = $db->querySingle("SELECT COUNT(*) FROM detections");
        $db->exec("DELETE FROM detections");
        break;
}

$db->exec("VACUUM");
$db->close();

echo json_encode(['ok' => true, 'range' => $range, 'deleted' => (int)$count]);
