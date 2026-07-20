<?php
// Schedule a full Pi restart from the local AvianVisitors menu.
// The five-second delay lets this request finish before Caddy goes away.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (getenv('AV_REQUIRE_AUTH') === '1' && empty($_SERVER['HTTP_AUTHORIZATION'])) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST required']);
    exit;
}

$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body) || ($body['confirm'] ?? '') !== 'restart') {
    http_response_code(400);
    echo json_encode(['error' => 'restart confirmation required']);
    exit;
}

// This exact command is included in the narrow AvianVisitors sudoers
// allowlist installed by scripts/install_services.sh.
$output = [];
$status = 0;
exec('sudo /usr/bin/systemd-run --unit=avian-ui-reboot --on-active=5 /bin/systemctl reboot 2>&1', $output, $status);
if ($status !== 0) {
    http_response_code(500);
    echo json_encode(['error' => 'could not schedule restart']);
    exit;
}

echo json_encode(['ok' => true, 'restart_in_seconds' => 5]);
