<?php
// AvianVisitors - bird image resolver.
//
// Lookup chain for /avian/api/cutout.php?sci=Calypte+anna:
//   1. ../assets/illustrations-<style>/<slug>.png (selected alternate style)
//   2. ../assets/illustrations/<slug>.png         (bundled kachō-e renders)
//   3. ../assets/cutouts/<slug>.png               (background-removed photo)
//   4. cached rembg of a Wikipedia photo at $HOME/BirdSongs/Extracted/cutouts/
//   5. fresh Wikipedia -> rembg -> cache (skipped gracefully if rembg unset)
//
// The frontend's <img src> points here for every species - bundled
// hits return instantly; cold misses fall through to the dynamic path.
//
// Default LAN deploy ships without auth. To expose publicly, gate
// /avian/api/* with basic_auth in your Caddyfile - see avian/forwarding/.

declare(strict_types=1);

$sci = trim((string)($_GET['sci'] ?? ''));
if ($sci === '') {
    http_response_code(400);
    echo 'sci required';
    exit;
}
// Binomial / trinomial pattern. Rejects path-traversal payloads and
// junk before any filesystem or upstream lookup.
if (!preg_match('/^[A-Za-z]{2,40}(?:[ ][a-z]{2,40}){1,3}$/', $sci)) {
    http_response_code(400);
    echo 'invalid sci';
    exit;
}

// Slugify scientific name for filename + cache key.
$slug = preg_replace('/[^a-z0-9]+/', '-', strtolower($sci));
$slug = trim((string)$slug, '-');

// pose=1 (default) is perched. pose=2 is flight. Clamp to a two-digit
// positive integer so a malformed ?pose= can't break the path.
$pose = (int)($_GET['pose'] ?? 1);
if ($pose < 1 || $pose > 99) $pose = 1;
$poseSuffix = $pose === 1 ? '' : "-$pose";
$THUMB_REQUESTED = (string)($_GET['thumb'] ?? '') === '1';

$style = strtolower(trim((string)($_GET['style'] ?? 'gemini')));
$styleDirs = [
    'gemini' => 'illustrations',
    'classic' => 'illustrations',
    'openai-watercolor' => 'illustrations-openai-watercolor',
    'openai-ink' => 'illustrations-openai-ink',
    'openai-paper-cut' => 'illustrations-openai-paper-cut',
    'openai-poster' => 'illustrations-openai-poster',
    'openai-vintage' => 'illustrations-openai-vintage',
    'openai-gouache' => 'illustrations-openai-gouache',
    'openai-minimal' => 'illustrations-openai-minimal',
];
if (!isset($styleDirs[$style]) && preg_match('/^openai-custom-[a-z0-9-]{1,48}$/', $style)) {
    $styleDirs[$style] = 'illustrations-' . $style;
}
if (!isset($styleDirs[$style])) $style = 'gemini';

function serve_png(string $path): void {
    global $THUMB_REQUESTED;
    $contentType = 'image/png';
    if ($THUMB_REQUESTED) {
        $max = 384;
        $useWebp = function_exists('imagewebp');
        $extension = $useWebp ? 'webp' : 'png';
        $mtime = @filemtime($path) ?: 0;
        $cacheDir = sys_get_temp_dir() . '/avian-cutout-thumbs';
        $cachePath = $cacheDir . '/' . hash('sha256', $path . '|' . $mtime . '|' . $max . '|' . $extension) . '.' . $extension;
        if (!is_file($cachePath) || filesize($cachePath) < 512) {
            if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755, true);
            if (function_exists('imagecreatefrompng')) {
                $im = @imagecreatefrompng($path);
                if ($im) {
                    $w = imagesx($im);
                    $h = imagesy($im);
                    $scale = min(1, $max / max($w, $h));
                    $nw = max(1, (int)round($w * $scale));
                    $nh = max(1, (int)round($h * $scale));
                    $resized = imagecreatetruecolor($nw, $nh);
                    imagealphablending($resized, false);
                    imagesavealpha($resized, true);
                    imagecopyresampled($resized, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
                    if ($useWebp) @imagewebp($resized, $cachePath, 78);
                    else @imagepng($resized, $cachePath, 6);
                    imagedestroy($resized);
                    imagedestroy($im);
                }
            } elseif (is_executable('/usr/bin/ffmpeg')) {
                $cmd = '/usr/bin/ffmpeg -y -loglevel error -i ' . escapeshellarg($path)
                    . ' -vf ' . escapeshellarg('scale=384:-2')
                    . ($useWebp ? ' -frames:v 1 -c:v libwebp -q:v 78 ' : ' -frames:v 1 -c:v png -pix_fmt rgba ')
                    . escapeshellarg($cachePath);
                @exec($cmd);
            }
        }
        if (is_file($cachePath) && filesize($cachePath) >= 512) {
            $path = $cachePath;
            $contentType = $useWebp ? 'image/webp' : 'image/png';
        }
    }
    header('Content-Type: ' . $contentType);
    header('Cache-Control: public, max-age=86400');
    header('Content-Length: ' . (string)filesize($path));
    readfile($path);
    exit;
}

