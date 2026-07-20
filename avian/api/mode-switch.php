<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$helper = '/usr/local/sbin/avian-mode-switch';
$mode = trim((string)($_POST['mode'] ?? ''));
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!in_array($mode, ['pi', 'bng'], true)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'mode must be pi or bng']);
        exit;
    }
    $output = [];
    $code = 0;
    exec('sudo ' . escapeshellarg($helper) . ' ' . escapeshellarg($mode) . ' 2>&1', $output, $code);
    if ($code !== 0) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => trim(implode("\n", $output)) ?: 'mode switch failed']);
        exit;
    }
}

$output = [];
$code = 0;
exec('sudo ' . escapeshellarg($helper) . ' status 2>&1', $output, $code);
$current = trim((string)end($output));
if ($code !== 0 || !in_array($current, ['pi', 'bng', 'mixed'], true)) $current = 'unknown';
echo json_encode(['ok' => true, 'mode' => $current]);