// 1-2. Bundled illustration with pose suffix. If the selected style is
// missing for a species, quietly fall back to the classic kachō-e set.
$assetRoot = dirname(__DIR__) . '/assets';
$dirs = [$styleDirs[$style]];
if ($styleDirs[$style] !== 'illustrations') $dirs[] = 'illustrations';
foreach ($dirs as $dir) {
    $bundled = "$assetRoot/$dir/{$slug}{$poseSuffix}.png";
    if (is_file($bundled) && filesize($bundled) > 1024) {
        serve_png($bundled);
    }
    // Pose-2 missing? Fall back to pose-1 in the same style before
    // trying the next style/photo source.
    if ($pose !== 1) {
        $fallback = "$assetRoot/$dir/$slug.png";
        if (is_file($fallback) && filesize($fallback) > 1024) {
            serve_png($fallback);
        }
    }
}
// 3. Bundled cutout (background-removed photo, fallback for species
//    without an illustration).
$cutout = "$assetRoot/cutouts/$slug.png";
if (is_file($cutout) && filesize($cutout) > 1024) {
    serve_png($cutout);
}

// 4. Dynamic cache from a previous Wikipedia + rembg run.
$cacheDir = dirname(__DIR__, 3) . '/BirdSongs/Extracted/cutouts';
$cachePath = "$cacheDir/$slug.png";
if (is_file($cachePath) && filesize($cachePath) > 1024) {
    serve_png($cachePath);
}

// 5. Fresh Wikipedia fetch + rembg. Skipped if rembg-cli isn't on
//    PATH - the resolver returns a 404 in that case rather than
//    burning a Wikipedia request we can't use.
$rembg = '/usr/local/bin/rembg-cli';
if (!is_executable($rembg)) {
    http_response_code(404);
    echo 'no illustration bundled for ' . htmlspecialchars($sci) . ' (install rembg-cli to enable Wikipedia fallback)';
    exit;
}

if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755, true);

// Wikipedia's REST API asks for a contact-able identifier. Override
// via the AV_USER_AGENT env var (set in /etc/php/*/fpm/pool.d/www.conf
// or your shell) if your install hammers their endpoint at scale.
$ua = getenv('AV_USER_AGENT') ?: 'AvianVisitors/1.0 (+https://github.com/Twarner491/AvianVisitors)';
$ctx = stream_context_create([
    'http' => ['header' => "User-Agent: $ua\r\n", 'timeout' => 12],
]);
$wpUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' . rawurlencode($sci);
$wpJson = @file_get_contents($wpUrl, false, $ctx);
$srcUrl = null;
if ($wpJson !== false) {
    $j = json_decode($wpJson, true);
    $srcUrl = $j['originalimage']['source'] ?? $j['thumbnail']['source'] ?? null;
}
// Defensive: only follow URLs on Wikimedia / Wikipedia hosts so a
// poisoned summary endpoint can't redirect us to arbitrary servers.
if ($srcUrl !== null) {
    $host = parse_url((string)$srcUrl, PHP_URL_HOST) ?: '';
    if (!preg_match('/(?:^|\.)(?:wikimedia\.org|wikipedia\.org)$/i', $host)) {
        $srcUrl = null;
    }
}
if (!$srcUrl) {
    http_response_code(404);
    echo 'no Wikipedia photo for ' . htmlspecialchars($sci);
    exit;
}

$imgBytes = @file_get_contents($srcUrl, false, $ctx);
if (!$imgBytes || strlen($imgBytes) < 1024) {
    http_response_code(503);
    echo 'failed to fetch source image';
    exit;
}

// rembg via the wrapper. u2netp = lightweight model (~50MB peak RAM -
// matters on the Pi 3B+). Temp files because rembg's CLI prefers
// real paths.
$tmpInBase  = tempnam(sys_get_temp_dir(), 'rembg-in-');
$tmpOutBase = tempnam(sys_get_temp_dir(), 'rembg-out-');
@unlink($tmpInBase); @unlink($tmpOutBase);
$tmpIn  = $tmpInBase  . '.jpg';
$tmpOut = $tmpOutBase . '.png';
file_put_contents($tmpIn, $imgBytes);

$cmd = sprintf(
    '%s i -m u2netp -ppm %s %s 2>&1',
    escapeshellarg($rembg),
    escapeshellarg($tmpIn),
    escapeshellarg($tmpOut)
);
$out = shell_exec($cmd);
@unlink($tmpIn);

if (!is_file($tmpOut) || filesize($tmpOut) < 1024) {
    @unlink($tmpOut);
    http_response_code(500);
    header('Content-Type: text/plain');
    echo "rembg failed (see your Pi's logs for details)";
    error_log("rembg failed for $sci: " . ($out ?? '(no output)'));
    exit;
}

// Tight-crop to the bird's bounding box + downscale to 800px max edge
// so cache stays small.
$im = @imagecreatefrompng($tmpOut);
if ($im !== false) {
    $cropped = @imagecropauto($im, IMG_CROP_TRANSPARENT);
    if ($cropped !== false) {
        imagedestroy($im);
        $im = $cropped;
    }
    $w = imagesx($im); $h = imagesy($im);
    $max = 800;
    if ($w > $max || $h > $max) {
        $scale = $max / max($w, $h);
        $nw = (int)($w * $scale); $nh = (int)($h * $scale);
        $resized = imagecreatetruecolor($nw, $nh);
        imagealphablending($resized, false);
        imagesavealpha($resized, true);
        imagecopyresampled($resized, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagedestroy($im);
        $im = $resized;
    }
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagepng($im, $tmpOut, 6);
    imagedestroy($im);
}

// Atomic install: rename is atomic on the same filesystem, so any
// concurrent reader either sees the old cached file or the new one,
// never a half-written PNG.
@rename($tmpOut, $cachePath);
serve_png($cachePath);
