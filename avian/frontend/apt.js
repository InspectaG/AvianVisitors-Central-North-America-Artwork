(function () {
  var PLACEHOLDER = [{"sci":"Calypte anna","com":"Anna's Hummingbird","featured":true},{"sci":"Passer domesticus","com":"House Sparrow"},{"sci":"Haemorhous mexicanus","com":"House Finch"},{"sci":"Turdus migratorius","com":"American Robin"},{"sci":"Zenaida macroura","com":"Mourning Dove"},{"sci":"Spinus psaltria","com":"Lesser Goldfinch"},{"sci":"Zonotrichia leucophrys","com":"White-crowned Sparrow"},{"sci":"Aphelocoma californica","com":"California Scrub-Jay"},{"sci":"Mimus polyglottos","com":"Northern Mockingbird"},{"sci":"Sayornis nigricans","com":"Black Phoebe"},{"sci":"Larus occidentalis","com":"Western Gull"},{"sci":"Corvus brachyrhynchos","com":"American Crow"}];
  // Bumped whenever the offline sketch build changes, so the browser
  // doesn't keep a stale cache after we regenerate the sketches.
  var SKETCH_VERSION = '23'; // tightened custom bird artboards.
  // Cache-bust for /api/img - bump whenever a bird gets re-rendered via
  // /api/regen or whenever you need every CF DC to drop its cached copy.
  // Cloudflare keys on the full URL incl. query, so bumping this is
  // equivalent to a global cache purge for /api/img. (caches.default
  // .delete() in the worker only affects ONE colo at a time, so a
  // versioned URL is the only reliable way to invalidate everywhere.)
  var IMG_VERSION = '14'; // tightened custom bird artboards.
  var publicMirror = document.body.classList.contains('av-public');
  var API_BASE = location.pathname.indexOf('/avian/frontend/') !== -1 ? '/avian/api/' : './avian/api/';
  var SITE_TIME_ZONE = 'America/New_York';
  var SITE_TIME_LABEL = 'ET';

  function apiUrl(path) {
    return API_BASE + String(path).replace(/^\/+/, '');
  }

  function wallTimeToSiteMs(value) {
    var m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return NaN;
    var target = {
      year: +m[1],
      month: +m[2],
      day: +m[3],
      hour: +m[4],
      minute: +m[5],
      second: +(m[6] || 0)
    };
    var targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
    var guess = targetAsUtc;
    for (var i = 0; i < 3; i++) {
      var p = siteParts(guess);
      var guessSiteAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      var delta = targetAsUtc - guessSiteAsUtc;
      if (!delta) break;
      guess += delta;
    }
    return guess;
  }

  function parseSiteTs(value) {
    if (!value) return NaN;
    var raw = String(value).trim();
    var iso = raw.replace(' ', 'T');
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso)) return Date.parse(iso);
    var siteMs = wallTimeToSiteMs(raw);
    return isNaN(siteMs) ? Date.parse(iso) : siteMs;
  }

  function fmtSiteTime(ms, opts) {
    if (isNaN(ms)) return '-';
    return new Date(ms).toLocaleTimeString('en-US', Object.assign({
      timeZone: SITE_TIME_ZONE,
      hour: 'numeric',
      minute: '2-digit'
    }, opts || {}));
  }

  function fmtSiteDate(ms, opts) {
    if (isNaN(ms)) return '-';
    return new Date(ms).toLocaleDateString('en-US', Object.assign({
      timeZone: SITE_TIME_ZONE,
      month: 'short',
      day: 'numeric'
    }, opts || {}));
  }

  function fmtHourRange(hour) {
    hour = Math.max(0, Math.min(23, +hour || 0));
    var start = new Date(Date.UTC(2020, 0, 1, hour, 0, 0));
    var end = new Date(Date.UTC(2020, 0, 1, (hour + 1) % 24, 0, 0));
    var opts = { timeZone: 'UTC', hour: 'numeric' };
    return start.toLocaleTimeString('en-US', opts).replace(/\s/g, '').toLowerCase()
      + '-' + end.toLocaleTimeString('en-US', opts).replace(/\s/g, '').toLowerCase();
  }

  function buildTimeProfileFromDetections(dets) {
    var counts = new Array(24).fill(0);
    (dets || []).forEach(function (d) {
      var m = String(d.t || '').match(/^(\d{1,2}):/);
      if (!m) return;
      var hour = Math.max(0, Math.min(23, +m[1] || 0));
      counts[hour] += 1;
    });
    var total = counts.reduce(function (sum, n) { return sum + n; }, 0);
    var bestHour = 0;
    counts.forEach(function (n, hour) {
      if (n > counts[bestHour]) bestHour = hour;
    });
    return { total: total, best_hour: total ? bestHour : null, hours: counts.map(function (n, hour) { return { hour: hour, n: n }; }) };
  }

  function normalizeTimeProfile(profile, dets) {
    var p = profile || buildTimeProfileFromDetections(dets || []);
    var rows = (p.hours || p.by_hour || []).map(function (r) {
      return { hour: Math.max(0, Math.min(23, +(r.hour != null ? r.hour : r.h) || 0)), n: +(r.n != null ? r.n : r.detections) || 0 };
    });
    var counts = new Array(24).fill(0);
    rows.forEach(function (r) { counts[r.hour] = r.n; });
    var total = +(p.total || 0) || counts.reduce(function (sum, n) { return sum + n; }, 0);
    var bestHour = p.best_hour;
    if (bestHour == null && total) {
      bestHour = 0;
      counts.forEach(function (n, hour) { if (n > counts[bestHour]) bestHour = hour; });
    }
    return { total: total, best_hour: bestHour == null ? null : +bestHour, counts: counts };
  }

  function polarPoint(cx, cy, r, deg) {
    var rad = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  }

  function polarWedgePath(cx, cy, r, startDeg, endDeg) {
    var a = polarPoint(cx, cy, r, startDeg);
    var b = polarPoint(cx, cy, r, endDeg);
    var large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return 'M ' + cx + ' ' + cy + ' L ' + a.x.toFixed(2) + ' ' + a.y.toFixed(2)
      + ' A ' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 ' + large + ' 1 '
      + b.x.toFixed(2) + ' ' + b.y.toFixed(2) + ' Z';
  }

  function hourLabel(hour) {
    if (hour === 0) return '12am';
    if (hour < 12) return hour + 'am';
    if (hour === 12) return '12pm';
    return (hour - 12) + 'pm';
  }

  function renderBestTimeClock(counts, peakHour) {
    var cx = 110, cy = 110, maxR = 72;
    var maxN = counts.reduce(function (m, n) { return Math.max(m, n); }, 0);
    var circles = [18, 32, 46, 60, 74].map(function (r) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" />';
    }).join('');
    var spokes = new Array(24).fill(0).map(function (_, hour) {
      var p = polarPoint(cx, cy, 78, (hour * 15) - 90);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x.toFixed(2) + '" y2="' + p.y.toFixed(2) + '" />';
    }).join('');
    var labels = new Array(24).fill(0).map(function (_, hour) {
      var p = polarPoint(cx, cy, 96, (hour * 15) - 90);
      return '<text x="' + p.x.toFixed(2) + '" y="' + p.y.toFixed(2) + '">' + hourLabel(hour) + '</text>';
    }).join('');
    var wedges = counts.map(function (n, hour) {
      if (!n || !maxN) return '';
      var radius = Math.max(10, (n / maxN) * maxR);
      var start = (hour * 15) - 90 + 1.5;
      var end = ((hour + 1) * 15) - 90 - 1.5;
      var peak = hour === peakHour ? ' data-peak="true"' : '';
      return '<path d="' + polarWedgePath(cx, cy, radius, start, end) + '"' + peak + '>'
        + '<title>' + hourLabel(hour) + ': ' + n + '</title></path>';
    }).join('');
    var now = new Date();
    var currentHour = now.getHours() + (now.getMinutes() / 60);
    var currentDeg = (currentHour * 15) - 90;
    var currentOuter = polarPoint(cx, cy, 82, currentDeg);
    var currentInner = polarPoint(cx, cy, 8, currentDeg);
    var currentTitle = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var currentHand = '<g class="polar-now"><line x1="' + currentInner.x.toFixed(2) + '" y1="' + currentInner.y.toFixed(2) + '" x2="' + currentOuter.x.toFixed(2) + '" y2="' + currentOuter.y.toFixed(2) + '"><title>current time: ' + currentTitle + '</title></line><circle cx="' + cx + '" cy="' + cy + '" r="3.2" /></g>';
    return '<svg class="best-time-polar" viewBox="0 0 220 220" role="img" aria-label="Hourly detections">'
      + '<g class="polar-grid">' + circles + spokes + '</g>'
      + '<g class="polar-wedges">' + wedges + '</g>'
      + currentHand
      + '<g class="polar-labels">' + labels + '</g>'
      + '</svg>';
  }

  function renderBestTime(profile, dets) {
    var box = document.getElementById('modalBestTime');
    var label = document.getElementById('modalBestTimeLabel');
    var detail = document.getElementById('modalBestTimeDetail');
    var clock = document.getElementById('modalBestTimeClock');
    if (!box || !label || !detail || !clock) return;
    var p = normalizeTimeProfile(profile, dets || []);
    var maxN = p.counts.reduce(function (m, n) { return Math.max(m, n); }, 0);
    if (!p.total || p.best_hour == null || !maxN) {
      box.setAttribute('data-empty', 'true');
      label.textContent = 'Not enough data yet';
      detail.textContent = 'This will appear after more detections are logged.';
      clock.innerHTML = '';
      return;
    }
    box.removeAttribute('data-empty');
    var bestCount = p.counts[p.best_hour] || 0;
    label.textContent = fmtHourRange(p.best_hour);
    detail.textContent = 'Total Detect: ' + fmtN(p.total) + ' · peak hour has ' + fmtN(bestCount);
    clock.innerHTML = renderBestTimeClock(p.counts, p.best_hour);
  }

  function siteParts(ms) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SITE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(ms));
    var out = {};
    parts.forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = p.value;
    });
    return {
      year: +out.year,
      month: +out.month,
      day: +out.day,
      hour: +out.hour,
      minute: +out.minute,
      second: +out.second
    };
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function siteDateKey(ms) {
    var p = siteParts(ms);
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
  }

  function siteWallMs(dateKey, hour, minute) {
    return wallTimeToSiteMs(dateKey + ' ' + pad2(hour) + ':' + pad2(minute || 0) + ':00');
  }

  function siteMsFromFields(year, month, day, hour, minute, second) {
    var d = new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0));
    return wallTimeToSiteMs(
      d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' +
      pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds())
    );
  }

  function floorSiteHour(ms) {
    var p = siteParts(ms);
    return siteMsFromFields(p.year, p.month, p.day, p.hour, 0, 0);
  }

  function ceilSiteHour(ms) {
    var p = siteParts(ms);
    var add = (p.minute || p.second) ? 1 : 0;
    return siteMsFromFields(p.year, p.month, p.day, p.hour + add, 0, 0);
  }

  // ---- Sliding pill helper ----
  // Each segmented control has a single .seg-pill element that we move via
  // transform/width to whichever button currently has aria-current="true".
  // This gives an iOS-style smooth slide instead of a hard snap.
  function syncPill(container) {
    var pill = container.querySelector('.seg-pill');
    var active = container.querySelector('button[aria-current="true"]');
    if (!pill || !active) return;
    // offsetLeft is relative to the container (we set position:relative on it).
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }

  // ---- Slider ----
  var views = document.getElementById('views');
  var slider = document.getElementById('slider');
  var btns = [].slice.call(slider.querySelectorAll('button'));
  var winPick = document.getElementById('winPick');

  // Each view's title text. The shared static-head shows one of these
  // based on the current view; identical adjacent values mean the title
  // stays put with no fade (collage and stats both say Heard Recently).
  var VIEW_TITLES = ['Heard Recently', 'Heard Recently', 'Avian Visitors'];
  var staticHead = document.querySelector('.static-head');
  var staticTitle = document.getElementById('staticTitle');
  function setTitleForView(i) {
    var next = VIEW_TITLES[i];
    if (!staticTitle || staticTitle.textContent === next) return;
    // Fade out -> swap text -> fade in. The opacity transition is 240ms;
    // we swap at ~half that so the eye doesn't catch the text change.
    staticHead.classList.add('swap-out');
    setTimeout(function () {
      staticTitle.textContent = next;
      // Force reflow before removing class so the transition restarts.
      void staticHead.offsetWidth;
      staticHead.classList.remove('swap-out');
    }, 220);
  }

  function go(i) {
    i = Math.max(0, Math.min(2, i));
    document.body.setAttribute('data-view', String(i));
    views.style.transform = 'translateX(-' + (i * 100) + '%)';
    btns.forEach(function (b, j) { b.setAttribute('aria-current', j === i ? 'true' : 'false'); });
    syncPill(slider);
    setTitleForView(i);
  }
  document.body.setAttribute('data-view', '0');
  btns.forEach(function (b) { b.addEventListener('click', function () { go(+b.dataset.i); }); });

  // ---- Window picker ----
  // Persist selections across reloads so a returning visitor lands on the
  // same view they left. Keys are namespaced so a future schema change
  // can be invalidated by bumping the prefix.
  function readLS(k, fallback) { try { return localStorage.getItem(k) || fallback; } catch (e) { return fallback; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var winBtns = [].slice.call(winPick.querySelectorAll('button'));
  var currentHours = +readLS('bird:window', '24') || 24;
  var nightStartHour = 21;
  var nightEndHour = 5;
  function clampHour(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? fallback : Math.max(0, Math.min(23, n));
  }
  function hourLabel(h) {
    h = clampHour(h, 0);
    var suffix = h < 12 ? 'AM' : 'PM';
    var hour = h % 12;
    if (hour === 0) hour = 12;
    return hour + ' ' + suffix;
  }
  function nightWindowLabel() {
    if (nightStartHour === nightEndHour) return 'all day';
    return hourLabel(nightStartHour) + '-' + hourLabel(nightEndHour);
  }
  function setNightHours(start, end) {
    nightStartHour = clampHour(start, 21);
    nightEndHour = clampHour(end, 5);
  }
  function nightQuery() {
    return '&night_start=' + encodeURIComponent(nightStartHour) + '&night_end=' + encodeURIComponent(nightEndHour);
  }
  function nightApiUrl(hours, limit) {
    return apiUrl('birdnet-api.php?action=night&hours=' + hours + '&limit=' + (limit || 6) + nightQuery());
  }
  function applyNightWindowFromResponse(j) {
    if (j && j.window) setNightHours(j.window.start_hour, j.window.end_hour);
    return j;
  }
  function collageSizeCapForHours(h) {
    if (h <= 1) return 15;
    if (h <= 12) return 40;
    if (h <= 24) return 75;
    if (h <= 168) return 75 * 7;
    return Infinity;
  }
  function collageSizingCount(n) {
    return Math.min(Math.max(1, n), collageSizeCapForHours(currentHours));
  }
  winBtns.forEach(function (b) {
    b.setAttribute('aria-current', (+b.dataset.h === currentHours) ? 'true' : 'false');
  });
  winBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      winBtns.forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
      currentHours = +b.dataset.h;
      writeLS('bird:window', String(currentHours));
      syncPill(winPick);
      // Actual data refresh is wired below via refreshRecent().
    });
  });

  // Initial pill placement (after layout settles) + on resize.
  // Atlas sort segmented control - same pill-on-recess pattern.
  var atlasSortEl = document.getElementById('atlasSort');
  var atlasSortBtns = atlasSortEl ? [].slice.call(atlasSortEl.querySelectorAll('button')) : [];
  window.__atlasSort = readLS('bird:atlasSort', 'count');
  atlasSortBtns.forEach(function (b) {
    b.setAttribute('aria-current', (b.dataset.sort === window.__atlasSort) ? 'true' : 'false');
  });
  atlasSortBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      atlasSortBtns.forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
      window.__atlasSort = b.dataset.sort;
      writeLS('bird:atlasSort', window.__atlasSort);
      syncPill(atlasSortEl);
      // Re-render the atlas with new sort.
      renderAtlas();
    });
  });

  function syncAllPills() { syncPill(slider); syncPill(winPick); if (atlasSortEl) syncPill(atlasSortEl); }
  // The buttons size from text content; wait for fonts so width is correct.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncAllPills);
  }
  // Also sync after layout is definitely done.
  requestAnimationFrame(function () { requestAnimationFrame(syncAllPills); });
  var pillTimer;
  window.addEventListener('resize', function () {
    clearTimeout(pillTimer);
    pillTimer = setTimeout(syncAllPills, 80);
  });

  // ---- Raster-bitmask collage with bird-shaped nesting ----
  // Each species ships a low-res binary alpha mask (cutout_masks.ts) that
  // matches the bird's actual outline. The layout maintains an occupancy
  // grid at viewport resolution; for each tile we spiral outward from the
  // cluster centre and pick the closest position where the tile's mask
  // doesn't overlap any already-placed mask. Result: birds nest into each
  // other's concavities (wing arc cradles tail, etc.) with a small visual
  // gap baked into the mask via Python-side dilation. No bbox overlap, no
  // rectangles touching - actual polygon-aware packing.

  var collage = document.getElementById('collage');
  var nightToggle = document.getElementById('nightToggle');
  var nightCollageOn = false;
  var nightSwapTimer = null;
  var collageFadeNext = false;
  var DIMS = {"acanthis-flammea":[716,491],"accipiter-cooperii":[442,849],"accipiter-gentilis":[333,754],"accipiter-striatus":[358,862],"actitis-macularius":[828,620],"aechmophorus-clarkii":[1004,755],"aechmophorus-occidentalis":[709,554],"aegolius-acadicus":[675,735],"aeronautes-saxatalis":[679,287],"agelaius-phoeniceus":[686,729],"aimophila-ruficeps":[763,432],"aix-sponsa":[798,735],"alectoris-chukar":[555,695],"alopochen-aegyptiaca":[761,616],"ammodramus-savannarum":[736,499],"ammospiza-leconteii":[777,735],"ammospiza-nelsoni":[783,486],"amphispiza-bilineata":[919,667],"anas-acuta":[868,506],"anas-crecca":[802,665],"anas-diazi":[735,651],"anas-fulvigula":[970,721],"anas-platyrhynchos":[686,561],"anas-rubripes":[952,612],"anhinga-anhinga":[731,855],"anser-albifrons":[653,584],"anser-anser":[755,816],"anser-caerulescens":[723,809],"anser-cygnoides":[794,895],"anser-rossii":[810,671],"anthus-rubescens":[484,717],"anthus-spragueii":[524,733],"antigone-canadensis":[688,1046],"antrostomus-carolinensis":[936,552],"antrostomus-vociferus":[1072,553],"aphelocoma-californica":[649,750],"aphelocoma-woodhouseii":[737,648],"aquila-chrysaetos":[653,792],"aramus-guarauna":[864,822],"archilochus-alexandri":[796,702],"archilochus-colubris":[699,620],"ardea-alba":[668,941],"ardea-herodias":[569,807],"arenaria-interpres":[783,533],"artemisiospiza-belli":[792,560],"asio-flammeus":[418,699],"asio-otus":[493,852],"athene-cunicularia":[385,911],"auriparus-flaviceps":[771,579],"aythya-affinis":[604,506],"aythya-americana":[618,609],"aythya-collaris":[606,438],"aythya-marila":[767,735],"aythya-valisineria":[636,525],"baeolophus-atricristatus":[663,554],"baeolophus-bicolor":[857,664],"baeolophus-inornatus":[541,352],"baeolophus-ridgwayi":[698,579],"bartramia-longicauda":[618,584],"bombycilla-cedrorum":[525,520],"bombycilla-garrulus":[494,490],"botaurus-lentiginosus":[521,1114],"branta-bernicla":[789,698],"branta-canadensis":[541,580],"branta-hutchinsii":[709,652],"bubo-scandiacus":[749,698],"bubo-virginianus":[514,874],"bubulcus-ibis":[560,837],"bucephala-albeola":[635,445],"bucephala-clangula":[585,532],"bucephala-islandica":[915,588],"buteo-albonotatus":[663,758],"buteo-jamaicensis":[498,883],"buteo-lagopus":[421,522],"buteo-lineatus-2":[570,699],"buteo-lineatus":[521,822],"buteo-platypterus":[548,839],"buteo-regalis":[662,907],"buteo-swainsoni":[529,969],"buteogallus-anthracinus":[547,1099],"butorides-virescens":[627,668],"cairina-moschata":[799,698],"calamospiza-melanocorys":[593,620],"calcarius-lapponicus":[867,631],"calcarius-ornatus":[602,728],"calcarius-pictus":[980,751],"calidris-alba":[263,228],"calidris-alpina":[605,479],"calidris-bairdii":[769,596],"calidris-canutus":[817,709],"calidris-fuscicollis":[733,692],"calidris-himantopus":[927,856],"calidris-maritima":[855,604],"calidris-mauri":[744,518],"calidris-melanotos":[780,460],"calidris-minutilla":[784,556],"calidris-pugnax":[626,781],"calidris-pusilla":[681,589],"calidris-subruficollis":[684,602],"callipepla-californica":[596,603],"callipepla-squamata":[644,803],"calothorax-lucifer":[650,481],"calypte-anna":[552,563],"calypte-costae":[587,599],"campylorhynchus-brunneicapillus":[794,522],"caracara-plancus":[724,720],"cardellina-canadensis":[849,568],"cardellina-pusilla":[612,388],"cardellina-rubrifrons":[558,369],"cardinalis-cardinalis":[616,895],"cardinalis-sinuatus":[990,768],"cathartes-aura":[447,784],"catharus-fuscescens":[865,779],"catharus-guttatus":[604,621],"catharus-minimus":[744,623],"catharus-ustulatus":[533,542],"catherpes-mexicanus":[395,544],"centronyx-bairdii":[826,607],"centronyx-henslowii":[637,552],"certhia-americana":[408,966],"chaetura-pelagica":[693,430],"chaetura-vauxi":[226,639],"charadrius-melodus":[745,634],"charadrius-semipalmatus":[711,568],"charadrius-vociferus":[441,440],"chlidonias-niger":[855,493],"chondestes-grammacus":[503,437],"chordeiles-acutipennis":[664,414],"chordeiles-minor":[634,274],"chroicocephalus-philadelphia":[663,545],"chroicocephalus-ridibundus":[809,633],"cinclus-mexicanus":[502,400],"circus-hudsonius":[471,886],"cistothorus-palustris":[460,552],"cistothorus-stellaris":[816,665],"clangula-hyemalis":[791,446],"coccothraustes-vespertinus":[551,639],"coccyzus-americanus":[587,913],"coccyzus-erythropthalmus":[653,892],"colaptes-auratus":[579,685],"colibri-thalassinus":[738,649],"colinus-virginianus":[569,683],"columba-livia":[584,623],"columbina-inca":[624,696],"columbina-passerina":[560,499],"contopus-cooperi":[529,482],"contopus-sordidulus":[398,580],"contopus-virens":[582,495],"coragyps-atratus":[512,583],"corthylio-calendula":[632,547],"corvus-brachyrhynchos":[651,574],"corvus-corax":[577,657],"corvus-cryptoleucus":[775,787],"corvus-ossifragus":[773,742],"coturnicops-noveboracensis":[874,627],"crotophaga-sulcirostris":[764,713],"cyanocitta-cristata":[577,898],"cyanocitta-stelleri":[544,926],"cygnus-buccinator":[260,409],"cygnus-columbianus":[827,724],"cygnus-olor":[791,739],"cynanthus-latirostris":[815,614],"cypseloides-niger":[210,544],"dendrocygna-autumnalis":[629,675],"dendrocygna-bicolor":[875,813],"dolichonyx-oryzivorus":[719,569],"dryobates-nuttallii":[456,779],"dryobates-pubescens":[297,696],"dryobates-scalaris":[564,861],"dryobates-villosus":[477,758],"dryocopus-pileatus":[662,840],"dumetella-carolinensis":[759,539],"egretta-caerulea":[587,731],"egretta-rufescens":[807,947],"egretta-thula":[305,426],"egretta-tricolor":[685,810],"elanoides-forficatus":[757,682],"elanus-leucurus":[393,552],"empidonax-alnorum":[774,624],"empidonax-difficilis":[601,732],"empidonax-flaviventris":[918,579],"empidonax-hammondii":[374,408],"empidonax-minimus":[678,718],"empidonax-oberholseri":[460,589],"empidonax-traillii":[334,283],"empidonax-virescens":[746,686],"empidonax-wrightii":[408,639],"eremophila-alpestris":[468,365],"eudocimus-albus":[797,735],"euphagus-carolinus":[1158,819],"euphagus-cyanocephalus":[572,406],"falco-columbarius":[411,652],"falco-mexicanus":[415,744],"falco-peregrinus":[480,684],"falco-rusticolus":[526,748],"falco-sparverius":[399,734],"fregata-magnificens":[924,732],"fregata-minor":[721,774],"fulica-americana":[795,873],"gallinago-delicata":[997,791],"gallinula-galeata":[722,792],"gallus-gallus":[796,685],"gavia-adamsii":[757,716],"gavia-immer":[651,265],"gavia-pacifica":[1155,657],"gavia-stellata":[950,655],"geococcyx-californianus":[914,699],"geothlypis-formosa":[798,497],"geothlypis-philadelphia":[743,523],"geothlypis-tolmiei":[480,351],"geothlypis-trichas":[491,409],"glaucidium-gnoma":[482,814],"grus-americana":[712,1084],"grus-grus":[355,1020],"gymnogyps-californianus":[523,979],"gymnorhinus-cyanocephalus":[697,847],"haemorhous-cassinii":[913,649],"haemorhous-mexicanus":[568,541],"haemorhous-purpureus":[626,533],"haliaeetus-leucocephalus":[503,668],"helmitheros-vermivorum":[744,477],"himantopus-mexicanus":[614,917],"hirundo-rustica":[541,721],"hydrocoloeus-minutus":[661,508],"hydroprogne-caspia":[776,447],"hylocichla-mustelina":[881,767],"icteria-virens":[656,423],"icterus-bullockii":[605,433],"icterus-cucullatus":[853,555],"icterus-galbula":[560,630],"icterus-parisorum":[571,663],"icterus-spurius":[538,708],"ictinia-mississippiensis":[412,761],"ixoreus-naevius":[578,486],"junco-hyemalis":[554,383],"lanius-borealis":[779,658],"lanius-ludovicianus":[520,616],"larus-brachyrhynchus":[665,606],"larus-californicus":[670,609],"larus-delawarensis":[610,459],"larus-fuscus":[922,765],"larus-glaucescens":[599,608],"larus-glaucoides":[792,653],"larus-heermanni":[628,508],"larus-hyperboreus":[669,565],"larus-marinus":[788,606],"larus-occidentalis":[337,306],"larus-schistisagus":[862,664],"laterallus-jamaicensis":[781,660],"leiothlypis-celata":[554,380],"leiothlypis-lucidae":[485,408],"leiothlypis-peregrina":[714,373],"leiothlypis-ruficapilla":[832,529],"leiothlypis-virginiae":[762,523],"leucophaeus-atricilla":[604,631],"leucophaeus-pipixcan":[704,577],"leucosticte-tephrocotis":[570,486],"limnodromus-griseus":[736,659],"limnodromus-scolopaceus":[774,709],"limnothlypis-swainsonii":[625,454],"limosa-fedoa":[516,982],"limosa-haemastica":[810,722],"lophodytes-cucullatus":[547,524],"loxia-curvirostra":[504,354],"loxia-leucoptera":[843,586],"mareca-americana":[612,650],"mareca-penelope":[833,552],"mareca-strepera":[605,500],"megaceryle-alcyon":[665,859],"megaceryle-torquata":[766,868],"megascops-asio":[703,807],"megascops-kennicottii":[519,585],"melanerpes-aurifrons":[541,870],"melanerpes-carolinus":[555,989],"melanerpes-erythrocephalus":[604,816],"melanerpes-formicivorus":[377,709],"melanerpes-lewis":[517,938],"melanitta-americana":[823,695],"melanitta-perspicillata":[930,568],"meleagris-gallopavo":[553,624],"melopsittacus-undulatus":[772,829],"melospiza-georgiana":[782,513],"melospiza-lincolnii":[612,365],"melospiza-melodia":[574,511],"melozone-aberti":[607,586],"melozone-crissalis":[575,507],"melozone-fusca":[512,424],"mergus-merganser":[498,753],"mergus-serrator":[877,558],"mimus-polyglottos":[1006,657],"mniotilta-varia":[560,330],"molothrus-aeneus":[634,544],"molothrus-ater":[560,537],"molothrus-bonariensis":[866,689],"myadestes-townsendi":[581,387],"mycteria-americana":[500,892],"myiarchus-cinerascens":[507,530],"myiarchus-crinitus":[847,672],"myiarchus-tuberculifer":[813,556],"myiopsitta-monachus":[752,736],"nannopterum-auritum":[724,985],"nannopterum-brasilianum":[644,883],"nucifraga-columbiana":[572,583],"numenius-americanus":[669,802],"numida-meleagris":[784,742],"nyctanassa-violacea":[657,849],"nycticorax-nycticorax":[644,764],"onychoprion-fuscatus":[869,482],"oporornis-agilis":[568,366],"oreoscoptes-montanus":[682,801],"oreothlypis-ruficapilla":[476,423],"oxyura-jamaicensis":[779,664],"pandion-haliaetus-2":[742,839],"pandion-haliaetus":[520,581],"parabuteo-unicinctus":[598,821],"parkesia-motacilla":[849,672],"parkesia-noveboracensis":[814,545],"passer-domesticus":[509,415],"passerculus-sandwichensis":[563,513],"passerella-iliaca":[596,511],"passerina-amoena":[535,601],"passerina-caerulea":[788,725],"passerina-ciris":[1005,722],"passerina-cyanea":[561,522],"patagioenas-fasciata":[393,616],"pavo-cristatus":[582,976],"pelecanus-erythrorhynchos":[627,752],"pelecanus-occidentalis":[547,801],"perisoreus-canadensis":[628,573],"petrochelidon-fulva":[828,571],"petrochelidon-pyrrhonota":[522,517],"peucaea-aestivalis":[1018,648],"peucaea-cassinii":[661,491],"phainopepla-nitens":[593,449],"phalacrocorax-auritus":[569,1066],"phalaenoptilus-nuttallii":[588,702],"phalaropus-fulicarius":[831,682],"phalaropus-lobatus":[735,509],"phalaropus-tricolor":[1137,543],"phasianus-colchicus":[535,918],"pheucticus-ludovicianus":[687,534],"pheucticus-melanocephalus":[614,670],"pica-hudsonia":[992,629],"pica-nuttalli":[541,786],"picoides-arcticus":[340,742],"pinicola-enucleator":[472,733],"pipilo-chlorurus":[627,549],"pipilo-erythrophthalmus":[512,624],"pipilo-maculatus":[438,432],"piranga-flava":[841,584],"piranga-ludoviciana":[651,424],"piranga-olivacea":[515,491],"piranga-rubra":[604,669],"pitangus-sulphuratus":[572,771],"platalea-ajaja":[885,916],"plectrophenax-nivalis":[719,616],"plegadis-chihi":[677,736],"plegadis-falcinellus":[683,731],"pluvialis-dominica":[560,674],"pluvialis-squatarola":[828,659],"podiceps-auritus":[841,599],"podiceps-grisegena":[724,803],"podiceps-nigricollis":[576,569],"podilymbus-podiceps":[522,716],"poecile-atricapillus":[815,554],"poecile-carolinensis":[849,705],"poecile-gambeli":[572,387],"poecile-rufescens":[568,350],"polioptila-caerulea":[489,771],"pooecetes-gramineus":[575,394],"porphyrio-martinica":[854,946],"porzana-carolina":[823,824],"progne-subis":[342,668],"protonotaria-citrea":[880,659],"psaltriparus-minimus":[452,426],"pyrocephalus-rubinus":[774,504],"quiscalus-mexicanus":[533,951],"quiscalus-quiscula":[935,696],"rallus-elegans":[909,920],"rallus-limicola":[876,667],"recurvirostra-americana":[572,1005],"regulus-calendula":[467,384],"regulus-satrapa":[592,400],"rhynchophanes-mccownii":[958,587],"riparia-riparia":[495,520],"rissa-tridactyla":[883,648],"rynchops-niger":[738,242],"salpinctes-obsoletus":[466,427],"sayornis-nigricans":[775,548],"sayornis-phoebe":[781,515],"sayornis-saya":[325,575],"scolopax-minor":[978,610],"seiurus-aurocapilla":[746,552],"selasphorus-calliope":[760,561],"selasphorus-platycercus":[574,563],"selasphorus-rufus":[585,513],"selasphorus-sasin":[647,622],"setophaga-americana":[800,604],"setophaga-caerulescens":[578,418],"setophaga-castanea":[762,630],"setophaga-cerulea":[776,607],"setophaga-chrysoparia":[875,697],"setophaga-citrina":[759,540],"setophaga-coronata":[555,500],"setophaga-discolor":[657,504],"setophaga-dominica":[770,581],"setophaga-fusca":[737,663],"setophaga-magnolia":[393,560],"setophaga-nigrescens":[538,473],"setophaga-occidentalis":[486,355],"setophaga-palmarum":[438,541],"setophaga-pensylvanica":[915,690],"setophaga-petechia":[595,438],"setophaga-pinus":[864,562],"setophaga-pitiayumi":[770,556],"setophaga-ruticilla":[468,420],"setophaga-striata":[729,520],"setophaga-tigrina":[822,462],"setophaga-townsendi":[575,398],"setophaga-virens":[879,598],"sialia-currucoides":[579,550],"sialia-mexicana":[587,587],"sialia-sialis":[846,642],"sitta-canadensis":[649,388],"sitta-carolinensis":[460,636],"sitta-pusilla":[608,579],"sitta-pygmaea":[568,472],"somateria-spectabilis":[861,730],"spatula-clypeata":[578,608],"spatula-cyanoptera":[652,511],"spatula-discors":[574,467],"spatula-querquedula":[871,523],"sphyrapicus-nuchalis":[459,734],"sphyrapicus-ruber":[452,637],"sphyrapicus-thyroideus":[609,637],"sphyrapicus-varius":[827,739],"spinus-lawrencei":[544,491],"spinus-pinus":[535,476],"spinus-psaltria":[500,364],"spinus-tristis":[575,768],"spiza-americana":[582,527],"spizella-atrogularis":[570,560],"spizella-breweri":[598,448],"spizella-pallida":[879,509],"spizella-passerina":[547,549],"spizella-pusilla":[869,661],"spizelloides-arborea":[714,525],"stelgidopteryx-serripennis":[523,519],"stercorarius-longicaudus":[797,458],"stercorarius-maccormicki":[751,568],"stercorarius-parasiticus":[709,703],"stercorarius-pomarinus":[645,554],"sterna-forsteri":[714,353],"sterna-hirundo":[708,357],"sterna-paradisaea":[881,362],"sternula-antillarum":[841,472],"streptopelia-decaocto":[564,397],"streptopelia-roseogrisea":[866,771],"strix-occidentalis":[483,796],"strix-varia":[453,766],"sturnella-magna":[741,567],"sturnella-neglecta":[551,538],"sturnus-vulgaris":[637,624],"sula-leucogaster":[1058,785],"tachybaptus-dominicus":[743,611],"tachycineta-bicolor":[503,676],"tachycineta-thalassina":[492,546],"tadorna-ferruginea":[825,703],"thalasseus-elegans":[704,451],"thalasseus-maximus":[1077,564],"thryomanes-bewickii":[397,384],"thryothorus-ludovicianus":[664,583],"toxostoma-curvirostre":[896,671],"toxostoma-redivivum":[649,427],"toxostoma-rufum":[1029,695],"tringa-flavipes":[868,691],"tringa-melanoleuca":[817,635],"tringa-semipalmata":[574,561],"tringa-solitaria":[827,584],"troglodytes-aedon":[537,450],"troglodytes-hiemalis":[807,689],"troglodytes-pacificus":[525,568],"turdus-migratorius":[586,607],"tympanuchus-cupido":[775,651],"tympanuchus-pallidicinctus":[649,685],"tyrannus-couchii":[1035,647],"tyrannus-forficatus":[720,680],"tyrannus-tyrannus":[649,689],"tyrannus-verticalis":[587,643],"tyrannus-vociferans":[441,559],"tyto-alba":[518,807],"urile-penicillatus":[499,803],"vermivora-chrysoptera":[915,510],"vermivora-cyanoptera":[631,409],"vireo-atricapilla":[784,578],"vireo-bellii":[582,500],"vireo-cassinii":[561,399],"vireo-flavifrons":[802,526],"vireo-gilvus":[476,514],"vireo-griseus":[900,521],"vireo-huttoni":[779,526],"vireo-olivaceus":[797,577],"vireo-philadelphicus":[826,590],"vireo-plumbeus":[898,625],"vireo-solitarius":[919,665],"xanthocephalus-xanthocephalus":[446,754],"xema-sabini":[896,575],"zenaida-asiatica":[401,527],"zenaida-macroura":[567,552],"zonotrichia-albicollis":[840,492],"zonotrichia-atricapilla":[561,608],"zonotrichia-leucophrys":[517,628],"zonotrichia-querula":[638,463]};
  var MASKS = {"acanthis-flammea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAf//+AAAAAAAAAAAH///4AAAAAAAAAAD////gAAAAAAAAAB////+AAAAAAAAAAP////4AAAAAAAAAA/////gAAAAAAAAAA/////wAAAAAAAAAD/////gAAAAAAAAAf/////gAAAAAAAAB//////AAAAAAAAAP/////+AAAAAAAAA//////4AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////+AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////wAAAAAAD////////AAAAAAAP///////8AAAAAAB////////4AAAAAAP////////gAAAAAA////////+AAAAAAH////////4AAAAAA/////////gAAAAAD////////+AAAAAAf////////8AAAAAB/////////wAAAAAH/////////gAAAAAf////////+AAAAAD/////////8AAAAAP/////////gAAAAA/////////4AAAAAD/////////gAAAAAH////////4AAAAAAf////////gAAAAAA/////////AAAAAAB/////j//+AAAAAAB////gB//8AAAAAAD///wAAf/4AAAAAAH//gAAA//wAAAAAD8D8AAAB//AAAAAP/8fgAAAH/+AAAAD///AAAAAP/4AAAAfwHgAAAAAf/gAAAD8D4AAAAAB/8AAAAfB88AAAAAD+AAAADw//wAAAAAP4AAAAPf+6AAAAAAfAAAAAz8AAAAAAAA4AAAAD/AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAD8AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":64,"w":93},"accipiter-cooperii":{"bits":"AB/gAAAAAH/4AAAAAf/+AAAAA///AAAAB///AAAAB///AAAAD///gAAAD///gAAAH///wAAAH///wAAAH///gAAAH//8gAAAP//8AAAAP//+AAAAP///gAAAP///wAAAP///4AAAP///+AAAP////AAAf////wAAf////4AA/////4AA/////8AA/////+AA//////AA//////AA//////gA//////gA//////wA//////wAf/////4Af/////4Af/////4Af/////8AP/////8AP/////8AP/////+AP/////+AH//////AH//////AD//////gD//////gB//////gAf/////gAf/////gAP/////wAH/////wAD/////wAB/////wAB/////wAB/////wAB/////gAA/////gAA/////wAA/////wAAf////wAAf////wAAP////4AAP////4AAP8///8AAH8///8AAH4f//8AAD4f//eAADAb//eAADAb//OAAHA5//mAAHA4//nAAHx4//jAD/5+f/jAH///f/xAH+P/f/wAH+P/f/wAD+P8P/wAB+F/v/4AB/n/v/4AB/g8H/4AA4A8H/4AAAAAH/8AAAAAH/8AAAAAD/8AAAAAD/8AAAAAD/+AAAAAB/+AAAAAB/+AAAAAB/+AAAAAB//AAAAAA//AAAAAA//AAAAAAf/AAAAAAf/AAAAAAP/AAAAAAH/AAAAAAD+","h":93,"w":48},"accipiter-gentilis":{"bits":"B/AAAAAP/wAAAA//wAAAB//wAAAH//wAAAP//gAAA///gAAB///gAAD///AAAG///AAAA///gAAB///wAAD///wAAP///wAAf///4AB////4AH////4AP////4Af////4B/////4D/////wH/////wP/////gf/////gf/////A//////B/////+D/////+D/////8H/////4P/////wP/////gf/////gf/////A/////+A/////+A/////8B/////4B/////wB/////wD/////gD/////AD////+AD////8AH////4AP////wAf////gA////+AB////4AB////wAD////gAH////AAH///+AAP///8AAP///8AAPv//4AAcf//wAA4f//gAH+///AA/9///AD+///+AH5///cAfv//+4Af9//9wAfv//5gAfn//zAAeP//mAAAP//MAAAB/+IAAAD/8AAAAH/4AAAAP/wAAAAf/gAAAA//AAAAB/+AAAAD/8AAAAH/4AAAAP/wAAAAf/gAAAAf/AAAAA/+AAAAB/8AAAAD/4AAAAH/wAAAAP/gAAAAP/AAAAAf+AAAAA/8AAAAB/4AAAAB/wAAAAB/AAAAAB+AAAAABwA","h":93,"w":41},"accipiter-striatus":{"bits":"AAAAAAAAAAAAAAAA/8AAAAf/4AAAH//gAAA//+AAAP//4AAB///AAAP//4AAD///gAAf//8AAD///gAAP//8AAD///wAA///+AAP///wAD////AA////4AP////AD////8A/////gH////8B/////gP////8D/////gf////8D/////g/////8H/////g/////8H/////h/////8P/////h/////8P/////B/////4P/////B/////wP////+B/////gP////8B/////AP////4B////+AP////wB////8AP////gB////4AP////AB////4AP////AB////4AP///+AB////wAH///8AA////gAH///4AA////AAH////ng/////4H///P4B///8/AP///v4B3//58AO//+/gB///z8AN//+HABv/7gAAN//AAABv/4AAAJ/+AAAAf/wAAAD/+AAAAf/wAAAD/+AAAAf/wAAAD/+AAAA//gAAAH/8AAAA//gAAAH/8AAAA//gAAAH/4AAAB//AAAAP/4AAAB//AAAAP/4AAAB/+AAAAP/wAAAA/8AAAAH/AAAAAAAAAAAAAAAAAAA==","h":93,"w":39},"actitis-macularius":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAA//AAAAAAAAAAAAAP/8AAAAAAAAAAAAB//wAAAAAAAAAAAAf/+AAAAAAAAAAAAD//4AAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAA///gAAAAAAAAAAAf//+AAAAAAAAAAAP///4AAAAAAAAAAD/////wAAAAAAAAB//////8AAAAAAAA/5/////+AAAAAAAf4D/////8AAAAAAH4AP/////4AAAAAD8AB//////wAAAAA+AAP//////gAAAAPAAB///////AAAABAAAP///////AAAAAAAB///////+AAAAAAAP///////+AAAAAAB////////+AAAAAAP/////////8AAAAB//////////wAAAAH/////////wAAAAA//////////gAAAAD//////////4AAAAf//////////gAAAB//////////8AAAAP//////////gAAAA//////////4AAAAD////////4AAAAAAP///////wAAAAAAA///////wAAAAAAAD//////4AAAAAAAAH/////8AAAAAAAAAf////+AAAAAAAAAA/////gAAAAAAAAAB////4AAAAAAAAAAD///8AAAAAAAAAAAD//8AAAAAAAAAAAAB//AAAAAAAAAAAAAH/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAA/+AAAAAAAAAAAAA//wAAAAAAAAAAAD//8AAAAAAAAAAAA//4AAAAAAAAAAAAf8PAAAAAAAAAAAAD7zwAAAAAAAAAAAA+CcAAAAAAAAAAAAHgHgAAAAAAAAAAAB8A4AAAAAAAAAAAAPgOAAAAAAAAAAAAB+DwAAAAAAAAAAAANg8AAAAAAAAAAAAB8HAAAAAAAAAAAAAP//AAAAAAAAAAAAAP/8AAAAAAAAAAAD//ygAAAAAAAAAAA//8AAAAAAAAAAAAAAeAAAAAAAAAAAAAAPAAAAAAAAAAAAAADwAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"aechmophorus-clarkii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAP//wAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAP/v/AAAAAAAAAAAD/gf8AAAAAAAAAAB/8A/gAAAAAAAAAA/+AD8AAAAAAAAAA//AAHgAAAAAAAAAf/+AA8AAAAAAAAAP/gfgHgAAAAAAAAH/AAPA8AAAAAAAAB8AAAIHgAAAAAAAAAAAABA8AAAAAAAAAAAAAIHgAAAAAAAAAAAADB8AAAAAAAAAAAAAQPAAAAAAAAAAAAAGD4AAAAAAAAAAAABgfAAAAAAAAAAAAAYHwAAAAAAAAAAAAGB+AHgAAAAAAAAABgfg///AAAAAAAAAYD8////AAAAAAAADA/////+AAAAAAAAwH/////+AAAAAAAMB//////8AAAAAABgP//////4AAAAAAID///////wAAAAADAf///////AAAAAAYD///////8AAAAACAf///////4AAAAAQD////////gAAAACAf///////+AAAAAQB////////4AAAADAP////////gAAAAYB////////+AAAABAD////////8AAAAIAP////////wAAABgA/////////gAAAEAA////////+AAAAQAD////////4AAADAAB///////3AAAAMAAAf//////oAAAA4AAD//////+AAAADgAAD//////4AAAAHgAAAf/////AAAAAPAAAA/////4AAAAAPAAAD/////AAAAAAPAAAH////4AAAAAAPAAA/////gAAAAAD/AAD////8AAAAAAf+AYf////AAAAAAD///////AAAAAAAAf/f////gAAAAAAAAc3////AAAAAAAAADh////4AAAAAAAAAOP/gH+AAAAAAAAAAhfgADgAAAAAAAAAAH8AAAAAAAAAAAAAA/AAAAAAAAAAAAAAH8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAH8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"aechmophorus-occidentalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP+f+AAAAAAAAAAAP/x/4AAAAAAAAAAf/4P/AAAAAAAAAAf/wB/4AAAAAAAAA///4P/AAAAAAAAAP+AB//8AAAAAAAAAAAAAf/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf8AAAAAAAAAAAAAD/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAD/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//gP//gAAAAAAAAH//f///wAAAAAAAA///////wAAAAAAAH///////wAAAAAAA////////gAAAAAAH////////AAAAAAA////////8AAAAAAH////////4AAAAAA/////////gAAAAAH/////////4AAAAA//////////4AAAAD//////////wAAAAf/////////+AAAAB/////////8AAAAAP/////////+AAAAA//////////8AAAAD//////////gAAAAP/////////4AAAAA/////////+AAAAAB/////////wAAAAAH////////4AAAAAAH///////AAAAAAAD///////wAAAAAAAf/n////8AAAAAAAD/wD////AAAAAAAAX+Af+A/wAAAAAAAAY4H/4AAAAAAAAAADAB/+AAAAAAAAAAAYAP8wAAAAAAAAAAAAB/AAAAAAAAAAAAAAP4AAAAAAAAAAAAAB/AAAAAAAAAAAAAAD8AAAAAAAAAAAAAAf4AAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":73,"w":93},"aegolius-acadicus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///AAAAAAAAAAH///8AAAAAAAAAP////gAAAAAAAAP////4AAAAAAAAf/////AAAAAAAAf/////gAAAAAAAP/////4AAAAAAAP/////+AAAAAAAP//////gAAAAAAH//////wAAAAAAH//////8AAAAAAD//////+AAAAAAB///////gAAAAAB///////wAAAAAA///////4AAAAAAf//////8AAAAAAP///////AAAAAAH///////gAAAAAD///////wAAAAAB///////4AAAAAA///////+AAAAAAf///////gAAAAAP///////4AAAAAH////////AAAAAD////////wAAAAB////////+AAAAA/////////gAAAAf////////4AAAAH/////////AAAAD/////////wAAAB/////////4AAAA/////////+AAAAf/////////gAAAP/////////4AAAH/////////8AAAD//////////AAAB//////////gAAA//////////4AAAf/////////+AAAH//////////AAAD//////////wAAB//////////4AAA//////////8AAAP//////////AAAH//////////wAAD//////////4AAB//////////+AAAf//////////gAAP//////////4AAD//////////+AAA///////////AAAP//////////gAAD//////////wAAA//////////4AAAf/////////+AAAH//////////AAAD//////////gAAA//////////wAAAf/////////8AAAH/////////+AAAB//////////AAAAf/////////gAAAH/////////wAAAB/////////wAAAAf////////4AAAAH////////+AAAAB/////////AAAAAf////////wAAAAH////////8AAAAA/////////AAAAAf////////wAAAA/////////8AAAD/////////+AAAD//////////gAAD//////////4AAB/////4///f8AAA////n8P//3+AAAf/+fgwD//4fAAAPveHwAAf/+DgAAC7OB4AAH//AAAAANmAcAAD//gAAAAADAcAAA//4AAAAAAgAAAAP/8AAAAAAAAAAAH//AAAAAAAAAAAB//gAAAAAAAAAAAf/4AAAAAAAAAAAH/8AAAAAAAAAAAB/+AAAAAAAAAAAAA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":85},"aeronautes-saxatalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/4AAAAAAAAAAAAA////+AAAAAAAAAAP/////AAAAAAAAAD/////+AAAAAAAAA///////4AAAAAAAP///////4AAAAAAB////////wAAAAAAf////////wAAAAAP/////////AAAAAB+H////////gAAAAAYH///////////gABgN///////////8AGBv///////////gAYB///////////gABgP/////////8AAAGA//////////AAAAQH/////////8AAADAf/////D///4AAAMB/////8////gAAA4H/////8A///AAABgP/////wAP/+AAAHAf/////wAD/wAAAOAf/////gAAAAAAAeAH/////gAAAAAAAfAH/////gAAAAAAAP8B/////wAAAAAAAf+O/////wAAAAAAD4fwP////gAAAAAAGH8AA////AAAAAAADwAAAB//4AAAAAAA/gAAAAAAAAAAAAAHcAAAAAAAAAAAAAA/gAAAAAAAAAAAAAD0AAAAAAAAAAAAAAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":39,"w":93},"agelaius-phoeniceus":{"bits":"AAAAAAAAAAAAAAADgAAAAAAAAAAAAD//8AAAAAAAAAAAP//+AAAAAAAAAAAP//8AAAAAAAAAAAf//8AAAAAAAAAAA///4AAAAAAAAAAA///wAAAAAAAAAAB///gAAAAAAAAAAH//+AAAAAAAAAAAf//8AAAAAAAAAAB///wAAAAAAAAAAH///gAAAAAAAAAAf//+AAAAAAAAAAB///4AAAAAAAAAAD///wAAAAAAAAAAP///AAAAAAAAAAA///8AAAAAAAAAAD///wAAAAAAAAAAP///gAAAAAAAAAA////AAAAAAAAAAD////AAAAAAAAAAf////AAAAAAAAAB/////AAAAAAAAAH////+AAAAAAAAAf////+AAAAAAAAB/////8AAAAAAAAH/////4AAAAAAAA//////wAAAAAAAD//////wAAAAAAAP//////gAAAAAAA///////AAAAAAAD//////+AAAAAAAH//////8AAAAAAAf//////wAAAAAAB///////gAAAAAAH///////AAAAAAAf///////AAAAAAB///////+AAAAAAD///////8AAAAAAP///////4AAAAAAf///////wAAAAAB////////gAAAAAD///////+AAAAAAP///////8AAAAAAf///////4AAAAAB////////wAAAAAD////////gAAAAAP///////+AAAAAAf///////8AAAAAA////////4AAAAAB////////wAAAAAD////////AAAAAAH///////8AAAAAAP///////4AAAAAAf///////gAAAAAA///////+AAAAAAB///////8AAAAAAB///////4AAAAAAD///////wAAAAAAD///////gAAAAAAD///////AAAAAAA///////+AAAAAAH///////8AAAAAAf//////94AAAAAB9//9///7gAAAAAHj/8D///wAAAAAA8HfwD///AAAAAADgc/AB//8AAAAAAOAz4AD//gAAAAAAwPfAAD//AAAAAABgD4AAD/+AAAAAAGA+AAAP/8AAAAAAAHwAAAf/4AAAAAAB8AAAB//wAAAAAAPgAAAD//gAAAAAD4AAAAH//AAAAAA/AAAAAf/8AAAAAD+AAAAA//4AAAAA/+AAAAB//wAAAAD48AAAAH//gAAAAPBwAAAAP//AAAAA8DAAAAAf/+AAAADgMAAAAB//4AAAAODgAAAAD//wAAAA4AAAAAAH//AAAADAAAAAAAP/8AAAAGAAAAAAA//wAAAAIAAAAAAB//AAAAAAAAAAAAD/8AAAAAAAAAAAAH/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":88},"aimophila-ruficeps":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAA//wAAAAAAAAAAAAP//gAAAAAAAAAAAH//8AAAAAAAAAAAB///4AAAAAAAAAAAf///wAAAAAAAAAAH////gAAAAAAAAAB////8AAAAAAAAAAP///+AAAAAAAAAAD////AAAAAAAAAAH////wAAAAAAAAAD////+AAAAAAAAAB/////wAAAAAAAAA/////+AP+AAAAAAf/////gA//AAAAAP/////8AH//gAAAP//////gB///wAAH//////4AP///wAD///////AA////4B///////wAAf///////////+AAAH///////////wAAAA//////////+AAAAAP/////////wAAAAAf////////8AAAAAA/////////gAAAAAD////////8AAAAAAP////////AAAAAAA////////4AAAAAAB///////+AAAAAAAf///////gAAAAAAD///////4AAAAAAAD//////+AAAAAAAB///////gAAAAAAAf//////4AAAAAAAD8P////+AAAAAAAAcA/////gAAAAAAAAAD////wAAAAAAAAAAH///8AAAAAAAAAAAP//8AAAAAAAAAAAB///uAAAAAAAAAAAH///+AAAAAAAAAAAD///4AAAAAAAAAAAD8DhgAAAAAAAAAABn/4AAAAAAAAAAAAf//wAAAAAAAAAAAG+//wAAAAAAAAAAAAAfeAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":53,"w":93},"aix-sponsa":{"bits":"AAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAP/4AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAA////AAAAAAAAAAAH///4AAAAAAAAAAA////gAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAP///+AAAAAAAAAAD////wAAAAAAAAAA////+AAAAAAAAAAf////4AAAAAAAAAP/////AAAAAAAAAB/g///4AAAAAAAAAfgD///AAAAAAAAABgAf//4AAAAAAAAAAAH///gAAAAAAAAAAA//v+AAAAAAAAAAAH/8fwAAAAAAAAAAB//APAAAAAAAAAAAf/4AAAAAAAAAAAAH//AAAAAAAAAAAAB//4AAAAAAAAAAAAP//AAAAAAAAAAAAD//8BwAAAAAAAAAA//////AAAAAAAAAP//////AAAAAAAAB///////AAAAAAAAf//////+AAAAAAAD///////8AAAAAAAf///////4AAAAAAH////////wAAAAAA/////////AAAAAAH////////+AAAAAA/////////+AAAAAH/////////8AAAAA//////////wAAAAH//////////AAAAA///////////AAAAD//////////+AAAAf//////////8AAAD///////////4AAAP///////////gAAB////////////AAAH///////////8AAA////////////gAAD///////////AAAAP//////////+AAAA///////////+AAAD///////////8AAAP///////////8AAA////////////4AAD////////////gAAH///////////8AAAf///////////gAAA///////////4AAAD///////+Af/AAAAH//////+AA/gAAAAP//////AAAAAAAAAP/////gAAAAAAAAAP////4AAAAAAAAAAH//7wAAAAAAAAAAA8/4AAAAAAAAAAAAHngAAAAAAAAAAABH+8AAAAAAAAAAAD//3gAAAAAAAAAAAf/68AAAAAAAAAAAA//HgAAAAAAAAAAAP/w8AAAAAAAAAAAD/8HgAAAAAAAAAAAYHB+AAAAAAAAAAAAB//wAAAAAAAAAAAAH/+AAAAAAAAAAAAB//AAAAAAAAAAAAB//wAAAAAAAAAAAAf/8AAAAAAAAAAAAAH/AAAAAAAAAAAAAAfwAAAAAAAAAAAAADwAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":86,"w":93},"alectoris-chukar":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8AAAAAAAAAAH/wAAAAAAAAAD/8AAAAAAAAAB//gAAAAAAAAA//4AAAAAAAAAf//gAAAAAAAAH//4AAAAAAAAD///AAAAAAAAA///wAAAAAAAAP//8AAAAAAAAD//wAAAAAAAAB//8AAAAAAAAAf//AAAAAAAAAH//gAAAAAAAAB//wAAAAAAAAAf/8AAAAAAAAAH//AAAAAAAAAD//wAAAAAAAAA//8AAAAAAAAAf//gAAAAAAAAP//4AAAAAAAAH///AAAAAAAAH///wAAAAAAAD///8AAAAAAAD////AAAAAAAD////4AAAAAAD////+AAAAAAB/////gAAAAAB/////4AAAAAA/////+AAAAAA//////gAAAAA//////4AAAAAf/////+AAAAAf//////AAAAAP//////wAAAAH//////8AAAAH//////+AAAAD///////gAAAB///////4AAAA///////+AAAAf///////AAAAP///////wAAAH///////8AAAD///////+AAAB////////gAAAf///////4AAAP///////8AAAH////////AAAB////////wAAA////////4AAAP///////+AAAH////////AAAB////////wAAA////////4AAAP///////8AAAH///////+AAAB////////AAAA////////gAAAP///////wAAAD///////wAAAA///////4AAAAf//////4AAAAH//////8AAAAB//////8AAAAA//////+AAAAAP/////+AAAAAD//////AAAAAA/////+AAAAAAf/f///AAAAAAH/g///gAAAAAD/gA//wAAAAAA/gAH88AAAAAAfwAA+PAAAAAAH4AAHzwAAAAAB8AAA++AAAAAA+AAAHvgAAAAAOAAAA/4AAAAACAAAAPOAAAAAAAAAAB7gAAAAAAAAAAe8AAAAAAAAAAD//4AAAAAAAAA///AAAAAAAAAf/+AAAAAAAAAf//gAAAAAAAAH//+AAAAAAAABA//4AAAAAAAAAD+fAAAAAAAAAAP4QAAAAAAAAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":74},"alopochen-aegyptiaca":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAP/wAAAAAAAAAAAAH//AAAAAAAAAAAAA//8AAAAAAAAAAAAP//wAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAH///gAAAAAAAAAAB///8AAAAAAAAAAA////wAAAAAAAAAAP///+AAAAAAAAAAB/A//wB/wAAAAAAAPAD/+H//4AAAAAAAAA//3///4AAAAAAAAP//////4AAAAAAAD///////4AAAAAAAf///////4AAAAAAH////////gAAAAAA/////////AAAAAAP/////////AAAAAB//////////AAAAAf/////////+AAAAD//////////8AAAAf//////////4AAAD///////////wAAAf///////////AAAD///////////+AAAP///////////8AAB////////////4AAP////////////gAA////////////+AAD////////////4AAf////////////AAB////////////4AAD////////////AAAP///////////wAAAf///////////gAAAf//////////8AAAA//////8AAD/gAAAD/////+AAAHwAAAAH/////gAAAAAAAAAP////wAAAAAAAAAAP///4AAAAAAAAAAAP//4AAAAAAAAAAAAP//AAAAAAAAAAAAA+P4AAAAAAAAAAAAHwPAAAAAAAAAAAAA+B4AAAAAAAAAAAAHgPgAAAAAAAAAAAA8B8AAAAAAAAAAAAHgPgAAAAAAAAAAAA8B8AAAAAAAAAAAAHgHgAAAAAAAAAAAA4A8AAAAAAAAAAAAHAHgAAAAAAAAAAAA4A8AAAAAAAAAAAAPAHgAAAAAAAAAAAB8A8AAAAAAAAAAAAPwH4AAAAAAAAAAAf+A/AAAAAAAAAAD//QH4AAAAAAAAAA//4H+AAAAAAAAAAA////gAAAAAAAAAAH///8AAAAAAAAAAB/+f/gAAAAAAAAAAODj/8AAAAAAAAAAAAY//AAAAAAAAAAAAAP/4AAAAAAAAAAAABB+AAAAAAAAAAAAAAHgAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":75,"w":93},"ammodramus-savannarum":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/wAAAAAAAAAAAAH//gAAAAAAAAAAAD//+AAAAAAAAAAAA///8AAAAAAAAAAAH///gAAAAAAAAAAD///+AAAAAAAADAB////4AAAAAAAB4A/////gAAAAAAA/8P////+AAAAAAAf/h/////4AAAAAAP/8H/////4AAAAAD//gH/////+AAAAB//8AP/////+AAAAf/+AB//////+AAAP//gAH//////+AAH//wAA///////+AB//4AAH////////j//8AAAf//////////+AAAD///////////AAAAf//////////gAAAB//////////4AAAAP/////////+AAAAB//////////gAAAAP/////////4AAAAB//////////AAAAAH/////////wAAAAA/////////8AAAAAH/////////AAAAAA/////////4AAAAAD/////////AAAAAAf////////4AAAAAB/////////AAAAAAP////////+AAAAAA/////////8AAAAAH/////////wAAAAAf/////////AAAAAB///////+AAAAAAAH//////+AAAAAAAAf//////gAAAAAAAB//////4AAAAAAAAH/////+AAAAAAAAAP/////gAAAAAAAAAf////4AAAAAAAAAB////+AAAAAAAAAAB////gAAAAAAAAAAA///4AAAAAAAAAAAf/74AAAAAAAAAAAf/B8AAAAAAAAAAAP/9+AAAAAAAAAAAH8E/+AAAAAAAAAAB/Af/8AAAAAAAAAAJwf4MgAAAAAAAAABOn+AAAAAAAAAAAAB87gAAAAAAAAAAAAOEcAAAAAAAAAAAAA+D8AAAAAAAAAAAABgeAAAAAAAAAAAAAABgAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAA==","h":63,"w":93},"ammospiza-leconteii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAAAAAAAAAAH//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///gAAAAAAAAAAD////gAAAAAAAAAA/////AAAAAAAAAAP////8AAAAAAAAAD/////gAAAAAAAAAf////wAAAAAAAAAH////4AAAAAAAAAA////8AAAAAAAAAAP////gAAAAAAAAAB////8AAAAAAAAAAf////gAAAAAAAAAH////8AAAAAAAAAB/////AAAAAAAAAAf////4AAAAAAAAAH/////AAAAAAAAAD/////wAAAAAAAAA/////+AAAAAAAAAP/////wAAAAAAAAD/////+AAAAAAAAA//////wAAAAAAAAP/////+AAAAAAAAD//////wAAAAAAAA//////+AAAAAAAAP//////wAAAAAAAD//////+AAAAAAAA///////wAAAAAAAP//////+AAAAAAAD///////wAAAAAAA///////+AAAAAAAP///////gAAAAAAB///////8AAAAAAAf///////AAAAAAAH///////4AAAAAAB///////+AAAAAAAP///////wAAAAAAD///////8AAAAAAA////////gAAAAAAH///////4AAAAAAA////////AAAAAAAP///////wAAAAAAD///////8AAAAAAA////////AAAAAAAP///////wAAAAAAB///////8AAAAAAA////////AAAAAAAP///////wAAAAAAD///////8AAAAAAB////////AAAAAAA////////gAAAAAAP///////4AAAAAAH///////8AAAAAAD///z////AAAAAAA///gH///gAAAAAAf/4AAD//+AAAAAAH/+AAAB//4AAAAAD//gAAAP7/AAAAAA//wAAAB/5wAAAAAf/8AAAAP+HAAAAAH/+AAAAA/44AAAAB//gAAAAD9GAAAAAP/4AAAAAH4wAAAAB/8AAAAAAPGAAAAAD/AAAAAAA+wAAAAAfgAAAAAAD6AAAAAD4AAAAAAAHwAAAAAMAAAAAAAAfAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAH4AAAAAAAAAAAAAB/gAAAAAAAAAAAAAf4AAAAAAAAAAAAAfHAAAAAAAAAAAAADw8AAAAAAAAAAAAAeHgAAAAAAAAAAAADgcAAAAAAAAAAAAAMDAAAAAAAAAAAAAB4YAAAAAAAAAAAAACDAAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAhAAAAAAAAAAAAAAAAAAAA","h":88,"w":93},"ammospiza-nelsoni":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAAAAwAAP/+AAAAAAAAA/AAH//8AAAAAAAAfwAB///wAAAAAAAP/8Af///AAAAAAAH//gD///8AAAAAAD//8B////4AAAAAB///Af/////4AAAA///gP//////8AAAf//wB////////wAP//4AD////////wf//4AAH///////////8AAA///////////+AAAH//////////+AAAAf//////////AAAAD//////////4AAAAf/////////+AAAAB//////////gAAAAP/////////wAAAAA/////////+AAAAAH/////////gAAAAA/////////4AAAAAH/////////4AAAAAf/////////wAAAAD/////////+AAAAAf/////////wAAAAB////////8AAAAAAP///////+AAAAAAA////////gAAAAAAD///////4AAAAAAAf///////AAAAAAAA///////wAAAAAAAD//////8AAAAAAAAP//////AAAAAAAAA//////wAAAAAAAAB/////8AAAAAAAAAD////+AAAAAAAAAAH////wAAAAAAAAAAH///+AAAAAAAAAAAD/+PgAAAAAAAAAAD/8DwAAAAAAAAAAP//g8AAAAAAAAAAD/4APAAAAAAAAAAA/8ADwAAAAAAAAAAP+AA98AAAAAAAAADzgAf/gAAAAAAAAAYwD//gAAAAAAAAACGA/+AAAAAAAAAAAAQH/AAAAAAAAAAAAAB/wAAAAAAAAAAAAA+cAAAAAAAAAAAAAHHAAAAAAAAAAAAABgwAAAAAAAAAAAAAIGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":58,"w":93},"amphispiza-bilineata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAAf//4AAAAAAAAAAAP///AAAAAAAAAAAH///8AAAAAAAAAAB////wAAAAAAAAAAP///+AAAAAAAAAAAf///4AAAAAAAAAAA////gAAAAAAAAAAH///8AAAAAAAAAAAf///wAAAAAAAAAAD////wAAAAAAAAAAf////gAAAAAAAAAB/////AAAAAAAAAAP////+AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAB//////AAAAAAAAAP/////8AAAAAAAAD//////4AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAB////////AAAAAAAP///////8AAAAAAA////////wAAAAAAH///////+AAAAAAAf///////4AAAAAAD////////AAAAAAAP///////+AAAAAAA////////8AAAAAAH////////wAAAAAAf////////AAAAAAB////////4AAAAAAH///////+AAAAAAAP///////8AAAAAAA////////4AAAAAAB////////wAAAAAAH////////gAAAAAAH///+AP//AAAAAAAP///AAB/+AAAAAAD///AAAD/8AAAAAB/A/wAAAH/4AAAAAf8D8AAAAf/wAAAAH/x8AAAAA//AAAAA+H+AAAAAB/+AAAAHgfAAAAAAD/8AAAA/PgAAAAAAP/4AAAD/4AAAAAAAf/gAAAc/8AAAAAAA/8AAAB//wAAAAAAD/AAAAH4eAAAAAAAC4AAAAfAwAAAAAAAAAAAAD6GAAAAAAAAAAAAAP4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAHwAAAAAAAAAAAAAA4AAAAAAAAAAAAAAD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":67,"w":93},"anas-acuta":{"bits":"AAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAA/4AAAAAAAAAAAAAP/wAAAAAAAAAAAAD//AAAAAAAAAAAAA//8AAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAAP//wAAAAAAAAAAAB///AAAAAAAAAAAAf//4AAAAAAAAAAAH///AAAAAAAAAAAD///4AAAAAAAAAAB////AAAAAAAAAAAPwP/4AAAAAAAAAABgB/+f/AAAAAAAAAAA/////wAAAAAAAAAP/////wAAAAAAAADf/////wAAAAAAAAj//////wAAAAAAAIf//////8AAAAAAAD///////8AAAAAAA////////8AAAAAAH////////4AAAAAg/////////8AAAAMH/////////wAAABg////////////wAIH////////////4BAf////////////gMB//////////wA4AgP/////////8AAAEA/////////+AAAAwB////////8AAAADAH///////+AAAAAMAP///////AAAAAAwAf//////gAAAAADAAf/////4AAAAAAOAAP////8AAAAAAAYAA////+AAAAAAAA4AB////gAAAAAAAB4AH///wAAAAAAAAA8AP//AAAAAAAAAAD///wAAAAAAAAAAAX/48AAAAAAAAAAAAz+PAAAAAAAAAAAAAL/4AAAAAAAAAAAAA//AAAAAAAAAAAAA//oAAAAAAAAAAAAH/wAAAAAAAAAAAAAD8AAAAAAAAAAAAAAeAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":54,"w":93},"anas-crecca":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAD/+AAAAAAAAAAAAA//8AAAAAAAAAAAAP//wAAAAAAAAAAAD//+AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAA///8AAAAAAAAAAAH///wAAAAAAAAAAA///+AAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAAf///4AAAAAAAAAAH////AAAAAAAAAAB////4AAAAAAAAAA////8AAAAAAAAAAP/P//gAAAAAAAAAB+Af/8B+AAAAAAAAPAH//f//4AAAAAABAA//////4AAAAAAAAP//////4AAAAAAAD///////+AAAAAAA/////////gAAAAAP/////////gAAAAD///////////4AAA////////////wAAH///////////8AAB///////////wAAAP////////////+AB/////////////8AP/////////////gD/////////////8Af/////////////AD/////////////4AP////////////+AB/////////////gAP////////////4AB////////////8AAH///////////8AAA///////////wAAAD//////////4AAAAf/////////+AAAAB//////////AAAAAH/////////wAAAAAf////////8AAAAAA/////////AAAAAAD////////wAAAAAAP///////8AAAAAAAf///////AAAAAAAA///////gAAAAAAAB//////4AAAAAAAAD/////4AAAAAAAAAf////4AAAAAAAAAP////8AAAAAAAAAB/////gAAAAAAAAAD/+P/4AAAAAAAAAAP9wB+AAAAAAAAAAB/gAPgAAAAAAAAAAcYAB4AAAAAAAAAADDAAeAAAAAAAAAAAYIAHgAAAAAAAAAAAAAA8AAAAAAAAAAAAD4PAAAAAAAAAAAAAf/+AAAAAAAAAAAAA//4AAAAAAAAAAAAP/yAAAAAAAAAAAAD/8AAAAAAAAAAAAB//AAAAAAAAAAAAAf/4AAAAAAAAAAAAAD+AAAAAAAAAAAAAAPgAAAAAAAAAAAAADwAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":77,"w":93},"anas-diazi":{"bits":"AAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAB/4AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAAf//wAAAAAAAAAAAH//+AAAAAAAAAAAA///4AAAAAAAAAAAP///AAAAAAAAAAAB///8AAAAAAAAAAAP///gAAAAAAAAAAD///+AAAAAAAAAAA////wAAAAAAAAAAP///+AAAAAAAAAAD////wAAAAAAAAAA////+AAAAAAAAAAP////gAAAAAAAAAH/wf/8AAAAAAAAAB/4D//gAAAAAAAAAP+Af/7//gAAAAAAB/AH/////gAAAAAAMAB//////gAAAAAAAA///////gAAAAAAAP///////AAAAAAAH////////AAAAAAB/////////gAAAAAP/////////gAAAAD//////////AAAAA//////////8AAAAH//////////4AAAB///////////gAAAP//////////8AAAB///////////8AAAP///////////8AAB////////////8AAP////////////4AB/////////////AAP////////////4AB/////////////AAP////////////4AB/////////////4AH/////////////gA/////////////8AD/////////////AAP////////////gAA////////////4AAD//////////8AAAAP//////////AAAAAf/////////gAAAAA/////////4AAAAAA////////8AAAAAAB///////+AAAAAAAD///////gAAAAAAAD//////wAAAAAAAAH/////4AAAAAAAAA////8AAAAAAAAAAP////AAAAAAAAAAD/+AD4AAAAAAAAAA//gAfAAAAAAAAAAH/8AB4AAAAAAAAAA//gAeAAAAAAAAAAAfuADwAAAAAAAAAABwAAcAAAAAAAAAAAMAAHwAAAAAAAAAABwAA+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAD8AAAAAAAAAAAAAP/gAAAAAAAAAAAAP/8AAAAAAAAAAAAB//gAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/AAAAAAAAAAAAAD/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAH/wAAAAAAAAAAAABz+AAAAAAAAAAAAAMHgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":82,"w":93},"anas-fulvigula":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAA//AAAAAAAAAAAAAP/8AAAAAAAAAAAAD//wAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAB///AAAAAAAAAAAAP//8AAAAAAAAAAAD///gAAAAAAAAAAAf//8AAAAAAAAAAAP///wAAAAAAAAAAD///+AAAAAAAAAAB////wAAAAAAAAAA////8AAAAAAAAAAP/g//gAAAAAAAAAB/wH/8AAAAAAAAAAP4A//AAMAAAAAAAAAAP/4P//gAAAAAAAAD/+P///wAAAAAAAB///////4AAAAAAAf////////wAAAAAH/////////wAAAAB//////////+AAAAf///////////gAAD////////////AAA////////////wAAH////////////AAB////////////+AAP////////////wAB/////////////AAP/////////////gB/////////////8AP/////////////gB/////////////4AP////////////+AA/////////////gAH////////////wAA////////////AAAD///////////wAAAP//////////4AAAA//////////+AAAAH//////////gAAAAP/////////wAAAAA/////////8AAAAAA////////+AAAAAAA////////AAAAAAAB///////wAAAAAAAD//////4AAAAAAAAD/////gAAAAAAAAH/////gAAAAAAAAA/////AAAAAAAAAAD/+QDwAAAAAAAAAAH/wAeAAAAAAAAAAA/8ADwAAAAAAAAAAGBAA+AAAAAAAAAAAAB+P4AAAAAAAAAAAAP//AAAAAAAAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAD//AAAAAAAAAAAAA//wAAAAAAAAAAAAF/8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAHgAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":69,"w":93},"anas-platyrhynchos":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAA//AAAAAAAAAAAAAP/8AAAAAAAAAAAAD//wAAAAAAAAAAAA///AAAAAAAAAAAAH//8AAAAAAAAAAAB///gAAAAAAAAAAAP//8AAAAAAAAAAAD///wAAAAAAAAAAA///+AAAAAAAAAAAf///wAAAAAAAAAAH///+AAAAAAAAAAD////wAAAAAAAAAB/+P/+AAAAAAAAAAP+Af/wAAAAAAAAAD/AB/8AAAAAAAAAAIAAP/gAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/AAAAAAAAAAAAAH/4AAAAAAAAAAAAD/+B//gAAAAAAAAA//x///wAAAAAAAAP/+////wAAAAAAAD///////wAAAAAAA////////wAAAAAAP////////wAAAAAB/////////4AAAAAf/////////4AAAAD//////////4AAAA///////////+AAAH///////////+AAA////////////8AAH////////////4AA/////////////gAH////////////8AA/////////////gAH/////////////gAf////////////8AD/////////////AAf////////////4AB////////////8AAH///////////8AAAf//////////+AAAB///////////gAAAH//////////wAAAAP/////////8AAAAAf/////////AAAAAA/////////gAAAAAB////////4AAAAAAD///////8AAAAAAAD///////AAAAAAAAH//////gAAAAAAAAH/////wAAAAAAAAAD///wAAAAAAAAAAB///gAAAAAAAAAAA/6A8AAAAAAAAAAAf/AHgAAAAAAAAAAP/4A8AAAAAAAAAAB//AHAAAAAAAAAAAL/4B4AAAAAAAAAAAP+APgAAAAAAAAAAA4SB8AAAAAAAAAAAEB//gAAAAAAAAAAAAH/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAP/wAAAAAAAAAAAAB/8AAAAAAAAAAAAA//gAAAAAAAAAAAAGf4AAAAAAAAAAAAAA+AAAAAAAAAAAAAAHgAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":76,"w":93},"anas-rubripes":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAP//wAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAD///gAAAAAAAAAAA///+AAAAAAAAAAAP///wAAAAAAAAAAD///+AAAAAAAAAAA////wAAAAAAAAAAf///+AAAAAAAAAAP////wAAAAAAAAAD////+AAAAAAAAAB/+B//wAAAAAAAAAP+AH/8A/wAAAAAAB/AA//h///gAAAAAMAAH/9////wAAAAAAAB///////+AAAAAAAf////////AAAAAAP/////////+AAAAD///////////gAAA///////////8AAAP///////////4AAD////////////AAAf////////////AAH////////////8AA/////////////gAP////////////4AB////////////+AAP////////////gAB////////////4AAf///////////wAAD///////////8AAAf///////////AAAB///////////wAAAP//////////8AAAB///////////AAAAP//////////wAAAA//////////8AAAAH//////////AAAAAf/////////gAAAAB/////////wAAAAAH////////8AAAAAAf///////wAAAAAAB///////4AAAAAAAD///////AAAAAAAAB//////wAAAAAAAAAAAf/+AAAAAAAAAAAAA//wAAAAAAAAAAAAP/2AAAAAAAAAAAAD/8AAAAAAAAAAAAA//AAAAAAAAAAAAAAPwAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":60,"w":93},"anhinga-anhinga":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAA//B/AAAAAAAAAH///+AAAAAAAAAH///4AAAAAAAAAH///gAAAAAAAAAH//4AAAAAAAAAAP//gAAAAAAAAAA//4AAAAAAAAAAD//AAAAAAAAAAAP/wAAAAAAAAAAA/+AAAAAAAAAAAD/gAAAAAAAAAAA/4AAAAAAAAAAAP+AAAAAAAAAAAD/gAAAAAAAAAAP/4AAAAAAAAAAP/+AAAAAAAAAAH//AAAAAAAAAAD//wAAAAAAAAAA//4AAAAAAAAAAf/8AAAAAAAAAAH/+AAAAAAAAAAD//AAAAAAAAAAA//+AAAAAAAAAAP//8AAAAAAAAAD///gAAAAAAAAAf//+AAAAAAAAAH///wAAAAAAAAA///+AAAAAAAAAP///4AAAAAAAAB////gAAAAAAAAP///8AAAAAAAAD////gAAAAAAAAf///+AAAAAAAAH////wAAAAAAAB////+AAAAAAAAP////wAAAAAAAD////8AAAAAAAAf////gAAAAAAAH////8AAAAAAAB/////AAAAAAAAP////4AAAAAAAD/////AAAAAAAA/////wAAAAAAAP////+AAAAAAAB/////wAAAAAAAf////8AAAAAAAD/////AAAAAAAA/////4AAAAAAAH////+AAAAAAAA/////gAAAAAAAP////4AAAAAAAB////+AAAAAAAAf////wAAAAAAAD////8AAAAAAAA/////AAAAAAAAP////4AAAAAAAD////+AAAAAAAAf////gAAAAAAAH////4AAAAAAAA/////AAAAAAAAP////4AAAAAAAB/v//+AAAAAAAAf5///wAAAAAAAHv///+AAAAAAAB7/z//gAAAAAAAf/8f/8AAAAAAAH//n//AAAAAAAD+/w//wAAAAAAH/38P/8AAAAAAH/++D//AAAAAAB/9jAf/4AAAAAA8A4AH//AAAAAAOAIAB//4AAAAADgAAAP/+AAAAAA4AAAD//wAAAAAGAAAAf/+AAAAAB4AAAH//wAAAAAEAAAB//+AAAAAAAAAAP//gAAAAAAAAAD//8AAAAAAAAAAf//gAAAAAAAAAH//4AAAAAAAAAA///AAAAAAAAAAP//wAAAAAAAAAB//8AAAAAAAAAAf//AAAAAAAAAAB//wAAAAAAAAAAP/wAAAAAAAAAAA/8AAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":80},"anser-albifrons":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAD///wAAAAAAAAAAAf///AAAAAAAAAAAH///+AAAAAAAAAAA////8AAAAAAAAAAH////gAAAAAAAAAB////8AAAAAAAAAAP/+AAAAAAAAAAAAB/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/wAAAAAAAAAAAAA//AAAAAAAAAAAAAH/8AAAAAAAAAA//4//wAAAAAAAAB///7//AAAAAAAAB//////4AAAAAAAB///////gAAAAAAA///////+AAAAAAAf///////wAAAAAA////////+AAAAAA/////////4AAAAAf/////////AAAAAP/////////4AAAAH//////////AAAAD//////////4AAAB///////////AAAA///////////4AAB///////////+AAA////////////wAAP///////////+AAD////////////gAAA///////////8AAB////////////AAA////////////4AAP///////////+AAB////////////gAAD///////////wAAAAH/////////8AAAAAH////////+AAAAAAP////////AAAAAAAf///////gAAAAAAB///////wAAAAAAAD//////8AAAAAAAAP/////+AAAAAAAAAP/////AAAAAAAAAAf////gAAAAAAAAAAD///gAAAAAAAAAAAf//AAAAAAAAAAAAB/h4AAAAAAAAAAAAHwPAAAAAAAAAAAAA+B4AAAAAAAAAAAAHwPAAAAAAAAAAAAA+B8AAAAAAAAAAAAHwfgAAAAAAAAAAAAcD/+AAAAAAAAAAADg///gAAAAAAAAAAeB//8AAAAAAAAAADwP/+AAAAAAAAAAA+A//gAAAAAAAAAAP4H/8AAAAAAAAAAB////wAAAAAAAAAAH//gAAAAAAAAAAAAf/wAAAAAAAAAAAAD//AAAAAAAAAAAAAP/8AAAAAAAAAAAAA//wAAAAAAAAAAAAD+AAAAAAAAAAAAAAPAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":83,"w":93},"anser-anser":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAf/gAAAAAAAAAAAP/8AAAAAAAAAAAH//gAAAAAAAAAAD//4AAAAAAAAAAB///AAAAAAAAAAA///wAAAAAAAAAAf//+AAAAAAAAAAf///gAAAAAAAAAf///8AAAAAAAAAP////AAAAAAAAAD////wAAAAAAAAA////8AAAAAAAAAAAf//AAAAAAAAAAAB//wAAAAAAAAAAAD/8AAAAAAAAAAAA//AAAAAAAAAAAAP/wAAAAAAAAAAAD/8AAAAAAAAAAAA//AAAAAAAAAAAAP/wAAAAAAAAAAAD/8AAAAAAAAAAAB//AAAAAAAAAAAAf/wAAAAAAAAAAAP/4AAAAAAAAAAAH/+AAAAAAAAAAAB//gAAAAAAAAAAA//wAAAAAAAAAAAf/8AAAAAAAAAAAP//AAAAAAAAAAAH//wAAAAAAAAAAB//8AAAAAAAAAAA///AMAAAAAAAAAf/////gAAAAAAAH//////AAAAAAAD//////+AAAAAAA///////4AAAAAAP///////gAAAAAH///////+AAAAAB////////4AAAAAX////////AAAAAF////////4AAAABf////////gAAAAX////////+AAAAF/////////4AAABf/////////gAAAT/////////8AAAEf/////////wAABH/////////+AAAY//////////gAACP/////////+AAAx//////////+AAMf//////////wABj//////////+AAMP//////////4ADh//////////+AAcH///////wB/gADgH//////wA/8AAMAf/////AD/+AABwA/////4Af/AAAHAD////+ABwAAAA4AH////gBwAAAADgAf///4A4AAAAAMAB///+AYAAAAABgAH///AMAAAAAAOAAf//zmAAAAAAAwAB///hAAAAAAAGAAH/+AwAAAAAAAwAH//AYAAAAAAAHAAd/gcAAAAAAAAYABwwMAAAAAAAADgAH4+AAAAAAAAAP8A/8AAAAAAAAAA/4PwAAAAAAAAAAPH/4AAAAAAAAAADwHeAAAAAAAAAAB+AHAAAAAAAAAAB/wBwAAAAAAAAA//8A+AAAAAAAAAf/+APgAAAAAAAAD//gD8AAAAAAAAAP///+AAAAAAAAAB////AAAAAAAAAA4Df/wAAAAAAAAAAAD/8AAAAAAAAAAAB//AAAAAAAAAAAA//gAAAAAAAAAAAAHwAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":86},"anser-caerulescens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAP/wAAAAAAAAAAA//wAAAAAAAAAAD//gAAAAAAAAAAP//gAAAAAAAAAA///gAAAAAAAAAB///gAAAAAAAAAH///gAAAAAAAAAP///gAAAAAAAAAf///wAAAAAAAAB////4AAAAAAAAD////wAAAAAAAAH////gAAAAAAAAP/+ACAAAAAAAAA//AAAAAAAAAAAB/8AAAAAAAAAAAD/4AAAAAAAAAAAH/wAAAAAAAAAAAP/gAAAAAAAAAAAf/gAAAAAAAAAAAf/AAAAAAAAAAAA//AAAAAAAAAAAB/+AAAAAAAAAAAD/+AAAAAAAAAAAH/+AAAAAAAAAAAH/+AAAAAAAAAAAP/+AAAAAAAAAAAf/8AAAAAAAAAAAf/8AAAAAAAAAAA//8AAAAAAAAD////4AAAAAAAB/////4AAAAAAAf/////wAAAAAAD//////gAAAAAA///////AAAAAAH//////+AAAAAAf//////8AAAAAD///////4AAAAA////////4AAAAP////////wAAAB/////////gAAAH/////////AAAA/////////+AAAD/////////8AAAP/////////4AAB//////////wAAf//////////gAB//////////+AAH//////////8AA///////////4AD///////////gAH//////////+AAAf/////////8AAB//////////wAAP//////////AAAf/////////4AAAf/////////gAAA////////P+AAAAAf/////gP4AAAAAP//B/wB/AAAAAAH/8B8AH8AAAAAAH/4AAAfwAAAAAAH/wAAH+AAAAAAAD/wAD/4AAAAAAAD/wB//AAAAAAAAD/4H/8AAAAAAAAB/4/7wAAAAAAAAA///HwAAAAAAAAAD/wPAAAAAAAAAAD8AeAAAAAAAAAAD4AcAAAAAAAAAAH4A4AAAAAAAAAAPgB4AAAAAAAAAAPADwAAAAAAAAAAeAHgAAAAAAAAAA8APgAAAAAAAAAA4A/wAAAAAAAAABwB//4AAAAAAAADwA//8AAAAAAAAPgD//4AAAAAAAA/4H/+AAAAAAAAA////4AAAAAAAAA////4AAAAAAAAB//P/wAAAAAAAAD/+YAAAAAAAAAAD/+AAAAAAAAAAAD/8AAAAAAAAAAAD4AAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":83},"anser-cygnoides":{"bits":"AAAAAAAAAAAAAAAABAAAAAAAAAAAAA/4AAAAAAAAAAAH/4AAAAAAAAAAAf/4AAAAAAAAAAB//4AAAAAAAAAAH//4AAAAAAAAAAf//wAAAAAAAAAD///wAAAAAAAAAf///gAAAAAAAAD////gAAAAAAAAH////AAAAAAAAAP///+AAAAAAAAAAAf/+AAAAAAAAAAAD/8AAAAAAAAAAAD/4AAAAAAAAAAAH3wAAAAAAAAAAAPngAAAAAAAAAAAfPAAAAAAAAAAAA+eAAAAAAAAAAAB88AAAAAAAAAAAD54AAAAAAAAAAAHzwAAAAAAAAAAAfngAAAAAAAAAAA/OAAAAAAAAAAAD+8AAAAAAAAAAAP94AAAAAAAAAAAf7wAAAAAAAAAAB//AAAAAAAAAAAH/+AAAAAAAAAAAf/8AAAAAAAAAAA//4AAAAAAAAAAD//wAAAAAAAAAAP//gAAAAAAAAAAf////gAAAAAAAA/////4AAAAAAAD/////+AAAAAAAH//////AAAAAAAP//////gAAAAAAf//////gAAAAAA///////wAAAAAD///////wAAAAAH///////4AAAAAP///////4AAAAAP///////8AAAAAf///////8AAAAA////////8AAAAB////////+AAAAB/////////AAAAD/////////AAAAD/////////gAAAH/////////gAAAH/////////gAAAH/////////gAAAD/////////4AAAD/////////4AAAD/////////8AAAD/////////8AAAD/////////8AAAD/////////IAAAB/////////gAAAB/////////gAAAB/////////gAAAA////////8AAAAAf///////8AAAAAH///////8AAAAAB/////8f4AAAAAD////8AHAAAAAADn///gAAAAAAAAHH//8AAAAAAAAAOHwwAAAAAAAAAAcHgAAAAAAAAAAA8PAAAAAAAAAAAB4eAAAAAAAAAAAH48AAAAAAAAAAD/w4AAAAAAAAAD//BwAAAAAAAAAP/+DgAAAAAAAAAH/8HAAAAAAAAAAP/weAAAAAAAAAAf/A+AAAAAAAAAAgMB8AAAAAAAAAAAf/wAAAAAAAAAAA//gAAAAAAAAAAA//AAAAAAAAAAAB/+AAAAAAAAAAAH/4AAAAAAAAAAAf/wAAAAAAAAAAAx/AAAAAAAAAAAAA8AAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":83},"anser-rossii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfwAAAAAAAAAAAAAODgAAAAAAAAAAAADAeAAAAAAAAAAAAAwH4AAAAAAAAAAAAMH/gAAAAAAAAAAADA/8AAAAAAAAAAAAQP/wAAAAAAAAAAAGB//AAAAAAAAAAAAgP/8AAAAAAAAAAAMB//wAAAAAAAAAABAP//gAAAAAAAAAAIA//8AAAAAAAAAADAH9/gAAAAAAAAAAYBwAAAAAAAAAAAADAGAAAAAAAAAAAAAYAwAAAAAAAAAB/+DACAAAAAAAAAH+f/wAYAAAAAAAAHwAAGABgAAAAAAAHgAAAAAEAAAAAAADgAAAAAAQAAAAAABwAAAAAACAAAAAAA4AAAAAAAYAAAAAAcAAAAAAABAAAAAAGAAAAAAAAIAAAAABgAAAAAAABAAAAAA4AAAAAAAAIAAAAAfAAAAAAAABAAAAAf+AAAAAAAAIAAAAP/wAAAAIAABAAAAD//AAAAGAAAYAAAA//4AAADgAACAAAAf//gAAHwAAAwAAAP//8AAfgAAAGAAAH///4AOAAAABgAAH////weAAAAAYAAB////7+AAAAAGAAAf///+DAAAAABgAAH////gwAAAAAYAAAP///4MAAAAAGAAAD/////AAAAABgAAB/////wAAAAAIAAAP////8AAAAADAAAAf//gAgAAAAAwAAAA8B8AAAAAAAMAAAAAAB4AAAAAAHAAAAAAABgEAAAABgAAAAAAAHAwAAAAYAAAAAAAAPDAAAAMAAAAAAAAAMGAAAHAAAAAAAAAA8cAAPgAAAAAAAAAH++ADgAAAAAAAAAAf//AwAAAAAAAAAAB/4MEAAAAAAAAAAAD/5hgAAAAAAAAAAAB/mYAAAAAAAAAAAAD+eAAAAAAAAAAAAAP74AAAAAAAAAAAAB/eAAAAAAAAAAAAAP/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAD9wAAAAAAAAAAAAAfuAAAAAAAAAAAAAB/wAAAAAAAAAAAAAN+AAAAAAAAAAAAABH4CAAAAAAAAAAAAA/f4AAAAAAAAAAAAP//AAAAAAAAAAAAB///AAAAAAAAAAAAB//4AAAAAAAAAAAAD/4AAAAAAAAAAAAAH8AAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":77,"w":93},"anthus-rubescens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAP/gAAAAAAAH//AAAAAAAB//8AAAAAAAf//wAAAAAAH///AAAAAAA///8AAAAAA////wAAAAA////+AAAAAP////4AAAAA/////gAAAAAH///8AAAAAA////wAAAAAD///+AAAAAAP///8AAAAAB////wAAAAAP////AAAAAB////+AAAAAP////4AAAAD/////gAAAAf////+AAAAH/////4AAAA//////gAAAH/////+AAAA//////4AAAH//////gAAA//////8AAAH//////wAAA///////AAAH//////4AAA///////gAAH//////8AAA///////wAAH///////AAAf//////4AAD///////gAAf//////8AAB///////wAAP//////+AAA///////4AAH///////AAAf//////8AAD///////gAAP//////+AAB///////wAAH//////+AAAf//////4AAB///////AAAH//////4AAAf//////AAAB//////4AAAH//////AAAAf/////8AAAA/////vgAAAB////98AAAAf////3gAAAPx///+cAAAHwAD//zgAAD8AAL/+EAAB+AAB//wAAA/wAAH/8AAAP+AAA//gAAD/AAAP/8AAAbYAABt/gAAHbAAANv8AAAzcAABv/wAACbgAAF/+AAADoAAAP/wAAAdAAAB/+AAABgAAAP/4AAAGAAAA//AAAAQAAAB/4AAAAAAAAP/gAAAAAAAB/8AAAAAAAAP/gAAAAAAAB/8AAAAAAAAH/wAAAAAAAA/+AAAAAAAAH/wAAAAAAAA//AAAAAAAAD/4AAAAAAAAf/AAAAAAAAD/8AAAAAAAAf/gAAAAAAAB/8AAAAAAAAP/gAAAAAAAB/8AAAAAAAAH/gAAAAAAAA58AAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":63},"anthus-spragueii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAH//AAAAAAAAP//gAAAAAAAf///4AAAAAA////8AAAAAB////4AAAAAD////AAAAAAD///4AAAAAAH///wAAAAAAH///wAAAAAAH///gAAAAAAP///gAAAAAAP///AAAAAAAP///AAAAAAAP//+AAAAAAAf//+AAAAAAAf//+AAAAAAA///+AAAAAAA///+AAAAAAB///+AAAAAAH///+AAAAAAP////AAAAAAf////AAAAAA/////AAAAAB/////gAAAAD/////gAAAAH/////gAAAAP/////gAAAAf/////gAAAA//////gAAAB//////gAAAB//////gAAAD//////gAAAH//////gAAAH//////gAAAP//////gAAAf//////AAAAf//////AAAA///////AAAA///////AAAB//////+AAAD//////+AAAD//////8AAAH//////8AAAH//////4AAAH//////4AAAP//////wAAAP//////gAAAP//////AAAAf/////+AAAAf/////8AAAAf/////4AAAAf/////4AAAA//////wAAAA//////gAAAA/////+AAAAB/////8AAAAB/////wAAAAD/////gAAAAD/////fgAAAH///+f/8AAAH////f/+AAAH///P//bAAAB3/+f+fgAAAAH/+afwgAAAAH/8QH8PAAAAP/4AA///AAAP/wAf///gAAf/gA//+AAAAf/AAmA/gAAAf/AAgAHwAAA//AAAAAQAAA/+AAAAAAAAB/+AAAAAAAAB/+AAAAAAAAD/+AAAAAAAAD/8AAAAAAAAD/8AAAAAAAAH/8AAAAAAAAH/8AAAAAAAAH/4AAAAAAAAP/4AAAAAAAAP/4AAAAAAAAP/4AAAAAAAAP+wAAAAAAAAf+wAAAAAAAAe/wAAAAAAAAc/gAAAAAAAAAZgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":66},"antigone-canadensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAH8AAAAAAAAH/AAAAAAAAH/wAAAAAAAP/4AAAAAAAf/8AAAAAAA///AAAAAAB8A/gAAAAABwAPwAAAAAAgAHwAAAAAAAAD4AAAAAAAAD4AAAAAAAAB8AAAAAAAAB8AAAAAAAAB+AAAAAAAAA+AAAAAAAAA/AAAAAAAAAfAAAAAAAAAfgAAAAAAAAPgAAAAAAAAHwAAAAAAAAD4D/gAAAAAD8H/+AAAAAB/H//wAAAAA////+AAAAAf////gAAAAP////8AAAAD/////AAAAB/////wAAAA/////8AAAAP/////AAAAD/////wAAAA/////8AAAAP////+AAAAD/////gAAAAf////4AAAAD////+AAAAA/////wAAAAf////+AAAAH/////gAAAD/////4AAAA/////+AAAAP/////AAAAH/////gAAAB/////wAAAAf////4AAAAD////8AAAAB////+AAAAA/////AAAAAf////gAAAAH////wAAAAD////4AAAAA/z//8AAAAAN4P/8AAAAAGYD/8AAAAADMB/+AAAAABmA/+AAAAAAzAD/AAAAAAZgBPAAAAAAMYAHgAAAAAGMADgAAAAADmABwAAAAABzAAwAAAAAA5gAAAAAAAAYwAAAAAAAAMYAAAAAAAAGMAAAAAAAADGAAAAAAAABjAAAAAAAAAxgAAAAAAAAYwAAAAAAAAMYAAAAAAAAGMAAAAAAAADGAAAAAAAABjAAAAAAAAAxgAAAAAAAAYwAAAAAAAAMYAAAAAAAAGMAAAAAAAADGAAAAAAAABjAAAAAAAD35gAAAAAAB/+wAAAAAAAf8YAAAAAAA//+AAAAAAARx/gAAAAAAA//AAAAAAAAIOAAAAAAAAAeAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":61},"antrostomus-carolinensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+AAAAAAAAAAAA///+AAAAAAAAAAAP///8AAAAAAAAAABP///wAAAAAAAAAAAP///AAAAAAAAAAAB///+AAAAAAAAAAAH///4AAAAAAAAAAA////gAAAAAAAAAAD///+AAAAAAAAAAAf///4AAAAAAAAAAD////4AAAAAAAAAAP////8AAAAAAAAAB/////8AAAAAAAAAP/////4AAAAAAAAA//////wAAAAAAAAH//////AAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA///////gAAAAAAAH///////gAAAAAAA///////+AAAAAAAH///////8AAAAAAA////////wAAAAAAD////////gAAAAAAf///////+AAAAAAD////////4AAAAAAP////////AAAAAAB////////+AAAAAAH////////+AAAAAA//////////AAAAAD//////////gAAAAf//////////AAAAB//////////4AAAAH/////////8AAAAAf/////////gAAAAB//////////AAAAAH//////////AAAAAP/////////+AAAAA//////////4AAAAB//////////wAAAAD//////9///AAAAA/////AAH//8AAAAPD//wAAAP//gAAAB///8AAAAf/8AAAAH/3+AAAAA//gAAAA//gAAAAAB/4AAAAD4eAAAAAAD+AAAAAeQwAAAAAAAAAAAAB+MAAAAAAAAAAAAAPQAAAAAAAAAAAAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":55,"w":93},"antrostomus-vociferus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAAAAAAAf/8AAAAAAAAAAAAP//wAAAAAAAAAAAH///AAAAAAAAAAAB///+AAAAAAAAAB/////+AAAAAAAAP///////AAAAAAAP///////8D+AAAAf///////Ah//wAAf///////wAP//+Af///////4AB////////////+AAP////////////gAB////////////8AAH////////////gAA////////////4AAD////////////AAAP///////////4AAAD///////////AAAAAH/////////4AAAAAP/////////AAAAAAf////////4AAAAAA////////+AAAAAAP////////wAAAAAP////////+AAAAAH/////////gAAAAD/////////4AAAAAf////////+AAAAAD/////////gAAAAAD////////4AAAAAAAf//////+AAAAAAAAA//////AAAAAAAAAD/////wAAAAAAAAAH////4AAAAAAAAAAP///4AAAAAAAAAAAP//+AAAAAAAAAAAB///wAAAAAAAAAAAD/56AAAAAAAAAAAAAP4AAAAAAAAAAAAAH/+AAAAAAAAAAAAA//4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAD8AAAAAAAAAAAAAAdgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":48,"w":93},"aphelocoma-californica":{"bits":"AAP8AAAAAAAAAAAf/4AAAAAAAAAAP//wAAAAAAAAAH///AAAAAAAAAH///+AAAAAAAAH////AAAAAAAAP////AAAAAAAAH////gAAAAAAAD////8AAAAAAAAv////AAAAAAAAAH///4AAAAAAAAB///+AAAAAAAAAH///wAAAAAAAAB///8AAAAAAAAAP///4AAAAAAAAD////gAAAAAAAA////+AAAAAAAAP////wAAAAAAAD////+AAAAAAAAf////wAAAAAAAH////+AAAAAAAB/////wAAAAAAAf////+AAAAAAAH/////wAAAAAAB/////+AAAAAAAf/////wAAAAAAH/////+AAAAAAA//////gAAAAAAP/////+AAAAAAD//////wAAAAAAf/////+AAAAAAH//////gAAAAAA//////8AAAAAAP//////gAAAAAB//////4AAAAAAP//////AAAAAAD//////4AAAAAAf/////+AAAAAAD//////wAAAAAAf/////8AAAAAAD//////gAAAAAAf/////4AAAAAAD/////+AAAAAAAf/////gAAAAAAD/////8AAAAAAAf/////AAAAAAAB/////4AAAAAAAP/////AAAAAAAH/////4AAAAAAD/////+AAAAAAA//////wAAAAAAeP////cAAAAAAHD/8//7gAAAAABh/4P/+AAAAAAAYf8A//gAAAAAAAf4AD/4AAAAAAAfwAAP/AAAAAAAfgAAB/4AAAAAAfwAAAP+AAAAAAP/AAAD/wAAAAADx4AAAf8AAAAAAYOAAAH/gAAAAAPBgAAA/8AAAAABwwAAAP/AAAAAAYAAAAB/4AAAAADAAAAAf+AAAAAAAAAAAD/wAAAAAAAAAAA/+AAAAAAAAAAAH/gAAAAAAAAAAB/8AAAAAAAAAAAP/AAAAAAAAAAAD/4AAAAAAAAAAAf+AAAAAAAAAAAD/wAAAAAAAAAAA/+AAAAAAAAAAAH/gAAAAAAAAAAB/8AAAAAAAAAAAP/AAAAAAAAAAAD/4AAAAAAAAAAAf+AAAAAAAAAAAH/wAAAAAAAAAAA/8AAAAAAAAAAAP/gAAAAAAAAAAB/4AAAAAAAAAAAf/AAAAAAAAAAAD/wAAAAAAAAAAAf+AAAAAAAAAAAD/gAAAAAAAAAAA/8AAAAAAAAAAAD/AAAAAAAAAAAA/wAAAAAAAAAAAD8AAAAAAAAAAAAO","h":93,"w":80},"aphelocoma-woodhouseii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAAAAB//wAAAAAAAAAAAA///wAAAAAAAAAAAP///gAAAAAAAAAAD///+AAAAAAAAAAB////gAAAAAAAAAD////wAAAAAAAAAB////+AAAAAAAAAAP////4AAAAAAAAAAf////AAAAAAAAAAAP///8AAAAAAAAAAA////wAAAAAAAAAAD///+AAAAAAAAAAAf///8AAAAAAAAAAD////4AAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAAf////+AAAAAAAAAD/////8AAAAAAAAAf/////wAAAAAAAAD//////AAAAAAAAAf/////8AAAAAAAAD//////4AAAAAAAAf//////AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD///////gAAAAAAAf//////+AAAAAAAD///////4AAAAAAAP///////gAAAAAAB///////+AAAAAAAP///////wAAAAAAA////////gAAAAAAH///////8AAAAAAAf///////wAAAAAAD////////AAAAAAAP///////8AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////wAAAAAAB///////+AAAAAAAH///////8AAAAAAAf///////wAAAAAAB///////+AAAAAAAD///////4AAAAAAAP///////gAAAAAAA///////8AAAAAAAB///////AAAAAAAAD//////4AAAAAAAAD///n/+AAAAAAAAAD//gP/4AAAAAAAAAf/4AP/gAAAAAAAAPg/AAP+AAAAAAAADwD4AA/4AAAAAAAB4A8AAH/gAAAAAAAeAPAAAf+AAAAAAAf+DwAAB/4AAAAAA//44AAAH/gAAAAAP8MOAAAA/+AAAAAB/AHgAAAD/wAAAAAPwB94AAAP/AAAAAB8H//gAAA/8AAAAANz/t0AAAD/wAAAABgb8AAAAAf/AAAAAEC/AAAAAB/8AAAAAAPwAAAAAH/gAAAAABsAAAAAAf+AAAAAAIwAAAAAB/4AAAAABAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAH/AAAAAAAAAAAAAAf8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAA","h":82,"w":93},"aquila-chrysaetos":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAAAAD//AAAAAAAAAAP//AAAAAAAAAB///wAAAAAAAAH///wAAAAAAAAf///wAAAAAAAB////gAAAAAAAD////AAAAAAAAP///+AAAAAAAAf//4MAAAAAAAB///gQAAAAAAAD//+AAAAAAAAAH//8AAAAAAAAA///wAAAAAAAAD///gAAAAAAAAf///gAAAAAAAD////AAAAAAAAP////AAAAAAAD////+AAAAAAAf////8AAAAAAB/////4AAAAAAP/////wAAAAAA//////gAAAAAD//////AAAAAAP/////+AAAAAA//////8AAAAAD//////4AAAAAH//////wAAAAAf//////gAAAAB///////AAAAAH//////+AAAAAf//////8AAAAB///////4AAAAH///////gAAAAf///////AAAAA///////8AAAAD///////4AAAAH///////gAAAAf//////+AAAAA///////4AAAAB///////wAAAAD///////AAAAAP//////+AAAAA///////8AAAAB///////wAAAAH///////AAAAAP//////8AAAAAf//////4AAAAB///////gAAAAD//////+AAAAAH//////4AAAAAf//////wAAAAA///////gAAAAB///////AAAAAB//////8AAAAAH//////wAAAAAf//////AAAAAB//////+AAAAAH//////4AAAAAP//////wAAAAA///////gAAAAD//////+AAAAAP//////+AAAAAf////////AAAB////////+AAADv///3///+AAAG////P///8AAAb///8f///8AAA////gf//nwAAA///7A///vgAAB///8A///4AAAH9//4D/+eAAAAPz//gHw/MAAAA+P/8AMB/4AAAB4f/gAOAeAAAAHg//AAAA8AAAAOD/+AAAAwAAAAYH/4AAAPgAAAAgP/wAAAGAAAAAAf/gAAAAAAAAAB/+AAAAAAAAAAD/8AAAAAAAAAAH/wAAAAAAAAAAf/gAAAAAAAAAA/+AAAAAAAAAAB/8AAAAAAAAAAD/wAAAAAAAAAAH/AAAAAAAAAAAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":77},"aramus-guarauna":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAD//AAAAAAAAAAAAA//4AAAAAAAAAAAAP//gAAAAAAAAAAAH//8AAAAAAAAAAAB///gAAAAAAAAAAA///8AAAAAAAAAAAf8f/gAAAAAAAAAAH8A/8AAAAAAAAAAB+AH/gAAAAAAAAAA/AB/4H/8AAAAAAAPgAP/D///AAAAAAD4AD/5////AAAAAA8AAf+////+AAAAAHAAH/v////8AAAABwAA///////4AAAAIAAH///////wAAAAAAB////////gAAAAAAP///////+AAAAAAB////////8AAAAAAP////////wAAAAAA/////////AAAAAAH////////8AAAAAA/////////wAAAAAD/////////AAAAAAf////////8AAAAAB/////////4AAAAAH/////////AAAAAAf////////8AAAAAB/////////wAAAAAH/////////AAAAAAP////////4AAAAAAf////////gAAAAAA////////+AAAAAAD////////wAAAAAAP////////AAAAAAAf///////gAAAAAAB///////+AAAAAAAD///////8AAAAAAAD///////wAAAAAAAH///////AAAAAAAAP//////8AAAAAAAA///////gAAAAAAAD//wf//8AAAAAAAAf+AAf/4AAAAAAAAB/wAAH/AAAAAAAAAP+AAAf8AAAAAAAAAfwAAB/gAAAAAAAADnAAAH8AAAAAAAAAM4AAAfgAAAAAAAAB3gAAAwAAAAAAAAAOcAAAAAAAAAAAAAA7gAAAAAAAAAAAAAH8AAAAAAAAAAAAAB7gAAAAAAAAAAAAAPcAAAAAAAAAAAAAA7gAAAAAAAAAAAAAHcAAAAAAAAAAAAAA7gAAAAAAAAAAAAAOcAAAAAAAAAAAAABzgAAAAAAAAAAAAAOcAAAAAAAAAAAAABzgAAAAAAAAAAAAAMcAAAAAAAAAAAAADjgAAAAAAAAAAAAAccAAAAAAAAAAAAADjgAAAAAAAAAAAAAccAAAAAAAAAAAAADjgAAAAAAAAAAAAAYcAAAAAAAAAAAAAHDgAAAAAAAAAAAAA4cAAAAAAAAAAAAAHHgAAAAAAAAAAAAP/+AAAAAAAAAAAAf//8AAAAAAAAAAAB//7gAAAAAAAAAAH//+EAAAAAAAAAAH/7wQAAAAAAAAAAA+B4AAAAAAAAAAAAAAeAAAAAAAAAAAAAAHAAAAAAAAAAAAAABwAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAA","h":88,"w":93},"archilochus-alexandri":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/4AAAAAAAAAAAAB//wAAAAAAAA/gAA///AAAAAAAB///5///+AAAAAAAH///////wAAAAAAAAB//////AAAAAAAAAAP////8AAAAAAAAAAH////gAAAAAAAAAAH///+AAAAAAAAAAAf///wAAAAAAAAAAB///+AAAAAAAAAAAP///wAAAAAAAAAAA///+AAAAAAAAAAAH///wAAAAAAAAAAAf///AAAAAAAAAAAD///4AAAAAAAAAAAf///gAAAAAAAAAAD///8AAAAAAAAAAAf///wAAAAAAAAAAB////AAAAAAAAAAAP///8AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAB////+AAAAAAAAAAP////4AAAAAAAAAB/////gAAAAAAAAAP////+AAAAAAAAAB/////4AAAAAAAAAP/////AAAAAAAAAB/////8AAAAAAAAAP/////wAAAAAAAAB//////AAAAAAAAAP/////8AAAAAAAAB//////gAAAAAAAAP/////+AAAAAAAAB//////4AAAAAAAAH//////AAAAAAAAAv/////8AAAAAAAAG//////gAAAAAAAAT/////+AAAAAAAADP/////wAAAAAAAAI//////AAAAAAAABj/////4AAAAAAAAGP/////AAAAAAAAAY/////8AAAAAAAADD/////gAAAAAAAAMP////+AAAAAAAAAwf////wAAAAAAAADB////+AAAAAAAAAMH////4AAAAAAAAAwP////AAAAAAAAAAgH///4AAAAAAAAAfAf///gAAAAAAAAD4H///+AAAAAAAAA89////4AAAAAAAAD/+////gAAAAAAAAfPz///+AAAAAAAAA8f////4AAAAAAAADD/f///gAAAAAAAAAPx///+AAAAAAAAAAAH///4AAAAAAAAAAAf///gAAAAAAAAAAB///8AAAAAAAAAAAH///wAAAAAAAAAAAf/7/AAAAAAAAAAAD//n8AAAAAAAAAAAP/8PgAAAAAAAAAAB//wMAAAAAAAAAAAH/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//gAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAAcfAAAAAAAAAAAAAAB4AAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":82,"w":93},"archilochus-colubris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAAAAH//gAAAAAAAAAAAD//+AAAAAAAAP/8D///4AAAAAAAP///////gAAAAAAAf//////+AAAAAAAAAB/////wAAAAAAAAAAP////AAAAAAAAAAAf///4AAAAAAAAAAB////gAAAAAAAAAAH///8AAAAAAAAAAAf///gAAAAAAAAAAD///+AAAAAAAAAAAf///wAAAAAAAAAAB////AAAAAAAAAAAP///4AAAAAAAAAAB////gAAAAAAAAAAP////AAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAB/////gAAAAAAAAAP////+AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAB/////+AAAAAAAAAH/////4AAAAAAAAB//////gAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAH//////AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAAf//////AAAAAAAAD//////8AAAAAAAAf//////gAAAAAAAB//////+AAAAAAAAP//////wAAAAAAAA///////AAAAAAAAH//////4AAAAAAAAf//////AAAAAAAAB//////8AAAAAAAAH//////gAAAAAAAAf/////+AAAAAAAAB//////wAAAAAAAAH/////+AAAAAAAAAf/////wAAAAAAAAB//////AAAAAAAAAP/////8AAAAAAAAB//////wAAAAAAAAP//////AAAAAAAAB0/////+AAAAAAAAPnf////4AAAAAAAA+5/////gAAAAAAADv/////+AAAAAAAAA/gP///8AAAAAAAAD8B////wAAAAAAAAHgH////AAAAAAAAAAAf///8AAAAAAAAAAB8///gAAAAAAAAAAHD//wAAAAAAAAAAAMf7/AAAAAAAAAAAAz/n8AAAAAAAAAAADP8HgAAAAAAAAAAAN/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/wAAAAAAAAAAAAAD+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":82,"w":93},"ardea-alba":{"bits":"AAAAAAAAAAAAAAGAAAAAAAAAA/+AAAAAAAAD//wAAAAAAAH///AAAAAAAP/8f+AAAAAA//+DjAAAAAD//+AwAAAAAP//+AAAAAAA///+AAAAAAD+A/+AAAAAAHwA/+AAAAAAOAA/+AAAAAAAAB/8/AAAAAAAD///wAAAAAAD///8AAAAAAD///+AAAAAAH////AAAAAAH////gAAAAAH////wAAAAAH////4AAAAAH////8AAAAAD////+AAAAAD////+AAAAAD/////AAAAAB/////gAAAAB/////gAAAAB/////wAAAAA/////wAAAAAf////4AAAAAf////8AAAAAP////+AAAAAH////+AAAAAD/////AAAAAD/////gAAAAB/////gAAAAB/////wAAAAB/////4AAAAB/////4AAAAAN////8AAAAAM////8AAAAAIf///+AAAAAIf///+AAAAAIP///7AAAAAIH///7AAAAAIH///5AAAAAAD///5AAAAAAD///5gAAAAAD///4AAAAAAB///8AAAAAAA///8AAAAAAA///8AAAAAAA2//8AAAAAAA+f/8AAAAAAAfH/+AAAAAAAbB/+AAAAAAAbB/+AAAAAAAbB//AAAAAAAfg//AAAAAAAdg/9gAAAAAAdgfYgAAAAAAPgfAwAAAAAAPgHAYAAAAAAdgAAIAAAAAAZgAAEAAAAAAZgAAAAAAAAAZgAAAAAAAAAZgAAAAAAAAAZgAAAAAAAAAZgAAAAAAAAAZgAAAAAAAAAZgAAAAAAAAAZgAAAAAAAAARgAAAAAAAAAxgAAAAAAAAAxgAAAAAAAAAxgAAAAAAAAAxgAAAAAAAAAzgAAAAAAAB8zgAAAAAAAAf/gAAAAAAAP//gAAAAAAAePv8AAAAAAAA+/8AAAAAAAB/9gAAAAAAAHeZgAAAAAAAGZwgAAAAAAAEDgwAAAAAAAAHA4AAAAAAAAGAYAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":66},"ardea-herodias":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAP4AAAAAAAAA/+AAAAAAAAB//gAAAAAAAf//4AAAAAAH///+AAAAAA/////gAAAAH////58AAAAP////4fwAAAAAAAf4MQAAAAAAAP4CAAAAAAAAf4AAAAAAAAA/4AAAAAAAAH/4AAAAAAAAf/wAAAAAAAA//wAAAAAAAB//gAAAAAAAB/+AAAAAAAAB/4AAAAAAAAD/gfgAAAAAAD/B/4AAAAAAD/D/+AAAAAAD/D//AAAAAAD/H//wAAAAAD////4AAAAAD////8AAAAAB////+AAAAAB/////AAAAAB/////gAAAAB/////wAAAAA/////4AAAAA/////8AAAAAf////+AAAAAf/////AAAAAP/////AAAAAH/////gAAAAH/////wAAAAD/////wAAAAB/////4AAAAB/////4AAAAA/////8AAAAA/////8AAAAA/////+AAAAAP////+AAAAAP/////AAAAAH/////AAAAADf////AAAAADP////gAAAADn////gAAAAAj////gAAAAAg////wAAAAAg////wAAAAAAf///4AAAAAAf///4AAAAAAP///4AAAAAAPv//4AAAAAAHn//4AAAAAAHj//8AAAAAAHwH/8AAAAAAHwD/8AAAAAAHwB/8AAAAAADwA/8AAAAAAD4Af8AAAAAAD4Af8AAAAAAD4APAAAAAAAD4ADAAAAAAADwAAAAAAAAADwAAAAAAAAADwAAAAAAAAADwAAAAAAAAADwAAAAAAAAADwAAAAAAAAAHwAAAAAAAAAHwAAAAAAAAAHwAAAAAAAAAHwAAAAAAAAAHwAAAAAAAAAHwAAAAAAAAAHwAAAAAAAAAHwAAAAAAAAD3wAAAAAAAAf//AAAAAAAAf//gAAAAAAAf/+AAAAAAAH///AAAAAAAP/8IAAAAAAAAA4AAAAAAAAADwAAAAAAAAAHAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":66},"arenaria-interpres":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAD/+AAAAAAAAAAAAA//4AAAAAAAAAAAAP//gAAAAAAAAAAAB//+AAAAAAAAAAAAf//wAAAAAAAAAAAD///AAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAD/////gAAAAAAAAB//////wAAAAAAAA///////8AAAAAAAP4//////8AAAAAABgB//////8AAAAAAAAP//////4AAAAAAAB///////wAAAAAAAP///////gAAAAAAB////////AAAAAAAP///////+AAAAAAB////////8AAAAAAP////////8AAAAAB//////////wAAAAP///////////8AAB////////////gAAP///////////+AAA////////////8AAH////////////gAAf///////////8AAD/////////g8AAAAP////////A4AAAAB///////8AcAAAAAH///////gMAAAAAAf//////8DAAAAAAB///////BwAAAAAAH//////4cAAAAAAAf/////+PAAAAAAAA//////hgAAAAAAAB/////84AAAAAAAAD/////8AAAAAAAAAH/////AAAAAAAAAAD////AAAAAAAAAAAB//+AAAAAAAAAAAAD4/gAAAAAAAAAAAAeB8AAAAAAAAAAAABwHAAAAAAAAAAAAAPA8AAAAAAAAAAAABwHgAAAAAAAAAAAAOA4AAAAAAAAAAAABwHAAAAAAAAAAAAAcA4AAAAAAAAAAAADgHAAAAAAAAAAAAAYA4AAAAAAAAAAAAHAHAAAAAAAAAAAAA4AwAAAAAAAAAAAAHAOAAAAAAAAAAAAB4BwAAAAAAAAAAAf//eAAAAAAAAAAAf///wAAAAAAAAAAH8H/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":63,"w":93},"artemisiospiza-belli":{"bits":"AAAAAAAAAAAB/8AAAAAAAAAAAAB//8AAAAAAAAAAAAf//wAPwAAAAAAAAP///A9/gAAAAAAAD///8H//AAAAAAAA////w//8AAAAAAAP////n//4AAAAAAD////+f//wAAAAAB/////4///gAAAAf//////B//+AAAA//////+AH//8AAA///////AAP//wAA///////4AAf//gB///////+AAA////////////wAAB///////////8AAAB///////////gAAAH//////////4AAAAf//////////AAAAB//////////4AAAAH//////////AAAAAf/////////4AAAAB//////////AAAAAP/////////4AAAAA/////////+AAAAAD/////////wAAAAAP////////+AAAAAB/////////wAAAAAP////////8AAAAAH/////////gAAAAD/////////4AAAAB//////////AAAAAf/////////wAAAAD/////////+AAAAAf/////////gAAAAAAB///////4AAAAAAAH//////+AAAAAAAAf//////gAAAAAAAB//////4AAAAAAAAH/////8AAAAAAAAAf/////AAAAAAAAAB/////wAAAAAAAAAB////4AAAAAAAAAAf///8AAAAAAAAAAD///8AAAAAAAAAAAP//8AAAAAAAAAAAB8BfwAAAAAAAAAAAHwAfwAAAAAAAAAAAfAAfgAAAAAAAAAAA8AA+AAAAAAAAAAADwB/8AAAAAAAAAAAPAfnwAAAAAAAAAAA8Dg/AAAAAAAAAAADwQH4AAAAAAAAAAAPgA9AAAAAAAAAAAP/An4AAAAAAAAAAD/+H8AAAAAAAAAAAcP4dgAAAAAAAAAACB7AcAAAAAAAAAAAQnYBgAAAAAAAAAAAF4AYAAAAAAAAAAAA/ACAAAAAAAAAAAAD4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAOAAAAAAA","h":66,"w":93},"asio-flammeus":{"bits":"AAH/8AAAAAAP//4AAAAAP///wAAAAH///+AAAAH////wAAAD/////AAAB/////wAAAf////+AAAP/////wAAD/////8AAB//////AAAf/////4AAH/////+AAD//////gAA//////8AAP//////AAD//////wAA//////8AAP//////AAD//////wAA//////8AAP//////AAD//////wAA//////+AAP//////wAD//////8AA///////gAP//////8AH///////gB///////8A////////gP///////4D////////A////////wP///////+D////////g////////8P////////D////////wf///////+H////////h////////4f////////H////////w////////8P////////j////////4////////+H////////h////////4f///////+D////////g////////4H///////+B////////gP///////4A///////+AH///////wB///////8AP///////AB///////wAP//////8AD///////AAf//////wAD//////8AA///////AAH//////wAA//////8AAH//////AAB//////wAAP/////8AAD//////AAA//////gAAH/////4AAB/////+AAAP/////gAAD/////4AAA/////+AAAf/////gAAP/////4AD//////+AD///////gB///////4AT/B////+AE+AP////AAMAH////wABAD////8AAABv8B/+AAAAY+AB/AAAAAPAAAAAAAAHgAAAAAAABgAAAAAAAAQAAAA","h":93,"w":56},"asio-otus":{"bits":"AgAAGAAAABwAAPAAAAB4AAPAAAAB8AAfAAAAB8AA/AAAAB+AA/AAAAB/AB/AAAAB/gD+AAAAA/kT+AAAAAf//8AAAAA///+AAAAB////AAAAD////gAAAD////gAAAH////gAAAH////wAAAH////wAAAH////wAAAH////wAAAH////wAAAP////4AAAP////4AAAP////4AAAP////4AAAP////8AAAP////8AAAP////8AAAP////+AAAP////+AAAf/////AAAf/////gAAf/////wAA//////4AA//////8AA//////8AA//////+AA///////AA///////AA///////AA///////gA///////gA///////gA///////wA///////wA///////wA///////4Af//////4Af//////4Af//////4Af//////4Af//////4AP//////4AP//////8AH//////8AA//////8AAf/////8AAP/////8AAP/////8AAH/////+AAH/////+AAD/////+AAB/////+AAB/////+AAA/////+AAAf////+AAAP////+AAAP////+AAAP////+AAAH////8AAAH////+AAAP/////AAB//////AAD//////gAD//////wAH//////4AH//v///4AG/vn///8AH7vH///+ABf3D///+AAMHP////AAADg//3/AAAAA//z/AAAAA//x7AAAAA//w4AAAAA//wYAAAAAf/wIAAAAAf/wAAAAAAf/4AAAAAAf/4AAAAAAP/wAAAAAAH/wAAAAAAD/wAAAAAAA/AAA==","h":93,"w":54},"athene-cunicularia":{"bits":"Af+AAAAP/8AAAb//+AAD///wAAP//8AAB///wAAf//+AAD///4AAf///AAD///4AAf///AAD///4AAf///gAD///8AAf///wAD///+AAf///4AD////gA////+AH////4A/////gH////+A/////wH/////A/////4H/////g/////8H/////w/////+H/////wf/////D/////4f/////D/////4f/////h/////8P/////h/////8H/////gP////+A/////wH////+Af////wB////+AP////4A/////AD////4Af////AB////4AH////AAf///4AB////AAP///4AB////AAP///4AA////AAH///4AA////AAD///4AAf///AAD///oAAPf/8AABz5/wAAOeP+AABzh/wAAOcH+AABzg/wAAOcD8AABzgBAAAecAAAADzgAAAAecAAAADjgAAAAccAAAADjgAAAAccAAAABjgAAAAMcAAAABjgAAAAccAAAAD7wAAAAffAAAAD74AAAAf+AAAAH//AAAH//8AAB//vgAAf/4AAAD/nAAAAWZwAAAAQOAAAAABgAAAAAMAAAA==","h":93,"w":39},"auriparus-flaviceps":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAD//AAAAAAAAAAAAA//8AAAAAAAAAAAAP//wAAAAAAAAAAAD///AAAAAAAAAAAA///8AAAAAAAAAAAP///8AAAAAAAAAAB////4AAAAAAAAAAf////gAAAAAAAAAH////8AAAAAAAAAA////gAAAAAAAAAAH///4AAAAAAAAAAB///+AAAAAAAAAAAf///gAAAAAAAAAAH///8AAAAAAAAAAB////AAAAAAAAAAA////4AAAAAAAAAAP///+AAAAAAAAAAD////wAAAAAAAAAA/////AAAAAAAAAAP////4AAAAAAAAAD/////AAAAAAAAAA/////4AAAAAAAAAP/////AAAAAAAAAD/////4AAAAAAAAB//////AAAAAAAAAf/////wAAAAAAAAP/////+AAAAAAAAD//////wAAAAAAAA//////8AAAAAAAAP//////gAAAAAAAD//////4AAAAAAAA///////AAAAAAAAP//////wAAAAAAAD//////8AAAAAAAA///////gAAAAAAAH//////4AAAAAAAB//////+AAAAAAAAf//////gAAAAAAAH//////4AAAAAAAB//////+AAAAAAAAf//////AAAAAAAAH//////wAAAAAAAB//////8AAAAAAAAf/////+AAAAAAAAH//////gAAAAAAAB//////wAAAAAAAA//////8AAAAAAAAP//D///8AAAAAAAH/4AAH7//wAAAAAB/4AAAfgf/gAAAAA/8AAAA/AB/gAAAAf/AAAAB8Af8AAAAH/gAAAAD4P/gAAAB/4AAAAAHx38AAAA/+AAAAAAfo/AAAAf/AAAAAAA/nwAAAH/wAAAAAAf/+AAAB/8AAAAAAPfMwAAAf+AAAAAAB54MAAAH/gAAAAAAdfDAAAB/wAAAAAADPwAAAAP8AAAAAAAb8AAAAAfAAAAAAABvgAAAADgAAAAAAAAYAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"aythya-affinis":{"bits":"AAAfgAAAAAAAAAAAAAf/gAAAAAAAAAAAAH//wAAAAAAAAAAAB//+AAAAAAAAAAAAf//wAAAAAAAAAAAH//8AAAAAAAAAAAA///wAAAAAAAAAAAH//+AAAAAAAAAAAB///4AAAAAAAAAAAP///gAAAAAAAAAAB///8AAAAAAAAAAAP///gAAAAAAAAAAD///8AAAAAAAAAAA////wAAAAAAAAAAP///+AAAAAAAAAAH////wAAAAAAAAAB////+AAAAAAAAAB/////wAAAAAAAAAf////+AAAAAAAAAH/+///z//4AAAAAA/8A//////4AAAAACcAf//////4AAAAAAAH///////wAAAAAAD////////gAAAAAA////////+AAAAAAH////////4AAAAAB/////////wAAAAAf/////////4AAAAD//////////wAAAAf//////////gAAAH//////////+AAAA////////////AAAH///////////+AAA////////////8AAH////////////4AA/////////////gAH////////////8AA/////////////gAH/////////////AA/////////////8AD/////////////wAf////////////gAB////////////+AAH////////////wAA/////////////gAD////////////4AAP////////////gAAf////////////AAB////////////4AAD///////////+AAAD///////////AAAAH/////////uAAAAAH////////wAAAAAAH///////wAAAAAAAH//////wAAAAAAAAf/////4AAAAAAAAD/////8AAAAAAAAAf////4AAAAAAAAAH/////AAAAAAAAAA/8AP/4AAAAAAAAAH/wD/+AAAAAAAAAB//Af/AAAAAAAAAAP/4P8AAAAAAAAAAA/4B/gAAAAAAAAAAG+Af8AAAAAAAAAAADgP/gAAAAAAAAAAAOD/4AAAAAAAAAAAAw/+AAAAAAAAAAAAAH/wAAAAAAAAAAAAAv+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAIeAAAAAAAAAAAAABAwAAAAAAAAAAAAAIGAAAAAAA==","h":78,"w":93},"aythya-americana":{"bits":"AAAPgAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//AAAAAAAAAAAAB//+AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAB///+AAAAAAAAAAAP///4AAAAAAAAAAB////AAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAP///+AAAAAAAAAAD////wAAAAAAAAAAf///+AAAAAAAAAAH////4AAAAAAAAAB/////AAAAAAAAAA/////4AAAAAAAAAP/////AAAAAAAAAH/////4AAAAAAAAD//f//+AAAAAAAAA//B///wAAAAAAAAH/Af//+AAAAAAAAA/gP///wAAAAAAAACAH///eAAAAAAAAAAB///z/wAAAAAAAAAf/////8AAAAAAAAP//////8AAAAAAAB///////4AAAAAAAf///////wAAAAAAH////////gAAAAAA////////+AAAAAAH////////8AAAAAB/////////4AAAAAP/////////gAAAAB/////////+AAAAAP/////////8AAAAB//////////4AAAAP//////////wAAAB///////////AAAAP//////////8AAAB///////////wAAAH//////////+AAAA///////////8AAAH///////////wAAAf///////////AAAB///////////8AAAP///////////+AAA////////////8AAD////////////4AAP////////////gAA////////////8AAD///////////8AAAH///////////wAAAP//////////+AAAA///////////4AAAB///////////wAAAD///////////gAAAH//////////8AAAAf//////////4AAAA///////////AAAAB//////////4AAAAD///////9/8AAAAAH//////8AAAAAAAAP/////+AAAAAAAAB/////+AAAAAAAAA/////4AAAAAAAAAf/Af/8AAAAAAAAAP/4DwAAAAAAAAAAD/8AeAAAAAAAAAAB//wDwAAAAAAAAAAf/+AeAAAAAAAAAAD//wDwAAAAAAAAAAZ/+AeAAAAAAAAAACH/wDwAAAAAAAAAAAfnA/AAAAAAAAAAADh//8AAAAAAAAAAAYf//gAAAAAAAAAADA//wAAAAAAAAAAAIH/8AAAAAAAAAAAAA//gAAAAAAAAAAAAP/8AAAAAAAAAAAAD//AAAAAAAAAAAAB//4AAAAAAAAAAAAP/+AAAAAAAAAAAADB/gAAAAAAAAAAAAAH4AAAAAAAAAAAAAA8AAAAAAAAAAAAAADAAAAAAAAAAAAAAAQAAAAAAAAAAAAAACAAAAAAAAA=","h":92,"w":93},"aythya-collaris":{"bits":"AAA/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAAf//wAAAAAAAAAAAH//+AAAAAAAAAAAB///wAAAAAAAAAAAP//8AAAAAAAAAAAD///gAAAAAAAAAAAf//+AAAAAAAAAAAD///4AAAAAAAAAAAf///AAAAAAAAAAAD///4AAAAAAAAAAA////gAAAAAAAAAAP///8AAAAAAAAAAD////gAAAAAAAAAA////8AAAAAAAAAAP////gAAAAAAAAAH////8P/gAAAAAAD////9///wAAAAAA//n//////4AAAAAH/g///////4AAAAA/gf///////wAAAAAAP////////gAAAAAH/////////gAAAAB//////////AAAAAf/////////+AAAAD//////////+AAAA///////////4AAAH///////////wAAB////////////AAAP///////////+AAB/////////////gAP/////////////AB/////////////4AP////////////8AB/////////////wAP////////////+AB/////////////8AP/////////////8A//////////////4H//////////////Af/////////////4B/////////////8AH///////////38AAf//////////4AAAB//////////8AAAAD/////////+AAAAAD/////////AAAAAAD////////gAAAAAAA///////wAAAAAAAAf/////8AAAAAAAAAP////8AAAAAAAAAAf///4AAAAAAAAAAH///+AAAAAAAAAAAv/8AAAAAAAAAAAAB//wAAAAAAAAAAAAP/8AAAAAAAAAAAAD/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAH/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/wAAAAAAAAAAAABh+AAAAAAAAAAAAAEHgAAAAAAAAAAAAAAYAAAAAAAAAAAAAADgAAAAAAAA=","h":67,"w":93},"aythya-marila":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAH/wAAAAAAAAAAAAB//gAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAB///gAAAAAAAAAAAf//8AAAAAAAAAAAH///gAAAAAAAAAAA///+AAAAAAAAAAAP///4AAAAAAAAAAB////gAAAAAAAAAAP///+AAAAAAAAAAB////4AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAP/////AAAAAAAAAB///P/8AAAAAAAAAP/8AH/gAAAAAAAAB//wAH8AAAAAAAAAP//AAAAAAAAAAAA///8AAAAAAAAAAf////wAAAAAAAAB//////AAAAAAAAB//////8AAAAAAAA///////gAAAAAAAf//////8AAAAAAAP///////wAAAAAAD///////+AAAAAAB////////wAAAAAAf///////+AAAAAAP////////wAAAAAH////////+AAAAAB/////////wAAAAA/////////+AAAAAP/////////wAAAAD/////////8AAAAAf/////////gAAAAH/////////8AAAAB//////////AAAAAf/////////4AAAAP/////////+AAAAD//////////wAAAA//////////8AAAAH//////////AAAAB3/////////wAAAAJ/////////8AAAAAf/////////AAAAAH/////////wAAAAB/////////8AAAAAf/////////AAAAAH/////////wAAAAB/n///////8AAAAAPw////////AAAAAD4P///////wAAAAA+B/v/////8AAAAAHAf9//////AAAAABwD/n/////wAAAAAMAf8/////8AAAAABAH/z/////AAAAAAAA/+P////gAAAAAAAH/4////4AAAAAAAB//A/8AcAAAAAAAAP/58HAeAAAAAAAAB//H/gP/wAAAAAAAf/4fgP/+AAAAAAAD//D/f//4AAAAAAA/////AB/AAAAAAAP//m//gf4AAAAAAD//gA/+H/AAAAAAA//4AA/w/8AAAAAAH/4AAD+E/gAAAAAB/wAAAfwP8AAAAAAHAAAAH+D/gAAAAAAAAAAA/wf8AAAAAAAAAAAH+H/gAAAAAAAAAAA3w/+AAAAAAAAAAAB+G/wAAAAAAAAAAAPwD+AAAAAAAAAAAD8AegAAAAAAAAAAA/gBwAAAAAAAAAAAH8AMAAAAAAAAAAAA/ADgAAAAAAAAAAAH4AAAAAAAAAAAAABnAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":89,"w":93},"aythya-valisineria":{"bits":"AAAH+AAAAAAAAAAAAAD/8AAAAAAAAAAAAA//4AAAAAAAAAAAAP//gAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAD///4AAAAAAAAAAA////AAAAAAAAAAAf///8AAAAAAAAAAH////gAAAAAAAAAD////8AAAAAAAAAD/////gAAAAAAAAB/////8AAAAAAAAA//4f//wAAAAAAAAH/AAP/8AAAAAAAAAwAAB//gAAAAAAAAAAAAH/8AAAAAAAAAAAAA//gAAAAAAAAAAAAH/8AAAAAAAAAAAAB//gAAAAAAAAAAAAP/4AAAAAAAAAAAAB//AAAAAAAAAAAAAf/4AAAAAAAAAAAAD/+AH/wAAAAAAAAA//gf//8AAAAAAAAP/8f////gAAAAAAD//v/////+AAAAAAf////////+AAAAAH/////////8AAAAB///////////wAAAf///////////AAAD///////////wAAA////////////AAAH///////////8AAA////////////wAAP////////////wAB/////////////AAP////////////4AB////////////+AAP////////////gAB////////////wAAP///////////AAAB///////////AAAAH//////////wAAAA//////////8AAAAD//////////AAAAAf/////////wAAAAB/////////4AAAAAH////////+AAAAAAP///////+AAAAAAA////////AAAAAAAB///////gAAAAAAAB//////4AAAAAAAAA/////4AAAAAAAAAAP///8AAAAAAAAAAB////AAAAAAAAAAA//gB4AAAAAAAAAAf/wAPAAAAAAAAAAH/+AB4AAAAAAAAAA//wAOAAAAAAAAAAE/+ABwAAAAAAAAAAD/wAeAAAAAAAAAAAPCADwAAAAAAAAAABgAA/AAAAAAAAAAAMAgf4AAAAAAAAAAAAP/8AAAAAAAAAAAAA//gAAAAAAAAAAAAH/8AAAAAAAAAAAAA//AAAAAAAAAAAAAH/4AAAAAAAAAAAAB/+AAAAAAAAAAAAAf/wAAAAAAAAAAAACD8AAAAAAAAAAAAAAPAAAAAAAAAAAAAABwAAAAAAAAAAAAAAIAAAAAAAA=","h":77,"w":93},"baeolophus-atricristatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAADAAAAAAAAAAAAAABcAAAAAAAAAAAAAAPgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPwAAAAAAAAAAAAAF+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAH/AAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAD//AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAP///gAAAAAAAAAAD///8AAAAAAAAAAA////wAAAAAAAAAAP///+AAAAAAAAAAB////+AAAAAAAAAAf////4AAAAAAAAAD/////gAAAAAAAAA/////4AAAAAAAAAP////wAAAAAAAAAD////+AAAAAAAAAB/////gAAAAAAAAA/////8AAAAAAAAAf/////AAAAAAAAAP/////4AAAAAAAAD/////+AAAAAAAAA//////wAAAAAAAAP/////+AAAAAAAAD//////gAAAAAAAA//////8AAAAAAAAf//////gAAAAAAAP//////8AAAAAAAD///////gAAAAAAA///////8AAAAAAAP///////gAAAAAAD///////8AAAAAAA////////gAAAAAAP///////4AAAAAAD////////AAAAAAA////////4AAAAAAP///////+AAAAAAB////////wAAAAAAf///////8AAAAAAH////////AAAAAAB////////wAAAAAAf///////+AAAAAAH////////gAAAAAB////////4AAAAAAL///////+AAAAAAB////////gAAAAAAf///////4AAAAAAP///////+AAAAAAD////////AAAAAAB////////gAAAAAA////////4AAAAAAP/4AP///8AAAAAAH/+AAf///4AAAAAB//AAAf/+/8AAAAA//wAAB/+H/4AAAAP/4AAABD9//AAAAD/+AAAAAH+D4AAAB//gAAAAB/8PAAAAf/4AAAAAf/h4AAAH/8AAAAAHh8PAAAA//AAAAAA4HnwAAAP/wAAAAAGD4MAAAB/8AAAAAAQfDAAAAP+AAAAAAAP4AAAAB/AAAAAAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":78,"w":93},"baeolophus-bicolor":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAaAAAAAAAAAAAAAAPwAAAAAAAAAAAAAD8AAAAAAAAAAAAAA/4AAAAAAAAAAAAAf+AAAAAAAAAAAAAH/4AAAAAAAAAAAAB//AAAAAAAAAAAAA//4AAAAAAAAAAAAP//AAAAAAAAAfAAB//+AAAAAAAAf4AAf//4AAAAAAAP/8AH///wAAAAAAD//gB////gAAAAAD//8AP///+AAAAAA///AD////4AAAAAf//4A/////gAAAAP//8Af/////4AAAD///AP//////8AAB///gB///////8AA///gAB////////wP//wAAD////////3//4AAAf//////////8AAAB//////////8AAAAP//////////AAAAA//////////wAAAAD//////////gAAAAf/////////+AAAAD//////////wAAAAf////////+AAAAAD/////////wAAAAAP////////8AAAAAB/////////gAAAAAP////////8AAAAAB/////////wAAAAAP/////////gAAAAA//////////AAAAAH/////////8AAAAAf/////////wAAAAD////////v/AAAAAP///////4AAAAAAB////////AAAAAAAH///////wAAAAAAAf//////8AAAAAAAB///////gAAAAAAAH//////wAAAAAAAAf/////8AAAAAAAAA//////AAAAAAAAAD/////4AAAAAAAAAP////8AAAAAAAAAAf///+AAAAAAAAAAAf///AAAAAAAAAAAA///4AAAAAAAAAAAfgB+AAAAAAAAAAAP8AeAAAAAAAAAAAH/4PAAAAAAAAAAAD//jwAAAAAAAAAAAfAA8QAAAAAAAAAAH4Af/gAAAAAAAAAA+Af/+AAAAAAAAAAHwH8AAAAAAAAAAAAfg/AAAAAAAAAAAAB8F4AAAAAAAAAAAAHA+AAAAAAAAAAAAAQDwAAAAAAAAAAAAAAegAAAAAAAAAAAAABcAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAA","h":72,"w":93},"baeolophus-inornatus":{"bits":"AAEAAAAAAAAAAAAAABgAAAAAAAAAAAAAAfAAAAAAAAAAAAAAH4AAAAAAAAAAAAAB/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAD//wAAAAAAAAAAAA///wAAAAAAAAAAAH///gAAAAAAAAAAB///+AAAAAAAAAAAP///4AAAAAAAAAAD////wAAAAAAAAAAf////8AAAAAAAAAD/////+AAAAAAAAAf/////8AAAAAAAAD//////4AAAAAAAA///////wAAAAAAAf///////wAAAAAAH////////gAAAAAA/////////AAAAAAAf///////8AAAAAAB////////4AAAAAAH////////gAAAAAA/////////AAAAAAD////////8AAAAAAf////////wAAAAAB/////////gAAAAAP////////+AAAAAB/////////4AAAAAH/////////wAAAAA//////////8AAAAH//////////+AAAAf///////////AAAD////////////AAAP////////////AAB/////////////AAH////////gP//+AAf///////gAP//4AB///////wAAH//AAP//////4AAAH/4AA//////+AAAAH+AAB//////gAAAAAAAAD/////4AAAAAAAAAP////8AAAAAAAAAA/////gAAAAAAAAAB////8AAAAAAAAAAB////gAAAAAAAAAAD//8AAAAAAAAAAAB/4fAAAAAAAAAAAAf/vgAAAAAAAAAAADwf/4AAAAAAAAAAA9A//gAAAAAAAAAAH8PA8AAAAAAAAAAA/j6BgAAAAAAAAAAD/fUAAAAAAAAAAAADj/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAAuAAAAAAAAAA=","h":61,"w":93},"baeolophus-ridgwayi":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAHgAAAAAAAAAAAAAD+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAH/4AAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//gAAAAAAAAAAAB//8AAAAAAAAAAAAP//wAAAAAAAAAAAD///AAAAAAAAAAAAf//+AAAAAAAAAAAH///4AAAAAAAAAAA////gAAAAAAAAAAH///+AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAD////8AAAAAAAAAA/////wAAAAAAAAAP/////gAAAAAAAAB//////AAAAAAAAAB/////+AAAAAAAAAP/////8AAAAAAAAB//////4AAAAAAAAP//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////4AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////gAAAAAAf///////+AAAAAAD////////4AAAAAAP////////gAAAAAB/////////AAAAAAP////////4AAAAAB/////////gAAAAAH////////8AAAAAA/////////wAAAAAD/////////gAAAAAf////////+AAAAAB/////////4AAAAAH/////////wAAAAAf/////////AAAAAB/////////4AAAAAP/////////gAAAAA//////////AAAAAD/////////+AAAAAH/////+AD/8AAAAAf/////gAP/wAAAAA/////4AAf/gAAAAB////8AAB//AAAAAD///+AAAD/8AAAAAD///wAAAH/4AAAAB///8AAAAP/gAAAA/AB7AAAAA//AAAB//g+AAAAAB/8AAAf/+PgAAAAAD/gAAD+DTwAAAAAAHcAAA/gB/+AAAAAAAAAAH8B//4AAAAAAAAAAfgf6NAAAAAAAAAAB+D+AIAAAAAAAAAAPwXwAAAAAAAAAAAA8C+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAA+gAAAAAAAAAAAAAG8AAAAAAAAAAAAAAYAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":77,"w":93},"bartramia-longicauda":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfwAAAAAAAAAAAAAP/gAAAAAAAAAAAAD/+AAAAAAAAAAAAA//wAAAAAAAAAAAD///AAAAAAAAAAAf///4AAAAAAAAAAP////AAAAAAAAAABP/3/4AAAAAAAAAAH4D//AAAAAAAAAAAgAH/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAH/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAf8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAB//AAAAAAAAAAAAAP/8AAAAAAAAAAAAB//wAAAAAAAAAAAAP//gAAAAAAAAAAAB//+AAAAAAAAAAAAP//8AAAAAAAAAAAB///4AAAAAAAAAAAP///wAAAAAAAAAAB/7//gAAAAAAAAAAP/f//AAAAAAAAAAB/7//8AAAAAAAAAAP+f//4AAAAAAAAAB/3///gAAAAAAAAAP+///+AAAAAAAAAB/3///8AAAAAAAAAP8////wAAAAAAAAB/j////AAAAAAAAAP8f///8AAAAAAAAB/B////wAAAAAAAAHwH////AAAAAAAAA+A////8AAAAAAAAHgD////wAAAAAAAAYAP////AAAAAAAABgA////8AAAAAAAAGAB////4AAAAAAAAYAH////gAAAAAAABgAH////AAAAAAAADAAH///+AAAAAAAAMAAH///8AAAAAAAAwAAH///8AAAAAAADAAAD///4AAAAAAAIAAAB///4AAAAAABgAAAA///4AAAAAAEOAAAAP//gAAAAAAxfwA//f/8AAAAAADYH/+AP/8AAAAAAAeAD4AAH/wAAAAAABwADwAAD/gAAAAAAOAAPgAAD+AAAAAABwAA8AAAH8AAAAAAOAADwAAAPgAAAAAAwAAOAAAAAAAAAAAHAAA4AAAAAAAAAAA4AAHAAAAAAAAAAAHAAAcAAAAAAAAAAA4AABgAAAAAAAAAAOAAAOAAAAAAAAAADgAAAwAAAAAAAAAAcAAAHAAAAAAAAAAHAAAAcAAAAAAAAABwAAAD4AAAAAAAAAOAAAAPgAAAAAAAADgAAABwAAAAAAAAf/AAAAeAAAAAAAAH/8AAAfwAAAAAAAD/wAAAD+AAAAAAAAd8AAAA/gAAAAAAACeAAAAO4AAAAAAAADAAAAAGAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":88,"w":93},"bombycilla-cedrorum":{"bits":"AAAH/gAAAAAAAAAAAAP//wAAAAAAAAAAAP///4AAAAAAAAAAH////gAAAAAAAAAD////wAAAAAAAAAB////wAAAAAAAAAA////4AAAAAAAAAB/////AAAAAAAAAA/////8AAAAAAAAAH/////wAAAAAAAAAP////+AAAAAAAAAAf////4AAAAAAAAAA/////AAAAAAAAAAD////8AAAAAAAAAAP////gAAAAAAAAAA////+AAAAAAAAAAH////wAAAAAAAAAAf////AAAAAAAAAAD////8AAAAAAAAAAf////wAAAAAAAAAD/////AAAAAAAAAAP////8AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAD//////AAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAf//////wAAAAAAAD///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAA////////AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////8AAAAAAH////////gAAAAAA////////+AAAAAAH////////4AAAAAA/////////gAAAAAD////////+AAAAAAf////////4AAAAAD/////////gAAAAAP////////+AAAAAB/////////4AAAAAP/////////AAAAAA/////////8AAAAAD/////////wAAAAAf/////////AAAAAB/////////4AAAAAP/////////gAAAAA/////////8AAAAAD/////////wAAAAAP////////+AAAAAA/////////4AAAAAD/////////gAAAAAP////////8AAAAAA/////////wAAAAAD/////////AAAAAAP////////8AAAAAA/////////wAAAAAB/////////AAAAAAH////////4AAAAAAP////////gAAAAAA////////+AAAAAAD////////4AAAAAB/////////gAAAAAf///////+8AAAAAP////////7wAAAAB8B///////nAAAAAeAH/tAP//8AAAAABQ//8AA///gAAAAAH///AAB//8AAAAAB/8EAAAH//wAAAAAf/+AAAAP//AAAAAH+f4AAAA//8AAAAA+APgAAAB//gAAAAPAA8AAAAD/+AAAABwADAAAAAP/4AAAAMAAAAAAAAf/gAAAAgAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP+AAAAAAAAAAAAAA/wAAAAAAAAAAAAABwA=","h":92,"w":93},"bombycilla-garrulus":{"bits":"AAAAAAAAAD/AAAAAAAAAAAAAP//4AAAAAAAAAAAP///wAAAAAAAAAAB////gAAAAAAAAAAAf///AAAAAAAAAAAA///+AAAAAAAAAAAA///4AAAAAAAAAAAD///wAAAAAAAAAAA////AAAAAAAAAAAP///+AAAAAAAAAAD/////AAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAB//////AAAAAAAAAP/////AAAAAAAAAB/////gAAAAAAAAAf////gAAAAAAAAAD////4AAAAAAAAAA////+AAAAAAAAAAH////wAAAAAAAAAA////8AAAAAAAAAAP////gAAAAAAAAAD////4AAAAAAAAAAf////AAAAAAAAAAH////4AAAAAAAAAD/////AAAAAAAAAA/////4AAAAAAAAAP/////AAAAAAAAAH/////8AAAAAAAAB//////gAAAAAAAAf/////8AAAAAAAAP//////gAAAAAAAD//////+AAAAAAAA///////wAAAAAAAP//////+AAAAAAAD///////wAAAAAAA///////+AAAAAAAP///////wAAAAAAD///////+AAAAAAA////////wAAAAAAP///////+AAAAAAD////////gAAAAAA////////8AAAAAAP////////gAAAAAD////////8AAAAAA/////////AAAAAAP////////4AAAAAD////////+AAAAAA/////////wAAAAAH////////8AAAAAB/////////gAAAAAf////////4AAAAAD/////////AAAAAA/////////wAAAAAf////////8AAAAAH/////////AAAAAB/////////4AAAAAf////////+AAAAAH/////////gAAAAB/////////4AAAAA/////////+AAAAAP/////////gAAAAD/////////4AAAAA/////////8AAAAAP/////////AAAAAD/////////wAAAAA/////////4AAAAAP////////+AAAAAB/////////AAAAAAH////////wAAAAAB/f//////8AAAAAAfj///////gAAAAAHw////////wDwAAAQP//j///d///AAAAB//wD//we///gAAAf/4AB/4P///+AAAH/+AAP8Bv//4QAAA//AAB/gYgH/gAAAP/gAAH/AAAD0AAAD/4AAAB8AAAAAAAA/8AAAAHwAAAAAAAP/AAAAAPgfAAAAAD/wAAAB8//9AAAAAf8AAAAf////AAAAH/AAAADf///8AAAB/4AAAAAAP/AAAAAP+AAAAAAAf8AAAAD/gAAAAAAAGwAAAAf4AAAAAAAAAAAAAH+AAAAAAAAAAAAAA/gAAAAAAAAAAAAAB4AAAAAAAAAAAAAAA=","h":92,"w":93},"botaurus-lentiginosus":{"bits":"AAAAAAAAAAAAAADgAAAAAA8AAAAAAPAAAAAAD4AAAAAA+AAAAAAPwAAAAAD/AAAAAA/wAAAAAf8AAAAAP/AAAAAD/wAAAAA/4AAAAAf+AAAAAH/AAAAAB/wAAAAA/4AAAAAf8AAAAAP+AAAAAH/gAAAAH/wAAAAD/4AAAAD/+AAAAB/8AAAAA/8AAAAA/+AAAAAf+AAAAAP/AAAAAH/gAAAAD/wAAAAB/8AAAAA/+AAAAAf/gAAAAP/+AAAAH//wAAAB//8AAAA///AAAAf//wAAAP//8AAAD///AAAB///wAAA///8AAAf//+AAAP///gAAH///4AAD///8AAA////AAAf///gAAP///4AAD///8AAB////AAAf///gAAP///wAAH///8AAD///+AAA////AAAf///gAAH///4AAB///8AAA///+AAAP///AAAD///gAAB///wAAAf//4AAAP//8AAAD//+AAAA///AAAAP//gAAAH//wAAADu/4AAAB3f8AAAA7n+AAAAdz8AAAAO4cAAAAGcAAAAADGAAAAABjAAAAAAxgAAAAAYwAAAAAcYAAAAPOMAAAAD/+AAAA///AAAA+//8AAAA///gAAAf/wAAAAPDgAAAAAHgAAAAAHAAAAAACAAAAAAAAAAAAAAAAAA=","h":93,"w":43},"branta-bernicla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAD//wAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAB///gAAAAAAAAAAAf///AAAAAAAAAAAD///+AAAAAAAAAAAf///8AAAAAAAAAAH////gAAAAAAAAAA///f8AAAAAAAAAAH//gAAAAAAAAAAAA//AAAAAAAAAAAAAH/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAH/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAH/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAH/wAAAAAAAAAAAAA//AAAAAAAAAAAAAH/8AAAAAAAAAAAAA//wAAAAAAAAAAAAD//AAAAAAAAAAP/gf/+AAAAAAAAA///7//4AAAAAAAA///////gAAAAAAA///////+AAAAAAAf///////4AAAAAAP////////AAAAAAH////////8AAAAAH/////////gAAAAP/////////8AAAAP//////////wAAAH//////////+AAAD///////////wAAA///////////+AAAP///////////wAAf///////////+AAf////////////wAP////////////8AH/////////////gA9////////////8AB/////////////AA/////////////4AP////////////+ABh////////////wAA////////////8AAf////////////AAP////////////wAB////////////8AAP////////////AAAf///////////wAAD8f/////////4AAAAAf////////8AAAAAAP///////+AAAAAAA////////gAAAAAAB///////wAAAAAAAD//////4AAAAAAAAH/////4AAAAAAAAAP/////+AAAAAAAAAP/////wAAAAAAAAAAPn//4AAAAAAAAAAA8d//gAAAAAAAAAAHgH/+AAAAAAAAAAAeAf4wAAAAAAAAAADwA4AAAAAAAAAAAAeAaAAAAAAAAAAAAH//gAAAAAAAAAAAA//4AAAAAAAAAAAAB//gAAAAAAAAAAAAP//AAAAAAAAAAAAA//8AAAAAAAAAAAAD/8gAAAAAAAAAAAAH+AAAAAAAAAAAAAAPgAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":82,"w":93},"branta-canadensis":{"bits":"AAHgAAAAAAAAAAAAH/AAAAAAAAAAAAB/8AAAAAAAAAAAAf/wAAAAAAAAAAAH//AAAAAAAAAAAB//4AAAAAAAAAAAf//gAAAAAAAAAAH//8AAAAAAAAAAD///gAAAAAAAAAB///+AAAAAAAAAA////wAAAAAAAAAH///+AAAAAAAAAA4A//wAAAAAAAAAAAA/+AAAAAAAAAAAAB/wAAAAAAAAAAAAP+AAAAAAAAAAAAA/4AAAAAAAAAAAAH/AAAAAAAAAAAAA/4AAAAAAAAAAAAH/AAAAAAAAAAAAA/wAAAAAAAAAAAAH+AAAAAAAAAAAAB/wAAAAAAAAAAAAP+AAAAAAAAAAAAD/wAAAAAAAAAAAAf+AAAAAAAAAAAAH/gAAAAAAAAAAAA/8AAAAAAAAAAAAP/gAAAAAAAAAAAD/4AAAAAAAAAAAA//AAAAAAAAAAAAP/wAAAAAAAAAAAD/+AAAAAAAAAAAA//wAAAAAAAAAAAH/+A/wAAAAAAAAB/////+AAAAAAAAf/////+AAAAAAAD//////8AAAAAAAf//////4AAAAAAH///////wAAAAAA////////gAAAAAH///////+AAAAAA////////8AAAAAH////////wAAAAB/////////AAAAAP////////+AAAAA/////////8AAAAH/////////4AAAA//////////gAAAH//////////AAAA//////////8AAAD//////////4AAAf//////////gAAB//////////+AAAH//////////4AAA///////////gAAD//////////8AAAP//////////wAAA///////////AAAD//////////4AAAP//////////wAAA///////////gAAD///////////AAAH//////////8AAAf//////////gAAA//////////+AAAB//////////gAAAD/////////+AAAAH/////////4AAAAH/////wB//AAAAAP////4AD/4AAAAA////4AAH8AAAAAD/x8AAAAAAAAAAAf+HgAAAAAAAAAAB/A4AAAAAAAAAAAHwHAAAAAAAAAAAA+A4AAAAAAAAAAAHwHAAAAAAAAAAAA8A4AAAAAAAAAAAHgHgAAAAAAAAAAA9x8AAAAAAAAAAAHf/gAAAAAAAAAAA//8AAAAAAAAAAAf//AAAAAAAAAAAz//wAAAAAAAAAAPP/8AAAAAAAAAB//9+AAAAAAAAAAP//8AAAAAAAAAAAf/6AAAAAAAAAAAD//AAAAAAAAAAAAf/wAAAAAAAAAAAP/AAAAAAAAAAAAB8AAAAAAAAAAA==","h":93,"w":87},"branta-hutchinsii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//wAAAAAAAAAAAAf//AAAAAAAAAAAAD//8AAAAAAAAAAAA///gAAAAAAAAAAAP//+AAAAAAAAAAAD///wAAAAAAAAAAB//n/AAAAAAAAAAA//8/4AAAAAAAAAAP//H/AAAAAAAAAAB////4AAAAAAAAAAPAf//AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//AAAAAAAAAAAAAH/4AAAAAAAAAAAAB/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAD/+AAAAAAAAAAAAB//gAAAAAAAAAAAAf/8AAAAAAAAAAAAH//A//wAAAAAAAAB//5///4AAAAAAAAf/+////4AAAAAAAH///////4AAAAAAB////////wAAAAAAP////////gAAAAAD////////+AAAAAAf////////8AAAAAD/////////wAAAAA//////////gAAAAH//////////gAAAA///////////AAAAH//////////+AAAA///////////8AAAH///////////wAAA////////////AAAH///////////8AAA////////////4AAD////////////wAAf////////////gAB////////////+AAP////////////4AA/////////////AAD////////////8AAP////////////4AA/////////////AAD///////////+AAAH///////////8AAAf///////////wAAB////////////gAAD///////////8AAAP///////////gAAA////////+D/4AAAB///////+AD8AAAAD///////AAAAAAAAH//////gAAAAAAAAP/////wAAAAAAAAAP////AAAAAAAAAAAD//wAAAAAAAAAAAAH/8AAAAAAAAAAAAH//AAAAAAAAAAAD///4AAAAAAAAAAAf/8/AAAAAAAAAAAB//jwAAAAAAAAAAAf/4eAAAAAAAAAAAH/+DwAAAAAAAAAAB//geAAAAAAAAAAAABwD4AAAAAAAAAAAAPA/gAAAAAAAAAAAB//+AAAAAAAAAAAAH//wAAAAAAAAAAAB//4AAAAAAAAAAAA//+AAAAAAAAAAAAf//AAAAAAAAAAAACf/wAAAAAAAAAAAAAf8AAAAAAAAAAAAAD+AAAAAAAAAAAAAAfAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":86,"w":93},"bubo-scandiacus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/8AAAAAAAAAAAAH//8AAAAAAAAAAAD///4AAAAAAAAAAA////gAAAAAAAAAAP///+AAAAAAAAAAD////4AAAAAAAAAA/////gAAAAAAAAAH////+AAAAAAAAAB/////wAAAAAAAAAP/////AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAD/////8AAAAAAAAAf/////gAAAAAAAAH/////+AAAAAAAAA//////wAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////wAAAAAAAH///////4AAAAAAA////////wAAAAAAH////////gAAAAAA////////+AAAAAAH////////8AAAAAB/////////wAAAAAP/////////AAAAAB/////////+AAAAAP/////////4AAAAB//////////gAAAAP/////////+AAAAB//////////wAAAAP//////////AAAAB//////////8AAAAP//////////gAAAA//////////+AAAAH//////////4AAAA///////////AAAAH//////////8AAAAf//////////gAAAD//////////+AAAAf//////////wAAAB///////////AAAAP//////////8AAAB///////////wAAAH///////////AAAA///////////8AAAD///////////wAAAf///////////AAAB///////////4AAAP///////////gAAA///////////8AAAD///////////wAAAf//////////+AAAB///////////wAAAB//////////+AAAAH//////////4AAAAf//////////AAAAB//////////4AAAAH//////////AAAAAf/////////wAAAAB//////////AAAAAH/////////8AAAAAf/////////4AAAAB//////////gAAAAP/////////+AAAAA//////////8AAAAH//////////wAAAA///////////AAAAP//////////8AAB////////////gAAf/////8////n8AAH//////h///+BAAB//////wD///4AAAP/////4AP///gAABj+P///AA///+AAAEYD///8AD///4AAADgf///wAP///gAAAACT+P+AA///8AAAAAQfgAgAAP//wAAAAADwAAAAA//+AAAAAAYAAAAAB//gAAAAADAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":87,"w":93},"bubo-virginianus":{"bits":"DAAAAAAAADwAAAHAAAB8AAAHgAAA/AAAHwAAAfwAAH4AAAP8AAH8AAAD+AAH+AAAB/n/n+AAAA/////AAAAP////AAAAD////AAAAD////wAAAD////8AAAB////+AAAA/////gAAA/////wAAAf////4AAAP////+AAAP/////AAAH/////gAAD/////wAAB/////4AAA/////+AAAf/////AAAP/////wAAH/////8AAD//////AAB//////wAB//////+AA///////gAf//////4Af//////+AP///////AH///////wD///////8B///////+A////////gf///////4P///////8H///////+D////////g////////wf///////8P///////+H////////D////////h////////4f///////8P///////+H////////B////////w////////4f///////8H///////+D////////A////////gf///////wD///////8A///////+AP///////AH///////gB///////wA///////wAP//////4AH//////8AB///////AA///////gAP//////wAD//////4AB//////8AAf/////+AAH//////AAB//////gAf//////gA///////wA///////4Af//////8AP//////+AGef/P///AAMM/B///gACAfAf//wAAAMAP//4AAADAD//8AAAAAB//+AAAAAA//7AAAAAAf/8AAAAAAH/+AAAAAAD//gAAAAAB//wAAAAAAf/4AAAAAAH/4AAAAAAB/4AAAAAAAHYAA==","h":93,"w":55},"bubulcus-ibis":{"bits":"AAAAAAf8AAAAAAAAf/wAAAAAAAP/+AAAAAAAH//wAAAAAAD//+AAAAAAB///4AAAAAA////4AAAAA/////gAAAAf////+AAAAM/////wAAAAf//+A8AAAAP//+AAAAAAD///gAAAAAD///4AAAAAD////AAAAAD////wAAAAB////+AAAAA/////gAAAAf////4AAAAP////+AAAAH/////gAAAD/////4AAAB/////+AAAA//////gAAAP/////4AAAH/////+AAAD//////AAAA//////wAAAf/////8AAAH//////AAAD//////wAAA//////4AAAf/////+AAAH//////AAAD//////wAAA//////4AAAf/////+AAAH//////AAAD//////wAAB//////4AAAf/////8AAAP/////+AAAH//////gAAB//////wAAA//////8AAAP//////AAAD/////9gAAB//////YAAAf/////kAAAP/////wAAAD/////4AAAA/////8AAAAP/////AAAAB/////gAAAAf////4AAAAB////8AAAAAf////AAAAAP////gAAAAD///94AAAAA///+cAAAAAP//3vAAAAAD//hzgAAAAA//g88AAAAAP/4PPAAAAAD/8DzwAAAAA//A88AAAAAO/gHHgAAAAAPwBw4AAAAADwAePAAAAAAAADhwAAAAAAAA4eAAAAAAAAODgAAAAAAADg8AAAAAAAAYHAAAAAAAAHB4AAAAAAABwOAAAAAAAAcDwAAAAAAAHAcAAAAAAABwHgAAAAAAAeB+AAAAAAADv//gAAAAAB///+AAAAAP////gAAAAD////AAAAAAMf3/4AAAAAAH+PHgAAAAAB7w44AAAAAAOcOPAAAAAABjzgwAAAAAAYcYMAAAAAAHDkAAAAAAABwYAAAAAAAAICAAAAA==","h":93,"w":62},"bucephala-albeola":{"bits":"AAA/AAAAAAAAAAAAAA//AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAP//8AAAAAAAAAAAB///wAAAAAAAAAAAf///AAAAAAAAAAAD///4AAAAAAAAAAAf///gAAAAAAAAAAD///8AAAAAAAAAAA////gAAAAAAAAAAH///+AAAAAAAAAAD////wAAAAAAAAAA////+AAAAAAAAAAf////wAAAAAAAAAP////+AAAAAAAAAH/////wAAAAAAAAA/////4AAAAAAAAAH+A///AAAAAAAAAAAAD//wAAAAAAAAAAAA//8f//AAAAAAAAAP//////gAAAAAAAD///////gAAAAAAA////////AAAAAAAP///////+AAAAAAB////////8AAAAAAf////////+AAAAAD/////////+AAAAA//////////8AAAAH//////////+AAAA////////////AAAH///////////+AAA////////////4AAH////////////gAA////////////+AAH////////////wAA/////////////gAH/////////////gAf/////////////AD/////////////4AP////////////+AA/////////////gAD////////////wAAP//////////gAAAA//////////gAAAAD/////////4AAAAAD////////8AAAAAAH///////+AAAAAAAH///////gAAAAAAAD//////AAAAAAAAAB/////AAAAAAAAAAA////4AAAAAAAAAAH///+AAAAAAAAAAB////AAAAAAAAAAAH//AAAAAAAAAAAAB//4AAAAAAAAAAAA//tAAAAAAAAAAAAP/4AAAAAAAAAAAADP+AAAAAAAAAAAAAQfAAAAAAAAAAAAAADwAAAAAAAAAAAAAAeAAAAAAAAAAAAAADAAAAAAAAAAAAAAAIAAAAAAAAA","h":65,"w":93},"bucephala-clangula":{"bits":"AAAfgAAAAAAAAAAAAAf/gAAAAAAAAAAAAH//AAAAAAAAAAAAD//8AAAAAAAAAAAAf//4AAAAAAAAAAAH///AAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAB////AAAAAAAAAAAP///4AAAAAAAAAAD////gAAAAAAAAAB////8AAAAAAAAAA/////wAAAAAAAAA/////+AAAAAAAAAf/////wAAAAAAAAH/////+AAAAAAAAA//////wAAAAAAAAG+D///+AAAAAAAAAAAD///wAAAAAAAAAAAD//+AAAAAAAAAAAAf//wAAAAAAAAAAAf//+AAAAAAAAAAAP///gAAAAAAAAAAH///AAAAAAAAAAAB///wAAAAAAAAAAA/////gAAAAAAAAAP/////4AAAAAAAAB//////4AAAAAAAAf//////4AAAAAAAD///////wAAAAAAA////////gAAAAAAH///////+AAAAAAB////////8AAAAAAP////////4AAAAAB/////////gAAAAAP////////+AAAAAB/////////4AAAAAP/////////gAAAAB//////////AAAAAP/////////8AAAAA//////////wAAAAH/////////+AAAAA//////////8AAAAD//////////wAAAAf//////////AAAAB//////////8AAAAH//////////wAAAA///////////AAAAD//////////4AAAAP//////////gAAAA//////////+AAAAB//////////wAAAAH//////////AAAAAP/////////8AAAAA//////////wAAAAD//////////AAAAAP/////////8AAAAA//////////wAAAAB//////////AAAAAH/////////8AAAAAf/////////gAAAAA/////////+AAAAAD/////////wAAAAAH////////+AAAAAAP////////wAAAAAAf////////AAAAAAA////////8AAAAAAB////////gAAAAAAH///////+AAAAAAA////////4AAAAAAH////////gAAAAAA////////+AAAAAAD////////wAAAAAAf/+PgD//+AAAAAAD/wAAAP//wAAAAAAP/AAAA///AAAAAAAf/AAAA//4AAAAAAD/+AAAB//AAAAAAAf/wAAAA3QAAAAAAD/4AAAAAAAAAAAAAH8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAOAAAAAAAA=","h":85,"w":93},"bucephala-islandica":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAf//+AAAAAAAAAAAD///4AAAAAAAAAAAf///gAAAAAAAAAAH///8AAAAAAAAAAA////gAAAAAAAAAAH///+AAAAAAAAAAB////wAAAAAAAAAAf///+AAAAAAAAAAH////wAAAAAAAAAD////+AAAAAAAAAB/////z//AAAAAAAP////////wAAAAAB+B///////wAAAAAAAH///////+AAAAAAB////////+AAAAAAf////////8AAAAAH/////////+AAAAB///////////AAAAf///////////AAAD//////////78AAA///////////wAAAH///////////4AAA////////////4AAP////////////+AB/////////////8AP/////////////gB/////////////8AH////////////+AA/////////////AAD////////////wAAf//////////AAAAB//////////wAAAAH/////////wAAAAAf////////4AAAAAB////////8AAAAAAB///////+AAAAAAAA//////8AAAAAAAAAP////+AAAAAAAAAB/////wAAAAAAAAAL4Af/4AAAAAAAAABOAH+AAAAAAAAAAAAwD/wAAAAAAAAAAADA/+AAAAAAAAAAAAAF/AAAAAAAAAAAAAAP4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAf4AAAAAAAAAAAAAD/AAAAAAAAAAAAAA74AAAAAAAAAAAAACGAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":60,"w":93},"buteo-albonotatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAD//gAAAAAAAAAA///AAAAAAAAAAP//8AAAAAAAAAD///wAAAAAAAAA////AAAAAAAAAP///8AAAAAAAAB////wAAAAAAAAP////AAAAAAAAB////8AAAAAAAAN////4AAAAAAABj////wAAAAAAAAP////AAAAAAAAB////+AAAAAAAAP////8AAAAAAAB/////8AAAAAAAP/////4AAAAAAB//////gAAAAAAP//////AAAAAAD//////8AAAAAAf//////wAAAAAD///////AAAAAAf//////8AAAAAD///////wAAAAAf///////AAAAAD///////8AAAAAf///////gAAAAD///////+AAAAAP///////wAAAAB////////AAAAAP///////8AAAAA////////wAAAAH///////+AAAAAf///////4AAAAD////////gAAAAP///////+AAAAB////////wAAAAH///////+AAAAA////////wAAAAD////////AAAAAf///////8AAAAB////////gAAAAH///////+AAAAA////////wAAAAD///////+AAAAAP///////4AAAAA////////AAAAAD///////8AAAAAP///////gAAAAA///////8AAAAAD///////gAAAAAP//////4AAAAAA///////gAAAAAH//////8AAAAAA///////wAAAAAH///////AAAAAA///////4AAAAAD///////gAAAAAf//////+AAAAAD///////4AAAAAP///////AAAAAB///////8AAAAAH///////wAAAAA////////AAAAAH///////8AAAAAf//7////wAAAAD///f///+AAAAAf//x///v4AAAAB/v+H//8fgAAAAP7/gf//x8AAAAB+f4B//+HgAAAAODgAD//4MAAAADw8AAP//AgAAAAeHgAB//8AAAAAHw8AAH//gAAAAf//gAA//+AAAAH///gAD//wAAAB///+AAf//AAAAP///4AB//4AAAD//+PAAP//gAAAf7/w4AA//8AAADef8OAAD//wAAAbz/gAAAf/+AAABcP8AAAB//4AAAB47wAAAH//AAAAAGcAAAAf/4AAAAA4AAAAB3/gAAAAAAAAAAH/8AAAAAAAAAAAP+AAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":81},"buteo-jamaicensis":{"bits":"AAfwAAAAAAP/4AAAAAB//wAAAAAP//gAAAAB///AAAAAP//8AAAAA///4AAAAH///gAAAAf//+AAAAD///4AAAAP//9gAAAA///2AAAAD//+AAAAAP//+AAAAA///8AAAAD///4AAAAf///wAAAB////wAAAH////wAAAf////wAAD/////gAAP/////AAB/////+AAH/////8AA//////4AD//////wAP//////gA//////+AD//////8AP//////wA///////gD//////+AP//////4Af//////wB///////AH//////+Af//////4A///////wD///////AP//////8A///////4B///////gH//////+AP//////wA///////gB//////+AD//////8AH//////wAH//////AAf/////+AA//////wAB//////AAD/////8AAH/////4AAf/////gAB/////+AAH/////4AAf/////gAA/////+AAD/////wAAH/////AAAf////8AAB/////wAAD/////gAAP////+AAAf////4AAD/H///wAAP4////AAB4D///8AAP4P//94AA/z8f//gAH//9//uAA///z/+8AH///P/7wAP+/8//3AAfx/j//cAB+D8H/8wADwPgf/7AAAAAB//kAAAAAH/+AAAAAAP/8AAAAAA//wAAAAAD//AAAAAAH/8AAAAAAf/4AAAAAB//gAAAAAD/+AAAAAAP/4AAAAAAf/wAAAAAB//AAAAAAD/8AAAAAAD/gAAAAAAHcA=","h":93,"w":52},"buteo-lagopus":{"bits":"AD8AAAAAAAAAAD/8AAAAAAAAAB//4AAAAAAAAA///gAAAAAAAAP//+AAAAAAAAB///8AAAAAAAAP///wAAAAAAAD///+AAAAAAAA////8AAAAAAAH////wAAAAAAA/////gAAAAAAG////+AAAAAAAT////8AAAAAAAf////4AAAAAAB/////4AAAAAAP/////wAAAAAB//////AAAAAAP/////+AAAAAD//////4AAAAAf//////wAAAAD///////AAAAAf//////8AAAAH///////wAAAA///////+AAAAH///////4AAAAf///////gAAAD///////+AAAAf///////wAAAD////////AAAAP///////4AAAB////////gAAAP///////+AAAA////////wAAAD////////AAAAf///////4AAAB////////gAAAP///////+AAAB////////wAAAH///////+AAAA////////4AAAD////////gAAAP///////8AAAA////////wAAAH///////+AAAAf///////wAAAB////////AAAAH///////4AAAAf///////AAAAB///////8AAAAD///////gAAAAP//////8AAAAA///////AAAAAD//////4AAAAAf//////gAAAAB//////+AAAAAP//////wAAAAB///////AAAAAH//////8AAAAAf//////gAAAAD//////+AAAAAf//////4AAAAB///////gAAAAP//////8AAAAB/////+/wAAAAP/////z+AAAAB/////+H4AAAAf/////4fgAAAH//////B8AAAD//////4HwAAB////v//geAAAf///9//8BwAAH///8P//wHAAA////w//+A4AAH///+H//wDAAA////w///AAAAH///+D//4AAAAf7//gf//gAAAA/P/4D//8AAAADwf8AP//wAAAAAB+AB//+AAAAAAHgAP//wAAAAAAAAA///AAAAAAAAAH//4AAAAAAAAAf//gAAAAAAAAD//8AAAAAAAAAf//wAAAAAAAAB//+AAAAAAAAAP//wAAAAAAAAA///AAAAAAAAAD//4AAAAAAAAAf//AAAAAAAAAA//4AAAAAAAAAB/8A=","h":93,"w":75},"buteo-lineatus-2":{"bits":"AAAAAAAAAABgAIAAAAAAAAAOYBkAAAAAAAABzgHYAAAAAAAAPcAdgAAAAAAAN73B3gAAAAAAB/+4H/AAAAAAAP//hf8AAAAAAB//8H/8AAAAAAP//sf/4AAAAAB///j//gAAAAAf//+P/+AAAAAD///w//8AAAAAf//+D//4AAAAD///wP//gAAAAf///g//+AAAAD///8D//8AAAAf///wP//4AAAD///+A///gAAAf///wD//+AAAD////AP//4AAA////4A///wAAH////gD///AAA////8AP//8AAH////gA///wAA////+AB///AAH////4AH//8AA/////AAf//4AH////4AB///4A/////AAH///wD////8AAf///gf////gAB////h////4AAH///+P////AAAf///+////4AAB////7///+AAAD////////4AAAP////////gAAA/////////AAAB////////8AAAD////////wAAAH///////+AAAAP///////4AAAAP///////gAAAAf//////+AAAAA///////4AAAAB///////AAAAAD//////8AAAAA///////wAAAAP///////AAAAA///////4AAAAH///////gAAAA///////+AAAAD///////wAAAAP///////AAAAA///////4AAAACf//////AAAAAAf/////8AAAAAA//////gAAAAAB/////8AAAAAAD/////4AAAAAAP/////wAAAAAAf/////gAAAAAAf/////AAAAAAA//////AAAAAAAf/////AAAAAAA/////+AAAAAAB/////+AAAAAAB/////+AAAAAAB/////+AAAAAAA/////+AAAAAAD//////AAAAAAH//7///AAAAAAH//n///gAAAAAP/+P///wAAAAAH/8P///AAAAAAPvwf//8AAAAAAeeAf//AAAAAAA44A//wAAAAAADjgA/8AAAAAAAOOAAAAAAAAAAA4YAAAAAAAAAADhgAAAAAAAAAAOGAAAAAAAAAAAfcAAAAAAAAAAB/+AAAAAAAAAAH/8AAAAAAAAAAeOQAAAAAAAAAB48AAAAAAAAAAD/4AAAAAAAAAAP38AAAAAAAAAAefwAAAAAAAAAA8+AAAAAAAAAABx4AAAA=","h":93,"w":76},"buteo-lineatus":{"bits":"AAAAAAAP8AAAAAAAD/+AAAAAAAP/+AAAAAAAf/+AAAAAAB//+AAAAAAH//8AAAAAAP//8AAAAAA///4AAAAAB///4AAAAAD///wAAAAACf//gAAAAAA///AAAAAAB//+AAAAAAP//8AAAAAA///4AAAAAD///wAAAAAP///AAAAAA///+AAAAAD///4AAAAAP///wAAAAA////AAAAAD///+AAAAAP///8AAAAA////4AAAAD////wAAAAP////gAAAA/////AAAAD////+AAAAP////8AAAA/////4AAAD/////wAAAH/////gAAAf/////AAAB/////+AAAD/////4AAAP/////wAAA//////gAAB//////AAAH/////8AAAP/////4AAAf/////wAAB//////AAAD/////+AAAP/////8AAAf/////wAAA//////gAAB/////+AAAD/////8AAAH/////wAAAf/////AAAA/////+AAAD/////8AAAH/////4AAAP/////wAAAf/////AAAA/////+AAAB/////8AAAD/////wAAAP/////gAAAf////+AAAB/////8AAAD/////4AAAP/////gAAAf/+/7/AAAB//5/3+AAAH//z/v8AAAP//H3P4AAA//8PPd4AAB//4YOBwAAH//gAcDwAAP/+AA4HgAA//wAB4HAAB//AABwPAAD/+AADgPAAP/8AAH+fwAf/wAAf//wA//gAD///wAf+AAP///gB/8AAf/3/gD/wAAf/v+AP/AAA//f4Af+AAAf4PgB/4AAAcgcAD/wAAAAAAAH/AAAAAAAAf+AAAAAAAB/4AAAAAAAD/wAAAAAAAH/AAAAAAAAf8AAAAAAAA/gAAAAAAAB+AAAAAAAADwAAAAAAAAA=","h":93,"w":59},"buteo-platypterus":{"bits":"AAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAH/8AAAAAAAH//gAAAAAAH//4AAAAAAH//8AAAAAAD///AAAAAAB///wAAAAAB///4AAAAAA///+AAAAAAf///AAAAAAP///wAAAAAG///8AAAAADf///AAAAAAH///wAAAAAD///8AAAAAB////AAAAAA////4AAAAAf///+AAAAAP////wAAAAH////8AAAAD/////AAAAD/////wAAAB/////8AAAA/////+AAAAf/////gAAAP/////4AAAH/////8AAAD//////AAAB//////gAAAf/////4AAAP/////+AAAH//////AAAD//////gAAB//////4AAA//////8AAAP//////AAAH//////gAAD//////wAAA//////8AAAf/////+AAAP//////AAAD//////wAAB//////4AAAf/////8AAAH//////AAAD//////gAAA//////wAAAP/////4AAAD/////8AAAA//////AAAAP/////gAAAD/////wAAAB/////4AAAA/////4AAAAP////+AAAAH/////AAAAB/////wAAAA/////4AAAA/////+AAAP//////AAAP//////wAAP//////4AAH8//z//+AAB+P45///AAA+f8cf//wAAd1+eH//4AAMAf0B//+AADAB4Af/vAAAAAAAH/7wAAAAAAD/84AAAAAAA//MAAAAAAAf/iAAAAAAAP/4AAAAAAAD/8AAAAAAAB/+AAAAAAAAf/gAAAAAAAP/wAAAAAAAH/8AAAAAAAB/+AAAAAAAA//AAAAAAAAP/wAAAAAAAH/4AAAAAAAB/+AAAAAAAA//AAAAAAAAP/gAAAAAAAH/wAAAAAAAB/4AAAAAAAAf8AAAAAAAAH8AAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":61},"buteo-regalis":{"bits":"Af/AAAAAAAAAf/8AAAAAAAAP//gAAAAAAAH//8AAAAAAAD///gAAAAAAA///8AAAAAAAf///gAAAAAAP///4AAAAAAD////AAAAAAA////wAAAAAAP///+AAAAAAD////gAAAAAA3///8AAAAAAA////AAAAAAAP///4AAAAAAD////gAAAAAA////8AAAAAAP////wAAAAAD/////AAAAAB/////8AAAAAf/////wAAAAH/////+AAAAD//////4AAAA///////AAAAP//////4AAAH///////AAAB///////4AAAf///////AAAP///////wAAD///////+AAA////////wAAP///////+AAD////////wAAf///////8AAH////////gAB////////4AAf///////+AAD////////wAA////////+AAH////////gAB////////8AAf////////AAD////////wAA////////+AAP////////gAB////////8AAf////////AAD////////4AAf///////+AAD////////gAAf///////8AAB////////AAAf///////wAAD///////8AAAf///////gAAH///////4AAB///////+AAAP///////gAAD///////4AAB///////8AAAf///////AAAH///////wAAB///////+AAAP///////gAAD///////8AAAf///////AAAH///////4AAB////////AAAf///////wAAD///////+AAA////////gAAP///////8AAD////////AAA////////4AAH///+f//eAAB////z//zwAAf///8f/+cAAH////D//jAAB////w//8QAAf///4H//AAAD///+B//wAAA////gP/+AACH/f/4D//gAD//7/8Af/8AD/////AD//AB/////AA//wAX////4AH/+AEPn///gA//gADB///8AD/4AAAYfgZAAH+AAAGPgAAAAfAAAADwAAAAAAAAAAgAAAAAAA=","h":93,"w":68},"buteo-swainsoni":{"bits":"AAAAAH+AAAAAAH/8AAAAAB//4AAAAAf//gAAAAD//8AAAAAf//wAAAAH//+AAAAA///4AAAAH///AAAAA///4AAAAA///AAAAAD//4AAAAAf//AAAAAH//4AAAAB///AAAAA///8AAAAP///gAAAD///8AAAA////gAAAP///+AAAD////wAAA/////AAAP////4AAD/////AAA/////4AAP/////AAB/////4AAf/////AAH/////wAA/////+AAP/////wAB/////8AAf/////gAD/////8AAf/////gAH/////4AA//////AAH/////4AA/////+AAP/////wAB/////+AAP/////gAD/////4AAf/////AAD/////wAA/////8AAH/////AAA/////wAAP////8AAB/////gAAP////8AAB/////AAAf////4AAD/////AAAf////wAAD////+AAAf////gAAD////8AAA/////AAAH////4AAB/////AAAP///w4AAB///2HAAAf//8/4AAH//+H/8AA///v//wAP3/5/7/AB8//e/n4AfH/hH8+ADx/8Af+AAeP/gDzwAHh/8D+AAA4f/APgAAHD/4BgAAAwf/AAAAAGH/4AAAAAA/+AAAAAAH/wAAAAAA/+AAAAAAP/gAAAAAB/8AAAAAAP/AAAAAAB/4AAAAAAf/AAAAAAD/wAAAAAAf+AAAAAAD/wAAAAAA/8AAAAAAH/gAAAAAA/4AAAAAAH+AAAAAAA/gAAAAAAHgAAAAAAA=","h":93,"w":51},"buteogallus-anthracinus":{"bits":"AAAAAAAAAAAAAAAAAAAB/wAAAAAf/wAAAAD//gAAAAf//AAAAD//+AAAAf//4AAAB///wAAAH///AAAAf//+AAABn//4AAACf//gAAAA//+AAAAH//4AAAA///gAAAP//+AAAB///4AAAf///gAAD///+AAAf///4AAD////gAAf///+AAD////8AAf////wAB/////AAP////8AB/////wAP/////AA/////8AH/////wAf/////AB/////8AP/////wA//////AD/////4Af/////gB/////+AH/////4A//////gD/////8AP/////wA//////AD/////4AP/////gA/////+AH/////wAf////+AB/////wAP////+AA/////wAD/////AAP////4AA/////gAD////+AAP////wAB/////AAH////4AAf////AAB////8AAH/v//gAAf8//+AAA/j+P4AAD+P9/wAAP4f33AAB/AHef8AH8Af//4AfwJ///gB/Nv/n2AH8f/4fQA/w///8AD/HH/fwAO88/4eAA///8AAAD///wAAAN//0AAAA3//AAAADf/4AAAAL//gAAAAP/+AAAAA//4AAAAD//gAAAAP/8AAAAB//wAAAAH//AAAAAf/4AAAAB//gAAAAHf8AAAAAOfwAAAAA/8AAAAAAfAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":46},"butorides-virescens":{"bits":"AAAAAH+AAAAAAAAAAAAP/+AAAAAAAAAAAP//+AAAAAAAAAAD///8AAAAAAAAAP////wAAAAAAD///////gAAAAAf////////AAAAAH////////+AAAAAH////////8AAAAAAAH//////4AAAAAAAP//////wAAAAAAAP//////AAAAAAAAP/////wAAAAAAAAP/////AAAAAAAAA/////8AAAAAAAAH/////wAAAAAAAA//////AAAAAAAAP/////8AAAAAAAB//////wAAAAAAAP//////AAAAAAAB//////8AAAAAAAP//////wAAAAAAB//////+AAAAAAAH//////4AAAAAAA///////gAAAAAAH//////+AAAAAAAf//////wAAAAAAD///////AAAAAAAf//////4AAAAAAB///////gAAAAAAP//////+AAAAAAA///////wAAAAAAH///////AAAAAAA///////4AAAAAAD///////gAAAAAAf//////8AAAAAAB///////wAAAAAAH//////+AAAAAAA///////wAAAAAAD///////AAAAAAAP//////4AAAAAAA///////gAAAAAAD//////8AAAAAAAP//////gAAAAAAA//////+AAAAAAAD//////wAAAAAAAH/////+AAAAAAAAf/////4AAAAAAAB//////AAAAAAAAH/////4AAAAAAAAf/////AAAAAAAAB/////8AAAAAAAAH/////gAAAAAAAAf////8AAAAAAAAB/////gAAAAAAAAH////8AAAAAAAAAf////gAAAAAAAAD////+AAAAAAAAAP////wAAAAAAAAA9///+AAAAAAAAADn///wAAAAAAAAAcf//+AAAAAAAAAHh7//4AAAAAAAAB8PB//AAAAAAAAAeBwH/4AAAAAAAAHgeA//AAAAAAAAB4DgD/4AAAAAAAAeAcAP/AAAAAAAAHwHgB/4AAAAAAAB8A4AHwAAAAAAAAPAPAAeAAAAAAAADwBwABwAAAAAAAv/AOAAAAAAAAAB///jwAAAAAAAAAf//+cAAAAAAAAAH3+A3gAAAAAAAAAh/gH/4AAAAAAAAAOYH//gAAAAAAAADjB/40AAAAAAAAAcYe/AAAAAAAAAADHHOwAAAAAAAAAA45z2AAAAAAAAAAHDMdwAAAAAAAAAA4YHOAAAAAAAAAAGDA4wAAAAAAAAAAwAHHAAAAAAAAAAGAAw4AAAAAAAAAAAAOHAAAAAAAAAAAABwYAAAAAAAAAAAAOBgAAAAAAAAAAABgAAAAAAAAAAAAAMAAAAAAAAAAAAAAgAAAAAA==","h":93,"w":87},"cairina-moschata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfwAAAAAAAAAAAAAP/gAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAAP//wAAAAAAAAAAAB///AAAAAAAAAAAA///4AAAAAAAAAAAf///AAAAAAAAAAAH///8AAAAAAAAAAB////gAAAAAAAAAAPgP/8AAAAAAAAAAAAA//gAAAAAAAAAAAAD/8AAAAAAAAAAAAA//gAAAAAAAAAAAAH/8AAAAAAAAAAAAA//gAAAAAAAAAAAAP/8AAAAAAAAAAAAD//AAAAAAAAAAAAA//4AAAAAAAAAAAAP/8AAAAAAAAAAAAD//gAAAAAAAAAAAA//8AAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAAf//AAAAAAAAAAAAH//4AAAAAAAAAAAA/////wAAAAAAAAAP/////4AAAAAAAAB//////wAAAAAAAAP//////wAAAAAAAB///////gAAAAAAAP///////AAAAAAAD///////8AAAAAAAf///////4AAAAAAD////////wAAAAAAf////////gAAAAAB/////////AAAAAAP/////////AAAAAB/////////+AAAAAP/////////4AAAAA//////////gAAAAD//////////gAAAAf//////////AAAAB//////////+AAAAH//////////8AAAA///////////4AAAD///////////gAAAP//////////+AAAA///////////AAAAB//////////4AAAAH//////////4AAAAP//////////4AAAA///////////4AAAD///////////wAAAH//////////+AAAAf//////////8AAAA///////////gAAAB///////+f/wAAAAD//////wAf8AAAAAH////+AAAAAAAAAAH///sAAAAAAAAAAAH//4AAAAAAAAAAAA+/4AAAAAAAAAAAAPwAAAAAAAAAAAAAB+AAAAAAAAAAAAA+fwAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAAP///AAAAAAAAAAAAB//4AAAAAAAAAAAD//9gAAAAAAAAAAA///gAAAAAAAAAAAAf/gAAAAAAAAAAAAB/gAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":81,"w":93},"calamospiza-melanocorys":{"bits":"AAAAAAAAAAAP8AAAAAAAAAAAAD/+AAAAAAAAAAAAf//AAAAAAAAAAAB///gAAAAAAAAAAH///wAAAAAAAAAA////wAAAAAAAAAB////4AAAAAAAAAH////4AAAAAAAAAf////4AAAAAAAAB/////wAAAAAAAAD////8AAAAAAAAAP////AAAAAAAAAAf///4AAAAAAAAAB////wAAAAAAAAAH////AAAAAAAAAA////8AAAAAAAAAD////4AAAAAAAAAf////gAAAAAAAAB/////AAAAAAAAAP////+AAAAAAAAA/////4AAAAAAAAH/////wAAAAAAAAf/////gAAAAAAAB//////gAAAAAAAH//////AAAAAAAAf/////+AAAAAAAB//////8AAAAAAAH//////4AAAAAAAf//////wAAAAAAA///////gAAAAAAD///////AAAAAAAP//////8AAAAAAA///////4AAAAAAD///////wAAAAAAP///////gAAAAAA///////+AAAAAAB///////8AAAAAAH///////wAAAAAAf///////gAAAAAA///////+AAAAAAD///////4AAAAAAP///////wAAAAAAf///////AAAAAAB///////8AAAAAAD///////4AAAAAAP///////gAAAAAAf//////+AAAAAAA///////4AAAAAAD///////gAAAAAAH//////+AAAAAAAP//////4AAAAAAAf//////AAAAAAAB//////8AAAAAAAH//////gAAAAAAAf/////+AAAAAAAB//////wAAAAAAAH/////+AAAAAAAAf/////8AAAAAAAB///////gAAAAAAH/////x/8AAAAAAf//+/wAH+AAAAAA8//w/AAH/AAAAABh//B+AD//AAAAAAH/8B8APx+AAAAAAP/wA8A+D8AAAAAA//AA8BgH4AAAAAD/4AA8CBPAAAAAAH/gAA8ACeAAAAAAf+AAA8AH4AAAAAB/8AAA8AHwAAAAAD/wAAA8ABgAAAAAP/gAAA8AHAAAAAA/+AAAD+AYAAAAAB/4AAB//AAAAAAAH/gAAH//AAAAAAAf/AAAbB/AAAAAAA/8AAAwD2AAAAAAD/wAAAgHsAAAAAAP/gAAABvQAAAAAAf+AAAAD+AAAAAAB/4AAAAD8AAAAAAH/wAAAABwAAAAAAP/AAAAABgAAAAAA/8AAAAAPAAAAAAD/4AAAAAAAAAAAAH/gAAAAAAAAAAAAf+AAAAAAAAAAAAB/4AAAAAAAAAAAAD/gAAAAAAAAAAAAP+AAAAAAAAAAAAAfgAAAAAAAAAAAAB8AAAAAAAAAAAAADgAAAAAAAAAAAAAA","h":93,"w":89},"calcarius-lapponicus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//AAAAAAAAAAAAAf/+AAAAAAAAAAAAH//4AAAAAAAAAAAD///AAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAB///+AAAAAAAAAAAB///4AAAAAAAAAAAH///AAAAAAAAAAAAf//8AAAAAAAAAAAD///wAAAAAAAAAAAf///wAAAAAAAAAAD////gAAAAAAAAAAf////gAAAAAAAAAD/////AAAAAAAAAAf////+AAAAAAAAAD/////4AAAAAAAAAf/////wAAAAAAAAH//////AAAAAAAAA///////AAAAAAAAH//////+AAAAAAAA///////8AAAAAAAH///////wAAAAAAA////////gAAAAAAD////////AAAAAAAf///////8AAAAAAD////////4AAAAAAf////////gAAAAADH////////AAAAAAIf////////AAAAABh/////////AAAAAEH////////+AAAAAwD////////+AAAADAP////////4AAAAMAf///////+AAAAAwAP////////AAAADAAH////////gAAAMAAP////////gAAAwAAf//4QH///wAABgAAf/B//////gAAHAAAeB8AAH//8AAAOAAAA8AAAH/+AAAAeAAAeAAAAD/4AAAAfAAfAAAAAD/gAAAH/+PAAAAAAB4AAAP/h5gAAAAAAAAAAD+fBsAAAAAAAAAAAXg8HAAAAAAAAAAAA4AhwAAAAAAAAAAAOAAcAAAAAAAAAAABwAHAAAAAAAAAAAAPgBwAAAAAAAAAAABYAcAAAAAAAAAAAAOAHgAAAAAAAAAAAAAB/4AAAAAAAAAAAAD/9gAAAAAAAAAAAB/gAAAAAAAAAAAAAL4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAfwAAAAAAAAAAAAAHsAAAAAAAAAAAAAAhAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":68,"w":93},"calcarius-ornatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAH/8AAAAAAAAAAf/+AAAAAAAAAB///gAAAAAAAAH///wAAAAAAAAP///wAAAAAAAA////AAAAAAAAB///4AAAAAAAAH///AAAAAAAAAP//+AAAAAAAAA///8AAAAAAAAB///4AAAAAAAAD///wAAAAAAAAH///gAAAAAAAAP///AAAAAAAAA///+AAAAAAAAB///+AAAAAAAAD///8AAAAAAAAP///8AAAAAAAA////8AAAAAAAD////4AAAAAAAP////4AAAAAAA/////wAAAAAAD/////wAAAAAAP/////gAAAAAA//////AAAAAAD/////+AAAAAAP/////8AAAAAA//////4AAAAAD//////wAAAAAP//////gAAAAA///////AAAAAD//////+AAAAAP//////8AAAAAf//////4AAAAB///////wAAAAH///////gAAAAP//////+AAAAA///////8AAAAD///////4AAAAP///////gAAAA////////AAAAB///////8AAAAH///////4AAAAf///////gAAAA///////+AAAAD///////8AAAAP///////wAAAAf///////AAAAB///////4AAAAH///////gAAAAP//////+AAAAA///////4AAAAB///////gAAAAD//////8AAAAAf//////wAAAAB//////+AAAAAH//////wAAAAAf/////+AAAAAB//////+AAAAAH3//////AAAAAeP//AgP/gAAAB4//8AA//gAAADD//wAH//gAAAAP//AAf7/gAAAA//8AA/j/AAAAD//gADXn6AAAAH/+AAC//0AAAAf/wAAE//AAAAA//AAAAD8AAAAA/+AAAAeAAAAAD/4AAAAAAAAAAH/gAAAAAAAAAAf/AAAAAAAAAAB/8AAAAAAAAAAH/wAAAAAAAAAAf/AAAAAAAAAAA/+AAAAAAAAAAD/4AAAAAAAAAAP/gAAAAAAAAAAf/AAAAAAAAAAB/8AAAAAAAAAAH/wAAAAAAAAAAP/gAAAAAAAAAAf+AAAAAAAAAAB/4AAAAAAAAAAD/gAAAAAAAAAAHPAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":77},"calcarius-pictus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAA////gAAAAAAAAAAP////AAAAAAAAAAD////8AAAAAAAAAAf////AAAAAAAAAAH////gAAAAAAAAAA////gAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAf///4AAAAAAAAAAP////AAAAAAAAAAD////wAAAAAAAAAB////+AAAAAAAAAA/////wAAAAAAAAAf////8AAAAAAAAAH/////gAAAAAAAAB/////8AAAAAAAAA//////gAAAAAAAAP/////8AAAAAAAAD//////wAAAAAAAA//////+AAAAAAAAf//////wAAAAAAAH//////8AAAAAAAB///////gAAAAAAAf//////8AAAAAAAP///////gAAAAAAD///////8AAAAAAA////////AAAAAAAP///////4AAAAAAD////////AAAAAAA////////wAAAAAAP///////+AAAAAAD////////gAAAAAA////////8AAAAAAP////////AAAAAAD////////4AAAAAAf///////+AAAAAAH////////gAAAAAA////////4AAAAAAP///////+AAAAAAH////////gAAAAAB////////4AAAAAA////////+AAAAAAP////////gAAAAAD////////wAAAAAA7///////8AAAAAAE///////+AAAAAAAf///////AAAAAAAH//8H///AAAAAAAD//8AH///AAAAAAA//8AAP//8AAAAAAP/4AAAP//wAAAAAH/4AAAB//+AAAAAB/8AAAAAf/4AAAAAf/AAAAAHH/AAAAAP/wAAAAA//8AAAAD/8AAAAAF4PgAAAA/+AAAAAA+L4AAAAP/gAAAAAHn+AAAABP4AAAAAAf/wAAAAD+AAAAAAAY+AAAAAfAAAAAAAB9gAAAADwAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"calidris-alba":{"bits":"AAB/wAAAAAAAAAAAAA//gAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAAf//gAAAAAAAAAAAH//+AAAAAAAAAAAA///4AAAAAAAAAAAP///AAAAAAAAAAAB///8AAAAAAAAAAAP///gAAAAAAAAAAH///+AAAAAAAAAAD////wAAAAAAAAAB/////gAAAAAAAAAf/////AAAAAAAAAP8/////gAAAAAAAH8D/////gAAAAAAA8AP/////AAAAAAAAAB//////AAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAf//////4AAAAAAAH///////gAAAAAAA////////AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////gAAAAAA////////+AAAAAAH////////4AAAAAA/////////wAAAAAH/////////AAAAAA/////////8AAAAAH/////////4AAAAAf/////////gAAAAD//////////AAAAAf/////////+AAAAB//////////4AAAAP//////////wAAAA///////////wAAAD///////////wAAAf///////////wAAB////////////AAAH///////////4AAA///////////8AAAD///////////4AAAH///////////wAAAf///////////AAAB///////////4AAAH////////wB8AAAAP///////4AAAAAAAf//////OAAAAAAAA/////+AAAAAAAAAB/////gAAAAAAAAAD////4AAAAAAAAAAH///8AAAAAAAAAAAH//+AAAAAAAAAAAAf/gAAAAAAAAAAAAD/wAAAAAAAAAAAAAP8AAAAAAAAAAAAAB3gAAAAAAAAAAAAAOcAAAAAAAAAAAAABzgAAAAAAAAAAAAAMcAAAAAAAAAAAAABjgAAAAAAAAAAAAAMcAAAAAAAAAAAAABjAAAAAAAAAAAAAAMYAAAAAAAAAAAAABjAAAAAAAAAAAAAAcYAAAAAAAAAAAAADjAAAAAAAAAAAAA++YAAAAAAAAAAAAD/7AAAAAAAAAAAAf/4YAAAAAAAAAAAC/PHgAAAAAAAAAAAAH/+AAAAAAAAAAAAB//AAAAAAAAAAAAA//wAAAAAAAAAAAABgMAAAAAAAAAAAAAAHAAAAAAAAAAAAAABwAAAAAAAAAAAAAAcAAAAAAAAAAAAAAGAAAAAAAAA","h":81,"w":93},"calidris-alpina":{"bits":"AAADwAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAAf/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAH//8AAAAAAAAAAAA///wAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAA////wAAAAAAAAAAP/////gAAAAAAAAH//////gAAAAAAAD///////wAAAAAAA/j//////gAAAAAAfgH//////AAAAAAPwA//////+AAAAAD4AH//////8AAAAA8AA///////4AAAAGAAH///////gAAAAAAA////////AAAAAAAH///////8AAAAAAA////////4AAAAAAH////////wAAAAAA/////////wAAAAAH/////////gAAAAA//////////AAAAAH/////////+AAAAA//////////+AAAAD///////////AAAAf///////////AAAB///////////4AAAP//////////8AAAA///////////gAAAD//////////8AAAAf//////////8AAAB///////////4AAAH///////////AAAAP//////////wAAAA////////AB8AAAAD///////AAAAAAAAH//////gAAAAAAAAf/////wAAAAAAAAA/////4AAAAAAAAAA////8AAAAAAAAAAA///+AAAAAAAAAAAAf/8AAAAAAAAAAAAAf8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAPwAAAAAAAAAAAAABuAAAAAAAAAAAAAANwAAAAAAAAAAAAADuAAAAAAAAAAAAAAdwAAAAAAAAAAAAADOAAAAAAAAAAAAAAZwAAAAAAAAAAAAAHMAAAAAAAAAAAAHh9gAAAAAAAAAAAB//8AAAAAAAAAAAAD/zgAAAAAAAAAAAf/8MAAAAAAAAAAAD4OBgAAAAAAAAAAAwPgcAAAAAAAAAAAADwD8AAAAAAAAAAAAY//wAAAAAAAAAAAAD/gAAAAAAAAAAAAAf4AAAAAAAAAAAAB/3AAAAAAAAAAAAB/hwAAAAAAAAAAAAfAcAAAAAAAAAAAAAAHAAAAAAAAAAAAAABwAAAAAAAAAAAAAAMAAAAAAAAAAAAAABAAAAAAAAA","h":74,"w":93},"calidris-bairdii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAAAAAAAAAAAf/gAAAAAAAAAAAAH/+AAAAAAAAAAAAB//4AAAAAAAAAAAAf//gAAAAAAAAAAAD//+AAAAAAAAAAAAf//4AAAAAAAAAAAD///gAAAAAAAAAAA////AAAAAAAAAAAP////gAAAAAAAAAH/////gAAAAAAAAD//////gAAAAAAAA/v/////AAAAAAAAfgf////+AAAAAAAHwB/////8AAAAAABwAH/////4AAAAAAIAA//////wAAAAAAAAH//////AAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAf//////gAAAAAAAD///////AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////gAAAAAAA///////+AAAAAAAH///////8AAAAAAAf///////4AAAAAAB////////wAAAAAAH////////wAAAAAA/////////wAAAAAD/w///////4AAAAAPAAP//////+AAAAA4AAAf/////8AAAABgAAAAH////gAAAAHAAAAAAA//gAAAAAOAAAAAD///gAAAAAeAAAAH+A/8AAAAAA8AAADgAA+AAAAAAA8AADwAAAAAAAAAAAYf/wAAAAAAAAAAABj/gAAAAAAAAAAAAHwAAAAAAAAAAAAAAOAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAHgAAAAAAAAAAAAAA8AAAAAAAAAAAAAAPgAAAAAAAAAAAAABsAAAAAAAAAAAAAAdgAAAAAAAAAAAAADMAAAAAAAAAAAAAAZgAAAAAAAAAAAAAGMAAAAAAAAAAAAAAxgAAAAAAAAAAAAAOMAAAAAAAAAAAAABhgAAAAAAAAAAAAAccAAAAAAAAAAAAcDjgAAAAAAAAAAAD/+cAAAAAAAAAAAA//7gAAAAAAAAAAAf///AAAAAAAAAAAAh//YAAAAAAAAAAAAf/wAAAAAAAAAAAAAh4AAAAAAAAAAAAAA+AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":72,"w":93},"calidris-canutus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAH//wAAAAAAAAAAAA///AAAAAAAAAAAAP//4AAAAAAAAAAAD///gAAAAAAAAAAA///8AAAAAAAAAAAf///gAAAAAAAAAAH///8AAAAAAAAAAD////wAAAAAAAAAB/A///AAAAAAAAAAfgH///gAAAAAAAAPwA////4AAAAAAAD4AH////4AAAAAAB8AB/////4AAAAAAOAAP/////4AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAD///////AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////gAAAAAAD////////AAAAAAAf///////+AAAAAAD////////+AAAAAAP/////////AAAAAB/////////+AAAAAH//////////4AAAA///////////8AAAD///////////gAAAP//////////4AAAB//////////+AAAAH//////////wAAAAf//////////gAAAB//////////8AAAAH//////////AAAAAf///////wAAAAAAA///////gAAAAAAAD//////wAAAAAAAAH/////4AAAAAAAAAP////+AAAAAAAAAAP////AAAAAAAAAAAP///wAAAAAAAAAAA//8AAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAH+AAAAAAAAAAAAAA9wAAAAAAAAAAAAAHHAAAAAAAAAAAAAA44AAAAAAAAAAAAAHHAAAAAAAAAAAAAA44AAAAAAAAAAAAAGHAAAAAAAAAAAAAAw4AAAAAAAAAAAAAGGAAAAAAAAAAAAABwwAAAAAAAAAAAAAOGAAAAAAAAAAAAABhwAAAAAAAAAAAAAMOAAAAAAAAAAAAPDhwAAAAAAAAAAAB//OAAAAAAAAAAAAA/9wAAAAAAAAAAAD/4MAAAAAAAAAAAB/3BwAAAAAAAAAAAID8/gAAAAAAAAAAAA//8AAAAAAAAAAAAMD8AAAAAAAAAAAAAB/gAAAAAAAAAAAAD+YAAAAAAAAAAAAA+HAAAAAAAAAAAAAABwAAAAAAAAAAAAAAcAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":81,"w":93},"calidris-fuscicollis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAD/+AAAAAAAAAAAAA//4AAAAAAAAAAAAP//gAAAAAAAAAAAD//8AAAAAAAAAAAAf//wAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAP///AAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAA////8AAAAAAAAAAf////gAAAAAAAAAP4H//+AAAAAAAAAH4AP//8AAAAAAAAB4AB///4AAAAAAAAMAAH///wAAAAAAAAAAA////gAAAAAAAAAAH////AAAAAAAAAAA////+AAAAAAAAAAP////4AAAAAAAAAB/////wAAAAAAAAAP/////AAAAAAAAAB/////8AAAAAAAAAP/////wAAAAAAAAB//////gAAAAAAAAP/////+AAAAAAAAB//////4AAAAAAAAP//////gAAAAAAAA//////+AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAB///////wAAAAAAAP///////gAAAAAAA///////+AAAAAAAH///////4AAAAAAAf///////wAAAAAAD////////gAAAAAAP////////AAAAAAA/AAD////+AAAAAADgAAAP///+AAAAAAGAAAAD////AAAAAAYAAAAAf///AAAAAAwAAAAAP//8AAAAADgAAAAAP//gAAAAAGAAAAAAf/AAAAAAAOAAAAAO/8AAAAAAAYAAAB///wAAAAAAAwAAB4AB8AAAAAAADBgD4AAAAAAAAAAAM//wAAAAAAAAAAAA3jwAAAAAAAAAAAAD+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAB3AAAAAAAAAAAAAAO8AAAAAAAAAAAAAB/gAAAAAAAAAAAAAP8AAAAAAAAAAAAABzgAAAAAAAAAAAAAOYAAAAAAAAAAAAABjAAAAAAAAAAAAAAcYAAAAAAAAAAAAADjAAAAAAAAAAAAAAYYAAAAAAAAAAAAAHHAAAAAAAAAAAAAA44AAAAAAAAAAAAAGHAAAAAAAAAAAAABw4AAAAAAAAAAAAAOHAAAAAAAAAAAAABg4AAAAAAAAAAAAAcHAAAAAAAAAAAAH/g4AAAAAAAAAAAB//PAAAAAAAAAAAB///+AAAAAAAAAAB////wAAAAAAAAAAIPv/iAAAAAAAAAAAD3/wAAAAAAAAAAAAQg8AAAAAAAAAAAAAAeAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":88,"w":93},"calidris-himantopus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAP/wAAAAAAAAAAAAD//AAAAAAAAAAAAA//8AAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAAP//wAAAAAAAAAAAD///AAAAAAAAAAAA///4AAAAAAAAAAAP///gAAAAAAAAAAH///8AAAAAAAAAAD/////wAAAAAAAAB/j////8AAAAAAAA/gP////+AAAAAAAPwA/////+AAAAAAH4AH/////8AAAAAD4AA//////4AAAAA+AAH//////wAAAAPAAA///////gAAABwAAH///////AAAAAAAB///////+AAAAAAAP///////8AAAAAAB////////8AAAAAAP////////4AAAAAA/////////4AAAAAH//////////gAAAA//////////+AAAAH//////////AAAAAf//////////AAAAD//////////wAAAAP/////////+AAAAA//////////8AAAAH///////x//gAAAAf/////+AA/wAAAAB//////wB+AAAAAAH/////8D4AAAAAAAf/////AwAAAAAAAB/////4cAAAAAAAAD////+OAAAAAAAAAP////DAAAAAAAAAAP///5gAAAAAAAAAAf///4AAAAAAAAAAAP//wAAAAAAAAAAAAP/wAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAP4AAAAAAAAAAAAAB3AAAAAAAAAAAAAAHcAAAAAAAAAAAAAA7gAAAAAAAAAAAAADuAAAAAAAAAAAAAAdwAAAAAAAAAAAAADvAAAAAAAAAAAAAAd4AAAAAAAAAAAAADvAAAAAAAAAAAAAAY4AAAAAAAAAAAAADHAAAAAAAAAAAAAA4wAAAAAAAAAAAAAHGAAAAAAAAAAAAAA4wAAAAAAAAAAAAAHOAAAAAAAAAAAAAAxwAAAAAAAAAAAAAGOAAAAAAAAAAAAABxwAAAAAAAAAAAAAOOAAAAAAAAAAAAABxwAAAAAAAAAAAAAMOAAAAAAAAAAAAABhgAAAAAAAAAAAAAcMAAAAAAAAAAAAADhgAAAAAAAAAAADgeMAAAAAAAAAAAA//5gAAAAAAAAAAAB/7cAAAAAAAAAAAH/+DwAAAAAAAAAAB/f5/AAAAAAAAAAAAH//oAAAAAAAAAAABgf4AAAAAAAAAAAAD/uAAAAAAAAAAAAA/HgAAAAAAAAAAAAAB4AAAAAAAAAAAAAAcAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":86,"w":93},"calidris-maritima":{"bits":"AAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAP+AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAB//4AAAAAAAAAAAAf//gAAAAAAAAAAAD//+AAAAAAAAAAAAf//4AAAAAAAAAAAH/////AAAAAAAAAD//////wAAAAAAAA///////wAAAAAAAP///////wAAAAAAD////////gAAAAAB/D///////AAAAAAfgP//////+AAAAAHwB///////8AAAAD4AP///////8AAAA8AB////////4AAAPAAP////////wAABwAB/////////gAAMAAP//////////AAAAA///////////AAAAH//////////gAAAA//////////+AAAAH//////////+AAAAf//////////8AAAD///////////gAAAP//////////8AAAB//////////+AAAAH////////4AAAAAAf///////wAAAAAAB///////4AAAAAAAH//////+AAAAAAAAP//////AAAAAAAAA//////gAAAAAAAAB/////4AAAAAAAAAD////8AAAAAAAAAAH////AAAAAAAAAAAH//+AAAAAAAAAAAAD/+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAD8AAAAAAAAAAAAAAfwAAAAAAAAAAAAADuAAAAAAAAAAAAAAdwAAAAAAAAAAAAAHMAAAAAAAAAAAAAAzgAAAAAAAAAAAAAOcAAAAAAAAAAAAADjAAAAAAAAAAAAB484AAAAAAAAAAAAH//AAAAAAAAAAAAB//wAAAAAAAAAAAB/+PAAAAAAAAAAAADP/+AAAAAAAAAAAADv/wAAAAAAAAAAAAR/gAAAAAAAAAAAAD/YAAAAAAAAAAAAA/HAAAAAAAAAAAAAEBwAAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"calidris-mauri":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//+AHwAAAAAAAAAH//////gAAAAAAAB///////4AAAAAAAP///////4AAAAAAB////////8AAAAAAP//////////48AAB//////////+/gAAP////////////gAD////////////8AA/////////////gAP////////////8AD////////////+AA/////////////AAPwf/////////+AAD4D//////////AAA+AP////////zAAAPgB////////5gAADwAP///////44AAA8AB///////8MAAAHAAH//////+DAAABwAA///////AYAAAMAAD//////AGAAAAAAAf/////ABgAAAAAAB////8AD4AAAAAAAH////AA8AAAAAAAAf///wAOAAAAAAAAA///+ADgAAAAAAAAD///AAwAAAAAAAAAH//gAOAAAAAAAAAAH+AAPAAAAAAAAAAAH4ADgAAAAAAAAAAAD/gYAAAAAAAAAAAAAfmAAAAAAAAAAAAAB+wAAAAAAAAAAAAAHeAAAAAAAAAAAAAAcwAAAAAAAAAAAAADnAAAAAAAAAAAAAAc8AAAAAAAAAAAAAHHAAAAAAAAAAAAAAw4AAAAAAAAAAAAAOHAAAAAAAAAAAAADgwAAAAAAAAAAAAAYGAAAAAAAAAAAAAHBwAAAAAAAAAAAABwOAAAAAAAAAAAAAOBgAAAAAAAAAAAADgcAAAAAAAAAAAAA4DgAAAAAAAAAAAP/gYAAAAAAAAAAAB//DAAAAAAAAAAAH/8I8AAAAAAAAAAA8PP/4AAAAAAAAAAAHg/xAAAAAAAAAAABx/8AAAAAAAAAAAAIeHAAAAAAAAAAAAAADwAAAAAAAAAAAAAA4AAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":65,"w":93},"calidris-melanotos":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAH/wAAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//gAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAA///gAAAAAAAAAAAP////wAAAAAAAAAH/////+AAAAAAAAB///////AAAAAAAA////////AAAAAAAPx//////+AAAAAAH4D//////+AAAAAB8Af//////8AAAAAeAB///////8AAAAHAAP///////wAAABwAB////////8AAAAAAP///////////AAAB///////////4AAAP///////////AAAB///////////8AAAP//////////+AAAB///////////8AAAH///////////gAAA///////////4AAAD/////////gAAAAAP///////+AAAAAAA////////AAAAAAAH///////wAAAAAAAP//////wAAAAAAAA//////wAAAAAAAAD/////4AAAAAAAAAH////8AAAAAAAAAAP////AAAAAAAAAAAP///gAAAAAAAAAAA///4AAAAAAAAAAAP///AAAAAAAAAAAD///4AAAAAAAAAAAf8cOAAAAAAAAAAAHxhwAAAAAAAAAAAA8MOAAAAAAAAAAAAHgB4AAAAAAAAAAAA8APAAAAAAAAAAAAH4BwAAAAAAAAAAAAYAOAAAAAAAAAAAABwBgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":55,"w":93},"calidris-minutilla":{"bits":"AAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAA/8AAAAAAAAAAAAAP/4AAAAAAAAAAAAH//gAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAB///gAAAAAAAAAAAf//+AAAAAAAAAAAD////wAAAAAAAAAA//////gAAAAAAAAf//////wAAAAAAAP///////4AAAAAAH////////wAAAAAD/////////wAAAAA/h////////gAAB8PAH////////wAD/hgAf////////4H/8AAD////////////gAAP///////////4AAB///////////+AAAP//////////+AAAB///////////AAAAP//////////gAAAB/////////+wAAAAP/////////8AAAAB//////////+AAAAP//////////wAAAA//////////8AAAAH/////////8AAAAAf////////4AAAAAD////////mAAAAAAP//////+DgAAAAAB////8A/g4AAAAAAH///4AAAOAAAAAAAf//8AAADAAAAAAAB//+AAAA4AAAAAAAD//AAAAOAAAAAAAAP/4AAAHAAAAAAAAA/+AAAAwAAAAAAAAB/gAAA8AAAAAAAAAB4AAA+AAAAAAAAAAD8AAfAAAAAAAAAAAD/wHgAAAAAAAAAAAAfgwAAAAAAAAAAAB//GAAAAAAAAAAAB/+PwAAAAAAAAAAA/wAeAAAAAAAAAAAf/gDwAAAAAAAAAAH8eB+AAAAAAAAAAA/AQfAAAAAAAAAAAewAPgAAAAAAAAAADuAD4AAAAAAAAAAA9gB8AAAAAAAAAAAGMA/AAAAAAAAAAAAwB//gAAAAAAAAAAAA/78AAAAAAAAAAAAP/AAAAAAAAAAAAAAPwAAAAAAAAAAAAAHsAAAAAAAAAAAAAD7gAAAAAAAAAAAAA8cAAAAAAAAAAAAAMDAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"calidris-pugnax":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAAAAAAAAB/4AAAAAAAAAAYHgAAAAAAAAAeA+AAAAAAAAAHwA4AAAAAAAA/cABAAAAAAAAf+AAMAAAAAAAH/4IAwAAAAAAA///gHAAAAAAAP//+A4AAAAAAB+f/gGAAAAAAAPj//AwAAAAAAAAf/8eAAAAAAAAD//jwAAAAAAAAf/+fgAAAAAAAD//zwAAAAAAAB///4AAAAAAAA////gAAAAAAAP///8AAAAAAAHx///gAAAAAAB4H/8wAAAAAAAMAf/gAAAAAAAAAH/8AAAAAAAAAA//gAAAAAAAAAP/4AAAAAAAAAD//gAAAAAAAAB//8AAAAAAAAB///gAAAAAAAD///+AAAAAAHx////wAAAAAf/////+AAAAAf//////4AAAAP///////AAAABB//////4AAAAD///////AAAAB///////4AAAA////////AAAAc///////4AAADf///////AAAAH///////4AAAB3//////+AAAAY///////wAAACf//////8AAAAf///////gAAA////////4AAD/////////AAA/////////wAB/////////8AAP/////////AAAP////////wAAAD///////8AAAD////////AAAD////////wAAA////////4AAAB///////+AAAAA///////AAAAAP//////gAAAAD//////gAAAAA/8Af//4AAAAAH+AAf/+AAAAAA/AAAf/gAAAAAAAAAD/4AAAAAAAAAAPuAAAAAAAAAAAxwAAAAAAAAAAOcAAAAAAAAAABzwAAAAAAAAAAeeAAAAAAAAAABxwAAAAAAAAAAOOAAAAAAAAAABxwAAAAAAAAAAOHAAAAAAAAAABw4AAAAAAAAAAOHAAAAAAAAAAAwYAAAAAAAAAAGDgAAAAAAAAAAwcAAAAAAAAAAGDgAAAAAAAAAAwOAAAAAAAAAAGBwAAAAAAAAAA4f/gAAAAAAAAHP/4AAAAAAAAB53/+AAAAAAAA//9/wAAAAAAAH/98AAAAAAAAAD/7wAAAAAAAAAd/yAAAAAAAAABwOAAAAAAAAAAHwAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":75},"calidris-pusilla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAH/+AAAAAAAAAAAAB//wAAAAAAAAAAAAf//AAAAAAAAAAAAD//8AAAAAAAAAAAAf//gAAAAAAAAAAAD//+AAAAAAAAAAAA///wAAAAAAAAAAAH//+AAAAAAAAAAAD///4AAAAAAAAAAA////AAAAAAAAAAAP///8AAAAAAAAAAD////8AAAAAAAAAB/H///8AAAAAAAAAfgP///4AAAAAAAAHwB////wAAAAAAAB4AP////gAAAAAAAMAB/////gAAAAAAAAAP/////AAAAAAAAAB//////AAAAAAAAAP/////+AAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAB///////gAAAAAAAP///////AAAAAAAB///////+AAAAAAAH///////4AAAAAAA////////gAAAAAAD////////gAAAAAAf////////gAAAAAB/////////gAAAAAP//////////gAAAA///////////gAAAH//////////8AAAAf/////////+AAAAB//////////+AAAAH//////////8AAAAf//////////gAAAB//////////4AAAAD///////4AAAAAAAH//////wAAAAAAAAf/////4AAAAAAAAA/////8AAAAAAAAAA////8AAAAAAAAAAA///8AAAAAAAAAAAAf/4AAAAAAAAAAAAAf/gAAAAAAAAAAAAB/8AAAAAAAAAAAAA//gAAAAAAAAAAAP//gAAAAAAAAAAAD/xwAAAAAAAAAAAA/gHAAAAAAAAAAAAPuA8AAAAAAAAAAAB5wHAAAAAAAAAAAAPGA4AAAAAAAAAAAB5wHAAAAAAAAAAAAPAA4AAAAAAAAAAAB/AHAAAAAAAAAAAAPwAwAAAAAAAAAAAA8AGAAAAAAAAAAAADgAwAAAAAAAAAAAAAAOAAAAAAAAAAAAAABwAAAAAAAAAAAAAAMAAAAAAAAAAAAAABgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAH4/gAAAAAAAAAAAAf/+AAAAAAAAAAAAJ/4QAAAAAAAAAAAP/+AAAAAAAAAAAADQHgAAAAAAAAAAAAAD4AAAAAAAAAAAAAB4AAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":80,"w":93},"calidris-subruficollis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAAf//4AAAAAAAAAAAD///AAAAAAAAAAAAf//8AAAAAAAAAAAD///wAAAAAAAAAAA////AAAAAAAAAAAH////wAAAAAAAAAD/////4AAAAAAAAB//////8AAAAAAAAf//////8AAAAAAAP///////4AAAAAAH+f//////4AAAAAB+A///////gAAAAAOAH///////AAAAAAAA///////+AAAAAAAH///////4AAAAAAA////////wAAAAAAH////////AAAAAAB////////8AAAAAAP////////4AAAAAB/////////wAAAAAP/////////wAAAAB//////////wAAAAP//////////wAAAA////////////AAAH////////////AAA////////////gAAD///////////+AAAf///////////4AAB///////////8AAAP///////////wAAA////////////gAAH///////////8AAAf///////////gAAB/////////+AAAAAP////////wAAAAAA////////4AAAAAAD///////+AAAAAAAP///////AAAAAAAAf//////gAAAAAAAB//////wAAAAAAAAD/////4AAAAAAAAAP////+AAAAAAAAAAf////AAAAAAAAAAAf///gAAAAAAAAAAAP//gAAAAAAAAAAAAf/AAAAAAAAAAAAAB/wAAAAAAAAAAAAAH+AAAAAAAAAAAAAA7wAAAAAAAAAAAAAHOAAAAAAAAAAAAAA7wAAAAAAAAAAAAAGeAAAAAAAAAAAAABxwAAAAAAAAAAAAAOOAAAAAAAAAAAAABzgAAAAAAAAAAAAAMcAAAAAAAAAAAAADjgAAAAAAAAAAAAAccAAAAAAAAAAAAADjAAAAAAAAAAAAAA44AAAAAAAAAAAAAHnAAAAAAAAAAAAH//4AAAAAAAAAAAAf//AAAAAAAAAAAAf/x4AAAAAAAAAAAP/8P4AAAAAAAAAABYf//wAAAAAAAAAAAP/+KAAAAAAAAAAADz/gAAAAAAAAAAAA//4AAAAAAAAAAAAD+PAAAAAAAAAAAAAQDgAAAAAAAAAAAAAB4AAAAAAAAAAAAAAeAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":82,"w":93},"callipepla-californica":{"bits":"AAAAAAAAAAAAAAeAAAAAAAAAAAAAAf4AAAAAAAAAAAAAP/AAAAAAAAAAAAAP/wAAAAAAAAAAAPzD8AAAAAAAAAAAP/gOAAAAAAAAAAAP/4AAAAAAAAAAAAH/+AAAAAAAAAAAAD//wAAAAAAAAAAAB//8AAAAAAAAAAAA///gAAAAAAAAAAAP//+AAAAAAAAAAAH///gAAAAAAAAAAB///8AAAAAAAAAAA////AAAAAAAAAAAP//4QAAAAAAAAAAH//4AAAAAAAAAAAB//+AAAAAAAAAAAA///AAAAAAAAAAAAP//wAAAAAAAAAAAD//8AAAAAAAAAAAB///gAAAAAAAAAAAf//4AAAAAAAAAAAP///AAAAAAAAAAAH///4AAAAAAAAAAD///+AAAAAAAAAAB////gAAAAAAAAAA////8AAAAAAAAAA/////AAAAAAAAAA/////wAAAAAAAAA/////8AAAAAAAAA//////gAAAAAAAA//////4AAAAAAAA//////+AAAAAAAAf//////gAAAAAAAf//////4AAAAAAAP//////+AAAAAAAH///////AAAAAAAD///////wAAAAAAD///////8AAAAAAB///////+AAAAAAA////////gAAAAAA////////4AAAAAAf///////8AAAAAAP///////+AAAAAAH////////gAAAAAD////////wAAAAAB////////8AAAAAA////////+AAAAAAP////////gAAAAAH////////wAAAAAD////////8AAAAAB////////+AAAAAA/////////gAAAAAf////////wAAAAAH////////4AAAAAB////////+AAAAAAf////////AAAAAAP////////gAAAAAH////////wAAAAAB////////4AAAAAAf///////8AAAAAAD///////+AAAAAAA////////AAAAAAAf///////AAAAAAAH///////gAAAAAAD///////gAAAAAAA///////gAAAAAAAf//////AAAAAAAAH//////AAAAAAAAD//////AAAAAAAAB//+g//gAAAAAAAA//+AAPwAAAAAAAAf/+AAD8AAAAAAAAP/+AAAfgAAAAAAAH/+AAAD8AAAAAAAB/8AAAAfgAAAAAAA/8AAAAD8AAAAAAAf+AAAAA/AAAAAAAP+AAAAAH4AAAAAAH/AAAAAA/AAAAAAB/AAAAAA/4AAAAAA/AAAAAA///wAAAAfgAAAAAP//8AAAAPwAAAAAD+//wAAAH4AAAAAAeH//AAAB8AAAAAAEA794AAA+AAAAAAAAOPmAAAPAAAAAAAABg+AAAAAAAAAAAAA4HgAAAAAAAAAAAAGAYAAAAAAAAAAAAHgAAAAAAAAAAAAAAwAAAAAA=","h":93,"w":92},"callipepla-squamata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAD4AAAAAAAAAAA/gAAAAAAAAAAH8AAAAAAAAAAB/wAAAAAAAAAAP+AAAAAAAAAAD/4AAAAAAAAAAf/AAAAAAAAAAH/8AAAAAAAAAA//gAAAAAAAAAP/+AAAAAAAAAB//wAAAAAAAAAf/+AAAAAAAAAH//wAAAAAAAAA///gAAAAAAAAP//8AAAAAAAAB///gAAAAAAAAf//kAAAAAAAAD//8AAAAAAAAA///AAAAAAAAAH//4AAAAAAAAA//+AAAAAAAAAH//wAAAAAAAAB///AAAAAAAAAP//4AAAAAAAAD///gAAAAAAAA///8AAAAAAAAP///gAAAAAAAD///+AAAAAAAA////wAAAAAAAf///+AAAAAAAP////4AAAAAAH/////AAAAAAD/////4AAAAAA//////AAAAAAP/////4AAAAAH//////AAAAAB//////4AAAAAf//////AAAAAH//////4AAAAB///////AAAAAP//////wAAAAD//////+AAAAA///////wAAAAP//////+AAAAD///////wAAAA///////8AAAAP///////gAAAB///////4AAAAf///////AAAAH///////wAAAA///////+AAAAP///////gAAAD///////8AAAAf///////AAAAH///////4AAAA///////+AAAAP///////gAAAB///////4AAAAP///////AAAAD///////wAAAAf//////8AAAAH//////+AAAAA///////gAAAAP//////wAAAAB//////+AAAAAP//////4AAAAD//////eAAAAAf/////3wAAAAH//////+AAAAA/////8pwAAAAP//3//+OAAAAB//4D//jgAAAAf/8AAA/AAAAAH/+AAAD+AAAAA//gAAAH4AAAAP/4AAAAf/AAAD/+AAAAf/8AAAf/gAAADj/gAAH/4AAAAQP/AAB/+AAAAAA94AAP/gAAAAABzgAD/4AAAAAAOMAAf+AAAAAAAwAAH/AAAAAAAEAAA/wAAAAAAAAAAP4AAAAAAAAAAB+AAAAAAAAAAAPAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":75},"calothorax-lucifer":{"bits":"AAAAAA/gAAAAAAAAAD//w//AAAAAAAAAAf////+AAAAAAAAAAAH///4AAAAA/+AAAAD///AAAAD//4AAAAD//8AAAH//+AAAAAP//gAAD///AAAAAA//8AAD///wAAAAAH//gAD///4D/8AAA//+AH///+A///AAD//wD///+AD///gAf//D////gAH///wD//9////4AAP///8f//////8AAAf///////////AAAB///////////gAAAD//////////wAAAAH/////////8AAAAAP////////8AAAAAAf////////AAAAAAA////////gAAAAAAA///////wAAAAAAAA//////8AAAAAAAAA//////AAAAAAAAAB/////4AAAAAAAAAH////8AAAAAAAAAAf////gAAAAAAAAAB////8AAAAAAAAAAHf///wAAAAAAAAAAB///+AAAAAAAAAAAP///wAAAAAAAAAAA///+AAAAAAAAAAAD///4AAAAAAAAAAAP///AAAAAAAAAAAA///4AAAAAAAAAAAD///gAAAAAAAAAAAf//8AAAAAAAAAAAD///wAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAHf//AAAAAAAAAAAABj/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAB/+AAAAAAAAAAAAAP34AAAAAAAAAAAAB+fgAAAAAAAAAAAAH5+AAAAAAAAAAAAA/H4AAAAAAAAAAAAD4fgAAAAAAAAAAAAfB8AAAAAAAAAAAAB4HwAAAAAAAAAAAAPAfAAAAAAAAAAAAA8A8AAAAAAAAAAAAHgDwAAAAAAAAAAAAcAPAAAAAAAAAAAADgA8AAAAAAAAAAAAOABwAAAAAAAAAAAAwAAAAAAAAAAAAAAGAAAAA=","h":69,"w":93},"calypte-anna":{"bits":"AAAAAA/AAAAAAAAAAAAAD/+AAAAAAAAAAAAP//wAAAAAAAAAAAf//8AAAAAAAAAAA////AAAAAAAAA8D////wAAAAAAH///////8AAAAAAP///////+AAAAAAP////////gAAAAAAAAD/////wAAAAAAAAAD////8AAAAAAAAAA////+AAAAAAAAAAP////AAAAAAAAAAD////gAAAAAAAAAB////wAAAAAAAAAAf///4AAAAAAAAAAP///8AAAAAAAAAAD////AAAAAAAAAAB////gAAAAAAAAAA////4AAAAAAAAAAf///+AAAAAAAAAAP////gAAAAAAAAAH////4AAAAAAAAAD/////AAAAAAAAAB/////wAAAAAAAAA/////8AAAAAAAAAf/////AAAAAAAAAP/////wAAAAAAAAH/////8AAAAAAAAD//////AAAAAAAAB//////wAAAAAAAA//////8AAAAAAAAf/////+AAAAAAAAP//////gAAAAAAAH//////4AAAAAAAD//////8AAAAAAAB///////AAAAAAAA///////wAAAAAAAP//////4AAAAAAAH//////+AAAAAAAD///////AAAAAAAA///////wAAAAAAAf//////4AAAAAAAH//////+AAAAAAAD///////AAAAAAAA///////wAAAAAAAf//////4AAAAAAAH//////+AAAAAAAB///////AAAAAAAAf//////gAAAAAAAH//////4AAAAAAAD//////8AAAAAAAA//////+AAAAAAAAP//////gAAAAAAAD//////wAAAAAAAAf/////4AAAAAAAAH/////8AAAAAAAAB//////AAAAAAAAB//////gAAAAAAAA//////wAAAAAAAAe/////4AAAAAAAAP/////+AAAAAAAAD/7////AAAAAAAAA+/////gAAAAAAAAGP////wAAAAAAAAAB7///8AAAAAAAAAAAf//+AAAAAAAAAAAH///AAAAAAAAAAAB///gAAAAAAAAAAAf//4AAAAAAAAAAAH//+AAAAAAAAAAAB///gAAAAAAAAAAAf//wAAAAAAAAAAAD//8AAAAAAAAAAAA///AAAAAAAAAAAAP//wAAAAAAAAAAAH//8AAAAAAAAAAAB//eAAAAAAAAAAAA//jgAAAAAAAAAAAP/wwAAAAAAAAAAAH/8AAAAAAAAAAAAB/+AAAAAAAAAAAAAf/AAAAAAAAAAAAAP/gAAAAAAAAAAAAD/4AAAAAAAAAAAAA/8AAAAAAAAAAAAAf+AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/wAAAAAAAAAAAAAf4AAAAAAAAAAAAAA+AAAAAAAAAAAAAAPAAAAAAAAAAAAAADg=","h":93,"w":91},"calypte-costae":{"bits":"AAAAAAfwAAAAAAAAAAAAD//AAAAAAAH/gAAH//4AAAAAAH//8Af//+AAAAAAAf///////gAAAAAAAf//////4AAAAAAAAD/////+AAAAAAAAAH/////AAAAAAAAAAP////wAAAAAAAAAD////4AAAAAAAAAAf///+AAAAAAAAAAP////AAAAAAAAAAD////gAAAAAAAAAB////wAAAAAAAAAAf///4AAAAAAAAAAP///+AAAAAAAAAAH////AAAAAAAAAAD////gAAAAAAAAAB////4AAAAAAAAAA////+AAAAAAAAAAf////AAAAAAAAAAP////wAAAAAAAAAH////8AAAAAAAAAD/////AAAAAAAAAD/////wAAAAAAAAB/////8AAAAAAAAA//////gAAAAAAAAf/////4AAAAAAAAP/////8AAAAAAAAH//////AAAAAAAAH//////wAAAAAAAD//////8AAAAAAAD///////AAAAAAAB///////wAAAAAAB///////4AAAAAAA7//////+AAAAAAAd///////gAAAAAAc///////wAAAAAAOP//////8AAAAAAGH//////+AAAAAADD///////gAAAAADh///////wAAAAABgf//////8AAAAAAAP//////+AAAAAAAD///////gAAAAAAB///////wAAAAAAA///////4AAAAAAAP//////+AAAAAAAD///////AAAAAAAB///////wAAAAAAAf//////4AAAAAAAH//////8AAAAAAAB///////AAAAAAAAf//////gAAAAAAAH//////wAAAAAAAB//////4AAAAAAAAf/////+AAAAAAAAP//////AAAAAAAAH//////gAAAAAAAD3/////wAAAAAAAD9/////8AAAAAAAA/vf///+AAAAAAAAfv/////AAAAAAAADj/////gAAAAAAAAx/////wAAAAAAAAAHf///4AAAAAAAAAAH///+AAAAAAAAAAB////AAAAAAAAAAAf///wAAAAAAAAAAD///4AAAAAAAAAAA///+AAAAAAAAAAAP///gAAAAAAAAAAD///wAAAAAAAAAAA///8AAAAAAAAAAAH///AAAAAAAAAAAB///gAAAAAAAAAAAP//4AAAAAAAAAAAH//8AAAAAAAAAAAB//PAAAAAAAAAAAA//zwAAAAAAAAAAAP/4YAAAAAAAAAAAH/8AAAAAAAAAAAAB//AAAAAAAAAAAAAf/gAAAAAAAAAAAAP/wAAAAAAAAAAAAD/8AAAAAAAAAAAAB/+AAAAAAAAAAAAAf/gAAAAAAAAAAAAH/wAAAAAAAAAAAAD/4AAAAAAAAAAAAA/8AAAAAAAAAAAAAOeAAAAAAAAAAAAAABA=","h":93,"w":91},"campylorhynchus-brunneicapillus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//AAAAAAAAAAAAA//+AAAAAAAAAAABP//4AAAAAAAAAAH////gAAAAAAAAAB////+AAAAAAAAAAH////4AAAAAAAAAAB////AAAAAAAAHwAD///8AAAAAAAD+AAf///wAAAAAAB/8AD////gAAAAAA//gAP////AAAAAAf/8AB/////AAAAAP//gAH/////AAAAH//4AA/////+AAAB//8AAH/////8AAA//+AAA//////8AAf//AAAH//////4AP//gAAA///////4H//wAAAD//////////4AAAAf/////////4AAAAD/////////8AAAAAf////////+AAAAAD/////////AAAAAAf////////wAAAAAB////////+AAAAAAP////////gAAAAAB////////4AAAAAAH////////AAAAAAA////////wAAAAAAD///////8AAAAAAAP///////gAAAAAAB///////+AAAAAAAH///////4AAAAAAAf///////gAAAAAAB///////8AAAAAAAH/////+AAAAAAAAAP/////gAAAAAAAAA/////8AAAAAAAAAB////+AAAAAAAAAAD////gAAAAAAAAAAD///wAAAAAAAAAAAH//4AAAAAAAAAAAD4//AAAAAAAAAAA//4PwAAAAAAAAAAf//jwAAAAAAAAAAD/sg8AAAAAAAAAAA/4AeAAAAAAAAAAAP4AHgAAAAAAAAAADGB//+AAAAAAAAAAQwf//QAAAAAAAAAAAD/gAAAAAAAAAAAAA/4AAAAAAAAAAAAAe8AAAAAAAAAAAAADGAAAAAAAAAAAAAAxgAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":61,"w":93},"caracara-plancus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//AAAAAAAAAAAAA//8AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAB///+AAAAAAAAAAAP///4AAAAAAAAAAB////gAAAAAAAAAAP///8AAAAAAAAAABh///wAAAAAAAAAAMP//+AAAAAAAAAAAA///wAAAAAAAAAAAD//+AAAAAAAAAAAAf//wAAAAAAAAAAAD//+AAAAAAAAAAAAf//4AAAAAAAAAAAB///gAAAAAAAAAAAf///gAAAAAAAAAAD////AAAAAAAAAAAf////AAAAAAAAAAD////+AAAAAAAAAAf////8AAAAAAAAAD/////4AAAAAAAAAf/////wAAAAAAAAD//////AAAAAAAAAP/////+AAAAAAAAB//////4AAAAAAAAP//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAD///////gAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAB///////+AAAAAAAH///////wAAAAAAA////////AAAAAAAD///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////wAAAAAAD////////AAAAAAAf///////8AAAAAAB////////wAAAAAAP////////gAAAAAA////////+AAAAAAH////////8AAAAAAf////////wAAAAAD/////////AAAAAAf////////8AAAAAB///x/////4AAAAAP//+A7////gAAAAB/f/gAD////AAAAAHx/4AAD///8AAAAB4P8AAAA///4AAAAPB4AAAAD/+fgAAAB4PAAAAAH/48AAAAOB4AAAAAf/wAAAABwPAAAAAB//AAAAAOBwAAAAAH/4AAAADwOAAAAAAP/AAAAAcBwAAAAAAf4AAAADgOAAAAAAA+AAAAAcDwAAAAAAAAAAAADgeAAAAAAAAAAAAA8DgAAAAAAAAAAAAHgcAAAAAAAAAAAAA4DgAAAAAAAAAAACPgcAAAAAAAAAAAB//ngAAAAAAAAAAA///8AAAAAAAAAAAP/3/gAAAAAAAAAAABz//AAAAAAAAAAAAE///AAAAAAAAAAAAEj/8AAAAAAAAAAAAB8HwAAAAAAAAAAAAfACAAAAAAAAAAAAHwAAAAAAAAAAAAAB8AAAAAAAAAAAAAAOAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":92,"w":93},"cardellina-canadensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAAAAAB/AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//4AAAAAAAA/4AAP//wAAAAAAA//wAA///AAAAAAAf//gAD//+AAAAAAP//+AAH//8AAAAAD///4AAH//wAAAAB////gAAP//gAAAAf////wAA//+AAAA//////gAB//8AAB//////8AAD//8AD//////4AAAH//////////8AAAAH//////////AAAAAf/////////wAAAAB/////////+AAAAAE/////////gAAAAAz////////8AAAAADP////////AAAAAAM////////4AAAAAAz///////+AAAAAADP///////wAAAAAAP///////+AAAAAAH////////wAAAAAD////////+AAAAAA/////////gAAAAACH///////8AAAAAAD////////gAAAAAB////////4AAAAAAf////////AAAAAAP////////wAAAAAH////////8AAAAAB/////////gAAAAAf////////4AAAAAD8AP/////+AAAAAAAAA//////gAAAAAAAAD/////4AAAAAAAAAH////8AAAAAAAAAAf///+AAAAAAAAAAA////AAAAAAAAAAAP///AAAAAAAAAAAA9//AAAAAAAAAAAAD4D/gAAAAAAAAAAAHgB/gAAAAAAAAAAAfAD/AAAAAAAAAAAA8B/+AAAAAAAAAAADwePwAAAAAAAAAAAPCA+AAAAAAAAAAAP+QHgAAAAAAAAAAH/4D8AAAAAAAAAAA8PgPgAAAAAAAAAAGB8AYAAAAAAAAAAAQPgHAAAAAAAAAAAADwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":62,"w":93},"cardellina-pusilla":{"bits":"AAH8AAAAAAAAAAAAAD/8AAAAAAAAAAAAB//4AAAAAAAAAAAA///wAAAAAAAAAAAP///gAAAAAAAAAAD////wAAAAAAAAAB/////8AAAAAAAAD//////8AAAAAAAA///////4AAAAAAAA///////4AAAAAAAA///////gAAAAAAAH///////AAAAAAAAf//////+AAAAAAAD///////4AAAAAAAP///////wAAAAAAB////////gAAAAAAH////////gAAAAAA/////////AAAAAAD/////////AAAAAAf/////////AAAAAB//////////4AAAAP///////////gAAA////////////4AAH////////////8AAf////////////wAD/////////3//+AAP////////gA//4AA////////4AAH/AAH////////wAABgAAf////////AAAAAAB////////8AAAAAAD//////gPwAAAAAAP/////4AGAAAAAAAf////+AAAAAAAAAA/////gAAAAAAAAD/////wAAAAAAAAB/x///4AAAAAAAAAf/j///AAAAAAAAAD8+Afj4AAAAAAAAA/B4AAeAAAAAAAAAH4BAAHgAAAAAAAAAPAAAB4AAAAAAAAAB+AAAeAAAAAAAAAAMAAADgAAAAAAAAAAgAAA4AAAAAAAAAAHAAAOAAAAAAAAAAAIAADgAAAAAAAAAAAAAA8AAAAAAAAAAAAAAP+AAAAAAAAAAAAAP/8AAAAAAAAAAAAD/PgAAAAAAAAAAAA/gEAAAAAAAAAAAAF4AAAAAAAAAAAAAAvAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAH4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAD4AAAAAAAAAAAAAAPAAAAAAAAA=","h":59,"w":93},"cardellina-rubrifrons":{"bits":"AAB/AAAAAAAAAAAAAB//AAAAAAAAAAAAA//+AAAAAAAAAMAAf//4AAAAAAAAPgAH///wAAAAAAAH8AD////AAAAAAAD//P////8AAAAAAA////////wAAAAAAf/+f/////AAAAAAP//gP////8AAAAAD//4Af////wAAAAB//8AD/////wAAAAf//AAP/////wAAAP//gAA//////wAAH//wAAH//////gAB//4AAA///////gB//8AAAD///////g//+AAAAf//////////AAAAD//////////gAAAAP/////////4AAAAB/////////+AAAAAP/////////wAAAAB/////////8AAAAAH/////////AAAAAA/////////wAAAAAH////////8AAAAAAf////////gAAAAAD////////+AAAAAAP////////4AAAAAB/////////wAAAAAP/////////AAAAAA/////////4AAAAAD////////8AAAAAAf////////wAAAAAB/////////gAAAAAH//////8f+AAAAAAf//////AHwAAAAAB//////wAAAAAAAAD/////+AAAAAAAAAP/////AAAAAAAAAAf////wAAAAAAAAAAf///8AAAAAAAAAAB///8AAAAAAAAAAA////AAAAAAAAAAAH///4AAAAAAAAAAB74A/AAAAAAAAAAAeHgPwAAAAAAAAAAD0MHgAAAAAAAAAAAf7B4AAAAAAAAAAAD/A8AAAAAAAAAAAAP4PAAAAAAAAAAAAAwD/gAAAAAAAAAAAD4/+AAAAAAAAAAAAOHBwAAAAAAAAAAAAD4CAAAAAAAAAAAAAfIwAAAAAAAAAAAAD9gAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/gAAAAAAAAAAAAADEAAAAAAAAAAAAAAPgAAAAAAAAAAAAAAwAAAAAAAAA==","h":62,"w":93},"cardinalis-cardinalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAeAAAAAAAAAH8AAAAAAAAA/wAAAAAAAAP+AAAAAAAAB/4AAAAAAAAP/gAAAAAAAB/+AAAAAAAAP/4AAAAAAAB//gAAAAAAAP/+AAAAAAAB//8AAAAAAAH//4AAAAAAA///gAAAAAAP///AAAAAAB///+AAAAAAP///8AAAAAA////wAAAAAD////gAAAAAB////AAAAAAD///+AAAAAAP///+AAAAAB////8AAAAAH////8AAAAAf////4AAAAB/////wAAAAH/////gAAAAf/////AAAAB/////+AAAAH/////4AAAAf/////wAAAB//////gAAAH//////gAAAf//////AAAA//////8AAAD//////4AAAP//////wAAA///////AAAB//////+AAAH//////8AAAP//////wAAAf//////gAAB//////+AAAD//////8AAAH//////wAAAP/////+AAAAf/////4AAAA//////wAAAB//////gAAAD/////+AAAAD/////8AAAAD/////4AAAB//////gAAAf9////PAAAB48H//8MAAAHgx/P/4AAAAcA/sf/AAAAB4PwA/+AAAADh/wD/4AAAAHvnAP/gAAAAB8OAf/AAAAAHwYB/8AAAAAPAAD/4AAAAAdAAP/gAAAAA8AA//AAAAAAAAD/8AAAAAAAAH/wAAAAAAAAf/gAAAAAAAB/+AAAAAAAAD/8AAAAAAAAP/wAAAAAAAAf/gAAAAAAAB/+AAAAAAAAH/8AAAAAAAAP/wAAAAAAAA//gAAAAAAAD/+AAAAAAAAH/4AAAAAAAAf/wAAAAAAAB//AAAAAAAAD/8AAAAAAAAP/4AAAAAAAAf/gAAAAAAAB//AAAAAAAAD/8AAAAAAAAH/wAAAAAAAAf/AAAAAAAAAb8AAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAA","h":93,"w":64},"cardinalis-sinuatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAA4AAAAAAAAAAAAAADgAAAAAAAAAAAAAAfAAAAAAAAAAAAAAD+AAAAAAAAAAAAAAf8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP/gAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAD//gAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAP//8AAAAAAAAAAAD///wAAAAAAAAAAA////AAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAf///8AAAAAAAAAAH////gAAAAAAAAAH////AAAAAAAAAAB////wAAAAAAAAAA////8AAAAAAAAAAf////AAAAAAAAAAH////wAAAAAAAAAD////8AAAAAAAAAA/////gAAAAAAAAAf////8AAAAAAAAAH/////gAAAAAAAAB/////4AAAAAAAAA//////AAAAAAAAAP/////4AAAAAAAAD/////+AAAAAAAAB//////wAAAAAAAAP/////8AAAAAAAAD//////AAAAAAAAB//////wAAAAAAAAf/////8AAAAAAAAH//////gAAAAAAAA//////4AAAAAAAAP/////8AAAAAAAAH//////AAAAAAAAB//////wAAAAAAAAf/////4AAAAAAAAD/////8AAAAAAAAA/////+AAAAAAAAAf/////AAAAAAAAAP//g//AAAAAAAAAD//gDj/wAAAAAAAB//wAeP/4AAAAAAAf+AAA4A/8AAAAAAP/AAADwAf8AAAAAD/gAAAOAfvwAAAAB/4AAAA8HweAAAAAf8AAAADz4BwAAAAP/AAAAAP0AGAAAAD/gAAAAA8gAYAAAA/wAAAAAOAACAAAAf8AAAAADwAAQAAAH+AAAAAAcAAAAAAD/gAAAAAHAAAAAAA/wAAAAAAQAAAAAAP8AAAAAAAAAAAAAD+AAAAAAAAAAAAAA/gAAAAAAAAAAAAAP4AAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":72,"w":93},"cathartes-aura":{"bits":"APgAAAAAAB/gAAAAAAH/gAAAAAAf/AAAAAAD/+AAAAAAP/8AAAAAA//4AAAAAB//8AAAAADz/+AAAAAGD/+AAAAAAP/8AAAAAAf/8AAAAAB//4AAAAAD//wAAAAAP//gAAAAAf//gAAAAA///gAAAAB///gAAAAB///gAAAAD///gAAAAD///gAAAAP///wAAAAf///4AAAB////4AAAD////8AAAH////8AAAf////8AAA/////8AAB/////8AAD/////8AAH/////4AAP/////4AAP/////4AAf/////wAA//////wAB//////wAB//////gAD//////gAH//////AAP/////+AAP/////+AAf/////8AA//////8AA//////4AB//////wAB//////wAD//////gAD//////AAB/////+AAD/////8AAD/////8AAH/////4AAH/////wAAH/////gAAH/////AAAP/////AAAP////+AAAf////8AAA/////4AAB/////4AAB/////wAAD/////gAAD/////gAAD/////AAAHf///+AAAc7///8AAA7z///4AAB/7///wAAP/////gAB//3//+AAD/+n//8AAf8/H//4AA+AMH//4AB4AQH//wAD4AAH//gAH0AAP//gAP4AAf//AAZgAAf/+AAcAAA//8AAAAAB//4AAAAAD//4AAAAAD//wAAAAAH//gAAAAAP/7AAAAAAf/+AAAAAAf/wAAAAAA//gAAAAAB//AAAAAAB/+AAAAAAD/8AAAAAAB/4AAAAAAA/wAAAAAAAfAA=","h":93,"w":53},"catharus-fuscescens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAP//4AAAAAAAAAAAD///gAAAAAAAAAAA////AAAAAAAAAAAP////4AAAAAAAAAD/////gAAAAAAAAA/////4AAAAAAAAAP////wAAAAAAAAAB////4AAAAAAAAAAf///+AAAAAAAAAAH////gAAAAAAAAAB////4AAAAAAAAAB/////AAAAAAAAAB/////wAAAAAAAAA/////8AAAAAAAAAf/////gAAAAAAAAP/////4AAAAAAAAH//////AAAAAAAAB//////4AAAAAAAAf//////AAAAAAAAH//////4AAAAAAAD///////AAAAAAAA///////4AAAAAAAP///////AAAAAAAD///////4AAAAAAB////////AAAAAAAf///////4AAAAAAH////////AAAAAAB////////wAAAAAAf///////+AAAAAAH////////wAAAAAA////////+AAAAAAP////////gAAAAAD////////8AAAAAA/////////AAAAAAH////////4AAAAAA////////+AAAAAAH////////wAAAAAA////////8AAAAAAf////////AAAAAAH////////4AAAAAB////////+AAAAAAf////////gAAAAAH////////wAAAAAB////////8AAAAAAf////////AAAAAAH////////wAAAAAA////////8AAAAAAA///////+AAAAAAAP///////gAAAAAAB//4f///gAAAAAAAf/8B///gAAAAAAAH/+AP/3wAAAAAAAB//gA+A+AAAAAAAAf/4AHgB4AAAAAAAH/+AAeAHgAAAAAAB//gABwAeAAAAAAAf/4AAHAB4AAAAAAH//AAA4ADgAAAAAB//wAADgAOAAAAAAf/8AAAcAA8AAAAAH//AAABwADwAAAAB//wAAAOAAPAAAAAP/8AAAA4A/8AAAAB//AAAADAP/4AAAAf/wAAAAcBAfwAAAB/8AAAABwAD/AAAAAAAAAAH/gAP4AAAAAAAAAB//wBvAAAAAAAAAAAH/ANgAAAAAAAAAAAfYBsAAAAAAAAAAAD7APgAAAAAAAAAAAPADcAAAAAAAAAAADYADAAAAAAAAAAAAbAA4AAAAAAAAAAAD4AAAAAAAAAAAAAB3AAAAAAAAAAAAAAAwAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":84,"w":93},"catharus-guttatus":{"bits":"AAAAAAAAAAD+AAAAAAAAAAAAAf/wAAAAAAAAAAAB//8AAAAAAAAAAAD///AAAAAAAAAAAH///gAAAAAAAAAAP///wAAAAAAAAAAf////4AAAAAAAAA//////AAAAAAAAB//////AAAAAAAAD/////8AAAAAAAAD////+AAAAAAAAAH////4AAAAAAAAAH////4AAAAAAAAAP////wAAAAAAAAAP////wAAAAAAAAAf////gAAAAAAAAAf////AAAAAAAAAA/////AAAAAAAAAB////+AAAAAAAAAH////+AAAAAAAAAP////+AAAAAAAAA/////8AAAAAAAAB/////8AAAAAAAAD/////8AAAAAAAAP/////8AAAAAAAAf/////8AAAAAAAA//////8AAAAAAAB//////+AAAAAAAD//////+AAAAAAAH//////+AAAAAAAP//////+AAAAAAAf//////+AAAAAAA///////+AAAAAAA///////+AAAAAAB///////+AAAAAAD///////+AAAAAAH///////8AAAAAAP///////8AAAAAAf///////8AAAAAA////////8AAAAAB////////8AAAAAB////////4AAAAAD////////4AAAAAH////////4AAAAAP////////wAAAAAP////////wAAAAAf////////gAAAAAf////////gAAAAAf////////AAAAAA/////////AAAAAA////////+AAAAAB////////+AAAAAB////////8AAAAAB////////4AAAAAB////////wAAAAAD////////gAAAAAD////////AAAAAAD///////+AAAAAAH///////8AAAAAAP///////4AAAAAAf///////gAAAAAA////////AAAAAAB///////8AAAAAAB///////gAAAAAAD//////+AAAAAAAH///w//+AAAAAAAH///g/h/gAAAAAAP///A/AD4AAAAAAP//+AfAA+AAAAAAc//4AHgAPgAAAAAB//wADwAH4AAAAAD//gAB4AD8AAAAAD/+AAA4A//AAAAAH/+AAAcB//gAAAAP/8AAAODwfgAAAAP/8AAAHDAPgAAAAf/4AAADgAvgAAAA//4AAABwBvAAAAA//wAAAB8BvAAAAB//gAAAP/A+AAAAD//gAAA//h8AAAAD//AAAB4fgYAAAAH/+AAABAfw4AAAAH/+AAABAPxwAAAAP/8AAAABPgAAAAAP/8AAAABfAAAAAAf/4AAAAB+AAAAAAf/wAAAAB+AAAAAA//wAAAAB8AAAAAA//gAAAAA4AAAAAA//AAAAAA4AAAAAA/sAAAAAAgAAAAAAeAAAAAAAAAAAAAAA","h":93,"w":90},"catharus-minimus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAH/+AAAAAAAAAAAAB//8AAAAAAAAAAAAf///8AAAAAAAAAAH////gAAAAAAAAAB////4AAAAAAAAAAP///4AAAAAAAAAAD///4AAAAAAAAAAA///+AAAAAAAAAAAH///gAAAAAAAAAAB///4AAAAAAAAAAAP///AAAAAAAAAAAB///wAAAAAAAAAAAf//+AAAAAAAAAAAH///gAAAAAAAAAAA///8AAAAAAAAAAAP///AAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAAf///4AAAAAAAAAAP////AAAAAAAAAAD////4AAAAAAAAAA/////AAAAAAAAAAP////4AAAAAAAAAD/////AAAAAAAAAA/////4AAAAAAAAAP/////AAAAAAAAAD/////4AAAAAAAAA//////AAAAAAAAAP/////4AAAAAAAAH//////AAAAAAAAB//////wAAAAAAAAf/////+AAAAAAAAH//////wAAAAAAAB//////8AAAAAAAAf//////gAAAAAAAH//////4AAAAAAAB///////AAAAAAAAf//////wAAAAAAAH//////+AAAAAAAD///////gAAAAAAA///////4AAAAAAAf//////+AAAAAAAH///////gAAAAAAD///////4AAAAAAB///////+AAAAAAAf///////gAAAAAAP///////4AAAAAAH///z///8AAAAAAD///+P///AAAAAAB////////gAAAAAA///+A///wAAAAAAf/9/AAP/gAAAAAAP/+PgAD/YAAAAAAD//DwAAf+AAAAAAB//gQAADzgAAAAAAP/wAAAAOOAAAAAAA/8AAAAB44AAAAAAH+AAAAAHDgAAAAAAAAAAAAAceAAAAAAAAAAAAADh4AAAAAAAAAAAAAOHgAAAAAAAAAAAABweAAAAAAAAAAAAAHB4AAAAAAAAAAAAAYHgAAAAAAAAAAAADsf/gAAAAAAAAAAAP//+AAAAAAAAAABx/3/4AAAAAAAAAAP////gAAAAAAAAAAf/+8EAAAAAAAAAAAB/8gAAAAAAAAAAAAHPwAAAAAAAAAAAAAeCAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":78,"w":93},"catharus-ustulatus":{"bits":"AAAAAAAAAAD/AAAAAAAAAAAAAP/+AAAAAAAAAAAAP//gAAAAAAAAAAAf//8AAAAAAAAAAAf///AAAAAAAAAAA////4AAAAAAAAAA/////+AAAAAAAAAf/////wAAAAAAAAf/////4AAAAAAAAf/////wAAAAAAAAf/////AAAAAAAAAP////8AAAAAAAAAP////8AAAAAAAAAP////+AAAAAAAAAP////+AAAAAAAAAP/////AAAAAAAAAP/////AAAAAAAAAf/////gAAAAAAAAf/////wAAAAAAAA//////wAAAAAAAA//////4AAAAAAAA//////8AAAAAAAB//////8AAAAAAAB//////+AAAAAAAB///////AAAAAAAB///////gAAAAAAB///////wAAAAAAB///////4AAAAAAB///////8AAAAAAB///////+AAAAAAA////////AAAAAAA////////gAAAAAA////////wAAAAAAf///////4AAAAAAf///////8AAAAAAf///////+AAAAAAf////////AAAAAAf////////gAAAAAf////////wAAAAAf////////wAAAAAP////////4AAAAAP////////8AAAAAH////////8AAAAAH////////+AAAAAH////////+AAAAAD/////////AAAAAD/////////AAAAAB/////////gAAAAB/////////gAAAAA/////////gAAAAA/////////wAAAAAf////////wAAAAAP////////wAAAAAP////////wAAAAAD////////wAAAAAB////////wAAAAAB////////wAAAAAB////////wAAAAAB////////gAAAAAA////////gAAAAAA////////AAAAAAA///////+AAAAAAA///////+AAAAAAA///////4AAAAAAA///////gAAAAAAAf/////v8AAAAAAAf///n4AfAAAAAAAf///h8AH4AAAAAAPv//APAA+AAAAAAPn//ADwAHwAAAAAHn//AA8B//wAAAADH//gAPB//8AAAAAD//gADw///AAAAAD//wAA8QD/wAAAAD//wAffAA+YAAAAB//4Af/+AfIAAAAB//4AN//wPgAAAAA//8AEA/4OwAAAAA//8AAAPkH4AAAAAf/+AAAHyD8AAAAAf/+AAAD4HuAAAAAf//AAAD8AHAAAAAP//AAAB+APAAAAAP//gAAH3ACAAAAAP//gAABzAAAAAAAH//wAAAHgAAAAAAH//wAAADgAAAAAAD//wAAAAAAAAAAAB//4AAAAAAAAAAAA//4AAAAAAAAAAAA//4AAAAAAAAAAAAf/4AAAAAAAAAAAAPwAAAAAAAAAAAAAA=","h":93,"w":91},"catherpes-mexicanus":{"bits":"AAAAAAAAAABwAAAAAAAAAB8AAAAAAAAAB8AAAAAAAAAB+AAAAAAAAAA/AAAAAAAAAAfgAAAAAAAAAfgAAAAAAAAAPwAAAAAAAAAH4AAAAAAAAAD8AAAAAAAAAB+AAAAAAAAAA/AAAAAAAAAH/wAAAAAAAAH/8AAAAAAAAP//AAAAAAAAP//wAAAAAAAH//+AAAAAAAD///gAAAAAAB///4AAAAAAA///+AAAAAAAf///wAAAAAAP///8AAAAAAD////AAAAAAB////wAAAAAA////8AAAAAAP////AAAAAAH////wAAAAAB////8AAAAAA/////gAAAAAf////4AAAAAH////+AAAAAD/////gAAAAB/////4AAAAAf////+AAAAAP/////gAAAAH/////8AAAAD//////AAAAB//////wAAAA//////8AAAAP//////AAAAH//////wAAAD//////+AAAA///////gAAAf//////4AAAP//////+AAAD///////AAAB///////wAAA///////8AAAf///////AAAH///////wAAD///////4AAA///////+AAAf///////gAAH///////4AAD///////8AAB////////AAAf///////gAAH///////4AAD///////8AAA///////+AAAf///////gAAH///////wAAD///////4AAA+//////8AAAfP//////AH8Hz//////gD/B5//////wB+A8f/////4AfAMP/////8APgAH/////8ADwAD//////AB/4B///////g/+Af//4/8f//4AP//4AAAP/8AH//8AAAAH8AD//4AAAAD8AA//8AAAAB4AAf/8AAAAB8AAP/+AAAAA8AAH//gAAAAPAAB//wAAAADgAA//8AAAAAwAAP/+AAAAAPAAD//gAAAAAAAA//wAAAAAAAAP/8AAAAAAAAD/+AAAAAAAAA//gAAAAAAAAH/wAAAAAAAAB/8AAAAAAAAAH+AAAAAAAAAB/gAAAAAAAAAHAAAAAAAAAAA=","h":93,"w":68},"centronyx-bairdii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAfAAAP/4AAAAAAAAP4AAH//wAAAAAAAD/fAB///gAAAAAAB//8AP//+AAAAAAAf//gD///wAAAAAAP//8B////AAAAAAD///A////8AAAAAB///gP////wAAAAAf//wB/////AAAAAH//8AB/////4AAAD//+AAH/////+AAA///AAA///////AAf//gAAH///////////wAAA///////////4AAAD//////////8AAAAf/////////+AAAAD//////////gAAAAf/////////oAAAAD/////////zAAAAAf////////+wAAAAD/////////sAAAAAf/////////AAAAAD//////////gAAAAf//////////AAAAD//////////4AAAAP/////////4AAAAB/////////wAAAAAP////////4AAAAAB//3/////+AAAAAAH/+f/////gAAAAAA//h/////4AAAAAAH/8P/////AAAAAAAf/A/////wAAAAAAB/wD////+AAAAAAAP4AH////gAAAAAAA8AAH///4AAAAAAADAAAP//8AAAAAAAAOAAAf//AAAAAAAAAYAAAf/wAAAAAAAABwAAB/8AAAAAAAAADgAAP+AAAAAAAAAAPgAA/wAAAAAAAAAAHwAP+AAAAAAAAAAAH//nwAAAAAAAAAAAB+A8AAAAAAAAAAAA+APAAAAAAAAAAAAfADgAAAAAAAAAAAH3g4AAAAAAAAAAAD/+PAAAAAAAAAAAf/+DwAAAAAAAAAAP/gA8YAAAAAAAAABf4AP/gAAAAAAAAAH+AH/gAAAAAAAAAB7gH/wAAAAAAAAAA84P/gAAAAAAAAAAGGD/4AAAAAAAAAAAgwT+AAAAAAAAAAAECB/gAAAAAAAAAAAAAecAAAAAAAAAAAAAHnAAAAAAAAAAAAABwwAAAAAAAAAAAAAMGAAAAAAAAAAAAABAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":68,"w":93},"centronyx-henslowii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAH//gAAAAAAAAAAAB///AAAAAAAAAAAAf//+AAAAAAAAAAAH///8AAAAAAAAAAD////wAAAAAAB4AB////+AAAAAAAfAA/////wAAAAAAPzwP/////AAAAAAD//h/////8AAAAAB//8D/////wAAAAAf//gD/////AAAAAP//wAf////+AAAAD//8AD/////8AAAA///AAP/////4AAAP//gAB//////wAAH//wAAP//////AAB//4AAB//////+AAf/+AAAH//////8AP//AAAA///////8P//gAAAH//////////4AAAA//////////8AAAAH//////////AAAAA//////////gAAAAH/////////4AAAAA//////////AAAAAD/////////wAAAAAf////////+AAAAAD/////////gAAAAAf////////8AAAAAD/////////AAAAAAP////////wAAAAAB////////8AAAAAAP////////wAAAAAA////////+AAAAAAH////////wAAAAAAf////////AAAAAAB////////8AAAAAAP////////wAAAAAA/////////AAAAAAD////////4AAAAAAP//////8DAAAAAAA///////AAAAAAAAD//////4AAAAAAAAP/////+AAAAAAAAAf/////gAAAAAAAAB/////4AAAAAAAAAD////8AAAAAAAAAAH////AAAAAAAAAAAP///wAAAAAAAAAAAP//8AAAAAAAAAAAH//8AAAAAAAAAAAD8A/gAAAAAAAAAAB+AB8AAAAAAAAAAAfAAHgAAAAAAAAAAP/wA4AAAAAAAAAAH/+AHAAAAAAAAAAA/AYBwAAAAAAAAAAP4AAOAAAAAAAAAAB/gABgAAAAAAAAAAPfAAcAAAAAAAAAAAZ4ADgAAAAAAAAAADgAA4AAAAAAAAAAAcAAH/AAAAAAAAAABgAB/sAAAAAAAAAAOAAfAAAAAAAAAAAA4AHwAAAAAAAAAAAAAB/AAAAAAAAAAAAAAf4AAAAAAAAAAAAADbAAAAAAAAAAAAAATdAAAAAAAAAAAAACZ4AAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":81,"w":93},"certhia-americana":{"bits":"AAAAAAYAAAAAOAAAAAHgAAAAB4AAAAAeAAAAAHgAAAAB4AAAAAeAAAAAPwAAAAf8AAAAP/gAAAD/8AAAA//gAAAP/8AAAD//gAAA//8AAAH//gAAB//8AAAP//gAAB//+AAAP//wAAB///AAAP//4AAD///gAAf//8AAD///gAAf//+AAH///wAA///+AAP///wAD///+AAf///wAH///+AB////wAP///+AD////wAf///+AH////wA////8AH////gB////8AP////AB////4Af////AD////wAf///+AH////gA////4AH////AA////wAP///8AB////AAP////AB////8AP////gB////8AP///zAB///8YAP//7HAB//+4AAf//nAADv7gwAAf/eDAAD/+AAAA3/gAAAG/8AAAAn/AAAAA/4AAAAD+AAAAAfwAAAAD+AAAAAfwAAAAD+AAAAAfwAAAAH8AAAAA/gAAAAH8AAAAA/gAAAAH8AAAAA/gAAAAH8AAAAB/gAAAAP8AAAAB/gAAAAP4AAAAB/AAAAAP4AAAAB+AAAAAfwAAAAD+AAAAAfgAAAAD4AAAAAGAAAAAAA==","h":93,"w":39},"chaetura-pelagica":{"bits":"AAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAA//AAAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAB///4AAAAAAAAAAAf///gAAAAAAAAAAD///+AAAAAAAAAAB////4AAAAAAAAAA/////wAAAAAAAAAP/////4AAAAAAAAAD/////wAAAAAAAAAf/////wAAAAAAAAB//////gAAAAAAAAP//////AAAAAAAAA//////+AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////wAAAAAAD////////AAAAAAAP///////8AAAAAAB////////4AAAAAAP////////gAAAAAB////////+AAAAAAH////////4AAAAAA/////////4AAAAAD/////////4AAAAAf/////////4AAAAB//////////4AAAAH//////////4AAAAf//////////4AAAB///////////wAAAH///////////gAAAf///////////AAAA///////////8AAAD/////////+/gAAAH/////////+AAAAAP/////////8AAAAA//////////4AAAAP//////////gAAADz/////////8AAAAeHf//A///+/AAAAD4L//4Af//4AAAAAfB/z+AAP//wAAAAB+f/PgAAH//gAAAAD344AAAAH/+AAAAAA+DgAAAAf/4AAAAAHwYAAAAA//AAAAAAfmAAAAAB+AAAAAAA4AAAAAAH8AAAAAAD4AAAAAAPwAAAAAAGAAAAAAAfAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":58,"w":93},"chaetura-vauxi":{"bits":"AAD+AAAD/8AAB//4AAf//gAH//8AB///8AP///wD///4Af//8AH///AA///4AH///AA///4AP///AB///4Af///AH///8B////gP///+D////wf///+D////4f////D////4f////n////8/////n////8/////n////8/////n////+/////3////+/////z////+f////z////+P////h////8P////g////8H////g////8D////gf///4B////AP///4D////Af///4D////Af///wD///+Af///wD///+AP///wB///8AH///gAz//8AGf//gA3//8AG///AA3//4AM///AAH//wAA//+AAP//wAB//+AAP//gAB//8AAP//gAB//+AAP//wAD//+AAf//4AD///AAf//8AD//fgAf/5+AD/+HwAf/g/AD/8D4A//APgH/4A+A/+ADwH/wAPA++AA4H3wABA88AAAHjgAAA4cAAAGDgAAAQMAAA","h":93,"w":33},"charadrius-melodus":{"bits":"AAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAD/4AAAAAAAAAAAAB//wAAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAP///AAAAAAAAAAAD///8AAAAAAAAAAA////gAAAAAAAAAAf///+AAAAAAAAAAP////wAAAAAAAAAH/////gAAAAAAAAB//////AAAAAAAAAPz/////AAAAAAAAAAH////+AAAAAAAAAAf////+AAAAAAAAAD/////8AAAAAAAAAP/////4AAAAAAAAB//////wAAAAAAAAf//////gAAAAAAAD//////+AAAAAAAAf//////8AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAf///////4AAAAAAD////////gAAAAAAf///////+AAAAAAD////////4AAAAAAf////////gAAAAAD////////+AAAAAAf////////8AAAAAB/////////wAAAAAP/////////gAAAAB/////////+AAAAAH/////////8AAAAA//////////8AAAAD//////////+AAAAP//////////+AAAA///////////+AAAD///////////4AAAP///////////AAAA///////////wAAAD//////////+AAAAP//////////gAAAAf//////////gAAAB//////8AB/8AAAAD/////8AAB/AAAAAD////8AAAAAAAAAAD///8AAAAAAAAAAAD//+AAAAAAAAAAAAP/8AAAAAAAAAAAAA/wAAAAAAAAAAAAAH+AAAAAAAAAAAAAA7wAAAAAAAAAAAAAPOAAAAAAAAAAAAABzwAAAAAAAAAAAAAOOAAAAAAAAAAAAADjwAAAAAAAAAAAAAccAAAAAAAAAAAAAHDgAAAAAAAAAAAAA4YAAAAAAAAAAAAAOHAAAAAAAAAAAADDw4AAAAAAAAAAAA//3AAAAAAAAAAAB///wAAAAAAAAAAAf/4OAAAAAAAAAAAAH//8AAAAAAAAAAAB///4AAAAAAAAAAAL//tAAAAAAAAAAAA//4AAAAAAAAAAAAAB8AAAAAAAAAAAAAA+AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"charadrius-semipalmatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//4AAAAAAAAAAAAf//gAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAH///AAAAAAAAAAAA///8AAAAAAAAAAAP///8AAAAAAAAAAP////+AAAAAAAAAH//////AAAAAAAAB///////AAAAAAAAP///////AAAAAAAAAf//////AAAAAAAAB//////8AAAAAAAAP//////4AAAAAAAA///////wAAAAAAAH///////gAAAAAAA///////+AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////gAAAAAAf////////gAAAAAD/////////AAAAAAf/////////gAAAAD//////////4AAAAP///////////4AAB////////////AAAP///////////wAAA////////////wAAD////////////gAAP///////////8AAB/////////+P/AAAH////////gAAAAAAf///////gAAAAAAB///////wAAAAAAAD//////8AAAAAAAAP/////+AAAAAAAAAf/////gAAAAAAAAA/////wAAAAAAAAAB////8AAAAAAAAAAB///8AAAAAAAAAAAA///AAAAAAAAAAAAD+fwAAAAAAAAAAAAPA+AAAAAAAAAAAAA4B4AAAAAAAAAAAAHgHgAAAAAAAAAAAA8AeAAAAAAAAAAAAHADwAAAAAAAAAAAB4AeAAAAAAAAAAAAOADwAAAAAAAAAAADgAcAAAAAAAAAAAA4ADgAAAAAAAAAAAHAAcAAAAAAAAAAABwADgAAAAAAAAAAAcAAcAAAAAAAAAAAHgADgAAAAAAAAAAA4AAcAAAAAAAAAB//gADgAAAAAAAAAD//gAcAAAAAAAAAAH/8ADgAAAAAAAAAP/gBAeAAAAAAAAAD+cAf/8AAAAAAAAAAHAA//wAAAAAAAAABwD//AAAAAAAAAAAIA//4AAAAAAAAAAAAAAcAAAAAAAAAAAAAAPAAAAAAAAAAAAAADwAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"charadrius-vociferus":{"bits":"AADgAAAAAAAAAAAAAH/gAAAAAAAAAAAAB//AAAAAAAAAAAAA//8AAAAAAAAAAAAP//wAAAAAAAAAAAB///AAAAAAAAAAAAP//4AAAAAAAAAAAB///gAAAAAAAAAAAf//8AAAAAAAAAAAD///gAAAAAAAAAAB///+AAAAAAAAAAA////wAAAAAAAAAAP////AAAAAAAAAAD////4AAAAAAAAAA/////gAAAAAAAAAAAf///AAAAAAAAAAAD////gAAAAAAAAAAP////wAAAAAAAAAB/////4AAAAAAAAAP/////4AAAAAAAAB//////wAAAAAAAAP//////gAAAAAAAD///////AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////wAAAAAAf////////AAAAAAD////////+AAAAAAf////////8AAAAAD/////////4AAAAAf/////////wAAAAD//////////gAAAAP//////////AAAAB///////////AAAAH///////////wAAA////////////gAAD///////////8AAAf//////////+AAAB///////////8AAAH///////////gAAA///////////4AAAD///////////wAAAH///////////wAAAf///////////AAAB///////////+AAAH///////AAP/4AAAP/////+AAAP/AAAAf/////gAAAPwAAAA/////4AAAAMAAAAA////8AAAAAAAAAAAf//8AAAAAAAAAAAA///gAAAAAAAAAAAB//+AAAAAAAAAAAAD//wAAAAAAAAAAAA//+AAAAAAAAAAAA///wAAAAAAAAAAAP/wAAAAAAAAAAAAB+PAAAAAAAAAAAAAfx4AAAAAAAAAAAAD/PAAAAAAAAAAAAA+5wAAAAAAAAAAAAD3OAAAAAAAAAAAAAeZwAAAAAAAAAAAAD7OAAAAAAAAAAAAAfBwAAAAAAAAAAAAD4OAAAAAAAAAAAAAPhwAAAAAAAAAAAAB8OAAAAAAAAAAAAAHDwAAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAH4AAAAAAAAAAAAAB/gAAAAAAAAAAAA//sAAAAAAAAAAAAH/8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAPcAAAAAAAAAAAAAHzgAAAAAAAAAAAAD8cAAAAAAAAAAAAA+DgAAAAAAAAAAAAfAcAAAAAAAAAAAADADgAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAQAAAAAAAAA=","h":93,"w":93},"chlidonias-niger":{"bits":"AAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//AAAAAAAAAAAAAf/+AAAAAAAAAAAAH//4AAAAAAAAAAAB///AAAAAAAAAAAD///8AAAAAAAAAAD////wAAAAAAAAAB/////AAAAAAAAAAP////8AAAAAAAAAAAD////gAAAAAAAAAAP////wAAAAAAAAAB/////wAAAAAAAAAH/////gAAAAAAAAA//////gAAAAAAAAH//////AAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA////////gAAAAAAH////////AAAAAAA/////////AAAAAAH/////////AAAAAAf///////////wAAD////////////gAAf///////////4AAB///////////gAAAP///////////gAAA////////////AAAD///////////4AAAP//////////4AAAA//////////wAAAAD////////4AAAAAAP//////4AAAAAAAAf/////4AAAAAAAAA/////4AAAAAAAAAB////+AAAAAAAAAAB////AAAAAAAAAAAAf/wAAAAAAAAAAAAA/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAPzgAAAAAAAAAAAAPx8AAAAAAAAAAAAD+8AAAAAAAAAAAAAc+AAAAAAAAAAAAADv4AAAAAAAAAAAAAdzgAAAAAAAAAAAAH+AAAAAAAAAAAAAA3wAAAAAAAAAAAAADPgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":54,"w":93},"chondestes-grammacus":{"bits":"AB/8AAAAAAAAAAAAA//8AAAAAAAAAAAAP//wAAAAAAAAAAAD///gAAAAAAAAAAA///+AAAAAAAAAAAf///wAAAAAAAAAAP////AAAAAAAAAAD////8AAAAAAAAAA/////gAAAAAAAAAH////+AAAAAAAAAAH////4AAAAAAAAAAP////AAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAB/////gAAAAAAAAAH/////AAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA///////gAAAAAAAH//////+AAAAAAAA///////8AAAAAAAH///////wAAAAAAA////////AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////8AAAAAAD////////gAAAAAAf///////+AAAAAAD////////4AAAAAAP////////gAAAAAB////////+AAAAAAP////////4AAAAAA/////////AAAAAAH////////8AAAAAAf////////wAAAAAB////////+AAAAAAH////////4AAAAAAf////////AAAAAAD////////8AAAAAAP////////wAAAAAA////////+AAAAAAD////////4AAAAAAH////////AAAAAAAf///////8AAAAAAB////////wAAAAAAB////////gAAAAAAH///////+AAAAAAAP///////4AAAAAAAP///////AAAAAAAAf//////4AAAAAAAH///7//+AAAAAAAH///wH//4AAAAAAD///8AP//AAAAAAB////gAf/8AAAAAH////AAA//wAAAAD////gAAB//AAAAAf+BH4AAAH/8AAAAGfgB8AAAA//wAAAA/4A//gAAD//AAAAD+B//+AAAP/8AAAAdw///YAAA//wAAADuP/AAAAAD//AAAAZz3wAAAAAP/8AAADH5+AAAAAA//wAAAcCdgAAAAAD//AAAAAXsAAAAAAP/8AAAAA7gAAAAAA//wAAAAHcAAAAAAD//AAAABzgAAAAAAP/4AAAAMHwAAAAAB//gAAAAwYAAAAAAD/+AAAACAAAAAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAAZ4","h":81,"w":93},"chordeiles-acutipennis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAH//AAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAAf///gAAAAAAAAAAH///8AAAAAAAAAAB////+AAAAAAAAAAf////4AAAAAAAAAH/////gAAAAAAAAB////+AAAAAAAAAAP////wAAAAAAAAAD////+AAAAAAAAAD/////wAAAAAAAAB/////+AAAAAAAAA//////4AAAAAAAAf//////gAAAAAAAP//////+AAAAAAAD///////4AAAAAAB////////AAAAAAAf///////8AAAAAAH////////gAAAAAB////////8AAAAAA/////////gAAAAAf////////8AAAAAP/////////gAAAAP/////////8AAAAH//////////gAA////////////4B//////////////A//////////////4H/////////////+B//////////////wP/////////////8A//////////////gH/////////////4A/////////////+AB/////////////gAH//4f////////8AA//AH/////////AAAAAD/////////wAAAAA/////////8AAAAAP/////////gAAAAD//////////AAAAAf/////////8AAAAD//gP//////gAAAAAAAAf///nj8AAAAAAAAA///+x/gAAAAAAAAAf+PyPwAAAAAAAAAAPB+AeAAAAAAAAAABgPwHgAAAAAAAAAAMP8AYAAAAAAAAAAAA/AAAAAAAAAAAAAAAwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":58,"w":93},"chordeiles-minor":{"bits":"AAAAAAAAAAAAD/AAAAAAAAAAAAAD//AAAAAAAAAAAAB//8AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAD///+AAAAAAAAAAA////4AAAAAAAAAAP///5AAAAAAAAAAP///+BwAAAAAAAAf////gP4AAAAAAA/////8A/8AAAAAB//////gD/+AAAAB//////4AP//AAAB///////AAf//wAf///////4AA/////////////gAA////////////8AAB////////////gAAB///////////8A//////////////gf/////////////8H//////////////g//////////////8AP/////////////AAP////////////4AA////////////+AAB////////////wAAA///////////8AAAA///////////AAAAAP/////////wAAAAAD////////8AAAAAAAP//////+AAAAAAAAP//////AAAAAAAAAH/////gAAAAAAAAAH////wAAAAAAAAAAf///4AAAAAAAAAAAPyB/AAAAAAAAAAAAAQNgAAAAAAAAAAAAADsAAAAAAAAAAAAAABgAAA","h":40,"w":93},"chroicocephalus-philadelphia":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB///8AAAAAAAAAAB//////4AAAAAAAA///////gAAAAAAAH/////wAAAAAAAAA//////gAAAAAAAAD/////+AAAAAAAAAAB////8AAAAAAAAAAA////wAAAAAAAAAAB////AAAAAAAAAP/////8AAAAAAAAH//////8AAAAAAAD///////8AAAAAAA////////8AAAAAAP////////4AAAAAB/////////4AAAAAf/////////wAAAAP//////////wAAAP/////////////gH/////////////+A//////////////wPgP///////////+AAAf///////////wAAAf///////////AAAB///////////8AAAH///////////gAAAf//////////8AAAB///////////gAAAD/////////v8AAAAP/////////AAAAAAf/////+H/gAAAAAAf/////gYAAAAAAAAP////8AAAAAAAAAAB////AAAAAAAAAAAH///4AAAAAAAAAAA////AAAAAAAAAAAD///4AAAAAAAAAAAP///AAAAAAAAAAAA///4AAAAAAAAAAAH///AAAAAAAAAAAAf//8AAAAAAAAAAAD///wAAAAAAAAAAAP///AAAAAAAAAAAA///4AAAAAAAAAAAH///gAAAAAAAAAAAf//8AAAAAAAAAAAB///wAAAAAAAAAAAH///AAAAAAAAAAAAf//4AAAAAAAAAAAB///gAAAAAAAAAAAH//8AAAAAAAAAAAAf//wAAAAAAAAAAAB//+AAAAAAAAAAAAH//wAAAAAAAAAAAA///AAAAAAAAAAAAD//4AAAAAAAAAAAAP//gAAAAAAAAAAAA//8AAAAAAAAAAAAD//wAAAAAAAAAAAAP/+AAAAAAAAAAAAA//wAAAAAAAAAAAAD//AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//gAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAH+AAAAAAAAAAAAAAfwAAAAAAAAAAAAAB/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":76,"w":93},"chroicocephalus-ridibundus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAD/+AAAAAAAAAAAAA//4AAAAAAAAAAAAH//gAAAAAAAAAAAB//8AAAAAAAAAAAAf//wAAAAAAAAAAAP//+AAAAAAAAAAAf///4AAAAAAAAAAH////AAAAAAAAAAB////4AAAAAAAAAAPj///AAAAAAAAAAAAH//4AAAAAAAAAAAAf//gAAAAAAAAAAAD//8AAAAAAAAAAAAf//gAAAAAAAAAAAH////8AAAAAAAAAA//////AAAAAAAAAP//////AAAAAAAAB///////AAAAAAAAf//////+AAAAAAAD///////8AAAAAAAf///////+AAAAAAD/////////AAAAAAf////////+AAAAAC/////////8AAAAAR/////////4AAAACP/////////gAAAAR/////////+AAAACH//////////wAAAQ////////////wADD////////////gAYf///////////8ABB///////////4AAMP///////////wAAg///////////+AAGD//////////+AAAYP/////////+AAABAf/////////8AAAMB//////////gAAAwH/////////4AAADgP/////vgB+AAAAGA/////vAAAAAAAAMH/////AAAAAAAAA8P///7gAAAAAAAAA9///94AAAAAAAAAB////8AAAAAAAAAAA///8AAAAAAAAAAAB5/4AAAAAAAAAAAAODcAAAAAAAAAAAABwPAAAAAAAAAAAAAOBwAAAAAAAAAAAABwOAAAAAAAAAAAAAOBwAAAAAAAAAAAABgOAAAAAAAAAAAAAMBwAAAAAAAAAAAABgOAAAAAAAAAAAAAOBwAAAAAAAAAAAAB4MAAAAAAAAAAAAD/BgAAAAAAAAAAAP/wOAAAAAAAAAAAA/+B4AAAAAAAAAAAD//+AAAAAAAAAAAAf//wAAAAAAAAAAAGDv+AAAAAAAAAAAAAJ/wAAAAAAAAAAAAA/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAA4AAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":73,"w":93},"cinclus-mexicanus":{"bits":"AAAfAAAAAAAAAAAAAAf/AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAD////+AAAAAAAAAA/////4AAAAAAAAAB/////AAAAAAAAAAAP///8AAAAAAAAAAAf///wAAAAAAAAAAB////AAAAAAAAAAAP////+AAAAAAAAAA//////AAAAAAAAAH//////AAAAAAAAA///////AAAAAAAAH//////+AAAAAAAAf//////8AAAAAAAH///////4AAAAAAA////////gAAAAAAH////////AAAAAAB////////8AAAAAAP////////wAAAAAB/////////AAAAAAP////////8AAAAAD/////////wAAAAAf/////////gAAAAD/////////8AAAAAf/////////wAAAAD//////////AAAAAP/////////+AAAAB//////////4AAAAP//////////gAAAB//////////+AAAAP//////////8AAAA///////////wAAAH///////////4AAA////////////4AAD////////////wAAf////////////gAB/////////////AAH////////////4AAf///////////+AAD////////////wAAP///////////8AAA//////////g+AAAD////////+AAAAAAH///////gAAAAAAA///////4AAAAAAAB///////AAAAAAAAH//////gAAAAAAAAP/////wAAAAAAAAA/////8AAAAAAAAAB////+AAAAAAAAAAD////AAAAAAAAAAAD///gAAAAAAAAAAAB//gAAAAAAAAAAAAH/4AAAAAAAAAAAAB7wAAAAAAAAAAAAAe/AAAAAAAAAAAAAH/+AAAAAAAAAAAAD//wAAAAAAAAAAA///gAAAAAAAAAAAP//n8AAAAAAAAAAB////gAAAAAAAAAB////kAAAAAAAAAAf//4AAAAAAAAAAAH//4AAAAAAAAAAAA//+AAAAAAAAAAAAD+fAAAAAAAAAAAAAQHgAAAAAAAAAAAAAB4AAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAQAAAAAAAAAAA","h":74,"w":93},"circus-hudsonius":{"bits":"B/gAAAAAD/8AAAAAD//AAAAAD//wAAAAB//8AAAAA//+AAAAA///AAAAAf//wAAAAP//4AAAAH//8AAAAD//+AAAAAf//AAAAAP//wAAAAH//4AAAAD//+AAAAD///AAAAB///wAAAA///8AAAA////AAAAf///wAAAP///8AAAH////AAAD////wAAB////8AAA////+AAAf////gAAP////4AAH////8AAB/////AAA/////wAAP////4AAH////8AAD/////AAB/////gAA/////4AAf////8AAH/////AAD/////gAA/////4AAf////8AAP/////AAH/////gAB/////wAA/////8AAf////+AAH/////AAD/////wAAf////4AAP////8AAD/////AAB/////gAAb////wAAF////8AAAf///+AAAH///+AAAB///+AAAAf///AAAAf///AAAAPv//gAAAHj//4AAADw//8AAMz4P/+AAP//z//gAN//9//wAAP/af/4AAH7wH/+AADd4B//AAB+8Af/wAA/cAP/8AAPvAH/+AAA/AD//gAAAAA//4AAAAAf/+AAAAAP//gAAAAH//wAAAAB//8AAAAA/7+AAAAAf8/AAAAAH+PgAAAAD/hgAAAAB/wAAAAAAf4AAAAAAP+AAAAAAH/AAAAAAB/gAAAAAA/4AAAAAAP8AAAAAAH+AAAAAAB/AAAAAAA/gAAAAAAPwAAAAAAD4AAAAAAAYA","h":93,"w":49},"cistothorus-palustris":{"bits":"AAAAAAAAAAAwAAAAAAAAAAAA4AAAAAAAAAAAB/gAAAAAAAAAAD/gAAAAAAAAAAD/wAAAAAAAAAAH/4AAAAAAAAAAH/4AAAAAAAAAAP/4AAAAAAAAAAP/4AAAAAAAAAAP/8AAAAAAAAAAf/8AAAAAAAAAAf/8AAAAAAAAAAf/8AAAAAAAAAAf/8AAAAAAAAAAf/8AAAAAAAAAAf/8AAAAAAAAAA//8AAAAAAAAAA//8AAAAAAAAAA//4AAAAAAAAAA//4AAAP+AAAAA//4AAB//wAAAA//wAAH//8AAAA//wAAf///AAAA//wAA////gAAA//gP/////wAAA//g//////8AAB//g//////+AAB//AB//////gAD//AAD//////wH//AAD//////+H//AAB//////////gAA//////////gAAf/////////gAAP/////////gAAP/////////gAAH/////////gAAH/////////gAAH/////////gAAH/////////gAAD/////////gAAD////////+AAAB/////////AAAB/////////AAAB/////////gAAB/////////gAAB/////////wAAB/////////wAAA/////////wAAA/////////4AAA/////////8AAAf////////+AAAf/////////AAAP/////////AAAH////////+AAAH////////AAAAD///////4AAAAB///////wAAAAA///////wAAAAAP//////gAAAAAH//////AAAAAAB/////+AAAAAAAf////8AAAAAAAP////4AAAAAAAH////wAAAAAAAP////wAAAAAAAP3///gAAAAAAAPjwAfgAAAAAAAPjwA+AAAAAAAAPBwB8AAAAAAAAPhwD4AAAAAAAAHjgHwAAAAAAAAHAAPAAAAAAAAADwA+AAAAAAAAABwB8AAAAAAAAAAAD4AAAAAAAAAAAHwAAAAAAAAAAAfAAAAAAAAAAAA+AAAAAAAAAAAH//wAAAAAAAAA///4AAAAAAAAB//+YAAAAAAAAB/wAAAAAAAAAAB/gAAAAAAAAAAB/AAAAAAAAAAAD+AAAAAAAAAAADuAAAAAAAAAAAH8AAAAAAAAAAAGeAAAAAAAAAAAEOAAAAAAAAAAAGMAAAAAAAAAAACHAAAAAAAAAAAADgAAAAAA==","h":93,"w":78},"cistothorus-stellaris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYAAAAAAAAAAAAAAfAAAAAAAAAAAAAAP4AAAAAAAAAAAAAD/8AAAAAAAAAAAAA//AAAAAAAAAAAAAP/8AAAAAAAAAAAAD//gAAAAAAAAAAAA//8AAA/8AAAAAAAP//gAAf/8AAAAAAB//4AAP//8AAAAAAf/+AAH///4AAAAAH//gAB////gAAAAB//4AP/////gAAAAf/8AH//////8AAAH//AB////////AAB//wAA////////AA//8AAAf////////f/+AAAD///////////gAAAGP/////////4AAAAwf////////+AAAADAf////////wAAAAcD////////+AAAABgH////////gAAAAMAH///////8AAAAAwA////////AAAAACAH///////4AAAAAQAf//////+AAAAADAD///////wAAAAAYAP//////8AAAAABAB///////gAAAAAIAH//////4AAAAABgA///////gAAAAAEAD//////+AAAAAAwAP//////4AAAAADAA///////gAAAAAYAD//////8AAAAABgAP//////wAAAAAGAA/////wAAAAAAAYAB////+AAAAAAABwAH////gAAAAAAAHAAP///4AAAAAAAAMAA///+AAAAAAAAA4AD///gAAAAAAAADgAH//4AAAAAAAAAHAAP/8AAAAAAAAAAPgAf/AAAAAAAAAAAPwP/4AAAAAAAAAAAP///AAAAAAAAAAIP5wHwAAAAAAAAABj4AA8AAAAAAAAAAF/4APAAAAAAAAAAAf/wDgAAAAAAAAAAD8fA4AAAAAAAAAAAfAYOAAAAAAAAAAABwADgAAAAAAAAAAAPAA8AAAAAAAAAAAA8APAAAAAAAAAAAADoH/4AAAAAAAAAAAPh/9gAAAAAAAAAAA8f5AAAAAAAAAAAAAf4AAAAAAAAAAAAAB+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAfAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAP4AAAAAAAAAAAAABngAAAAAAAAAAAAAHmAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":76,"w":93},"clangula-hyemalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAH/4AAAAAAAAAAAAB//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//4AAAAAAAAAAAA///gAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAP//+AAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAA////4AAAAAAAAAAP////gAAAAAAAAAB/j//8A//gAAAAAAIAH//h///8AAAAAAAA////////8AAAAAAH/////////AAAAAB//////////+AAAAf//////////+AAAH///////////wAAB/////////////gAf////////////8AD/////////////AAf////////////wAH////////////4AA////////////4AAH///////////4AAA///////////8AAAH///////////AAAAf//////////wAAAD//////////8AAAAf/////////+AAAAB//////////gAAAAH/////////wAAAAAf////////4AAAAAB////////4AAAAAAB///////wAAAAAAAA//////+AAAAAAAAAAH/8//AAAAAAAAAAAAAP8AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAP8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAP4AAAAAAAAAAAAAB/AAAAAAAAAAAAAAJ4AAAAAAAAAAAAABDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":52,"w":93},"coccothraustes-vespertinus":{"bits":"AAAAAAAAAH+AAAAAAAAAAAP/8AAAAAAAAAAP//wAAAAAAAAAP//+AAAAAAAAAH///gAAAAAAAAD///8AAAAAAAAB////wAAAAAAAAf///+AAAAAAAAP////4AAAAAAAH/////AAAAAAAB/////4AAAAAAA/////+AAAAAAAP/////wAAAAAAD/////8AAAAAAB/////9AAAAAAAf////4AAAAAAAP////wAAAAAAAD////8AAAAAAAB/////AAAAAAAA/////gAAAAAAAf////4AAAAAAAP////+AAAAAAAH/////gAAAAAAH/////4AAAAAAD/////+AAAAAAB//////gAAAAAA//////4AAAAAAf//////AAAAAAP//////wAAAAAD//////8AAAAAB///////AAAAAA///////wAAAAAf//////8AAAAAH///////AAAAAD///////wAAAAB///////4AAAAAf//////+AAAAAP///////gAAAAH///////4AAAAB///////8AAAAA////////AAAAAf///////gAAAAP///////4AAAAD///////8AAAAB////////AAAAA////////gAAAAP///////wAAAAD///////8AAAAB///////+AAAAA////////AAAAAP///////gAAAAD///////wAAAAB///////4AAAAAf//////+AAAAAH///////AAAAAD///////AAAAAA///////gAAAAAf//////wAAAAAH//////wAAAAAB///////gAAAAA////////AAAAAf///////wAAAAP///////+AAAAH//////+/AAAAB//////8nwAAAA/////wOf8AAAAf//////H+AAAAP//+H//x/gAAAD///A4D/BwAAAB9//gAB/4cAAAAe//wAB/+eAAAAPP/wAA/fgAAAADD/4AAP3wAAAAAB/8AAD/4AAAAAAf+AAA3+AAAAAAP/gAAO/AAAAAAH/wAABxwAAAAAB/8AAAA4AAAAAA/+AAAA8AAAAAAP/gAAAGAAAAAAH/wAAAAAAAAAAB/8AAAAAAAAAAA/+AAAAAAAAAAAf/gAAAAAAAAAAH/wAAAAAAAAAAD/4AAAAAAAAAAA/+AAAAAAAAAAAf/AAAAAAAAAAAH/wAAAAAAAAAAB/4AAAAAAAAAAA/8AAAAAAAAAAAPgAAAAAAAAAAADgAAAAAAAAAAAA","h":93,"w":80},"coccyzus-americanus":{"bits":"AAAAAAAAAAAAAAAAAAAAD9/wAAAAAAP//8AAAAAAP//+AAAAAAAf//AAAAAAAH//gAAAAAAH//gAAAAAAD//wAAAAAAD//wAAAAAAB//4AAAAAAB//4AAAAAAA//4AAAAAAA//4AAAAAAA//8AAAAAAAf/8AAAAAAAf/+AAAAAAA//+AAAAAAA///AAAAAAA///gAAAAAA///wAAAAAA///4AAAAAA///+AAAAAA////AAAAAA////AAAAAA////gAAAAA////wAAAAA////4AAAAA////4AAAAAf///8AAAAAf///8AAAAAf///+AAAAAP///+AAAAAH////AAAAAH////AAAAAD////gAAAAB////gAAAAA////wAAAAAf///wAAAAAP///4AAAAAP///4AAAAAf///4AAAAAf///8AAAAAf///8AAAAAf///8AAAAAf///8AAAAAB///8AAAAAA///8AAAAAAef/8AAAAAAAH/+AAAAAAAH/+AAAAAAAD/+AAAAAAAD/+AAAAAAAB//AAAAAAAA//gAAAAAAAf/gAAAAAAAP/wAAAAAAAH/4AAAAAAAH/4AAAAAAAH/8AAAAAAAD/MAAAAAAAD/gAAAAAAAD/gAAAAAAAB/wAAAAAAAB/wAAAAAAAB/wAAAAAAAA/4AAAAAAAA/4AAAAAAAA/8AAAAAAAAf8AAAAAAAAf8AAAAAAAAf+AAAAAAAAP+AAAAAAAAP+AAAAAAAAP/AAAAAAAAP/AAAAAAAAH/gAAAAAAAH/gAAAAAAAD/wAAAAAAAD/wAAAAAAAD/wAAAAAAAB/4AAAAAAAB/4AAAAAAAA/4AAAAAAAA/8AAAAAAAAf8AAAAAAAAP8AAAAAAAAP8AAAAAAAAH8AAAAAAAAD8AAAAAAAAB8AAAAAAAAAAAAAAAAAAAAA=","h":93,"w":60},"coccyzus-erythropthalmus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAP/4AAAAAAAAH///gAAAAAAH///8AAAAAAB////AAAAAAA///wAAAAAAAf//4AAAAAAAH//+AAAAAAAD///AAAAAAAA///wAAAAAAAP//4AAAAAAAH//+AAAAAAAD///gAAAAAAB///wAAAAAAA///8AAAAAAA////gAAAAAAf///4AAAAAAP///+AAAAAAH////gAAAAAD////4AAAAAB////+AAAAAA/////gAAAAAP////4AAAAAH////+AAAAAD/////gAAAAA/////4AAAAAf////8AAAAAH/////AAAAAD/////wAAAAA/////4AAAAAf////8AAAAAH/////AAAAAD////+wAAAAA/////YAAAAAf////8AAAAAH/////AAAAAD/////gAAAAA/////wAAAAAP////4AAAAAD////8AAAAAB/////AAAAAAf//j74AAAAAH//w7+AAAAAB//4d/gAAAAAf/+P/wAAAAAP//n/4AAAAAD////cAAAAAA////wAAAAAAP///4AAAAAAD///+AAAAAAB///+AAAAAAAf//8AAAAAAAP//+AAAAAAAD///AAAAAAAB///gAAAAAAA///wAAAAAAAP//4AAAAAAAH//4AAAAAAAD//8AAAAAAAA//8AAAAAAAAf/8AAAAAAAAHf/AAAAAAAABv/wAAAAAAAAD/4AAAAAAAAB/+AAAAAAAAAf/AAAAAAAAAP/wAAAAAAAAD/4AAAAAAAAB/+AAAAAAAAAf/gAAAAAAAAP/wAAAAAAAAD/8AAAAAAAAB/+AAAAAAAAAf/gAAAAAAAAP/wAAAAAAAAD/8AAAAAAAAB//AAAAAAAAAf/gAAAAAAAAH/4AAAAAAAAD/8AAAAAAAAA//AAAAAAAAAf/gAAAAAAAAH/4AAAAAAAAD/8AAAAAAAAA/+AAAAAAAAAP/AAAAAAAAAD/gAAAAAAAAA/wAAAAAAAAAP4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":68},"colaptes-auratus":{"bits":"AAAAAAAAH4AAAAAAAAAAAf/gAAAAAAAAAA//+P/4AAAAAAA/////4AAAAAAA/////gAAAAAAA////8AAAAAAAA////4AAAAAAAAf///wAAAAAAAAf///wAAAAAAAAP///wAAAAAAAAH///wAAAAAAAAD///wAAAAAAAAD///wAAAAAAAAB///4AAAAAAAAA///4AAAAAAAAAf//8AAAAAAAAAf//+AAAAAAAAAP//+AAAAAAAAAP///AAAAAAAAAP///gAAAAAAAAf///4AAAAAAAAf///8AAAAAAAA////+AAAAAAAA/////AAAAAAAA/////gAAAAAAA/////4AAAAAAA/////8AAAAAAA/////+AAAAAAA//////AAAAAAA//////gAAAAAAf/////wAAAAAAf/////4AAAAAAf/////8AAAAAAf/////8AAAAAAP/////+AAAAAAP//////AAAAAAP//////gAAAAAP//////gAAAAAP//////wAAAAAP//////4AAAAAP//////4AAAAAH//////8AAAAAH//////8AAAAAH//////8AAAAAD//////+AAAAAD//////+AAAAAB///////AAAAAB///////AAAAAB///////AAAAAA///////AAAAAAf//////gAAAAAf//////AAAAAAP//////AAAAAAH//////AAAAAAD//////AAAAAAD//////AAAAAAD/////+AAAAAAB/////+AAAAAAB//////j4AAAAB///////+AAAAA////////gAAAA////////8AAAA//////wP/AAAA////nfgAGgAAA///+AbAAAQAAA///+AMAAAAAAAf//+AGAAAAAAAd//+ABAAAAAAAJ//8AAAAAAAAAB//8AAAAAAAAAA8/8AAAAAAAAAA4f8AAAAAAAAAAAf8AAAAAAAAAAAP8AAAAAAAAAAAH8AAAAAAAAAAAH+AAAAAAAAAAAD/AAAAAAAAAAAD/AAAAAAAAAAAB/gAAAAAAAAAAA/gAAAAAAAAAAA/wAAAAAAAAAAAf4AAAAAAAAAAAP4AAAAAAAAAAAP8AAAAAAAAAAAH8AAAAAAAAAAAH8AAAAAAAAAAAD8AAAAAAAAAAAD8AAAAAAAAAAAB4AAAAAAAAAAAA8AAAAAAAAAAAAcAAAAAAAAAAAAMAAAAAAAAAAAAEAAAAAAAAAAAAAA==","h":93,"w":79},"colibri-thalassinus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/wAAAAAAAAAAAAAf/8AAAAAAAAAAAAAD/+B/8AAAAAAAAAAB////4AAAAAAAAAAA////gAAAAAAAAAAA///+AAAAAAAAAAAB///4AAAAAAAAAAAD///AAAAAAAAAAAAP//8AAAAAAAAAAAB///gAAAAAAAAAAAH//+AAAAAAAAAAAA///wAAAAAAAAAAAD//+AAAAAAAAAAAAf//wAAAAAAAAAAAD///AAAAAAAAAAAAf//4AAAAAAAAAAAD///gAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAP///gAAAAAAAAAAB///+AAAAAAAAAAAf///8AAAAAAAAAAD////wAAAAAAAAAAf////AAAAAAAAAAD////8AAAAAAAAAAf////4AAAAAAAAAD/////gAAAAAAAAAf////8AAAAAAAAAB/////wAAAAAAAAAP/////AAAAAAAAAB/////8AAAAAAAAAP/////gAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAD/////8AAAAAAAAAP/////wAAAAAAAAB/////+AAAAAAAAAH/////4AAAAAAAAAf/////AAAAAAAAAB/////8AAAAAAAAAH/////wAAAAAAAAAf////+AAAAAAAAAB/////4AAAAAAAAAH/////AAAAAAAAAAP////8AAAAAAAAAB/////gAAAAAAAAAf////+AAAAAAAAAD/////wAAAAAAAAAc/////AAAAAAAAAD+////4AAAAAAAAAfx////gAAAAAAAAB/sD//8AAAAAAAAAA/gP//wAAAAAAAAAD8A///AAAAAAAAAAAAD//8AAAAAAAAAAAAP//4AAAAAAAAAAAA///gAAAAAAAAAAAD///AAAAAAAAAAAAP//8AAAAAAAAAAAAf//wAAAAAAAAAAAB//+AAAAAAAAAAAAD//4AAAAAAAAAAAAH//gAAAAAAAAAAAA//8AAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAB3gAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":82,"w":93},"colinus-virginianus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAA//AAAAAAAAAAD//AAAAAAAAAAP//AAAAAAAAAA//+AAAAAAAAAD///AAAAAAAAAP///AAAAAAAAAf///AAAAAAAAB///+AAAAAAAAD///8AAAAAAAAH//+AAAAAAAAAf//4AAAAAAAAA///gAAAAAAAAB///AAAAAAAAAH//+AAAAAAAAAP//8AAAAAAAAA///4AAAAAAAAB///4AAAAAAAAH///wAAAAAAAAf///wAAAAAAAD////gAAAAAAAf////gAAAAAAH/////AAAAAAA//////AAAAAAH/////+AAAAAAf/////+AAAAAD//////8AAAAAP//////4AAAAA///////wAAAAD///////gAAAAP///////AAAAA////////AAAAD///////+AAAAP///////8AAAA////////4AAAD////////wAAAH////////gAAAf////////AAAB////////+AAAH////////4AAAf////////wAAA/////////gAAD/////////AAAH////////+AAAf////////8AAB/////////wAAD/////////gAAH/////////AAAf////////8AAA/////////4AAD/////////gAAH/////////AAAP////////8AAA/////////4AAB/////////gAAB////////+AAAH////////8AAAP////////wAAA/////////AAAB////////8AAAH////////wAAAP////////AAAAf///////8AAAB////////wAAAD///////+AAAAP///////4AAAA////////AAAAB///////4AAAAH//5////AAAAAf/8A///4AAAAA//gAP//gAAAAD/wAAA/+AAAAAP/gAAA/wAAAAAf+AAAAfgAAAAB/4AAAAfAAAAAD/gAAAA/AAAAAP+AAAAA+AAAAAfwAAAAA+AAAAA+AAAAA///gAAAAAAAAB///8AAAAAAAACB//8AAAAAAAAB///IAAAAAAAAD///wAAAAAAAAFn//8AAAAAAAAAD//4AAAAAAAAAB8AAAAAAAAAAAB+AAAAAAAAAAAAcAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":77},"columba-livia":{"bits":"AH8AAAAAAAAAAAAD/4AAAAAAAAAAAA//gAAAAAAAAAAAP/+AAAAAAAAAAAB//4AAAAAAAAAAAf//gAAAAAAAAAAD//8AAAAAAAAAAAf//wAAAAAAAAAAD//+AAAAAAAAAAA///4AAAAAAAAAAP///AAAAAAAAAAB///4AAAAAAAAAAf///AAAAAAAAAAH///8AAAAAAAAAA4f//gAAAAAAAAAGB//8AAAAAAAAAAAP//gAAAAAAAAAAD//+AAAAAAAAAAAf//wAAAAAAAAAAD///AAAAAAAAAAA///4AAAAAAAAAAH///gAAAAAAAAAB///+AAAAAAAAAAf///8AAAAAAAAAD////4AAAAAAAAAf////wAAAAAAAAH/////wAAAAAAAA//////gAAAAAAAH//////AAAAAAAB//////+AAAAAAAP//////8AAAAAAB///////wAAAAAAP///////AAAAAAB///////+AAAAAAP///////4AAAAAB////////gAAAAAP///////+AAAAAB////////4AAAAAP////////gAAAAB////////+AAAAAP////////4AAAAB/////////gAAAAP////////+AAAAB/////////4AAAAP/////////gAAAA/////////+AAAAH/////////4AAAA//////////gAAAD/////////+AAAAf/////////4AAAB//////////AAAAH/////////8AAAA//////////gAAAD/////////+AAAAP/////////wAAAA/////////+AAAAD/////////4AAAAH/////////wAAAAf/////////AAAAB/////////8AAAAD/////////4AAAAP/////////gAAAAf////////+AAAAA/////////4AAAAB/////////wAAAAD/////////AAAAAD////////8AAAAf/////////wAAAP//////////AAAH//////////8AAB///////////wAAP/Hz/AJ///H/AAB/wD/wAH//8H4AAH8Af8AAf//gHAAA7gP4AAB//+AAAAHcH/gAAD//wAAAAxv//gAAP//AAAADD//8AAAf/8AAAAA/8EAAAB//gAAAAG/gAAAAH/+AAAAA34AAAAA//4AAAAB/AAAAAD//AAAAAe4AAAAAP/8AAAAD3AAAAAA//wAAAAc4AAAAAD/+AAAADjgAAAAAf/4AAAAMAAAAAAB//gAAAAAAAAAAAH/8AAAAAAAAAAAAf/wAAAAAAAAAAAA//AAAAAAAAAAAAD/4AAAAAAAAAAAAH/AAAAAAAAAAAAAPgA==","h":93,"w":87},"columbina-inca":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+AAAAAAAAAAAA//gAAAAAAAAAAD//gAAAAAAAAAAP//gAAAAAAAAAAf//gAAAAAAAAAB///gAAAAAAAAAD///AAAAAAAAAAH///AAAAAAAAAAP//+AAAAAAAAAAf//+AAAAAAAAAB///8AAAAAAAAAH///8AAAAAAAAAf///8AAAAAAAAB////8AAAAAAAADj///8AAAAAAAAED////AAAAAAAAAH////gAAAAAAAAP////4AAAAAAAAf////8AAAAAAAB/////+AAAAAAAD//////AAAAAAAP//////AAAAAAAf//////gAAAAAA///////gAAAAAD///////gAAAAAH///////gAAAAAP///////gAAAAAf///////gAAAAA////////gAAAAB////////gAAAAD////////AAAAAH////////AAAAAP////////AAAAAf////////AAAAA/////////AAAAB/////////AAAAD////////+AAAAH////////+AAAAH////////+AAAAP////////8AAAAP////////8AAAAf////////8AAAA/////////4AAAA/////////4AAAA/////////wAAAB/////////wAAAB/////////gAAAB/////////AAAAB/////////gAAAB/////////gAAAB/////////gAAAB/////////gAAAA/////////gAAAAf////////gAAAAP////////gAAAAP////////gAAAAH////////AAAA7////////8AAAAf/+f/////4AAAA/vv//////wAAAB+B//4///gAAAAH8H/wAH//AAAAB34f/wAH/+AAAAB/w/ggAH/+AAAAAH9+AAAH/8AAAAAOP+AAAH/4AAAAAOB8AAAD/4AAAAAMD/gAAH/wAAAAAAD9gAAH/wAAAAAADgAAAP/wAAAAAAAAAAAP/gAAAAAAAAAAAP/gAAAAAAAAAAAf/AAAAAAAAAAAAf/AAAAAAAAAAAAf/AAAAAAAAAAAA/+AAAAAAAAAAAA/+AAAAAAAAAAAA/8AAAAAAAAAAAB/8AAAAAAAAAAAB/4AAAAAAAAAAAB/4AAAAAAAAAAAB/wAAAAAAAAAAAD/wAAAAAAAAAAAD/gAAAAAAAAAAAD/gAAAAAAAAAAAD/AAAAAAAAAAAAD+AAAAAAAAAAAAD8AAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":83},"columbina-passerina":{"bits":"AD/4AAAAAAAAAAAAB//wAAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAB///4AAAAAAAAAAAP///gAAAAAAAAAAB///8AAAAAAAAAAAf///wAAAAAAAAAAH////AAAAAAAAAAD////4AAAAAAAAAA/////gAAAAAAAAAH/////AAAAAAAAAA8P///+AAAAAAAAAEA/////gAAAAAAAAAD/////wAAAAAAAAAf/////gAAAAAAAAH//////AAAAAAAAA//////+AAAAAAAAP//////8AAAAAAAB///////4AAAAAAAP///////gAAAAAAD///////+AAAAAAAf///////8AAAAAAD////////wAAAAAAf////////AAAAAAH////////8AAAAAA/////////wAAAAAH/////////AAAAAA/////////8AAAAAH/////////wAAAAA//////////AAAAAD/////////8AAAAAf/////////wAAAAD//////////AAAAAf/////////8AAAAD//////////wAAAAP//////////AAAAB//////////8AAAAH//////////gAAAA//////////+AAAAD//////////wAAAAf//////////AAAAB//////////8AAAAP//////////wAAAA//////////+AAAAD//////////wAAAAP//////////AAAAA//////////8AAAAH//////////4AAAAP//////////gAAAA//////////+AAAAD//////////4AAAAP//////////gAAAA//////////+AAAAB//////////4AAAAH//////////gAAAAP////////84AAAAAf////////gAAAAAA////////4AAAAAAB////////AAAAAAAP////H//8AAAAAAH///gAf//wAAAAAD///gAB//+AAAAAB///8AAD//4AAAAD///9gAAH//gAAAB////AAAAP/+AAAAP/8D8AAAA//wAAABP8AAAAAAD//AAAAD4AAAAAAAf/8AAAAQAAAAAAAB//gAAAAAAAAAAAAH/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAB//AAAAAAAAAAAAAH/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/AAAAAAAAAAAAAAP4=","h":83,"w":93},"contopus-cooperi":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+AAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAD///gAAAAAAAAAAA////AAAAAAAAAAAP///4AAAAAAAAAAH////gAAAAAAAAAH////+AAAAAAAAAH/////4AAAAAAAAB//////gAAAAAAAAP/////8AAAAAAAAAD/////wAAAAAAAAAH////+AAAAAAAAAA/////4AAAAAAAAAH/////gAAAAAAAAAf/////AAAAAAAAAD/////8AAAAAAAAAP/////4AAAAAAAAB//////gAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAA///////+AAAAAAAH///////4AAAAAAA////////gAAAAAAH///////+AAAAAAAf///////4AAAAAAD////////gAAAAAAf///////+AAAAAAD////////wAAAAAAP////////AAAAAAB////////8AAAAAAH////////gAAAAAA////////+AAAAAAD////////4AAAAAAf////////AAAAAAB////////8AAAAAAH////////gAAAAAAf///////+AAAAAAD////////wAAAAAAP///////+AAAAAAA////////4AAAAAAD////////AAAAAAAP///////8AAAAAAAf///////wAAAAAAB////////AAAAAAAD///////8AAAAAAA////////wAAAAAAP////////AAAAAAB////////8AAAAAAPv///////wAAAAAB8////f//+AAAAAAPr//Hx///4AAAAAA/P48AD///gAAAAAD3fDwAH//cAAAAAAHj/OAAf/4gAAAAAAAPwwAAf/gAAAAAAAA8uAAB/+AAAAAAAAB8AAAH/4AAAAAAAAGAAAAf/gAAAAAAAAAAAAD/+AAAAAAAAAAAAAP/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAf/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAA3gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":85,"w":93},"contopus-sordidulus":{"bits":"AAAAAAAHgAAAAAAAAH/4AAAAAAAB//4AAAAAAAf//4AAAAAAD///gAAAAAAf///AAAAAAD////AAAAAAP////AAAAAB////+AAAAAP////8AAAAA/////wAAAAH////wAAAAAf///8AAAAAD////wAAAAAf////AAAAAH////4AAAAA/////gAAAAH////8AAAAA/////wAAAAH/////AAAAA/////8AAAAH/////wAAAA//////AAAAD/////+AAAAf/////4AAAD//////gAAAP/////8AAAB//////wAAAP//////AAAA//////8AAAH//////wAAA//////+AAAD//////4AAAf//////gAAB//////8AAAP//////wAAA///////AAAH//////4AAAf//////gAAB//////8AAAP//////wAAA//////+AAAD//////wAAAf/////+AAAB//////wAAAH/////+AAAAP/////wAAAB/////+AAAAH/////8AAAAf/////4AAAD//////gAAAf/////+AAAB//////4AAAP////z/AAAA+///+PwAAAD3///4eAAAAef///AAAAABx///4AAAAAGH/8/AAAAAAYf/j4AAAAAAB/8CAAAAAAAH/gAAAAAAAA/+AAAAAAAAD/4AAAAAAAAf/gAAAAAAAB/+AAAAAAAAP/wAAAAAAAA//AAAAAAAAD/8AAAAAAAAf/gAAAAAAAB/+AAAAAAAAP/4AAAAAAAA//AAAAAAAAD/8AAAAAAAAf/wAAAAAAAB//AAAAAAAAH/4AAAAAAAA//gAAAAAAAD/+AAAAAAAAP/wAAAAAAAB//AAAAAAAAH/8AAAAAAAA//wAAAAAAAD/+AAAAAAAAP/4AAAAAAAA//gAAAAAAAH/+AAAAAAAAf/wAAAAAAAB//AAAAAAAAP/4AAAAAAAA/vgAAAAAAAD48AAAAAAAAAAgAAAAAAAA","h":93,"w":64},"contopus-virens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAA///AAAAAAAAAAAAP//8AAAAAAAAAAAH///wAAAAAAAAAAH////AAAAAAAAAAH////8AAAAAAAAAB/////gAAAAAAAAAD////+AAAAAAAAAAD////4AAAAAAAAAAd////AAAAAAAAAADn///8AAAAAAAAAAO////wAAAAAAAAAA/////AAAAAAAAAAH////+AAAAAAAAAA/////8AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAf/////8AAAAAAAAD//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAAX//////8AAAAAAAC///////wAAAAAAAb///////AAAAAAADH//////8AAAAAAAMf//////4AAAAAABj///////AAAAAAAGP//////8AAAAAAAw///////wAAAAAADH//////+AAAAAAAMf//////4AAAAAAAj///////gAAAAAAGf//////8AAAAAAAf///////wAAAAAAA////////AAAAAAAD///////4AAAAAAAP///////gAAAAAAA///////8AAAAAAAB///////gAAAAAAAH//////+AAAAAAAAP//////4AAAAAAAA///////gAAAAAAAB//////+AAAAAAAAZ//////4AAAAAAAGf//////gAAAAAAB///////+AAAAAAAf///g7//wAAAAAAD/APgBz//AAAAAAA4cAAAHv/8AAAAAAGDwAAAH/+gAAAAAAg8AAAAP/4AAAAAAMHAAAAAP/gAAAAABAAAAAAA/+AAAAAAQAAAAAAD/4AAAAACAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"coragyps-atratus":{"bits":"AAAAAAAAAAP4AAAAAAAAAAAD/4AAAAAAAAAAAP/wAAAAAAAAAAD//gAAAAAAAAAA///AAAAAAAAAAH///AAAAAAAAAA///+AAAAAAAAAD///+AAAAAAAAAf///+AAAAAAAAB////4AAAAAAAAH////wAAAAAAAA/////AAAAAAAA////D8AAAAAAAf///wBwAAAAAAP////gDAAAAAAD////+AAAAAAAA/////4AAAAAAAP/////gAAAAAAB/////+AAAAAAAf/////4AAAAAAD//////gAAAAAA//////+AAAAAAH//////wAAAAAA///////AAAAAAH//////wAAAAAB//////+AAAAAAP//////wAAAAAB//////+AAAAAAP//////4AAAAAA///////gAAAAAH///////AAAAAA///////8AAAAAH///////wAAAAA////////AAAAAH///////8AAAAAf///////wAAAAD///////+AAAAAP///////4AAAAB////////gAAAAP///////8AAAAB////////wAAAAH///////+AAAAA////////wAAAAH///////+AAAAAf///////wAAAAB///////+AAAAAP///////wAAAAA///////+AAAAAD///////wAAAAAH///////AAAAAA///////4AAAAAD///////AAAAAAf//////8AAAAAB///////gAAAAAP//////+AAAAAA///////wAAAAAH//////+AAAAAAf//////4AAAAAB///////AAAAAAP//////4AAAAAA///////AAAAAAA//////4AAAAAAD//////AAAAAAAP/////4AAAAAAA//////gAAAAAAH/////8AAAAAAAf/////wAAAAAAB////v/AAAAAAAH///8f4AAAAAAAf///B/gAAAAAAA///8D/AAAAAAAB///gP8AAAAAAAP//+A/wAAAAAAB///wD/8AAAAAAP//+AP/4AAAAAB///wH//4AAAAAP//+Af//wAAAAB///wDw//gAAAAH///AOB//wAAAA///8A4///wAAAH///wBn///gAAAfz/+AAeP4QAAAD+f/4ABQH4AAAAPh//gAGAHwAAAA8H/+AAAAPAAAADg//wAAAAEAAAAID//AAAAAAAAAAAP/8AAAAAAAAAAA//gAAAAAAAAAAD/+AAAAAAAAAAAP/wAAAAAAAAAAA/+AAAAAAAAAAADxwAAAAAAAAAAA","h":93,"w":82},"corthylio-calendula":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAD8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAP/8AAAAAAAAAAAAD//wAAAAAAAAAAAA//8AAAAAAAAAAAAf//gAAAAAAAAAAAH//4AAAAAAAAAAAB//+AAAAAAAAAAAAf//AAAAAAAAAAAAH//wAAAAAAAAAAB9//4AAAAAAAAAAB///+AAAAAAAAAAB////AAAAAAAAAAP////wAAAAAAAAAH////4AAAAAAAAf/////+AAAAAAAA///////AAAAAA/////////4AAAAA/////////+AAAAAf////////+wAAAAP/////////sAAAAD/////////5AAAAA///////////+AAAP///////////wAAB///////////+AAAf///////////gAAH///////////wAAA///////////4AAAH//////////8AAAA///////////AAAAP//////////wAAAB//////////8AAAAP//////////AAAAB//////////wAAAAP/////////+AAAAB//////////wAAAAf/////////8AAAAD//////////gAAAA//////////8AAAAP//////////AAAAB7/////////4AAAAIP////////+AAAAAA/////////wAAAAAB////////8AAAAAAH////////gAAAAAAf///////4AAAAAAB////////AAAAAAAH///////gAAAAAAA///////8AAAAAAAD//////+AAAAAAAAP//////wAAAAAAAA//////+AAAAAAAAB//////wAAAAAAAAD/////4AAAAAAAAAH////eAAAAAAAAAAP///jgAAAAAAAAAA///g4AAAAAAAAAAP/wAOAAAAAAAAAAH4eADgAAAAAAAAAB+AAA8AAAAAAAAAAPwAAHAAAAAAAAAABcAABzwAAAAAAAAAPwAAf/AAAAAAAAAB+AAH/oAAAAAAAAAH8AB+AAAAAAAAAAAbAB/AAAAAAAAAAADwAfwAAAAAAAAAAAOAH+AAAAAAAAAAAAAA3gAAAAAAAAAAAAAG8AAAAAAAAAAAAAAPgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAN4AAAAAAAAAAAAABgAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAA","h":80,"w":93},"corvus-brachyrhynchos":{"bits":"AAAfwAAAAAAAAAAAAAP/wAAAAAAAAAAAB///gAAAAAAAAAAH///+AAAAAAAAAAD////4AAAAAAAAAB/////gAAAAAAAAAf////+AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAAH////+AAAAAAAAAAB////wAAAAAAAAAAH////AAAAAAAAAAAP///8AAAAAAAAAAA////wAAAAAAAAAAH////gAAAAAAAAAA/////AAAAAAAAAAH////+AAAAAAAAAA/////8AAAAAAAAAH/////wAAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAf///////wAAAAAAB////////gAAAAAAP///////+AAAAAAA////////4AAAAAAD////////gAAAAAAf///////+AAAAAAB////////4AAAAAAH////////gAAAAAAf///////+AAAAAAB////////4AAAAAAP////////gAAAAAA////////8AAAAAAD////////wAAAAAAP///////+AAAAAAB////////4AAAAAAH////////AAAAAAAf///////4AAAAAAB////////AAAAAAAH///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAH///////AAAAAAAAf//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAH4/4H///wAAAAAAAfD/Af///AAAAAAAHwP4B///8AAAAAAB4A/AP///wAAAAAAeAH4A////AAAAAAHgA8AD//v8AAAAAB4AHAAf/+fwAAAAAeAB4AB//w/AAAAAHjweAAP//B4AAAD3/+DgAA//8HAAAA///A4AAD//wAAAAH/wAPAAAf/+AAAAD/8ABw4AB//4AAAA/+AAe/gAH//gAAAGngP//gAA//+AAAAh4D//8AAD//wAAAAMA//AAAAP//AAAAAgP/wAAAA//8AAAAAD48AAAAB//gAAAAAwPAAAAAH/+AAAAACDgAAAAAf/4AAAAAAQAAAAAB//AAAAAACAAAAAAB/wAAAAAAQAAAAAAB8A","h":82,"w":93},"corvus-corax":{"bits":"AAA/4AAAAAAAAAAAP/8AAAAAAAAAD///4AAAAAAAAB////wAAAAAAAAf////wAAAAAAAD/////gAAAAAAAf/////AAAAAAAD/////+AAAAAAAP/////8AAAAAAAAf////wAAAAAAAAH////gAAAAAAAAP////AAAAAAAAAf///+AAAAAAAAA////8AAAAAAAAD////4AAAAAAAAP////4AAAAAAAA/////wAAAAAAAD/////wAAAAAAAf/////gAAAAAAB//////gAAAAAAH//////AAAAAAAf/////+AAAAAAB//////8AAAAAAH//////4AAAAAAf//////wAAAAAB///////AAAAAAH//////+AAAAAAP//////8AAAAAA///////wAAAAAB///////gAAAAAH///////AAAAAAP//////8AAAAAAf//////4AAAAAB///////gAAAAAH///////AAAAAAP//////8AAAAAA///////4AAAAAB///////wAAAAAD///////gAAAAAH///////AAAAAAf//////8AAAAAA///////4AAAAAB///////gAAAAAD///////AAAAAAH//////8AAAAAAf//////4AAAAAA///////gAAAAAB///////AAAAAAH//////8AAAAAAP//////wAAAAAA///////gAAAAAD//////+AAAAAAH//////4AAAAAAf//////AAAAAAA//////4AAAAAAB//////AAAAAAAD/////+AAAAAAAH/////4AAAAAAAc/////wAAAAAAAB/////gAAAAAAAH////+AAAAAAAA/+///8AAAAAAAP/4///wAAAAAAD//A///gAAAAAA//4D//+AAAAAAH/yAP//8AAAAAB//gAf//4AAAAAf/+AB///gAAAAB//4AH///AAAAAP//wAP//+AAAAA/4PAA///8AAAAB/gcAD///wAAAAB+DgAH/+/gAAAAD+gAAf/5+AAAAAH+AAB//z8AAAAAfwAAD//H4AAAAAAAAAP/8HgAAAAAAAAAf/4OAAAAAAAAAB//gcAAAAAAAAAH/+AwAAAAAAAAAP/8AAAAAAAAAAA//wAAAAAAAAAAB//AAAAAAAAAAAD/+AAAAAAAAAAAH/4AAAAAAAAAAAf/gAAAAAAAAAAA//AAAAAAAAAAAB/8AAAAAAAAAAAD/wAAAAAAAAAAAH/AAAAAAAAAAAAP8AAAAAAAAAAAAPwAAAAAAAAAAAAfAA","h":93,"w":82},"corvus-cryptoleucus":{"bits":"AAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAD/gAAAAAAAAAAAAD//AAAAAAAAAAAA///4AAAAAAAAAAB////AAAAAAAAAAB////4AAAAAAAAAB/////AAAAAAAAAA/////4AAAAAAAAAP/////AAAAAAAAAH/////4AAAAAAAAAA////+AAAAAAAAAAA////wAAAAAAAAAAH///+AAAAAAAAAAA////gAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAf///+AAAAAAAAAAH////4AAAAAAAAAB/////gAAAAAAAAAf////+AAAAAAAAAP/////4AAAAAAAAB//////AAAAAAAAAf/////8AAAAAAAAH//////gAAAAAAAB//////8AAAAAAAAf//////gAAAAAAAH//////+AAAAAAAB///////wAAAAAAAf//////+AAAAAAAH///////wAAAAAAA///////+AAAAAAAP///////gAAAAAAD///////8AAAAAAAf///////gAAAAAAH///////8AAAAAAA////////gAAAAAAP///////8AAAAAAB////////gAAAAAAf///////8AAAAAAD////////gAAAAAA////////8AAAAAAH////////gAAAAAA////////4AAAAAAH////////AAAAAAB////////wAAAAAAP///////+AAAAAAB////////wAAAAAAf///////+AAAAAAD////////gAAAAAAf///////8AAAAAAD////////gAAAAAAf///////4AAAAAAD///////+AAAAAAAf///////wAAAAAAD///////4AAAAAAAf//////+AAAAAAAB///////wAAAAAAAP//////+AAAAAAAD///////wAAAAAAAf//////8AAAAAAAD///////gAAAAAAAf//////4AAAAAAAD///////AAAAAAAAf//P///4AAAAAAAD//Af///gAAAAAAA//wD///4AAAAAAAPv8A////AAAAAAAD5+AH///4AAAAAAA4fgB///+AAAAAAAcHwAP///wAAAAAAPB4AD//v8AAAAAAHg8AAf/5/AAAAAABwOAAH//HwAAAAAA4HgAA//48AAAAAAeDwAAP/+DAAAAAAPA4AAB//wAAAAAAH/+AAAf/8AAAAAA///AAAD//gAAAAAP+HgAAAf/8AAAAAH/B4AAAH//AAAAAH/x/YAAA//4AAAABv///wAAP/+AAAAAf3//8AAB//wAAAAD//wJAAAP/8AAAAAb/4AAAAD//gAAAAHf8AAAAAf/4AAAAA/cAAAAAD//AAAAADOAAAAAAP/wAAAAAjAAAAAAA/8AAAAAA4AAAAAAB/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":92},"corvus-ossifragus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAD//AAAAAAAAAAAAB//8AAAAAAAAAAAAf//4AAAAAAAAAAAP///8AAAAAAAAAAD////8AAAAAAAAAA/////4AAAAAAAAAP/////wAAAAAAAAB//////AAAAAAAAAf/////8AAAAAAAAH//////gAAAAAAAA//////EAAAAAAAAP////gAAAAAAAAAD////8AAAAAAAAAD/////AAAAAAAAAB/////wAAAAAAAAAf////+AAAAAAAAAP/////gAAAAAAAAD/////8AAAAAAAAA//////gAAAAAAAAP/////8AAAAAAAAD//////wAAAAAAAA//////+AAAAAAAAP//////wAAAAAAAD//////+AAAAAAAA///////wAAAAAAAP//////+AAAAAAAD///////wAAAAAAA///////+AAAAAAAH///////wAAAAAAB///////8AAAAAAAf///////gAAAAAAH///////4AAAAAAB////////AAAAAAAf///////wAAAAAAH///////+AAAAAAB////////wAAAAAAf///////+AAAAAAH////////gAAAAAA////////8AAAAAAP////////gAAAAAB////////4AAAAAAf////////AAAAAAH////////wAAAAAA////////8AAAAAAP////////AAAAAAD////////wAAAAAAf///////+AAAAAAH////////gAAAAAA////////8AAAAAAH////////AAAAAAA////////wAAAAAAD///////8AAAAAAA////////AAAAAAAP///////wAAAAAAB///////8AAAAAAAf///////AAAAAAAH///////wAAAAAAA///////+AAAAAAAP///////AAAAAAAD///////gAAAAAAA//////v8AAAAAAAP///5/5/AAAAAAAD///+H/H8AAAAAAA////A/wf4AAAAAAP///4H+AfgAAAAAB///+AfwA/AAAAAAP3//wAfgB+AAAAAD9//8AA+AD4AAAAA+f//gAD4P/wAAAAHj//4AAPz//4AAAB4//+AAA/X//gAAAOP//wAAb+Af8AAABh//8AAP//D+gAAAAf//AAB//+P0AAAAH//4AALr/x+AAAAB//+AAAAP2PwAAAAP//gAAAB+g+AAAAB//4AAAAHwfwAAAAf/+AAAAA/BmAAAAD//gAAAAH4BwAAAAf/wAAAAB/AcAAAAH/8AAAAAGYAAAAAA//AAAAAAHAAAAAAD8AAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":89,"w":93},"coturnicops-noveboracensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//wAAAAAAAA//gD///AAAAAAAB///5///8AAAAAAB////////wAAAAAA////////+AAAAAAf////////4AAAAAP/////////wAAAAH//////////AAAAD//////////+AAAA///////////4AAAf///////////gAAH//////////h8AAD//////////wAAAA//////////8AAAAP//////////AAAAD//////////wAAAA//////////8AAAAP//////////gAAAD//////////8AAAB///////////gAAH///////////4AAB////////////AAAP///////////4AAB////////////AAAP///////////wAAA///////////+AAAD///////////gAAAP//////////4AAAA//////////+AAAAD//////////gAAAAG/////////4AAAAAf////////+AAAAAD/////////gAAAAA/////////4AAAAAP////////8AAAAAD/////////AAAAAAf////////wAAAAAD////////8AAAAAAH////////AAAAAAAH///////wAAAAAAAD//////4AAAAAAAAA/////8YAAAAAAAAB//////gAAAAAAAAD/////gAAAAAAAAAD/////wAAAAAAAAAP/////gAAAAAAAAB+AcPB8AAAAAAAAAH4CA8AAAAAAAAAAAPwABwAAAAAAAAAAA/AACAAAAAAAAAAAB+AAQAAAAAAAAAAAD8HgAAAAAAAAAAAD//8AAAAAAAAAAAAf/8AAAAAAAAAAAAAB//gAAAAAAAAAAAAHf/gAAAAAAAAAAAAeD+AAAAAAAAAAAAB4AAAAAAAAAAAAAAHgAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":67,"w":93},"crotophaga-sulcirostris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAAAAAAAAAAH/8AAAAAAAAAAAAH//4AAAAAAAAAAAH///gAAAAAAAAAAB///+AAAAAAAAAAA////4AAAAAAAAAAP////gAAAAAAAAAB////+AAAAAAAAAAAf///wAAAAAAAAAAAf///AAAAAAAAAAAD////AAAAAAAAAAAf////wAAAAAAAAAB/////gAAAAAAAAAH/////AAAAAAAAAA/////+AAAAAAAAAD/////8AAAAAAAAAf/////wAAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAf//////wAAAAAAAB///////gAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAA///////+AAAAAAAH///////4AAAAAAA////////wAAAAAAD///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////wAAAAAAB////////AAAAAAAH///////4AAAAAAAf///////AAAAAAAB///////8AAAAAAAD///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAH//////+AAAAAAAAP//////4AAAAAAAAf/////fgAAAAAAAA/////8+AAAAAAAAB/////wwAAAAAAAAD////+AAAAAAAAAAH/8//4AAAAAAAAAAP8A//gAAAAAAAAAB/AB/8AAAAAAAAAA/4AH/wAAAAAAAAAfeAA//AAAAAAAAAP/gAD/4AAAAAAAAH/+AAf/gAAAAAAAB+fwAB/+AAAAAAAAfj6AAP/wAAAAAAAH48QAA//AAAAAAAB8PAAAH/4AAAAAAAPjwAAAf/gAAAAAAB48AAAD/+AAAAAAAFvAAAAP/wAAAAAAADwAAAB//AAAAAAB//4AAAH/8AAAAAAL//4AAA//gAAAAAH/w/AAAD/+AAAAAD/8AIAAAf/4AAAAA/PAAAAAB//AAAAAEDgAAAAAP/8AAAAAA4AAAAAA//gAAAAAGAAAAAAH/+AAAAAAwAAAAAAf/4AAAAAAAAAAAAB//AAAAAAAAAAAAAP/8AAAAAAAAAAAAA//gAAAAAAAAAAAAH/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAB//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAf/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAD8AAAAAAAAAAAAAAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":87,"w":93},"cyanocitta-cristata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAD//gAAAAAAB//8AAAAAAA//+AAAAAAA///gAAAAAAf//wAAAAAAP//wAAAAAAP//4AAAAAAP//8AAAAAAP///gAAAAAf///4AAAAAf///8AAAAA////8AAAAA////gAAAAB///4AAAAAB///wAAAAAD///wAAAAAD///wAAAAAP///gAAAAAf///gAAAAA////gAAAAB////wAAAAD////wAAAAH////wAAAAP////wAAAAf////wAAAAf////wAAAA/////wAAAB/////wAAAB/////wAAAD/////wAAAH/////wAAAH/////gAAAP/////gAAAf/////gAAAf/////AAAA//////AAAA/////+AAAB/////8AAAB/////8AAAD/////4AAAD/////wAAAH/////wAAAH/////gAAAH/////AAAAP////+AAAAP////+AAAAP////8AAAAP////4AAAAP////gAAAAP////gAAAAP////wAAAAf////wAAAA////84AAAB/////wAAAB+//8/4AAAD9//4/8AAADx//A/8AAAHh/8A+8AAAHD/8A/8AAAED/wA18AAAAD/gAf4AAAAH/AABwAAAAH/AAAAAAAAP+AAAAAAAAP+AAAAAAAAP+AAAAAAAAf8AAAAAAAAf8AAAAAAAAf8AAAAAAAA/8AAAAAAAA/4AAAAAAAA/4AAAAAAAB/4AAAAAAAB/4AAAAAAAB/wAAAAAAAD/wAAAAAAAD/wAAAAAAAD/gAAAAAAAH/gAAAAAAAH/gAAAAAAAH/AAAAAAAAH/AAAAAAAAP+AAAAAAAAP8AAAAAAAAP8AAAAAAAAP4AAAAAAAAPwAAAAAAAAPgAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":60},"cyanocitta-stelleri":{"bits":"AAAAAADAAAAAAAABgAAAAAAACwAAAAAAAB4AAAAAAAB8AAAAAAAC+AAAAAAAB/AAAAAAAA/gAAAAAACf4AAAAAAA/8AAAAAAA//AAAAAAAf/gAAAAAAP/4AAAAAAH/8AAAAAAB//AAAAAAAf/wAAAAAAH/8AAAAAAD/+AAAAAAD//gAAAAAB//+AAAAAB///wAAAAB///8AAAAA///4AAAAA//8AAAAAAf/+AAAAAAP/+AAAAAAP/+AAAAAAH//AAAAAAH//gAAAAAD//wAAAAAD//4AAAAAD//+AAAAAD///AAAAAD///gAAAAD///wAAAAD///4AAAAD///8AAAAB///+AAAAB////AAAAB////gAAAA////gAAAA////wAAAA////4AAAAf///8AAAAf///8AAAAP///+AAAAP///+AAAAP///+AAAAH////AAAAD////AAAAD////gAAAB////gAAAB////gAAAA////wAAAAf///wAAAAP///wAAAAP///4AAAAP///4AAAAH///4AAAAH///4AAAADv/98AAAADn/8+AAAABn/3eAAAAAH/h3gAAAAD/gf4AAAAD/w//AAAAB/w8Dz8AAB/44Af+AAA/8IA//AAA/8AB/+AAA/+AAsAAAAf/AAQAAAAf/AAAAAAAP/gAAAAAAP/wAAAAAAH/wAAAAAAH/4AAAAAAD/8AAAAAAD/8AAAAAAD/+AAAAAAB//AAAAAAB//AAAAAAA//gAAAAAAf/wAAAAAAf/wAAAAAAP/4AAAAAAP/4AAAAAAH/4AAAAAAD/4AAAAAAB/4AAAAAAA/4AAAAAAAP4AAAAAAAHgAAAAAAAAA==","h":93,"w":55},"cygnus-buccinator":{"bits":"AAfgAAAAAAAD/wAAAAAAAP/wAAAAAAA//wAAAAAAB//wAAAAAAD//gAAAAAAP//gAAAAAA///AAAAAAB///AAAAAAD//+AAAAAAH/H8AAAAAAfgH4AAAAAB+AP4AAAAADwAfwAAAAAfAA/gAAAAA8AB/AAAAABgAD+AAAAAAAAH8AAAAAAAAfwAAAAAAAA/gAAAAAAAD/AAAAAAAAP+AAAAAAAA/4AAAAAAAD/wAAAAAAAf/AAAAAAAB/+AAAAAAAf/4AAAAAAB//gAAAAAAP/+AAAAAAA//4AAAAAAD//gAAAAAAP///4AAAAA////+AAAAD/////AAAAH/////gAAAP/////wAAA//////4AAB//////4AAD//////8AAH//////8AAP//////8AAf//////8AA///////8AB///////4AB///////4AD///////4AH///////wAH///////wAP///////wAP///////wAP///////wAP///////wAP///////gAP///////gAP///////AAP///////AAf//////+AAf//////+AAf//////8AAf//////4AAf//////wAAP//////gAAP//////AAAH/////8AAAH/////4AAAP/////4AAAP/////wAAAOf////wAAA8f////gAAB4P////AAADwD/8D/AAADgA8AA/AAAHAB4AAAAAAOADwAAAAAAcAHgAAAAAA4AHAAAAAABwAMAAAAAADwAYAAAAAAPgBwAAAAAH+ADgAAAAD/+AHAAAAAf/8AeAAAAA//4B8AAAAAP/7/4AAAAAP///wAAAAAP/f/gAAAAAQE//gAAAAAAA//AAAAAAAB/8AAAAAAAH/4AAAAAAAMfwAAAAAAAAPAAAAAAAAAEAAAA=","h":93,"w":59},"cygnus-columbianus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf4AAAAAAAAAAAAAHDgAAAAAAAAAAAABgGAAAAAAAAAAAAAcAIAAAAAAAAAAAAH8BgAAAAAAAAAAAA/gGAAAAAAAAAAAAP4AQAAAAAAAAAAAB+ADAAAAAAAAAAAAPgAIAAAAAAAAAAAD8ABAAAAAAAAAAAAfj4MAAAAAAAAAAAH/3ggAAAAAAAAAAB/gcEAAAAAAAAAAAfwBwgAAAAAAAAAAH8AOGAAAAAAAAAAB+ABwwAAAAAAAAAAPAAOCAAAAAAAAAABwABwQAAAAAAAAAAAAAOCAAAAAAAAAAAAABwQAAAAAAAAAAAAAMGAAAAAAAAAAAAABgwAAAAAAAAAAAAAcGAAAAAAAAAAAAADAgAAAAAAAAAAAAA4EAAAAAAAAAAAAAGBgAAAAAAAAAAAABwIAAAAAAAAAAAAAcBAD//4AAAAAAAAHAYH///8AAAAAAABwCD////8AAAAAAAcAxz////4AAAAAAHAE4f////wAAAAABgB8D/////4AAAAAYAfgf/////4AAAADAD+f//////wAAAAwA/////////gAAAMAH/////////AAABAB/////////8AAAYAf/D///////wAACAD/gP///////AAAwAf4A///////8AAGAD8AB//////8AAAwAAAAB//////8AAGAAAcAH//////4AAwAAH/////////gAHAAAf////////+AA4AAA//////////AHgAAA1////////8AeAAAAH////////AD8AAAAf////x//gAP4AAAAP/n/g/8AAA//wAAAAA+Af4AAAD//4AAAAP//4AAAAH///gAAD//+AAAAAH/////4///AAAAAAD////////AAAAAAAA///////gAAAAAAAAP/////4AAAAAAAAAP////4AAAAAAAAAAf/2PAAAAAAAAAAAD/8B4AAAAAAAAAAAQ+APAAAAAAAAAAAADAB4AAAAAAAAAAAAAAOAAAAAAAAAAAAAABwAAAAAAAAAAAAAAOAAAAAAAAAAAAAABwAAAAAAAAAAAAAAfAAAAAAAAAAAAA//4AAAAAAAAAAAAD/+AAAAAAAAAAAAA//wAAAAAAAAAAAAf/4AAAAAAAAAAAAH//AAAAAAAAAAAAAT/wAAAAAAAAAAAAAf4AAAAAAAAAAAAAB8AAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":81,"w":93},"cygnus-olor":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/AAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAA///gAAAAAAAAAAAP//+AAAAAAAAAAAB///wAAAAAAAAAAAf//8AAAAAAAAAAAD///wAAAAAAAAAAAf///AAAAAAAAAAAD/+/8AAAAAAAAAAAf+A/wAAAAAAAAAAH/gB/AAAAAAAAAAA/8AH8AAAAAAAAAAH/gAPgAAAAAAAAAA/8AAcAAAAAAAAAAH/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/wAAAAAAAAf/wAAf/AAAAAAAD///wAB/4AAAAAAD////wAP/AAAAAAB/////wB/8AAAAAAf/////gH/gAAAAA///////A/+AAAAA///////8H/wAAAAf///////4f/AAAAP////////j/4AAAA////////+f/gAAAH////////5/8AAAA/////////v/wAAAH//////////+AAIAP//////////4AB4f///////////gAP////////////8AB7////////////wAP////////////+AA/////////////4AH5////////////AAf5///////////8AB8B///////////gAH4H//////////8AAPgH//////////gAAeAf///8H////+AAB8A//////////wAADwB/////////+AAAPAD/////////wAAA+Af////////8AAAD///////////gAAAP//////////8AAAA///////////AAAAD//////////4AAAAH/////////+AAAAAH/////////gAAAAAA////////wAAAAAAB8P/////4AAAAAAAPwAA//+AAAAAAAAA+AAH//8AAAAAAAAHwAA///gAAAAAAAAeAAH//gAAAAAAAAB4AA//wAAAAAAAAAPgAD/8AAAAAAAAAB8OOcHgAAAAAAAAAP//yAEAAAAAAAAAB//8AAAAAAAAAAAAD//gAAAAAAAAAAAAf/8AAAAAAAAAAAAB//wAAAAAAAAAAAAH//AAAAAAAAAAAAAf+AAAAAAAAAAAAAB/AAAAAAAAAAAAAADwAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":87,"w":93},"cynanthus-latirostris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAP//4AD/4AAAAAAAB////f//wAAAAAAAAB//////gAAAAAAAAAH////+AAAAAAAAAAB////4AAAAAAAAAAB////AAAAAAAAAAAD///8AAAAAAAAAAAP///gAAAAAAAAAAA///+AAAAAAAAAAAD///wAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAH///AAAAAAAAAAAA///8AAAAAAAAAAAH///wAAAAAAAAAAAf///AAAAAAAAAAAD///8AAAAAAAAAAAf///wAAAAAAAAAAD////gAAAAAAAAAAf///+AAAAAAAAAAD////8AAAAAAAAAAf////wAAAAAAAAAD/////AAAAAAAAAAf////8AAAAAAAAAD/////wAAAAAAAAAf/////AAAAAAAAAB/////8AAAAAAAAAP/////wAAAAAAAAB/////+AAAAAAAAAP/////4AAAAAAAAA//////gAAAAAAAAH/////8AAAAAAAAAf/////wAAAAAAAAD//////AAAAAAAAAP/////4AAAAAAAAB//////gAAAAAAAAH/////+AAAAAAAAAf/////wAAAAAAAAB//////AAAAAAAAAH/////4AAAAAAAAAf/////AAAAAAAAAB/////+AAAAAAAAAH/////4AAAAAAAAAP/////gAAAAAAAAA/////+AAAAAAAAAD/////4AAAAAAAAAf/////wAAAAAAAAHP/////AAAAAAAAA//////8AAAAAAAAD+/j///wAAAAAAAAH/gP//+AAAAAAAAAPcA///wAAAAAAAAA/AB//+AAAAAAAAABAAH//4AAAAAAAAAAAAP/vAAAAAAAAAAAAA/+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAD/AAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAH+AAAAAAAAAAAAAAfwAAAAAAAAAAAAAB/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAAfgAAAAAAAAAAAAAAsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"cypseloides-niger":{"bits":"AAB+AAAAP/wAAAf/8AAA//+AAB///AAH///gAP///gAP///wAB///wAA///wAA///wAD///4AP///4A////4A////8B////8D////+D////+H/////H/////H/////P/////P/////P/////P/////f/////f/////f////////////////////////////+/////+/////+/////+/////+/////8/////8/////4/////4/////4/////w/////w/////gf////gf////Af////Af///+Af////Af////Af////Af////gf////gf///7gf///7Af///yAf3//wAf3//8Af3//4AP3/+wAPz/8QAPz/+AAPz/+AAPz/+AAHz/+AAHz/+AAH3/+AAH3/+AAH//+AAD//+AAD//+AAD//+AAD//+AAB//+AAB///AAB+//AAD8//AAD8//AAH8//AAP8//AAP8+fAAfe8PgAcP8PgAYH4HgAAB4HgAAB4DgAABwDgAAAwBwAAAwBwAAAwBwAAAwBwAAAwAwAAAAAgAA=","h":93,"w":36},"dendrocygna-autumnalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/4AAAAAAAAAAAA//wAAAAAAAAAAAP//AAAAAAAAAAAD//8AAAAAAAAAAA///wAAAAAAAAAAH///AAAAAAAAAAB///4AAAAAAAAAAP///gAAAAAAAAAD///+AAAAAAAAAA////wAAAAAAAAAf///+AAAAAAAAAP////4AAAAAAAAH/////AAAAAAAAB/////4AAAAAAAAP8Af//AAAAAAAABgAD//8AAAAAAAAAAAP//gAAAAAAAAAAB//8AAAAAAAAAAAf//AAAAAAAAAAAD//8AAAAAAAAAAA///gAAAAAAAAAAP//4AAAAAAAAAAD//gAAAAAAAAAAA//4AAAAAAAAAAAP/+AAAAAAAAAAAD//wAAAAAAAAAAA//+AAAAAAAAAAAP//wAAAAAAAAAAD/////AAAAAAAAAf/////AAAAAAAAH/////+AAAAAAAA//////8AAAAAAAP//////4AAAAAAB///////wAAAAAAP///////AAAAAAB///////+AAAAAAP///////4AAAAAD////////gAAAAAf///////+AAAAAB////////8AAAAAP////////wAAAAB/////////gAAAAP////////+AAAAB/////////4AAAAH/////////gAAAA/////////+AAAAD/////////4AAAAf/////////gAAAB/////////+AAAAH/////////4AAAAf/////////gAAAB//////////AAAAH/////////8AAAAf/////////wAAAB//////////AAAAH/////////8AAAAP////////7gAAAA/////////0AAAAB/////////gAAAAH////////+AAAAAP////////8AAAAAf////////wAAAAA/////////AAAAAB////////4AAAAAH////////AAAAAD////////8AAAAA/////8D//gAAAAP/l/B8AH/8AAAAB/8j4AAAP/AAAAAJ/gfAAAAAAAAAAAHuB4AAAAAAAAAAA4APAAAAAAAAAAADAB4AAAAAAAAAAAcAOAAAAAAAAAAAAABwAAAAAAAAAAAAAeAAAAAAAAAAAAODwAAAAAAAAAAAB+fAAAAAAAAAAAAH/+AAAAAAAAAAAA//wAAAAAAAAAAAP/yAAAAAAAAAAAP/+AAAAAAAAAAAH//AAAAAAAAAAAA3/wAAAAAAAAAAAAH+AAAAAAAAAAAAAfgAAAAAAAAAAAADwAAAAAAAAAAAAA8AAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":87},"dendrocygna-bicolor":{"bits":"AAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAA///gAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAf///AAAAAAAAAAAD///8AAAAAAAAAAA////gAAAAAAAAAAP///+AAAAAAAAAAD////wAAAAAAAAAB/////AAAAAAAAAAf////4AAAAAAAAAP/3///AAAAAAAAAB/gH//4AAAAAAAAAPgA///gAAAAAAAABAAP//8AAAAAAAAAAAD///gAAAAAAAAAAAf//8AAAAAAAAAAAH///gAAAAAAAAAAD//8f/gAAAAAAAAAf/////wAAAAAAAAH//////4AAAAAAAB///////wAAAAAAAf///////gAAAAAAD////////AAAAAAA////////+AAAAAAH////////4AAAAAA/////////4AAAAAH/////////gAAAAA//////////AAAAAH/////////+AAAAA//////////4AAAAH//////////wAAAA///////////AAAAH//////////8AAAAf//////////wAAAD///////////wAAAf///////////gAAB///////////+AAAP///////////8AAA////////////wAAD///////////+AAAP///////////AAAA///////////+AAAB///////////4AAAD//////////+AAAAP//////////8AAAAf//////////wAAAB///////////gAAAD//////////8AAAAP//////////gAAAAf///////A/4AAAAA//////+AAAAAAAAB//////AAAAAAAAAB/////gAAAAAAAAAB////wAAAAAAAAAAA///gAAAAAAAAAAAH/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAHnwAAAAAAAAAAAAA88AAAAAAAAAAAAAHngAAAAAAAAAAAP/88AAAAAAAAAAAA//3gAAAAAAAAAAAP/+4AAAAAAAAAAAP//XAAAAAAAAAAAD//w4AAAAAAAAAAAf/8PAAAAAAAAAAAAA/B4AAAAAAAAAAAAPwPAAAAAAAAAAAAB/z8AAAAAAAAAAAAB//wAAAAAAAAAAAA///AAAAAAAAAAAB///AAAAAAAAAAAAf//wAAAAAAAAAAAAD/4AAAAAAAAAAAAAP8AAAAAAAAAAAAAA+AAAAAAAAAAAAAAPAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":86,"w":93},"dolichonyx-oryzivorus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//gAAAAAAAAAAAH//+AAAAAAAAAAAD///4AAAAAAAAAAB////AAAAAAAAAAAP///8AAAAAAAAAAA////wAAAAAAAAAAB///+AAAAAAAAAAAD///4AAAAAAAAAAAf///AAAAAAAAAAAD///8AAAAAAAAAAAP///wAAAAAAAAAAB////gAAAAAAB+AAP////gAAAAAA/wAA/////AAAAAA/8AAH////+AAAAAf//AA/////4AAAAP//8AP/////wAAAH///gB//////gAAD///8AP//////gAB////AB///////gA////AAP///////j////gAB////////////gAAP///////////gAAB///////////gAAAP//////////wAAAB//////////wAAAAH/////////sAAAAA/////////nAAAAAH////////5gAAAAAf////////4AAAAAD////////+AAAAAAf////////AAAAAAB////////wAAAAAAP////////AAAAAAA////////8AAAAAAD////////wAAAAAAP////////AAAAAAA////////8AAAAAAD////////gAAAAAAP///////wAAAAAAA////////AAAAAAAB/////w/8AAAAAAAH////+AfwAAAAAAAP////AAeAAAAAAAAP///wAAAAAAAAAAAH//8AAAAAAAAAAAA//+AAAAAAAAAAAAfAH4AAAAAAAAAAAfgAeAAAAAAAAAAAPwADwAAAAAAAAAAD8AA8AAAAAAAAAAAf8AOAAAAAAAAAAAHnwDwAAAAAAAAAAA8OA8AAAAAAAAAAAPgQOAAAAAAAAAAAB8GDwAAAAAAAAAAAH8A8AAAAAAAAAAAAfAPAAAAAAAAAAAADgD/gAAAAAAAAAAAcAf+AAAAAAAAAAAB8HhwAAAAAAAAAAADA8CAAAAAAAAAAAAAHwwAAAAAAAAAAAAA/wAAAAAAAAAAAAAH8AAAAAAAAAAAAAAOAAAAAAAAAAAAAABwAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"dryobates-nuttallii":{"bits":"AAAAD/AAAAAAAf/wAAAAAA//8AAAAAB///v/AAAD/////AAAH////8AAAH////AAAAP///4AAAAP///wAAAAP///gAAAAP///AAAAAP//+AAAAAP//8AAAAAP//8AAAAAP//4AAAAAP//wAAAAAf//wAAAAA///wAAAAB///4AAAAD///4AAAAH///8AAAAP///8AAAAP///8AAAAf///+AAAA////+AAAA////+AAAB////+AAAB////+AAAD////+AAAD////+AAAD////+AAAH////+AAAH////+AAAH////+AAAH////+AAAP////+AAAP////8AAAP////8AAAP////8AAAf////4AAAf////4AAAf////wAAAf////wAAA/////gAAA/////gAAA/////AAAB/////AAAB////+AAAB////+AAAB/////+AAB//////AAD//////AAD//////gAD////+BgAD////+BgAD////8AAAD////8AAAD////4AAAD///74AAAD///24AAAH///D6AAAH//+DcAAAH//+AAAAAP//+AAAAAP//8AAAAAP//8AAAAAd//4AAAAAf//4AAAAAb7/wAAAAA3x/wAAAAA3h/wAAAAAHB/4AAAAAGB/4AAAAAAB/4AAAAAAA/4AAAAAAA/4AAAAAAA/4AAAAAAA/4AAAAAAA/4AAAAAAA/4AAAAAAA/4AAAAAAA/4AAAAAAA/wAAAAAAB/gAAAAAAB/gAAAAAAB/gAAAAAAB/gAAAAAAD8AAAAAAADcAAAAAAADYAAAAAAAG4AAAAAAAAwAAAAAAAAwAAAAAAA==","h":93,"w":54},"dryobates-pubescens":{"bits":"AAAP+AAAAD//AAAA//+AAAH//8AAA///4Af////wB/////AD////8AB////4AA////gAD///+AAH///4AAP///gAAf//+AAA///4AAH///gAAf//+AAD///4AAf///gAD///+AAf///4AD////gAP////AB////8AH////wA/////AD////+Af////4B/////gH////+Af////4D/////gP////+A/////4H/////Af////8B/////wH////+Af////4B/////AP////8A/////wD////+AP////4A/////gH////8Af////0B/////+H/////4f////+x/////+H/////8f////8x////+DH////wAf////AB////8AH////gAf///8AD///9wAP///nAA///8PAD///gcAf//+AAB///wAAH//+AAAf//4AAD/v/gAAP8/+AAA/j/4AAD8H/wAADgP/AAAMA/8AAAAD/4AAAAP/gAAAA/+AAAAD/8AAAAP/wAAAA/+AAAAD/4AAAAP/gAAAA/+AAAAD/4AAAAH+AAAAA/wAAAAD/AAAAAO8AAAAA7gAAAADMAAAAAMwAAAAAjAAAAAAMAAAAAAgAAA","h":93,"w":40},"dryobates-scalaris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAf/wAAAAAAAf/8AAAAAAA///AAAAAB////wAAAAH////8AAAAB////+AAAAAD////gAAAAAH///wAAAAAD///8AAAAAAf//8AAAAAAH//+AAAAAAB///AAAAAAAf//gAAAAAAP//4AAAAAAH///AAAAAAH///wAAAAAD///8AAAAAB////gAAAAB////4AAAAA////+AAAAAf////AAAAAf////wAAAAP////8AAAAH/////AAAAD/////gAAAB/////4AAAA/////+AAAAf/////AAAAP/////gAAAD/////4AAAB/////8AAAA//////AAAAf/////gAAAH/////wAAAD/////8AAAA/////+AAAAf/////AAAAH/////wAAAD/////4AAAA/////+AAAAf/////AAAAH/////gAAAD/////4AAAA/////8AAAAf////+AAAA//////gAAA//////wAAA3/////4AAAAf////8AAAAH////+AAAAB/////gAAAA/////wAAAAP////4AAAAHf///8AAAABn///+AAAADx////AAAAA4f///wAAAAAA///4AAAAAAH//8AAAAAAD///AAAAAAA///gAAAAAAP//wAAAAAAH//8AAAAAAD//+AAAAAAB//7AAAAAAA///gAAAAAAf/nAAAAAAAP/xgAAAAAAH/8AAAAAAAD/+AAAAAAAB//AAAAAAAA//gAAAAAAAf/4AAAAAAAH/8AAAAAAAD/+AAAAAAAB//AAAAAAAA//gAAAAAAAP/wAAAAAAAD/4AAAAAAAA/8AAAAAAAAP3AAAAAAAADzgAAAAAAAAcwAAAAAAAAOYAAAAAAAAHGAAAAAAAABhAAAAAAAAAwAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":61},"dryobates-villosus":{"bits":"AAA/wAAAAAAAH/8AAAAAAA//8AAAAD/P//+AAAAP////+AAAAH////8AAAAD////8AAAAA////4AAAAAf///4AAAAAf///wAAAAAP///gAAAAAP//+AAAAAAf//8AAAAAAf//4AAAAAAf//wAAAAAA///gAAAAAB///gAAAAAD///gAAAAAH///gAAAAAP///gAAAAA////wAAAAB////wAAAAH////gAAAAP////gAAAAf////gAAAA/////gAAAB/////AAAAD/////AAAAH////+AAAAP////+AAAAf////8AAAA/////8AAAB/////4AAAD/////wAAAD/////wAAAH/////gAAAP/////AAAAf/////AAAAf////+AAAA/////+AAAA/////8AAAB/////8AAAB/////4AAAD/////wAAAD/////wAAAD/////gAAAD/////AAAAH/////AAAAH////+AAAAH////8AAAA/////4AAAD/////wAAAH/////wAAA//////AAAD/////+AAAH9////+AAAfz////8AAA/nv///8AAA//f///4AAA+GP///4AAA/8H///wAAAPgB///wAAAAAB///gAAAAAB///gAAAAAB///AAAAAAB//+AAAAAAD//+AAAAAAH//8AAAAAAP/3gAAAAAAf/ngAAAAAA//CAAAAAAB/+AAAAAAAD/8AAAAAAAH/4AAAAAAAP/4AAAAAAAf/wAAAAAAA//gAAAAAAB//AAAAAAAB/+AAAAAAAD/8AAAAAAAD/4AAAAAAAH/4AAAAAAAH/wAAAAAAAP/gAAAAAAAH/AAAAAAAAP+AAAAAAAADuAAAAAAAAH8AAAAAAAAHYAAAAAAAAOYAAAAAAAAMQAAAAAAAAcAAAAAAAAAYA=","h":93,"w":59},"dryocopus-pileatus":{"bits":"AAAAAAAAH/gAAAAAAAAAf/+AAAAAAAAA///4AAAAAD//////8AAAAD//////+AAAAA//////+AAAAAD/////+AAAAAAH////+AAAAAAAf///+AAAAAAAH///+AAAAAAAA///+AAAAAAAAH//8AAAAAAAAB//+AAAAAAAAAf//AAAAAAAAAH//AAAAAAAAAD//gAAAAAAAAD//gAAAAAAAAD//wAAAAAAAAP//wAAAAAAAAf//wAAAAAAAB///4AAAAAAAD///4AAAAAAAD///8AAAAAAAD///+AAAAAAAD////AAAAAAAH////gAAAAAAH////wAAAAAAH////4AAAAAAD////8AAAAAAD////+AAAAAAD/////AAAAAAD/////gAAAAAD/////wAAAAAB/////4AAAAAB/////8AAAAAB/////8AAAAAA/////+AAAAAA//////AAAAAA//////gAAAAAf/////gAAAAAf/////wAAAAAP/////4AAAAAP/////4AAAAAP/////4AAAAAH/////8AAAAAH/////8AAAAAH/////8AAAAAD/////8AAAAAB/////+AAAAAB/////+AAAAAA/////+AAAAAA/////+AAAAAAf////+AAAAAAf/////4AAAAAP/////+AAAAAH//////gAAAAH/////+wAAAAD/////wAAAAAB/////A8AAAAB/////A/AAAAB///////gAAAA///////8AAAA/////H/+AAAA/////f2DAAAA////+fgAAAAAf//+EfAAAAAAf///APAAAAAAf//+AGAAAAAAP//+ADAAAAAAP//+AAAAAAAAH//+AAAAAAAAA//+AAAAAAAAAe/+AAAAAAAAAMf/AAAAAAAAAAf/gAAAAAAAAAP/gAAAAAAAAAP/wAAAAAAAAAH/4AAAAAAAAAH/4AAAAAAAAAD/8AAAAAAAAAD/8AAAAAAAAAB/+AAAAAAAAAB/+AAAAAAAAAB//AAAAAAAAAB//AAAAAAAAAD//AAAAAAAAAD//AAAAAAAAAD//AAAAAAAAAA//AAAAAAAAAA7+AAAAAAAAAA7+AAAAAAAAAAD0AAAAAAAAAADgAAAAAAAAAAA","h":93,"w":73},"dumetella-carolinensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAA///wAAAAAAAAAAAP///gAAAAAAAAAAAf///AAAAAAAAAAAA///8AAAAAAAAAAAB///wAAAAAAAAAAAP///AAAAAAAAAAAB///+AAAAAAAAAAAH////gAAAAAAAAAA/////gAAAAAAAAAH/////gAAAAAAAAA//////AAAAAAAAAD/////+AAAAAAAAAf/////4AAAAAAAAD//////4AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAf//////+AAAAAAAD///////8AAAAAAAf///////4AAAAAAB////////gAAAAAAP///////+AAAAAAB////////8AAAAAAP////////4AAAAAA/////////gAAAAAH/////////AAAAAA////////74AAAAAD////////wAAAAAAP////////AAAAAAB////////8AAAAAAH////////wAAAAAAf///////wAAAAAAB////////AAAAAAAD///////4AAAAAAAP///////gAAAAAAA///////+AAAAAAAB///////wAAAAAAAD///x///AAAAAAAAD//4+f/8AAAAAAAAD8//A//wAAAAAAAB///gA//AAAAAAAB//vwAAP8AAAAAAAf/wAAAB/wAAAAAAH//AAAAD/gAAAAAA/4IAAAAP+AAAAAAH/+AAAAA/4AAAAAA/f4AAAAD/gAAAAAPgNAAAAAP+AAAAAB8AIAAAAA/4AAAAAPgAAAAAAD/gAAAAA8AAAAAAAP/AAAAAD4AAAAAAA/4AAAAAAAAAAAAAD/gAAAAAAAAAAAAAP+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAB/gAAAAAAAAAAAAAH+AAAAAAAAAAAAAAf4AAAAAAAAAAAAAB/AAAAAAAAAAAAAAH8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"egretta-caerulea":{"bits":"AAAf+AAAAAAAAAAP/8AAAAAAAAAD//4AAAAAAAAH///gAAAAAAAP////AAAAAAAf/////AAAAAAf/////+AAAAAH/////v/AAAAA8AAA/+fgAAAAAAAAD/gAAAAAAAAAA/8AAAAAAAAAAf/gAAAAAAAAAH/8AAAAAAAAAB//gAAAAAAAAAP/4/gAAAAAAAB/+f/gAAAAAAAP/n/+AAAAAAAB/h//8AAAAAAAP8P//wAAAAAAB/z///gAAAAAAP////+AAAAAAB/////4AAAAAAH/////gAAAAAA/////+AAAAAAH/////4AAAAAA//////gAAAAAD/////+AAAAAAf/////wAAAAAB//////AAAAAAH/////8AAAAAAf/////wAAAAAD//////AAAAAAP/////4AAAAAA//////gAAAAAD/////+AAAAAAP/////wAAAAAA//////AAAAAAH/////4AAAAAAf/////gAAAAAD/////8AAAAAAPf////wAAAAAA9/////AAAAAAGH////8AAAAAA4P////gAAAAAHB////6AAAAAAYP////gAAAAADA////+AAAAAAQH////wAAAAACA/////AAAAAAAD////8AAAAAAAP////wAAAAAAB7///7AAAAAAAHc//+gAAAAAAA5gP/2AAAAAAAHMAf+YAAAAAAA5wD/5AAAAAAADOAP/AAAAAAAAYwA/4AAAAAAADnAD/AAAAAAAAc4AOAAAAAAAADnAAAAAAAAAAAc4AAAAAAAAAAD3AAAAAAAAAAAe4AAAAAAAAAADjAAAAAAAAAAAcYAAAAAAAAAADjAAAAAAAAAAAcYAAAAAAAAAADnAAAAAAAAAAAY4AAAAAAAAAADHAAAAAAAAAAAY4AAAAAAAAAADHAAAAAAAAAAA44AAAAAAAAAAHHAAAAAAAAAAA44AAAAAAAAAAGHAAAAAAAAAAAw4AAAAAAAAAAGHAAAAAAAAAAAw4AAAAAAAAAAGHAAAAAAAAAAB/4AAAAAAAAAA//8AAAAAAAAA///4AAAAAAAAP/4PgAAAAAAAf/4AAAAAAAAAB//+AAAAAAAAD///4AAAAAAAA//wAAAAAAAAAFj4AAAAAAAAAAB8AAAAAAAAAAAeAAAAAAAAAAACAAAAAAA=","h":93,"w":75},"egretta-rufescens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAB/+AAAAAAAAAAB//AAAAAAAAAAB//4AAAAAAAAAB///wAAAAAAAAB////AAAAAAAAB////8AAAAAAAB//+B/gAAAAAAD/+AAD4AAAAAAAf/AAAAAAAAAAAP/AAAAAAAAAAAN/wAAAAAAAAAAM//AAAAAAAAAAAP/wAAAAAAAAAAD/4AAAAAAAAAAB/+AAAAAAAAAAAf/AAAAAAAAAAAH/gAAAAAAAAAfAfwAAAAAAAAB/4P8AAAAAAAAD/+H+AAAAAAAAH//j/AAAAAAAAP//7/gAAAAAAAP////gAAAAAAAf////wAAAAAAAf////4AAAAAAAf////8AAAAAAAf////8AAAAAAAf////+AAAAAAAf////+AAAAAAAf////+AAAAAAAf/////AAAAAAAP/////AAAAAAAP////+AAAAAAAP////+AAAAAAAH////+AAAAAAAH////+AAAAAAAH////8AAAAAAAH////+AAAAAAAD////+AAAAAAAD/////AAAAAAAD////7AAAAAAAB////5AAAAAAAB////4AAAAAAAD////8AAAAAAAD////8AAAAAAAD////8AAAAAAAH////+AAAAAAAH///x+AAAAAAAf//vA/AAAAAAAT//gAfAAAAAAAH9/gAPgAAAAAAO8vgAHwAAAAAAE8AAAD4AAAAAABgAAAD4AAAAAAAAAAAB8AAAAAAAAAAAA+AAAAAAAAAAAA/AAAAAAAAAAAAfAAAAAAAAAAAAPwAAAAAAAAAAAO4AAAAAAAAAAAH4AAAAAAAAAAAD8AAAAAAAAAAAB2AAAAAAAAAAAAbAAAAAAAAAAAANgAAAAAAAAAAAGwAAAAAAAAAAADcAAAAAAAAAAABuAAAAAAAAAAAA3AAAAAAAAAAAAbgAAAAAAAAAAANwAAAAAAAAAAAGYAAAAAAAAAAADMAAAAAAAAAAABmAAAAAAAAAAAAzAAAAAAAAAAAAZgAAAAAAAAAAANwAAAAAAAAAAAH/+AAAAAAAAAAH/+AAAAAAAAAADz/8AAAAAAAAAA44/AAAAAAAAAH/PAAAAAAAAAAH//wAAAAAAAAAAD/AAAAAAAAAAAA3/AAAAAAAAAAAOHgAAAAAAAAAADwAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":79},"egretta-thula":{"bits":"AAAAAAD/AAAAAAAAAH/4AAAAAAAAH/+AAAAAAAAH//wAAAAAAAP///4AAAAAAP////wAAAAAf/////AAAAAf///B/wAAAAP/+AAAAAAAAD/+AAAAAAAAD7/4AAAAAAAB9//AAAAAAAAgf/gAAAAAAAAP/4AAAAAAAPj/8AAAAAAA/9//AAAAAAB//P/gAAAAAB//x/wAAAAAD//8/4AAAAAD//+/8AAAAAD////+AAAAAD/////AAAAAB/////AAAAAB/////gAAAAB/////wAAAAB/////4AAAAA/////4AAAAA/////8AAAAA/////8AAAAAf////+AAAAAf////+AAAAAP/////AAAAAP/////AAAAAH/////AAAAAH/////gAAAAD/////gAAAAB/////gAAAAB/////gAAAAB/////wAAAAA/////wAAAAAf////wAAAAAf////wAAAAAP////AAAAAAP////gAAAAAH////gAAAAAH////gAAAAAD////wAAAAAB////wAAAAAB////wAAAAAB////4AAAAAB////4AAAAAB////8AAAAAA////8AAAAAAH///+AAAAAAD///2AAAAAAB///zAAAAAAB//+7gAAAAAB//8dwAAAAAB//8MwAAAAAB//+GYAAAAAA9//HcAAAAAAB//DuAAAAAAB//hjAAAAAAA/vh5gAAAAAAcvw4wAAAAAAADgcYAAAAAAAAAGMAAAAAAAAADHAAAAAAAAABjgAAAAAAAAAxwAAAAAAAAAY4AAAAAAAAAMMAAAAAAAAAGGAAAAAAAAADDAAAAAAAAABhgAAAAAAAAAwwAAAAAAAAAYYAAAAAAAAAMOAAAAAAAAAGHAAAAAAAAADDgAAAAAAAABx/8AAAAAAAA//+AAAAAAAAf/+AAAAAAAAOD/8AAAAAAAHg8fAAAAAAA///gAAAAAAAf/x4AAAAAAAAf8EAAAAAAAAHfgAAAAAAAABx8AAAAAAAAAcCAAAAAAAAAHAAAAAAAAAAAgAAAAAA=","h":93,"w":67},"egretta-tricolor":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAH/+AAAAAAAAAAP//wAAAAAAAAAP//8AAAAAAAAAf///gAAAAAAAB////8AAAAAAAH////vgAAAAAA//4P/x8AAAAAD///5/4PgAAAAH/4f//8DIAAAAP+AAP//+AAAAAHAAAP///wAAAAAAAAP///+AAAAAAAAH////gAAAAAAAH////8AAAAAAAD/////AAAAAAAB/////wAAAAAAA/////8AAAAAAAf/////AAAAAAAP/////wAAAAAAH/////8AAAAAAD//////AAAAAAB//////wAAAAAA//////4AAAAAAf/////+AAAAAAH//////gAAAAAD//////4AAAAAB//////8AAAAAAf//////AAAAAAH//////gAAAAAD//////4AAAAAA//////+AAAAAAf//////AAAAAAH//////wAAAAAB//////4AAAAAA//////+AAAAAAH//////AAAAAAD/3////wAAAAAAfx////4AAAAAAP4f///+AAAAAAD+H////AAAAAAA/B////wAAAAAAUyf///8AAAAAADNn////AAAAAAAjX////gAAAAAAQ/////oAAAAAAAf////4AAAAAAAH////+AAAAAAAB////5gAAAAAAA////8AAAAAAAAP////AAAAAAAAH7///gAAAAAAAD8f//wAAAAAAAB+AN/4AAAAAAAAfAD/8AAAAAAAAPgA/+AAAAAAAAPwAP/AAAAAAAAD8AD/gAAAAAAAB+AA/gAAAAAAAA/AAPAAAAAAAAAfgADgAAAAAAAANwAAAAAAAAAAAG4AAAAAAAAAAADcAAAAAAAAAAADuAAAAAAAAAAAB3AAAAAAAAAAAA7AAAAAAAAAAAAdgAAAAAAAAAAAOwAAAAAAAAAAAHYAAAAAAAAAAADsAAAAAAAAAAAB2AAAAAAAAAAAA7AAAAAAAAAAB99gAAAAAAAAAB///AAAAAAAAAAf/+gAAAAAAAAH/+e8AAAAAAAAD////AAAAAAAAAD//+AAAAAAAAAB//AAAAAAAAAAAj/gAAAAAAAAAADzgAAAAAAAAAADxwAAAAAAAAAAHhwAAAAAAAAAAHAwAAAAAAAAAAHA4AAAAAAAAAACAYAAAAAAAAAAAAYAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":79},"elanoides-forficatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAH/+AAAAAAAAAAAAB//4AAAAAAAAAAAAf//wAAAAAAAAAAAD///AAAAAAAAAAAA///8AAAAAAAAAAAP///gAAAAAAAAAAB///+AAAAAAAAAAAP///4AAAAAAAAAAB////wAAAAAAAAAAN////gAAAAAAAAAAH///+AAAAAAAAAAA////8AAAAAAAAAAD////wAAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAA//////AAAAAAAAAH/////8AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA///////gAAAAAAAD//////+AAAAAAAAf//////4AAAAAAAD///////gAAAAAAAf//////+AAAAAAAB///////4AAAAAAAP///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAAf//////+AAAAAAAB///////4AAAAAAAP///////wAAAAAAA////////AAAAAAAD///////8AAAAAAAP///////wAAAAAAA////////AAAAAAAD///////4AAAAAAAf///////AAAAAAAB///////8AAAAAAAH///////wAAAAAAAf//////+AAAAAAAA///////4AAAAAAAD///////AAAAAAAAP//////4AAAAAAAA///////gAAAAAAAG///////AAAAAAAAT//////+AAAAAAACf//////4AAAAAAAZ///////wAAAAAABP///////AAAAAAAP///////+AAAAAAD//4f////8AAAAAA///A/////4AAAAA/9/4D/////gAAAAf/3+AH/////AAAAD///wAP////+AAAA///+AAf/z//4AAAH/j3gAA//D//wAAA/8OcAAD/8D//AAAD/hwAAAP/4H/8AAAG+cAAAA//AH/gAAAf0AAAAH/8AH4AAABPgAAAAf/4AHAAAAAAAAAAB//gAAAAAAAAAAAAH/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAB//gAAAAAAAAAAAAH/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAB//gAAAAAAAAAAAAH5+AAAAAAAAAAAAAfn4AAAAAAAAAAAAB+fgAAAAAAAAAAAAH4+AAAAAAAAAAAAAPD4AAAAAAAAAAAAA8PgAAAAAAAAAAAADgcAAAAAAAAAAAAAOBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":84,"w":93},"elanus-leucurus":{"bits":"AAAAAAAD/AAAAAAAAAP/wAAAAAAAAf/4AAAAAAAA//8AAAAAAAA//+AAAAAAAA///AAAAAAAA///AAAAAAAA///AAAAAAAA///AAAAAAAA///gAAAAAAAf//gAAAAAAAf//gAAAAAAA///gAAAAAAB///gAAAAAAB///gAAAAAAD///gAAAAAAH///wAAAAAAP///4AAAAAAf///8AAAAAA////+AAAAAB////+AAAAAH/////AAAAAP/////AAAAAP/////AAAAAf/////AAAAA//////AAAAB//////AAAAB//////AAAAD/////+AAAAD/////+AAAAH/////+AAAAH/////+AAAAP/////8AAAAP/////8AAAAf/////4AAAA//////4AAAB//////4AAAB//////wAAAD//////wAAAD//////gAAAH//////AAAAH/////+AAAAP/////8AAAAP/////8AAAAP/////4AAAAP/////4AAAAP/////wAAAAf/////gAAAAf/////AAAAA/////+AAAAA/////8AAAAA/////8AAAAA/////8AAAAA/////4AAAAAf////8AAAAAf////+AAAAA//////AAAAB//////AAAAD///v//AAAAH///Pf/AAAAP///Of/AAAAf///Pf/AAAA///+H/EAAAB///+AfAAAAD///8AMAAAAH///8AAAAAAP///8AAAAAAf///4AAAAAA/7//4AAAAAB/n//wAAAAAD/H//wAAAAAH8P//wAAAAAP4P//gAAAAAfwP//gAAAAAfAf//AAAAAA+Af//AAAAAA4A///AAAAAAAA//+AAAAAAAA//+AAAAAAAB//8AAAAAAAB//8AAAAAAAB//8AAAAAAAAf/4AAAAAAAAf/4AAAAAAAAf/wAAAAAAAAf/wAAAAAAAAf/gAAAAAAAAf/gAAAAAAAAf/gAAAAAAAA//AAAAAAAAAZ+AAAAAAAAAA+AAAAAAAAAAcAAAAAAAA","h":93,"w":66},"empidonax-alnorum":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//AAAAAAAAAAAAB//+AAAAAAAAAAAAf//4AAAAAAAAAAAP///gAAAAAAAAAAf///+AAAAAAAAAAP////4AAAAAAAAAB/////AAAAAAAAAAD////8AAAAAAAAAAD////wAAAAAAAAAAf////AAAAAAAAAAB////4AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAH////+AAAAAAAAAA/////8AAAAAAAAAH/////wAAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf//////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////wAAAAAAB////////AAAAAAAP///////8AAAAAAB////////wAAAAAAH////////AAAAAAAf///////8AAAAAAD////////gAAAAAAP///////+AAAAAAA////////wAAAAAAD////////AAAAAAAP///////8AAAAAAA////////wAAAAAAD////////AAAAAAAP///////8AAAAAAA////////wAAAAAAB////////AAAAAAAD///////8AAAAAAAH///////gAAAAAAAP//////4AAAAAAAH///w///AAAAAAAA/w/AB//4AAAAAAAPPPwAB//gAAAAAABw/4AAB/+AAAAAAAMH8AAAB/8AAAAAABh+AAAAD/wAAAAAAEfAAAAAP/AAAAAAAPwAAAAA/8AAAAAAH4AAAAAB/wAAAAAB/wAAAAAH/AAAAAAPPAAAAAAf8AAAAABwYAAAAAB/wAAAAAOHAAAAAAH/AAAAABwgAAAAAAf8AAAAAOAAAAAAAB/wAAAAAwAAAAAAAD/AAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/wAAAAAAAAAAAAAD+AAAAAAAAAAAAAAP4AAAAAAAAAAAAAA/gAAAAAAAAAAAAAD8AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":75,"w":93},"empidonax-difficilis":{"bits":"AAAAAAAH/AAAAAAAAAAA//4AAAAAAAAAH//8AAAAAAAAA///4AAAAAAAAB///wAAAAAAAAP///gAAAAAAAB////AAAAAAAAP///+AAAAAAAB////+AAAAAAAP/////AAAAAAB//////gAAAAAH//////AAAAAA//////8AAAAAD//////AAAAAAP////+AAAAAAB/////wAAAAAAH////+AAAAAAA/////4AAAAAAH/////AAAAAAA/////8AAAAAAP/////gAAAAAB/////+AAAAAAP/////wAAAAAB//////AAAAAAP/////8AAAAAB//////wAAAAAP//////AAAAAB//////8AAAAAH//////wAAAAA///////AAAAAH//////8AAAAAf//////wAAAAD///////AAAAAf//////8AAAAB///////wAAAAP///////AAAAB///////4AAAAP///////gAAAB///////+AAAAH///////wAAAA////////AAAAH///////4AAAAf///////gAAAB///////+AAAAP///////wAAAB///////+AAAAH///////4AAAA////////AAAAD///////4AAAAP///////AAAAA///////4AAAAH///////gAAAAf//////8AAAAB///////gAAAAH//////8AAAAA///////gAAAAH//////8AAAAAf//////AAAAAD//////4AAAAAf//////+AAAAB///////+AAAAP/////4P8AAAB/f///wB/4AAAHx///8AfvgAAA+P///4Bw+AAADw//8HwGD4AAAeD//gPgAPgAABwP/8APgH4AAAGB//gAfgPgAAAAH/4AD+BcAAAAA//AA/8HgAAAAD/8AHn4AAAAAAf/gAcfgAAAAAB/+ABh2AAAAAAP/4AGvwAAAAAA//AAP8AAAAAAH/8AAfwAAAAAAf/gAAGAAAAAAD/+AAD4AAAAAAP/wAACAAAAAAA//AAAAAAAAAAH/4AAAAAAAAAAf/gAAAAAAAAAD/+AAAAAAAAAAP/wAAAAAAAAAB//AAAAAAAAAAH/4AAAAAAAAAAf/gAAAAAAAAAD/8AAAAAAAAAAP/wAAAAAAAAAA/+AAAAAAAAAAD/wAAAAAAAAAAPgAAAAAAAAAAAA=","h":93,"w":76},"empidonax-flaviventris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//wAAAAAAAAAAAA///AAAAAAAAAAAAP//+AAAAAAAAAAAD///4AAAAAAAD4AB////gAAAAAAD+AA/////AAAAAAB/+A//////4AAAAA//4P//////8AAAA///gf//////8AAAf//8AP//////8AAP//+AB///////+AH///AAH////////////gAAf///////////wAAB///////////wAAAP//////////wAAAB//////////4AAAAH/////////+AAAAAf/////////gAAAAD/////////4AAAAAf////////8AAAAAB/////////AAAAAAP////////wAAAAAB////////8AAAAAAH////////wAAAAAA/////////gAAAAAH/////////AAAAAAf////////+AAAAAD/////////8AAAAAP/////////wAAAAA/////////+AAAAAD//////8AAwAAAAAP//////AAAAAAAAA//////4AAAAAAAAD/////8AAAAAAAAAP/////AAAAAAAAAAf////wAAAAAAAAAA////4AAAAAAAAAAB///+AAAAAAAAAAAH///wAAAAAAAAAAB//w+AAAAAAAAAAA//AfAAAAAAAAAAAPx4HwAAAAAAAAAAB8BD4AAAAAAAAAAAPgI+AAAAAAAAAAAA8AfAAAAAAAAAAAAHwP/AAAAAAAAAAAA+j/8AAAAAAAAAAAD8/DwAAAAAAAAAAAOHwGAAAAAAAAAAAAA+AgAAAAAAAAAAAABwAAAAAAAAAAAAAAPgAAAAAAAAAAAAAB7AAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":59,"w":93},"empidonax-hammondii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAA//gAAAAAAAAAAAf/+AAAAAAAAAAAf//wAAAAAAAAAAP//+AAAAAAAAAAH///gAAAAAAAAAH///4AAAAAAAAAP////AAAAAAAAAH////gAAAAAAAAH/////wAAAAAAAH/////8AAAAAAAH/////+AAAAAAAD/////8AAAAAAAD/////gAAAAAAAB/////gAAAAAAAB/////gAAAAAAAA/////gAAAAAAAA/////wAAAAAAAB/////4AAAAAAAB/////4AAAAAAAD/////8AAAAAAAD/////+AAAAAAAD/////+AAAAAAAD//////AAAAAAAH//////gAAAAAAD//////gAAAAAAD//////wAAAAAAD//////4AAAAAAD//////8AAAAAAD//////+AAAAAAD///////AAAAAAB///////gAAAAAB///////gAAAAAB///////wAAAAAB///////4AAAAAB///////8AAAAAB///////8AAAAAB///////+AAAAAB////////AAAAAA////////AAAAAA////////gAAAAA////////gAAAAAf///////wAAAAAf///////wAAAAAP///////wAAAAAP///////4AAAAAH///////4AAAAAH///////4AAAAAD///////4AAAAAB///////4AAAAAA///////4AAAAAA///////4AAAAAA///////4AAAAAA///////wAAAAAAf//////wAAAAAAf//////wAAAAAAf//////gAAAAAAf//////8AAAAAAf///////8AAAAAf/////8H/gAAAAP/////wAf4AAAAP/////4AH8AAAAP///wB/AP/AAAAP///wAP4//gAAAH///wAA/fHwAAAH+//wAAP/D4AAADs//wAAD/B4AAAAAf/4AAD/58AAAAAf/4AAH/98AAAAAP/4AAPvw+AAAAAP/8AAXn5+AAAAAH/8AAPj8PAAAAAH/+AAD38PAAAAAH/+AAB78HAAAAAD//AAAf+AAAAAAB//AAACfAAAAAAB//AAAB+AAAAAAB//gAAAHAAAAAAA//gAAAfAAAAAAA//wAAAPAAAAAAAf/wAAAAAAAAAAAf/4AAAAAAAAAAAP/4AAAAAAAAAAAP/8AAAAAAAAAAAH/8AAAAAAAAAAAH/+AAAAAAAAAAAD/+AAAAAAAAAAAD//AAAAAAAAAAAB//AAAAAAAAAAAA//gAAAAAAAAAAA/PgAAAAAAAAAAAPHgAAAAAAAAAAAAAgAAAAAAAAAAAAA=","h":93,"w":85},"empidonax-minimus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//AAAAAAAAAAAAP//AAAAAAAAAAAD///AAAAAAAAAAAf//+AAAAAAAAAAH///8AAAAAAAAAA////4AAAAAAAAAH////4AAAAAAAAA/////4AAAAAAAAH/////+AAAAAAAAf/////8AAAAAAAD//////gAAAAAAAf/////4AAAAAAAD/////+AAAAAAAAf/////wAAAAAAAD/////+AAAAAAAAf/////wAAAAAAAH//////AAAAAAAA//////8AAAAAAAH//////gAAAAAAA//////+AAAAAAAH//////4AAAAAAA///////AAAAAAAH//////8AAAAAAA///////wAAAAAAD///////AAAAAAAf//////8AAAAAAD///////wAAAAAAf///////AAAAAAB///////8AAAAAAP///////wAAAAAB////////AAAAAAP///////8AAAAAB////////wAAAAAP////////AAAAAA////////4AAAAAH////////gAAAAA////////+AAAAAD////////4AAAAAP////////AAAAAB////////8AAAAAH////////gAAAAA////////+AAAAAD////////wAAAAAf////////AAAAAB////////4AAAAAH////////AAAAAA////////4AAAAAD////////AAAAAAP///////4AAAAAA////////AAAAAAD///////4AAAAAAf///////AAAAAAB///////4AAAAAAP///////AAAAAAA///////4AAAAAAH//////+AAAAAAA///////wAAAAAAH//////8AAAAAAAf/////+AAAAAAADv/////8AAAAAAAc//7//f+AAAAAABj//AAAP+AAAAAAAf/4AAA/4AAAAAAD//AAAf3wAAAAAAP/4AAB8OAAAAAAB/+AAAHb4AAAAAAP/wAAAa/gAAAAAA/+AAABv8AAAAAAH/wAAAH/wAAAAAAf+AAAAGfAAAAAAD/gAAAAB4AAAAAAf8AAAAAHAAAAAAB/wAAAAAAAAAAAAP+AAAAAAAAAAAAA/4AAAAAAAAAAAAH/AAAAAAAAAAAAA/8AAAAAAAAAAAAD/gAAAAAAAAAAAAf8AAAAAAAAAAAAB/wAAAAAAAAAAAAP+AAAAAAAAAAAAB/4AAAAAAAAAAAAH/AAAAAAAAAAAAAf8AAAAAAAAAAAAD/gAAAAAAAAAAAAP8AAAAAAAAAAAAAvwAAAAAAAAAAAAA+AAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":88},"empidonax-oberholseri":{"bits":"AAB8AAAAAAAAAAP/4AAAAAAAAAf//AAAAAAAAAf//wAAAAAAAAf//+AAAAAAAAf///gAAAAAAA////wAAAAAAB////8AAAAAAH/////AAAAAAH/////gAAAAAD/////wAAAAAAB////8AAAAAAAf///+AAAAAAAH////AAAAAAAB////wAAAAAAA////8AAAAAAAP////AAAAAAAH////wAAAAAAB////8AAAAAAAf////AAAAAAAH////wAAAAAAD////8AAAAAAA/////AAAAAAAf////wAAAAAAP////8AAAAAAH////+AAAAAAD/////gAAAAAB/////4AAAAAA/////8AAAAAAf/////AAAAAAH/////gAAAAAD/////4AAAAAB/////+AAAAAA//////AAAAAAP/////wAAAAAH/////4AAAAAB/////+AAAAAA//////AAAAAAP/////wAAAAAH/////4AAAAAB/////+AAAAAAf/////AAAAAAP/////gAAAAAD/////4AAAAAA/////8AAAAAAP/////AAAAAAD/////gAAAAAB/////wAAAAAAf////4AAAAAAD////+AAAAAAA/////gAAAAAAP////wAAAAAAB////8AAAAAAAP///+AAAAAAAf////AAAAAAD/////wAAAAAD/////4AAAAAH/8///+AAAAAD/4H///AAAAAB4eAP//wAAAAB8vAH//4AAAAA+/AB//8AAAAAP/AAf/2AAAAAH8AAD/8AAAAAA/AAA/+AAAAAAHAAAP/gAAAAAAAAAD/wAAAAAAAAAA/4AAAAAAAAAAP+AAAAAAAAAAH/AAAAAAAAAAD/wAAAAAAAAAA/4AAAAAAAAAAf+AAAAAAAAAAH/AAAAAAAAAAD/wAAAAAAAAAA/4AAAAAAAAAAf+AAAAAAAAAAP/gAAAAAAAAAD/wAAAAAAAAAB/8AAAAAAAAAAf+AAAAAAAAAAP/AAAAAAAAAAD/wAAAAAAAAAB/8AAAAAAAAAAf+AAAAAAAAAAP/gAAAAAAAAAH/wAAAAAAAAAB/4AAAAAAAAAA/+AAAAAAAAAAP/AAAAAAAAAAD/gAAAAAAAAAB7wAAAAAAAAAAYA","h":93,"w":73},"empidonax-traillii":{"bits":"AAADgAAAAAAAAAAAAAP/wAAAAAAAAAAAAH//wAAAAAAAAAAAD///AAAAAAAAAAAA///+AAAAAAAAAAAf///4AAAAAAAAAAP////gAAAAAAAAAf/////AAAAAAAAAP/////4AAAAAAAAH//////gAAAAAAAAf/////+AAAAAAAAAf/////4AAAAAAAAAf/////gAAAAAAAAB/////+AAAAAAAAAP/////8AAAAAAAAA//////4AAAAAAAAD//////wAAAAAAAAf//////AAAAAAAAD//////+AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAA////////AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////gAAAAAA////////+AAAAAAH////////4AAAAAA/////////gAAAAAD////////+AAAAAAf////////wAAAAAD/////////AAAAAAP////////8AAAAAB/////////wAAAAAP////////+AAAAAA/////////4AAAAAH/////////AAAAAAf////////8AAAAAB/////////gAAAAAP////////8AAAAAA/////////wAAAAAD/////////gAAAAAP////////8AAAAAA/////////4AAAAAD/////////gAAAAAP////////+AAAAAA/////////4AAAAAB/////////wAAAAAH/////////AAAAAAP////////8AAAAAAf//////4/wAAAAAAf//////g+AAAAAAB//////+BwAAAAAB/j//H//wAAAAAAAfgAP4P//AAAAAAAP4AD4Af/8AAAAAAH4AA8AA//wAAAAAB/gAfAAH//AAAAAAP/wPwAAf/8AAAAAD4/D8AAB//gAAAAB/B4f4AAH/+AAAAAPwDH/4AA//4AAAAB+Ab8/gAD//gAAAAPwD/g8AAP/+AAAAB/Q38DwAA//4AAAAH+A3gGAAD//gAAAAfwH8BgAAf/8AAAAB+A/iMAAB//wAAAAPwD+wAAAH//AAAAA8AP+AAAAf/8AAAAAAB3gAAAB//wAAAAAAH4AAAAH/+AAAAAAAeAAAAA//4AAAAAAAgAAAAB//AAAAAAAAAAAAAP/wAAAAAAAAAAAAAf8AAAAAAAAAAAAAAgAA==","h":79,"w":93},"empidonax-virescens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/4AAAAAAAAAAAAA//4AAAAAAAAAAAAf//wAAAAAAAAAAAH///AAAAAAAAAAAB///8AAAAAAAAAAAf///wAAAAAAAAAAH////AAAAAAAAAAD////8AAAAAAAAAD/////wAAAAAAAAB//////AAAAAAAAAP/////4AAAAAAAAAD/////gAAAAAAAAAP////+AAAAAAAAAA/////8AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAB//////AAAAAAAAAP/////8AAAAAAAAB//////4AAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA///////gAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////gAAAAAAA///////+AAAAAAAH///////4AAAAAAA////////gAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////AAAAAAAf///////8AAAAAAB////////wAAAAAAP///////+AAAAAAA////////4AAAAAAH////////gAAAAAAf///////8AAAAAAD////////wAAAAAAP///////+AAAAAAA////////4AAAAAAD////////AAAAAAAP///////8AAAAAAB////////gAAAAAAD///////8AAAAAAAP///////wAAAAAAA////////AAAAAAAD///////8AAAAAAAP///////gAAAAAAAf//////+AAAAAAAB///////4AAAAAAAH///////gAAAAAAB///////+AAAAAAAf//////9wAAAAAAHw//////yAAAAAAA4f//4//+AAAAAAAP/+GAD//4AAAAAAB/4QAAH//AAAAAAAP/+AAAf/8AAAAAAD8PwAAAf/wAAAAAAeAOAAAA//AAAAAAHAAQAAAB/4AAAAAA4AGAAAAH/gAAAAAHAAgAAAAf+AAAAABgAAAAAAD/wAAAAAEAAAAAAAP/AAAAAAgAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/AAAAAAAAAAAAAAf8AAAAAAAAAAAAAB/gAAAAAAAAAAAAAH8AAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAA==","h":86,"w":93},"empidonax-wrightii":{"bits":"AAAAAAP8AAAAAAAB/+AAAAAAAP//AAAAAAA///gAAAAAD///+AAAAAP////AAAAA////+AAAAD////AAAAAH///wAAAAAf///gAAAAA///+AAAAAD///4AAAAAH///wAAAAAf///AAAAAA///+AAAAAD///8AAAAAP///wAAAAAf///gAAAAB////AAAAAH///+AAAAAf///8AAAAB////4AAAAH////wAAAAP////wAAAA/////gAAAD/////AAAAP////+AAAAf////8AAAB/////wAAAD/////gAAAP/////AAAAf////+AAAB/////4AAAD/////wAAAP/////gAAAf////+AAAB/////8AAAD/////wAAAP/////gAAAf/////AAAB/////8AAAD/////wAAAH/////gAAAf////+AAAA/////4AAAB/////gAAAD////+AAAAH////4AAAAP////4AAAAf////4AAAB/////4AAAD////vwAAAP///53gAAAf///DOAAAB///8H4AAAH///+PwAAAP//8/PAAAAf//w/EAAAB///D+AAAAH//+e8AAAAPf/454AAAAd//h3gAAABzf+D/AAAADA/8DsAAAAGD/4B4AAAAAH/wAAAAAAAP/AAAAAAAA/+AAAAAAAB/8AAAAAAAD/wAAAAAAAP/gAAAAAAAf/AAAAAAAA/+AAAAAAAD/4AAAAAAAH/wAAAAAAAP/gAAAAAAA/+AAAAAAAB/8AAAAAAAH/4AAAAAAAP/wAAAAAAAf/AAAAAAAA/+AAAAAAAD/8AAAAAAAH/wAAAAAAAP/gAAAAAAA//AAAAAAAB/+AAAAAAAD/4AAAAAAAP/wAAAAAAAf/AAAAAAAA/+AAAAAAAB54AAAAAAADggAAAAAAAA=","h":93,"w":59},"eremophila-alpestris":{"bits":"AAYAAAAAAAAAAAAAAH4AAAAAAAAAAAAAB+AAAAAAAAAAAAAAfgAAAAAAAAAAAAAD/wAAAAAAAAAAAAA//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//8AAAAAAAAAAAP///wAAAAAAAAAAH///+AAAAAAAAAAA////4AAAAAAAAAAA////gAAAAAAAAAAB///8AAAAAAAAAAAP///wAAAAAAAAAAA///+AAAAAAAAAAAH///4AAAAAAAAAAA////wAAAAAAAAAAD////wAAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAAf/////AAAAAAAAAD/////+AAAAAAAAAf/////8AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAD//////+AAAAAAAAf//////4AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAf///////4AAAAAAB////////gAAAAAAP///////+AAAAAAB////////4AAAAAAH////////wAAAAAA/////////AAAAAAD////////8AAAAAAf////////4AAAAAB/////////gAAAAAH/////////AAAAAAf////////8AAAAAD/////////wAAAAAP/////////wAAAAA//////////gAAAAD//////////AAAAAH/////////+AAAAAf/////////8AAAAA//////////8AAAAD//////////wAAAAH/////B/z//gAAAAH////AA+D//AAAAAP///AAAAP/+AAAAAH//wAAAAf/4AAAAA+f+AAAAA//AAAAAfAfgAAAAB/AAAAAPgHwAAAAAD4AAAAHwB4AAAAAAAAAAAH/g+AAAAAAAAAAAD//PAAAAAAAAAAAA/gLwAAAAAAAAAAAN8B4AAAAAAAAAAAAvAfwAAAAAAAAAAADYf/wAAAAAAAAAAAbf4+AAAAAAAAAAACP+AAAAAAAAAAAAAY3wAAAAAAAAAAAADF2AAAAAAAAAAAAAAcwAAAAAAAAAAAAAHGAAAAAAAAAAAAAAw8AAAAAAAAAAAAAEBwAAAAAAAAAAAAAgAAAAAAAAAAAAAAEAAAAAAAAAAA","h":73,"w":93},"eudocimus-albus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfwAAAAAAAAAAAAAP/AAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAH/+AAAAAAAAAAAAA//4AAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAB///AAAAAAAAAAAAf//4AAAAAAAAAAAH///AAAAAAAAAAAB/h/wD4AAAAAAAAAfwf+H//AAAAAAAAH4D/z///gAAAAAAB+A//////AAAAAAAfAP//////AAAAAAHwB//////+AAAAAB8AP//////4AAAAAfAB///////wAAAAHwAf///////AAAAA8AD///////+AAAAPAAf///////4AAADwAD////////gAAAcAAf///////+AAAHgAB////////4AAA4AAP////////gAAOAAB/////////AABwAAH////////8AAOAAAf////////4ABgAAD/////////gAIAAAH////////+AAAAAAf////////4AAAAAA4f///////gAAAAADwf//////+AAAAAAHB///////4AAAAAAMH///////gAAAAAAwf//////+AAAAAADB///////4AAAAAAMP///////gAAAAAA5///////8AAAAAAB3///////gAAAAAAD///////4AAAAAAAH//////+AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAH///8f/4AAAAAAAAf4B3wP/gAAAAAAAD+AAfA/4AAAAAAAAPwAD4B+AAAAAAAAA8AB+AAAAAAAAAAAHAA/gAAAAAAAAAAA4A/gAAAAAAAAAAAHAfwAAAAAAAAAAAAcPwAAAAAAAAAAAADn4AAAAAAAAAAAAAf8AAAAAAAAAAAAAD/AAAAAAAAAAAAAAf4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAf8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAfsAAAAAAAAAAAAAD/AAAAAAAAAAAAAAdwAAAAAAAAAAAAADvAAAAAAAAAAAAAAc8AAAAAAAAAAAAADHwAAAAAAAAAAAAAYeAAAAAAAAAAAAAHAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/4AAAAAAAAAAAB///gAAAAAAAAAAAP/8AAAAAAAAAAAAAAeAAAAAAAAAAAAAAHgAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":86,"w":93},"euphagus-carolinus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAB///gAAAAAAAAAAA///+AAAAAAAAAAAP///wAAAAAAAAAAAf///AAAAAAAAAAAAf//8AAAAAAAAAAAA///gAAAAAAAAAAAD//+AAAAAAAAAAAAf//wAAAAAAAAAAAB///AAAAAAAAAAAAP//4AAAAAAAAAAAA///gAAAAAAAAAAAH///AAAAAAAAAAAA///+AAAAAAAAAAAH///4AAAAAAAAAAA////wAAAAAAAAAAH////gAAAAAAAAAA/////AAAAAAAAAAH////+AAAAAAAAAA/////8AAAAAAAAAH/////wAAAAAAAAA//////AAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////gAAAAAAAD//////+AAAAAAAAf//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAH///////4AAAAAAAf///////gAAAAAAB///////8AAAAAAAH///////4AAAAAAA////////gAAAAAAD////////AAAAAAAP///////+AAAAAAA////////4AAAAAAD////////gAAAAAAH///////8AAAAAAAf///////wAAAAAAA///////+AAAAAAAB///////wAAAAAAAD///////gAAAAAAAD//4D//+AAAAAAAAD/4AA//8AAAAAAAAf8AAAf/wAAAAAAAPngAAAf/gAAAAAADw8AAAA/+AAAAAAB4PAAAAD/8AAAAAA+DwAAAAH/wAAAA//O8AAAAAf/AAAAP//+AAAAAA/+AAAH/+PgAAAAAB/4AAAt+B4AAAAAAH/gAAAfweAAAAAAAP8AAAAP//wAAAAAAfgAAAP//9AAAAAAA8AAAD/+AAAAAAAAAAAAAA+AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"euphagus-cyanocephalus":{"bits":"AAH4AAAAAAAAAAAAAH/4AAAAAAAAAAAAD//gAAAAAAAAAAAP///AAAAAAAAAAAP///8AAAAAAAAAAH////wAAAAAAAAAA////+AAAAAAAAAAAf///4AAAAAAAAAAAf///gAAAAAAAAAAA///8AAAAAAAAAAAD///wAAAAAAAAAAAf///gAAAAAAAAAAB////AAAAAAAAAAAP////AAAAAAAAAAA////+AAAAAAAAAAH////8AAAAAAAAAA/////4AAAAAAAAAD/////wAAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf//////AAAAAAAAD//////8AAAAAAAAf//////4AAAAAAAB///////gAAAAAAAP//////+AAAAAAAB///////4AAAAAAAH///////gAAAAAAA////////AAAAAAAD///////8AAAAAAAf///////wAAAAAAB////////AAAAAAAH///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAP///////8AAAAAAAf///////wAAAAAAB////////AAAAAAAH///////8AAAAAAAf///////wAAAAAAB////////AAAAAAAD///////8AAAAAAAH///////wAAAAAAAP//////2AAAAAAAAP//////gAAAAAAAAP/+H//+AAAAAAAAA/4AD//4AAAAAAAAf/AAH//gAAAAAAAHjwAAP//AAAAAAAD+8AAAH/8AAAAAAAf/AAAAf/wAAAAAAHnwAAAB//AAAAAAA5/AAAAH/8AAAAAAHeYAAAAf/4AAAAAAfGAAAAB//gAAAAAD4AAAAAH/+AAAAAA/4AAAAAf/4AAAAAPvgAAAAA//gAAAAB4cAAAAAD/+AAAAAHBgAAAAAP/wAAAAA4cAAAAAA//AAAAAD8AAAAAAD/4AAAAAPAAAAAAAH8AAAAAB8AAAAAAAAAAAAAAHgAAAAAAAAA","h":66,"w":93},"falco-columbarius":{"bits":"Af+AAAAAAAD//AAAAAAAP//gAAAAAA///gAAAAAB///gAAAAAD///AAAAAAP///AAAAAAf//+AAAAAB///+AAAAAD///8AAAAAH///8AAAAAH///4AAAAAH///4AAAAAP///4AAAAAP///4AAAAA////8AAAAB////8AAAAH////+AAAAf////+AAAA/////+AAAD/////+AAAH/////+AAAP/////8AAAf/////8AAA//////8AAB//////4AAD//////4AAH//////wAAP//////wAAf//////gAA///////gAA///////AAB///////AAD//////+AAD//////+AAH//////8AAP//////4AAP//////4AAf//////wAAf//////gAA///////gAA///////AAA//////+AAA//////8AAA//////8AAB//////4AAB//////wAAB//////wAAD//////gAAD//////AAAD/////+AAAH/////8AAAH/////8AAAP/////4AAAf/////wAAA//////gAAA//////AAAB/////8AAAD/////4AAAD/////4AAAD/////wAAAP/////wAAH//////gAAP//////gAAf//////AAA///////AAB//////+AAB/v////8AAB/b////8AAAcX////8AAAAP+///4AAAAP9///wAAAAfj///wAAAAAD///wAAAAAH///gAAAAAP///AAAAAAP/3/AAAAAAf/3+AAAAAA//juAAAAAA//DsAAAAAB/+DIAAAAAB/8AAAAAAAD/8AAAAAAAH/4AAAAAAAH/wAAAAAAAP/gAAAAAAAf/gAAAAAAAf/AAAAAAAA/+AAAAAAAA/8AAAAAAAA/4AAAAAAAA/wAAAAAAAA/gA=","h":93,"w":59},"falco-mexicanus":{"bits":"AAAAAP4AAAAAAH/4AAAAAA//4AAAAAH//wAAAAAf//AAAAAB//+AAAAAH//4AAAAAf//gAAAAD///AAAAAH//8AAAAAf//wAAAAA///AAAAAD//+AAAAAf//4AAAAH///gAAAA////AAAAH///8AAAB////wAAAP////gAAB/////AAAP////+AAB/////4AAH/////wAA//////AAH/////8AAf/////wAD//////AAP/////8AA//////wAH//////AAf/////8AD//////wAP/////+AA//////4AD//////gAP/////8AB//////wAH//////AAf/////4AB//////gAH/////+AAf/////wAB/////+AAH/////4AA//////AAD/////4AAP/////AAA/////8AAD/////gAAP////8AAA/////wAAD////+AAAP////wAAA/////AAAD////8AAAP////gAAA////+AAAD////wAAAP////gAAA/////wAAD/////gAAf////+AAD/////4AAf/////AAB/////4AAP///8/AAB////z4AAP////HAAA////8AAAH+//+AAAA////4AAAD7///AAAAeN//oAAADw3/+AAAAMDf/4AAAAAL//AAAAABv/8AAAAAC//wAAAAAL/+AAAAAAP/4AAAAAB//gAAAAAH/8AAAAAAf/wAAAAAB//AAAAAAH/4AAAAAAf/gAAAAAD/8AAAAAAP/wAAAAAA/+AAAAAAD/4AAAAAAP/AAAAAAA/wAAAAAAB+AAAAAAA=","h":93,"w":52},"falco-peregrinus":{"bits":"AAAAAAAAP4AAAAAAAAB/+AAAAAAAAP//AAAAAAAA///AAAAAAAD//+AAAAAAAH//8AAAAAAAf//8AAAAAAB///4AAAAAAD///4AAAAAAP///wAAAAAA////gAAAAAH////AAAAAA////kAAAAAD////AAAAAAP///8AAAAAA////4AAAAAD////wAAAAAf////gAAAAB/////AAAAAH/////AAAAAf////+AAAAB/////+AAAAH/////8AAAAf/////4AAAA//////4AAAD//////wAAAP//////gAAAf/////+AAAB//////8AAAD//////4AAAP//////wAAAf//////gAAA//////+AAAD//////8AAAH//////wAAAP//////gAAA///////AAAB//////+AAAD//////4AAAH//////wAAAf//////AAAA//////+AAAD//////4AAAH//////wAAAP//////AAAAf/////8AAAB//////wAAAD//////AAAAH/////+AAAAf/////4AAAA//////gAAAB//////AAAAD/////+AAAAH/////8AAAAP/////wAAAAf/////gAAAB/////+AAAAD/////8AAAAP/////wAAAAf/////8AAAB//////+AAAH//////+AAAf//////8AAB///////8AAH////5/P4AAf////w8fgAB/9///xw/AAH/z///zn+AAf/P///2C8AB/+f///3HwAH34///fgGAAPPh//8/AAAA4eD//5+AAABB8P//z4AAAADwf//nAAAAAPA///uAAAAAcB//38AAAAA4D//hwAAAADgP/+AAAAAAGAf/8AAAAAAMA//wAAAAAAAB//gAAAAAAAD//AAAAAAAAP/8AAAAAAAAf/4AAAAAAAA//gAAAAAAAB//AAAAAAAAH/8AAAAAAAAP/4AAAAAAAAf/gAAAAAAAA/+AAAAAAAAA/4AAAAAAAAA8AAAAAAAA","h":93,"w":65},"falco-rusticolus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAP/4AAAAAAAA//4AAAAAAAH//4AAAAAAAf//wAAAAAAA///gAAAAAAD///gAAAAAAP///AAAAAAB///+AAAAAAP///8AAAAAA////4AAAAAD////gAAAAAP///+AAAAAA////8AAAAAH////wAAAAAf////gAAAAB/////AAAAAH////+AAAAAf////8AAAAB/////8AAAAD/////wAAAAP/////gAAAA//////AAAAB/////+AAAAH/////4AAAAP/////wAAAA//////gAAAB/////+AAAAH/////8AAAAP/////4AAAAf/////wAAAB//////gAAAD//////AAAAH/////+AAAAP/////8AAAA//////4AAAB//////gAAAD//////AAAAP/////+AAAAf/////8AAAA//////4AAAB/////3gAAAD/////PAAAAH////8MAAAAf////wYAAAA////+BgAAAD////wHAAAAH////AGAAAAP///+AcAAAA////4BwAAAB////gDgAAAD///8AOAAAAH///wA4AAAAP///gBwAAAA///9ADAAAAB///yAMAAAAD//+EAwAAAAH//4YBAAAAAf//gwOAAAAA//8BwYAAAAD//wPDzwAAAP//h7P/4AAA//+DH//4AAD//8MHf/wAAP//4QH/+gAA///hgP/+AAD///OA+D8AAH//8YB4A4AAf//7gDAHgAB///mAHgGAAD///YAGAAAAP///gAAAAAA///+AAAAAAB/3/4AAAAAAB+f/AAAAAAADw/+AAAAAAAPD/4AAAAAAAYH/wAAAAAAAAP/AAAAAAAAA/+AAAAAAAAB/4AAAAAAAAH/wAAAAAAAAP/AAAAAAAAAf8AAAAAAAAB/4AAAAAAAAD/gAAAAAAAAH/AAAAAAAAAP8AAAAAAAAAfwAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA","h":93,"w":65},"falco-sparverius":{"bits":"AfwAAAAAAP/wAAAAAD//AAAAAA//8AAAAAP//wAAAAB///AAAAAP//4AAAAB///gAAAAP//8AAAAB///gAAAAP//8AAAAB///wAAAAP///AAAAB///8AAAAP///wAAAB////AAAAf///+AAAD////wAAAf////AAAH////8AAA/////wAAH////+AAA/////4AAH/////AAA/////8AAH/////gAA/////+AAH/////wAA/////+AAD/////4AAf/////AAD/////4AAf/////AAB/////8AAP/////gAA/////8AAH/////wAAf////+AAD/////wAAP////+AAB/////wAAH/////AAA/////4AAD/////AAAP////4AAA/////AAAD////4AAAP////AAAB////4AAAf////gAAD////+AAAf////wAAD/////AAAf////8AAB/////wAAH/////AAADj///8AAAAP///wAAAA////AAAAD/7/8AAAAf/P/wAAAB/88+AAAAP/nz4AAAB/8eHAAAAP/h4IAAAA/+HAAAAAH/wcAAAAA/+DgAAAAH/wMAAAAAf+AAAAAAD/4AAAAAAf/AAAAAAB/4AAAAAAP/AAAAAAB/4AAAAAAH/gAAAAAA/8AAAAAAH/gAAAAAAf8AAAAAAD/wAAAAAAf+AAAAAAB/wAAAAAAP+AAAAAAB/wAAAAAAH/AAAAAAA/4AAAAAAD/AAAAAAAf4AAAAAAB/gAAAAAAP8AAAAAAA/gAAAAAAD8AAAAAAALAA=","h":93,"w":51},"fregata-magnificens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf4AAAAAAAAAAAAAP/wAAAAAAAAAAAAD//AAAAAAAAAAAAB//8AAAAAAAAAAAD///wAAAAAAAAAP/////AAAAAAAAAH/////8AAAAAAAAB//////wAAAAAAAAP/////8AAAAAAAAB8AP///AAAAAAAAAIAD///4AAAAAAAAAAA////AAAAAAAAAAAP///wAAAAAAAAAAD///+AAAAAAAAAAA////wAAAAAAAAAAP////AAAAAAAAAAB////+AAAAAAAAAAf////8AAAAAAAAAD/////8AAAAAAAAA//////4AAAAAAAAH//////wAAAAAAAA///////gAAAAAAAP///////AAAAAAAB///////8AAAAAAAP///////wAAAAAAB////////gAAAAAAP////////AAAAAAB////////4AAAAAAP////////gAAAAAB/////////AAAAAAP////////4AAAAAB/////////gAAAAAP////////+AAAAAB/////////wAAAAAP/////////AAAAAB/////////8AAAAAH/////////wAAAAA//////////AAAAAH/////////8AAAAAf/////////gAAAAD/////////+AAAAAP/////////4AAAAB//////////gAAAAH/////////8AAAAAf/////////wAAAAB/////////+AAAAAH//n//////4AAAAAf/4f//////AAAAAA/8B//////8AAAAAB+AH/////+gAAAAAAAf//////+AAAAAAAD///////8AAAAAAA////////4AAAAAAPf///////wAAAAAB7//AH////gAAAAAH//AAP////AAAAAA/44AAf///+AAAAAD/CAAA////4AAAAAPwAAAH///fgAAAAA/AAAAf//+MAAAAAG8AAAB///4AAAAAADgAAAH/5/wAAAAAAAAAAAf/h/AAAAAAAAAAAB/+B8AAAAAAAAAAAH/4BgAAAAAAAAAAAf/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAAPAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"fregata-minor":{"bits":"AAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAD/gAAAAAAAAAAAA//AAAAAAAAAAAAf//gAAAAAAAAAAD//+AAAAAAAAAAA///4AAAAAAAAAAP///gAAAAAAAAAD///8AAAAAAAAAB////gAAAAAAAAA////4AAAAAAAAAf////AAAAAAAAAP////wAAAAAAAAf////+AAAAAAAAH/////wAAAAAAAB/+f//+AAAAAAAAP+H///gAAAAAAAB/B///8AAAAAAAAOAf///wAAAAAAABgH///+AAAAAAAAMA////4AAAAAAAAAP////wAAAAAAAAB/////AAAAAAAAAf////8AAAAAAAAD/////wAAAAAAAA//////gAAAAAAAH/////+AAAAAAAA//////4AAAAAAAH//////wAAAAAAA///////AAAAAAAH//////+AAAAAAA///////4AAAAAAH///////gAAAAAA///////+AAAAAAH///////4AAAAAA////////gAAAAAH///////+AAAAAAf///////4AAAAAD////////gAAAAAP///////8AAAAAB////////wAAAAAH///////+AAAAAAf///////4AAAAAA////////gAAAAAB9//////+AAAAAAAH//////4AAAAAAA///////gAAAAAAD//////8AAAAAAAP//////wAAAAAAA//////+AAAAAAAH//////wAAAAAAAf//////AAAAAAAA//////4AAAAAAAD//////gAAAAAAAP/////+AAAAAAAB//////wAAAAAAHv/////+AAAAAAH///////wAAAAAB////////AAAAAAP///////8AAAAABf///////4AAAAAD//+P////gAAAAAbf7wH///+AAAAABv+EAf///4AAAAAE/gAB////gAAAAAG8AAH///+AAAAAAzgAAf///8AAAAAAOAAA////wAAAAAAgAAH/3//AAAAAAAAAAf+P98AAAAAAAAAD/4fzgAAAAAAAAAP/h/EAAAAAAAAAB/8D8AAAAAAAAAAH/wHwAAAAAAAAAAf/APAAAAAAAAAAD/4AYAAAAAAAAAAP/gAAAAAAAAAAAA/8AAAAAAAAAAAAD/wAAAAAAAAAAAAP/AAAAAAAAAAAAAt4AAAAAAAAAAAAAHgAAAAAAAAAAAAAeAAAAAAAAAAAAABwAAAAAAAAAAAAAHAAAAAAAAAAAAAA4AAAAAAAAAAAAADgAAAAAAAAAAAAAcAAAAAAAAAAAAABwAAAAAAAAAAAAAOAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":87},"fulica-americana":{"bits":"AAAAAAAAAAAAAAAABgAAAAAAAAAAAAP+AAAAAAAAAAAA//wAAAAAAAAAAAz/+AAAAAAAAAAAR//gAAAAAAAAAAZ//4AAAAAAAAAAM//8AAAAAAAAAAE///AAAAAAAAAAC///wAAAAAAAAAD///4AAAAAAAAAD///8AAAAAAAAAD////AAAAAAAAAD////AAAAAAAAAB////gAAAAAAAAB+B//x/gAAAAAAA8B/////wAAAAAAYA//////gAAAAAAA//////8AAAAAAA///////gAAAAAA///////8AAAAAAf///////gAAAAAf///////4AAAAAP////////AAAAAH////////wAAAAH////////+AAAAD/////////gAAAB/////////4AAAA/////////+AAAAf/////////gAAAP/////////8AAAH//////////AAAD//////////wAAA//////////4AAAf/////////+AAAP//////////gAAD//////////wAAB//////////8AAAf//////////AAAH//////////wAAD//////////+AAA///////////gAAP//////////4AAD//////////+AAA///////////AAAH/////////5gAAB/////////+AAAAf/////////wAAAD/////////4AAAAf////////+AAAAD/////////gAAAAf////////wAAAAH////////4AAAAA////////8AAAAAH/////+H8AAAAAA/////8AAAAAAAAH////8AAAAAAAAB////4AAAAAAAAD////AAAAAAAAAB////wAAAAAAAAB////4AAAAAAAAB/5//8AAAAAAAAA/8H/8AAAAAAAAA/3B8cAAAAAAAAAf7g+AAAAAAAAAAP/wfAAAAAAAAAAH/4PgAAAAAAAAAB/4HgAAAAAAAAAA/4DwAAAAAAAAAAf4D4AAAAAAAAAAP9B4AAAAAAAAAADvg8AAAAAAAAAAB4A+AAAAAAAAAAAMAeAAAAAAAAAAAAAPAAAAAAAAAAAAAHgAAAAAAAAAAPgHwAAAAAAAAAAH8D4AAAAAAAAAAA/z8AAAAAAAAAAAf//4AAAAAAAAAA///+AAAAAAAAAP///8AAAAAAAAAf///gAAAAAAAAAN///wAAAAAAAAAAH/+AAAAAAAAAAAB/8AAAAAAAAAAAA/4AAAAAAAAAAAAfwAAAAAAAAAAAAfgAAAAAAAAAAAAfAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":85},"gallinago-delicata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAH/wAAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAD////wAAAAAAAAAA/////wAAAAAAAAAf/////gAAAAAAAAP8P////AAAAAAAAD+B////+AAAAAAAB/Af////8AAAAAAA/gD/////4AAAAAAfwA//////gAAAAAH4AH/////+AAAAAD8AA//////4AAAAB+AAH//////wAAAA/AAA///////AAAAPgAAH//////8AAABwAAA///////wAAAAAAAH///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAf///////4AAAAAAB////////gAAAAAAP///////+AAAAAAA////////8AAAAAAD////////gAAAAAAP///////+AAAAAAB////////4AAAAAAH////////wAAAAAAf////////gAAAAAB////////+AAAAAAH////////8AAAAAAf////////gAAAAAA////////8AAAAAAD//////8HAAAAAAAH////8AAAAAAAAAAP///+AAAAAAAAAAAf///AAAAAAAAAAAAf//gAAAAAAAAAAAB/4AAAAAAAAAAAAAH+AAAAAAAAAAAAAAfwAAAAAAAAAAAAADuAAAAAAAAAAAAAAdwAAAAAAAAAAAAADuAAAAAAAAAAAAAA5wAAAAAAAAAAAAAHOAAAAAAAAAAAAABxwAAAAAAAAAAAAAOMAAAAAAAAAAAAABzgAAAAAAAAAAAAAccAAAAAAAAAAAAADjgAAAAAAAAAAAH/8cAAAAAAAAAAAAf/74AAAAAAAAAAA////gAAAAAAAAAAP///gAAAAAAAAAABY//4AAAAAAAAAAAAP/uAAAAAAAAAAAAB4DgAAAAAAAAAAAAAA4AAAAAAAAAAAAAAOAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"gallinula-galeata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAf/gAAAAAAAAAAAf/4AAAAAAAAAAAP/+AAAAAAAAAAAP//gAAAAAAAAAAH//4AAAAAAAAAAP//8AAAAAAAAAAP//+AAAAAAAAAAP///gAAAAAAAAAP///wAAAAAAAAAP///4AAAAAAAAAHgf/8AAAAAAAAAAAD/+AAAAAAAAAAAA//AAAAAAAAAAAAf/gAAAAAAAAAAAf/wAAAAAAAAAAAP/4AAAAAAAAAAAP/8AAAAAAAAAAAH//AAAAAAAAAAAH////gAAAAAAAAD/////gAAAAAAAD/////+AAAAAAAB//////4AAAAAAA///////AAAAAAA///////4AAAAAAf///////AAAAAAP///////wAAAAAH///////+AAAAAD////////gAAAAB////////4AAAAA/////////AAAAAf////////4AAAAP/////////AAAAH/////////4AAAB/////////+AAAA//////////wAAAf//////////AAAH///////////AAD///////////4AA///////////8AAP//////////+AAH//////////+AAB//////////8AAAf/////////wAAAH/////////gAAAB/////////wAAAAf////////8AAAAH/////////AAAAB/////////gAAAAP////////AAAAAD////////AAAAAA//////+AAAAAAAH/////+AAAAAAAB/////8AAAAAAAAP////4AAAAAAAAB////wAAAAAAAAAf///gAAAAAAAAAH//+AAAAAAAAAAB//8AAAAAAAAAAAf++AAAAAAAAAAAH+PgAAAAAAAAAAB/DwAAAAAAAAAAAfB4AAAAAAAAAAAHg8AAAAAAAAAAAD4OAAAAAAAAAAAA8HAAAAAAAAAAAAfDgAAAAAAAAAAAPB4AAAAAAAAAAAHg8AAAAAAAAAAAHgeAAAAAAAAAAADwPAAAAAAAAAAADwHgAAAAAAAAAAB4DwAAAAAAAAAAA8B4AAAAAAAAAAA9w8AAAAAAAAAAAf+fAAAAAAAAAAAfP/4AAAAAAAAAB////AAAAAAAAAD///3gAAAAAAAB5P//xwAAAAAAAA/j7/AAAAAAAAAAD//+AAAAAAAAD////8AAAAAAAAD///+/AAAAAAAAAAGf+GgAAAAAAAAAB/gAAAAAAAAAAAH+AAAAAAAAAAAAH4AAAAAAAAAAAAGgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":85},"gallus-gallus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAB+gAAAAAAAH+AAAAP8AAAAAAAD/wAAAH/wAAAAAAB//wAAB/8AAAAAAA///gAAP/gAAAAAAf///AAD/4AAAAAAH///8AAf/AAAAAAB////wAD/8AAAAAAf////AAf/wAAAAAH////8AH//AAAAAB///33wB//8AAAAAf////fAP//wAAAAD///548AP//gAAAA////HnwB//+AAAAP///wcOAf//4AAAB///+Bh4D///gAAAf///8MHAf//+AAAD////wgcD///4AAAf///8ABgP///AAAH////gAMB///8AAA////4AAgP///4AAf////AAAD////gAH////8AAAf////gA/////gAAD/////4H////4AAAf/////4v///+AAAD//////0////gAAA///////v///8AAAD///////////wAAAf//////////+AAAD///////////wAAAf//////////8AAAD///////////AAAAP//////////4AAAB///////////AAAAP//////////4AAAA//////////+AAAAH/////////OwAAAAf////////pmAAAAB////////QJgAAAAH///////wAMAAAAAf//////8ABAAAAAB///////gAAAAAAAD//////8AAAAAAAAH//////gAAAAAAAAf/////8AAAAAAAAA//////gAAAAAAAAD/////8AAAAAAAAAP/////gAAAAAAAAAf///+AAAAAAAAAAB///6AAAAAAAAAAAH//8AAAAAAAAAAAAf//AAAAAAAAAAAAB//wAAAAAAAAAAAAD/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAe/AAAAAAAAAAAAADz4AAAAAAAAAAAAAPPAAAAAAAAAAAAAB9wAAAAAAAAAAAAAHuAAAAAAAAAAAAAAPwAAAAAAAAAAAAAAfgAAAAAAAAAAAAAD4AAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAAIeAAAAAAAAAAAAAD/+AAAAAAAAAAAAP//wAAAAAAAAAAAD//gAAAAAAAAAAAA0TwAAAAAAAAAAAAAB8AAAAAAAAAAAAAAcAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":80,"w":93},"gavia-adamsii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//AAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAP///gAAAAAAAAAAH///+AAAAAAAAAAD////wAAAAAAAAAB/////AAAAAAAAAD/////4AAAAAAAAD//////gAAAAAAAB//////8AAAAAAAA///////gAAAAAAAP//////+AAAAAAAB///////wAAAAAAAAHwP///+AAAAAAAAAAAf///wAAAAAAAAAAA///+AAAAAAAAAAAB///wAAAAAAAAAAAP//+AAAAAAAAAAAAf//gAAAAAAAAAAAH//8AAAAAAAAAAAB///gAAAAAAAAAAAf//8AAAAAAAAAAAH///gAAAAAAAAAAB///4AAAAAAAAAAA////AAAAAAAAAAAP///wAAAAAAAAAAD////+AAAAAAAAAA/////+AAAAAAAAAP/////8AAAAAAAAB///////AAAAAAAAf//////+AAAAAAAD///////8AAAAAAA////////4AAAAAAH////////gAAAAAA////////+AAAAAAP////////4AAAAAB/////////gAAAAAP////////+AAAAAB/////////4AAAAAP/////////gAAAAB/////////+AAAAAP/////////4AAAAB//////////AAAAAP/////////8AAAAA4/////////gAAAAHH////////+AAAAA4f////////4AAAADD/////////gAAAAYP////////8AAAABh/////////wAAAAOH////////+AAAAAwf////////4AAAADD/////////gAAAAMP////////8AAAABg/////////gAAAAGD////////+AAAAAYf////////wAAAABg////////+AAAAAMD////////wAAAAAwP///////+AAAAADA////////4AAAAAMD////////AAAAAAwH///////4AAAAADAf///////gAAAAAMD///////8AAAAAAwP///////wAAAAADg///////+AAAAAAGA///////wAAAAAAcB///////AAAAAABwf//////4AAAAAAfh///////AAAAAAD/P//////8AAAAAD/+f//////wAAAAD//////////AAAAA////gAH///8AAAAA///8AAf///gAAAAH///+AD///8AAAAB//+A//////gAAAAP8CQAAB///8AAAABwAAAAAH///gAAAAIAAAAAAf//4AAAAAAAAAAAA//+AAAAAAAAAAAAA/5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":88,"w":93},"gavia-immer":{"bits":"AAAP+AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//wAAAAAAAAAAAA///gAAAAAAAAAAAf//8AAAAAAAAAAB////wAAAAAAAAAD////+AAAAAAAAAD/////4AAAAAAAAA//////AAAAAAAAAA/////8AAAAAAAAAAAD///gAAAAAAAAAAAD//8AAAAAAAAAAAAH//gAAAAAAAAAAAAf/8AAAAAAAAAAAAA//gAAAAAAAAAAAAH/8AAAAAAAAAAAAA//gAAAAAAAAAAAAH/8AAAAAAAAAAAAB//gAAAAAAAAAAAAP/4B//AAAAAAAAAD//H///4AAAAAAAA///////4AAAAAAAP///////8AAAAAAD////////+AAAAAA/////////8AAAAAH//////////wAAAB///////////wAAAP//////////+AAAB///////////+AAAf///////////4AAD////////////gAAf///////////+AAB////////////4AAP////////////AAA////////////wAAD//////////P4AAAH////////8AEAAAAAf/////4AAAAA==","h":38,"w":93},"gavia-pacifica":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAA///4AAAAAAAAAAB////AAAAAAAAAAD////8AAAAAAAAAB/////gAAAAAAAAAP////8AAAAAAAAAAAB///wAAAAAAAAAAAB//+AAAAAAAAAAAAD//wAAAAAAAAAAAAH/+AAAAAAAAAAAAA//wAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAH/+A///4AAAAAAAB//x////8AAAAAAAP/8///////8AAAAD//////////+AAAA///////////gAAAE////9/////4AAABj///////////AAAIf//////////wAABD///////////gAAYf//////////8AADD///////////gAAYP//////////4AADAf/////////+AAAIA////////9/gAABgD///////84AAAAMAAf/////+cAAAAAwAAABv///nAAAAADAAAAAAH/hgAAAAAMAAAAAAPgYAAAAAA4AAAAAAeeAAAAAAB+AAAB8D/AAAAAAAB///A//8AAAAAAAAAf/f///gAAAAAAAAD/4P/n4AAAAAAAAAf+B/sAAAAAAAAAAA/wP8AAAAAAAAAAAD/A/AAAAAAAAAAAAYAD4AAAAAAAAAAABAAfAAAAAAAAAAAAAAD4AAAAAAAAAAAAAARgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":53,"w":93},"gavia-stellata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAH//+AAAAAAAAAAB////4AAAAAAAAAB/////AAAAAAAAAAP////8AAAAAAAAAAD////gAAAAAAAAAAAP//+AAAAAAAAAAAAf//wAAAAAAAAAAAA//+AAAAAAAAAAAAD//wAAAAAAAAAAAAP/+AAAAAAAAAAAAA//4AAAAAAAAAAAAH//AAAAAAAAAAAAA//4AAAAAAAAAAAAH//AAAAAAAAAAAAA//4AAAAAAAAAAAAP//AAAAAAAAAAAAB//wAAAAAAAAAAAAP/+AAAAAAAAAAAAD//wAAAAAAAAAAAA//8AAAAAAAAAAAAH//g//4AAAAAAAAB//9///8AAAAAAAAf//////8AAAAAAAD///////4AAAAAAA////////gAAAAAAEP///////AAAAAAAh///////+AAAAAAMP///////8AAAAABB////////4AAAAAIP////////wAAAABB/////////AAAAAIP////////8AAAABB/////////4AAAAIH/////////wAAABg//////////wAAAMH//////////gAAAgX//////////AAAGAf/////////8AAAQB4////////9gAADAAA////////4AAAMAAAf///////wAAA4AAAf///////gAADgAAAf//////8AAAHAAAAP//////gAAAPAAAAP//+H/8AAAAPwAAAP/8P/+AAAAAH+AAA/wHgGAAAAAAB/gAB+BwAAAAAAAAAf/+D/8AAAAAAAAAH///+YAAAAAAAAAAf///wAAAAAAAAAAD//n8AAAAAAAAAAB//EAAAAAAAAAAAAf/AAAAAAAAAAAAACPAAAAAAAAAAAAAABwAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":64,"w":93},"geococcyx-californianus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD0AAAAAAAAAADAAA/gAAAAAAAAAA4AAP+AAAAAAAAAAeAAD/wAAAAAAAAAPwAAf/gAAAAAAAAH/gAH/8AAAAAAAAB/8AA//AAAAAAAAA//AAP/8AAAAAAAAP/4AD//gAAAAAAAH/+A///8AAAAAAAB//4P///AAAAAAAA//+BP//4AAAAAAAP//wAD//AAAAAAAH//8AAP/4AAAAAAB//+AAA//AAAAAAAf//gAAD/8AAAAAAP//wAAAH/gAAAAAD//8AAAA/8AAAAAA//+AAAAH/wAAAAAP//gAAAAf+AAAAAH//wAAAAD/4AAAAB//8AAAAAf/gAAAAf/+AAAAAD/+AAAAH//AAAAAAf/8AAAD//wAAAAAD//4AAA//4AAAAAAf//wAAP/8AAAAAAD///gAD/+AAAAAAAf///AB//gAAAAAAD///+Af/wAAAAAAAP///4P/4AAAAAAAB//////+AAAAAAAAP//////AAAAAAAAB//////4AAAAAAAAP/////+AAAAAAAAB//////gAAAAAAAAP/////8AAAAAAAAB//////gAAAAAAAAP/////4AAAAAAAAA//////AAAAAAAAAH/////wAAAAAAAAAf////+AAAAAAAAAD/////gAAAAAAAAAP////4AAAAAAAAAA/////gAAAAAAAAAD/////AAAAAAAAAAP////8AAAAAAAAAAf////gAAAAAAAAAA///58AAAAAAAAAAD//+BgAAAAAAAAAAP//AAAAAAAAAAAAA//gAAAAAAAAAAAAB94AAAAAAAAAAAAAHOAAAAAAAAAAAAABxwAAAAAAAAAAAAAccAAAAAAAAAAAAAHjgAAAAAAAAAAAAB44AAAAAAAAAAAAAeHAAAAAAAAAAAAADgwAAAAAAAAAAAAB/+AAAAAAAAAAAAP/ZgAAAAAAAAAAAB///8AAAAAAAAAAAf7/+AAAAAAAAAAACN/wAAAAAAAAAAAAAr4AAAAAAAAAAAAAAcAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"geothlypis-formosa":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAYAAD//gAAAAAAAA/gAA///AAAAAAAA//AAP//+AAAAAAA//8AD////+AAAAAf//gB//////gAAAf//8D///////+AAP///B/////////wf///gP/////////////gAH////////////gAAH///////////gAAA///////////gAAAD//////////gAAAAf/////////gAAAAB/////////4AAAAAP////////+AAAAAA/////////gAAAAAH////////wAAAAAA/////////wAAAAAH/////////gAAAAAf////////+AAAAAD/////////4AAAAAf////////8AAAAAB////////AAAAAAAP///////AAAAAAAA///////wAAAAAAAH//////8AAAAAAAAf//////AAAAAAAAB//////4AAAAAAAAH/////+AAAAAAAAAf/////gAAAAAAAAB/////wAAAAAAAAAD////8AAAAAAAAAAP////AAAAAAAAAAAf///gAAAAAAAAAAAP//+AAAAAAAAAAAAfcHwAAAAAAAAAAAPgA8AAAAAAAAAAAD/wHgAAAAAAAAAAf//B4AAAAAAAAAAH//AeAAAAAAAAAAA/wAHgAAAAAAAAAAf8AB4AAAAAAAAAAHuAAeAAAAAAAAAAAxgAHgAAAAAAAAAAAIAB4AAAAAAAAAAAAAAeAAAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAA//5gAAAAAAAAAAAf/gAAAAAAAAAAAAHbwAAAAAAAAAAAAAg4AAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":58,"w":93},"geothlypis-philadelphia":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//8AAAAAAAAAAAB///wAAAAAAAAAAAf///gAAAAAAAAAAH////gAAAAAAAAAB/////AAAAAAAAAAf////8AAAAAAAAAH////8AAAAAAAAAB////4AAAAAAAAAB/////AAAAAAAAAA/////wAAAAAAAAAf////8AAAAAAAAAP/////gAAAAAAAAD/////8AAAAAAAAA//////AAAAAAAAAf/////4AAAAAAAAf//////AAAAAAAAP//////wAAAAAAAH///////AAAAAAAB///////wAAAAAAA///////+AAAAAAAP///////wAAAAAAD///////+AAAAAAA////////wAAAAAA////////8AAAAAAf////////gAAAAAP////////8AAAAAD/////////AAAAAA/////////4AAAAB/////////+AAAAB//////////wAAAB//////////8AAAB///////////AAAB///////////wAAA///g///////8AAAP//gAH//////AAAB//AAAP/////wAAAP+AAAA/////4AAAB+AAAAD////+AAAAAAAAAAH////AAAAAAAAAAAf///+AAAAAAAAAAAP///4AAAAAAAAAAB//g/gAAAAAAAAAAPgAe4AAAAAAAAAAA/AHnAAAAAAAAAAAA8A/4AAAAAAAAAAADwGeAAAAAAAAAAAAPATwAAAAAAAAAAAA8AIAAAAAAAAAAAAB4AAAAAAAAAAAAAAHwAAAAAAAAAAAAAA/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAHvgAAAAAAAAAAAAB54AAAAAAAAAAAAAOvAAAAAAAAAAAAAA3wAAAAAAAAAAAAAA+AAAAAAAAAAAAAABgAAAAAAAAAAAAAA8AAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAA","h":65,"w":93},"geothlypis-tolmiei":{"bits":"AAAAAAAAAAAAABAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAfngAAAAAAAAAAAAH//AAAAAAAAAAAAB//4AAAAAAAAAAAAf/+AAAAAAAAAAAAH//wAAAAAAAAAAAB//8AAAAAAAAAAAAf//AAAAAAAAAAAAH//wAAAAAAAAAAAB//8AAAAAAAAAAAAP//AAAAAAAAAAAAD//gAAAAAAAAAAAA//4AAAAAAAAAAAAP/+AAAAAAAAAAAAD//gAAAD/4AAAAAA//4AAAB//4AAAAAP/+AAAA///wAAAAD//AAAAP///gAAAB//wAAAD///+AAAA//8AAAA///////x///AAAA///////////wAAB///////////+AAAf///////////gAAH///////////8AAAH///////////gAAAD//////////4AAAAP//////////AAAAB//////////wAAAAH/////////+AAAAA//////////gAAAAH/////////8AAAAA//////////gAAAAD//////////AAAAAf//////////gAAAB///////////gAAAP///////////AAAB///////////4AAAP//////////8AAAA//////////wAAAAH/////////gAAAAA/////////gAAAAAH////////4AAAAAAf////////AAAAAAD////////4AAAAAAP///////+AAAAAAA////////gAAAAAAH///////8AAAAAAAf///////AAAAAAAB///////wAAAAAAAP//////+AAAAAAAAf//////gAAAAAAAB//////wAAAAAAAAH/////4AAAAAAAAAP////8AAAAAAAAAAf////AAAAAAAAAAA////gAAAAAAAAAAH////gAAAAAAAAAA/+B/+AAAAAAAAAAP+wP/QAAAAAAAAAA/wD6CAAAAAAAAAAH8A/cAAAAAAAAAAAfAH/gAAAAAAAAAAB4A/4AAAAAAAAAAAAAB+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAYAAAAAAAA=","h":68,"w":93},"geothlypis-trichas":{"bits":"AAAAAAAAAAAAAB4AAAAAAAAAAAAAA/gAAAAAAAAAAAAAP8AAAAcAAAAAAAAD/+AAB//AAAAAAAB//4AA//+AAAAAAAf//AAf//8AAAAAAH//wAH///wAAAAAB//+AB////gAAAAAf//gAf///+AAAAAH//wAH////8AAAAB//8AP/////+AAAA///Af///////gAAH//gH////////gAB//4A/////////gA//+AAP////////B///AAAP///////////wAAB///////////4AAAH//////////+AAAA///////////wAAAD//////////8AAAAf//////////gAAAD//////////4AAAAP//////////AAAAB//////////wAAAAP/////////8AAAAB//////////gAAAAP/////////4AAAAB//////////AAAAAH/////////8AAAAA//////////gAAAAH/////////+AAAAA//////////wAAAAH//////////AAAAA//////////+AAAAD//////////4AAAAf//////////gAAAB//////////+AAAAP//////////wAAAA/////////4OAAAAH////////gAAAAAAf///////8AAAAAAB////////gAAAAAAH///////4AAAAAAAf//////+AAAAAAAB///////gAAAAAAAH//////4AAAAAAAAP/////+AAAAAAAAA//////AAAAAAAAAB/////4AAAAAAAAAA////+AAAAAAAAAAAf///wAAAAAAAAAAB//54AAAAAAAAAAAfAAeAAAAAAAAAAAHgADgAAAAAAAAAAD7AA8AAAAAAAAAAA//APAAAAAAAAAAAP/4BwAAAAAAAAAAD4BAcAAAAAAAAAAB/AAHAAAAAAAAAAAfwAB4AAAAAAAAAAD+AAeeAAAAAAAAAAfwAH/8AAAAAAAAAB+AB/9gAAAAAAAAAPgB/AEAAAAAAAAAB+AP4AAAAAAAAAAAO4D/AAAAAAAAAAABgAbwAAAAAAAAAAAGAC+AAAAAAAAAAAA4AHwAAAAAAAAAAAAAB+AAAAAAAAAAAAAANgAAAAAAAAAAAAADnAAAAAAAAAAAAAAYYAAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAABAAAAAAAAAA=","h":77,"w":93},"glaucidium-gnoma":{"bits":"AAH/wAAAAAAf//gAAAAA///4AAAAA////AAAAB////wAAAB////8AAAB/////AAAA/////wAAA/////4AAAf////+AAAf/////AAAP/////wAAP/////4AAH/////8AAD//////AAB//////gAA//////wAAf/////4AAP/////8AAH//////AAD//////wAB//////8AA///////AA///////wAf//////8AP//////+AP///////gH///////4D///////8B////////A////////gf///////4P///////8H////////D////////h////////w////////8f///////+P////////H////////h////////4////////8f///////+P////////D////////g////////4H///////8D///////+A////////AP///////gH///////wB///////4A///////+AP///////AD///////gA///////wAf//////4AH//////8AB//////+AAf//////AAH//////gAB//////wAAf/////4AA//////8AAf/////+AAf/////+AAP8f////AAH8P////gAD+H////wAAPD////4AAAAP///8AAAAAH//+AAAAAB///AAAAAAP//gAAAAAH//wAAAAAD//wAAAAAB//4AAAAAAf/4AAAAAAP/+AAAAAAH//AAAAAAB//gAAAAAA//wAAAAAAf/8AAAAAAH/+AAAAAAD//AAAAAAA//gAAAAAAf/wAAAAAAP/4AAAAAAD/8AAAAAAB/+AAAAAAAf/AAAAAAAH/AAAAAAAAfAA==","h":93,"w":55},"grus-americana":{"bits":"AAAAAAAAAAAABAAAAAAAAAH8AAAAAAAAH/AAAAAAAAH/wAAAAAAAH/4AAAAAAAP/8AAAAAAAf/+AAAAAAA/h/AAAAAAA+APgAAAAAA8AHwAAAAAAQAH4AAAAAAAAH4AAAAAAAAD8AAAAAAAAD8AAAAAAAAB+AAAAAAAAB/AAAAAAAAA/gAAAAAAAAfwAAAAAAAAf4AAAAAAAAP8AAAAAAAAH+AAAAAAAAD/AAAAAAAAB/3/wAAAAAA////AAAAAAf///4AAAAAH///+AAAAAD////wAAAAA////8AAAAAf////gAAAAH////4AAAAD////+AAAAAf////wAAAAH////8AAAAB////+AAAAAP////gAAAAD////4AAAAA////+AAAAAf////AAAAAH////wAAAAD////+AAAAA/////gAAAAP////4AAAAD////+AAAAA/////AAAAAP////gAAAAD////4AAAAB////8AAAAA////+AAAAAf////AAAAAH////gAAAAD+///wAAAAA/D//4AAAAAPAf/8AAAAAHgH/8AAAAADYH/+AAAAABsA//AAAAAA2Af/gAAAAAbAG/wAAAAAPgDfwAAAAAH4AH4AAAAAB8ADsAAAAAA+AAkAAAAAA+AAQAAAAAAfAAAAAAAAAHgAAAAAAAADwAAAAAAAAB4AAAAAAAAA8AAAAAAAAA+AAAAAAAAAbAAAAAAAAANgAAAAAAAAGwAAAAAAAADYAAAAAAAABsAAAAAAAAA2AAAAAAAAAbAAAAAAAAANgAAAAAAAAGwAAAAAAAADYAAAAAAAAHsAAAAAAAAD/gAAAAAAAAfwAAAAAAAD/wAAAAAAAD2wAAAAAAAB/wAAAAAAAA/4AAAAAAAH/0AAAAAAADjgAAAAAAAAHgAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":61},"grus-grus":{"bits":"AAAAAAAAAAAAH/gAAH/+AAD//wAB//+AA///wAf//8AH///gD///8B////Af///wP///8D////g////4P///+D////g////4P///8D////A////wP///8D////A////wP///4B///+Af///AD///wA///8AH///AB///wAf//8AH///AB///wAf//8AH///AB///wAf//8AH//+AB//+AAT//gAA//4AAP/+AAD//wAA//8AAP//AAH//4AB//+AAf//gAH//4AD///AA///wAP//8AD///gB///4Af//+AH///gB///4Af///AH///wD///8A////AP///4H///+B////wf///8H////A////wB//8AAH/8AAA//AAAP/wAAD/8AAA//AAAP/wAAB/8AAAf+AAAH/gAAB/4AAAf+AAAD/gAAA/wAAAP8AAAD/AAAAfwAAAH8AAAB/AAAAf4AAAP+AAAD/gAAA/4AAAH8AAAAQAA","h":93,"w":32},"gymnogyps-californianus":{"bits":"AAAAAB/AAAAAAA/8AAAAAAf/gAAAAAH/+AAAAAD//wAAAAA//+AAAAAP//wAAAAD//8AAAAA///AAAAAP/3wAAAAD/wcAAAAB/8CAAAAA//wAAAAAP/+AAAAAH//gAAAAB//8AAAAAf//AAAAAH//wAAAAB//+AAAAA///gAAAA///4AAAA///+AAAAf///gAAAf///4AAAP///8AAAH////gAAD////8AAB/////gAA/////4AA/////+AAf/////gAP/////4AH/////+AB//////gA//////4Af/////+AH//////gD//////4B//////+Af//////gH//////wD//////8A///////Af//////wH//////8B//////+Af//////gP//////4D//////+A///////AP//////wH//////8B//////+A///////AP//////gH//////wA//////8AP/////+AH//////AB//////wAf/////4AH/////+AB//////gA//////4AP/////8AD//////AA//////gAP/////4AD/////8AA////5/AAP///+fwAD////H4AA////w+AAH///8PAAB///+BwAAf///gcAAP///4HAAD///eBwAA///3gcAAP//84HAAD///OBwAA///zg+AAN//85//wBf/+e///AH//v///4D//z/7/yA//4///+AH/8//9nwA/+PH1AMAP8Hg+AAAAABAHwAAAAAAA8AAAAAAABAAAA","h":93,"w":50},"gymnorhinus-cyanocephalus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/AAAAAAAAAAH//gAAAAAAAAB///gAAAAAAAAP///gAAAAAAAA////gAAAAAAAAP///gAAAAAAAAf///4AAAAAAAA////8AAAAAAAD////8AAAAAAAP////8AAAAAAAf////AAAAAAAB////AAAAAAAAD///4AAAAAAAAP///gAAAAAAAAf///AAAAAAAAB///+AAAAAAAAP///4AAAAAAAA////wAAAAAAAD////gAAAAAAAf////AAAAAAAB////+AAAAAAAH////8AAAAAAAf////4AAAAAAB/////wAAAAAAH/////gAAAAAAP/////AAAAAAA/////+AAAAAAD/////8AAAAAAH/////4AAAAAAf/////gAAAAAB//////AAAAAAH/////+AAAAAAf/////4AAAAAA//////wAAAAAD//////AAAAAAP/////+AAAAAAf/////4AAAAAB//////gAAAAAH//////AAAAAAP/////8AAAAAA//////wAAAAAB//////AAAAAAH/////8AAAAAAP/////4AAAAAAf/////gAAAAAB/////+AAAAAAD/////wAAAAAAH/////AAAAAAAP////8AAAAAAA/////wAAAAAAB//////AAAAAAH/////+AAAAAAf////f+AAAAAA////998AAAAAD///fzh4AAAAAP//4/mBwAAAAAf//g/0BgAAAABn/+AH4DAAAAAAf/4AD8EAAAAAA//gAB+AAAAAAB/8AAA/AAAAAAB/wAAH/gAAAAAD/AAAf/AAAAAAP+AAA4eAAAAAAf4AABgYAAAAAB/wAADAwAAAAAD/AAAADgAAAAAP+AAAADAAAAAA/4AAAAMAAAAAB/wAAAAAAAAAAH/AAAAAAAAAAAP+AAAAAAAAAAA/4AAAAAAAAAAB/wAAAAAAAAAAH/AAAAAAAAAAAP+AAAAAAAAAAA/4AAAAAAAAAAD/wAAAAAAAAAAH/AAAAAAAAAAAf8AAAAAAAAAAA/4AAAAAAAAAAD/gAAAAAAAAAAH/AAAAAAAAAAAf8AAAAAAAAAAA/4AAAAAAAAAAB/gAAAAAAAAAAH/AAAAAAAAAAAH8AAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":77},"haemorhous-cassinii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAA//gAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAAf//gAAAAAAAAAAAP//+AAAAAAAAAAAD///4AAAAAAAAAAA////AAAAAAAAAAAP///8AAAAAAAAAAB////wAAAAAAAAAAD////AAAAAAAAAAAH///4AAAAAAAAAAA////4AAAAAAAAAAH////wAAAAAAAAAA/////wAAAAAAAAAH/////gAAAAAAAAAf/////AAAAAAAAAD/////+AAAAAAAAAf/////4AAAAAAAAB//////wAAAAAAAAP//////AAAAAAAAB///////AAAAAAAAP//////+AAAAAAAB///////8AAAAAAAH///////wAAAAAAA////////AAAAAAAH///////+AAAAAAA////////4AAAAAAH////////wAAAAAAf////////AAAAAAD////////8AAAAAAP////////gAAAAAB/////////AAAAAAH////////8AAAAAA/////////4AAAAAD/////////gAAAAAP////////+AAAAAA/////////4AAAAAD/////////4AAAAAP/////////4AAAAA//////////wAAAAB//////////wAAAAH/////4P///gAAAAP////4AAH//AAAAAf///8AAAP/+AAAAAf//+AAAAf/8AAAAAf//AAAAAf/gAAAAB/+AAAAAA/4AAAAB//gAAAAAB+AAAAA//AAAAAAABwAAAAP/wAAAAAAAAAAAAB//AAAAAAAAAAAAAP+8AAAAAAAAAAAAD//AAAAAAAAAAAAAfh8AAAAAAAAAAAADwAgAAAAAAAAAAAAeAMAAAAAAAAAAAADgAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"haemorhous-mexicanus":{"bits":"AAf8AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//wAAAAAAAAAAAD///AAAAAAAAAAAB///+AAAAAAAAAAAf///4AAAAAAAAAAP////gAAAAAAAAAD////8AAAAAAAAAA/////wAAAAAAAAAAf////AAAAAAAAAAP////4AAAAAAAAAD/////gAAAAAAAAAf////8AAAAAAAAAAf////wAAAAAAAAAA////+AAAAAAAAAAH////4AAAAAAAAAA/////AAAAAAAAAAH////8AAAAAAAAAAf////4AAAAAAAAAD/////wAAAAAAAAAf/////AAAAAAAAAD/////+AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf//////AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAD///////wAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////gAAAAAAP///////+AAAAAAB////////4AAAAAAP////////gAAAAAA////////+AAAAAAH////////4AAAAAA/////////AAAAAAD////////8AAAAAAP////////wAAAAAB/////////AAAAAAH////////8AAAAAAf////////gAAAAAD////////+AAAAAAP////////4AAAAAA/////////AAAAAAD////////4AAAAAAP////////AAAAAAA////////8AAAAAAD////////wAAAAAAH////////AAAAAAAf///////8AAAAAAA////////4AAAAAAB////////gAAAAAAD///////+AAAAAAAH///////wAAAAAAAP///////AAAAAAAP//////+4AAAAAAP8D/////xAAAAAD/+AD84///AAAAAA//+AfgB//4AAAAAP//8P4AH//gAAAAB/wP34AAP/+AAAAAf8AH8AAA//4AAAAH3AA/AAAA//gAAAAwwAfgAAAB/+AAAAEHj//8AAAH/4AAAAgZ///wAAAf/gAAAAAP/i7AAAB/+AAAAABf4AYAAAH/4AAAAAP+AAAAAAf/AAAAAD7gAAAAAB/8AAAAAe4AAAAAAH/wAAAAGDAAAAAAA//AAAAAweAAAAAAD/8AAAAGBwAAAAAAP/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAB+AAAAAAAAAAAAAAGQ","h":89,"w":93},"haemorhous-purpureus":{"bits":"AA/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAP//4AAAAAAAAAAAD///wAAAAAAAAAAAf///AAAAAAAAAAAH///4AAAAAAAAAAD////gAAAAAAAAAB////+AAAAAAAAAAf////4AAAAAAAAAH/////AAAAAAAAAA/////8AAAAAAAAAH/////wAAAAAAAAAH////+AAAAAAAAAAP////4AAAAAAAAAA/////gAAAAAAAAAH////+AAAAAAAAAA/////4AAAAAAAAAH/////wAAAAAAAAAf/////AAAAAAAAAD/////+AAAAAAAAAf/////8AAAAAAAAB//////wAAAAAAAAP//////AAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAA///////+AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////+AAAAAAD////////4AAAAAAf////////gAAAAAD////////+AAAAAAP////////4AAAAAB/////////gAAAAAP////////+AAAAAA/////////wAAAAAH/////////AAAAAAf////////8AAAAAB/////////gAAAAAP////////+AAAAAA/////////8AAAAAD/////////wAAAAAP/////////AAAAAA/////////8AAAAAD/////////wAAAAAH/////////AAAAAAf////////wAAAAAA/////////AAAAAAB////////8AAAAAAH///////3gAAAAAAH///////AAAAAAAAP//////8AAAAAAAAf//+H//wAAAAAAAf///AP//AAAAAAAP//4AAf/8AAAAAAP///AAAf/wAAAAAB///wAAA//AAAAAAP//4AAAD/8AAAAAD//8AAAAP/4AAAAAf/+AAAAA//gAAAAD/+gAAAAD/+AAAAAP/gAAAAAP/4AAAAA//wAAAAA//gAAAAH//AAAAAD//AAAAA/D8AAAAAP/8AAAAPwHgAAAAA//gAAAB8AMAAAAAD/+AAAAHgDAAAAAAP/4AAAA9gAAAAAAA//AAAAD4AAAAAAAD/4AAAAPQAAAAAAAP4AAAAA+AAAAAAAA/AAAAADgAAAAAAAD4AAAAAAAAAAAAAAPAA==","h":79,"w":93},"haliaeetus-leucocephalus":{"bits":"AAfwAAAAAAAAAH/4AAAAAAAAB//wAAAAAAAAP//gAAAAAAAB///AAAAAAAAP//+AAAAAAAA///4AAAAAAAH///wAAAAAAAf///AAAAAAAB///8AAAAAAAH///gAAAAAAAf//+AAAAAAAD///wAAAAAAAP///AAAAAAAA///+AAAAAAAD///+AAAAAAAP///+AAAAAAA////+AAAAAAD////+AAAAAAP////+AAAAAA/////8AAAAAD/////4AAAAAP/////4AAAAA//////4AAAAP//////4AAAB///////wAAAH///////gAAA////////AAAD///////+AAAP///////8AAA////////4AAD////////wAAP////////AAA////////+AAD////////8AAH////////wAAf////////AAB////////+AAD////////8AAP////////wAA/////////gAB/////////AAH////////8AAP////////4AA/////////wAD/////////AAH////////8AAf////////gAA/////////AAD////////8AAH////////4AAf////////wAA/////////AAB////////8AAD////////4AAH////////gAAH///////+AAAP///////8AAAf///////wAAA////////AAAB///////8AAAD///////wAAAP///////AAAAf//////+AAAB///////4AAAH///////gAAAf//////+AAAA//v////4AAAD/+f////AAAAP/x////+AAAAf/H////4AAAB/4f////gAAAH/x/////AAAAP/H////+AAAA/8P////4AAAD/x/////wAAAP8H/////AAAAfwH////+AAADwAf////4AAP/8D/f///gAD//8fA//++AAf///+D//54AB/////v//jwAH/A///f//HAAd8H//9//8cABngY/77//wwACeBnzhH//hAABwC+PEP/+AAADwDw8AP/4AAAAAPDwAf/wAAAAAwPAAf/AAAAADB4AAf8AAAAAEDAAA+AA==","h":93,"w":70},"helmitheros-vermivorum":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPgAAAAAAAAAAAAAH4AAAAAAAAAAAAD/+AAAAAAAAAAAAH//gAAAAAAAAAAAD//wAAAAAAAAAAAB//8AAAAAAAAAAAA///gAAAAAAAAAAAP//4AAAAAAAAAAAD///AAAAAAAAAAAA///4AAAAAAAAAAAP//+AAAAAAAAAAAD///wAAAAAAAAAAA///+AAAAAAAAAAAP///wAAAAAAAAAAD///+AAAAAAAAAAB////gAAAAAAAAAA////8AAAAAAAAAAf////gAAAAAAAAAP////8AAAAAAAAAD/////gAAAAAAAAB/////8AAAAAAAAAf/////gAAAAAAAAP/////8AAAAAAAAH//////gAAAAAAAH//////8AAAAAAAB///////gAAAAAAA///////8AAAAAAAP///////AAAAAAAH///////4AAAAAAB////////AAAAAAAf///////4AAAAAAH///////+AAAAAAD////////wAAAAAB////////8AAAAAA/////////gAAAAAf////////4AAAAAH////////+AAAAAAf////////gAAAAAP////////4AAAAAD////////+AAAAAB/////////gAAAAB/////////4AAAAA//////////gAAAAf/////////4AAAAf/8AAf/////AAAAP/8AAAf///nwAAAH/+AAAAf//AAAAAB//AAAAAP4AAAAAAH/gAAAAB//8AAAAA/gAAAAAD//8AAAABgAAAAAAAB/gAAAAAAAAAAAAAP+AAAAAAAAAAAAAB/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":60,"w":93},"himantopus-mexicanus":{"bits":"AAA/AAAAAAAAA/8AAAAAAAAP/AAAAAAAAD/4AAAAAAAB/+AAAAAAAB//gAAAAAAB//4AAAAAAB+P+AAAAAAA8B/gAAAAAA8AfwAAAAAA8AH8AAAAAA8AB/AAAAAA8AAfgAAAAAMAAP4AAAAAAAAD+AAAAAAAAA//gAAAAAAAP//AAAAAAAD//8AAAAAAA///wAAAAAAP///AAAAAAD///4AAAAAA////AAAAAAH///4AAAAAB////AAAAAAP///4AAAAAD////AAAAAA////4AAAAAH////AAAAAB////4AAAAAP///+AAAAAD////wAAAAAf///+AAAAAD////wAAAAAf///8AAAAAD////gAAAAAP///8AAAAAA////gAAAAAP///4AAAAAB////AAAAAAf///8AAAAAD////gAAAAAbwD/+AAAAAGcAf/wAAAABmAD/8AAAAAdwAfeAAAAADMAD5gAAAAAzAAeAAAAAAMwAAAAAAAADOAAAAAAAAA5gAAAAAAAAGYAAAAAAAABmAAAAAAAAAZwAAAAAAAAHMAAAAAAAABzAAAAAAAAAM4AAAAAAAAHuAAAAAAAABzgAAAAAAAAc4AAAAAAAADOAAAAAAAAAxgAAAAAAAAMYAAAAAAAADGAAAAAAAABxgAAAAAAAAcYAAAAAAAAHOAAAAAAAABzgAAAAAAAAY4AAAAAAAAGMAAAAAAAABjAAAAAAAAAYwAAAAAAAAGMAAAAAAAABjAAAAAAAAAYwAAAAAAAAGMAAAAAAAABjAAAAAAAAAYwAAAAAAAAGMAAAAAAAABjAAAAAAAAAYwAAAAAAAAGMAAAAAAAABjAAAAAAABx8wAAAAAAAf/MAAAAAAAf/TgAAAAAAP3/8AAAAAAAP/8AAAAAAAHgfAAAAAAABAfgAAAAAAAAeYAAAAAAAAOGAAAAAAAAGDAAAAAAAAAAgAAAA==","h":93,"w":62},"hirundo-rustica":{"bits":"AH8AAAAAAAAAB/8AAAAAAAAAf/4AAAAAAAAD//wAAAAAAAD///gAAAAAAAP///AAAAAAAAH//8AAAAAAAAH//4AAAAAAAAf//gAAAAAAAA//+AAAAAAAAD//8AAAAAAAAP//8AAAAAAAA///4AAAAAAAD///wAAAAAAAP///gAAAAAAA////AAAAAAAD///+AAAAAAAf///8AAAAAAA////4AAAAAAD////wAAAAAAP////AAAAAAA////+AAAAAAD////8AAAAAAH////4AAAAAAf////gAAAAAB/////AAAAAAD////+AAAAAAP////4AAAAAAf////wAAAAAA/////gAAAAAD////+AAAAAAH////8AAAAAAP////wAAAAAAf////gAAAAAB////+AAAAAAD////8AAAAAAH////wAAAAAAP////gAAAAAAP////AAAAAAB////+AAAAAAH////4AAAAAAf////wAAAAAB/////gAAAAAH////+AAAAAAHn///8AAAAAAAA///4AAAAAAAA///wAAAAAAAB///gAAAAAAAD//+AAAAAAAAH//8AAAAAAAAP//4AAAAAAAAf//wAAAAAAAA///gAAAAAAAB///AAAAAAAAD//8AAAAAAAAP+/4AAAAAAAA/9/wAAAAAAAB/5/gAAAAAAAH/h/AAAAAAAAP/BwAAAAAAAA/+AAAAAAAAAD/4AAAAAAAAAH/wAAAAAAAAAfHgAAAAAAAAA8PAAAAAAAAADwcAAAAAAAAAPA4AAAAAAAAAcBwAAAAAAAABwDgAAAAAAAADgOAAAAAAAAAOAcAAAAAAAAA4A4AAAAAAAABwBwAAAAAAAAHADAAAAAAAAAMAGAAAAAAAAA4AcAAAAAAAADgAwAAAAAAAAGABgAAAAAAAAcADAAAAAAAAAwAMAAAAAAAADgAYAAAAAAAAGAAwAAAAAAAAYADAAAAAAAAAwAGAAAAAAAADAAIAAAAAAAAGAAwAAAAAAAAYABAAAAAAAAAwAAAAAAAAAADAAAAAAAAAAAGAAAAAAAAAAAIAAAAAAAAAAAwAAAAAAAAAABAAA==","h":93,"w":70},"hydrocoloeus-minutus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAB/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAB//+AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAH///8AAAAAAAAAAD////gAAAAAAAAAA////+AAAAAAAAAAP////wAAAAAAAAAB4P//+AAAAAAAAAAAAf//wAAAAAAAAAAAD///AAAAAAAAAAAAf///gAAAAAAAAAAD////8AAAAAAAAAAf////+AAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAP//////4AAAAAAAB///////4AAAAAAAP///////gAAAAAAB////////gAAAAAAP////////wAAAAAB/////////gAAAAAP/////////AAAAAB/////////8AAAAAP//////////wAAAB////////////gAAP////////////4AA/////////////gAH////////////4AAf///////////+AAD////////////8AAP////////////AAA////////////gAAD//////////+AAAAP/////////weAAAA/////////8P8AAAD/////8B+B//gAAAH////wB8AAHwAAAAP///+AcAAAAAAAAA////gOAAAAAAAAAA////HAAAAAAAAAAA////gAAAAAAAAAAAf//wAAAAAAAAAAAA7/AAAAAAAAAAAAAHHgAAAAAAAAAAAAA4cAAAAAAAAAAAAAHHgAAAAAAAAAAAAA48AAAAAAAAAAAAAHDgAAAAAAAAAAAAA4YAAAAAAAAAAAAAHjAAAAAAAAAAAAB/8YAAAAAAAAAAAAf/DAAAAAAAAAAAAA/4YAAAAAAAAAAAAH/HgAAAAAAAAAAAA/x8AAAAAAAAAAAAOf/AAAAAAAAAAAAAD/4AAAAAAAAAAAAAH/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAP/AAAAAAAAAAAAABjwAAAAAAAAAAAAAAMAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"hydroprogne-caspia":{"bits":"AAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAf///AAAAAAAAAAAf///4AAAAAAAAAAP////gAAAAAAAAAH////8AAAAAAAAAD/////wAAAAAAAAA/9////gAAAAAAAAGAB////4AAAAAAAAAAP////8AAAAAAAAAB/////8AAAAAAAAAf/////4AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAD///////+AAAAAAAf////////gAAAAAD/////////AAAAAAf////////8AB/4AD/////////////AAf////////////AAB////////////AAAP////////////4AA/////////////AAH////////////gAAf///////////gAAD///////////AAAAP//////////8AAAA////////////AAAD///////////4AAAP//////4AAAAAAAA//////8AAAAAAAAD/////+AAAAAAAAAP////+AAAAAAAAAAf////gAAAAAAAAAA////wAAAAAAAAAAA///4AAAAAAAAAAAB//+AAAAAAAAAAAAH/8AAAAAAAAAAAAAfwAAAAAAAAAAAAAD8AAAAAAAAAAAAAAfAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAeAAAAAAAAAAAAAADwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAHgAAAAAAAAAAAAB/+AAAAAAAAAAAAAP/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/gAAAAAAAAAAAAAcAAAAAAAAAAA==","h":54,"w":93},"hylocichla-mustelina":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/AAAAAAAAAAAAAAf4AAAB/wAAAAAAAH/+AAB//gAAAAAAB//wAAf//AAAAAAAP//gH///8AAAAAAD//8H////wAAAAAA///h/////AAAAAAP//8D////8AAAAAB///AD////wAAAAAf//4AD///+AAAAAH//8AAf///4AAAAB///AAB////gAAAAf//wAAP///+AAAAD//8AAA/////AAAA///AAAD/////gAAP//wAAAf/////gAD//8AAAB//////AB//+AAAAP//////j///gAAAA//////////4AAAAH/////////+AAAAA//////////gAAAAH/////////8AAAAA//////////AAAAAH/////////QAAAAA/////////2AAAAAH////////8gAAAAA/////////sAAAAAH////////5AAAAAA////////+YAAAAAD////////yAAAAAAf////////wAAAAAD////////8AAAAAAf////////gAAAAAB////////+AAAAAAP////////8AAAAAA/////////wAAAAAH/////////gAAAAAf/////////AAAAAD/////////8AAAAAP/////////wAAAAA/////////8AAAAAD//////8AAAAAAAAP//////AAAAAAAAA//////wAAAAAAAAD/////8AAAAAAAAAH/////AAAAAAAAAAP////gAAAAAAAAAAf///4AAAAAAAAAAA////AAAAAAAAAAAAf//4AAAAAAAAAAAAeA/AAAAAAAAAAAADwDwAAAAAAAAAAAA4AcAAAAAAAAAAAAPAHgAAAAAAAAAAADgA4AAAAAAAAAAAA8APAAAAAAAAAAAAPABwAAAAAAAAAAADwAcAAAAAAAAAAAA8ADgAAAAAAAAAAAPGA4AAAAAAAAAAAD/4HAAAAAAAAAAAB/8BwAAAAAAAAAAP/7AOAAAAAAAAAAH/4ADj4AAAAAAAAA9+AA/9AAAAAAAAAAfwAP/AAAAAAAAAAPcB/8AAAAAAAAAAD3A/+AAAAAAAAAAA84HvwAAAAAAAAAAMGAD8AAAAAAAAAABgwB7gAAAAAAAAAAIAAe4AAAAAAAAAAAAAPnAAAAAAAAAAAAADowAAAAAAAAAAAAAYEAAAAAAAAAAAAACAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":81,"w":93},"icteria-virens":{"bits":"AAAAAAAAAAAAAAfgAAAAAAAAAAAAAP/AAAAAAAAAAAAAH/4AAAAAAAAAAAAD//AAAAAAAAAAAAA//4AAAAAAAAAAAAf//AAAAAAAAAAAAP//wAAAAAAAAAAAD//8AAAAAAAAAAAB///AAAAAAAAAAAA///gAAD4AAAAAAAf//wAAH/8AAAD/////4AAD//8D///////8AAA///////////+AAAf///////////AAAH///////////AAAB///////////wAAB///////////8AAAf///////////AAAH///////////8AAA////////////gAAAH//////////4AAAA//////////4AAAAD/////////+AAAAAP/////////gAAAAA/////////4AAAAAH////////+AAAAAAf////////wAAAAAB////////8AAAAAAH////////gAAAAAAf///////4AAAAAAB///////+AAAAAAAP///////wAAAAAAA///////8AAAAAAAD///////AAAAAAAAP//////wAAAAAAAA//////4AAAAAAAAB/////+AAAAAAAAAH/////gAAAAAAAAAP////+AAAAAAAAAAf////wAAAAAAAAAA////+AAAAAAAAAAAH/wPgAAAAAAAAAAD/+D8AAAAAAAAAAAfAw+AAAAAAAAAAAHwAfAAAAAAAAAAAA/AHgAAAAAAAAAAAH4D4AAAAAAAAAAAAeh9gAAAAAAAAAAAB8f/AAAAAAAAAAAAHf/4AAAAAAAAAAAAD8BAAAAAAAAAAAAA/gAAAAAAAAAAAAAH4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPkAAAAAAAAAAAAAA/gAAAAAAAAAAAAAHQAAAAAAAAAAAAAAeAAAAAAAAA=","h":60,"w":93},"icterus-bullockii":{"bits":"AAAAAAAAAAAA/AAAAAAAAAAAAAA//AAAAAAAAAAAAAf/+AAAAAAAAAAAAH//8AAAAAAAAAAAB////AAAAAAAAAAAf///+AAAAAAAAAAH////4AAAAAAAAAB////8AAAAAAAAAAP///wAAAAAAAAAAD///8AAAAAAAAAAA////AAAAAAAAAAAP///4AAAAAAAAAAH///+AAAAAAAAAAD////gAAAAAAAAAB////4AAAAAAAAAA/////AAAAAAAAAAf////wAAAAAAAAAH////+AAAAAAAAAD/////wAAAAAAAAA/////+AAAAAAAAAf/////gAAAAAAAAH/////8AAAAAAAAD//////gAAAAAAAB//////8AAAAAAAAf//////gAAAAAAAH//////8AAAAAAAD///////AAAAAAAA///////4AAAAAAAP//////+AAAAAAAD///////wAAAAAAA///////8AAAAAAAP///////gAAAAAAD///////4AAAAAAAf//////+AAAAAAAH///////gAAAAAAB///////4AAAAAAAP//////+AAAAAAAD///////gAAAAAAB///////4AAAAAAAf//////+AAAAAAAP///////AAAAAAAD///////wAAAAAAA///////4AAAAAAAP//////8AAAAAAAA//////+AAAAAAAAD//////AAAAAAAAA///////AAAAAAAAf//Af/3/gAAAAAAH//gAP4D/gAAAAAB//wAA/gD/AAAAAA//wAAD/g/4AAAAAP/wAAAB//PgAAAAD/8AAAAB/g8AAAAA//AAAAAB/HAAAAAP/wAAAAAP/4AAAAH/8AAAAAB/+AAAAB/+AAAAAA//wAAAAf/gAAAAAP8+AAAAH/4AAAAAB/HgAAAB/+AAAAAAN/4AAAAP/gAAAAABt/AAAAD/4AAAAAAG/wAAAA/+AAAAAAAD+AAAAH/gAAAAAAADwAAAAf4AAAAAAAA4AAAAB+AAAAAAAAAAAAAADAAAAAAAAAAAAAAA=","h":67,"w":93},"icterus-cucullatus":{"bits":"AAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAAf//AAAAAAAAAAAAP//8AAAAAAAAAAAP///wAAAAAAAAAAP////gAAAAAAAAAH////+AAAAAAAAAB//////gAAAAAAAAf//////gAAAAAAAHwf/////AAAAAAAAwA/////+AAAAAAAAAB/////8AAAAAAAAAH/////4AAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAP/////8AAAAAAAAB//////wAAAAAAAAH//////AAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAAf//////gAAAAAAAD//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAH//////+AAAAAAAA///////4AAAAAAAD///////gAAAAAAAP//////8AAAAAAAA///////wAAAAAAAD///////AAAAAAAAP//////+AAAAAAAAf//////4AAAAAAAB///////gAAAAAAAD//////+AAAAAAAAH//////wAAAAAAAAP/////8AAAAAAAAAf/////gAAAAAAAAB/////4AAAAAAAAA/f/x//gAAAAAAAAP//AD/+AAAAAAAABx74AD/4AAAAAAAAMD+AAD/gAAAAAAADgfgAAP+AAAAAAAAMPwAAA/8AAAAAAABn4AAAD/wAAAAAAAH8AAAAP/AAAAAAAA/8AAAA/8AAAAAAAP/gAAAD/wAAAAAAB4eAAAAP/AAAAAAAeAwAAAA/8AAAAAABgMAAAAB/wAAAAAAMAAAAAAH/AAAAAABgAAAAAA/8AAAAAAMAAAAAAB/wAAAAAAgAAAAAAH/AAAAAAAAAAAAAAf8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAH+AAAAAAAAAAAAAAf4AAAAAAAAAAAAAB/AAAAAAAAAAAAAAHwA=","h":61,"w":93},"icterus-galbula":{"bits":"AAD/AAAAAAAAAAAA//wAAAAAAAAAAD//wAAAAAAAAAAf//wAAAAAAAAAP///4AAAAAAAAD////wAAAAAAAAf////wAAAAAAAB/////wAAAAAAAA/////wAAAAAAAAD////gAAAAAAAAB////gAAAAAAAAB////AAAAAAAAAB////AAAAAAAAAB////AAAAAAAAAD////gAAAAAAAAD////wAAAAAAAAH////4AAAAAAAAH////4AAAAAAAAP////8AAAAAAAA/////8AAAAAAAB/////8AAAAAAAD/////8AAAAAAAH/////8AAAAAAAP/////8AAAAAAAf/////8AAAAAAA//////8AAAAAAB//////8AAAAAAD//////8AAAAAAH//////4AAAAAAP//////8AAAAAAP//////8AAAAAAf//////8AAAAAA///////8AAAAAA///////8AAAAAB///////4AAAAAB///////4AAAAAD///////4AAAAAD///////wAAAAAD///////wAAAAAH///////wAAAAAH///////gAAAAAH///////gAAAAAH///////AAAAAAP//////+AAAAAAP//////+AAAAAAP//////4AAAAAAH//////wAAAAAAH//////wAAAAAAH//////wAAAAAAD//////gAAAAAAD//////gAAAAAA///////gAAAAAD///////gAAAAAP/P/////gAAAAAfPn/////gAAAAAcng/////gAAAAA7Hf/////AAAAAB+f//////AAAAAB//4Of/78AAAAAD/4AAf/xwAAAAAH/8AAf/wAAAAAAB4+AAf/gAAAAAAHycAAf/AAAAAAAPm8AAf+AAAAAAAP84AA/+AAAAAAAP5gAA/8AAAAAAAf+AAB/8AAAAAAAHwAAB/8AAAAAAAAAAAD/4AAAAAAAAAAAH/4AAAAAAAAAAAH/wAAAAAAAAAAAP/wAAAAAAAAAAAP/gAAAAAAAAAAAf/gAAAAAAAAAAAf/gAAAAAAAAAAA//AAAAAAAAAAAA//AAAAAAAAAAAB/+AAAAAAAAAAAB/+AAAAAAAAAAAD/8AAAAAAAAAAAD/8AAAAAAAAAAAH/4AAAAAAAAAAAH/4AAAAAAAAAAAP/wAAAAAAAAAAAP/wAAAAAAAAAAAf/gAAAAAAAAAAAf/gAAAAAAAAAAA//AAAAAAAAAAAA//AAAAAAAAAAAA/+AAAAAAAAAAAA/+AAAAAAAAAAAAT8AAAAAAAAAAAAB4=","h":93,"w":83},"icterus-parisorum":{"bits":"AAAAAAAAAP8AAAAAAAAAAAP/wAAAAAAAAAAP//AAAAAAAAAAP///AAAAAAAAAH////AAAAAAAAD////8AAAAAAAB/////wAAAAAAAf////8AAAAAAAP////AAAAAAAAD///8AAAAAAAAB///+AAAAAAAAA////AAAAAAAAAP///gAAAAAAAAH///wAAAAAAAAD///8AAAAAAAAB////AAAAAAAAB////gAAAAAAAA////4AAAAAAAA////+AAAAAAAAf////gAAAAAAAP////8AAAAAAAP/////AAAAAAAD/////wAAAAAAB/////8AAAAAAA//////AAAAAAAf/////wAAAAAAP/////8AAAAAAH//////AAAAAAB//////wAAAAAA//////8AAAAAAf/////+AAAAAAP//////gAAAAAH//////4AAAAAD//////8AAAAAB///////AAAAAA///////gAAAAAP//////4AAAAAH//////8AAAAAD///////AAAAAA///////gAAAAAf//////wAAAAAH//////8AAAAAD//////+AAAAAB///////AAAAAAf//////gAAAAAP//////wAAAAAD//////4AAAAAA//////8AAAAAAH/////+AAAAAAD/////+AAAAAAB//////AAAAAAA//////+AAAAAAP//////4AAAAAH/////n/AAAAAD/////j/wAAAAB/////h58AAAAAfP//+A+fAAAAAPn///AP/gAAAADx///8DPwAAAABwf/4Pg48AAAAAYP/8A+D+AAAAAAD/+AH4GAAAAAAB//AAfAAAAAAAAf/gAD8AAAAAAAP/wAA/gAAAAAAD/8AAf8AAAAAAB/+AAefgAAAAAA//gAHn4AAAAAAP/wAB58AAAAAAD/8AAb8AAAAAAB/+AAH/AAAAAAAf/gAA3wAAAAAAP/4AAA4AAAAAAH/8AAA8AAAAAAB//AAAAAAAAAAA//gAAAAAAAAAAP/4AAAAAAAAAAH/8AAAAAAAAAAB//AAAAAAAAAAA//wAAAAAAAAAAP/4AAAAAAAAAAH/+AAAAAAAAAAB//AAAAAAAAAAAf/wAAAAAAAAAAP/4AAAAAAAAAAD/+AAAAAAAAAAB//AAAAAAAAAAAf/wAAAAAAAAAAH/4AAAAAAAAAAD/+AAAAAAAAAAA/+AAAAAAAAAAAP4AAAAAAAAAAAD4AAAAAAAAAAAA","h":93,"w":80},"icterus-spurius":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAH/8AAAAAAAAH//+AAAAAAAB///+AAAAAAAD///+AAAAAAAB///+AAAAAAAA///8AAAAAAAA///8AAAAAAAB///4AAAAAAAD///4AAAAAAAH///wAAAAAAAP///gAAAAAAAP///gAAAAAAAf///AAAAAAAA///+AAAAAAAB///8AAAAAAAD///4AAAAAAAf///wAAAAAAB////gAAAAAAP////AAAAAAA////+AAAAAAH////8AAAAAAf////4AAAAAB/////wAAAAAH/////gAAAAAf/////AAAAAB/////+AAAAAH/////8AAAAAf/////4AAAAB//////wAAAAD//////gAAAAP//////AAAAA//////+AAAAB//////8AAAAH//////wAAAAf//////gAAAB///////AAAAH//////8AAAAf//////4AAAA///////gAAAD///////AAAAH//////8AAAAf//////4AAAA///////gAAAD//////+AAAAP//////4AAAAf//////wAAAB///////AAAAD//////8AAAAH//////wAAAAf//////AAAAA//////8AAAAB//////wAAAAD/////+AAAAAH/////4AAAAAf/////AAAAAA/////4AAAAAD/////4AAAAAP/////+AAAAAf///4z/wAAAB///+AAf4AAADv/58AAf4AAAO//g8AH/8AAAZ/+A8APH4AAAH/4A8AwH4AAAf/gAeAgPgAAA//AAeAAfAAAD/8AAeAAYAAAP/4AP/ADwAAAf/gA//gDgAAB//AB4/gOAAAH/8ACA/AAAAAP/wAEB+AAAAA//gAABwAAAAB/+AAADgAAAAH/8AAAPAAAAAf/wAAAcAAAAA//gAAB4AAAAD/+AAADgAAAAP/8AAAAAAAAAf/wAAAAAAAAB//gAAAAAAAAH/+AAAAAAAAAP/8AAAAAAAAAf/wAAAAAAAAB//AAAAAAAAAD/8AAAAAAAAAH/wAAAAAAAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":71},"ictinia-mississippiensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAH+AAAAAAH/4AAAAAH//AAAAAD//wAAAAB//+AAAAAf//wAAAAH//8AAAAD///AAAAA///wAAAAP//wAAAAH//4AAAAD//+AAAAB///gAAAA///4AAAAf///AAAAP///4AAAH///+AAAB////gAAA////8AAAf////AAAH////wAAD////8AAA/////AAAf////wAAH////8AAB/////AAA/////wAAP////8AAD/////AAA/////wAAP////8AAH/////AAB/////wAAf////8AAH////+AAD/////gAA/////4AAP////8AAD/////AAB/////gAAf////wAAH////4AAB////8AAAf////AAAH////gAAB////4AAAf///8AAAH////AAAA////8AAAP////gAAH////4AAB////8AAAf///8AAAP///mAAAH///4AAAD///8AAAA///8AAAAf///AAAAP///gAAAH///wAAAD///wAAAB///4AAAA///+AAAAP///gAAAH///4AAAD8//8AAAA+P//AAAAMH//gAAAAB//4AAAAAf/+AAAAAP//AAAAAD//wAAAAB//8AAAAAf/+AAAAAP//gAAAAD//4AAAAB//+AAAAAf//AAAAAP//wAAAAD//8AAAAB//+AAAAAf//gAAAAH//4AAAAB//8AAAAAH//AAAAAB7/gAAAAAc/4AAAAACM8AAAAAADAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":50},"ixoreus-naevius":{"bits":"AAD8AAAAAAAAAAAAAB/8AAAAAAAAAAAAB//4AAAAAAAAAAAAf//gAAAAAAAAAAf///+AAAAAAAAAAH////4AAAAAAAAAAf////gAAAAAAAAAAf///+AAAAAAAAAAA////wAAAAAAAAAAD////AAAAAAAAAAAP///4AAAAAAAAAAA////gAAAAAAAAAAH///+AAAAAAAAAAA////4AAAAAAAAAAH////gAAAAAAAAAAf///+AAAAAAAAAAD////8AAAAAAAAAAP////4AAAAAAAAAB/////wAAAAAAAAAP/////AAAAAAAAAA/////+AAAAAAAAAH/////8AAAAAAAAA//////wAAAAAAAAH//////AAAAAAAAA//////8AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAB///////8AAAAAAAH///////wAAAAAAA////////AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////8AAAAAAD////////wAAAAAAf///////+AAAAAAB////////4AAAAAAP////////gAAAAAA////////+AAAAAAH////////4AAAAAAf////////gAAAAAB////////8AAAAAAP////////wAAAAAA/////////AAAAAAD////////8AAAAAAP////////wAAAAAA/////////AAAAAAB////////4AAAAAAH////////gAAAAAAf///////+AAAAAAA////////4AAAAAAD////////gAAAAAAD//5////+AAAAAAAH/+P////8AAAAAAAP///Af//wAAAAAAAP//gA///AAAAAAAH8fgAB//8AAAAAAB8PwAAB//wAAAAAA+H4AAAH//AAAAAAfj8AAAAf/+AAAAAPx/AAAAA//4AAAPH8/jgAAAD//gAAD////+AAAAP/+AAAf////YAAAA//4AAP///gwAAAAD//AAD///wAAAAAAH/4AAb//8AAAAAAAe+AACfs+AAAAAAAAAAAAH9PgAAAAAAAAAAAA7D8AAAAAAAAAAAAOc+AAAAAAAAAAAABhn4AAAAAAAAAAAAMAwAAAAAAAAAAAABgEAAAAAAAAAAAAAEAgAAAAAAAAAAA==","h":78,"w":93},"junco-hyemalis":{"bits":"AAfAAAAAAAAAAAAAAf/gAAAAAAAAAAAAP//AAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAP///gAAAAAAAAAAD////AAAAAAAAAAB////8AAAAAAAAAAf////wAAAAAAAAAH/////wAAAAAAAAA//////4AAAAAAAAA//////4AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA///////AAAAAAAAD//////8AAAAAAAAP//////wAAAAAAAB///////gAAAAAAAH//////+AAAAAAAA///////8AAAAAAAD///////4AAAAAAAf///////gAAAAAAD////////AAAAAAAP///////8AAAAAAB////////wAAAAAAP////////AAAAAAA////////8AAAAAAH////////wAAAAAAf////////AAAAAAB////////8AAAAAAP////////gAAAAAA////////8AAAAAAD////////gAAAAAAP////////AAAAAAA////////8AAAAAAD////////4AAAAAAP////////gAAAAAAf////////AAAAAAB////////8AAAAAAD////////wAAAAAAH///////+AAAAAAAP//////+AAAAAAAAP//////4AAAAAAAD///wf//wAAAAAAA///8Af//AAAAAAAH//AAA//+AAAAAAA9/wAAAf/4AAAAAAHv/AAAB//wAAAAAA/+8AAAH//AAAAAAD/hgAAAf/+AAAAAAf/AAAAB//4AAAAAAX0AAAAH//wAAAAAAfgAAAAf//AAAAAAAAAAAAB//8AAAAAAAAAAAAH//wAAAAAAAAAAAAf/+AAAAAAAAAAAAB//wAAAAAAAAAAAAD//AAAAAAAAAAAAAP/4AAAAAAAAAAAAA/wAAAAAAAAAAAAAD+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAw","h":64,"w":93},"lanius-borealis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAAAAAAAP/+AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAAf//+AAAAAAAAAAAH///4AAAAAAAAAAD////gAAAAAAAAAA////8AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAf////8AAAAAAAAAAf////gAAAAAAAAAA/////AAAAAAAAAAH////+AAAAAAAAAAf////8AAAAAAAAAB/////4AAAAAAAAAH/////gAAAAAAAAA//////AAAAAAAAAH/////8AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////wAAAAAAAAf//////gAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAAf///////AAAAAAAB///////4AAAAAAAH///////gAAAAAAA///////+AAAAAAAD///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAH///////AAAAAAAAf//////4AAAAAAAB///////gAAAAAAAD//////+AAAAAAAAH//////4AAAAAAAb///////gAAAAAAH///////wAAAAAAB///////+AAAAAAAP4O/+Af/wAAAAAAD8A//gA//AAAAAAATg/g8AB/8AAAAAAC3//AAAD/wAAAAAAC//8AAAP/AAAAAAAH+CwAAA/8AAAAAAB/gAAAAD/wAAAAAAYwAAAAAP/AAAAAADOAAAAAA/8AAAAAABAAAAAAD/wAAAAAAIAAAAAAP/AAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"lanius-ludovicianus":{"bits":"AAH/gAAAAAAAAAAf/8AAAAAAAAAAf//gAAAAAAAAA///8AAAAAAAAA////AAAAAAAAA////gAAAAAAAD////4AAAAAAAH////+AAAAAAAH/////AAAAAAAH/////wAAAAAAD/////4AAAAAAB/////+AAAAAAAh/////AAAAAAAAP////gAAAAAAAD////4AAAAAAAB////8AAAAAAAAf////AAAAAAAAP////wAAAAAAAD////8AAAAAAAB/////AAAAAAAB/////wAAAAAAA/////8AAAAAAAf/////AAAAAAAP/////gAAAAAAH/////4AAAAAAD/////+AAAAAAB//////AAAAAAA//////wAAAAAAf/////4AAAAAAP/////+AAAAAAH//////AAAAAAB//////wAAAAAA//////4AAAAAAf/////+AAAAAAP//////AAAAAAD//////wAAAAAB//////4AAAAAAf/////+AAAAAAP//////AAAAAAD//////wAAAAAB//////4AAAAAAf/////+AAAAAAP//////AAAAAAD//////gAAAAAA//////4AAAAAAP/////8AAAAAAD/////+AAAAAAB//////gAAAAAAf/////wAAAAAAH/////4AAAAAAB/////8AAAAAAAf/////AAAAAAAH/////gAAAAAAB/////4AAAAAAAf////8AAAAAAAD////+AAAAAADA/////gAAAAAD//////wAAAAAH//////4AAAAAD///9//+AAAAAB/j/8f/+AAAAAB94PvD//gAAAAA8fH3Af/wAAAAAOHh/gD/8AAAAAHDw/gAf/AAAAAD7wOAAH/gAAAAA94CAAB/4AAAAAMgAAAAf+AAAAAHwAAAAP/gAAAAAAAAAAD/wAAAAAAAAAAA/8AAAAAAAAAAAf/AAAAAAAAAAAH/wAAAAAAAAAAB/4AAAAAAAAAAA/+AAAAAAAAAAAP/gAAAAAAAAAAD/wAAAAAAAAAAB/8AAAAAAAAAAAf/AAAAAAAAAAAH/gAAAAAAAAAAD/4AAAAAAAAAAA/+AAAAAAAAAAAP/gAAAAAAAAAAD/wAAAAAAAAAAB/8AAAAAAAAAAAf/AAAAAAAAAAAH/gAAAAAAAAAAD/4AAAAAAAAAAA/8AAAAAAAAAAAP/AAAAAAAAAAAD/gAAAAAAAAAAAfwAAAAAAAAAAADgA==","h":93,"w":79},"larus-brachyrhynchus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAD/8AAAAAAAAAAAAB//wAAAAAAAAAAAAf//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAH//+AAAAAAAAAAAB///wAAAAAAAAAAAP///AAAAAAAAAAAB///4AAAAAAAAAAAf///wAAAAAAAAAAD////gAAAAAAAAAAf////AAAAAAAAAAD////4AAAAAAAAAAf////gAAAAAAAAAD///x8AAAAAAAAAAf///BgAAAAAAAAAH///8AAAAAAAAAAD////gAAAAAAAAAB////+AAAAAAAAAB/////wAAAAAAAAA//////AAAAAAAAAf/////4AAAAAAAAH//////AAAAAAAAD//////4AAAAAAAA///////AAAAAAAAf//////4AAAAAAAH///////AAAAAAAB///////4AAAAAAAf///////AAAAAAAH///////wAAAAAAB///////+AAAAAAAf///////wAAAAAAH///////+AAAAAAA////////gAAAAAAP///////8AAAAAAD////////gAAAAAA////////8AAAAAAf////////AAAAAAH////////4AAAAAD////////+AAAAAA/////////wAAAAAP////////8AAAAAD/////////gAAAAA/////////4AAAAAH/////////AAAAAB/////////wAAAAAP////////8AAAAAD/////////AAAAAAf////////wAAAAAP////////+AAAAAH/////////AAAAAD/////////wAAAAB/////////8AAAAB/////////+AAAAA//////////gAAAAf/////////4AAAAP/////////+AAAAH//////////wAAAA/////gAD/A+AAAAP////wAAeADwAAAA////4AADwAeAAAAP///8AAAeADwAAAB+AP+AAADwAeAAAAAAA/AAAAMABwAAAAAAAAAAABgAOAAAAAAAAAAAAMABwAAAAAAAAAAABwAOAAAAAAAAAAAAOABwAAAAAAAAAAABwAPAAAAAAAAAAAAOGA4AAAAAAAAAAABzwPHgAAAAAAAAAAP/5/+AAAAAAAAAAD////8AAAAAAAAAAP/4//4AAAAAAAAAB/+H/8AAAAAAAAAAf/gP+AAAAAAAAAAB/+A/wAAAAAAAAAAP8QA+AAAAAAAAAAA8AAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":85,"w":93},"larus-californicus":{"bits":"AAB/wAAAAAAAAAAAAA//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAH///+AAAAAAAAAAH////wAAAAAAAAAD/////AAAAAAAAAAf////4AAAAAAAAAH/////AAAAAAAAAA/7///4AAAAAAAAAHwH///AAAAAAAAAAAAf//4AAAAAAAAAAAB///AAAAAAAAAAAAf//4AAAAAAAAAAAD//+AAAAAAAAAAAA///wAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAf///4AAAAAAAAAAD////wAAAAAAAAAAf////4AAAAAAAAAH/////4AAAAAAAAA//////4AAAAAAAAH//////4AAAAAAAA///////wAAAAAAAH///////gAAAAAAA///////+AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////8AAAAAAH////////4AAAAAA/////////AAAAAAH////////8AAAAAA/////////wAAAAAH/////////AAAAAAf////////+AAAAAD/////////4AAAAAf/////////wAAAAB//////////AAAAAP/////////8AAAAA//////////gAAAAD/////////+AAAAAf/////////4AAAAB//////////gAAAAH/////////+AAAAAf/////////4AAAAB//////////AAAAAH//////////AAAAAP/////////+AAAAA//////////8AAAAB//////////4AAAAD//////////wAAAAH//////////gAAAAH/////////+AAAAAH/////////wAAAAAf//+A/////AAAAAB//+AAH///4AAAAAP/AAAAP//AAAAAAB/gAAAAf/4AAAAAAe4AAAAAf/AAAAAAB3AAAAAAf4AAAAAAP4AAAAAA8AAAAAAB/AAAAAAAAAAAAAAO4AAAAAAAAAAAAAB3AAAAAAAAAAAAAAO4AAAAAAAAAAAAAB3AAAAAAAAAAAAAAO4AAAAAAAAAAAAAB3AAAAAAAAAAAAAAf4AAAAAAAAAAAAP//AAAAAAAAAAAAA/+8AAAAAAAAAAAAf/3gAAAAAAAAAAAH//8AAAAAAAAAAAAj//gAAAAAAAAAAAAD/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAf/wAAAAAAAAAAAACP8AAAAAAAAAAAAAA+AAAAAAAAAAAAAADAAAAAAAAAAA=","h":85,"w":93},"larus-delawarensis":{"bits":"AAD+AAAAAAAAAAAAAB/8AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAAf//wAAAAAAAAAAAH//+AAAAAAAAAAAD///wAAAAAAAAAAD////AAAAAAAAAAB////4AAAAAAAAAAf////AAAAAAAAAAH////4AAAAAAAAAA/B///AAAAAAAAAAEAH//8AAAAAAAAAAAB///8AAAAAAAAAAAf///8AAAAAAAAAAD////8AAAAAAAAAA/////+AAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAH//////4AAAAAAAB///////gAAAAAAAP///////AAAAAAAB///////8AAAAAAAP///////4AAAAAAB////////gAAAAAAH///////+AAAAAAA////////4AAAAAAH////////gAAAAAA////////+AAAAAAD////////8AAAAAAf////////4AAAAAB/////////wAAAAAP/////////AAAAAA/////////8AAAAAH/////////wAAAAAf/////////AAAAAB/////////8AAAAAH/////////wAAAAA//////////AAAAAD/////////8AAAAAH/////////wAAAAAf/////////gAAAAB//////////wAAAAD//////////gAAAAH//////////gAAAAP//////////AAAAAP/////////+AAAAA////x/////4AAAAD///gAD////AAAAAP/AAAAD//gAAAAAA94AAAAD/8AAAAAAHPAAAAAB/AAAAAAA54AAAAAAAAAAAAAPGAAAAAAAAAAAAAA4wAAAAAAAAAAAAAHGAAAAAAAAAAAAAA4wAAAAAAAAAAAAAHGAAAAAAAAAAAAAA4wAAAAAAAAAAAAAHOAAAAAAAAAAAAAA54AAAAAAAAAAAAAP/AAAAAAAAAAAAAD/4AAAAAAAAAAAAH/+AAAAAAAAAAAAf//gAAAAAAAAAAAH//gAAAAAAAAAAAAH/4AAAAAAAAAAAAB/wAAAAAAAAAAAAAPAAAAAAAAAAAA==","h":70,"w":93},"larus-fuscus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+AAAAAAAAAAAAAD/8AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAB///gAAAAAAAAAAD///8AAAAAAAAAAA////gAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAPg//8AAAAAAAAAAAAB//gAAAAAAAAAAAAH/8AAAAAAAAAAAAA//gAAAAAAAAAAAAP/8AAAAAAAAAAAAB//gAAAAAAAAAAAAP/8AAAAAAAAAAAAD//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//wAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAA///gAAAAAAAAAAAP///AAAAAAAAAAAB///8AAAAAAAAAAAP///8AAAAAAAAAAB////8AAAAAAAAAAP////+AAAAAAAAAB/////8AAAAAAAAAP/////8AAAAAAAAB//////4AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////4AAAAAAB////////wAAAAAAH////////wAAAAAA/////////gAAAAAH/////////AAAAAAf////////8AAAAAD/////////4AAAAAP/////////gAAAAA//////////gAAAAD///////////AAAAP///////////4AAA////////////gAAD///////////8AAAH//////////4AAAAP/////////4AAAAAP/////////4AAAAAP/////////4AAAAAP///4P////gAAAAA///wAAD//4AAAAAD//wAAAAAAAAAAAAP8AAAAAAAAAAAAAD/AAAAAAAAAAAAAAfgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAfAAAAAAAAAAAAADj4AAAAAAAAAAAAA//AAAAAAAAAAAAB//8AAAAAAAAAAAAB//AAAAAAAAAAAAAH/8AAAAAAAAAAAAH//AAAAAAAAAAAAA//wAAAAAAAAAAAAAf4AAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":77,"w":93},"larus-glaucescens":{"bits":"AAD/gAAAAAAAAAAAAD/+AAAAAAAAAAAAD//wAAAAAAAAAAAB//+AAAAAAAAAAAAf//wAAAAAAAAAAAP//+AAAAAAAAAAAP///gAAAAAAAAAAf///4AAAAAAAAAA////+AAAAAAAAAAf////wAAAAAAAAAP////8AAAAAAAAAD/////AAAAAAAAAA/x///wAAAAAAAAAPgP//8AAAAAAAAAAAB///AAAAAAAAAAAAf//gAAAAAAAAAAAH//4AAAAAAAAAAAD//+AAAAAAAAAAAB///gAAAAAAAAAAAf//4AAAAAAAAAAAP//+AAAAAAAAAAAD///gAAAAAAAAAAA///4AAAAAAAAAAAf///AAAAAAAAAAAH///4AAAAAAAAAAB////gAAAAAAAAAAf///+AAAAAAAAAAP////4AAAAAAAAAD/////4AAAAAAAAA//////wAAAAAAAAP//////gAAAAAAAD//////+AAAAAAAA///////4AAAAAAAP///////AAAAAAAD///////8AAAAAAA////////gAAAAAAP///////8AAAAAAD////////wAAAAAA////////+AAAAAAP////////wAAAAAD////////8AAAAAA/////////gAAAAAP/////////AAAAAD/////////8AAAAAf/////////gAAAAH/////////+AAAAB//////////wAAAAP/////////8AAAAB//////////gAAAAf/////////8AAAAD//////////gAAAAf/////////8AAAAD//////////gAAAAf/////////4AAAAD/////////+AAAAAf/////////4AAAAD//////////4AAAAP//////////gAAAA///////////AAAAD//////////+AAAAP//////////wAAAA//////////8AAAAH/////////+AAAAA////4AD///gAAAAHj//4AAD/8AAAAABw/zgAAAH+AAAAAAcH4AAAAAGAAAAAAPg4AAAAAAAAAAAADwOAAAAAAAAAAAAA8DwAAAAAAAAAAAAHB8AAAAAAAAAAAABwfAAAAAAAAAAAAAcDwAAAAAAAAAAAAHA4AAAAAAAAAAAABwOAAAAAAAAAAAAAcDgAAAAAAAAAAAAHA4AAAAAAAAAAAABwOAAAAAAAAAAAAA8DgAAAAAAAAAAAAPg4AAAAAAAAAAAP/4OAAAAAAAAAAAf/8DgAAAAAAAAAAH//A4AAAAAAAAAAAP/wfAAAAAAAAAAAH///gAAAAAAAAAAB///4AAAAAAAAAAAAP/+AAAAAAAAAAAAAf/gAAAAAAAAAAAAP/4AAAAAAAAAAAAD/+AAAAAAAAAAAAB//AAAAAAAAAAAAAAPgAAAAAAAAAAAAABwAAAAAAAAA=","h":93,"w":92},"larus-glaucoides":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAADwcAAAAAAAAAAAAB//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAA/9/gAAAAAAAAAAAP/n8AAAAAAAAAAAH/A/wAAAAAAAAAAD/4H+AAAAAAAAAAA/8APwAAAAAAAAAAP/gACAAAAAAAAAAB/cAAQAAAAAAAAAAPAgACAAAAAAAAAAAAMAAQAAAAAAAAAAADAACAAAAAAAAAAAAYAAQAAAAAAAAAAAGAADgAAAAAAAAAAAgAAHgAAAAAAAAAAMAAAPgAAAAAAAAABgAAA/wAAAAAAAAAIAAAH/4AAAAAAAABAAAB//4AAAAAAAAIAAAf//wAAAAAAADAAAP///gAAAAAAAYAAB////AAAAAAADAAAP///+AAAAAAAYAAA////4AAAAAADAAAP////wAAAAAAYAAH/////AAAAAABAAA/////8AAAAAAIAAH/////8AAAAABAAA//////4AAAAAIAAH//////wAAAABgAAf//////gAAAAEAAB//////+AAAAAgAAP//////4AAAAGAAD///////gAAAAQAAf//////+AAAADAAH///////wAAAAMAA////////4AAAAgAH////////+AAAGAA//////////AAAYAH//////////AABgA//////////8AAHAH//////////gAAMAf/////////gAAA4B/////////8AAABwD////////gAAAADwP///////8AAAAAHgf///gAB/AAAAACHh///gAAAAAAAAB/////wAAAAAAAAA//9//4AAAAAAAAA///B+AAAAAAAAAAP/gAHAAAAAAAAAAB/wAB4AAAAAAAAAAP+AAPAAAAAAAAAABhgAA4AAAAAAAAAAAAAAGAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAOAAAAAAAAAAAAAABwAAAAAAAAAAAAAAPAAAAAAAAAAAAAP/wAAAAAAAAAAAAB/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAD/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAADwAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":77,"w":93},"larus-heermanni":{"bits":"AAH/AAAAAAAAAAAAAD/+AAAAAAAAAAAAA//4AAAAAAAAAAAAP//gAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAH//+AAAAAAAAAAAB///wAAAAAAAAAAB////AAAAAAAAAAB////4AAAAAAAAAAf////AAAAAAAAAAH////4AAAAAAAAAA/3///AAAAAAAAAAHwP//+AAAAAAAAAAAB///8AAAAAAAAAAAf///wAAAAAAAAAAH////4AAAAAAAAAA/////+AAAAAAAAAP/////+AAAAAAAAB//////8AAAAAAAAP//////4AAAAAAAD///////wAAAAAAAf///////gAAAAAAD////////AAAAAAAf///////8AAAAAAD////////wAAAAAAf////////gAAAAAD////////8AAAAAAf////////wAAAAAB/////////wAAAAAP/////////gAAAAB//////////AAAAAH/////////8AAAAA//////////wAAAAH//////////AAAAAf/////////8AAAAB//////////wAAAAH//////////AAAAA//////////8AAAAD//////////gAAAAP//////////wAAAA///////////wAAAD///////////wAAAP///////////wAAAf///////////gAAA////////////AAAB///////////4AAAD//////////zAAAAD//////////gAAAAH///4H/////AAAAAf//4AAP///4AAAAD//4AAAP/4AAAAAAP+AAAAAP/AAAAAADvAAAAAAPwAAAAAAfwAAAAAAAAAAAAADuAAAAAAAAAAAAAAdwAAAAAAAAAAAAADuAAAAAAAAAAAAAAdwAAAAAAAAAAAAADOAAAAAAAAAAAAAAZwAAAAAAAAAAAAADOAAAAAAAAAAAAAAZwAAAAAAAAAAAAADOAAAAAAAAAAAAAA5wAAAAAAAAAAAAOHuAAAAAAAAAAAAB/9wAAAAAAAAAAAD//PAAAAAAAAAAAAH//4AAAAAAAAAAAA//+AAAAAAAAAAAAH//wAAAAAAAAAAAAD/8AAAAAAAAAAAAAb/AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAYAAAAAAAAAA=","h":75,"w":93},"larus-hyperboreus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAA//gAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///AAAAAAAAAAAAP//8AAAAAAAAAAAD///gAAAAAAAAAAD///8AAAAAAAAAAD////wAAAAAAAAAA////+AAAAAAAAAAP////wAAAAAAAAAB////+AAAAAAAAAAPw///wAAAAAAAAABAD//+AAAAAAAAAAAAf//wAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAf///gAAAAAAAAAAD////8AAAAAAAAAA//////gAAAAAAAAH//////gAAAAAAAB///////gAAAAAAAP///////AAAAAAAB///////+AAAAAAAP///////8AAAAAAB////////4AAAAAAP////////gAAAAAB/////////AAAAAAP/////////gAAAAB//////////AAAAAP/////////+AAAAB//////////8AAAAP//////////wAAAA//////////+AAAAH///////////wAAAf////////////AAD/////////////gAP////////////8AA/////////////AAH////////////8AAf////////////gAB////////////gAAH///////////wAAAf//////////+AAAA///////////gAAAD//////////4AAAAH///////AAAAAAAAP/////8AAAAAAAAAf////8AAAAAAAAAAf///+AAAAAAAAAAA////AAAAAAAAAAAD//+AAAAAAAAAAAAef4AAAAAAAAAAAADx+AAAAAAAAAAAAAcHAAAAAAAAAAAAADh8AAAAAAAAAAAAAcPAAAAAAAAAAAAADg4AAAAAAAAAAAAAcHAAAAAAAAAAAAADg4AAAAAAAAAAAAAcHAAAAAAAAAAAAADw4AAAAAAAAAAAAB+HAAAAAAAAAAAAf/g4AAAAAAAAAAAP/8HAAAAAAAAAAAAf/h8AAAAAAAAAAAB/9/gAAAAAAAAAAAf//4AAAAAAAAAAACB//AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//AAAAAAAAAAAAAP/4AAAAAAAAAAAABj+AAAAAAAAAAAAAAHgAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"larus-marinus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAD/8AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAA///gAAAAAAAAAAB///8AAAAAAAAAAA////gAAAAAAAAAAP///+AAAAAAAAAAB////wAAAAAAAAAAfx//+AAAAAAAAAABAH//wAAAAAAAAAAAAf/+AAAAAAAAAAAAH//wAAAAAAAAAAAB//8AAAAAAAAAAAAP//wAAAAAAAAAAAD///8AAAAAAAAAAAf////+AAAAAAAAAH//////gAAAAAAAA///////AAAAAAAAH///////AAAAAAAA///////+AAAAAAAP///////8AAAAAAB////////wAAAAAAP////////wAAAAAB/////////4AAAAAP/////////wAAAAA//////////gAAAAH/////////+AAAAA//////////8AAAAH//////////wAAAA//////////+AAAAC//////////+AAAAf///////////wAABf///////////4AAP////////////8AA/////////////gAH////////////8AAf////////////AAB////////////4AAH///////////+AAAf//////////8AAAA///////////gAAAD////////4/8AAAAH//////+B//AAAAAH/////wAAPgAAAAAH////wAAAAAAAAAAD///4AAAAAAAAAAAH//wAAAAAAAAAAAA/+AAAAAAAAAAAAAHfAAAAAAAAAAAAAA5wAAAAAAAAAAAAAHeAAAAAAAAAAAAAA7wAAAAAAAAAAAAAHOAAAAAAAAAAAAAA5gAAAAAAAAAAAAAHMAAAAAAAAAAAAD/9gAAAAAAAAAAAAf/8AAAAAAAAAAAAD/7wAAAAAAAAAAAA//+AAAAAAAAAAAAH//wAAAAAAAAAAAAB/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAD/4AAAAAAAAAAAAAX+AAAAAAAAAAAAAAPgAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":72,"w":93},"larus-occidentalis":{"bits":"AAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAD///4AAAAAAAAAAB////AAAAAAAAAAD////4AAAAAAAAAB/////gAAAAAAAAAf////8AAAAAAAAAD/////gAAAAAAAAA/////8AAAAAAAAAH+D///gAAAAAAAAAyAH//8AAAAAAAAAAAAf//gAAAAAAAAAAAH//8AAAAAAAAAAAA///gAAAAAAAAAAAP//4AAAAAAAAAAAD///AAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAA////gAAAAAAAAAAH////AAAAAAAAAAB/////AAAAAAAAAAP/////wAAAAAAAAB//////wAAAAAAAAP//////gAAAAAAAB///////AAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////wAAAAAAB////////AAAAAAAP///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////8AAAAAAH////////wAAAAAA/////////AAAAAAH////////8AAAAAA/////////wAAAAAD////////+AAAAAAf////////4AAAAAD/////////gAAAAAP/////////AAAAAB/////////8AAAAAH/////////gAAAAAf/////////AAAAAD/////////4AAAAAP/////////gAAAAA/////////8AAAAAH/////////wAAAAAf////////+AAAAAB/////////4AAAAAH/////////gAAAAAf////////8AAAAAA/////////wAAAAAD////////+AAAAAAP////////8AAAAAAf////////wAAAAAA/////////AAAAAAB////////+AAAAAAH////////4AAAAAA/////////gAAAAAD////////+AAAAAAP////////4AAAAAA8D8A/////gAAAAAHgcAA////+AAAAAA8DgAAf///wAAAAAHgcAAA///+AAAAAA8DgAAD///4AAAAAHAcAAAH//kAAAAAA4DgAAAf/+AAAAAAHAcAAAA//gAAAAAA5zgAAAB/4AAAAAAH/8AAAAH8AAAAAAB//gAAAAGAAAAAABn/8AAAAAAAAAAAH///gAAAAAAAAAAB///AAAAAAAAAAAAD/+AAAAAAAAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAB/gAAAAAAAAAA=","h":84,"w":93},"larus-schistisagus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAD/8AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAf//8AAAAAAAAAAAf///gAAAAAAAAAAH///8AAAAAAAAAAB////gAAAAAAAAAAP///8AAAAAAAAAAB8H//gAAAAAAAAAAIB//8AAAAAAAAAAAAf//4AAAAAAAAAAAH///4AAAAAAAAAAA////wAAAAAAAAAAH////4AAAAAAAAAB/////4AAAAAAAAAP/////4AAAAAAAAB//////wAAAAAAAAP//////gAAAAAAAB///////AAAAAAAAP//////+AAAAAAAB///////8AAAAAAAP///////4AAAAAAAv///////gAAAAAAEAf/////+AAAAAAAwB//////+AAAAAACAP//////8AAAAAAYA///////4AAAAABAP///////gAAAAAMD////////AAAAAAwf///////8AAAAADD////////gAAAAAY////////8AAAAABn////////wAAAAAGf////////AAAAAAf/////////AAAAAA//////////gAAAAD//////////wAAAAH//////////4AAAAP//////////4AAAAf//////////gAAAA//////////8AAAAD/////////+AAAAAf///4AH///4AAAAD/8AAAAA/gfAAAAAP+AAAAAAAAAAAAAB9wAAAAAAAAAAAAAOeAAAAAAAAAAAAADxwAAAAAAAAAAAAAeOAAAAAAAAAAAAABxwAAAAAAAAAAAAAOOAAAAAAAAAAAAADhwAAAAAAAAAAAAAcOAAAAAAAAAAAAADhwAAAAAAAAAAAAAcOAAAAAAAAAAAAADh4AAAAAAAAAAAAA//AAAAAAAAAAAAAH/wAAAAAAAAAAAAB/+AAAAAAAAAAAAD//AAAAAAAAAAAAA/7gAAAAAAAAAAAA/8QAAAAAAAAAAAAP/AAAAAAAAAAAAAB/gAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":72,"w":93},"laterallus-jamaicensis":{"bits":"AAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAB/gAAAAAAAAAAAAA//AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAP//+AAAAAAAAAAAD///4AAAAAAAAAAB////gAAAAAAAAAAf///+AAAAAAAAAAP////8AAAAAAAAAD///////8AAAAAAA////////+AAAAAAP////////+AAAAAD4B///////+AAAAcAAH///////+AAAfgAAf///////+AAH4AAB////////+AH/gAAP////////8D/8AAB////////////gAAf///////////4AAD////////////AAAf///////////4AAD///////////+AAAf///////////gAAD///////////4AAAf//////////+AAAD///////////wAAAf//////////8AAAB///////////gAAAP//////////8AAAB///////////AAAAH//////////wAAAA///////////AAAAH//////////8AAAAf//////////wAAAB//////////+AAAAP//////////wAAAA//////////8AAAAD//////////wAAAAP/////////+AAAAA//////////wAAAAD/////////8AAAAAH////////AAAAAAAf///////AAAAAAAA///////gAAAAAAAB//////4AAAAAAAAD/////8AAAAAAAAAH/////AAAAAAAAAAP////gAAAAAAAAAAP///wAAAAAAAAAAAH//8AAAAAAAAAAAAD//wAAAAAAAAAAAAH/+AAAAAAAAAAAAP/nwAAAAAAAAAAP//88AAAAAAAAAA////HAAAAAAAAAAf//AB4AAAAAAAAAH//+AeAAAAAAAAAA/+P4DwAAAAAAAAAD/gBA8AAAAAAAAAA94AAPAAAAAAAAAAPeAAB4AAAAAAAAABxwAAeAAAAAAAAAAeMAADwAAAAAAAAADhgDg8QAAAAAAAAAYEA///gAAAAAAAADAAD//8AAAAAAAAAAAB//AAAAAAAAAAAAP//gAAAAAAAAAAAD/94AAAAAAAAAAAAaA+AAAAAAAAAAAAAAPAAAAAAAAAAAAAADgAAAAAAAAAAAAAA4AAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"leiothlypis-celata":{"bits":"AAAAAAAAAAAAAAYAAAAAAAAAAAAAAPgAAAAAAAAAAAAAH8AAAAAAAAAAAAAB/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAB///AAAAAAAAAAAAf//4AAAAAAAAAAAH//+AAAAAAAAAAAB///gAAAAAAAAAAA///4AAAAAAAAAAAP//8AAA/8AAAAAD///+AAA//8AAA//////gAAP//8P///////wAAH///////////4AAB///////////8AAAf//////////+AAAH///////////AAAP///////////wAAH///////////8AAA////////////gAAB///////////4AAAAf/////////+AAAAD//////////wAAAAH/////////8AAAAAf/////////gAAAAB//////////gAAAAH//////////AAAAAf/////////+AAAAB//////////wAAAAP/////////8AAAAA/////////gAAAAAD////////gAAAAAAf///////wAAAAAAB///////8AAAAAAAH///////gAAAAAAA///////4AAAAAAAD//////+AAAAAAAAP//////wAAAAAAAA//////8AAAAAAAAD/////+AAAAAAAAAP/////wAAAAAAAAAf////+AAAAAAAAAA/////wAAAAAAAAAB////+AAAAAAAAAAD//5/AAAAAAAAAAA/+AfAAAAAAAAAAAP/4PgAAAAAAAAAAD4Hn4AAAAAAAAAAAfAP8AAAAAAAAAAAD4B/8AAAAAAAAAAAfAf/wAAAAAAAAAAD8H//AAAAAAAAAAAPl+AYAAAAAAAAAABvvwDAAAAAAAAAAAH58AwAAAAAAAAAAAAHwAAAAAAAAAAAAAA/YAAAAAAAAAAAAAH+AAAAAAAAAAAAAAdgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAHAAAAAAAA","h":64,"w":93},"leiothlypis-lucidae":{"bits":"AAAAAAAAAAAHwAAAAAAAAAAAAAH/wAAAAAAAAAAAAD//gAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAP///wAAAAAAAAAAD////AAAAAAAAAAA////8AAAAAAAAAAP////8AAAAAAAAAD/////+AAAAAAAAA//////4AAAAAAAAH/////8AAAAAAAAB/////4AAAAAAAAAf////+AAAAAAAAAH/////wAAAAAAAAD/////8AAAAAAAAB//////gAAAAAAAA//////8AAAAAAAAP//////AAAAAAAAH//////4AAAAAAAB///////AAAAAAAAf//////4AAAAAAAH//////+AAAAAAAB///////wAAAAAAAf//////+AAAAAAAH///////wAAAAAAD///////+AAAAAAA////////wAAAAAAf///////+AAAAAAH////////wAAAAAB////////+AAAAAAP////////gAAAAAD////////8AAAAAA/////////gAAAAAP////////8AAAAAD/////////AAAAAA/////////4AAAAAP////////+AAAAAB/////////wAAAAAf////////8AAAAAD/////////AAAAAAf////////4AAAAAD////////+AAAAAA/////////gAAAAAP////////4AAAAAD////////+AAAAAB/////////gAAAAAf////////4AAAAAD////////+AAAAAA/////////wAAAAAP/////////gAAAAD5////////8AAAAAcf////////gAAAAHD///////98AAAAAB////////PgAAAAAf//4///h/4AAAAAD//+H//AO+AAAAAA//+AfgAB/wAAAAAf/+AD+AAPcAAAAAH//wAB4AA7gAAAAB//8AAHgAB4AAAAAP//AAAPAAAAAAAAD//wAAA8AAAAAAAA//8AAADwAAAAAAAP//AAAAPgAAAAAAD//4AAAA+AAAAAAA//+AAAAD8AAAAAAP//gAAAA/wAAAAAD//4AAAAP+AAAAAA//+AAAAHvwAAAAAH//wAAAB9+AAAAAB//8AAAAP/gAAAAAf//AAAABf4AAAAAD//wAAAAP+AAAAAA//8AAAAB/wAAAAAH+/AAAAAHOAAAAAA/HwAAAAAHgAAAAAAAQAAAAAAQAAAAAAA==","h":78,"w":93},"leiothlypis-peregrina":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH///8AAAAAAAAf8P////+AAAAAAAP////////+AAAAAH//////////B/wAB/////////////AAf////////////4AH/////////////gA/////////////8AP/////////////AB////////////wAA///////////gAAAf/////////jgAAAP8D///////hwAAAB44H//////4wAAAAADgB/////+cAAAAAAEAP//////AAAAAAAYB//////wAAAAAABwH/////8AAAAAAAHA///8D/AAAAAAAAMB//8ADwAAAAAAAAwD/8AAeAAAAAAAADABwAADgAAAAAAAAMAAAABwAAAAAAAAAwAAAAMAAAAAAAAADgAAANwAAAAAAAAAGAAAD+AAAAAAAAAAcAAB/gAAAAAAAAAAeAAc4AAAAAAAAAAAf/+OAAAAAAAAAAAAD/zgAAAAAAAAAAAA8+4AAAAAAAAAAAAHg+AAAAAAAAAAAAAfHgAAAAAAAAAAAADw4AAAAAAAAAAAAAPOAAAAAAAAAAAAAAxwAAAAAAAAAAAAAAcAAAAAAAAAAAAAAH/AAAAAAAAAAAAAD78AAAAAAAAAAAAAeBgAAAAAAAAAAAADyIAAAAAAAAAAAAAHwAAAAAAAAAAAAAB8AAAAAAAAAAAAAAGAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":49,"w":93},"leiothlypis-ruficapilla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAB+AAAD/gAAAAAAAA//AAD//AAAAAAAAf/8AA//+AAAAAAAP//gAP//8AAAAAAD//4AD///wAAAAAB//+AB////gAAAAA///AH//////gAAAP//gB///////4AAH//wAH///////8AP//4AAB///////////8AAAH//////////+AAAAf//////////AAAAD//////////gAAAAP/////////4AAAAB/////////+AAAAAH/////////wAAAAA/////////8AAAAAD/////////AAAAAAf////////wAAAAAD////////8AAAAAAf////////gAAAAAB////////+AAAAAAP////////8AAAAAB/////////4AAAAAH/////////wAAAAA/////////+AAAAAD/////////wAAAAAf///////AAAAAAAB///////wAAAAAAAH//////8AAAAAAAAf//////AAAAAAAAB//////wAAAAAAAAH/////8AAAAAAAAAP/////AAAAAAAAAA/////gAAAAAAAAAB////8AAAAAAAAAAD////gAAAAAAAAAAB//x4AAAAAAAAAAAA+AeAAAAAAAAAAAAPAHAAAAAAAAAAAAHgBwAAAAAAAAAAAD/wcAAAAAAAAAAAB/+HAAAAAAAAAAAAfgRwAAAAAAAAAAAD4Af8AAAAAAAAAAA+Af/wAAAAAAAAAAD4H8SAAAAAAAAAAAfg+AAAAAAAAAAAAB8PwAAAAAAAAAAAAHA+AAAAAAAAAAAAAAD0AAAAAAAAAAAAAAfgAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":59,"w":93},"leiothlypis-virginiae":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAB8AAAAAAAAAAAAAA//AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//gAAAAAAAAAAAB//8AAAAAAAAAAAA///AAAAAAAAAAAAP//gAAAAAAAAAAAD//4AAAAAAAAAAAB//8AAAAAAAAAAAAf/+AAAAAAAAAAAAH//AAAAAAAAAAAAD//wAAAADgAAAAA///4AAAAH/wAAAf///8AAAAD//wAA/////AAAAA///h//////wAAAAP/////////8AAAAH/////////7AAAAD/////////+QAAAH//////////mAAAB////////////AAAP///////////8AAAB///////////gAAAH//////////wAAAAf/////////wAAAAA/////////4AAAAAH////////+AAAAAAf////////AAAAAAD////////4AAAAAAP///////+AAAAAAA////////gAAAAAAH///////8AAAAAAAf///////AAAAAAAD///////wAAAAAAAP//////+AAAAAAAA///////gAAAAAAAH//////4AAAAAAAAf/////+AAAAAAAAB//////gAAAAAAAAH/////8AAAAAAAAAf/////gAAAAAAAAA/////4AAAAAAAAAB////8AAAAAAAAAAD///nAAAAAAAAAAAD//jwAAAAAAAAAAAf+A8AAAAAAAAAAAP/4OAAAAAAAAAAAB8ADnwAAAAAAAAAAPgA/6AAAAAAAAAAB8AfyAAAAAAAAAAAHgPwAAAAAAAAAAAA/B8AAAAAAAAAAAADAfgAAAAAAAAAAAAMB8AAAAAAAAAAAAAAHgAAAAAAAAAAAAAA8AAAAAAAAAAAAAAG4AAAAAAAAAAAAAAQAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":64,"w":93},"leucophaeus-atricilla":{"bits":"AAAfgAAAAAAAAAAAAH/4AAAAAAAAAAAAf/4AAAAAAAAAAAB//4AAAAAAAAAAAH//4AAAAAAAAAAAf//wAAAAAAAAAAA///wAAAAAAAAAAD///gAAAAAAAAAAP///gAAAAAAAAAB////AAAAAAAAAAP///+AAAAAAAAAB////8AAAAAAAAAH////4AAAAAAAAAf////wAAAAAAAAB/g///gAAAAAAAAH4A///AAAAAAAAAOAB//+AAAAAAAAAAAD//8AAAAAAAAAAAP//4AAAAAAAAAAAf//wAAAAAAAAAAB///gAAAAAAAAAAD///AAAAAAAAAAAP///AAAAAAAAAAAf///AAAAAAAAAAA////gAAAAAAAAAB////wAAAAAAAAAH////8AAAAAAAAAP/////gAAAAAAAAf/////wAAAAAAAA//////4AAAAAAAD//////8AAAAAAAH//////8AAAAAAAP//////+AAAAAAAf//////+AAAAAAA///////+AAAAAAB///////+AAAAAAD///////+AAAAAAH///////+AAAAAAP///////+AAAAAAf///////+AAAAAA////////+AAAAAA/////////AAAAAB/////////gAAAAD/////////wAAAAD/////////wAAAAH/////////wAAAAP/////////gAAAAP/////////gAAAAP/////////wAAAAf/////////wAAAAf/////////wAAAAf/////////8AAAAf//////////gAAAf//////////wAAAf//////////8AAAP//////////8AAAP//////////4AAAH/////////8AAAAD/////////+AAAAB/////////+AAAAB/////////+AAAAD////+D//8AAAAAD+///gAP/8AAAAADwf/8AAD/wAAAAADAf/gAAB+AAAAAAPAfAAAAAAAAAAAAeAcAAAAAAAAAAAA8A4AAAAAAAAAAAAwBwAAAAAAAAAAABgHgAAAAAAAAAAADAHAAAAAAAAAAAAGAOAAAAAAAAAAAAMAcAAAAAAAAAAAAYA4AAAAAAAAAAAAwBwAAAAAAAAAAADgDgAAAAAAAAAAAHAHAAAAAAAAAAAAOAOAAAAAAAAAAAAeAcAAAAAAAAAAAA8A4AAAAAAAAAAAP4BwAAAAAAAAAA//wDgAAAAAAAAAD//gPAAAAAAAAAAA//B+AAAAAAAAAAB///8AAAAAAAAAAD///4AAAAAAAAAAHB3/4AAAAAAAAAAIBP/wAAAAAAAAAAAAf/gAAAAAAAAAAAA//AAAAAAAAAAAADh8AAAAAAAAAAAAEA4AAAAAAAAAAAAAAgAAAAAAA","h":93,"w":89},"leucophaeus-pipixcan":{"bits":"AAH8AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAAf//gAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAf//+AAAAAAAAAAAf///wAAAAAAAAAAP///+AAAAAAAAAAD////4AAAAAAAAAA/7///AAAAAAAAAAHwH//4AAAAAAAAAAAAf//AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAH////AAAAAAAAAAB/////8AAAAAAAAAP/////+AAAAAAAAB//////+AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////wAAAAAAD////////8AAAAAAf////////+AAAAAD/////////8AAAAAf/////////4AAAAD//////////gAAAAf//////////Af4AD/////////////AAP////////////wAB////////////4AAP///////////8AAA////////////+AAH////////////+AAf////////////4AB///////////+8AAP///////////wAAA///////////8AAAD////////+A/AAAAP///////8AAAAAAAf//////4AAAAAAAB//////8AAAAAAAAD/////+AAAAAAAAAH/////gAAAAAAAAAH////wAAAAAAAAAAH///4AAAAAAAAAAAP//wAAAAAAAAAAAA8f4AAAAAAAAAAAAHD+AAAAAAAAAAAAA4PgAAAAAAAAAAAAHA4AAAAAAAAAAAAA4HAAAAAAAAAAAAAHA4AAAAAAAAAAAAA4HAAAAAAAAAAAAAHA4AAAAAAAAAAAAA4HAAAAAAAAAAAAAHA4AAAAAAAAAAAAA4HAAAAAAAAAAAAAGA4AAAAAAAAAAAAA4HAAAAAAAAAAAAAHg4AAAAAAAAAAAAD8HAAAAAAAAAAAAf/A4AAAAAAAAAAAP/4HgAAAAAAAAAAAf/H4AAAAAAAAAAAB///AAAAAAAAAAAAP//4AAAAAAAAAAADg//gAAAAAAAAAAAQE/8AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAcfAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAEAAAAAAAAA=","h":76,"w":93},"leucosticte-tephrocotis":{"bits":"AAPwAAAAAAAAAAAAAP/wAAAAAAAAAAAAH//gAAAAAAAAAAAD///AAAAAAAAAAAA///8AAAAAAAAAAAH///wAAAAAAAAAAB///+AAAAAAAAAAA////4AAAAAAAAAAP////gAAAAAAAAAD////+AAAAAAAAAA/////wAAAAAAAAAH/////AAAAAAAAAAP////4AAAAAAAAAAf////gAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAB/////gAAAAAAAAAP/////AAAAAAAAAA/////+AAAAAAAAAH/////8AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAB///////8AAAAAAAP///////wAAAAAAB////////AAAAAAAP///////8AAAAAAB////////4AAAAAAP////////gAAAAAB////////+AAAAAAH////////4AAAAAA/////////gAAAAAH////////+AAAAAA/////////4AAAAAD/////////wAAAAAf////////+AAAAAB/////////4AAAAAP/////////gAAAAA/////////+AAAAAD/////////4AAAAAf/////////AAAAAB/////////8AAAAAH/////////gAAAAAf////////+AAAAAB/////////4AAAAAH/////////gAAAAAf////////+AAAAAB/////////4AAAAAD/////////gAAAAAP////////+AAAAAAf////////4AAAAAA/////////gAAAAAB////////8AAAAAAD////////wAAAAAB////////PAAAAAAP///+D//8AAAAAAB9//+AH//wAAAAAAfD/4AAP//AAAAAADgP+AAAP/+AAAAAAcH4AAAAH/4AAAAADH9AAAAAP/gAAAAAb+YAAAAA/+AAAAAD/CAAAAAD/4AAAAAf/wAAAAAP/gAAAAH//AAAAAA/+AAAAB+D4AAAAAB/8AAAAPgHgAAAAAH/wAAAB4AMAAAAAAf/AAAAHADAAAAAAB/8AAAAwAQAAAAAAH/wAAAHAAAAAAAAAf+AAAA8AAAAAAAAB/4AAADAAAAAAAAAH8AAAAeAAAAAAAAAPgAAABwAAAAAAAAA8AAAAAAAAAAAAAABAA==","h":79,"w":93},"limnodromus-griseus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//gAAAAAAAAAAAAP/8AAAAAAAAAAAAB//wAAAAAAAAAAAAP/+AAAAAAAAAAAAD//wAAAAAAAAAAAAf//AAAAAAAAAAAAH//4AAAAAAAAAAAB///AAAAAAAAAAAAf//4AAAAAAAAAAAP///AAAAAAAAAAAD///4AAAAAAAAAAB/h//AAAAAAAAAAAfwP/4AAAAAAAAAAP4D/+AAAAAAAAAAD8A//4AAAAAAAAAB+AH//AAAAAAAAAAfAB//+AAAAAAAAAPwAP///gAAAAAAAD4AB////wAAAAAAA8AAP////4AAAAAAPAAD/////4AAAAABAAAf/////4AAAAAAAAD//////wAAAAAAAAf//////wAAAAAAAB///////gAAAAAAAP///////gAAAAAAB////////gAAAAAAP////////4AAAAAA//////////gAAAAH//////////8AAAA///////////gAAAD//////////wAAAAf/////////+AAAAD//////////AAAAAP/////////wAAAAB//////////wAAAAH//////////AAAAAf/////////wAAAAD/////////8AAAAAP////////AAAAAAA////////AAAAAAAB//////+AAAAAAAAH/////8AAAAAAAAAP/////AAAAAAAAAA/////gAAAAAAAAAA////4AAAAAAAAAAD///4AAAAAAAAAAAf//4AAAAAAAAAAAB4D/AAAAAAAAAAAAPAB4AAAAAAAAAAABwAHgAAAAAAAAAAAOAAeAAAAAAAAAAAAwAB4AAAAAAAAAAAGAAPAAAAAAAAAAAA4AB4AAAAAAAAAAAPAAPAAAAAAAAAAAB4ABwAAAAAAAAAAAOAAOAAAAAAAAAAABwABwAAAAAAAAAAAOAAOAAAAAAAAAAADgABwAAAAAAAAAAAcAAOAAAAAAAAAAADgABwAAAAAAAAAAA4AAMAAAAAAAAAAAHAADgAAAAAAAAAAA4AAcAAAAAAAAAAAPAAD8AAAAAAAAAABwAAfgAAAAAAAAA8PgGHgAAAAAAAAAD/+B/8AAAAAAAAAH/8wB/AAAAAAAAAB//gP/4AAAAAAAAAADwD/jAAAAAAAAAAB8AAA4AAAAAAAAAAeAAAOAAAAAAAAAAAAAADgAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":83,"w":93},"limnodromus-scolopaceus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAf/gAAAAAAAAAAAAH/+AAAAAAAAAAAAA//4AAAAAAAAAAAAP//AAAAAAAAAAAAB//4AAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAAf//gAAAAAAAAAAAD//+AAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAA//5/AAAAAAAAAAAH//D+AAAAAAAAAAA//8H4AAAAAAAAAB///gfgAAAAAAAAA///+A/AAAAAAAAAf///wD8AAAAAAAAP///+AH4AAAAAAAD////4APgAAAAAAA/////AA+AAAAAAAf////4AB8AAAAAAP/////AAHwAAAAAD/////4AAPAAAAAB/////+AAA8AAAAAf/////wAABgAAAAH/////+AAAAAAAAB//////wAAAAAAAAf/////8AAAAAAAAH//////gAAAAAAAB//////8AAAAAAAAf//////AAAAAAAAH//////4AAAAAAAB///////AAAAAAAAf//////wAAAAAAAH//////8AAAAAAAB///////gAAAAAAAf//////4AAAAAAAH//////+AAAAAAAD///////gAAAAAAA///////8AAAAAAAf///////AAAAAAAH///////wAAAAAAD///////8AAAAAAB////////AAAAAAB////////gAAAAAA////////wAAAAAAP///////4AAAAAAA///////8AAAAAAAH//////+AAAAAAAAH//////gAAAAAAAB//////8AAAAAAAAf/wAf/7gAAAAAAAH4AAAEeYAAAAAAAAcAAAABjAAAAAAAAAAAAAAM4AAAAAAAAAAAAADnAAAAAAAAAAAAAAe4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAf4AAAAAAAAAAAAAB/AAAAAAAAAAAAAAO4AAAAAAAAAAAAAB/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAD4AAAAAAAAAAAAAAfAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAPAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAPAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAHDwAAAAAAAAAAAAB/88AAAAAAAAAAAAf//wAAAAAAAAAAAHf/AAAAAAAAAAAAAh4AAAAAAAAAAAAAAD4AAAAAAAAAAAAAAP4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":85,"w":93},"limnothlypis-swainsonii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAA///AAAAAAAAAAAAP//8AAAAAAAAAAAH///wAAAAAAAAAAB////AAAAAAAAAAAf///+AAAAAAAAAAH/////wAAAAAAAAB//////gAAAAAAAA//////8AAAAAAAAf////+AAAAAAAAAP/////gAAAAAAAAH/////4AAAAAAAAD/////+AAAAAAAAA//////gAAAAAAAAf/////4AAAAAAAAH//////AAAAAAAAD//////wAAAAAAAB//////+AAAAAAAAf//////gAAAAAAAP//////8AAAAAAAD///////gAAAAAAA///////8AAAAAAAP///////gAAAAAAP///////8AAAAAAP////////AAAAAAP////////4AAAAAf////////+AAAAAf/////////wAAAA//////////8AAAA///3///////AAAAf//x///////4AAAH//////////+AAAA//gP///////gAAAP/wD///////4AAAB/gA///////+AAAADgAH8P/////gAAAAAAB8A/////4AAAAAAAMAD////8AAAAAAAAAAH///+AAAAAAAAAAAf////8AAAAAAAAAA/////wAAAAAAAAAAf/wH/AAAAAAAAAAH/gD34AAAAAAAAAAeAA4fAAAAAAAAAADwAODgAAAAAAAAAAHABgeAAAAAAAAAAAeAMHgAAAAAAAAAAB4AAMAAAAAAAAAAAHAADAAAAAAAAAAAAeAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAH4AAAAAAAAAAAAAAfwAAAAAAAAAAAAAP/AAAAAAAAAAAAAH/4AAAAAAAAAAAAB4/AAAAAAAAAAAAAODgAAAAAAAAAAAABA8AAAAAAAAAAAAAAHgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":68,"w":93},"limosa-fedoa":{"bits":"AAAAAD+AAAAAAH/gAAAAAH/4AAAAAD/8AAAAAD//AAAAAB//gAAAAB//4AAAAB//8AAAAB//+AAAAB///AAAAB///gAAAD8H/wAAAD4D/4AAAH4B/8AAAHwB/+AAAHgA//AAAPgAf/gAAPAAP/wAAPAAP/4AAOAAP/+AAOAAP//AAOAAP//wAOAAf//4AGAAf//+AAAA////AAAA////wAAB////4AAB////8AAB////+AAB/////AAB/////gAB/////wAA/////4AA/////4AA/////8AAf////+AAf////+AAP/////AAP/////AAP/////AAP/////gAP/////gAP/////gAH/////wAH/////wAH/////wAH/////gAP/////gAP/////gAP/////gAP/////gAB/////wAB////3wAB//j37wAAH/AB4wAAD+AA84AAD+AAccAAB8AAGMAAAAAADGAAAAAADnAAAAAABzgAAAAAA5wAAAAAAc4AAAAAAOcAAAAAAHOAAAAAADnAAAAAABxgAAAAAAYwAAAAAAMYAAAAAAGMAAAAAADGAAAAAABjAAAAAAAxgAAAAAAYwAAAAAAMYAAAAAAHMAAAAAADmAAAAAAAzgAAAAAAZwAAAAAAN4AAAAAAH/AAAAAADv8AAAAADn/gAAAAD7PAAAAAB/z4AAAAAf+eAAAAAf/xAAAAAc4IAAAAAMOAAAAAAMDAAAAAAMA4AAAAAAAMAAAAAAACAAA","h":93,"w":49},"limosa-haemastica":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/AAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAD//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//wAAAAAAAAAAAD//+AAAAAAAAAAAA///wAAAAAAAAAAAP//+AAAAAAAAAAAD8P/wAAAAAAAAAAB+A/+AAAAAAAAAAAfAH/4AAAAAAAAAAPwA//+AAAAAAAAAD4AP///AAAAAAAAB8AB////AAAAAAAAfAAP////AAAAAAAHgAD/////AAAAAADwAAf////+AAAAAA8AAD/////8AAAAAOAAAf/////4AAAAHgAAD//////wAAABwAAAf//////AAAAMAAAD//////8AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAH///////AAAAAAAA///////+AAAAAAAD///////8AAAAAAAP///////8AAAAAAA////////+AAAAAAD/////////AAAAAAP////////8AAAAAB/////////AAAAAAH////////8AAAAAAf////////AAAAAAB////////wAAAAAAH////////AAAAAAAP///////4AAAAAAAP////8B+AAAAAAAAf///8AAAAAAAAAAB///+AAAAAAAAAAAH//4AAAAAAAAAAAA+/8AAAAAAAAAAAADz/wAAAAAAAAAAAAMHnAAAAAAAAAAAABg8eAAAAAAAAAAAAGDjwAAAAAAAAAAAAwP8AAAAAAAAAAAAGH/AAAAAAAAAAAAA/+AAAAAAAAAAAAAf4wAAAAAAAAAAAAP4HAAAAAAAAAAAAB3A4AAAAAAAAAAAAewHAAAAAAAAAAAAD2A4AAAAAAAAAAAA+wHAAAAAAAAAAAAH+AwAAAAAAAAAAAA/wGAAAAAAAAAAAAHGAwAAAAAAAAAAAA8wGAAAAAAAAAAAAH2AwAAAAAAAAAAAAYwGAAAAAAAAAAAAAGAwAAAAAAAAAAAAAwGAAAAAAAAAAAAAGAwAAAAAAAAAAAAAwGAAAAAAAAAAAAAGAwAAAAAAAAAAAAAwGAAAAAAAAAAAAH/AwAAAAAAAAAAAP//nAAAAAAAAAAAAAdv8AAAAAAAAAAAAP/+gAAAAAAAAAAAHgDgAAAAAAAAAAABgA4AAAAAAAAAAAAIAcAAAAAAAAAAAAAAHAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":83,"w":93},"lophodytes-cucullatus":{"bits":"AAAAAAD84AAAAAAAAAAH////AAAAAAAAAAH////4AAAAAAAAAD/////AAAAAAAAAA/////wAAAAAAAAAP////+AAAAAAAAAD/////wAAAAAAAAA/////8AAAAAAAAAH/////gAAAAAAAAB/////4AAAAAAAAAP////+AAAAAAAAAD/////wAAAAAAAAA/////8AAAAAAAAAf/////AAAAAAAAA//////gAAAAAAAB//////gAAAAAAAA//////wAAAAAAAAH/8f//+AAAAAAAAAwAA///wAAAAAAAAAAAA//+AAAAAAAAAAAAB//wAAAAAAAAAAAB//8AAAAAAAAAAAA///gAAAAAAAAAAAP//8AAAAAAAAAAAD////+AAAAAAAAAA//////AAAAAAAAAP//////AAAAAAAAB//////+AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////gAAAAAAH///////+AAAAAAA////////8AAAAAAH////////wAAAAAA/////////AAAAAAH////////8AAAAAA/////////wAAAAAH/////////gAAAAAf////////+AAAAAD/////////8AAAAAf/////////wAAAAB/////////+AAAAAP/////////4AAAAB//////////gAAAAH/////////8AAAAAf/////////4AAAAB//////////wAAAAH//////////AAAAAf/////////8AAAAB//////////wAAAAD//////////AAAAAH////////78AAAAAf////////jwAAAAB////////+GAAAAAH////////wAAAAAAf////////AAAAAAB////////4AAAAAAH////////gAAAAAAf///////8AAAAAAB////////4AAAAAAD////////gAAAAAAP///////+AAAAAAA////////4AAAAAAB////////gAAAAAAD///////8AAAAAAAH///////wAAAAAAAf//////4AAAAAAAH///////gAAAAAAA////////AAAAAAAH///////8AAAAAAB/+//////wAAAAAAP/8HwA//+AAAAAAB//j8AB//wAAAAAAP/A/AAD//AAAAAAB/4H+AAH/4AAAAAAGeA/wAAE+AAAAAAADwP6AAAAAAAAAAAAPj/QAAAAAAAAAAAAA/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAF/wAAAAAAAAAAAAAH/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/gAAAAAAAAAAAAAf8AAAAAAAAAAAAABjwAAAAAAAAAAAAAOGAAAAAAAAAAAAAAwAAAAA","h":89,"w":93},"loxia-curvirostra":{"bits":"AA/+AAAAAAAAAAAAA//8AAAAAAAAAAAAP//4AAAAAAAAAAAH///gAAAAAAAAAAB///+AAAAAAAAAAA////4AAAAAAAAAAP////gAAAAAAAAAD////+AAAAAAAAAA/////4AAAAAAAAAH/////gAAAAAAAAA/////+AAAAAAAAAAP////+AAAAAAAAAA/////+AAAAAAAAAH/////8AAAAAAAAA//////8AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAB///////AAAAAAAAP//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAA////////AAAAAAAH///////8AAAAAAA////////4AAAAAAH////////gAAAAAAf////////AAAAAAD////////8AAAAAAf////////wAAAAAB/////////AAAAAAP////////8AAAAAA/////////wAAAAAH/////////AAAAAAf////////8AAAAAD/////////wAAAAAP/////////gAAAAA/////////+AAAAAD/////////8AAAAAf/////////wAAAAB//////////AAAAAH/////////+AAAAAf/////////4AAAAB//////////gAAAAD/////////+AAAAAP/////////QAAAAAf////////8AAAAAA////////3gAAAAAB////////AAAAAAAD////w//8AAAAAAAP///4B//wAAAAAAB///gAB//AAAAAAAP//4AAB/+AAAAAAA///AAAH/4AAAAAAH//gAAAf/gAAAAAAf8AAAAA/+AAAAAAA/gAAAAH/8AAAAAAP/wAAAAP/wAAAAAD/+AAAAA//AAAAAAfR4AAAAD/8AAAAADyDAAAAAP/wAAAAAf4wAAAAA//AAAAAB/0AAAAAD/4AAAAAD+AAAAAAP/AAAAAAPAAAAAAA/gAAAAAAAAAAAAAB8AAAAAAAAAAAAAAHg","h":65,"w":93},"loxia-leucoptera":{"bits":"AAAAAAAAAAAAAAAAAAGAAAAAAAAAAAAAAf/gAAAAAAAAAAAAP//AAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAAf///gAAAAAAAAAAH///+AAAAAAAAAAD////4AAAAAAAAAA/////gAAAAAAAAAP////+AAAAAAAAAB/////4AAAAAAAAAB/////wAAAAAAAAAB/////gAAAAAAAAAP/////AAAAAAAAAB/////+AAAAAAAAAP/////8AAAAAAAAA//////4AAAAAAAAH//////wAAAAAAAAf//////AAAAAAAAD//////8AAAAAAAAf//////4AAAAAAAD///////gAAAAAAAf///////AAAAAAAD///////8AAAAAAAP///////4AAAAAAB////////gAAAAAAP///////+AAAAAAB////////4AAAAAAH////////wAAAAAA/////////AAAAAAH////////8AAAAAAf////////wAAAAAB/////////AAAAAAP////////8AAAAAA/////////wAAAAAH/////////AAAAAAf////////+AAAAAB/////////8AAAAAH/////////wAAAAAf/////////gAAAAB/////////+AAAAAH/////////4AAAAAf////////9AAAAAB/////////gAAAAAD/////////AAAAAAH////////+AAAAAAH////gH//8AAAAAAP///wAD//4AAAAAA///gAAB//gAAAAAfAfwAAAD//AAAAD//j+AAAAP/8AAAA//8/AAAAAf/gAAAP8AeAAAAAB/8AAAD+APgAAAAAD+AAAAdg//4AAAAAHwAAACIf//AAAAAAfAAAARH/AIAAAAAAwAAAAB/wAAAAAAAAAAAAAe4AAAAAAAAAAAAACOAAAAAAAAAAAAAAxgAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":65,"w":93},"mareca-americana":{"bits":"AAB/gAAAAAAAAAAAAf/gAAAAAAAAAAAH//gAAAAAAAAAAA///AAAAAAAAAAAH//+AAAAAAAAAAA///+AAAAAAAAAAD///4AAAAAAAAAAf///wAAAAAAAAAB////gAAAAAAAAAH///+AAAAAAAAAAf///4AAAAAAAAAB////wAAAAAAAAAH////AAAAAAAAAA////8AAAAAAAAAD////wAAAAAAAAAf////AAAAAAAAAD////8AAAAAAAAAf////gAAAAAAAAH////+AAAAAAAAA/+P//gAAAAAAAAH/B//8AAAAAAAAA/wP//gAAAAAAAAD8B////4AAAAAAAOAf////+AAAAAAAAD//////AAAAAAAAf//////AAAAAAAD///////gAAAAAAf///////AAAAAAB////////AAAAAAP////////AAAAAA////////+AAAAAH////////+AAAAAf////////8AAAAB/////////4AAAAP/////////wAAAA//////////wAAAD//////////gAAAP//////////gAAA///////////AAAD///////////AAAP//////////+AAAf//////////4AAB///////////8AAH///////////+AAf///////////+AA////////////+AD////////////8AH///////////4wAf///////////8AA////////////8AB////////////4AD////////////wAH////////////AAP///////////AAAf///////////AAA///////////+AAA///////////+AAB///////////8AAD///////////wAAH/////////n/AAAH///////+AAAAAAP///////AAAAAAAP//////wAAAAAAAP/////8AAAAAAAAP/////gAAAAAAAAH////4AAAAAAAAH////8AAAAAAAAB////8AAAAAAAAAf/5AHgAAAAAAAAH//gAeAAAAAAAAAf/+AB4AAAAAAAADf/4AHAAAAAAAAAAf/gAcAAAAAAAAAB/8ABwAAAAAAAAAH/wAPAAAAAAAAAAcBgA8AAAAAAAAABgAADwAAAAAAAAAEAAAfgAAAAAAAAAAAAD+AAAAAAAAAAAAD/oAAAAAAAAAAAf/+AAAAAAAAAAAD//4AAAAAAAAAAAB//gAAAAAAAAAAAH/+AAAAAAAAAAAAf/4AAAAAAAAAAAB//gAAAAAAAAAAAH/+AAAAAAAAAAAA//wAAAAAAAAAAAH//AAAAAAAAAAAAYH4AAAAAAAAAAAAAHgAAAAAAAAAAAAAIAAAAAAAAAAAAAAgAAAAAA","h":93,"w":88},"mareca-penelope":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAf///AAAAAAAAAAAD///8AAAAAAAAAAAf///gAAAAAAAAAAH//////4AAAAAAAB///////4AAAAAAAf///////4AAAAAAH////////wAAAAAD//////////wAwAB///////////z/wAP////////////4AB+///////////4AAIP//////////8eAAB////////////8AAf////////////AAD////////////gAA//////////////AH/////////////8A//////////////AH/////////////4A/////////////8AH////////////+AA////////////8AAD///////////+AAAf///////////AAAB///////////gAAAP//////////4AAAA//////////+AAAAD//////////gAAAAH/////////wAAAAAf////////4AAAAAA////////+AAAAAAA////////AAAAAAAAf//////gAAAAAAAAP////+AAAAAAAAAAH///8AAAAAAAAAAD///eAAAAAAAAAAA//sDgAAAAAAAAAAG/8AcAAAAAAAAAAAD/gDgAAAAAAAAAAAeMA8AAAAAAAAAAACAAHwAAAAAAAAAAAAP/+AAAAAAAAAAAAB//QAAAAAAAAAAAAD/4AAAAAAAAAAAAAf+AAAAAAAAAAAAAH/wAAAAAAAAAAAAD/8AAAAAAAAAAAAAZ/gAAAAAAAAAAAAAD4AAAAAAAAAAAAAAeAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":62,"w":93},"mareca-strepera":{"bits":"AAD/gAAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAP//4AAAAAAAAAAAD///gAAAAAAAAAAAf//8AAAAAAAAAAAD///gAAAAAAAAAAA///+AAAAAAAAAAAP///wAAAAAAAAAAD///+AAAAAAAAAAB////wAAAAAAAAAA////+AAAAAAAAAAP/j//wAAAAAAAAAH/gH/+AAAAAAAAAA/gB//gAAAAAAAAAHwAf/8AAAAAAAAAAAAH//AAAAAAAAAAAAB//4H//wAAAAAAAAf/+P///+AAAAAAAH//n//////gAAAAB//7///////wAAAAf//////////8HAAH/////////////AB/////////////wAP////////////8AD/////////////wAf/////////////AH//////////////A//////////////4H//////////////A//////////////wH/////////////8A/////////////+AH/////////////AA/////////////AAH////////////wAA////////////8AAH////////////AAA////////////wAAD///////////8AAAf///////////AAAB///////////gAAAH//////////4AAAA//////////8AAAAD//////////AAAAAH/////////wAAAAAf////////4AAAAAB////////4AAAAAAB///////+AAAAAAAD///////AAAAAAAAD//////wAAAAAAAAD/////4AAAAAAAAAD////gAAAAAAAAAAD///8AAAAAAAAAAAAP8PAAAAAAAAAAAAD/h4AAAAAAAAAAAAf4PAAAAAAAAAAAAD/h4AAAAAAAAAAAAf8HAAAAAAAAAAAAD+A4AAAAAAAAAAAAfgHAAAAAAAAAAAACYB4AAAAAAAAAAAABgPwAAAAAAAAAAAAAB+AAAAAAAAAAAAAA/gAAAAAAAAAAAAf/4AAAAAAAAAAAAB//AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//AAAAAAAAAAAAAP/4AAAAAAAAAAAAB//AAAAAAAAAAAAAf/wAAAAAAAAAAAAAB8AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAwAAAAAAAA=","h":77,"w":93},"megaceryle-alcyon":{"bits":"AAAAAwAAAAAAAAAABoAAAAAAAAAAD+AAAAAAAAAAH+AAAAAAAAAAP/AAAAAAAAAAP/wAAAAAAAAAf/4AAAAAAAAA//8gAAAAAAAB///gAAAAAAAB///gAAAAAAAD///wAAAAAAAH///8AAAAAAAH///4AAAAAAAP///8AAAAAAAP///4AAAAAAAf////AAAAAAAf///+AAAAAAAf///8AAAAAAAf///8AAAAAAB////+AAAAAB//////AAAAAf//////AAAAD///////AAAAf///////AAAA////////AAAAP///////AAAAAD7/////AAAAAAD/////AAAAAAAf////AAAAAAAH////AAAAAAAH////AAAAAAAH////gAAAAAAD////wAAAAAAH////4AAAAAAH////+AAAAAAH/////AAAAAAP/////gAAAAAP/////wAAAAAP/////4AAAAAP/////8AAAAAP/////+AAAAAP//////AAAAAP//////AAAAAH//////gAAAAH//////wAAAAH//////wAAAAH//////4AAAAD//////4AAAAD//////8AAAAB//////8AAAAB//////8AAAAA//////+AAAAA//////+AAAAAf/////+AAAAAf//////AAAAAP//////AAAAAH//////gAAAAD//////wAAAAB//////wAAAAA//////wAAAAAf/////wAAAAAf/////4AAAAAH/////4AAAAAD/////4AAAAAB/////4AAAAAH/////wAAAAAH/////gAAAAAHP////wAAAAAPD////4AAAAAPj////4AAAAAPjz///8AAAAAHHw///+AAAAADn4P//+AAAAAAH4D///AAAAAAB4Af/nAAAAAAA8AP/jAAAAAAAYAD/gAAAAAAAAAD/gAAAAAAAAAB/gAAAAAAAAAB/wAAAAAAAAAA/wAAAAAAAAAA/wAAAAAAAAAAf4AAAAAAAAAAf4AAAAAAAAAAf8AAAAAAAAAAP8AAAAAAAAAAH8AAAAAAAAAAH+AAAAAAAAAAD+AAAAAAAAAAD/AAAAAAAAAAB/AAAAAAAAAAAfAAAAAAAAAAAP","h":93,"w":72},"megaceryle-torquata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/+AAAAAAAAAAA///AAAAAAAAAAP///AAAAAAAAD/////AAAAAAf///////AAAAAf///////+AAAAD////////8AAAAD////////4AAAAB////////wAAAAAf///////AAAAAAD//////8AAAAAAAP/////wAAAAAAAf/////gAAAAAAAf////+AAAAAAAAf////4AAAAAAAA/////gAAAAAAAB/////AAAAAAAAD////4AAAAAAAAP////wAAAAAAAA////+AAAAAAAAD////4AAAAAAAAP////wAAAAAAAB/////gAAAAAAAH/////AAAAAAAAf////+AAAAAAAB/////8AAAAAAAH/////4AAAAAAAf/////wAAAAAAB//////gAAAAAAH//////AAAAAAAf/////8AAAAAAB//////4AAAAAAH//////wAAAAAAf//////gAAAAAB//////+AAAAAAD//////8AAAAAAP//////wAAAAAA///////gAAAAAB//////+AAAAAAH//////4AAAAAAP//////wAAAAAA///////AAAAAAB//////+AAAAAAH//////4AAAAAAP//////gAAAAAAf/////+AAAAAAB//////8AAAAAAD//////wAAAAAAH//////gAAAAAAP/////+AAAAAAAf/////4AAAAAAA//////gAAAAAAB/////+AAAAAAAD/////8AAAAAAAD/////wAAAAAAA//////AAAAAAAD/////8AAAAAAAff////gAAAAAAB5////+AAAAAAAH9////4AAAAAAAPP////gAAAAAAA+f///+AAAAAAAA5/3//8AAAAAAAAH+P//wAAAAAAAAHwf//gAAAAAAAACA///AAAAAAAAAAD//8AAAAAAAAAAH/5wAAAAAAAAAAP/jAAAAAAAAAAA/+AAAAAAAAAAAB/4AAAAAAAAAAAH/gAAAAAAAAAAAf+AAAAAAAAAAAB/4AAAAAAAAAAAD/gAAAAAAAAAAAP/AAAAAAAAAAAA/8AAAAAAAAAAAB/wAAAAAAAAAAAH/gAAAAAAAAAAAf+AAAAAAAAAAAA/4AAAAAAAAAAAD/gAAAAAAAAAAAH/AAAAAAAAAAAAf8AAAAAAAAAAAB/wAAAAAAAAAAAD/AAAAAAAAAAAAH8AAAAAAAAAAAAfwAAAAAAAAAAAA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":82},"megascops-asio":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAHAAAAAAAwAAAAB4AAAAAAHwAAAAPAAAAAAB/AAAAP4AAAAAAH8AA8H+AAAAAAA/x//+/4AAAAAAH/////+AAAAAAA//////wAAAAAAH/////+AAAAAAAf/////gAAAAAAB/////+AAAAAAAP/////4AAAAAAD//////gAAAAAAf/////+AAAAAAH//////wAAAAAA///////AAAAAAH//////4AAAAAB///////gAAAAAP//////8AAAAAB///////wAAAAAP///////AAAAAB///////4AAAAAP///////gAAAAB///////8AAAAAP///////4AAAAB////////gAAAAP////////AAAAB////////8AAAAP////////4AAAB/////////gAAAH////////+AAAA/////////4AAAH/////////gAAAP////////+AAAD/////////4AAAf/////////gAAD/////////8AAAf/////////wAAD/////////+AAAf/////////4AAD//////////AAAf/////////8AAD//////////gAAP/////////+AAB//////////wAAP/////////+AAB//////////4AAH//////////AAA//////////4AAH//////////gAAf/////////8AAD//////////gAAP/////////+AAB//////////wAAH//////////AAAf/////////8AAA//////////gAAH/////////8AAAf/////////wAAB/////////+AAAP/////////gAAA/////////8AAAD/////////wAAAP////////+AAAA/////////wAAAD/////////AAAAf////////4AAAA/////////AAAAD////////4AAAAP////////AAAAAf///////4AAAAB////////gAAAAH///////+AAAAAf///////4AAAAD////////AAAAAf///////4AAAAB////////gAAAAP///z///8AAAAH///+P///gAAAH////g///8AAAP////8H///AAAD///4/gf/94AAA////8QB//jAAAG8f//wAP/+AAAAkH/x/AA//wAAAAg3wB4AD/+AAAAAAwABAAP/wAAAAAGAAAAA//AAAAAAAAAAAB/wAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":81},"megascops-kennicottii":{"bits":"AAAAAAAAAfvwAAAAAAAAA4P//8AAAAAAAAD9////fAAAAAAAH/////+AAAAAAAP/////8AAAAAAAf/////4AAAAAAAf/////wAAAAAAB//////gAAAAAAD//////gAAAAAAP//////AAAAAAAf//////AAAAAAB//////+AAAAAAD//////8AAAAAAP//////4AAAAAAf//////4AAAAAA///////wAAAAAD///////gAAAAAH///////AAAAAAf//////+AAAAAA///////8AAAAAD///////wAAAAAP///////gAAAAB////////AAAAAP///////+AAAAA////////8AAAAH////////4AAAAf////////gAAAB////////+AAAAH////////8AAAA/////////4AAAD/////////wAAAP/////////gAAAf/////////AAAB/////////+AAAH/////////8AAAP/////////4AAA//////////gAAD//////////AAAH/////////+AAAf/////////4AAA//////////wAAD//////////AAAP/////////+AAAf/////////4AAB//////////wAAD//////////gAAP/////////+AAAf/////////8AAA//////////4AAD//////////gAAH//////////AAAf/////////8AAB//////////4AAB//////////gAAH/////////+AAAP/////////4AAA//////////gAAB/////////+AAAD/////////4AAAH/////////wAAAf/////////AAAA/////////8AAAB/////////4AAAH/////////gAAAP////////8AAAAf////////wAAAA////////+AAAAB////////4AAAAD////////wAAAAP////////AAAAA////////8AAAAB////////wAAAAH////////gAAAAP////////AAAAA/////////AAAAD////v////AAAAH///+f/9/+AAAAP9//4f/5///AAA/j//gf/5///AAB8P//Af/z///AADwf/+Af/////AAGA//4AP////+AAAB//wA///n/8AAAH//AA//7g/4AAAP/+AA///wLAAAAf/4AH///wGAAAA//gAf///gIAAAB/8AA///9AAAAAD/wABdx/+AAAAAD/AACAAP4AAAAADYAAAAAGwAAAAAAAAAAAABgAAAAAAAAAAAACAAAAA=","h":93,"w":83},"melanerpes-aurifrons":{"bits":"AAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAH/+AAAAA////8AAAAD////4AAAAD////wAAAAB////AAAAAA///+AAAAAB///4AAAAAD///gAAAAAD///AAAAAAH//8AAAAAAP//gAAAAAAf/+AAAAAAA//4AAAAAAD//gAAAAAAP//AAAAAAB///AAAAAAH//+AAAAAAf//+AAAAAD///8AAAAAP///4AAAAB////wAAAAH////AAAAAf///+AAAAB////8AAAAH////wAAAAf////gAAAB////+AAAAH////8AAAAf////wAAAB/////gAAAD////+AAAAP////4AAAA/////wAAAB/////AAAAH////8AAAAP////4AAAA/////gAAAB/////AAAAH////8AAAAP////wAAAAf////gAAAA////+AAAAB////4AAAHz////wAAD/3////AAAP/////8AABgP////wAAAAf////gAAAB////+AAAAD////4AAAAO////gAAAAZ///+AAAAHj///4AAAAMH///gAAAAAB//+AAAAAAB//8AAAAAAH//wAAAAAAP//AAAAAAAf/+AAAAAAA//4AAAAAAB//gAAAAAAH//AAAAAAAf/8AAAAAAB//wAAAAAAH//AAAAAAAf/YAAAAAAB/8AAAAAAAH/wAAAAAAAf/AAAAAAAB/8AAAAAAAH/wAAAAAAAf/gAAAAAAB/+AAAAAAAH/4AAAAAAAP/gAAAAAAA/+AAAAAAAB/4AAAAAAAD/gAAAAAAAP+AAAAAAAAf8AAAAAAAA/wAAAAAAAA7AAAAAAAABuAAAAAAAAHYAAAAAAAANgAAAAAAAAzAAAAAAAABgAAAAAAAAGAAAAAAAAAAAAAAAAAAAAA","h":93,"w":58},"melanerpes-carolinus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAD/4AAAB/g//wAAAH////wAAAH////gAAAD////AAAAD///8AAAAD///4AAAAH///gAAAAP///AAAAAf//8AAAAA///wAAAAB///AAAAAH//8AAAAAP//gAAAAA//+AAAAAH//4AAAAA///gAAAAP//+AAAAB///4AAAAP///gAAAB///+AAAAP///4AAAB////AAAAP///8AAAB////4AAAP////gAAA////+AAAH////4AAA/////gAAD////+AAAP////4AAB/////gAAH////+AAA/////4AAD/////AAAf////8AAB/////wAAH////+AAA/////4AAD/////AAAf////8AAB/////gAAP////+AAA/////wAAD////+AAAf////4AAB/////AAAH////4AAA/////GAAD////98AAP////v8AA////5/4AH//////gAf/////8AB////vAQAH////4BAA////+AAAD////gAAAf//9sAAAB///AwAAAP//8BAAAA///gAAAAHf/8AAAAAb//gAAAAD//+AAAAAN//wAAAABv//AAAAAH//8AAAAAH3/gAAAAA8/+AAAAADD/4AAAAAAP/gAAAAAB/+AAAAAAH/4AAAAAA//AAAAAAD/8AAAAAAP/wAAAAAB/+AAAAAAH/wAAAAAA/+AAAAAADvgAAAAAAd4AAAAAADnAAAAAAAMYAAAAAABzgAAAAAAOMAAAAAAAxwAAAAAAAOAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":52},"melanerpes-erythrocephalus":{"bits":"AAAAAAAAAAAAAAAAAADAAAAAAAAAAD/wAAAAAAAAB//gAAAAAAAA//+AAAAAAAAP//8AAAAAAAB///wAAAAAAAf////4AAAAAH/////gAAAAA/////4AAAAAH////gAAAAAB////AAAAAAAP///wAAAAAAB///4AAAAAAAP//+AAAAAAAB///gAAAAAAAP//8AAAAAAAB///AAAAAAAAf//4AAAAAAAH//+AAAAAAAB///wAAAAAAAf///AAAAAAAH///4AAAAAAD////AAAAAAA////8AAAAAAH////gAAAAAB////8AAAAAAf////gAAAAAH////8AAAAAA/////gAAAAAP////8AAAAAD/////gAAAAAf////8AAAAAH/////gAAAAA/////8AAAAAH/////gAAAAB/////4AAAAAP/////AAAAAD/////4AAAAAf/////AAAAAH/////wAAAAA/////+AAAAAP/////gAAAAD///+f8AAAAAf///g/AAAAAD///8AwAAAAA////AGAAAAAH///wBgAAAAA///4AYAAAAAP//+ACAAAAAB///gAwAAAAAf//4AMAAAAAD//+ADAAAAAAf//gAz4AAAAH//4AP/gAAAA//+AD/+AAAAH//gA//4AAAA//wAP4DAAAAP/8Bj+AIAAAB//AN3gAAAAAf/wD/4AAAAAH/+D/OAAAAAB//w5hwAAAAAP/8MAGAAAAAD//jgAAAAAAA//84AAAAAAAH//sAAAAAAAB///AAAAAAAAP7/QAAAAAAAB+f+AAAAAAAAPn/gAAAAAAABw/4AAAAAAAAMH+AAAAAAAAAA/wAAAAAAAAAP+AAAAAAAAAB/wAAAAAAAAAP+AAAAAAAAAB/gAAAAAAAAAf8AAAAAAAAAD/gAAAAAAAAAf4AAAAAAAAAH+AAAAAAAAAA/wAAAAAAAAAP8AAAAAAAAAB+AAAAAAAAAAfwAAAAAAAAAD4AAAAAAAAAA+AAAAAAAAAAHwAAAAAAAAABsAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":69},"melanerpes-formicivorus":{"bits":"AAAB/AAAAAAH/4AAAAAH//AAAAAH//wHwAAH////+AAH////+AAD////wAAB////AAAB///8AAAA///8AAAAf//8AAAAf//8AAAAD//8AAAAB//8AAAAA//+AAAAAf//AAAAAP//gAAAAH//wAAAAH//4AAAAH//+AAAAH///AAAAH///wAAAD///4AAAD///8AAAD///+AAAB////gAAB////wAAA////4AAAf///8AAAf///+AAAP////AAAP////gAAH////wAAD////4AAB////8AAB////+AAA////+AAAf////AAAP////gAAH////gAAH////wAAD////4AAB////4AAA////8AAA////+AAAf///+AAAP////AAAH////AAAD////gAAB////gAAA////wAAA////wAAAf///wAAAP////gAAH////4AAD////0AAB////6AAA////OAAAf///jgAAP///hgAAH//9gwAAD//4xwAAD//8eAAAB//8HAAAA//+AAAAA//+AAAAAf/+AAAAAP//AAAAAP7/gAAAAH5/4AAAAC4f8AAAABcP+AAAAAcH/AAAAAMD/gAAAAAB/wAAAAAA/4AAAAAAf+AAAAAAP/AAAAAAH/gAAAAAD/wAAAAAB/4AAAAAA/4AAAAAA/8AAAAAAf+AAAAAAP+AAAAAAO/AAAAAAH+AAAAAADeAAAAAADOAAAAAABmAAAAAAAjAAAAAAADAAAAAAABgAAAAAA","h":93,"w":49},"melanerpes-lewis":{"bits":"AAAAfwAAAAAAP/wAAAAAD//AAAAAA//+AAAAAP////wAAD/////AAAf////gAAD///8AAAA///+AAAAH///AAAAA///wAAAAD//4AAAAAf/+AAAAAD//wAAAAAf/+AAAAAD//4AAAAAf//gAAAAH//8AAAAB///wAAAAf///AAAAD///4AAAA////AAAAP///4AAAB////AAAAf///4AAAD////AAAA////8AAAH////gAAB////8AAAP////gAAB////4AAAf////AAAD////4AAAf////AAAD////4AAA////+AAAH////wAAA////+AAAP////wAAB/////wAAP/////AAD/////4AAf/////AAD////8IAA/////BAAH////wAAA////8AAAH////gAAB////8AAAP////AAAB////4AAAP///+AAAB////wAAAP///3gAAB////sAAAf///IAAAD///4AAAA///8AAAAH///AAAAA///wAAAAP//4AAAAB///AAAAAf//wAAAAD//+AAAAA///gAAAAG//4AAAAAn//AAAAAB9/4AAAAAPH/AAAAABw/4AAAAAMH/AAAAABg/4AAAAAAH/AAAAAAA/4AAAAAAH/AAAAAAA/4AAAAAAH/AAAAAAA/wAAAAAAH+AAAAAAA/gAAAAAAH8AAAAAAA/gAAAAAAP4AAAAAAB+AAAAAAAPAAAAAAAD4AAAAAAAfAAAAAAAHwAAAAAAA+AAAAAAAHwAAAAAAB8AAAAAAANgAAAAAAAIAAAAAAA=","h":93,"w":51},"melanitta-americana":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAA//AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAP//+AAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAA////8AAAAAAAAAAf////gAAAAAAAAAP////8AAAAAAAAAB/////gAAAAAAAAAP+P//8AAAAAAAAAAAAP//gAAAAAAAAAAAA//8AAAAAAAAAAAAH//AAAAAAAAAAAAA//4AAAAAAAAAAAAH//AAAAAAAAAAAAB//wAAAAAAAAAAAAf/+//gAAAAAAAAAH/////4AAAAAAAAB//////4AAAAAAAAP//////wAAAAAAAD///////gAAAAAAAf///////AAAAAAAH///////+AAAAAAA////////8AAAAAAH////////4AAAAAA/////////wAAAAAP/////////AAAAAA/////////+AAAAAH/////////4AAAAA//////////gAAAAH/////////+AAAAA//////////8AAAAD//////////wAAAAf//////////gAAAB///////////4AAAP///////////gAAA///////////4AAAD//////////wAAAAP//////////AAAAAf/////////8AAAAB//////////4AAAAD//////////4AAAAH//////////4AAAAH//////////AAAAAP/////////8AAAAAP/////////AAAAAAf////////wAAAAB///////4PwAAAAB///////4AAAAAAAP//////8AAAAAAAAf/4f/BYAAAAAAAAD/8APAAAAAAAAAAAP/gB4AAAAAAAAAAD/wAOAAAAAAAAAAAwcADwAAAAAAAAAACBgA8AAAAAAAAAAAAAAHwAAAAAAAAAAAAf//AAAAAAAAAAAAB//4AAAAAAAAAAAAH/+AAAAAAAAAAAAB//AAAAAAAAAAAAAP/4AAAAAAAAAAAAD/+AAAAAAAAAAAAA//wAAAAAAAAAAAAP/8AAAAAAAAAAAABD/AAAAAAAAAAAAAAfwAAAAAAAAAAAAAB8AAAAAAAAAAAAAAOAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"melanitta-perspicillata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAA//gAAAAAAAAAAAAP/+AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAD///4AAAAAAAAAAA////gAAAAAAAAAAP///+AAAAAAAAAAD////wAAAAAAAAAA/////AAAAAAAAAAf////4AAAAAAAAAH////+AAAAAAAAAB/////wAAAAAAAAAP////8B//gAAAAAB/4H/+D///wAAAAAM4A//x////wAAAAAAAP/9/////8AAAAAAB////////8AAAAAAf////////8AAAAAH///////////AAAB///////////wAAAf//////////8AAAD///////////gAAA////////////AAAH////////5///4AA/////////////gAH////////////8AB/////////////gAH////////////8AA/////////////AAH////////////wAA////////////8AAH///////////AAAAf//////////gAAAD//////////wAAAAP/////////+AAAAA//////////gAAAAD/////////4AAAAAP////////8AAAAAAf///////+AAAAAAAf//////+AAAAAAAAD//////wAAAAAAAAf/////8AAAAAAAACf8//+AAAAAAAAAABgh//wAAAAAAAAAAMAP/8AAAAAAAAAAAgD/8AAAAAAAAAAAAA//AAAAAAAAAAAAAGfwAAAAAAAAAAAAAB4AAAAAAAAAAAAAAOAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":57,"w":93},"meleagris-gallopavo":{"bits":"AHgAAAAAAAAAAAd/wAAAAAAAAAAB//gAAAAAAAAAAH//AAAAAAAAAAAP/8AAAAAAAAAAB//4AAAAAAAAAAf//gAAAAAAAAAB//+AAAAAAAAAAP//4AAAAAAAAAA4//gAAAAAAAAAAD/+AAAAAAAAAAAP/wAAAAAAAAAAAf/AAAAAAAAAAAB/4AAAAAAAAAAAH/gAAAAAAAAAAAf8AAAAAAAAAAAD/gAAAAAAAAAAAP8AAAAAAAAAAAA/wAAAAAAAAAAAH/gH//AAAAAAAAf/H///gAAAAAAB//////wAAAAAAP//////wAAAAAA///////wAAAAAD///////wAAAAAP///////gAAAAA////////AAAAAD///////+AAAAAP///////+AAAAA////////8AAAAD////////8AAAAP////////4AAAA/////////wAAAD/////////wAAAH/////////AAAAf/////////AAAB/////////8AAAD/////////4AAAP/////////wAAA//////////gAAH/////////+AAAf/////////8AAD//////////4AAP//////////wAB///////////AAH//////////8AAf//////////4AB///////////gAH//////////+AA/v/////////4AB+//////////gAH5/////////+AAfj/////////8AB/H/////////wAH8H/////////AAfgP////////+AB+Af////////4AD4Af////////gAPAAf///////+AAYAA////////8AAgAA////////wAAAAAf///////AAAAAA//3////+AAAAAB//H////4AAAAAD/8H////wAAAAAD/wA/P//AAAAAAH+AAAP/+AAAAAAP4AAAP/4AAAAAA7gAAA//wAAAAADuAAAB//AAAAAAO4AAAH/+AAAAAB7wAAAP/4AAAAAHvgAAA//wAAAAAe+AAAB//AAAAABzgAAAH/8AAAAAH+AAAAP/4AAAAAf4AAAA//gAAAAB7wAAAB//AAAAA//gAAAD/8AAAAP//gAAAP/wAAAD//+AAAAP/AAAAP/8IAAAAP8AAAAA/AAAAAAAAAAAP/8AAAAAAAAAAAP/8AAAAAAAAAAH/94AAAAAAAAAD//gAAAAAAAAAAP/8AAAAAAAAAAAgfAAAAAAAAAAAADwAAAAAAAAAAAAeAAAAAAAAAAAABgAAAAAAAAAAAAGAAAAAAAAAA","h":93,"w":82},"melopsittacus-undulatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/AAAAAAAAAAAAP//AAAAAAAAAAAD//8AAAAAAAAAAA///wAAAAAAAAAAP///AAAAAAAAAAB///8AAAAAAAAAAP///wAAAAAAAAAB////AAAAAAAAAAP///4AAAAAAAAAB////gAAAAAAAAAP///+AAAAAAAAAB////wAAAAAAAAAP////AAAAAAAAAB////8AAAAAAAAAP////wAAAAAAAAB/////gAAAAAAAAP////+AAAAAAAAB/////4AAAAAAAAH/////wAAAAAAAA//////AAAAAAAAH/////8AAAAAAAA//////4AAAAAAAH//////gAAAAAAA//////+AAAAAAAH//////4AAAAAAAf//////gAAAAAAD//////+AAAAAAAf//////wAAAAAAD///////AAAAAAAP//////8AAAAAAB///////wAAAAAAP///////AAAAAAA///////8AAAAAAH///////wAAAAAA////////AAAAAAD///////8AAAAAAf///////wAAAAAB////////AAAAAAH///////4AAAAAA////////gAAAAAD///////+AAAAAAP///////wAAAAAA////////AAAAAAD///////4AAAAAAP///////wAAAAAAf///////AAAAAAB///////8AAAAAAD///////4AAAAAAP///////gAAAAAAf///////AAAAAAA///////8AAAAAAD///////wAAAAAAf///////AAAAADf///////4AAAAB/////////AAAAA/////////4AAAAP+H/8Af/4fAAAABuf/fAB//gAAAAAJH//4AH/8AAAAAAB///AAf/wAAAAAAfwBoAB/+AAAAAAC8AAAAH/wAAAAAAWAAAAAf/AAAAAAAYAAAAB/8AAAAAAAAAAAAH/gAAAAAAAAAAAAP+AAAAAAAAAAAAA/4AAAAAAAAAAAAD/gAAAAAAAAAAAAP8AAAAAAAAAAAAAfwAAAAAAAAAAAAB/AAAAAAAAAAAAAH8AAAAAAAAAAAAAfwAAAAAAAAAAAAB/AAAAAAAAAAAAAH4AAAAAAAAAAAAAfgAAAAAAAAAAAAB+AAAAAAAAAAAAAH4AAAAAAAAAAAAAfgAAAAAAAAAAAAB8AAAAAAAAAAAAAHwAAAAAAAAAAAAAfAAAAAAAAAAAAAB8AAAAAAAAAAAAAHgAAAAAAAAAAAAAeAAAAAAAAAAAAAD4AAAAAAAAAAAAAPAAAAAAAAAAAAAA8AAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":87},"melospiza-georgiana":{"bits":"AB/4AAAAAAAAAAAAA//4AAAAAAAAAAAAP//gAAAAAAAAAAAH///AAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAH////AAAAAAAAAAD////8AAAAAAAAAA/////wAAAAAAAAfn/////AAAAAAAAf+H/////AAAAAAAP/4P/////AAAAAAP//B//////gAAAAH//wH//////AAAAH//8A//////+AAAD//+AH//////+AAB///AA///////+AA///AAH///////+D///gAAf///////////gAAD///////////wAAAf//////////4AAAD//////////4AAAAf/////////+AAAAD//////////gAAAAP/////////4AAAAB/////////+AAAAAP/////////gAAAAB/////////4AAAAAP/////////gAAAAA/////////+AAAAAH/////////4AAAAAf////////wAAAAAD/////////gAAAAAP////////+AAAAAA/////////8AAAAAD/////////gAAAAAP////////+AAAAAA///////gBgAAAAAD//////4AAAAAAAAP/////+AAAAAAAAA//////gAAAAAAAAB/////4AAAAAAAAAH////8AAAAAAAAAAH////AAAAAAAAAAAH///4AAAAAAAAAAAD//+AAAAAAAAAAAB///AAAAAAAAAAAA///gAAAAAAAAAAAf//4AAAAAAAAAAAH/f8AAAAAAAAAAAB/B/AAAAAAAAAAAAPw//4AAAAAAAAAAB8P//gAAAAAAAAAAHj+BsAAAAAAAAAAAffwAgAAAAAAAAAADj8AAAAAAAAAAAAAMHgAAAAAAAAAAAAB4/gAAAAAAAAAAAAAH4AAAAAAAAAAAAAAcAAAAAAAAAAAAAAB4AAAAAAAAAA=","h":61,"w":93},"melospiza-lincolnii":{"bits":"AAAAAAAAAAAAP4AAAAAAAAAAAAAP/wAAAAAAAAAAAAH//gAAAAAAAAAAAD//+ABAAAAAAAAAA///4AfwAAAAAAAAP///wf/wAAAAAAAD////n//gAAAAAAA////////AAAAAAD/////7//+AAAAAH/////8f//8AAAAH/////8A///8AAAH//////gA///4AAP//////4AA///wA////////AAB///4f///////4AAB///////////+AAAB///////////wAAAD//////////+AAAAH//////////wAAAAf/////////+AAAAB//////////wAAAAH/////////8AAAAAf/////////gAAAAB/////////8AAAAAH/////////gAAAAB/////////4AAAAAP/////////AAAAAAf////////wAAAAAH////////8AAAAAD/////////gAAAAA/////////4AAAAAH////////+AAAAAAAD///////gAAAAAAAH//////4AAAAAAAAf/////+AAAAAAAAB//////AAAAAAAAAH/////wAAAAAAAAAP////wAAAAAAAAAAf///4AAAAAAAAAAHH//8AAAAAAAAAAA////4AAAAAAAAAAD8///AAAAAAAAAAAD4/j4AAAAAAAAAAAH2AfgAAAAAAAAAAAPgB8AAAAAAAAAAAA+AHgAAAAAAAAAAAB/88AAAAAAAAAAAAP/vAAAAAAAAAAAA//8AAAAAAAAAAAAH4/4AAAAAAAAAAABoD3gAAAAAAAAAAAMAHEAAAAAAAAAAAAAA4gAAAAAAAAAAAAADAAAAAAAAAAAAAAAwAAAAAA==","h":55,"w":93},"melospiza-melodia":{"bits":"AAD8AAAAAAAAAAAAAH/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAD///8AAAAAAAAAAB////wAAAAAAAAAA/////AAAAAAAAAAP////8AAAAAAAAAH/////wAAAAAAAAA//////AAAAAAAAAA/////8AAAAAAAAAA/////gAAAAAAAAAD////+AAAAAAAAAA/////+AAAAAAAAAH/////8AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAAf//////AAAAAAAAD//////+AAAAAAAAf//////4AAAAAAAD///////gAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////gAAAAAAf///////+AAAAAAD////////4AAAAAAP////////gAAAAAB////////+AAAAAAP////////4AAAAAB/////////gAAAAAP////////+AAAAAA/////////wAAAAAH/////////AAAAAAf////////8AAAAAD/////////gAAAAAP////////+AAAAAB/////////wAAAAAH/////////AAAAAAf////////4AAAAAD/////////AAAAAAP////////8AAAAAA/////////gAAAAAD////////+AAAAAAP////////wAAAAAA/////////AAAAAAD////////4AAAAAAP////////AAAAAAAf///////8AAAAAAB////////gAAAAAAD///////+AAAAAAAH///////wAAAAAAAP///////AAAAAAAAP///8P/8AAAAAAAAP//8Af/wAAAAAAAD//+AB//AAAAAAAA8APwAH/8AAAAAAAfAD8AA//wAAAAAAPgA+AAD//AAAAAAD4gPAAAP/8AAAAAA//DwAAA//wAAAAAf/88AAAD//AAAAAf4APAAAAP/8AAAAP+ADwAAAA//wAAAD/wA+/AAAD//AAAAR8AP/8AAAP/8AAACfAD/4AAAB//gAAAH4D/gAAAAH/+AAAB3A/gAAAAAf/4AAAOwP8AAAAAB//gAADGDfAAAAAAH/+AAAYwXwAAAAAAf/wAADCB+AAAAAAB//AAAIAfgAAAAAAH/4AAAAPYAAAAAAAOeAAAAD3AAAAAAAAAAAAAA54AAAAAAAAAAAAAGMAAAAAAAAAAAAAAhgAAAAAAAAAAAAAAMAAAAAAAAAA=","h":83,"w":93},"melozone-aberti":{"bits":"AAAAAAAAAAAAP8AAAAAAAAAAAAAH/4AAAAAAAAAAAAD//wAAAAAAAAAAAA///AAAAAAAAAAAAf//+AAAAAAAAAAAH///4AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAD////4AAAAAAAAAA////4AAAAAAAAAAP///8AAAAAAAAAAD////gAAAAAAAAAB////4AAAAAAAAAA/////AAAAAAAAAAf////wAAAAAAAAAH////+AAAAAAAAAB/////wAAAAAAAAAf////+AAAAAAAAAH/////wAAAAAAAAB/////+AAAAAAAAAf/////wAAAAAAAAH/////+AAAAAAAAB//////wAAAAAAAAf/////+AAAAAAAAH//////wAAAAAAAB//////+AAAAAAAAf//////gAAAAAAAH//////8AAAAAAAB///////gAAAAAAAf//////4AAAAAAAD///////AAAAAAAA///////wAAAAAAAP//////+AAAAAAAB///////gAAAAAAAf//////4AAAAAAAD//////+AAAAAAAA///////gAAAAAAAH//////4AAAAAAAB///////AAAAAAAAP//////wAAAAAAAD//////8AAAAAAAAf/////+AAAAAAAAH//////gAAAAAAAB//////4AAAAAAAAf/////8AAAAAAAAD//////AAAAAAAAA//////gAAAAAAAAD/////4AAAAAAAAA/////+AAAAAAAAAP////98AAAAAAAAB//gH4D4AAAAAAAAf/wA/AP/wAAAAAAH/4AA8///AAAAAAB/8AAD///+AAAAAAf+AAAPsH/4AAAAAH/AAAA+AftgAAAAB/wAAAB4AeAAAAAAP+AAAAHgAQAAAAAD/gAAA///gAAAAAA/4AAAP//+AAAAAAP+AAAB8H/8AAAAAD/wAAAIAf/wAAAAA/8AAAAAA+AAAAAAH/AAAAAAB4AAAAAB/wAAAAAABAAAAAAf+AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAH/wAAAAAAAAAAAAA/8AAAAAAAAAAAAAP/AAAAAAAAAAAAAD/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAH/wAAAAAAAAAAAAB/8AAAAAAAAAAAAAf/AAAAAAAAAAAAAD/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAf/AAAAAAAAAAAAAD/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAH/gAAAAAAAAAAAAADwAAAAAAAAAAAAAAYAAAAAAAAAAAAAAA","h":90,"w":93},"melozone-crissalis":{"bits":"AAAAAAAAAAAAfgAAAAAAAAAAAAA//gAAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAD///wAAAAAAAAAAA////wAAAAAAAAAAP////gAAAAAAAAAD/////AAAAAAAAAA/////4AAAAAAAAAP////8AAAAAAAAAB////8AAAAAAAAAAf////AAAAAAAAAAH////wAAAAAAAAAH////+AAAAAAAAAH/////wAAAAAAAAD/////8AAAAAAAAA//////gAAAAAAAAf/////8AAAAAAAAH//////AAAAAAAAD//////4AAAAAAAA//////+AAAAAAAAP//////wAAAAAAAH//////+AAAAAAAB///////wAAAAAAAf//////+AAAAAAAH///////gAAAAAAB///////8AAAAAAA////////gAAAAAAP///////8AAAAAAD////////AAAAAAA////////4AAAAAAP////////AAAAAAB////////wAAAAAAf///////+AAAAAAH////////gAAAAAB////////4AAAAAAP///////+AAAAAAD////////wAAAAAAf///////8AAAAAAH////////AAAAAAA////////wAAAAAAH///////8AAAAAAB////////AAAAAAAf///////gAAAAAAH///////4AAAAAAB///////+AAAAAAAf///////gAAAAAAH///////wAAAAAAA///////4AAAAAAAOf/////8AAAAAAADn//////AAAAAAAAA//////+AAAAAAAAP//Af//4AAAAAAAB//wD///AAAAAAAAf/4Af//4AAAAAAAH/8AAB//AAAAAAAB/+AAAfP+AAAAAAAf+AAADz/wAAAAAAH/gAAAY/eAAAAAAA/4AAABfn4AAAAAAP/AAAAD1/AAAAAAD/wAAAA/vwAAAAAA/8AAAAGH8AAAAAAP/AAAAAYfgAAAAAB/4AAAABAcAAAAAAf+AAAAAAfAAAAAAH/gAAAAADgAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAD/wAAAAAAAAAAAAA/8AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAf+AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf8AAAAAAAAAAAAAH/AAAAAAAAAAAAAA/wAAAAAAAAAAAAAAcAAAAAAAAAAAAAAA","h":82,"w":93},"melozone-fusca":{"bits":"AA/AAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAP//8AAAAAAAAAAAD///wAAAAAAAAAAAf///AAAAAAAAAAAD///+AAAAAAAAAAA////4AAAAAAAAAAP////4AAAAAAAAAD/////4AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAAH//////AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////wAAAAAAA////////AAAAAAAH///////+AAAAAAA////////4AAAAAAH////////wAAAAAA/////////AAAAAAH////////8AAAAAA/////////wAAAAAD/////////AAAAAAf////////8AAAAAB/////////wAAAAAP/////////AAAAAA/////////8AAAAAH/////////wAAAAAf////////+AAAAAB/////////4AAAAAH/////////gAAAAAf/////////AAAAAD/////////8AAAAAH/////////wAAAAAf///////8+AAAAAB////////wAAAAAAH///////+AAAAAAAP///////4AAAAAAAf///////AAAAAAAA///////8AAAAAAAD////P//gAAAAAAAD///gf/+AAAAAAAAP//wA//4AAAAAAAH//wAA//gAAAAAAA/+AAAB/+AAAAAAAP/4AAAD/wAAAAAAB4HgAAAD/gAAAAAAfAeAAAAP8AAAAAADwAwAAAA/4AAAAAAeAGAAAAD/AAAAAADwAgAAAAP+AAAAAAPQAAAAAA/wAAAAAB+AAAAAAD/gAAAAAfoAAAAAAP8AAAAABvAAAAAAA/wAAAAAMAAAAAAAD/AAAAAAwAAAAAAAP8AAAAAHAAAAAAAA/wAAAAAAAAAAAAAD/AAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/wAAAAAAAAAAAAAD/AAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/wAAAAAAAAAAAAAD/AAAAAAAAAAAAAAP4AAAAAAAAAAAAAA/gAAAAAAAAAAAAAD+AAAAAAAAAAAAAAP4AAAAAAAAAAAAAAfAAAAAAAAAAAAAABgA=","h":77,"w":93},"mergus-merganser":{"bits":"AAAAAAf8AAAAAAAAf/wAAAAAAAf//AAAAAAAP//4AAAAAAH///AAAAAAH///4AAAAAf////AAAAH/////wAAAH/////+AAAB//////wAAAQAD///8AAAAAAH///gAAAAAAH//4AAAAAAAf/+AAAAAAAD//gAAAAAAA//4AAAAAAAP/+AAAAAAAD//gAAAAAAB//gAAAAAAA//wAAAAAAAP/8AAAAAAAH//AAAAAAAB//4AAAAAAA///AAAAAAAP//wAAAAAAD//+AAAAAAA///wAAAAAAf//8AAAAAAP///gAAAAAH///8AAAAAH////AAAAAH////4AAAAD////+AAAAD/////gAAAB/////8AAAA//////AAAA//////wAAAf/////8AAAP//////AAAD//////wAAB//////8AAA///////AAAf//////gAAH//////4AAD//////+AAA///////AAAf//////wAAH//////4AAD//////+AAA///////AAAf//////gAAH//////4AAB//////8AAA///////AAAP//////gAAH//////4AAB//////8AAA///////AAAP//////gAAD//////wAAA//////4AAAP/////8AAAP//////AAAH//////AAAD//////gAAB//////4AAA//////+AAAP//////AAAGf/////wAAAP/////4AAAH/////8AAAD/////fAAAD/////DgAAD////+A4AAA////8AOAAAf//A4ADgAAP//gOAA8AAD/+ADgA/AAAAAAA4AP8AAAAAAPAD/4AAAAADwAf/wAAAAA8AP//gAAAAPwD//4AAAAD/g//+AAAAA//n/4AAAAAP///8AAAAAD//wHAAAAAA//gAwAAAAAP/wAAAAAAAB/8AAAAAAAAfzgAAAAAAADgAAAAAAAAAQAAAAAA==","h":93,"w":62},"mergus-serrator":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAAf/4AAAAAAAAAAAAP//gAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAAH///wAAAAAAAAAAD////gAAAAAAAAAA/////8AAAAAAAAAD//////gAAAAAAAA//////8AAAAAAAAH////8AgAAAAAAAB///4AAAAAAAAAAAX//8AAAAAAAAAAAA//+AAAAAAAAAAAAEf/4AAAAAAAAAAAAB//AAAAAAAAAAAAAP/8AAAAAAAAAAAAB//wAAAAAAAAAB/////gAAAAAAAAD/////8AAAAAAAAD//////wAAAAAAAB///////AAAAAAAA///////4AAAAAAA////////AAAAAAAf///////8AAAAAAf////////gAAAAAH////////8AAAAAD/////////gAAAAA/////////8AAAAA//////////gAAAAf/////////4AAAAP//////////AAAAH//////////4AAAB//////////+AAAAP//////////wAAAD//////////+AAAAz//////////gAAAD//////////4AAAB//////////+AAAA///////////gAAAP//////////wAAAB//////////4AAAAH/wf//////8AAAAAPgAP/////8AAAAAAAAAf/////AAAAAAAAAAD////8AAAAAAAAAAA//n/wAAAAAAAAAAH8B/+AAAAAAAAAAAfgP/4AAAAAAAAAAD8D//AAAAAAAAAAAfgT8QAAAAAAAAAAD8AHAAAAAAAAAAAA/gAYAAAAAAAAAAAHYACAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":59,"w":93},"mimus-polyglottos":{"bits":"AAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAP///4AAAAAAAAAAD////AAAAAAAAAAA////AAAAAAAAAAAf///AAAAAAAAAAAH///wAAAAAAAAAAH///+AAAAAAAAAAB////wAAAAAAAAAA////+AAAAAAAAAAf////wAAAAAAAAAP////8AAAAAAAAAD/////gAAAAAAAAA/////8AAAAAAAAAP/////gAAAAAAAAD/////8AAAAAAAAA//////gAAAAAAAAP/////8AAAAAAAAD//////AAAAAAAAA//////4AAAAAAAAP/////+AAAAAAAAD//////wAAAAAAAA//////+AAAAAAAAP//////gAAAAAAAH//////8AAAAAAAB///////gAAAAAAAf//////4AAAAAAAP///////AAAAAAAH///////wAAAAAAD///////+AAAAAAD////////gAAAAAB////////4AAAAAB////////+AAAAAA/////////gAAAAA///+P////4AAAAAf/+OB////+AAAAAP/+AgP////gAAAAP//AAB////4AAAAH//gAAP///8AAAAD//gAAA////AAAAB//wAAAP///AAAAAf/wAAAB/8H8AAAAP/4AAAAf+AfwAAAD/wAAAAD/gD/gAAA/4AAAAA/wAP+AAAB8AAAAAH4AB/wAAAIAAAAAB+AAH/AAAAAAAAAAPAAA/8AAAAAAAAABgAAH/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAH5wAAAAAAAAAAAAB/OAAAAAAAAAAAAAP9gAAAAAAAAAAAADtkAAAAAAAAAAAAAZugAAAAAAAAAAAABs8AAAAAAAAAAAAAFjgAAAAAAAAAAAAA4eAAAAAAAAAAAAAAAwAAAA=","h":61,"w":93},"mniotilta-varia":{"bits":"AAD+AAAAAAAAAAAAAD/+AAAAAAAAAAAAB//8AAAAAAAAAAAAf//wAAAAAAAAAAAH///gAAAAAAAA+AP///+AAAAAAAA/gf////4AAAAAAA/7H/////gAAAAAA//+f/////8AAAAA///4H/////8AAAAf//+Af/////4AAAP///gB//////8AAP///gAP//////+Af///gAA///////+////gAAH///////////gAAAf//////////gAAAD//////////gAAAAP/////////gAAAAB/////////wAAAAAP////////8AAAAAB/////////AAAAAAP////////8AAAAAA/////////4AAAAAH/////////wAAAAAf///////7+AAAAAD////////wAAAAAAP////////gAAAAAB/////////AAAAAAH////////8AAAAAA/////////4AAAAAD/////////AAAAAAP//////AAAAAAAAA//////wAAAAAAAAD/////+AAAAAAAAAP/////AAAAAAAAAAf////wAAAAAAAAAA////4AAAAAAAAAAA///8AAAAAAAAAAAB///gAAAAAAAAAAAf/n4AAAAAAAAAAAD4/+AAAAAAAAAAAAcD+AAAAAAAAAAAADA/AAAAAAAAAAAAAY/wAAAAAAAAAAAADfkAAAAAAAAAAAAAf+AAAAAAAAAAAAAD//AAAAAAAAAAAAA/B4AAAAAAAAAAAAHwHAAAAAAAAAAAAA8AYAAAAAAAAAAAAHgHAAAAAAAAAAAAA8AgAAAAAAAAAAAAHAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAwAAAAAAAAAAA==","h":55,"w":93},"molothrus-aeneus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAH/+AAAAAAAAAAAAD//8AAAAAAAAAAAB///wAAAAAAAAAAA////AAAAAAAAAAAP///8AAAAAAAAAAH////wAAAAAAAAAB/////AAAAAAAAAAP////8AAAAAAAAAAB////4AAAAAAAAAAD////8AAAAAAAAAAP////8AAAAAAAAAA/////4AAAAAAAAAH/////wAAAAAAAAAf/////gAAAAAAAAD//////AAAAAAAAAf/////8AAAAAAAAB//////4AAAAAAAAP//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////wAAAAAAAP///////gAAAAAAB////////AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////gAAAAAAf///////8AAAAAAD////////wAAAAAAP////////gAAAAAB////////+AAAAAAH////////4AAAAAAf////////gAAAAAB////////+AAAAAAP////////wAAAAAA////////+AAAAAAD////////wAAAAAAP///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAH////////AAAAAAAP///////8AAAAAAA////////wAAAAAAB////////gAAAAAAD///////8AAAAAAAH/////+fwAAAAAAAP/////4eAAAAAAAA//+///AAAAAAAAB/9/x//8AAAAAAAP//H+H//gAAAAAAH/w//wf/8AAAAAAA////8B//wAAAAAAPgf8AAD/+AAAAAAB8H/gAAP/4AAAAAAP9+eAAA//gAAAAAA/vh4AAB/8AAAAAAD5+zAAAH/wAAAAAAOn+wAAA//AAAAAAA8PwAAAD/8AAAAAAAA/AAAAP/wAAAAAAAB4AAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAAf/gAAAAAAAAAAAAD/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//AAAAAAAAAAAAAH/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAAPgAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":80,"w":93},"molothrus-ater":{"bits":"AAD8AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//4AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAD///8AAAAAAAAAAB////wAAAAAAAAAAf////AAAAAAAAAAP////8AAAAAAAAAD/////gAAAAAAAAA/////+AAAAAAAAAH/////wAAAAAAAAAD/////AAAAAAAAAAH////4AAAAAAAAAAf////gAAAAAAAAAD////+AAAAAAAAAAP////8AAAAAAAAAA/////4AAAAAAAAAH/////wAAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAB///////AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////gAAAAAAB///////8AAAAAAAP///////wAAAAAAB////////AAAAAAAP///////8AAAAAAA////////wAAAAAAH////////gAAAAAA////////+AAAAAAH////////4AAAAAAf////////gAAAAAD////////+AAAAAAf////////4AAAAAB/////////gAAAAAP////////+AAAAAA/////////wAAAAAH/////////AAAAAAf////////8AAAAAB/////////gAAAAAP////////+AAAAAA/////////4AAAAAD/////////AAAAAAP////////8AAAAAA/////////gAAAAAD////////8AAAAAAP////////wAAAAAA////////+AAAAAAB////////4AAAAAAH////////gAAAAAAf///////+AAAAAAA////////4AAAAAAD////////AAAAAAAH///////8AAAAAAAP///////wAAAAAAAf///////AAAAAAAA//////94AAAAAAAP//////zAAAAAA8/9/////+AAAAAAP////gP//4AAAAAB////8Af//AAAAAB//gc/AB//8AAAAAf/4AHwAD//wAAAAGb4AD4AAP//AAAAAg+AA+AAAf/8AAAAAGAAfAAAA//gAAAAAgAHwAAAD/+AAAAAAAD4AAAAf/4AAAAAAB+AAAAB//gAAAAD///8AAAH/+AAAAA////wAAA//4AAAAH/9PyAAAD//AAAAH//AAAAAAP/8AAAB//gAAAAAA//wAAANnwAAAAAAH//AAADB4AAAAAAAf/4AAAAIAAAAAAAB//gAAABAAAAAAAAH/+AAAAAAAAAAAAA//wAAAAAAAAAAAAD//AAAAAAAAAAAAAP/4AAAAAAAAAAAAB//AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf4AAAAAAAAAAAAAA8A","h":89,"w":93},"molothrus-bonariensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAH//AAAAAAAAAAAAB//8AAAAAAAAAAAB///4AAAAAAAAAAA////gAAAAAAAAAAf///8AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAB////8AAAAAAAAAAA////gAAAAAAAAAAD///8AAAAAAAAAAAP///wAAAAAAAAAAB///+AAAAAAAAAAAH///8AAAAAAAAAAA////4AAAAAAAAAAH////wAAAAAAAAAAf////gAAAAAAAAAH/////AAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH//////AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////gAAAAAAA///////+AAAAAAAH///////8AAAAAAAf///////wAAAAAAD////////AAAAAAAf///////4AAAAAAB////////wAAAAAAP////////AAAAAAA////////8AAAAAAH////////gAAAAAAf///////+AAAAAAB////////4AAAAAAH////////AAAAAAAf///////4AAAAAAB////////wAAAAAAH////////AAAAAAAf///////8AAAAAAB////////wAAAAAAH////////gAAAAAAP///////8AAAAAAAf///////wAAAAAAA///////8AAAAAAAB///////wAAAAAAAB///////AAAAAAAAB//4H//8AAAAAAAAP/4AH//4AAAAAAAD8fAAH//gAAAAAAB8D4AAH/+AAAAAAAeAeAAAD/4AAAAAAPgHgAAAH/wAAAAAHwB4AAAAf/AAAAAD/+eAAAAB/8AAAB///7gAAAAD/4AAAP/944AAAAAP/gAAH/4AOAAAAAA/8AAB+8AHwAAAAAD/gAAIPD///AAAAAH8AABBA///sAAAAAPAAAAAH/w8AAAAAAAAAAAH/8AAAAAAAAAAAAB+fAAAAAAAAAAAAAIHgAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"myadestes-townsendi":{"bits":"AAfAAAAAAAAAAAAAAf/AAAAAAAAAAAAAP/+AAAAAAAAAAAAH//4AAAAAAAAAAAP///gAAAAAAAAAAD///+AAAAAAAAAAA////4AAAAAAAAAAAf///gAAAAAAAAAAA///8AAAAAAAAAAAD///wAAAAAAAAAAAP///AAAAAAAAAAAB////AAAAAAAAAAAH///+AAAAAAAAAAA////8AAAAAAAAAAH////4AAAAAAAAAA/////wAAAAAAAAAH/////AAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA///////AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAf//////+AAAAAAAB///////8AAAAAAAH///////4AAAAAAAf///////gAAAAAAB////////AAAAAAAH///////8AAAAAAAP///////4AAAAAAAf///////AAAAAAAA///////YAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAH///////AAAAAAAA/w//B//+AAAAAAAH/B/gB//4AAAAAAA/5/4AB//wAAAAAAD//AAAA//AAAAAAAP/gAAAD/8AAAAAAAP8AAAAP/4AAAAAADzoAAAAf/gAAAAAAP/AAAAB/+AAAAAAA/wAAAAH/8AAAAAAD8AAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAH/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//gAAAAAAAAAAAAD//AAAAAAAAAAAAAP/8AAAAAAAAAAAAA//wAAAAAAAAAAAAB//AAAAAAAAAAAAAH/4AAAAAAAAAAAAAEcA==","h":62,"w":93},"mycteria-americana":{"bits":"AAAAAAAAAAAAAAAAAAAAAAH4AAAAAAA/wAAAAAAH/gAAAAAAf+AAAAAAB/8AAAAAAH/4AAAAAAf/wAAAAAB//gAAAAAH/+AAAAAAP/8AAAAAA//4AAAAAB//wAAAAAD//AAAAAAH++AAAAAAf98AAAAAA/zwAAAAAD/ngAAAAP/+PAAAAD//4cAAAA///xwAAAH///DAAAA///8EAAAH///wAAAA////AAAAH///4AAAA////gAAAH///+AAAA////4AAAH////AAAA////8AAAH////wAAA////+AAAH////4AAA/////gAAD////+AAAf////QAAD////gAAAP///+AAAA////wAAAH////AAAAf///4AAAB////gAAAH///8AAAA////gAAAD///+AAAAf///wAAAB///+AAAAP///wAAAA///+AAAAH///4AAAAf///AAAAB///8AAAAH///wAAAAf///AAAAD//78AAAAP//NwAAAA//w2AAAAD//DYAAAAf/4NgAAAA//A+AAAAB/8H4AAAAD/gfgAAAAP+B2AAAAA/wHYAAAAAeANgAAAABAA2AAAAAAADYAAAAAAANgAAAAAAA3AAAAAAADcAAAAAAAMwAAAAAAAzAAAAAAADMAAAAAAAMwAAAAAAAzAAAAAAADMAAAAAAAMwAAAAAAAzAAAAAAADMAAAAAAAM4AAAAAAAznAAAAAADf/gAAAAAP/+AAAAAB4/gAAAAAP/fAAAAAB/+AAAAAAA/gAAAAAADnwAAAAAAHHAAAAAAAMAAAAAAAAAAAAAA=","h":93,"w":52},"myiarchus-cinerascens":{"bits":"AAAAAAAAAAD+AAAAAAAAAAAAA//gAAAAAAAAAAAP//wAAAAAAAAAAA///wAAAAAAAAAAD///wAAAAAAAAAAf///wAAAAAAAAAB////4AAAAAAAAAD////+AAAAAAAAAP/////gAAAAAAAA//////gAAAAAAAB//////gAAAAAAAH/////4AAAAAAAAP////4AAAAAAAAA/////wAAAAAAAAD/////AAAAAAAAAP////4AAAAAAAAA/////gAAAAAAAAH////+AAAAAAAAAf////8AAAAAAAAB/////wAAAAAAAAP/////AAAAAAAAA/////+AAAAAAAAD/////8AAAAAAAAP/////wAAAAAAAA//////gAAAAAAAB//////AAAAAAAAH//////AAAAAAAAf/////+AAAAAAAB//////8AAAAAAAD//////wAAAAAAAP//////gAAAAAAA///////AAAAAAAD//////+AAAAAAAP//////8AAAAAAAf//////4AAAAAAB///////gAAAAAAH///////AAAAAAAf//////8AAAAAAA///////4AAAAAAD///////gAAAAAAH///////AAAAAAAf//////8AAAAAAA///////4AAAAAAD///////gAAAAAAH///////AAAAAAAf//////8AAAAAAA///////wAAAAAAD///////gAAAAAAH//////+AAAAAAAP//////4AAAAAAAf//////gAAAAAAA//////+AAAAAAAD//////4AAAAAAAH//////gAAAAAAAf//////4AAAAAAA///////wAAAAAAD///////wAAAAAAP//////vgAAAAAA//////9fAAAAAAB/////4/+AAAAAAH/////hv4AAAAAAP//3+fB/gAAAAAA//+B/+BOAAAAAAB//4Df4AAAAAAAAH//AG/gAAAAAAAAH/8AH+AAAAAAAAAH/wAGwAAAAAAAAAf/gAAAAAAAAAAAB//AAAAAAAAAAAAH/8AAAAAAAAAAAAP/wAAAAAAAAAAAA//gAAAAAAAAAAAD/+AAAAAAAAAAAAH/8AAAAAAAAAAAAf/wAAAAAAAAAAAB//AAAAAAAAAAAAD/+AAAAAAAAAAAAP/4AAAAAAAAAAAA//wAAAAAAAAAAAB//AAAAAAAAAAAAH/8AAAAAAAAAAAAf/4AAAAAAAAAAAA//gAAAAAAAAAAAD//AAAAAAAAAAAAH/8AAAAAAAAAAAAf/4AAAAAAAAAAAB//gAAAAAAAAAAAD/+AAAAAAAAAAAAH/8AAAAAAAAAAAAf/wAAAAAAAAAAAA//AAAAAAAAAAAAB/8AAAAAAAAAAAAAxAAAAAAAAAAAAAA","h":93,"w":89},"myiarchus-crinitus":{"bits":"AAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAD/8AAAAAAAAAAAAB//4AAAAAAAAAAAA///gAAAAAAAAAAH///+AAAAAAAAAAH////4AAAAAAAAAB/////gAAAAAAAAAB////+AAAAAAAAAAB////wAAAAAAAAAAD////AAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAP///+AAAAAAAAAAB////4AAAAAAAAAAH////AAAAAAAAAAAf///+AAAAAAAAAAD////8AAAAAAAAAAf////4AAAAAAAAAB/////wAAAAAAAAAP/////gAAAAAAAAB/////+AAAAAAAAAP/////8AAAAAAAAB//////wAAAAAAAAP//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAP///////AAAAAAAB///////8AAAAAAAH///////wAAAAAAA////////gAAAAAAH///////+AAAAAAA////////4AAAAAAD////////AAAAAAAf///////8AAAAAAB////////wAAAAAAP////////AAAAAAA////////8AAAAAAH////////gAAAAAAf///////+AAAAAAB////////wAAAAAAH///////+AAAAAAAf///////8AAAAAAB////////gAAAAAAP////////AAAAAAAf///////8AAAAAAB////////wAAAAAAH////////AAAAAAAP///////8AAAAAAA////////gAAAAAAB///////4AAAAAAAB///////AAAAAAAAD//////4AAAAAAAB///9//+AAAAAAAB+AY4D//4AAAAAAA/ABmAD//gAAAAAA//8fgAB/+AAAAAAP//nwAAB/4AAAAAD+AD4AAAD/gAAAAAfgA8AAAAP+AAAAAD4AfAAAAA/4AAAAA+AHgAAAAD/gAAAAGQD+4AAAAP+AAAAAzH//wAAAA/4AAAAGB/gbAAAAD/gAAAAAP4AAAAAAP+AAAAAB+AAAAAAB/4AAAAAdgAAAAAAH/AAAAADIAAAAAAAf8AAAAARgAAAAAAA/gAAAACEAAAAAAAD8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"myiarchus-tuberculifer":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAA//wAAAAAAAAAAAAf//gAAAAAAAAAAAH//+AAAAAAAAAAAB///4AAAAAAAAAAAf///gAAAAAAAAAAD///+AAAAAAAAAAA////4AAAAAAAAAAH////gAAAAAAAAAB////8AAAAAAAAAB/////wAAAAAAAAA//////AAAAAAAAAP/////+AAAAAAAAAf/////8AAAAAAAAAf/////8AAAAAAAAD//////wAAAAAAAAP//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAH//////+AAAAAAAA///////8AAAAAAAH///////wAAAAAAB////////AAAAAAAP///////8AAAAAAB////////wAAAAAAP////////AAAAAAB////////4AAAAAAP////////gAAAAAB////////+AAAAAAH////////4AAAAAA/////////AAAAAAH////////8AAAAAAf////////gAAAAAD////////+AAAAAAf////////8AAAAAB/////////wAAAAAP/////////AAAAAA/////////8AAAAAD/////////4AAAAAH/////////wAAAAAf/////////gAAAAD//////////AAAAAH/////////+AAAAAf/////gP//8AAAAB/////wAHv/wAAAAD////8AAA//gAAAAH///+AAAB/+AAAAA////AAAAD/8AAAAPH//AAAAAH/wAAAB4AeAAAAAAP/AAAAPAfwAAAAAA/8AAAA+D/gAAAAAB/gAAAHx+MAAAAAAA4AAAAcPgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPoAAAAAAAAAAAAAAfAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":64,"w":93},"myiopsitta-monachus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAH/wAAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAA///4AAAAAAAAAAAP///AAAAAAAAAAAD///8AAAAAAAAAAA////gAAAAAAAAAAH///8AAAAAAAAAAB////gAAAAAAAAAAP///8AAAAAAAAAAD////wAAAAAAAAAAf///8AAAAAAAAAAH////gAAAAAAAAAA////8AAAAAAAAAAP////AAAAAAAAAAD////4AAAAAAAAAB////4AAAAAAAAAAf////AAAAAAAAAAH////wAAAAAAAAAB/////AAAAAAAAAAf////4AAAAAAAAAH/////AAAAAAAAAB/////4AAAAAAAAAf/////AAAAAAAAAH/////4AAAAAAAAB//////AAAAAAAAAP/////4AAAAAAAAD/////+AAAAAAAAA//////gAAAAAAAAH/////8AAAAAAAAB//////AAAAAAAAAf/////4AAAAAAAAH//////AAAAAAAAB//////4AAAAAAAAf//////AAAAAAAAH//////wAAAAAAAB//////+AAAAAAAAP//////wAAAAAAAD//////8AAAAAAAA///////gAAAAAAAP//////4AAAAAAAB//////+AAAAAAAAf//////gAAAAAAAD//////4AAAAAAAA///////AAAAAAAAH//////wAAAAAAAAf/////8AAAAAAAAP//////AAAAAAAAD//////wAAAAAAAB//////4AAAAAAAAf//////AAAAAAAAH//////8AAAAAAAD///////gAAAAAAA///////+AAAAAAAH////+/7wAAAAAAB/////DfeAAAAAAAP//+AAD/wAAAAAAB9//gAAf8AAAAAAAOf/4AAB/gAAAAAAAH/4AAAA4AAAAAAAB/+AAAA+AAAAAAAA//gAAABAAAAAAAAP/wAAAAAAAAAAAAD/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAP/gAAAAAAAAAAAAD/4AAAAAAAAAAAAA/8AAAAAAAAAAAAAP+AAAAAAAAAAAAAD/gAAAAAAAAAAAAA/4AAAAAAAAAAAAAP+AAAAAAAAAAAAAD+AAAAAAAAAAAAAA/gAAAAAAAAAAAAAP4AAAAAAAAAAAAAD+AAAAAAAAAAAAAA/gAAAAAAAAAAAAAP4AAAAAAAAAAAAAD+AAAAAAAAAAAAAA/AAAAAAAAAAAAAAPwAAAAAAAAAAAAAH8AAAAAAAAAAAAAB+AAAAAAAAAAAAAAeAAAAAAAAAAAAAAHgAAAAAAAAAAAAABwAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":91,"w":93},"nannopterum-auritum":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAED4AAAAAAAAH//AAAAAAAAD//8DgAAAAAB////8AAAAAAP////AAAAAAD////wAAAAAAf//4AAAAAAAD//wAAAAAAAB//4AAAAAAAAf/4AAAAAAAAP/8AAAAAAAAD/8AAAAAAAAA/+AAAAAAAAAP/AAAAAAAAAD/wAAAAAAAAA/8AAAAAAAAAP/AAAAAAAAAD/wAAAAAAAAA/8AAAAAAAAAP/gAAAAAAAAB/8AAAAAAAAAf/gAAAAAAAAD/8AAAAAAAAA//AAAAAAAAAH/4AAAAAAAAB/+AAAAAAAAAf/wAAAAAAAAP/8AAAAAAAAP//AAAAAAAAH//wAAAAAAAH//8AAAAAAAD///AAAAAAAB///wAAAAAAA///8AAAAAAA////AAAAAAAf///gAAAAAAP///4AAAAAAH///+AAAAAAD////AAAAAAB////wAAAAAA////8AAAAAAf////AAAAAAP////wAAAAAH////8AAAAAB/////AAAAAA/////gAAAAAP////4AAAAAH////+AAAAAB/////AAAAAA/////gAAAAAP////wAAAAAH////8AAAAAB////+AAAAAA/////gAAAAAP////wAAAAAD////8AAAAAB////+AAAAAAf////gAAAAAP////wAAAAAD////4AAAAAA////8AAAAAAf////AAAAAAH////gAAAAAB////wAAAAAAf///wAAAAAAH///4AAAAAAB///+AAAAAAAf///AAAAAAAH///wAAAAAAB///4AAAAAAA///+AAAAAAAP///gAAAAAAH//P8AAAAAAD/4H/wAAAAAB/wB//AAAAAAf8Ab/8AAAAAP/AG//wAAAAH/wAP/4AAAAD/4ACD/AAAAA/+AAAD4AAAAf/gAAAGAAAAP/wAAAAAAAAD/8AAAAAAAAB/+AAAAAAAAAf/gAAAAAAAAP/wAAAAAAAAD/wAAAAAAAAA/4AAAAAAAAAP4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":68},"nannopterum-brasilianum":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8D8AAAAAAA////AAAAAAAf///wAAAAAAP//+AAAAAAAH//4AAAAAAAB//4AAAAAAAA//8AAAAAAAAP/8AAAAAAAAH/8AAAAAAAAB/+AAAAAAAAAf/AAAAAAAAAH/gAAAAAAAAD/wAAAAAAAAA/8AAAAAAAAAP/AAAAAAAAAB/wAAAAAAAAAf8AAAAAAAAAH/gAAAAAAAAB/8AAAAAAAAAf/wAAAAAAAAD/8AAAAAAAAA//gAAAAAAAAH/8AAAAAAAAA//AAAAAAAAAP/wAAAAAAAAH/8AAAAAAAAH//AAAAAAAAD//wAAAAAAAB//8AAAAAAAB///AAAAAAAA///wAAAAAAAf//4AAAAAAAP//+AAAAAAAP///AAAAAAAH///wAAAAAAD///4AAAAAAB///+AAAAAAA////AAAAAAAf///wAAAAAAP///8AAAAAAH///+AAAAAAD////gAAAAAA////4AAAAAAf///8AAAAAAP////AAAAAAD////gAAAAAB////wAAAAAAf///4AAAAAAP///8AAAAAAD////AAAAAAA////gAAAAAAf///wAAAAAAH///8AAAAAAD///+AAAAAAA////AAAAAAAf///gAAAAAAH///wAAAAAAD///4AAAAAAA///4AAAAAAAP//8AAAAAAAD//+AAAAAAAB///gAAAAAAAf///AAAAAAAP///4AAAAAAH//9/AAAAAAB//s/8AAAAAAf/Af/AAAAAAH/gGDwAAAAAB/wAwcAAAAAAX4AAGAAAAAAD+AABwAAAAAB/AAAcAAAAAAfwAAGAAAAAAP8AABgAAAAAD+AAAAAAAAAB/gAAAAAAAAAf4AAAAAAAAAH8AAAAAAAAAD/AAAAAAAAAB/wAAAAAAAAAf4AAAAAAAAAH+AAAAAAAAAD/AAAAAAAAAA/wAAAAAAAAAf4AAAAAAAAAH8AAAAAAAAAD8AAAAAAAAAA+AAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":68},"nucifraga-columbiana":{"bits":"AAAfwAAAAAAAAAAAAD//AAAAAAAAAAAAP//4AAAAAAAAAAB///+AAAAAAAAAAP////wAAAAAAAAAf////8AAAAAAAAAf/////AAAAAAAAAf/////gAAAAAAAAIf////4AAAAAAAAAAP///+AAAAAAAAAAH////AAAAAAAAAAB////wAAAAAAAAAAf///8AAAAAAAAAAH///+AAAAAAAAAAD////gAAAAAAAAAA////4AAAAAAAAAAf///+AAAAAAAAAAP////wAAAAAAAAAH////+AAAAAAAAAD/////gAAAAAAAAB/////8AAAAAAAAA//////AAAAAAAAA//////wAAAAAAAAf/////8AAAAAAAAP//////AAAAAAAAH//////wAAAAAAAD//////8AAAAAAAB///////AAAAAAAA///////wAAAAAAAf//////8AAAAAAAP//////+AAAAAAAD///////wAAAAAAB///////8AAAAAAA////////AAAAAAAf///////wAAAAAAH///////8AAAAAAD////////AAAAAAA////////gAAAAAAf///////4AAAAAAH///////+AAAAAAD////////gAAAAAA////////4AAAAAAf///////8AAAAAAH////////AAAAAAB////////gAAAAAAf///////4AAAAAAH///////8AAAAAAB////////AAAAAAAf///////gAAAAAAH///////4AAAAAAB///////+AAAAAAAf///////gAAAAAAD///////4AAAAAAA///////+AAAAAAAH///////gAAAAAAA///////4AAAAAAAH//////+AAAAAAAA///////gAAAAAAD///////wAAAAAAH///////cAAAAAAD//8H///2AAAAAAB4//B//88AAAAAAB8f/Af//EAAAAAAA+/PAH//gAAAAAAAf/AAA//wAAAAAAAH/wAAP/8AAAAAAAB/8AAA/+AAAAAAAB8PAAAP/gAAAAAAA8BgAAB/4AAAAAAAeYwAAA/8AAAAAAAH9QAAAP/AAAAAAAD/gAAAH/gAAAAAAAfgAAAB/4AAAAAAABAAAAAf+AAAAAAAAAAAAAP/AAAAAAAAAAAAAD/wAAAAAAAAAAAAB/4AAAAAAAAAAAAAf+AAAAAAAAAAAAAH/gAAAAAAAAAAAAD/wAAAAAAAAAAAAA/8AAAAAAAAAAAAAf+AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/4AAAAAAAAAAAAA/8AAAAAAAAAAAAAP/AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAf8AAAAAAAAAAAAAH/AAAAAAAAAAAAAA/gAAAAAAAAAAAAAPwAAAAAAAAAAAAAAw=","h":93,"w":91},"numenius-americanus":{"bits":"AAAAAAAAfgAAAAAAAAAAB/4AAAAAAAAAAD/8AAAAAAAAAAD/+AAAAAAAAAAH/+AAAAAAAAAAH/+AAAAAAAAAAH//gAAAAAAAAAP//4AAAAAAAAAP//+AAAAAAAAAP///gAAAAAAAAP/8f4AAAAAAAAH/wB+AAAAAAAAH/wAfAAAAAAAAH/4AHwAAAAAAAD/8AB4AAAAAAAD/+AA8AAAAAAAH//AAeAAAAAAAf//gAOAAAAAAD///gAHAAAAAA////wADAAAAAH////wAAAAAAAf////wAAAAAAB/////wAAAAAAH/////wAAAAAAf/////wAAAAAA//////wAAAAAD//////wAAAAAH//////gAAAAAP//////gAAAAAf//////AAAAAA///////AAAAAH//////+AAAAAf//////+AAAAA///////+AAAAD///////8AAAAP///////8AAAA////////4AAAB////////4AAAAf///////wAAAD////////gAAAf////////AAAA////////8AAAAD///////4AAAAA///////wAAAAD///////AAAAAP//////+AAAAA///////4AAAAA///////AAAAAAD/////+AAAAAAH/8A//8AAAAAAP/wAB/4AAAAAAf+AAB/4AAAAAAPwAAB/wAAAAAAAAAAB/gAAAAAAAAAADnAAAAAAAAAAAHnAAAAAAAAAAAPGAAAAAAAAAAAOGAAAAAAAAAAAeOAAAAAAAAAAAf+AAAAAAAAAAAf/8AAAAAAAAAAA//8AAAAAAAAAAef/AAAAAAAAAAOA/AAAAAAAAAAOA/gAAAAAAAAAOA/gAAAAAAAAAOA3gAAAAAAAAAOA3gAAAAAAAAAOA3gAAAAAAAAAOA/gAAAAAAAAAOAPAAAAAAAAAAOAPAAAAAAAAAAOAOAAAAAAAAAAOAcAAAAAAAAAAOAIAAAAAAAAAAOAAAAAAAAAAAAOAAAAAAAAAAAAOAAAAAAAAAAAAOAAAAAAAAAAAAOAAAAAAAAAAAAOAAAAAAAAAAAAOAAAAAAAAAAAAeB4AAAAAAAAAB//4AAAAAAAAAD//AAAAAAAAAAAP8AAAAAAAAAAAH/8AAAAAAAAAAHH/AAAAAAAAAADAPAAAAAAAAAADgAAAAAAAAAAABwAAAAAAAAAAAA4AAAAAAAAAAAAIAAAAAAA==","h":93,"w":78},"numida-meleagris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAPwAAAAAAAAAAAAAB/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAAf4AAAAAAAAAAAAAD/gAAAAAAAAAAAAA//wAAAAAAAAAAAAH//AAAAAAAAAAAAB//8AAAAAAAAAAAAP//gAAAAAAAAAAAB//8AAAAAAAAAAAAf/wgAAAAAAAAAAAD/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAP7AAAAAAAAA/4AAB/AAAAAAAAP///AAH8AAAAAAA/////AA/gAAAAAA//////AH+AAAAAAf/////+A/wAAAAAP//////8P+AAAAAH/////////4AAAAD//////////AAAAA//////////4AAAAf//////////AAAAH//////////4AAAB///////////AAAAf//////////4AAAH//////////+AAAB///////////wAAAf//////////+AAAH///////////gAAA///////////8AAAP///////////AAAB///////////wAAAf//////////+AAAD///////////gAAA///////////4AAAH//////////+AAAB///////////gAAAP//////////4AAAB//////////+AAAAf//////////wAAAD//////////8AAAAf//////////AAAAD//////////wAAAA//////////+AAAAH//////////gAAAA//////////4AAAAH/////////+AAAAA//////////gAAAAH/////////4AAAAB/////////+AAAAAP/////////gAAAAD/////////wAAAAAf////////4AAAAAH//g/////8AAAAAA//wA////8AAAAAAH+AAA////AAAAAAB/wAAAZ//wAAAAAAP8AAAAf38AAAAAAB/AAAAB8/AAAAAAAPgAAAAPH4AAAAAAAAAAAABw/AAAAAAAAAAAAAOH+AAAAAAAAAAAABwf8AAAAAAAAAAAAOB/4AAAAAAAAAAABwA/wAAAAAAAAAAAOAB/gAAAAAAAAAABwAD/AAAAAAAAAAAOAAH+AAAAAAAAAABwAAP8AAAAAAAAAAOAAA/4AAAAAAAAABwAAP/4AAAAAAAAAPAABn/gAAAAAAAAB4AAcd+AAAAAAAAA/HwDB/8AAAAAAAAP/+AAHngAAAAAAAD//+AAeEAAAAAAAAA//4AAwAAAAAAAAAD7/gAAAAAAAAAAAAPwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":88,"w":93},"nyctanassa-violacea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAf/AAAAAAAAAD//+AAAAAAAAH///8AAAAAAAf////gAAAAAA/////8AAAAAB////nvAAAAAP////Q94AAAB////+AOMAAAH////+ADgAAA/////+AAAAAD//////gAAAAH/z////8AAAAP4AH////AAAAIAAB////wAAAAAAD////4AAAAAAD////8AAAAAAD////+AAAAAAH/////AAAAAAH/////gAAAAAH/////wAAAAAH/////4AAAAAH/////8AAAAAH/////8AAAAAD/////+AAAAAD//////AAAAAD//////AAAAAD//////gAAAAB//////gAAAAB//////wAAAAA//////4AAAAA//////4AAAAAf/////8AAAAAP/////8AAAAAH/////+AAAAAH/////+AAAAAD/////+AAAAAB//////AAAAAA//////AAAAAAf/////gAAAAAP/////gAAAAAH/////gAAAAAD/////wAAAAAA/////wAAAAAA/////wAAAAAAf////4AAAAAAP////4AAAAAAH////4AAAAAAD////4AAAAAAB////4AAAAAAB////4AAAAAAA////8AAAAAAAf///8AAAAAAAP///8AAAAAAAP///8AAAAAAAH///8AAAAAAAH///8AAAAAAAD///8AAAAAAAD8f/8AAAAAAAD8D/8AAAAAAAD+D/8AAAAAAAD+B/8AAAAAAAD+B/8AAAAAAAD8B/8AAAAAAADcA/4AAAAAAADcA/4AAAAAAAHcAeYAAAAAAAHcAAAAAAAAAAHYAAAAAAAAAAGYAAAAAAAAAAGYAAAAAAAAAAO4AAAAAAAAAAO4AAAAAAAAAAO4AAAAAAAAAAM4AAAAAAAAAAewAAAAAAAAB//4AAAAAAAAB//8AAAAAAAAA///gAAAAAAAD7//wAAAAAAAPv/hwAAAAAAAOPfgAAAAAAAAIc7AAAAAAAAAAJzAAAAAAAAAABjAAAAAAAAAADnAAAAAAAAAAHHAAAAAAAAAAHCAAAAAAAAAAMCAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":72},"nycticorax-nycticorax":{"bits":"AAAAP+AAAAAAAAAAB//wAAAAAAAAAH///AAAAAAAAAP///4AAAAAAAA/////gAAAAAAB/////+AAAAAAB//////4AAAAAD//////fAAAAAf/////7zwAAAD//////+88AAAf///////PHAAB////////hxwAH////////4ccAP////////8OHAf8H//////+Djg+AAP//////AwgAAAH//////gcAAAAH//////wGAAAAH//////4CAAAAH//////4AAAAAH//////8AAAAAH//////+AAAAAH///////AAAAAH///////AAAAAH///////gAAAAD///////wAAAAD///////wAAAAB///////4AAAAB///////8AAAAA///////8AAAAA///////+AAAAAf//////+AAAAAP///////AAAAAH///////AAAAAH///////gAAAAD///////gAAAAB///////wAAAAA///////wAAAAAf//////wAAAAAP//////4AAAAAH//////4AAAAAB//////8AAAAAA//////8AAAAAAf/////8AAAAAAP/////8AAAAAAD/////8AAAAAAD/////+AAAAAAB/////+AAAAAAA/////+AAAAAAA/////+AAAAAAAf/////AAAAAAAP/////AAAAAAAH/////AAAAAAAH/////AAAAAAAD/////AAAAAAAB/////AAAAAAAA5////AAAAAAAA95///AAAAAAAA94H//AAAAAAAAf4D//AAAAAAAAf4B//AAAAAAAA/4A//AAAAAAAAf4Af/AAAAAAAAfwAf/AAAAAAAAdwAP3AAAAAAAAdwAPzAAAAAAAAdwAHgAAAAAAAA/wAAAAAAAAAAA/gAAAAAAAAAAA7gAAAAAAAAAAA7gAAAAAAAAAAA7gAAAAAAAAAAA7gAAAAAAAAAAA/gAAAAAAAAAAA/AAAAAAAAAAAB/AAAAAAAAAAAB/AAAAAAAAAAAH/AAAAAAAAAAAP/wAAAAAAAAAB//8AAAAAAAAAB/+/AAAAAAAAAD/+PAAAAAAAAAf//xAAAAAAAAA//35AAAAAAAAAz/B4AAAAAAAAAH3AIAAAAAAAAAPfAAAAAAAAAAAceAAAAAAAAAAA4OAAAAAAAAAAB4OAAAAAAAAAABgOAAAAAAAAAABgOAAAAAAAAAAAAGAAAAAA==","h":93,"w":78},"onychoprion-fuscatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAB////AAAAAAAAAAB////4AAAAAAAAAA/////gAAAAAAAAAP////+AAAAAAAAAAAB///4AAAAAAAAAAAH///4AAAAAAAAAAA////8AAAAAAAAAAH////8AAAAAAAAAA/////4AAAAAAAAAP/////wAAAAAAAAB//////AAAAAAAAAP/////+AAAAAAAAB//////4AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////+AAAAAAAB///////8AAAAAAAH///////4AAAAAAA////////wAAAAAAD///////+AAAAAAAf///////8AAAAAAB////////wAAAAAAH///////+AAAAAAAf///////wAAAAAAB////////AAAAAAAH///////4AAAAAAAf///////AAAAAAAB////////AAAAAAAD////////gAAAAAAH////////wAAAAAAH////////4AAAAAAH////////+AAAAAP///h/////8AAAAB/x9wAH////gAAAAfmeAAAP/wDAAAAAB/nAAAAP/gAAAAAAH/wAAAAf+AAAAAAA3/gAAAAf8AAAAAAC/MAAAAA/4AAAAAAD4AAAAAB/gAAAAAA/AAAAAAB/AAAAAAGcAAAAAAD8AAAAAAR4AAAAAAHwAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAA=","h":52,"w":93},"oporornis-agilis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAD//AAAAAAAAAAAAB//+AAAAAAAAAAAA////wAAAAAAAAAAP////gAAAAAAAAAD////4AAAAAAAAAA////4AAAAAAAAAA////8AAAAAAAAAA/////AAAAAAAAAAf////4AAAAAAAAAP////+AAAAAAAAAH/////wAAAAAAAAP/////8AAAAAAAAf//////gAAAAAAAf//////8AAAAAAAP///////gAAAAAAH///////8AAAAAAD////////gAAAAAD////////8AAAAAD/////////AAAAAD/////////4AAAAA//////////AAAAAD/////////4AAAA///////////AAAD///////////wAAH///////////+AAH////////////gAA////////////4AAH//A/////////AAB/8AAH///////wAAPwAAAH//////4AAAAAAAAP/////+AAAAAAAAAf/////gAAAAAAAAA/////wAAAAAAAAAA////4AAAAAAAAAAH///8AAAAAAAAAAA///+AAAAAAAAAAADj/8AAAAAAAAAAAAOB8AAAAAAAAAAAAAwD4AAAAAAAAAAAAHADwQAAAAAAAAAAAcAH/gAAAAAAAAAABgAf+AAAAAAAAAAAOAH/4AAAAAAAAAAA4H55AAAAAAAAAAADA8DoAAAAAAAAAAAcMAOAAAAAAAAAAABjAAwAAAAAAAAAAAP8AGAAAAAAAAAAAA/wAgAAAAAAAAAAAf/gAAAAAAAAAAAAfv8AAAAAAAAAAAAHwegAAAAAAAAAAAAwBwAAAAAAAAAAAACAGAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":60,"w":93},"oreoscoptes-montanus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAB//gAAAAAAAAAH//4AAAAAAAAD///+AAAAAAAAD////gAAAAAAAD////4AAAAAAAAB///8AAAAAAAAAP///AAAAAAAAAD///gAAAAAAAAB///wAAAAAAAAAf//8AAAAAAAAAP//+AAAAAAAAAD///AAAAAAAAAB///wAAAAAAAAAf//4AAAAAAAAAP//8AAAAAAAAAH//+AAAAAAAAAH///AAAAAAAAAH///gAAAAAAAAH///wAAAAAAAAH///4AAAAAAAAH///8AAAAAAAAH///+AAAAAAAAH////AAAAAAAAP////gAAAAAAAH////wAAAAAAAH////4AAAAAAAH////8AAAAAAAH////+AAAAAAAH/////AAAAAAAH/////gAAAAAAD/////wAAAAAAD/////4AAAAAAD/////8AAAAAAB/////+AAAAAAB/////+AAAAAAB//////AAAAAAB//////gAAAAAA//////gAAAAAA//////wAAAAAA//////wAAAAAAf/////4AAAAAAf/////4AAAAAAP/////4AAAAAAP/////8AAAAAAP/////8AAAAAAP/////8AAAAAAH/////8AAAAAAH/////8AAAAAAH/////8AAAAAAH/////8AAAAAAD/////8AAAAAAD/////8AAAAAAD/////+AAAAAAB//////AAAAAAB//////gAAAAAB//////wAAAAAA//////4AAAAAA//////4AAAAAA//////8AAAAAAf/////8AAAAAAf///5/8AAAAAAf//3w/wAAAAAAf//wAP4AAAAAAP/7gAH4AAAAAAP/wAAAQAAAAAAP/gAAAAAAAAAAP/gAAAAAAAAAAP/wAAAAAAAAAAP/wAAAAAAAAAAP/wAAAAAAAAAAH/wAAAAAAAAAAH/4AAAAAAAAAAH/4AAAAAAAAAAH/4AAAAAAAAAAH/4AAAAAAAAAAH/4AAAAAAAAAAH/8AAAAAAAAAAD/8AAAAAAAAAAD/8AAAAAAAAAAD/8AAAAAAAAAAD/+AAAAAAAAAAD/+AAAAAAAAAAB/+AAAAAAAAAAB/+AAAAAAAAAAA/+AAAAAAAAAAA/+AAAAAAAAAAAfwAAAAAAAAAAAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":79},"oreothlypis-ruficapilla":{"bits":"AAAAAAAAAAAAABAAAAH+AAAAAAAAA8AAAH/+AAAAAAAAPgAAD//8AAAAAAAH//AA///4AAAAAAB//4AP///gAAAAAAf//AD///+AAAAAAH//4D////4AAAAAB//+P/////gAAAAAf//H/////+AAAAAH//wP/////4AAAAB//8AP/////AAAAAf//AAP////+AAAAH//gAB//////AAAB//4AAH/////+AAAf/+AAA//////+AAH//AAAD//////8AD//wAAAf//////4B//8AAAD//////////+AAAAP//////////gAAAB//////////4AAAAP//////////AAAAB//////////wAAAAP/////////8AAAAA//////////gAAAAH/////////4AAAAA//////////AAAAAH/////////wAAAAA/////////+AAAAAH/////////gAAAAA/////////8AAAAAH/////////AAAAAAf////////4AAAAAD////////+AAAAAAf////////wAAAAAB////////+AAAAAAP////////4AAAAAA/////////AAAAAAH////////4AAAAAAf////////gAAAAAB////////+AAAAAAH////////4AAAAAAf////////gAAAAAB////////+AAAAAAH////////4AAAAAA//////8D/gAAAAAB//////AB8AAAAAAD/////wAAgAAAAAAP////8AAAAAAAAAAP///+AAAAAAAAAAAf///AAAAAAAAAAAAf//4AAAAAAAAAAAH///AAAAAAAAAAAB4AH4AAAAAAAAAAAeAAeAAAAAAAAAAAPgAHgAAAAAAAAAAD/8B4AAAAAAAAAAA//wOAAAAAAAAAAAP/mDgAAAAAAAAAAD4AA4AAAAAAAAAAB/AAHAAAAAAAAAAAfwABwAAAAAAAAAAH+AAcAAAAAAAAAAA3wAHnAAAAAAAAAAG8AB5+AAAAAAAAAA/wAf/wAAAAAAAAABuAD/yAAAAAAAAAAPgA/AAAAAAAAAAABmAPgAAAAAAAAAAAIcH8AAAAAAAAAAABgB/gAAAAAAAAAAAMAP8AAAAAAAAAAAAwDPAAAAAAAAAAAAAAb4AAAAAAAAAAAAADfAAAAAAAAAAAAAAH4AAAAAAAAAAAAAA7AAAAAAAAAAAAAAOfAAAAAAAAAAAAABgwAAAAAAAAAAAAAMAAAAAAAAAAAAAABgAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAwAAAAAAAAA=","h":83,"w":93},"oxyura-jamaicensis":{"bits":"AAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAB/4AAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAB///8AAAAAAAAAAAP///gAAAAAAAAAAD///+AAAAAAAAAAAf/x/4AAAAAAAAAAD/+H/AAAAAAAAAAA//4/4AAAAAAAAAAH/+H/AAAAAAAAAAB//w/4AAAAAAAAAA//+H/gAAAAAAAQAP//j/8AAAAAAAOAH/////gAAAAAADhB/4P//8AAAAAAA8YP8B///gAAAAADfPB8AP/+cAAAAAA3/wAAD//x//wAAAP/+gAB//////4AAD//sAAf//////wAA///gAH///////gAP//4AB////////8D//+AAf////////////8AH/////////////AA/////////////wAP////////////+AB/////////////wAP////////////8AD/////////////AAf////////////wAD////////////8AAf///////////+AAD////////////gAAP///////////8AAB////////////AAAP///////////4AAB///////////+AAAH///////////wAAA////////////AAAD///////////+AAAf///////////8AAB////////////wAAP///////////+AAA//////////+AAAAB//////////gAAAAH/////////4AAAAAf/////////AAAAAA/////////wAAAAAB////////4AAAAAAD///////+AAAAAAAH///////AAAAAAAAD//////AAAAAAAAAP/////gAAAAAAAAD/////wAAAAAAAAA/////wAAAAAAAAAG/8Dw8AAAAAAAAAAT/gAPAAAAAAAAAAAPOADwAAAAAAAAAABgAB/AAAAAAAAAAAMAB/4AAAAAAAAAAAwP//AAAAAAAAAAAAD//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAH/wAAAAAAAAAAAAB/8AAAAAAAAAAAAAMfgAAAAAAAAAAAABA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"pandion-haliaetus-2":{"bits":"CAAAAAAAAAAAAAMAAAAAAAAAAAAAxAAAAAAAAAAAATmAAAAAAAAAAAB3YAAAAAAAAAAAH/wAAAAAAAAAAAP/gAAAAAAAAAADf+AAAAAAAAAAAP/8AAAAAAAAAAAf/4AAAAAAAAAAA//wAAAAAAAAAAB//gAAAAAAAAAAP//AAAAAAAAAAA//+AAAAAAAAAAB//8AAAAAAAAAAD//4AAAAAAAAAAH//wAAAAAAAAAAf//gAAAAAAAAAB///AAAAAAAAAAD///AAAAAAAAAAH//+AAAAAAAAAAP//8AAAAAAAAAA///4AAAAAAAAAB///wAAAAAAAAAD///gAAAAAAAAAH///AAAAAAAAAAf//8AAAAAAAAAA///wAAAAAAAAAB///gAAAAAAAAAD//+AAAAAAAAAAH//4AAAAAAAAAAf//wAAAAAAAAAA///AAAAAAAAAAD//+AAAAAAAAAAH//4AAAAAAAAAAf//wAAAAAAAAAB///AAAAAAAAAAD//+AAAAAAAAAAP//4AAAAAAAAAAf//wAAAAAAAAAB///gAAAAAAAAAD///AAAAAAAAAAP//+AAAAAAAAAAf///wAAAAAAAAA////8AAAAAAAAD////4AAAAAAAAH////wAAAAAAAAf////AAAAAAAAA////+AAAAAAAAB////4AAAAAAAAB///9AAAAAAAAAD///gAAAAAAAf////+AAAAAAAB/////8AAAAAAAH/////4AAAAAAAf/////wAAAAAAB//////gAAAAAAH//////gAAAAAAP//////AAAAAAB///f///AAAAAAD//4////AAAAAAH//D////AAAAAAf/8D///+AAAAAA//gP///8AAAAAB/+Af///4AAAAAD/4A////gAAAAAH/AB////AAAAAAD8AB///+AAAAAABgAD///4AAAAAAAAAH///wAAAAAAAAAH///gAAAAAAAAAP//+AAAAAAAAAAP//8AAAAAAAAAA///wAAAAAAAAAA///gAAAAAAAAAB///AAAAAAAAAAD//8AAAAAAAAAAH//4AAAAAAAAAAP//wAAAAAAAAAAP//gAAAAAAAAAA//+AAAAAAAAAAB//8AAAAAAAAAAD//4AAAAAAAAAAD//wAAAAAAAAAAH//gAAAAAAAAAAP//gAAAAAAAAAAP/2AAAAAAAAAAA//gAAAAAAAAAAB//AAAAAAAAAAAC/+AAAAAAAAAAAB+cAAAAAAAAAAADcAAAAAAAAAAAAAwA","h":93,"w":82},"pandion-haliaetus":{"bits":"AeAAAAAAAAAAAAB/+AAAAAAAAAAAD//AAAAAAAAAAAP//AAAAAAAAAAA///gAAAAAAAAAD///AAAAAAAAAAH///AAAAAAAAAAP//+AAAAAAAAAAf//+AAAAAAAAAA///+AAAAAAAAAB///8AAAAAAAAAD///4AAAAAAAAAH///wAAAAAAAAAP///gAAAAAAAAAf//+AAAAAAAAAA///8AAAAAAAAAD///+AAAAAAAAAD////AAAAAAAAAH////AAAAAAAAAP////wAAAAAAAA/////8AAAAAAAD/////+AAAAAAAH//////gAAAAAAf//////gAAAAAA///////wAAAAAB///////wAAAAAD///////4AAAAAH///////4AAAAAP///////4AAAAAf///////8AAAAAf///////8AAAAA////////4AAAAB////////4AAAAD////////4AAAAD////////4AAAAH////////4AAAAH////////4AAAAP////////wAAAAP////////wAAAAf////////wAAAA/////////gAAAA/////////gAAAB/////////gAAAB/////////AAAAD////////+AAAAD////////+AAAAH////////8AAAAH////////4AAAAH////////4AAAAP////////wAAAAH////////wAAAAD////////wAAAAB////////wAAAAB////////gAAAAB////////gAAAAB////////AAAAAB///////+AAAAAD///////+AAAAAH///////8AAAAAP///////8AAAAAP///////4AAAAAf///////wAAAAA////////wAAAAA////////gAAAAB////////AAAAAB///////+AAAAAD///////8AAAAAD///////4AAAAAH///////4AAAAAP///////wAAAAAf/+P////wAAAAAf/8H////wAAAAB//4P////4AAAAD//wP////4AAAAP//AP////8AAAAf8AAP////4AAA///AAB////4AAD//+AAA////4AAH//+AAA////wAAf//8AAA//4/wAA///4AAB//4/gAB3//wAAB//wfgABv//gAAB//wPAABs8+AAAB//wPAAAP4AAAAD//gGAAAPmAAAAD//gAAAAD4AAAAD//AAAAADgAAAAD//AAAAAAAAAAAD/+AAAAAAAAAAAD/+AAAAAAAAAAAD/8AAAAAAAAAAAB/4AAAAAAAAAAAAjAA=","h":93,"w":83},"parabuteo-unicinctus":{"bits":"AAAAAAAAAAAAAMAAAAAAAAAA/8AAAAAAAAA//wAAAAAAAAf//AAAAAAAAH//4AAAAAAAD//+AAAAAAAB///wAAAAAAA///+AAAAAAAP///gAAAAAAH///8AAAAAAB////AAAAAAAM///4AAAAAACH///AAAAAAAB///4AAAAAAAf///AAAAAAAH///4AAAAAAB////gAAAAAAf///+AAAAAAH////4AAAAAD/////AAAAAA/////4AAAAAP/////gAAAAD/////8AAAAA//////AAAAAP/////8AAAAD//////gAAAA//////4AAAAP//////AAAAD//////4AAAA//////+AAAAP//////wAAAB//////+AAAAf//////wAAAH//////8AAAB///////gAAAP//////8AAAD///////AAAAf//////wAAAH//////+AAAA///////gAAAP//////8AAAB///////AAAAP//////4AAAD//////+AAAAf//////gAAAD//////8AAAAf//////gAAAD//////4AAAA//////+AAAAH//////wAAAA//////8AAAAH//////AAAAA//////wAAAAP/////8AAAAB//////AAAAAf/////4AAAAD//////AAAAA//////4AAAAH/////+AAAAB//////wAAAAP/////+AAAAD//f///wAAAA//j///8AAAAH/4////gAAAA/8H///4AAAAP+B////AAAAD/AP///wAAAA/gB///8AAAAPgAP/9/AAAAD4AA//HwAAAB+AAH/48AAAAfgAA/+DAAAAH/AAP/wAAAB//4AB/8AAAA///AAf/AAAA///4AH/4AAAf///AA/+AAAP///wAP/gAADZ8BkAB/8AAAA+AAAAf/AAAAeAAAAD/4AAAHAAAAA/+AAABAAAAAH/gAAAAAAAAB/8AAAAAAAAAP/AAAAAAAAAD/wAAAAAAAAAf8AAAAAAAAAH/gAAAAAAAAAf4AAAAAAAAAD8AAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":68},"parkesia-motacilla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfgAAAAAAAAf8AAAD/AAAAAAAAP/4AAD/8AAAAAAAH//wAA//wAAAAAAD///AAH//AAAAAAA////+B//8AAAAAAP////8P//wAAAAAD/////g///AAAAAA/////gH//8AAAAAP////AAf//wAAAAD////wAB///AAAAA////8AAD//8AAAD/////AAAP//wAAD/////wAAA///AAD/////+AAAD//8AB//////wAAAP//wB//////8AAAAf//7///////gAAAB//////////4AAAAH//////////AAAAA//////////wAAAAD/////////+AAAAAP/////////wAAAABv////////+AAAAAG/////////gAAAAA3////////8AAAAACf////////gAAAAAY////////8AAAAABH////////gAAAAAN////////8AAAAAAv////////AAAAAAD////////4AAAAAAf///////+AAAAAAP////////wAAAAAH////////8AAAAAB/////////AAAAAAf////////4AAAAAH////////+AAAAAB/////////gAAAAAPgP//////4AAAAAAAA//////+AAAAAAAAD//////gAAAAAAAAP/////4AAAAAAAAA/////8AAAAAAAAAD////+AAAAAAAAAAH////AAAAAAAAAAAf///gAAAAAAAAAAD///gAAAAAAAAAAA///gAAAAAAAAAAAH4D4AAAAAAAAAAAAeAHwAAAAAAAAAAADwAfAAAAAAAAAAAAPAA+AAAAAAAAAAAA8AB8AAAAAAAAAAADwAHwAAAAAAAAAAAPAf/gAAAAAAAAAAA8H//8AAAAAAAAAADgH//4AAAAAAAAAAOAAP9AAAAAAAAAAA4AA/4AAAAAAAAAADgAD3gAAAAAAAAA+eAAOeAAAAAAAAAH/+AAYwAAAAAAAAAH//gCCAAAAAAAAAAA/+AAAAAAAAAAAAAD/QAAAAAAAAAAAAAP+AAAAAAAAAAAAAA94AAAAAAAAAAAAADngAAAAAAAAAAAAAOEAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"parkesia-noveboracensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAAAAAAAP/+AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAA////8AAAAAAAAAAP////8AAAAAAAAAD/////gAAAAAAAAH/////wAAAAAAAAf/////AAf4AAAAAf/////wAD/+AAAA//////8AB///AAB///////AAP///4////////wAA////////////+AAH////////////gAAP///////////8AAAH///////////AAAAD//////////4AAAAA//////////AAAAAB/////////4AAAAAGf////////AAAAAAY////////4AAAAABx////////AAAAAAHP///////wAAAAAAN///////+AAAAAAA////////wAAAAAAP///////8AAAAAAD////////gAAAAAB////////4AAAAAAP///////+AAAAAAD////////gAAAAAAeA//////4AAAAAAAAD/////+AAAAAAAAAP/////gAAAAAAAAA/////4AAAAAAAAAD////8AAAAAAAAAAH////AAAAAAAAAAA////AAAAAAAAAAAH///AAAAAAAAAAAA+f/AAAAAAAAAAAAHh4AAAAAAAAAAAAAeHAAAAAAAAAAAAAB4cAAAAAAAAAAAAAHBwAAAAAAAAAAAAAcPAAAAAAAAAAAAABw4AAAAAAAAAAAAAHDgAAAAAAAAAAAAAcOAAAAAAAAAAAAABw4AAAAAAAAAAAACPnAAAAAAAAAAAAA///AAAAAAAAAAAAF///wAAAAAAAAAAAA//+AAAAAAAAAAAAA//4AAAAAAAAAAAAD/ngAAAAAAAAAAAAPeEAAAAAAAAAAAAA4QAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":62,"w":93},"passer-domesticus":{"bits":"AAD8AAAAAAAAAAAAAH/+AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///gAAAAAAAAAAD///+AAAAAAAAAAAf///4AAAAAAAAAAP////gAAAAAAAAAD////8AAAAAAAAAB/////wAAAAAAAAAf/////AAAAAAAAAD//////AAAAAAAAA///////AAAAAAAAA//////+AAAAAAAAB//////+AAAAAAAAD//////4AAAAAAAAf//////wAAAAAAAB///////AAAAAAAAP//////+AAAAAAAA///////4AAAAAAAH///////gAAAAAAA///////+AAAAAAAH///////4AAAAAAA////////AAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////gAAAAAAf///////+AAAAAAB////////4AAAAAAP////////gAAAAAB////////+AAAAAAH////////4AAAAAA/////////gAAAAAD////////+AAAAAAf////////4AAAAAB/////////AAAAAAH////////8AAAAAA/////////wAAAAAD////////+AAAAAAP////////wAAAAAA/////////AAAAAAD////////8AAAAAAP////////wAAAAAAf////////AAAAAAB////////8AAAAAAD////////gAAAAAAH///////+AAAAAAAP///////wAAAAAAAf//////+AAAAAAAAf//////gAAAAAAAH//////4AAAAAAAD///////AAAAAAAAf//////8AAAAAAAH///////wAAAAAAA////4f//AAAAAAAH3/AAA//8AAAAAAA+/8AAB//wAAAAAAH3z4AAB//AAAAAAA/+PAAAD/8AAAAAAD/44AAAP/wAAAAAAP/LAAAA//AAAAAAA//YAAAD/+AAAAAABP8AAAAP/4AAAAAAA/gAAAA//gAAAAAAA4AAAAD/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//gAAAAAAAAAAAAD/+AAAAAAAAAAAAAP/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP+AAAAAAAAAAAAAA/wAAAAAAAAAAAAAD/AAAAAAAAAAAAAAPwAAAAAAAAAAAAAA8A=","h":76,"w":93},"passerculus-sandwichensis":{"bits":"AAfgAAAAAAAAAAAAAf/wAAAAAAAAAAAAH//gAAAAAAAAAAAD//+AAAAAAAAAAAAf//4AAAAAAAAAAAf///gAAAAAAAAAAP///+AAAAAAAAAAD////wAAAAAAAAAA/////AAAAAAAAAAB////4AAAAAAAAAAB////gAAAAAAAAAAP///8AAAAAAAAAAB////wAAAAAAAAAAP///+AAAAAAAAAAB////4AAAAAAAAAAP////AAAAAAAAAAB////8AAAAAAAAAAP////8AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAB//////AAAAAAAAAP/////+AAAAAAAAB//////4AAAAAAAAf//////gAAAAAAAD//////+AAAAAAAAf//////4AAAAAAAD///////gAAAAAAAf//////+AAAAAAAD///////8AAAAAAAf///////wAAAAAAD////////AAAAAAAf///////+AAAAAAB////////4AAAAAAP////////gAAAAAB////////+AAAAAAH////////4AAAAAA/////////gAAAAAH////////+AAAAAAf////////wAAAAAB/////////AAAAAAP////////8AAAAAA/////////wAAAAAD////////+AAAAAAf////////wAAAAAB/////////AAAAAAH////////8AAAAAAf////////wAAAAAA/////////AAAAAAD////////8AAAAAAP////////wAAAAAAf////////AAAAAAA////////8AAAAAAB////////wAAAAAAD////8P//gAAAAAAD///8AP/+AAAAAAAH//8AAH/8AAAAAAA//+AAAH/wAAAAAAPg/wAAAf/AAAAAADwD8AAAA/+AAAAAA8APgAAAD/4AAAAAPAD4AAAAP/gAAAAHwAeAAAAAf/AAAAB8AHgAAAAB/8AAAAf/h4AAAAAH/wAAAH/8eAAAAAAP/AAAD/8HgAAAAAA/8AAB/AB4AAAAAAB/wAA/wAeAAAAAAAH/AAP+ADwAAAAAAAf4AD/gA9/AAAAAAA/AAf4Af/IAAAAAAAAAD3AH/wAAAAAAAAAAcwH+AAAAAAAAAAADuB/gAAAAAAAAAAA5gf8AAAAAAAAAAAGMG/AAAAAAAAAAAAww/4AAAAAAAAAAAGADmAAAAAAAAAAAAAA9wAAAAAAAAAAAAAHOAAAAAAAAAAAAABxAAAAAAAAAAAAAAYIAAAAAAAAAAAAADBgAAAAAAAAAAAAAYEAAAAAAAAAAAAADAAAAAAAAAAAAA=","h":85,"w":93},"passerella-iliaca":{"bits":"AAAAAAAAAAAA/AAAAAAAAAAAAAB//gAAAAAAAAAAAA//+AAAAAAAAAAAAP//8AAAAAAAAAAAD///wAAAAAAAAAAB///+AAAAAAAAAAAf///4AAAAAAAAAAH////gAAAAAAAAAA/////AAAAAAAAAAP////8AAAAAAAAAD/////wAAAAAAAAA//////AAAAAAAAAP/////wAAAAAAAAD/////wAAAAAAAAB/////4AAAAAAAAAf/////AAAAAAAAAP/////4AAAAAAAAH//////AAAAAAAAB//////4AAAAAAAAf/////+AAAAAAAAP//////wAAAAAAAD//////+AAAAAAAA///////wAAAAAAAP//////+AAAAAAAD///////wAAAAAAA///////+AAAAAAAP///////wAAAAAAD///////+AAAAAAA////////wAAAAAAP///////+AAAAAAD////////gAAAAAA////////8AAAAAAP////////gAAAAAD////////4AAAAAA/////////AAAAAAH////////4AAAAAB////////+AAAAAAf////////wAAAAAD////////8AAAAAA/////////AAAAAAH////////wAAAAAB////////+AAAAAAP////////gAAAAAD////////4AAAAAA////////+AAAAAAP////////gAAAAAD////////wAAAAAA////////8AAAAAAP////////AAAAAAB////////gAAAAAAf///////4AAAAAAD///////8AAAAAAA///////+AAAAAAAB///////AAAAAAAAP///////4AAAAAAD//4P////wAAAAAA//4A/////AAAAAAP/+AAH///8AAAAAD/+AAAf/H/gAAAAA//AAAf/4PwAAAAAP/wAAP//h8AAAAAD/8AAB8H++AAAAAA//AAAIA/XgAAAAAP/wAABAD6AAAAAAD/8AAAAAfAAAAAAA//AAAAAb4AAAAAAP/wAAAAD8AAAAAAD/8AAAAAEAAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAD/+AAAAAAAAAAAAAf/gAAAAAAAAAAAAH/4AAAAAAAAAAAAB/+AAAAAAAAAAAAAP/gAAAAAAAAAAAAD/4AAAAAAAAAAAAAf+AAAAAAAAAAAAAD/gAAAAAAAAAAAAA/4AAAAAAAAAAAAADgAAAAAAAAAAAAAA","h":80,"w":93},"passerina-amoena":{"bits":"AAH8AAAAAAAAAAAB//gAAAAAAAAAAP//wAAAAAAAAAA///4AAAAAAAAAD///4AAAAAAAAAP///8AAAAAAAAB////8AAAAAAAAP////4AAAAAAAA/////wAAAAAAAD/////wAAAAAAAP/////gAAAAAAAf/////gAAAAAAAH/////AAAAAAAAD/////AAAAAAAAD////+AAAAAAAAH////+AAAAAAAAP////+AAAAAAAAP////+AAAAAAAAf/////AAAAAAAA//////AAAAAAAA//////gAAAAAAB//////gAAAAAAD//////wAAAAAAH//////wAAAAAAP//////wAAAAAAf//////4AAAAAA///////4AAAAAD///////4AAAAAH///////4AAAAAP///////4AAAAAf///////4AAAAA////////wAAAAB////////wAAAAD////////wAAAAH////////wAAAAP////////wAAAAP////////gAAAAf////////gAAAA/////////gAAAB/////////gAAAB/////////AAAAD/////////AAAAD/////////AAAAH////////+AAAAH////////+AAAAP////////8AAAAP////////4AAAAP////////4AAAAP////////wAAAAP////////wAAAAf////////gAAAAf////////gAAAAP////////AAAAAP///////+AAAAAP///////8AAAAAP///////8AAAAAH///////8AAAAAD///////8AAAAAB///////8AAAAAA///////8AAAAAH///////8AAAAAf///////8AAAAD/x//////8AAAAH/4//////8AAAAPz4A////34AAAAfLwB/v//j4AAAA+bwP2H//hwAAAA+xh+AH//BgAAAB/mP4AH/+AAAAAB/5/AAD/8AAAAAA/H8AAD/4AAAAAAYP/gAH/wAAAAAAB//gAH/wAAAAAAD8fgAP/gAAAAAAD4/AAP/gAAAAAAHxGAAf/gAAAAAAH+IAAf/AAAAAAAP/QAA//AAAAAAAf8AAA/+AAAAAAADwAAB/+AAAAAAAAAAAB/8AAAAAAAAAAAD/8AAAAAAAAAAAD/4AAAAAAAAAAAH/4AAAAAAAAAAAH/wAAAAAAAAAAAP/wAAAAAAAAAAAP/gAAAAAAAAAAAf/gAAAAAAAAAAAf/AAAAAAAAAAAAf/AAAAAAAAAAAAf+AAAAAAAAAAAAZ8AAAAAAAAAAAAAw=","h":93,"w":83},"passerina-caerulea":{"bits":"AAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAf/AAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAB///wAAAAAAAAAAAf///AAAAAAAAAAAP///8AAAAAAAAAAD////wAAAAAAAAAA////+AAAAAAAAAAP////4AAAAAAAAAB/////gAAAAAAAAAH////+AAAAAAAAAAP////wAAAAAAAAAAf////AAAAAAAAAAB////4AAAAAAAAAAH////gAAAAAAAAAAf///+AAAAAAAAAAD////8AAAAAAAAAAP////4AAAAAAAAAB/////gAAAAAAAAAP/////AAAAAAAAAB/////8AAAAAAAAAP/////4AAAAAAAAB//////gAAAAAAAAP/////+AAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAA////////AAAAAAAH///////8AAAAAAAf///////wAAAAAAD////////AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAA////////4AAAAAAD////////AAAAAAAP///////8AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////wAAAAAAB////////AAAAAAAH///////8AAAAAAAP///////wAAAAAAA///////+AAAAAAAD///////4AAAAAAAH///////gAAAAAAAf//////+AAAAAAAA///////4AAAAAAAA///////gAAAAAAAP///+f/8AAAAAAAH8///z//wAAAAAAD/7//+P/8AAAAAAB///wAY//gAAAAAAPw/+ABz/8AAAAAAB8AfgAD//AAAAAAAeAPwAAH/8AAAAAADwH4AAAP/wAAAAAAcD8AAAAf/AAAAAADx+AAAAB/8AAAAAAY/gAAAAH/wAAAAAB//4AAAAf+AAAAAAH//gAAAB/4AAAAAA/A8AAAAH/gAAAAAHwAgAAAA/+AAAAAA8AAAAAAD/4AAAAAHAAAAAAAP/gAAAAA4AAAAAAA/+AAAAAHgAAAAAAD/4AAAAA4AAAAAAAP/gAAAAGAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAB+AAAAAAAAAAAAAADwAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAA==","h":86,"w":93},"passerina-ciris":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//gAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAAf///AAAAAAAAAAAH///8AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAAP///4AAAAAAAAAAA////gAAAAAAAAAAH///8AAAAAAAAAAA////8AAAAAAAAAAH////4AAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAAf/////AAAAAAAAAB/////+AAAAAAAAAP/////4AAAAAAAAB//////gAAAAAAAAP//////AAAAAA8AB///////AAAA//4AP//////+AAH//+AB/////////////4AP/////////////gB/////////////8AH/////////////AA/////////////AAH///////////4AAAf/////////4AAAAD/////////gAAAAAP////////wAAAAAA////////4AAAAAAH///////8AAAAAAAf///////wAAAAAAB////////AAAAAAAD///////8AAAAAAAP//////HwAAAAAAA//////8GAAAAAAAD//////wAAAAAAAAH//////AAAAAAAAAP/////8AAAAAAAAAP///H/wAAAAAAAAAH//gB/AAAAAAAAAA+/wAB4AAAAAAAAA/B+AAAAAAAAAAAAfgHwAAAAAAAAAAAHwAcAAAAAAAAAAA//4PgAAAAAAAAAAP//jwAAAAAAAAAAD/gk8AAAAAAAAAAAT4APAAAAAAAAAAAAeADwAAAAAAAAAAAHwA8AAAAAAAAAAAA8APOAAAAAAAAAAAGx//4AAAAAAAAAAAwf/9AAAAAAAAAAADA/AAAAAAAAAAAAAAfwAAAAAAAAAAAAAH8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAY4AAAAAAAAAAAAADGAAAAAAAAAAAAAAQwAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":67,"w":93},"passerina-cyanea":{"bits":"AAfgAAAAAAAAAAAAAf/wAAAAAAAAAAAAP//gAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAf///gAAAAAAAAAAP///+AAAAAAAAAAD////4AAAAAAAAAA/////gAAAAAAAAAD////8AAAAAAAAAAD////wAAAAAAAAAAP////AAAAAAAAAAA////4AAAAAAAAAAH////gAAAAAAAAAA////8AAAAAAAAAAH////wAAAAAAAAAAf////AAAAAAAAAAD////+AAAAAAAAAAP////8AAAAAAAAAB/////4AAAAAAAAAP/////wAAAAAAAAA//////AAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA///////wAAAAAAAH//////+AAAAAAAA///////4AAAAAAAH///////gAAAAAAA////////AAAAAAAD///////8AAAAAAAf///////wAAAAAAD////////AAAAAAAP///////8AAAAAAB////////wAAAAAAP////////AAAAAAA////////8AAAAAAD////////wAAAAAAf////////AAAAAAB////////4AAAAAAH////////gAAAAAAf///////+AAAAAAD////////wAAAAAAP////////AAAAAAA////////4AAAAAAD////////gAAAAAAP///////+AAAAAAA////////wAAAAAAB////////AAAAAAAH///////8AAAAAAAf///////wAAAAAAA////////AAAAAAAB///////8AAAAAAAD///////wAAAAAAAH///////AAAAAAAB///////4AAAAAAAf//////8AAAAAAAH+//////gAAAAAAA879AH//4AAAAAAAPDvgAf//AAAAAAAAwd8AA//8AAAAAAAGDfgAD//wAAAAAAA4/wAAH//AAAAAAAGD4AAAP/8AAAAAAAR+AAAAf/wAAAAAAAfAAAAB//AAAAAAAPgAAAAH/8AAAAAAH4AAAAA//wAAAAAD+AAAAAD//AAAAAAf8AAAAAP/8AAAAAH3wAAAAA//wAAAAA8PAAAAAD//AAAAAHg4AAAAAP/8AAAAA4DAAAAAB//wAAAAHBwAAAAAH//AAAAAYMAAAAAAf/8AAAADgAAAAAAB//wAAAAEAAAAAAAH/+AAAAAAAAAAAAA//wAAAAAAAAAAAAD//AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP4AAAAAAAAAAAAAAeAA==","h":87,"w":93},"patagioenas-fasciata":{"bits":"APgAAAAAAAB/wAAAAAAAH/4AAAAAAAf/4AAAAAAA//wAAAAAAB//wAAAAAAH//gAAAAAAf//gAAAAAB///AAAAAAH///AAAAAAOf/+AAAAAAQP/8AAAAAAAf/8AAAAAAB//4AAAAAAD//4AAAAAAP//wAAAAAAf//wAAAAAB///wAAAAAD///4AAAAAP///8AAAAAf///+AAAAA////+AAAAB////+AAAAH/////AAAAP/////AAAAf/////AAAA//////AAAB//////AAAD/////+AAAH/////+AAAP/////+AAAf/////8AAA//////8AAB//////4AAB//////4AAD//////4AAH//////wAAH//////wAAP//////wAAP//////gAAP//////AAAf//////AAAf/////+AAAf/////+AAAf/////8AAAP/////4AAAP/////wAAAP/////wAAAP/////gAAAP/////AAAAH////+AAAAD////+AAAAD////+AAAAD////+AAAAH////+AAAB/////+AAAH/////+AAAP/////+AAAf+////+AAA+cD///+AAB+4H///+AAB8wH///8AAB8AP///4AAD8Af/5+AAAHYAf/w8AAAHAA//gYAAAAAA//AAAAAAAA/+AAAAAAAB/8AAAAAAAD/4AAAAAAAD/wAAAAAAAH/wAAAAAAAP/gAAAAAAAf/AAAAAAAA/+AAAAAAAB/8AAAAAAAB/4AAAAAAAD/4AAAAAAAH/wAAAAAAAP/gAAAAAAAP/AAAAAAAAf+AAAAAAAA/8AAAAAAAB/4AAAAAAAB/4AAAAAAAD/wAAAAAAAH/gAAAAAAAH/AAAAAAAAP+AAAAAAAAP8AAAAAAAAP4AAAAAAAAfwAAAAAAAAPgA=","h":93,"w":59},"pavo-cristatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAABwAAAAAAAA/gAAAAAAAf8AAAAAAAN+AAAAAAAB4AAAAAAAA8AAAAAAAAeAAAAAAAAPgAAAAAAAHwAAAAAAAB4AAAAAAAA+AAAAAAAAfAAAAAAAAfAAAAAAAAfgAAAAAAB/wAAAAAAD/4AAAAAAD/8AAAAAAD/8AAAAAAH/+AAAAAAH//gAAAAAH//wAAAAAD//wAAAAAD//4AAAAAD//8AAAAAD//8AAAAAB//8AAAAAB//8AAAAAA//8AAAAAA//+AAAAAA//+AAAAAAf/+AAAAAAf//AAAAAAP//AAAAAAH//gAAAAAH//wAAAAAD/94AAAAAD/+8AAAAAD//+AAAAAB//vAAAAAB//ygAAAAA//74AAAAA//8vAAAAA//+/wAAAAf/+/8AAAAP//UcAAAAP//AIAAAAP//gIAAAAH//wAAAAAH//4AAAAAD//4AAAAAB//8AAAAAB//+AAAAAA///AAAAAAf//AAAAAAP//gAAAAAP//wAAAAAH//4AAAAAH//4AAAAAD//8AAAAAD//+AAAAAB//+AAAAAB//+AAAAAA///gAAAAAf//wAAAAAf//wAAAAAP//4AAAAAP//8AAAAAH//4AAAAAH//8AAAAAH//+AAAAAD//+AAAAAD//+AAAAAB///AAAAAB///AAAAAA///AAAAAA///gAAAAA///gAAAAA///gAAAAAf//gAAAAAf//gAAAAAf//gAAAAAP//gAAAAAH//wAAAAAD//gAAAAAB//gAAAAAAf/AAAAAAAH/AAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":55},"pelecanus-erythrorhynchos":{"bits":"AAAAAAA/gAAAAAAAAAAD/4AAAAAAAAAAH/+AAAAAAAAAAP//AAAAAAAAAAP//AAAAAAAAAAP//gAAAAAAAAAP//wAAAAAAAAAP//wAAAAAAAAAP//wAAAAAAAAAP//4AAAAAAAAAP//4AAAAAAAAAP//8AAAAAAAAAH//+AAAAAAAAAH///AAAAAAAAAH///AAAAAAAAAD///gAAAAAAAAD///wAAAAAAAAD///4AAAAAAAAB///4AAAAAAAAA///8AAAAAAAAA///+AAAAAAAAAf///AAAAAAAAAP///AAAAAAAAAH///gAAAAAAAAH///wAAAAAAAAH///4AAAAAAAAH///4AAAAAAAAH///8AAAAAAAAH///+AAAAAAAAH////AAAAAAAAf////AAAAAAAD/////gAAAAAAf/////gAAAAAP////v/wAAAAB/////n/4AAAAH/////x/4AAAAf/////w/8AAAB//////wf8AAAH//////wP+AAAP//////wD/AAA///////wA/AAB///////wAPAAD///////wADAAP///////wACAAf///////wAAAB////////wAAAD////////wAAAH////////wAAAH////////gAAAP////////gAAAf////////gAAAf////////AAAA/////////AAAA////////+AAAB////////+AAAB////////8AAAD////////4AAAH////////wAAAP////////wAAAP////////AAAAf///////+AAAAf///////8AAAAf///////4AAAAf///////gAAAA////////AAAAA///////8AAAAAf//////4AAAAAf//////wAAAAAf//////AAAAAAf/////+AAAAAAf/////4AAAAAAf/////4AAAAAAf////54AAAAAAP////g8AAAAAAP///4A8AAAAAAf/4B8AeAAAAAAf+AB4A/gAAAAAf+AB8B//wAAAA/4AA8B//8AAAA/gAA8Af/+AAAAQAAAcAf/wAAAAAAAAeAf/gAAAAAAAAeAP/gAAAAAAAAf///gAAAAAAAA//8AgAAAAAAAAf/4AAAAAAAAAAP/4AAAAAAAAAAP/4AAAAAAAAAAH/8AAAAAAAAAAD/8AAAAAAAAAAB+AAAAAAAAAAAA8AAAAAAAAAAAAMAAAAAAAA==","h":93,"w":78},"pelecanus-occidentalis":{"bits":"AAAH8AAAAAAAAB/8AAAAAAAAP//AAAAAAAB//+AAAAAAAP//4AAAAAAA///gAAAAAAD//+AAAAAAAf//wAAAAAAB///AAAAAAAH//8AAAAAAAf//wAAAAAAB///AAAAAAAP//4AAAAAAA///gAAAAAAH//8AAAAAAAf//wAAAAAAD///AAAAAAAP//4AAAAAAB///gAAAAAAH//8AAAAAAA///gAAAAAAD//+AAAAAAAf//wAAAAAAB//+AAAAAAAP//gAAAAAAA//+AAAAAAAH//wAAAAAAAf/+AAAAAAAD//wAAAAAAAP//AAAAAAAA//8AAAAAAAH//x4AAAAAA///P8AAAAAD////8AAAAAP7///4AAAAB/f///4AAAAH9////4AAAA/n////4AAAD8f////4AAAfh/////4AAB8H/////wAAPgf/////gAA8B//////AADgH/////+AAOAf/////+AAAB//////8AAAH//////4AAAf//////wAAA///////gAAD///////AAAH//////8AAAf//////4AAA///////wAAD///////AAAH//////+AAAf//////4AAA///////wAAB///////AAAD//////8AAAH//////4AAAH//////gAAAP//////AAAAf/////8AAAA//////4AAAB//////gAAAD/////+AAAAH/////4AAAAP/////gAAAAP////+AAAAAf////8AAAAAf////wAAAAB/////AAAAAP////8AAAAA8f///wAAAAHg////AAAAD+D///8AAAf/4PH//gAAD//48AH+AAAB//ngAP8AAAH/+eAA/wAAA//BwAB/AAADnuPAAD8AAAIE//AAHgAAAA//4AAEAAAAH//AAAAAAAAH/4AAAAAAAAf/AAAAAAAAD/4AAAAAAAAP/AAAAAAAAB/4AAAAAAAAEPAAAAAAAAAAYAAAAAAAAABAAAAA","h":93,"w":64},"perisoreus-canadensis":{"bits":"AAH/AAAAAAAAAAAAAH//AAAAAAAAAAAAB///gAAAAAAAAAAA////gAAAAAAAAAAf///8AAAAAAAAAAD///+AAAAAAAAAAA////wAAAAAAAAAAH////AAAAAAAAAAB////4AAAAAAAAAA/////gAAAAAAAAAf////+AAAAAAAAAH/////wAAAAAAAAA//////AAAAAAAAAAH////+AAAAAAAAAAf////8AAAAAAAAAB/////4AAAAAAAAAH/////wAAAAAAAAA//////AAAAAAAAAD/////8AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAf//////gAAAAAAAD//////+AAAAAAAAf//////4AAAAAAAD///////gAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAA///////+AAAAAAAH///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAP///////4AAAAAAB////////AAAAAAAH///////8AAAAAAAf///////gAAAAAAB///////+AAAAAAAH///////wAAAAAAAf//////+AAAAAAAB///////4AAAAAAAH///////gAAAAAAAf//////+AAAAAAAB///////4AAAAAAAD///////gAAAAAAAP//////+AAAAAAAAf//////4AAAAAAAH///////AAAAAAAA///////8AAAAAAAH///////AAAAAAAB4//////4AAAAAAAPD/8A//8AAAAAAAAx/PgA//wAAAAAAAH/wAAB//AAAAAAAA/sAAAD/4AAAAAAAH/AAAAD/gAAAAAAB/+AAAAP+AAAAAAAPj4AAAB/4AAAAAAA4PAAAAH/gAAAAAAHAYAAAAf+AAAAAAA4HAAAAD/wAAAAAAHAgAAAAP/AAAAAAAYAAAAAA/8AAAAAABAAAAAAD/wAAAAAAIAAAAAAf/AAAAAABAAAAAAB/8AAAAAAIAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAD4A=","h":85,"w":93},"petrochelidon-fulva":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//gAAAAAAAAAAAD//+AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAH///8AAAAAAAAAAB////wAAAAAAAAAAP///+AAAAAAAAAAAH///4AAAAAAAAAAAf///gAAAAAAAAAAD////AAAAAAAAAAAP///+AAAAAAAAAAB////8AAAAAAAAAAP////4AAAAAAAAAA/////wAAAAAAAAAH/////AAAAAAAAAA/////+AAAAAAAAAP/////4AAAAAAAAB//////wAAAAAAAAP//////AAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAB///////gAAAAAAAP///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAA////////gAAAAAAD///////+AAAAAAAf///////8AAAAAAB////////wAAAAAAP////////gAAAAAA/////////gAAAAAD/////////AAAAAAP////////+AAAAAA/////////8AAAAAD/////////8AAAAAP//////////AAAAA///////////gAAAD///////////wAAAH///////////gAAAf/////////7wAAAA///////+H/wAAAAA///////8D/wAAAAP///+f//4B/gAAAP///8Af//wA8AAAP/I/4AAf//gAAAAD/+B/AAAP//AAAAAfjQ/4AAAH/8AAAAC4CfgAAAAD/wAAAAfgPgAAAAAA+AAAAB8P/gAAAAAAAAAAAFz+/AAAAAAAAAAAAwXg4AAAAAAAAAAAHC8DAAAAAAAAAAAAAfgAAAAAAAAAAAAAA8AAAAAAAAAAAAAAM4AAAAAAAAAAAAABgAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":64,"w":93},"petrochelidon-pyrrhonota":{"bits":"AAP8AAAAAAAAAAAAAH/4AAAAAAAAAAAAD//wAAAAAAAAAAAB///gAAAAAAAAAAAP//+AAAAAAAAAAAD///4AAAAAAAAAAA////gAAAAAAAAAAP///+AAAAAAAAAAf////wAAAAAAAAAH/////AAAAAAAAAAP////4AAAAAAAAAAH////gAAAAAAAAAAf///8AAAAAAAAAAD////gAAAAAAAAAAf///+AAAAAAAAAAD////8AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAf////8AAAAAAAAAD/////4AAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAB//////4AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAH///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAf///////AAAAAAAB///////8AAAAAAAP///////wAAAAAAB///////+AAAAAAAH///////4AAAAAAA////////gAAAAAAD///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAA////////wAAAAAAD////////AAAAAAAP///////4AAAAAAA////////gAAAAAAD///////8AAAAAAAP///////wAAAAAAA///////+AAAAAAAD///////wAAAAAAAP///////AAAAAAAA///////8AAAAAAAB///////wAAAAAAAH///////AAAAAAAB///////8AAAAAAAf///////wAAAAAAD3///////AAAAAAAef//////8AAAAAAD53//////wAAAAAAPG///////gAAAAAAZnv/////+AAAAAABw8/3////4AAAAAAAHjgP////wAAAAAAA+MA/////AAAAAAAA9gD////8AAAAAAAHoAH////4AAAAAAAAAAf////gAAAAAAAAAB////+AAAAAAAAAAH////8AAAAAAAAAAP////wAAAAAAAAAA/////gAAAAAAAAAD////+AAAAAAAAAAP/7//4AAAAAAAAAB//n//AAAAAAAAAAH/+P+AAAAAAAAAAAf/wf4AAAAAAAAAAD//AfgAAAAAAAAAAP/8A+AAAAAAAAAAA//gAwAAAAAAAAAAH/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAD//gAAAAAAAAAAAAPz8AAAAAAAAAAAAB+HwAAAAAAAAAAAAHwfAAAAAAAAAAAAAeB8AAAAAAAAAAAAD4DwAAAAAAAAAAAAPAHAAAAAAAAAAAAB4AcAAAAAAAAAAAAHABwAAAAAAAAAAAAcAGAAAAAAAAAAAADgA4AAAAAAAAAAAAMADgAAAAAAAAAAAAAAMA=","h":92,"w":93},"peucaea-aestivalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAAf//8AAAAAAAAAAAH//+AAAAAAAAAAAB///wAAAAAAAAAAAf//+AAAAAAAAAAAP///wAAAAAAAAAAP///+AAAAAAAAAAH////gAAAAAAAAAH////8AAAAAAAAAB/////gAAAAAAAAA/////8AAAAAAAAAP/////gAAAAAAAAH/////8AAAAAAAAB//////gAAAAAAAA//////8AAAAAAAAf//////gAAAAAAAH//////8AAAAAAAD///////gAAAAAAA///////8AAAAAAAP///////AAAAAAAH///////4AAAAAAH///////+AAAAAAf////////wAAAAP/////////8AAAD///////////AAAf///////////4AB////////////+AB/////////////gAP////////////8AAP///x////////AAH///gB///////wAA//+AAA//////8AAD/4AAAA//////AAAHgAAAAP/////wAAAAAAAAD/////4AAAAAAAAAf////+AAAAAAAAAH/////4AAAAAAAAAcf////gAAAAAAAAAA////8AAAAAAAAAAD//4dwAAAAAAAAAAA/4BmAAAAAAAAAAAAPwMgAAAAAAAAAAABfgAAAAAAAAAAAAAA/AAAAAAAAAAAAAAB/wAAAAAAAAAAAAB//gAAAAAAAAAAAA//+AAAAAAAAAAAAPg/4AAAAAAAAAAABgA/gAAAAAAAAAAAMADkAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":59,"w":93},"peucaea-cassinii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAP//4AAAAAAAAAAAD///gAAAAAAAAAAA///+AAAAAAAAAAAf///4AAAAAAAAAAH////gAAAAAAAAAB////+AAAAAAAAAAD////4AAAAAAAAAAH////gAAAAAAAAAA////+AAAAAAAAAAH////8AAAAAAAAAAf////8AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAD//////AAAAAAAAAP/////8AAAAAAAAB//////4AAAAAAAAP//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAP///////AAAAAAAB///////8AAAAAAAP///////wAAAAAAA////////AAAAAAAH///////8AAAAAAA////////4AAAAAAH////////gAAAAAAf///////+AAAAAAD////////wAAAAAAP////////AAAAAAA////////8AAAAAAH////////gAAAAAAf///////+AAAAAAB////////4AAAAAAH////////gAAAAAAf///////+AAAAAAB////////4AAAAAAH////////gAAAAAAf///////+AAAAAAA///////+gAAAAAAB///////8AAAAAAAD///////wAAAAAAAH///////AAAAAAAf///+A//8AAAAAAH////wA//4AAAAAA/3+f8AB//gAAAAAP4A/wAAB/+AAAAADeAH4AAAH/4AAAAAbAD84AAAf/wAAAADYD//wAAB//AAAAABP//yAAAH/8AAAAAD/4AAAAAf/wAAAAAT+AAAAAB//gAAAAB7gAAAAAD/+AAAAAe4AAAAAAP/4AAAAHnAAAAAAA//gAAABgwAAAAAAD/+AAAAMDgAAAAAAP/4AAAAAMAAAAAAA//gAAAAAAAAAAAAD/8AAAAAAAAAAAAAP+AAAAAAAAAAAAAAf4AAAAAAAAAAAAAB/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":69,"w":93},"phainopepla-nitens":{"bits":"ACAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAPwAAAAAAAAAAAAAB/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAA/gAAAAAAAAAAAAAH8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAD/+AAAAAAAAAAAAA//4AAAAAAAAAAAAH//gAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAAf///gAAAAAAAAAAH///+AAAAAAAAAAAD///wAAAAAAAAAAAP///AAAAAAAAAAAA///+AAAAAAAAAAAH///+AAAAAAAAAAA////8AAAAAAAAAAH////4AAAAAAAAAA/////wAAAAAAAAAH/////gAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAAf//////8AAAAAAAD///////4AAAAAAAf///////gAAAAAAB///////8AAAAAAAP///////wAAAAAAA////////AAAAAAAH///////4AAAAAAAf///////gAAAAAAB///////+AAAAAAAH///////4AAAAAAAf///////gAAAAAAB///////+AAAAAAAH///////8AAAAAAAf///////4AAAAAAA////////wAAAAAAD////////gAAAAAAH////////gAAAAAAP///v///+AAAAAAAf//wA///+AAAAAAA//wAAD//8AAAAAAf/+AAAH//4AAAAAH//gAAAP//wAAAAA9+QAAAA///AAAAAH/AAAAAB///AAAAAfYAAAAAH//8AAAAP/AAAAAAP//4AAAB/4AAAAAAf//gAAAPHgAAAAAB//+AAAB9cAAAAAAD//4AAAH7AAAAAAAH//AAAA/QAAAAAAAf/wAAABwAAAAAAAA/8AAAAHwAAAAAAABgAAAAAMAAAAAAAAAAA==","h":70,"w":93},"phalacrocorax-auritus":{"bits":"ADwAAAAAAAfgAAAAD/f/OAAAA////wAAAP///8AAAAH//+AAAAAP//AAAAAB//wAAAAAP/+AAAAAA//gAAAAAH/4AAAAAAf+AAAAAAD/gAAAAAA/4AAAAAAH+AAAAAAD/gAAAAAA/4AAAAAAf+AAAAAAP/gAAAAAH/wAAAAAD/8AAAAAB/+AAAAAAf/gAAAAAP/wAAAAAD/4AAAAAB/+AAAAAAf/wAAAAAH//gAAAAB//8AAAAAf//wAAAAH//+AAAAB///4AAAAf///AAAAH///4AAAA////AAAAP///4AAAB////AAAAf///4AAAH////AAAA////wAAAP///+AAAD////wAAA////8AAAH////gAAB////4AAAf////AAAD////wAAA////+AAAH////gAAB////4AAAP////AAAD////wAAAf///8AAAH////gAAA////4AAAH///+AAAB////gAAAP///8AAAB////AAAAf///wAAAD///8AAAA////AAAAP///wAAAD///8AAAAf///AAAAH///wAAAB///8AAAAP///AAAAD///wAAAN///8AAB/////AAAf////wAAP//k/4AAH/9AP/AAB/AAD/wAAAAAA/+AAAAAAP/gAAAAAD/8AAAAAA//AAAAAAP/4AAAAAD/+AAAAAA//wAAAAAH/8AAAAAB//AAAAAAf/wAAAAAH/8AAAAAA//AAAAAAH/wAAAAAB/8AAAAAAP/AAAAAAB/wAAAAAAH4AAAAAAA+A","h":93,"w":50},"phalaenoptilus-nuttallii":{"bits":"AAA/wAAAAAAAAAAP//AAAAAAAAAA///4AAAAAAAAZ///+AAAAAAAPv////gAAAAAAD/////wAAAAAA//////4AAAAAAD/////8AAAAAAH/////+AAAAAAP//////AAAAAAf//////gAAAAAf//////gAAAAAD//////wAAAAAH//////4AAAAAG//////8AAAAAA//////+AAAAAA///////AAAAAAf//////gAAAAAf//////wAAAAAf//////4AAAAAf//////8AAAAA///////+AAAAA////////gAAAA////////wAAAB////////4AAAB////////4AAAB////////8AAAB////////+AAAB/////////AAAD/////////gAAD/////////gAAD/////////wAAD/////////wAAD/////////4AAD/////////4AAD/////////8AAD/////////8AAB/////////+AAB//////////AAB//////////AAA//////////gAA//////////gAAf/////////wAAf/////////wAAf/////////wAAP/////////4AAP/////////4AAH/////////8AAD/////////8AAD/////////8AAB/////////8AAA/////////8AAAf////////+AAAP////////+AAAH////////+AAAD////////+AAAB////////+AAAAf///////8AAAAP///////+AAAAD////////AAAAD////////AAAAH////////gAAAHn///////wAAAPx///////wAAAH////////4AAAH////////8AAAHz///////8AAAD/4d/////+AAAA/+MD////+AAAAD/sB/////AAAAD/IA/////AAAAD+AAP////AAAAAfgAH///4AAAAAGAAH//hwAAAAAAAAH//wAAAAAAAAAH//wAAAAAAAAAD//wAAAAAAAAAD//4AAAAAAAAAD//4AAAAAAAAAB//4AAAAAAAAAB//4AAAAAAAAAB//8AAAAAAAAAA//8AAAAAAAAAA//8AAAAAAAAAAf/+AAAAAAAAAAf/+AAAAAAAAAAP/+AAAAAAAAAAH/+AAAAAAAAAAD/+AAAAAAAAAAAf/AAAAAAAAAAAP+AAAAAAAAAAAH+AAAAAAAAAAAA8AA==","h":93,"w":78},"phalaropus-fulicarius":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAD//wAAAAAAAAAAAA///AAAAAAAAAAAAH//4AAAAAAAAAAAA///gAAAAAAAAAAAH//8AAAAAAAAAAAA///wAAAAAAAAAAAf//+AAAAAAAAAAAP///wAAAAAAAAAAH////AAAAAAAAAAD////4AAAAAAAAAB/z///wAAAAAAAAAPgf///4AAAAAAAAAAH////8AAAAAAAAAB/////8AAAAAAAAAf/////8AAAAAAAAD//////4AAAAAAAA///////wAAAAAAAH///////gAAAAAAA////////AAAAAAAP///////8AAAAAAB////////wAAAAAAP////////gAAAAAB////////+AAAAAAf////////4AAAAAD/////////gAAAAAf////////+AAAAAD/////////8AAAAAP/////////4AAAAB//////////wAAAAP//////////8AAAB////////////AAAH////////////+AA/////////////8AH/////////////AAf////////////wAB/////////////gAP////////////4AA/////////////gAD////////////8AAf///////////+AAB///////////AAAAD/////////4AAAAAP////////4AAAAAA////////8AAAAAAB///////gAAAAAAAD//////wAAAAAAAAH////+AAAAAAAAAAH////AAAAAAAAAAAH//8AAAAAAAAAAAAD/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAA/wAAAAAAAAAAAAAH8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAH8AAAAAAAAAAAAAA/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAB/AAAAAAAAAAAAAPv4AAAAAAAAAAAAB//AAAAAAAAAAAAB//+AAAAAAAAAAAAf//wAAAAAAAAAAAA//gAAAAAAAAAAAH//uAAAAAAAAAAAB//4AAAAAAAAAAAAAA8AAAAAAAAAAAAAAfAAAAAAAAAAAAAAHgAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":76,"w":93},"phalaropus-lobatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAB///8AAAAAAAAAAAP////AAAAAAAAAAB/////gAAAAAAAAAP/////gAAAAAAAAD//////gAAAAAAAA///////gAAAAAAAP///////AAAAAAAH///////+AAAAAAB////////4AAAAAA+H///////wAAAAAfA////////gAAAAHgP///////+AAAABwB////////8AAAAAAP////////4AAAAAB/////////wAAAAAP/////////wAAAAB//////////wAAAAP//////////4AAAB///////////4AAAH////////////gAA////////////8AAH///////////+AAAf///////////8AAB////////////gAAP/////////f/wAAA+AAAA//+AH8AAAADAAAAAAAAPwAAAAAMAAAAAAADwAAAAAA4AAAAAAA4AAAAAABgAAAAAB8AAAAAAADAAAAAD8AAAAAAAAHAAAAB4AAAAAAAAAOAAAAcAAAAAAAAAAfAAA+AAAAAAAAAAAfAD/AAAAAAAAAAAAOH/AAAAAAAAAAAAAbwwAAAAAAAAAAAAB8OAAAAAAAAAAAAAHBwAAAAAAAAAAAAA4MAAAAAAAAAAAAAHBgAAAAAAAAAAAAA4cAAAAAAAAAAAAAGDgAAAAAAAAAAAAD8eAAAAAAAAAAAAP//wAAAAAAAAAAAB//4AAAAAAAAAAAAAcOAAAAAAAAAAAABjvgAAAAAAAAAAAAOfwAAAAAAAAAAAfA/wAAAAAAAAAAAA+D4AAAAAAAAAAAAB//wAAAAAAAAAAAAB/+AAAAAAAAAAAAH/+QAAAAAAAAAAAA/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":64,"w":93},"phalaropus-tricolor":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/gAAAAAAAAAAAAAf/AAf8AAAAAAAAAH/8B///wAAAAAAAA//w////4AAAAAAAP//f////4AAAAAAB////////8AAAAAAP////////+AAAAAD////////////wAA////////////+AAP////////////wAH3///////////4AD4D//////////8AA8AP//////////AAeAA///////////gHAAH///////////hgAAf//////////8AAAB////////gP/gAAAP///////wPwAAAAA///////4PAAAAAAD///////BgAAAAAAH//////5wAAAAAAAP//////4AAAAAAAAf/////8AAAAAAAAA/////2AAAAAAAAAB////zgAAAAAAAAAD////wAAAAAAAAAAD///wAAAAAAAAAAAAf/OAAAAAAAAAAAAADg4AAAAAAAAAAAAPMDgAAAAAAAAAAAD//8AAAAAAAAAAAA///AAAAAAAAAAAAPPwAAAAAAAAAAAAD/8AAAAAAAAAAAAAfwAAAAAAAAAAAAAH8AAAAAAAAAAAAAA/0AAAAAAAAAAAAAH/AAAAAAAAAAAAAAbwAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":44,"w":93},"phasianus-colchicus":{"bits":"AAAAAAAeAAAAAAAB/gAAAAAAB/8AAAAAAH/8AAAAAAP/8AAAAAAP/4AAAAAAA/4AAAAAAA/8AAAAAAAf8AAAAAAAf8AAAAAAA/8AAAAAAA/8AAAAAAB/+AAAAAAD/+AAAAAAP/+AAAAAAf//AAAAAB///AAAAAH///AAAAAP///AAAAAf///AAAAA////AAAAB////AAAAD////AAAAH////AAAAP////AAAAf////AAAAf///+AAAA////+AAAA////+AAAB////8AAAB////4AAAD////4AAAD////wAAAD////wAAAH////gAAAH////AAAAH///+AAAAH///8AAAAH///4AAAAP///4AAAAP///wAAAAP///gAAAAP///gAAAAf/vfAAAAAf/DPAAAAA//DGAAAAB/+HGAAAAB/8HGAAAAD/4DHAAAAH/4D/AAAAH/wH/AAAAP/gP/4AAAP/gb//wAAf/AYP+AAAf+AAf+AAA/+AAQfgAA/8AAAAAAB/8AAAAAAB/wAAAAAAD/wAAAAAAD/wAAAAAAH/AAAAAAAH+AAAAAAAP+AAAAAAAP8AAAAAAAf8AAAAAAAf4AAAAAAA/wAAAAAAA/wAAAAAAA/gAAAAAAB/gAAAAAAB/gAAAAAAD+AAAAAAAD+AAAAAAAD8AAAAAAAH8AAAAAAAH8AAAAAAAH4AAAAAAAPwAAAAAAAPwAAAAAAAPgAAAAAAAfgAAAAAAAdgAAAAAAAdAAAAAAAAZAAAAAAAAZAAAAAAAA5AAAAAAAAwAAAAAAAAwAAAAAAAAgAAAAAAAAgAAAAAAAAgAAAAAAAAgAAAAAAAAA==","h":93,"w":54},"pheucticus-ludovicianus":{"bits":"AAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAA/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAA///+AAAAAAAAAAAP///4AAAAAAAAAAH////gAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAA/////AAAAAAAAAAB////4AAAAAAAAAAH////gAAAAAAAAAAf///+AAAAAAAAAAB////+AAAAAAAAAAP////8AAAAAAAAAA/////4AAAAAAAAAH/////wAAAAAAAAA//////gAAAAAAAAH//////AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////+AAAAAAAA///////4AAAAAAAH///////gAAAAAAA////////AAAAAAAH///////8AAAAAAA////////4AAAAAAH////////gAAAAAAf///////+AAAAAAD////////4AAAAAAf////////gAAAAAB////////+AAAAAAP////////4AAAAAB/////////gAAAAAH////////8AAAAAAf////////wAAAAAD/////////AAAAAAP////////4AAAAAA/////////gAAAAAD/////////AAAAAAP////////8AAAAAA/////////wAAAAAD/////////AAAAAAH////wf//8AAAAAAf///wAf//wAAAAAA///8AAP//AAAAAAB///APA//4AAAAAAD//gH8D/+AAAAAAD//wP84P/wAAAAAB///hwBw/+AAAAAAP/4PMADz/wAAAAAB4Hn/gAD//AAAAAAPAL8QAAD/+AAAAAB8D+AAAAD/4AAAAAPg/8AAAAH/gAAAAA/f/4AAAAf+AAAAABz4fgAAAB/4AAAAAAfAUAAAAH/wAAAAAD4AgAAAAf/AAAAAAPgAAAAAB/8AAAAAA8AAAAAAH/wAAAAADsAAAAAAP/AAAAAAPAAAAAAA/8AAAAAAAAAAAAAD/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/gAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":72,"w":93},"pheucticus-melanocephalus":{"bits":"AAf4AAAAAAAAAAAB//gAAAAAAAAAAB//8AAAAAAAAAAD///AAAAAAAAAAH///wAAAAAAAAAH///8AAAAAAAAAP////AAAAAAAAAP////wAAAAAAAAP////4AAAAAAAAH////+AAAAAAAAA/////gAAAAAAAAP////wAAAAAAAAB////8AAAAAAAAAf///+AAAAAAAAAP////gAAAAAAAAH////4AAAAAAAAD/////AAAAAAAAA/////wAAAAAAAAf////+AAAAAAAAP/////gAAAAAAAH/////8AAAAAAAD//////AAAAAAAB//////wAAAAAAA//////8AAAAAAAf//////AAAAAAAP//////wAAAAAAH//////8AAAAAAD///////AAAAAAB///////wAAAAAA///////4AAAAAAf//////+AAAAAAP///////gAAAAAH///////4AAAAAD///////+AAAAAB////////AAAAAAf///////wAAAAAP///////8AAAAAH////////AAAAAB////////wAAAAA////////8AAAAAf///////+AAAAAH////////gAAAAB////////4AAAAA////////8AAAAAP////////AAAAAH////////gAAAAB////////4AAAAAf///////8AAAAAH////////AAAAAB////////gAAAAAf///////4AAAAAH///////8AAAAAB///////+AAAAAAf///////gAAAAAD///////4AAAAAA///////8AAAAAAH///////AAAAAAA///////wAAAAAAH//////8AAAAAAA///////AAAAAAD///////gAAAAAP+H/////4AAAAAH/7+B///+AAAAAHx//Af///AAAAADw//AD///wAAAAAz/gAA//3oAAAAAf8wAAP/94AAAAAP/4AAD/+MAAAAAP38AAAf/gAAAAAHwPAAAH/wAAAAADwBgAAB/4AAAAAB4BwAAAf+AAAAAAcAgAAAH/gAAAAAOAAAAAD/wAAAAAHAAAAAA/8AAAAABgAAAAAP/AAAAAAAAAAAAH/gAAAAAAAAAAAB/4AAAAAAAAAAAAf+AAAAAAAAAAAAH/AAAAAAAAAAAAD/wAAAAAAAAAAAA/8AAAAAAAAAAAAP+AAAAAAAAAAAAD/gAAAAAAAAAAAB/4AAAAAAAAAAAAf8AAAAAAAAAAAAH/AAAAAAAAAAAAB/wAAAAAAAAAAAA/4AAAAAAAAAAAAP+AAAAAAAAAAAAD/gAAAAAAAAAAAAfwAAAAAAAAAAAAB4A=","h":93,"w":85},"pica-hudsonia":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf4AAAAAAAAAAAAAP/wAAAAAAAAAAAAD//wAAAAAAAAAAAA///wAAAAAAAAAAAP///gAAAAAAAAAAD///8AAAAAAAAAAA///+AAAAAAAAAAAP//4AAAAAAAAAAAB//+AAAAAAAAAAAA///gAAAAAAAAAAAf//8AAAAAAAAAAAP///AAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAA////4AAAAAAAAAAP/+f/AAAAAAAAAAD//B/4AAAAAAAAAA//gf/AAAAAAAAAAf/4H/4AAAAAAAAAP/+D//AAAAAAAAAH//B//wAAAAAAAAB/////+AAAAAAAAAf/////gAAAAAAAAH////38AAAAAAAAB////8/AAAAAAAAAf////H4AAAAAAAAH////geAAAAAAAAB////wDgAAAAAAAAf///4AIAAAAAAAAP///4AGAAAAAAAAD///gABgAAAAAAAA///wAAYAAAAAAAAP//+AAGAAAAAAAAD///wABgAAAAAAAA////AAwAAAAAAAAf/h/8AMAAAAAAAAP/wAP4HAAAAAAAAH/8AAf/gAAAAAAAD/+AAA/4AAAAAAAB//gAAH/AAAAAAAAf/wAAA/wAAAAAAAP/8AAAD+AAAAAAAH/+AAAAPwAAAAAAB//gAAAAeAAAAAAA//4AAAAB4AAAAAAf/8AAAAAHgAAAAAH/+AAAAAAeAAAAAD//gAAAAA//AAAAB//wAAAAAP//AAAAf/8AAAAAAWfoAAAH/+AAAAAAB//gAAA//gAAAAAAL/+AAAP/wAAAAAAAAP8AAB4YAAAAAAAAA/wAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":59,"w":93},"pica-nuttalli":{"bits":"AD/AAAAAAAAB//AAAAAAAB//+AAAAAAAf//8AAAAAAD///4AAAAAAP///wAAAAAAP///AAAAAAAB//+AAAAAAAD//4AAAAAAAP//gAAAAAAAf//AAAAAAAB//8AAAAAAAH//4AAAAAAAf//gAAAAAAB///gAAAAAAH///AAAAAAAf//+AAAAAAD///8AAAAAAP///4AAAAAA////wAAAAAD////gAAAAAP////AAAAAA////+AAAAAD////4AAAAAP////wAAAAA/////gAAAAB////+AAAAAH////8AAAAAf////4AAAAB/////wAAAAD/////gAAAAP/////AAAAAf////8AAAAB/////4AAAAD/////gAAAAP/////AAAAAf////8AAAAA/////4AAAAD/////gAAAAH/////AAAAAP////8AAAAAf////wAAAAA/////gAAAAB////+AAAAAD////8AAAAAH////4AAAAAP////gAAAAAf////AAAAAA////8AAAAAD/3//4AAAAAH+P//wAAAAAfwf//AAAAAA+A//+AAAAADwB/7wAAAAAeAD/nAAAABjwAH/EAAAAP/AAf8AAAAD//gB/4AAAAP//gD/gAAABpweAP/AAAAAOAIA/8AAADhwAAB/wAAAf/gAAH/gAAB//8AAf+AAAf+HYAB/8AAD/AAgAD/wAAIAAAAAP/gAAAAAAAA/+AAAAAAAAB/8AAAAAAAAH/wAAAAAAAAf/AAAAAAAAA/+AAAAAAAAD/4AAAAAAAAP/wAAAAAAAAf/AAAAAAAAB/+AAAAAAAAH/4AAAAAAAAP/gAAAAAAAA//AAAAAAAAB/8AAAAAAAAH/4AAAAAAAAH/gAAAAAAAAP+AAAAAAAAA/8AAAAAAAAB/wAAAAAAAAD/gAAAAAAAAH+AAAAAAAAAP4AAAAAAAAAPwAAAAAAAAA/AAAAAAAAAB8AAAAAAAAADwAAAAAAAAAH","h":93,"w":64},"picoides-arcticus":{"bits":"AAAAH/AAAAAP/4AAAAf//AAAA///wAP////8A//////AH/////gAP////gAAf///wAAD///4AAA///8AAAH//+AAAA//+AAAAP//AAAAD//gAAAD//wAAAH//4AAAH//8AAAP//+AAAP///AAAP///wAAP///4AAP///8AAH////AAH////gAH////wAD////4AD////8AB////+AB/////AA/////gAf////wAf////wAP////4AH////8AD////+AD/////AB/////AB/////gA/////wAf////wAf////4AP////8AH////8AH////+AD////+AB////+AA/////AA/////wAf////+AP/////gH/////wD/////4D////+oB////8EA////+GAP///7AAH////gAH///9wAD///84AD///+OQB///vz4B///zwwA///wwAA///4AAAf//4AAAf//4AAAP9/8AAAH8/8AAAH8f+AAAD8P+AAABcD/AAAAcB/gAAAMB/4AAAAA/8AAAAAf+AAAAAP/AAAAAH/gAAAAD/wAAAAB/4AAAAA/4AAAAAf8AAAAAP8AAAAAH8AAAAAH+AAAAAD+AAAAAB/AAAAAB/AAAAAB/AAAAAA+gAAAAAfAAAAAAPAAAAAAEAAAAAA=","h":93,"w":43},"pinicola-enucleator":{"bits":"AAAAAAA/gAAAAAAAH/8AAAAAAAf/+AAAAAAA///AAAAAAB///gAAAAAD///4AAAAAD///8AAAAAH///+AAAAAP////AAAAAP////AAAAAf///4AAAAAf///gAAAAA////gAAAAA////gAAAAB////AAAAAB////AAAAAD////AAAAAH////AAAAAP////AAAAAf////AAAAA/////AAAAA/////gAAAB/////gAAAD/////gAAAH/////gAAAP/////gAAAP/////wAAAf/////wAAA//////wAAA//////gAAB//////gAAB//////gAAD//////gAAD//////gAAH//////gAAP//////AAAf//////AAAf//////AAA//////+AAA//////+AAB//////8AAD//////8AAD//////4AAD//////wAAH//////wAAH//////gAAP//////AAAP//////AAAP/////+AAAP/////8AAAf/////4AAAP/////wAAAf/////AAAA/////+AAAA/////8AAAB///////wAB///////4AD///////8AD7///7vz8AH3///8AT8AHn//9+Af4APH/+v+BPgAOH/+v8B/gAcH/8/wA/gAYP/4fgAPAAYP/wPAAAAAAP/geAAAAAAP/gcAAAAAAP/AAAAAAAAP/AAAAAAAAf/AAAAAAAAf/AAAAAAAA/+AAAAAAAA/+AAAAAAAA/+AAAAAAAB/8AAAAAAAB/8AAAAAAAD/8AAAAAAAD/4AAAAAAAD/4AAAAAAAH/4AAAAAAAH/wAAAAAAAP/wAAAAAAAP/wAAAAAAAP/wAAAAAAAf/gAAAAAAAf/gAAAAAAAf/gAAAAAAA//AAAAAAAA//AAAAAAAA/+AAAAAAAA/cAAAAAAAA8AAAAAAAAAA=","h":93,"w":60},"pipilo-chlorurus":{"bits":"AAAAAAAAAAAP+AAAAAAAAAAAAAH/+AAAAAAAAAAAAD//8AAAAAAAAAAAB///wAAAAAAAAAAAf///AAAAAAAAAAAH///8AAAAAAAAAAB////8AAAAAAAAAAf////4AAAAAAAAAD/////gAAAAAAAAA//////AAAAAAAAAP/////4AAAAAAAAB/////4AAAAAAAAAf////8AAAAAAAAAD////8AAAAAAAAAA/////gAAAAAAAAAH////4AAAAAAAAAB////+AAAAAAAAAAP////wAAAAAAAAAH////8AAAAAAAAAD/////gAAAAAAAAA/////8AAAAAAAAAP/////gAAAAAAAAH/////8AAAAAAAAB//////gAAAAAAAAf/////8AAAAAAAAH//////gAAAAAAAB//////8AAAAAAAAf//////gAAAAAAAH//////8AAAAAAAB///////gAAAAAAAf//////8AAAAAAAH///////gAAAAAAD///////8AAAAAAA////////AAAAAAAH///////4AAAAAAB////////AAAAAAAf///////wAAAAAAH///////+AAAAAAB////////wAAAAAAf///////8AAAAAAD////////gAAAAAA////////4AAAAAAP///////+AAAAAAB////////wAAAAAAf///////8AAAAAAD////////AAAAAAAf///////wAAAAAAD///////8AAAAAAA////////AAAAAAAP///////wAAAAAAD///////8AAAAAAA///////+AAAAAAAP///////gAAAAAAD////////AAAAAAA/////////AAAAAAH////////8AAAAAB3///////BgAAAAAB//wf///8MAAAAAAf/4D/94fAAAAAAAH/4AP+ID4AAAAAAB/+AAj5AAAAAAAAAf/gAAPwAAAAAAAAH/8AAAfg8AAAAAAB//AAAA//wAAAAAAf/wAAD//gAAAAAAH/8AAA///4AAAAAB//AAAH+f/wAAAAAf/wAAAgB4eAAAAAH/8AAAEADgQAAAAB//AAAAAAcAAAAAAP/wAAAAAHgAAAAAD/8AAAAAA4AAAAAA//gAAAAAAAAAAAAP/wAAAAAAAAAAAAD/+AAAAAAAAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAD/+AAAAAAAAAAAAAf/gAAAAAAAAAAAAH94AAAAAAAAAAAAA8AAAAAAAAAAAAAAA","h":81,"w":93},"pipilo-erythrophthalmus":{"bits":"AAAAAAAAAP+AAAAAAAAAAD/+AAAAAAAAAAf/+AAAAAAAAAD//8AAAAAAAAAf//4AAAAAAAAD///wAAAAAAAAf///AAAAAAAAH///+AAAAAAAA////4AAAAAAAH////wAAAAAAAD////AAAAAAAAD///+AAAAAAAAH///4AAAAAAAAP///gAAAAAAAA///+AAAAAAAAD///4AAAAAAAAf///wAAAAAAAP////AAAAAAAB////8AAAAAAAf////gAAAAAAH/////AAAAAAA/////8AAAAAAP/////wAAAAAB//////AAAAAAP/////8AAAAAB//////wAAAAAP//////AAAAAB//////8AAAAAP//////wAAAAA///////AAAAAP//////8AAAAB///////wAAAAP///////AAAAB///////8AAAAP///////gAAAA///////+AAAAH///////4AAAA////////AAAAH///////8AAAAf///////gAAAD///////+AAAAP///////wAAAB////////AAAAH///////4AAAA////////AAAAD///////8AAAAf///////gAAAB///////8AAAAH///////gAAAAf//////8AAAAD///////gAAAAf//////8AAAAD///////QAAAAf///////4AAAD////////gAAAP////////AAAB+/////8f8AAAHj////+D/wAAA8f////AP/AAADD///v+A/8AAAAP//4H8D/AAAAB//4B/wP8AAAAP/+AP/gPgAAAB//wA/8B8AAAAH/+AD/wBgAAAA//4AP+AAAAAAH//AA/gAAAAAA//8AB+AAAAAAD//gAPwAAAAAAf/8AA8AAAAAAD//wAAAAAAAAAP/+AAAAAAAAAB//4AAAAAAAAAP//AAAAAAAAAB//8AAAAAAAAAH//gAAAAAAAAA//8AAAAAAAAAH//wAAAAAAAAAf/+AAAAAAAAAD//4AAAAAAAAAf//AAAAAAAAAB//8AAAAAAAAAP//gAAAAAAAAB//8AAAAAAAAAH//wAAAAAAAAA//+AAAAAAAAAH//4AAAAAAAAAf//AAAAAAAAAD//4AAAAAAAAAP//AAAAAAAAAA//4AAAAAAAAAD/+AAAAAAAAAAP7wAAAAAAAAAAA=","h":93,"w":76},"pipilo-maculatus":{"bits":"AAPwAAAAAAAAAAAAAP/wAAAAAAAAAAAAD//gAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAf///wAAAAAAAAAAP////AAAAAAAAAAD////8AAAAAAAAAA/////wAAAAAAAAAD////+AAAAAAAAAAD////4AAAAAAAAAAH////gAAAAAAAAAA////8AAAAAAAAAAH////wAAAAAAAAAA////+AAAAAAAAAAH////8AAAAAAAAAAf////4AAAAAAAAAD/////wAAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAf/////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAA///////+AAAAAAAH///////4AAAAAAA////////gAAAAAAH///////+AAAAAAA////////4AAAAAAH////////gAAAAAAf///////+AAAAAAD////////4AAAAAAf////////AAAAAAB////////8AAAAAAP////////gAAAAAA////////+AAAAAAH////////4AAAAAAf////////AAAAAAD////////8AAAAAAP////////wAAAAAB////////+AAAAAAH////////wAAAAAAf////////AAAAAAB////////4AAAAAAH////////AAAAAAAf///////8AAAAAAB////////gAAAAAAD///////+AAAAAAAP///////4AAAAAAA////////AAAAAAAP///////8AAAAAAD////////gAAAAAA////////8AAAAAAP/H//////wAAAAAB+8H//////AAAAAAH3g///n//4AAAAAA/4D//4f//gAAAAAD/Af//A//8AAAAAAPwB//8D//gAAAAAA4ADw/gH/8AAAAAAHAAYB+AP/wAAAAAAcAHAHwA//AAAAAAAAAAAMAD/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//gAAAAAAAAAAAAD/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//gAAAAAAAAAAAAH/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAH/8AAAAAAAAAAAAA//wAAAAAAAAAAAAD//AAAAAAAAAAAAAP/8AAAAAAAAAAAAA//wAAAAAAAAAAAAH/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAB//gAAAAAAAAAAAAH/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAD//AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//AAAAAAAAAAAAAD/wAAAAAAAAAAAAAGAA=","h":92,"w":93},"piranga-flava":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//wAAAAAAAAAAAD///gAAAAAAAAAAB///+AAAAAAAAAAA////4AAAAAAAAAAP////gAAAAAAAAAB////+AAAAAAAAAAA////4AAAAAAAAAAB////gAAAAAAAAAAH////gAAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAAP/////gAAAAAAAAB//////AAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAD///////AAAAAAAAP//////8AAAAAAAB///////4AAAAAAAH///////gAAAAAAA///////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAB///////+AAAAAAAP///////4AAAAAAA////////AAAAAAAD///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////8AAAAAAB////////wAAAAAAD///////+AAAAAAAP///////QAAAAAAAf//////8AAAAAAAA///////gAAAAAAAB//////8AAAAAAAAf//////wAAAAAAAD////n//AAAAAAAAcc//gP/8AAAAAAADDh8AAP/wAAAAAAAYcPgAAP/AAAAAAADiH4AAAf8AAAAAAAMT8AAAB/4AAAAAABj8AAAAH/gAAAAAAE+AAAAAf+AAAAAAA/AAAAAB/4AAAAAAP4AAAAAH/gAAAAAD/wAAAAAf+AAAAAAeOAAAAAB/4AAAAADhwAAAAAH/gAAAAAcOAAAAAAf+AAAAADhgAAAAAB/4AAAAAcIAAAAAAH/AAAAABhAAAAAAAf8AAAAAGIAAAAAAA/gAAAAAxAAAAAAAD4AAAAACAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":65,"w":93},"piranga-ludoviciana":{"bits":"AAf4AAAAAAAAAAAAAP/4AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAD///8AAAAAAAAAAB////wAAAAAAAAAA/////AAAAAAAAAAH////8AAAAAAAAAAD////gAAAAAAAAAAH///+AAAAAAAAAAAf///4AAAAAAAAAAB////8AAAAAAAAAAH////8AAAAAAAAAAf////8AAAAAAAAAD/////4AAAAAAAAAP/////wAAAAAAAAB//////gAAAAAAAAP/////+AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////gAAAAAAAH///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAf///////gAAAAAAD///////+AAAAAAAP///////4AAAAAAB////////gAAAAAAP///////+AAAAAAA////////4AAAAAAH////////gAAAAAAf///////+AAAAAAB////////4AAAAAAP////////wAAAAAA/////////AAAAAAD////////+AAAAAAP////////4AAAAAA/////////gAAAAAB////////sAAAAAAH///////+AAAAAAAP///////4AAAAAAAf///////wAAAAAAA////////gAAAAAAA///+D//+AAAAAAAD//+AB//8AAAAAAD+f+AAA//wAAAAAA/+/AAAA//gAAAAAPv/wAAAD/+AAAAAD4D8AAAAH/8AAAAAeB8AAAAAf/wAAAADg+AAAAAB//AAAAAOfAAAAAAH/8AAAABv/gAAAAAP/wAAAAH/+AAAAAA//AAAAB+DwAAAAAB/4AAAAPgEAAAAAAH8AAAAB4AAAAAAAAPgAAAAOAAAAAAAAA4AAAAAwAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAcAAAAAAAAAAA=","h":61,"w":93},"piranga-olivacea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAA///AAAAAAAAAAAAP//8AAAAAAAAAAAD///wAAAAAAAAAAD////AAAAAAAAAAB////8AAAAAAAAAAf////wAAAAAAAAAH/////AAAAAAAAAB/////8AAAAAAAAAA/////wAAAAAAAAAA/////AAAAAAAAAAH/////AAAAAAAAAA/////8AAAAAAAAAD/////4AAAAAAAAAf/////wAAAAAAAAD//////AAAAAAAAAP/////+AAAAAAAAB//////4AAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAD//////4AAAAAAAAf//////gAAAAAAAD//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAP//////+AAAAAAAB///////8AAAAAAAH///////wAAAAAAA////////AAAAAAAD///////8AAAAAAAf///////wAAAAAAB///////+AAAAAAAP///////4AAAAAAA////////gAAAAAAH///////+AAAAAAAf///////wAAAAAAB////////AAAAAAAH///////8AAAAAAAf///////gAAAAAAB///////+AAAAAAAH///////wAAAAAAAf///////AAAAAAAA///////4AAAAAAAD///////AAAAAAAAH//////8AAAAAAAAf//////wAAAAAAAA///////AAAAAAAAf//////4AAAAAAAD///////gAAAAAAB///////+AAAAAAAPh//////4AAAAAAA5///////AAAAAAAP//f///+8AAAAAAB/9Y8H//xwAAAAAAP//AAP//EAAAAAAA+DwAA//4AAAAAAAHwPAAD//gAAAAAAAeA4AAH/+AAAAAAAD4DAAAf/wAAAAAAAf44AAA//AAAAAAAB/EAAAB/8AAAAAAAHgAAAAH/gAAAAAAAcAAAAAf+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAB7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":89,"w":93},"piranga-rubra":{"bits":"AAAAAAAAAA/wAAAAAAAAAAAH/+AAAAAAAAAAAf//gAAAAAAAAAA///wAAAAAAAAAB///8AAAAAAAAAD////AAAAAAAAAH////4AAAAAAAAP////8AAAAAAAAf////+AAAAAAAAf/////AAAAAAAA/////4AAAAAAAB////+AAAAAAAAD////4AAAAAAAAH////wAAAAAAAAP////AAAAAAAAA////+AAAAAAAAB////8AAAAAAAAH////8AAAAAAAAP////4AAAAAAAAf////4AAAAAAAA/////wAAAAAAAB/////wAAAAAAAD/////wAAAAAAAH/////wAAAAAAAP/////wAAAAAAAP/////gAAAAAAAf/////gAAAAAAA//////gAAAAAAB//////gAAAAAAD//////gAAAAAAD//////AAAAAAAH//////AAAAAAAP//////AAAAAAAf/////+AAAAAAAf/////+AAAAAAA//////8AAAAAAB//////8AAAAAAB//////4AAAAAAD//////wAAAAAAH//////wAAAAAAH//////gAAAAAAP//////AAAAAAAP//////AAAAAAAf/////+AAAAAAAf/////4AAAAAAA//////wAAAAAAA//////gAAAAAAA//////AAAAAAAB/////+AAAAAAAB//////AAAAAAAB//////wAAAAAAB//////wAAAAAAB//////4AAAAAAD////+/4AAAAAAD//////4AAAAAAH////Hv4AAAAAAP///8G/wAAAAAAP///gGfgAAAAAAf///ACDgAAAAAAf//3gAPAAAAAAA///jwAAAAAAAAB///B8AAAAAAAAB///A+AAAAAAAAD3/+B+AAAAAAAADv/8H/gAAAAAAACP/4PvgAAAAAAAAf/wf/AAAAAAAAAf/gZ/AAAAAAAAA//Af8AAAAAAAAB/+AL8AAAAAAAAB/+AB4AAAAAAAAD/8AB4AAAAAAAAD/4AAAAAAAAAAAH/4AAAAAAAAAAAP/wAAAAAAAAAAAP/wAAAAAAAAAAAf/gAAAAAAAAAAAf/gAAAAAAAAAAA//AAAAAAAAAAAA//AAAAAAAAAAAB/+AAAAAAAAAAAD/8AAAAAAAAAAAD/8AAAAAAAAAAAH/4AAAAAAAAAAAH/4AAAAAAAAAAAP/wAAAAAAAAAAAP/wAAAAAAAAAAAf/gAAAAAAAAAAAf/gAAAAAAAAAAA//AAAAAAAAAAAA//AAAAAAAAAAAA/+AAAAAAAAAAAAc4AAAAAAAAAAAAA=","h":93,"w":84},"pitangus-sulphuratus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAf/4AAAAAAAAH//wAAAAAAAD///AAAAAAAA///+AAAAAAAP///8AAAAAAD////+AAAAAAf////4AAAAAH/////gAAAAA/////0AAAAAH////gAAAAAB////4AAAAAAP///+AAAAAAD////gAAAAAAf///4AAAAAAH////AAAAAAD////wAAAAAA////+AAAAAAP////gAAAAAD////+AAAAAA/////wAAAAAP////+AAAAAD/////wAAAAA/////+AAAAAP/////wAAAAB/////+AAAAAf/////wAAAAH/////+AAAAA//////wAAAAP/////+AAAAD//////wAAAA//////8AAAAH//////gAAAB//////8AAAAP//////AAAAD//////4AAAAf/////+AAAAH//////wAAAA//////8AAAAP//////gAAAB//////4AAAAP/////+AAAAD//////gAAAAf/////4AAAAD/////+AAAAAf/////gAAAAH/////4AAAAA/////+AAAAAH/////gAAAAA/////4AAAAAD/////gAAAAAf/////gAAAAH////38AAAAA//////gAAAAP///988AAAAB///H//gAAAAPf/4fnwAAAAD3/+B4cAAAAAc//gGAAAAAABH/4AAAAAAAAB/+AAAAAAAAAP/wAAAAAAAAD/+AAAAAAAAAf/gAAAAAAAAH/8AAAAAAAAA//gAAAAAAAAH/4AAAAAAAAB//AAAAAAAAAP/4AAAAAAAAD//AAAAAAAAAf/wAAAAAAAAD/+AAAAAAAAA//wAAAAAAAAH/8AAAAAAAAB//gAAAAAAAAP/8AAAAAAAAD//gAAAAAAAAf/4AAAAAAAAD//AAAAAAAAA//4AAAAAAAAH/+AAAAAAAAA//wAAAAAAAAP/+AAAAAAAAB//gAAAAAAAAP/8AAAAAAAAB//AAAAAAAAAP/4AAAAAAAAB/+AAAAAAAAAFDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":69},"platalea-ajaja":{"bits":"AAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAA/gAAAAAAAAAAAAB/wAAAAAAAAAAAAD/4AAAAAAAAAAAAH/8AAAAAAAAAAAAH/+AAAAAAAAAAAAP/+AAAAAAAAAAAAP//AAAAAAAAAAAAf//AAAAAAAAAAAAf//AAAAAAAAAAAA///AAAAAAAAAAAB///AAAAAAAAAAAB//+AAAAAAAAAAAD+f+AAAAAAAAAAAH8/+B/+AAAAAAAAP5/8H//wAAAAAAAfx/4P//+AAAAAAA/j/w////gAAAAAB+D/x////4AAAAAD8D/j////8AAAAAH4H/n/////AAAAAPwH///////gAAAAfgH///////wAAAA/gH///////8AAAB/AH///////+AAAD+AD////////AAAH8AD////////AAAP8AD////////gAAP4AB////////wAAPwAA////////4AAPgAAf///////4AAPAAAP///////+AAEAAAH////////AAAAAAA////////gAAAAAAB///////wAAAAAAAf//////wAAAAAAAP//////4AAAAAAAH//////8AAAAAAAD//////8AAAAAAAB//////+AAAAAAAA///////AAAAAAAAf//////AAAAAAAAP//////gAAAAAAAH//////gAAAAAAAB//////gAAAAAAAAf/////wAAAAAAAAH/////4AAAAAAAAH/////8AAAAAAAAD/v///8AAAAAAAAB/AA//8AAAAAAAAB+AAf/4AAAAAAAAA8AAH/wAAAAAAAAA8AAB/wAAAAAAAAA8AAAHwAAAAAAAAAcAAADgAAAAAAAAAeAAAAAAAAAAAAAAeAAAAAAAAAAAAAAeAAAAAAAAAAAAAA/AAAAAAAAAAAAAAfAAAAAAAAAAAAAAfAAAAAAAAAAAAAA/AAAAAAAAAAAAAA/AAAAAAAAAAAAAA3AAAAAAAAAAAAAA3AAAAAAAAAAAAAA3AAAAAAAAAAAAAB3AAAAAAAAAAAAAB3AAAAAAAAAAAAABnAAAAAAAAAAAAABnAAAAAAAAAAAAADnAAAAAAAAAAAAADnAAAAAAAAAAAAADnAAAAAAAAAAAAADHAAAAAAAAAAAAADHAAAAAAAAAAAAAHHAAAAAAAAAAAAf/nAAAAAAAAAAAAP/nAAAAAAAAAAAA/+nAAAAAAAAAAAD/8HAAAAAAAAAAACD4HAAAAAAAAAAAADgHAAAAAAAAAAAACf/gAAAAAAAAAAAAf/gAAAAAAAAAAAAH+AAAAAAAAAAAAAf+AAAAAAAAAAAAB/8AAAAAAAAAAAABA8AAAAAAAAAAAAAA4AAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":90},"plectrophenax-nivalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAf//8AAAAAAAAAAAH///wAAAAAAAAAAB////gAAAAAAAAAAf////AAAAAAAAAAD////8AAAAAAAAAA/////gAAAAAAAAAP////wAAAAAAAAAB////wAAAAAAAAAAf///8AAAAAAAAAAH////AAAAAAAAAAB////4AAAAAAAAAA////+AAAAAAAAAAf////wAAAAAAAAAH////+AAAAAAAAAB/////wAAAAAAAAA/////+AAAAAAAAAP/////wAAAAAAAAD/////+AAAAAAAAA//////4AAAAAAAAP//////AAAAAAAAD//////4AAAAAAAA///////AAAAAAAAP//////4AAAAAAAD///////AAAAAAAA///////4AAAAAAAP///////AAAAAAAD///////4AAAAAAA////////AAAAAAAf///////4AAAAAAH////////AAAAAAA////////wAAAAAAP///////+AAAAAAD////////wAAAAAA////////+AAAAAAP////////gAAAAAD////////8AAAAAAf////////AAAAAAH////////4AAAAAB////////+AAAAAAP////////gAAAAAD////////8AAAAAA/////////AAAAAAP////////wAAAAAD////////8AAAAAA/////////AAAAAAP////////wAAAAAD////////8AAAAAA/////////AAAAAAP////////wAAAAAD////////8AAAAAA////////+AAAAAAP////////gAAAAAD////////wAAAAAA////////4AAAAAAF///////88AAAAAAD//8H////8AAAAAA//+AA///+gAAAAAP//AAD///4AAAAAH//AAAEd//4AAAAB//AAAACD//wAAAAf/AAAAB///yAAAAH/wAAAAd/v+AAAAB/8AAAADMAD4AAAAf/AAAAAAAABAAAAH/wAAAAAAAAAAAAB/4AAAAAAAAAAAAAf+AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAP+AAAAAAAAAAAAAAPgAAAAAAAAAAAAAD4AAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":80,"w":93},"plegadis-chihi":{"bits":"AAAAAAAAAH4AAAAAAAAAAAAH/gAAAAAAAAAAAD/8AAAAAAAAAAAA//gAAAAAAAAAAAf/4AAAAAAAAAAAH//AAAAAAAAAAAB//wAAAAAAAAAAAf/+AAAAAAAAAAAP//wAAAAAAAAAAD//+AAAAAAAAAAAf//4AAAAAAAAAAH/z/AAAAAAAAAAB/8P4AAAAAAAAAAP/h/AAAAAAAAAAD/8H4AAAAAAAAAAf/A/AAAAAAAAAAD/4D4AAAAAAAP/4f+AfAAAAAAA///n/wDwAAAAAB/////8AeAAAAAD//////ADwAAAAD//////wAeAAAAD//////8ADgAAAB///////AAcAAAB///////wAHAAAA///////8AA4AAAf///////AAGAAAf///////gABwAAP///////4AAcAAH///////8AADAAD///////+AAAwAD////////AAAAAD////////gAAAAB////////wAAAAA////////4AAAAAf///////8AAAAAH///////+AAAAAD////////AAAAAB////////gAAAAA////////wAAAAAf///////4AAAAAH///////8AAAAAD///////+AAAAAD////////AAAAAB////////AAAAAAf///////gAAAAAP///////gAAAAADP//////gAAAAAAP//////gAAAAAAH//////gAAAAAAD///AB/wAAAAAAA///AAf8AAAAAAAM//AAP+AAAAAAAAP/AAHvgAAAAAAAH/gADzwAAAAAAAB/gAB9//4AAAAAAfwAAf//+AAAAAAA4AAH///wAAAAAAAAAAZ4D+AAAAAAAAAAAcA/wAAAAAAAAAAHAd8AAAAAAAAAADwHfAAAAAAAAAAA8A3wAAAAAAAAAAPgF8AAAAAAAAAAD4AfAAAAAAAAAAA8APgAAAAAAAAAAHAC4AAAAAAAAAABwAMAAAAAAAAAAAcAGAAAAAAAAAAAHAAAAAAAAAAAAABwAAAAAAAAAAAAAcAAAAAAAAAAAAAHAAAAAAAAAAAAABwAAAAAAAAAAAAAcAAAAAAAAAAAAAHAAAAAAAAAAAAABwAAAAAAAAAAAAAcAAAAAAAAAAAAAHAAAAAAAAAAAAABwAAAAAAAAAAAAAcAAAAAAAAAAAAAPgwAAAAAAAAAAAP/+AAAAAAAAAAAD/+AAAAAAAAAAAAH+AAAAAAAAAAAAA/4AAAAAAAAAAAAOf4AAAAAAAAAAADg/AAAAAAAAAAAAYB4AAAAAAAAAAAHAAAAAAAAAAAAAAwAAAAAAAAAAAAAMAAAAAAAAAAAAABAAAAAAAAA==","h":93,"w":86},"plegadis-falcinellus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP4AAAAAAAAAAAAH/wAAAAAAAAAAAB/+AAAAAAAAAAAAf/4AAAAAAAAAAAH//gAAAAAAAAAAA//8AAAAAAAAAAAf//gAAAAAAAAAAP//+AAAAAAAAAAD///wAAAAAAAAAB///+AAAAAAAAAAf8H/gAAAAAAAAAH+A/8AAAAAAAAAD+AP/gAAAAAAAAA/AB/8AAAAAAAAAPgAf/AAAAAAAAAD4AD/w/8AAAAAAA8AA/+f/8AAAAAAPAAH/v//8AAAAADwAB/7///4AAAAAcAAP/////wAAAAHAAB//////gAAAB4AAf//////AAAAOAAD//////8AAABgAAf//////wAAAMAAD///////AAAAAAAf//////8AAAAAAB///////wAAAAAAP///////AAAAAAB///////8AAAAAAH///////wAAAAAA////////AAAAAAD///////8AAAAAAP///////gAAAAAB///////+AAAAAAD///////4AAAAAAP///////gAAAAAA///////+AAAAAAB///////4AAAAAAH///////gAAAAAAf//////8AAAAAAD///////wAAAAAAP//////+AAAAAAA///////wAAAAAAD///////AAAAAAAP//////4AAAAAAAf//////gAAAAAAB//////8AAAAAAAD//////gAAAAAAAH/////8AAAAAAAA//////gAAAAAAAD/////+AAAAAAAAP/////4AAAAAAAB/9////gAAAAAAAHvgD//8AAAAAAAAc8AP//gAAAAAAADjgA//4AAAAAAAAccAH/4AAAAAAAADjgAf/gAAAAAAAAOOAB/8AAAAAAAABxwAH/AAAAAAAAAOOAAfgAAAAAAAABx4AA4AAAAAAAAAeeAAAAAAAAAAAADxwAAAAAAAAAAAAOOAAAAAAAAAAAADjwAAAAAAAAAAAAccAAAAAAAAAAAADjgAAAAAAAAAAAAccAAAAAAAAAAAAHHAAAAAAAAAAAAA44AAAAAAAAAAAAHHAAAAAAAAAAAAAxwAAAAAAAAAAAAGOAAAAAAAAAAAABxwAAAAAAAAAAAAOOAAAAAAAAAAAABzgAAAAAAAAAAAeecAAAAAAAAAAAC//gAAAAAAAAAAf///AAAAAAAAAAD///eAAAAAAAAAAD/f5wAAAAAAAAAB//+AAAAAAAAAAAO7xwAAAAAAAAAADF4cAAAAAAAAAAAAOHAAAAAAAAAAAADAwAAAAAAAAAAAAIMAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":93,"w":87},"pluvialis-dominica":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAP/wAAAAAAAAAA//wAAAAAAAAAD//wAAAAAAAAAH//wAAAAAAAAAP//gAAAAAAAAA///AAAAAAAAAD///AAAAAAAAAf//+AAAAAAAAD///8AAAAAAAAP///4AAAAAAAAef//wAAAAAAAAAP//gAAAAAAAAAP//AAAAAAAAAAf//AAAAAAAAAA//+AAAAAAAAAB//8AAAAAAAAAD//8AAAAAAAAAH//8AAAAAAAAAf//8AAAAAAAAA///+AAAAAAAAD///+AAAAAAAAH////AAAAAAAAP////gAAAAAAA/////wAAAAAAB/////wAAAAAAD/////4AAAAAAH/////4AAAAAAP/////4AAAAAAf/////4AAAAAA//////8AAAAAB//////4AAAAAD//////8AAAAAH//////4AAAAAP//////4AAAAAf//////4AAAAAf//////4AAAAA///////4AAAAB///////4AAAAB///////4AAAAD///////4AAAAD///////4AAAAD///////4AAAAH///////4AAAAH///////8AAAAH///////+AAAAH////////AAAAH////////wAAAH////////8AAAD////////+AAAD////////+AAAD////////gAAAB////////AAAAA////4AP+AAAAA////AAD+AAAAA///AAAB+AAAAB//+AAAAwAAAAB8/wAAAAAAAAAB4/AAAAAAAAAABg8AAAAAAAAAADg4AAAAAAAAAAHBwAAAAAAAAAAOBwAAAAAAAAAAcDgAAAAAAAAAA4PAAAAAAAAAABwOAAAAAAAAAADgcAAAAAAAAAAGA4AAAAAAAAAAMBwAAAAAAAAAAYDAAAAAAAAAAAwGAAAAAAAAAADgMAAAAAAAAAAHAYAAAAAAAAAAMAwAAAAAAAAAAYBgAAAAAAAAAAwDAAAAAAAAAADgGAAAAAAAAAAHAcAAAAAAAAA+/A4AAAAAAAAD//B4AAAAAAAAf/2fwAAAAAAAB////gAAAAAAACD4B8AAAAAAAAAPAPYAAAAAAAAAQD4wAAAAAAAAAAPBgAAAAAAAAAA4GAAAAAAAAAAAAMAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":77},"pluvialis-squatarola":{"bits":"AAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAP/AAAAAAAAAAAAAD/+AAAAAAAAAAAAA//4AAAAAAAAAAAAP//gAAAAAAAAAAAD//+AAAAAAAAAAAAf//4AAAAAAAAAAAD///AAAAAAAAAAAAf//8AAAAAAAAAAAP///gAAAAAAAAAAH///+AAAAAAAAAAD////4AAAAAAAAAB/////8AAAAAAAAAP7/////gAAAAAAAAgH/////gAAAAAAAAAf/////gAAAAAAAAD//////gAAAAAAAAP//////AAAAAAAAB//////+AAAAAAAAf//////8AAAAAAAD///////wAAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////8AAAAAAD////////wAAAAAAf////////gAAAAAD/////////gAAAAAf/////////AAAAAD//////////AAAAAf//////////AAAAD///////////AAAAP///////////gAAB////////////wAAH////////////AAAf///////////AAAD///////////+AAAP///////////wAAA///////////gAAAD///////////gAAAP//////4Af//AAAA//////+H///8AAAD//////h+AP/gAAAP/////48AAP4AAAAf////+OAAAAAAAAA/////HAAAAAAAAAB////xwAAAAAAAAAD///94AAAAAAAAAAD////AAAAAAAAAAAA///wAAAAAAAAAAAHjgAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAD94AAAAAAAAAAAAAe/AAAAAAAAAAAAAD5wAAAAAAAAAAAAAPuAAAAAAAAAAAAAB9wAAAAAAAAAAAAAHcAAAAAAAAAAAAAAbgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAHB4AAAAAAAAAAAAB//gAAAAAAAAAAAAA/8AAAAAAAAAAAAH/8AAAAAAAAAAAAD/uAAAAAAAAAAAAA0PgAAAAAAAAAAAAADwAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"podiceps-auritus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBwAAAAAAAAAAAAAP/AAAAAAAAAAAAAD/8AAAAAAAAAAAAD//wAAAAAAAAAAAAP//gAAAAAAAAAAAD//+AAAAAAAAAAAAf//8AAAAAAAAAAAD///wAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAH///AAAAAAAAAAAB///8AAAAAAAAAAAP///wAAAAAAAAAAB////AAAAAAAAAAAf///+AAAAAAAAAAD////+AAAAAAAAAAf////8AAAAAAAAAD///A/4AAAAAAAAAf/+AAfgAAAAAAAAB//AAAAAAAAAAAAAP/4AAAAAAAAAAAAB//AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//AAAAAAAAAAAAAH/8AAAAAAAAAB/gAf/wAAAAAAAAP//8D/+AAAAAAAAP///8f/4AAAAAAAf////7//gAAAAAAP///////+AAAAAAH////////wAAAAAD/////////AAAAAA/////////4AAAAAf/////////AAAAAP/////////4AAAAP//////////gAAAH//////////8AAAD///////////gAAA///////////8AAAG///////////AAAB///////////4AAA////////////AAAP///////////4AAB///////////+AAAH///////////wAAA///////////8AAAB///////////gAAAMf/////////4AAAAB/////////+AAAAAH/////////gAAAAAf////////wAAAAAA////////4AAAAAAB///////4AAAAAAAAP9///fgAAAAAAAAAAH//4AAAAAAAAAAAAx/9AAAAAAAAAAAADD/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAPGAAAAAAAAAAAAABwgAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"podiceps-grisegena":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH//AAAAAAAAAAA///wAAAAAAAAAB///wAAAAAAAAAD///wAAAAAAAAAH///gAAAAAAAAAP///gAAAAAAAAAP///wAAAAAAAAAf///4AAAAAAAAB////4AAAAAAAAH////4AAAAAAAAf////4AAAAAAAB/////4AAAAAAAH/z///8AAAAAAAP8AP//8AAAAAAAOAAAf/4AAAAAAAAAAAP/4AAAAAAAAAAAP/4AAAAAAAAAAAP/4AAAAAAAAAAAf/4AAAAAAAAAAA//wAAAAAAAAAAB//wAAAAAAAAAAB//gAAAAAAAAAAD//gAAAAAAAAAAH//AAAAAAAAAAAP//AAAAAAAAAAAf//AAAAAAAAAAA////wAAAAAAAAA/////AAAAAAAAB/////wAAAAAAAB/////8AAAAAAAB//////AAAAAAAD//////wAAAAAAD//////8AAAAAAD//////+AAAAAAD///////gAAAAAD///////wAAAAAD///////4AAAAAD///////8AAAAAD///////+AAAAAD////////AAAAAD////////gAAAAD////////wAAAAD////////4AAAAB////////4AAAAB////////8AAAAA////////+AAAAA/////////AAAAAf////////AAAAAf////////gAAAAP////////gAAAAH////////wAAAAD////////wAAAAB////////4AAAAA////////4AAAAAf///////8AAAAAP///////8AAAAAH///////8AAAAAD///////8AAAAAB///////+AAAAAA///////+AAAAAAf///////AAAAAAP///////AAAAAAH///////gAAAAAD///////gAAAAAB///////gAAAAAA///////gAAAAAA///////gAAAAAAf//////gAAAAAAP//////4AAAAAP///////8AAAAAf///////8AAAAB////////8AAAAD////////8AAAAH/4//////4AAAAH/wH////9gAAAAH/gf////AAAAAAC/h////+AAAAAAA/D////4AAAAAAA/j/8//AAAAAAAA5n/4D/AAAAAAAAwD/wAcAAAAAAAAYA/gAAAAAAAAAAAA/gAAAAAAAAAAAB/gAAAAAAAAAAAB/gAAAAAAAAAAAA/gAAAAAAAAAAAAzgAAAAAAAAAAAA7AAAAAAAAAAAAABgAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAA=","h":93,"w":84},"podiceps-nigricollis":{"bits":"AAAB8AAAAAAAAAAAAAD/+AAAAAAAAAAAAB///AAAAAAAAAAAAf///gAAAAAAAAAAH///+AAAAAAAAAAB////4AAAAAAAAAAf////AAAAAAAAAAD////wAAAAAAAAAA/////AAAAAAAAAAH/////AAAAAAAAAB/////8AAAAAAAAA/////+AAAAAAAAAP/////wAAAAAAAAP//////AAAAAAAAH//////cAAAAAAAB//////8wAAAAAAAf8D////yAAAAAAAH8AD////AAAAAAAAAAAD///8AAAAAAAAAAAf//+gAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAAf///4AAAAAAAAAAH////AAAAAAAAAAD/////8AAAAAAAAAf//////AAAAAAAAH//////+AAAAAAAB///////+AAAAAAAP///////8AAAAAAD////////wAAAAAAf////////gAAAAAD////////+AAAAAAf////////8AAAAAH/////////wAAAAA//////////AAAAAH/////////8AAAAA//////////wAAAAH//////////AAAAAf/////////8AAAAD//////////wAAAAf//////////AAAAD//////////8AAAAP//////////gAAAB//////////+AAAAP//////////4AAAA///////////gAAAD//////////8AAAAf//////////wAAAB//////////+AAAAH//////////4AAAAf//////////AAAAB//////////8AAAAD//////////wAAAAP//////////AAAAAf/////////4AAAAB//////////gAAAAD/////////+AAAAAH/////////4AAAAAP/////////AAAAAAf////////8AAAAAH////////3gAAAAB/////////OAAAAAf////////+wAAAAH/////////6AAAAA3/////////AAAAAA/////////8AAAAAD/f///////wAAAAA/5v///////AAAAAH+Af//////4AAAAA4wB///////AAAAAGHAD//////4AAAAAwAAH//////AAAAACAAAP///v/wAAAAAAAAAH//AA8AAAAAAAAAAH8AAAAAAAAAAAAAD/gAAAAAAAAAAMAB/wAAAAAAAAAAD+A/wAAAAAAAAAAAH//8AAAAAAAAAAAA///gAAAAAAAAAAAH//8AAAAAAAAAAAB///gAAAAAAAAAAAf//UAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAA7/+AAAAAAAAAAAACD/gAAAAAAAAAAAAAP4AAAAAAAAAAAAAB8AAAAAAAAAAAAAAPAAAAAAAAAAAAAABgAAAAAAAAAAAAAAIAAAAAAAA=","h":92,"w":93},"podilymbus-podiceps":{"bits":"AB/4AAAAAAAAB//AAAAAAAAA//8AAAAAAAAf//gAAAAAAAP//4AAAAAAAH///AAAAAAAB///wAAAAAAA///+AAAAAAA////gAAAAAAf///4AAAAAAP///+AAAAAAD////gAAAAAA////4AAAAAAP///+AAAAAAD+D//gAAAAAAwAP/4AAAAAAAAD/+AAAAAAAAA//AAAAAAAAAf/wAAAAAAAAP/8AAAAAAAAH/+AAAAAAAAB//gAAAAAAAA///8AAAAAAAP///+AAAAAAH////8AAAAAB/////wAAAAAf/////AAAAAP/////8AAAAD//////gAAAA//////8AAAAP//////wAAAD//////+AAAA///////gAAAP//////8AAAD///////gAAA///////8AAAP///////gAAB///////8AAAf///////AAAH///////wAAB///////+AAAP///////wAAD///////8AAAf///////gAAH///////4AAA////////BAAH///////74AA/////////AAH////////wAA////////8AAH////////AAA////////wAAH///////8AAA///////+AAAH///////gAAA///////wAAAD//////4AAAAf/////8AAAAD//////AAAAB//////4AAAAf/////+AAAAP//////wAAAD//////8AAAB///////AAAAf9/////wAAAH/A///B8AAAB/wD//gAAAAAP+AP3AAAAAAB5wB8AAAAAAAcAAfAAAAAAAHAAHwAAAAAAAwAB4AAAAAAAEAAeAAAAAAAAAAHAAAAAAAAAABwAAAAAAAAAA8AAAAAAAAAAPAAAAAAAAAAD8AAAAAAAAAB/AAAAAAAAH//wAAAAAAAB//gAAAAAAAAH/4AAAAAAAAA/+AAAAAAAAAf/gAAAAAAAAH/wAAAAAAAAD/8AAAAAAAAB//AAAAAAAAA//gAAAAAAAAfP4AAAAAAAAGB8AAAAAAAAAAPAAAAAAAAAADgAAAAAAAAAAwAAAAA=","h":93,"w":68},"poecile-atricapillus":{"bits":"AAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAH/4AAAAAAAAAAAAD//wAAAAAAAAAAAB///wAAAAAAAAgAAf///gAAAAAAB+AAH///+AAAAAAA/wAB////4AAAAAAf+AAf////gAAAAAP//gD////+AAAAAH//8Af////4AAAAD///gP/////4AAAB///4H//////4AAAf///B///////wAAP///wP///////4AH///wAP///////4B///4AA////////w///4AAH///////////8AAAf//////////8AAAB//////////+AAAAP/////////+AAAAA//////////AAAAAH/////////gAAAAA/////////8AAAAAH/////////gAAAAA/////////+AAAAAH/////////4AAAAA/////////gAAAAAH////////+AAAAAA/////////8AAAAAH/////////4AAAAA//////////wAAAAD//////////AAAAAf/////////8AAAAB////////gAAAAAAP///////4AAAAAAA///////+AAAAAAAH///////gAAAAAAAf//////8AAAAAAAB///////AAAAAAAAH//////wAAAAAAAAP/////8AAAAAAAAA//////gAAAAAAAAD/////wAAAAAAAAAH////8AAAAAAAAAAf///+AAAAAAAAAAAf///AAAAAAAAAAAP//+4AAAAAAAAAA////8AAAAAAAAAAP/+B/AAAAAAAAAAB/AweAAAAAAAAAAAPwAHkAAAAAAAAAAB4AD/4AAAAAAAAAAfAH//AAAAAAAAAADYB/gIAAAAAAAAAAPwP4AAAAAAAAAAAAAB+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAN8AAAAAAAAAAAAAA3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":63,"w":93},"poecile-carolinensis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAA///4AAAAAAAAAAAP///wAAAAAAAAAAD///+AAAAAAAAAAA////wAAAAAAAAAAH////wAAAAAAAAAB/////gAAAAAAAAAf////8AAAAAAAAAD/////AAAAAAAAAA/////AAAAAAAAAAH////4AAAAAAAAAB/////AAAAAAAAAAP////wAAAAAAAAAB////+AAAAAAAAAA/////gAAAAAAAAAP////8AAAAAAAAAD/////gAAAAAAAAB/////8AAAAAAAAAf/////gAAAAAAAAH/////+AAAAAAAAB//////wAAAAAAAAf/////+AAAAAAAAH//////wAAAAAAAB//////+AAAAAAAAf//////wAAAAAAAH//////+AAAAAAAB///////wAAAAAAA///////+AAAAAAAP///////wAAAAAAD///////8AAAAAAAf///////gAAAAAAH///////8AAAAAAB////////AAAAAAAf///////4AAAAAAH///////+AAAAAAA////////gAAAAAAP///////8AAAAAAD////////AAAAAAAf///////wAAAAAAH///////8AAAAAAA////////gAAAAAAP///////4AAAAAAD///////+AAAAAAA////////gAAAAAAP///////4AAAAAAD///////8AAAAAAA////////AAAAAAAP///////wAAAAAAB/////////gAAAAAf/+///////gAAAAP/+Af//+A/+AAAAD/gAA//+Aff4AAAB/4AAAP4AHAfAAAAf+AAAB+AA4B4AAAH/AAAAB8AEAHAAAD/wAAAADwAgA4AAA/8AAAAAPAAACAAAP+AAAAAA8AAAwAAH/gAAAAAD4AAAAAB/wAAAAAAHgAAAAAf8AAAAAAAeAAAAAH/AAAAAAA/8AAAAB/gAAAAAAP/4AAAA/4AAAAAADw/gAAAH+AAAAAAAcD+AAAB/AAAAAAADAHwAAAPwAAAAAAAAA8AAAA8AAAAAAAAAHAAAAEAAAAAAAAAB4AAAAAAAAAAAAAAHAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":77,"w":93},"poecile-gambeli":{"bits":"AAD4AAAAAAAAAAAAAH/8AAAAAAAAAAAAD//4AAAAAAAAAAAA///wAAAAAAAAAAAf///gAAAAAAAAAAH////AAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAD////+AAAAAAAAAB/////4AAAAAAAAAf/////gAAAAAAAAH//////AAAAAAAAAf/////4AAAAAAAAAf/////wAAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAB//////4AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAAf//////4AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////gAAAAAAf///////+AAAAAAD////////4AAAAAAf////////wAAAAAD////////+AAAAAAf////////4AAAAAB/////////gAAAAAP////////+AAAAAA/////////4AAAAAH/////////gAAAAAf////////+AAAAAB/////////8AAAAAP/////////+AAAAA//////////+AAAAD//////////+AAAAP//////////+AAAA///////////8AAAD///////Af//8AAAP//////AAf//4AAA//////gAA///gAAB/////wAAA//+AAAD////4AAAB//wAAAH///+AAAAB/+AAAD////AAAAAD/4AAH////wAAAAAH/AAA////gAAAAAAHwAAP4P/4AAAAAAAAAAB8AfGAAAAAAAAAAAPAPgAAAAAAAAAAABYP/gAAAAAAAAAAAP///gAAAAAAAAAAAH/f8AAAAAAAAAAAA/wAgAAAAAAAAAAAH4AEAAAAAAAAAAAB8AAAAAAAAAAAAAALgAAAAAAAAAAAAABeAAAAAAAAAAAAAABwAAAAAAAAAAAA==","h":63,"w":93},"poecile-rufescens":{"bits":"AAD+AAAAAAAAAAAAAH/+AAAAAAAAAAAAD//8AAAAAAAAAAAA///4AAAAAAAAAAAP///wAAAAAAAAAAD////AAAAAAAAAAA////8AAAAAAAAAAH////wAAAAAAAAAB/////AAAAAAAAAAP////+AAAAAAAAAP/////8AAAAAAAAD//////8AAAAAAAA///////4AAAAAAAH///////gAAAAAAAA///////AAAAAAAAP///////gAAAAAAA////////AAAAAAAD///////+AAAAAAAP///////8AAAAAAA////////4AAAAAAH////////gAAAAAAf////////AAAAAAD////////8AAAAAAf////////4AAAAAB/////////wAAAAAP/////////8AAAAB///////////8AAAH////////////gAA/////////////wAH/////////////AAf////////////wAD////////wf//+AAP///////4AD//4AA///////8AAAf/AAH//////+AAAADAAAf//////gAAAAAAAA//////4AAAAAAAAD/////+AAAAAAAAAP/////gAAAAAAAAA/////4AAAAAAAAAB////8AAAAAAAAAAD////AAAAAAAAAAAH///AAAAAAAAAAAAD//4AAAAAAAAAAAA//+AAAAAAAAAAAAfA/gAAAAAAAAAAAP/PAAAAAAAAAAAAf//wAAAAAAAAAAAD+F/8AAAAAAAAAAA/A//wAAAAAAAAAAHwfv/AAAAAAAAAAA/X4AYAAAAAAAAAAB++AAAAAAAAAAAAANF4AAAAAAAAAAAAAAHQAAAAAAAAAAAAAA+AAAAAAAAAAAAAABAAAAAAAAAA","h":57,"w":93},"polioptila-caerulea":{"bits":"AAAAAAAfgAAAAAAAH/4AAAAAAAf/4AAAAAAB//4AAAAAAf//4AAAAAH///4AAAAA////4AAAAAD///4AAAAAB///wAAAAAA///gAAAAAA///AAAAAAB///AAAAAAD//+AAAAAAH//8AAAAAAf//4AAAAAB///wAAAAAH///gAAAAAf///AAAAAB///+AAAAAH///8AAAAAf///4AAAAB////wAAAAH////gAAAAP////AAAAB////+AAAAH////4AAAAP////wAAAA/////gAAAD////+AAAAP////8AAAAf////wAAAB/////AAAAH////+AAAAP////4AAAA/////gAAAB/////AAAAD////8AAAAH////wAAAAf////AAAAB/////gAAAH/////AAAAf/////AAAB////98AAAD///+/wAAAP////zAAAAf//4P8AAAB//+AfwAAAA5/4D3gAAADn/AH/AAAAGP8AP+AAAAA/4AbwAAAAD/gAPAAAAAH/AAMAAAAAf+AAAAAAAA/4AAAAAAAD/wAAAAAAAH/gAAAAAAAf+AAAAAAAA/8AAAAAAAD/wAAAAAAAH/gAAAAAAAf/AAAAAAAA/8AAAAAAAD/4AAAAAAAP/gAAAAAAAf/AAAAAAAA/+AAAAAAAD/4AAAAAAAP/wAAAAAAAf/gAAAAAAB/+AAAAAAAD/8AAAAAAAP/wAAAAAAAf/gAAAAAAB//AAAAAAAD/8AAAAAAAP/4AAAAAAAf9wAAAAAAB/wAAAAAAAD/gAAAAAAAH/AAAAAAAAf8AAAAAAAA/4AAAAAAAD/gAAAAAAAH/AAAAAAAAf8AAAAAAAA/4AAAAAAAD/gAAAAAAAH/AAAAAAAAP8AAAAAAAA/wAAAAAAAB5AAAAAAAADAAAAAAAAAA=","h":93,"w":59},"pooecetes-gramineus":{"bits":"AB/AAAAAAAAAAAAAA/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAH///AAAAAAAAAAAB///8AAAAAAAAAAA////wAAAAAAAAAAH///+AAAAAAAAAAAP///4AAAAAAAAAAAf///AAAAAAAAAAAB///8AAAAAAAAAAAD///gAAAAAAAAAAAf//+AAAAAAAAAAAB///wAAAAAAAAAAAP///AAAAAAAAAAAB///+AAAAAAAAAAAP///8AAAAAAAAAAB////4AAAAAAAAAAP////wAAAAAAAAAB/////gAAAAAAAAAP////+AAAAAAAAAB/////8AAAAAAAAAP/////wAAAAAAAAB//////AAAAAAAAAP/////+AAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAA///////gAAAAAAAH//////+AAAAAAAA///////8AAAAAAAD///////4AAAAAAAf///////wAAAAAAB////////gAAAAAAP////////AAAAAAA////////+AAAAAAD////////8AAAAAAP////////+AAAAAB//////////AAAAAH//////////gAAAAP//////////gAAAA///////////gAAAB///////////wAAAD///////////gAAAH////8AAH///AAAAP///4AAAH//4AAAAP//8AAAAH/8AAAAAH/8AAAAAH/wAAAAAf/AAAAAAH+AAAAAH/gAAAAAAHwAAAAD/gAAAAAAAAAAAAB/wAAAAAAAAAAAAAf8AAAAAAAAAAAAP/+AAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAL//+AAAAAAAAAAAAf+f4AAAAAAAAAAAH/wDAAAAAAAAAAAD44AAAAAAAAAAAAAYOAAAAAAAAAAAAACBwAAAAAAAAAAAAAAIAAAAAAAAAAAAAABgAAAAAAAAAAAAAAEAAAAAAAAAAA","h":64,"w":93},"porphyrio-martinica":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAD/8AAAAAAAAAAAH/+AAAAAAAAAAAH//AAAAAAAAAAAP//gAAAAAAAAAAf//gAAAAAAAAAA///wAAAAAAAAAB///wAAAAAAAAAD///4A+AAAAAAAH///4f/8AAAAAAH///7///wAAAAAP9//////8AAAAAPgP//////AAAAAMAP//////4AAAAAAP//////+AAAAAAP///////gAAAAAf///////4AAAAAf////////AAAAAf////////wAAAA/////////+AAAA//////////wAAA///////////wAA///////////8AA///////////8AAf//////////8AAf//////////8AAf//////////4AAP/////////AwAAP/////////hwAAH/////////nAAAD/////////8AAAB/////////8AAAA/////////8AAAAf/////////AAAAH/////////gAAAB/////////gAAAAf////////gAAAAD///////+AAAAAA//////4AAAAAAAP/////gAAAAAAAD////+AAAAAAAAA////8AAAAAAAAAP///wAAAAAAAAAH///gAAAAAAAAAD//8AAAAAAAAAAB//gAAAAAAAAAAA//gAAAAAAAAAAAf/gAAAAAAAAAAAH/AAAAAAAAAAAAHvAAAAAAAAAAAAD3gAAAAAAAAAAAD3gAAAAAAAAAAAB7wAAAAAAAAAAAB74AAAAAAAAAAAD58AAAAAAAAAAAD58AAAAAAAAAAAHx4AAAAAAAAAAAPx8AAAAAAAAAAAfh8AAAAAAAAAAAeB4AAAAAAAAAAA8B4AAAAAAAAAAB4B4AAAAAAAAAAD4B4AAAAAAAAAAHwB4AAAAAAAAAAPgBwAAAAAAAAAAPABwAAAAAAAAAAeADwAAAAAAAAAA+ADwAAAAAAAAAB8ADwAAAAAAADwf+ADwAAAAAAAH///4DwAAAAAAAA//38DwAAAAAAAAf/x8DgAAAAAAAB/ngAHgAAAAAAAP+PAAHwAAAAAAA/weAAH/gAAAAAB+A8AA//wAAAAABgA4H//mAAAAAAAAAwF//gAAAAAAAAAwAH/AAAAAAAAAAAAP/AAAAAAAAAAAA/HAAAAAAAAAAAH8HAAAAAAAAAAAPwHAAAAAAAAAAA/AHAAAAAAAAAAB8AHAAAAAAAAAABgAHAAAAAAAAAABAAGAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":84},"porzana-carolina":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAA//AAAAAAAAAAAAAP/8AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAH//8AAAAAAAAAAAB///wAAAAAAAAAAAf///AAAAAAAAAAAP///8AAAAAAAAAAD////wAAAAAAAAAA/////AAAAAAAAAAf//////+AAAAAAAH////////AAAAAAB/B///////gAAAAAPAH///////AAAAAAAAf//////+AAAAAAAD///////8AAAAAAAf///////4AAAAAAD////////gAAAAAAf////////AAAAAAD////////+AAAAAA/////////8AAAAAH/////////wAAAAA//////////AAAAAH/////////8AAAAA//////////8AAAAH////////////AAAf///////////8AAD////////////gAAf///////////8AAD////////////AAAP///////////gAAB///////////8AAAH//////////+AAAA///////////gAAAD//////////+AAAAP//////////4AAAA///////////AAAAH/////////v4AAAAf////////+AAAAAA/////////8AAAAAD/////////wAAAAAP/////////AAAAAAf////////4AAAAAA////////4AAAAAAD//////8AAAAAAAAH//////AAAAAAAAAP/////wAAAAAAAAAf////8AAAAAAAAAAf////AAAAAAAAAAA////gAAAAAAAAAAB///wAAAAAAAAAAAH//4AAAAAAAAAAAAP/8AAAAAAAAAAAAA//gAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/AAAAAAAAAAAAAAPwAAAAAAAAAAAAAA8AAAAAAAAAAAAAAPwAAAAAAAAAAAAAD+AAAAAAAAAAAAAA/wAAAAAAAAAAAAAPcAAAAAAAAAAAAAB7gAAAAAAAAAAAAAe8AAAAAAAAAAAAAHngAAAAAAAAAAAAB88AAAAAAAAAAAOAfngAAAAAAAAAAH//w4AAAAAAAAAAAH///AAAAAAAAAAAAf//4AAAAAAAAAAP//53AAAAAAAAAAP//8B4AAAAAAAAAD+D+APAAAAAAAAAAQB+AB4AAAAAAAAAAAfAAPgAAAAAAAAAADAABwAAAAAAAAAAAAAAOAAAAAAAAAAAAB///4AAAAAAAAAAAP///gAAAAAAAAAAAP//gAAAAAAAAAAH//8AAAAAAAAAAAH/+fAAAAAAAAAAAAzAPgAAAAAAAAAAAAAHwAAAAAAAAAAAAAD4AAAAAAAAAAAAAA8AAAAAAAAAAAAAAPAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":93},"progne-subis":{"bits":"AAAAAfgAAAAAB/8AAAAAH/+AAAAAH//AAAAAP//gAAAA///wAAAD///wAAAH///wAAAA///4AAAAP//4AAAAH//4AAAAH//4AAAAH//4AAAAH//8AAAAP//8AAAAf//8AAAA///8AAAB///+AAAD////AAAH////AAAP////AAAP////AAAf////AAA/////AAA/////AAB/////AAD/////AAD////+AAD////+AAH////+AAH////+AAP////+AAP////8AAP////8AAf////8AAf////4AA/////wAA/////gAA/////gAB/////AAB/////AAB////+AAB////8AAB////8AAD////4AAD////wAAD////gAAD////AAAD///+AAAD///8AAAH///4AAAH////wAAH//+f8AAP///f8AAP///X8AAP///e8AAf//+P4AAf//8HwAAf/+cBwAA//8YAAAA//8AAAAA//4AAAAB//wAAAAB//wAAAAD//gAAAAD//gAAAAD//gAAAADv/AAAAAHv/AAAAAHf/AAAAAGf+AAAAAGf+AAAAAE/+AAAAAA/8AAAAAB/8AAAAAB98AAAAAB54AAAAADx4AAAAADh4AAAAADBwAAAAAHBwAAAAAGBwAAAAAGBgAAAAAOBgAAAAAMDgAAAAAcDAAAAAAYDAAAAAAYHAAAAAAYGAAAAAA4GAAAAAAwMAAAAAAwAAAAAAAwAAAAAAA","h":93,"w":48},"protonotaria-citrea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAA/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAP//wAAAAAAAAAAAD///gAAAAAAAAAAB///+AAAAAAAAAAAf////gAAAAAAAAAH/////gAAAAAAAAB/////8AAAAAAAAAf////8AAAAAAAAAH////4AAAAAAAAAD////+AAAAAAAAAB/////wAAAAAAAAA/////8AAAAAAAAAf/////gAAAAAAAAH/////4AAAAAAAAB//////AAAAAAAAA//////wAAAAAAAAP/////+AAAAAAAAD//////gAAAAAAAA//////8AAAAAAAAf//////gAAAAAAAH//////8AAAAAAAD///////gAAAAAAA///////8AAAAAAAP///////gAAAAAAD///////4AAAAAAA////////AAAAAAAP///////4AAAAAAD////////AAAAAAA////////wAAAAAAH///////+AAAAAAD////////gAAAAAA////////8AAAAAAP////////AAAAAAH////////wAAAAAB////////8AAAAAA/////////AAAAAAP////////wAAAAAAP///////8AAAAAAH////////AAAAAAB////////wAAAAAAP///////8AAAAAAH///////+AAAAAAB////////AAAAAAA///wf///gAAAAAAf//gAP//wAAAAAAH/+AAB//8AAAAAAD//gAAP/34AAAAAA//wAAA8AHwAAAAAf/8AAADwAf8AAAAH/+AAAAPB//wAAAB//gAAAA8P/+AAAAP/4AAAADhYPwAAAB/8AAAAAOIA+AAAAP/AAAAAA4ADwAAAAPgAAAAADgAEAAAAB4AAAAAAOABgAAAAAAAAAAAB4AAAAAAAAAAAAAAH/AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAA+H+AAAAAAAAAAAAGAfQAAAAAAAAAAAAAA+AAAAAAAAAAAAAADgAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"psaltriparus-minimus":{"bits":"AAAAAAAAAAAH8AAAAAAAAAAAAAP/+AAAAAAAAAAAAH//8AAAAAAAAAAAB///4AAAAAAAAAAA////gAAAAAAAAAAP///+AAAAAAAAAAH////4AAAAAAAAAB/////AAAAAAAAAAf////8AAAAAAAAAD/////gAAAAAAAAA/////+AAAAAAAAAP/////8AAAAAAAAD//////wAAAAAAAB///////AAAAAAAAf//////wAAAAAAAH//////4AAAAAAAB///////AAAAAAAA///////4AAAAAAAP///////AAAAAAAB///////4AAAAAAAf///////AAAAAAAH///////4AAAAAAB////////AAAAAAAf///////4AAAAAAD////////AAAAAAA////////8AAAAAAP////////gAAAAAD////////8AAAAAA/////////gAAAAAH////////8AAAAAB/////////gAAAAAf////////4AAAAAH/////////AAAAAA/////////4AAAAAP/////////AAAAAB/////////wAAAAAf////////+AAAAAD/////////wAAAAA/////////8AAAAAH/////////gAAAAA/////////4AAAAAH/////////AAAAAB/////////wAAAAAP////////+AAAAAD/////////gAAAAAf////////4AAAAAH////////+AAAAAB/////////gAAAAAP////////8AAAAAD/////////AAAAAA/f///////wAAAAAH3///////8AAAAAB5///////+AAAAAAOf///////8AAAAABn//n/////wAAAAAB//wf////+AAAAAAf/AA/////wAAAAAH/4AAB/gf+AAAAAB/+AAAH8D/wAAAAAf/gAAB/wf8AAAAAD/8AAA9+B/AAAAAA//AAAH/wBgAAAAAP/wAAA/8AAAAAAAD/8AAAD/AAAAAAAA//AAAAHwAAAAAAAP/wAAAA4AAAAAAAD/8AAAAAAAAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAD/+AAAAAAAAAAAAA//gAAAAAAAAAAAAH/4AAAAAAAAAAAAB/+AAAAAAAAAAAAAf/gAAAAAAAAAAAAH/8AAAAAAAAAAAAB//AAAAAAAAAAAAAf/wAAAAAAAAAAAAH/8AAAAAAAAAAAAA//AAAAAAAAAAAAAP/wAAAAAAAAAAAAD/8AAAAAAAAAAAAA//AAAAAAAAAAAAAP/4AAAAAAAAAAAAB/+AAAAAAAAAAAAAf/gAAAAAAAAAAAAD/4AAAAAAAAAAAAA/eAAAAAAAAAAAAADDAAAAAAAAAAAAAA","h":88,"w":93},"pyrocephalus-rubinus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAP///wAAAAAAAAAAH////AAAAAAAAAAB////4AAAAAAAAAAD////gAAAAAAAAAAD////AAAAAAAAAAAf///+AAAAAAAAAAB////+AAAAAAAAAAP////8AAAAAAAAAA/////4AAAAAAAAAH/////wAAAAAH+AA//////wAAAA//wAD//////gAAD//+AAf//////wAP///8AD/////////////gAf////////////8AD/////////////AAf////////////wAD////////////gAAP//////////gAAAB/////////gAAAAAP///////xwAAAAAA///////84AAAAAAH////////AAAAAAAf///////+AAAAAAD////////4AAAAAAP///////3AAAAAAA////////gAAAAAAD///////+AAAAAAAP/////8f4AAAAAAA//////APgAAAAAAD/////wAAAAAAAAAH////8AAAAAAAAAAP///+AAAAAAAAAAAf///AAAAAAAAAAAAf//gAAAAAAAAAAAD//4AAAAAAAAAAAB/4PAAAAAAAAAAAAf9DwAAAAAAAAAAAPgI8AAAAAAAAAAAD4AOAAAAAAAAAAAAfADgAAAAAAAAAAAD4B4AAAAAAAAAAAAPAe4AAAAAAAAAAAB+H/wAAAAAAAAAAANn+aAAAAAAAAAAAA4+AQAAAAAAAAAAADPwAAAAAAAAAAAAABuAAAAAAAAAAAAAAF2AAAAAAAAAAAAAAPgAAAAAAAAAAAAABgAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":61,"w":93},"quiscalus-mexicanus":{"bits":"AAAAAA/gAAAAAAf/wAAAAB///gAAAAf//+AAAAD///8AAAAf///4AAAAAf//gAAAAAf//AAAAAA//8AAAAAB//wAAAAAD//gAAAAAP/+AAAAAA//4AAAAAH//gAAAAA//+AAAAAP//8AAAAB///wAAAAf///AAAAD///8AAAAf///wAAAD////AAAAf///8AAAD////wAAAP////AAAB////4AAAP////gAAA////8AAAH////wAAA/////AAAH////4AAAf////gAAD////8AAAP////wAAB////+AAAP////4AAA/////AAAD////4AAAf////gAAB////8AAAP////gAAA////8AAAD////gAAAf///8AAAB////gAAAH///8AAAAf///gAAAB///+AAAAP///wAAAB///+AAAAH///4AAAA//9/AAAAD//3uAAAAP/+cYAAAAv/w5wAAAA//BjgAAAB/4HHAAAAP/AOcAAAA/8AY4AAAH/wBxwAAAf+AD//AAD/4Dv//AAP/gf//8AB/+Af/+QAH/wAB/oAA//AAHvAAH/8AAHAAAf/gAAGAAD/+AAAAAAP/4AAAAAB//gAAAAAH/8AAAAAA//wAAAAAD//AAAAAAf/8AAAAAB//gAAAAAP/+AAAAAA//4AAAAAH//gAAAAAf/+AAAAAB//wAAAAAP//AAAAAA//8AAAAAD//gAAAAAP/+AAAAAAf/wAAAAAD//AAAAAAP/4AAAAAA//AAAAAAD/4AAAAAAP/AAAAAAA/wAAAAAABeAAAAAAABwAAAAAAAA=","h":93,"w":52},"quiscalus-quiscula":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//gAAAAAAAAAAAA//+AAAAAAAAAAAB///8AAAAAAAAAAA////wAAAAAAAAAAf////AAAAAAAAAAP////8AAAAAAAAAB/////wAAAAAAAAAAD///+AAAAAAAAAAAH///+AAAAAAAAAAAP///8AAAAAAAAAAA////8AAAAAAAAAAD////4AAAAAAAAAAP////gAAAAAAAAAB/////AAAAAAAAAAP////8AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAB/////+AAAAAAAAAP/////8AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAA///////AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAB///////AAAAAAAAP//////8AAAAAAAA///////wAAAAAAAD///////AAAAAAAAP//////4AAAAAAAA///////gAAAAAAAD///////AAAAAAAAP//////4AAAAAAAA///////wAAAAAAAD///////AAAAAAAAH//////8AAAAAAAAf/////3wAAAAAAAA//////GAAAAAAAAB/////+AAAAAAAAAB/////4AAAAAAAAAD/////AAAAAAAAAAH/5//4AAAAAAAAAAfgB//gAAAAAAAAAB8AD/+AAAAAAAAAAHgAP/4AAAAAAAAAA4AAf/gAAAAAAAAAOAAA/+AAAAAAAAADgAAB/4AAAAAAAAA4AAAH/gAAAAAAAAeAAAAf+AAAAAAAAHgAAAB/4AAAAAAAB4AAAAH/gAAAAAAAeAAAAAf+AAAAAADHgAAAAB/4AAAAAB//8AAAAH/gAAAAAL//gAAAAf+AAAAAD/g0AAAAB/4AAAAB/4AAAAAAH/gAAAAacAAAAAAAf+AAAACHAAAAAAAD/4AAAAAwAAAAAAAP/AAAAAAAAAAAAAA/8AAAAAAAAAAAAAB/gAAAAAAAAAAAAAH8AAAAAAAAAAAAAAPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":69,"w":93},"rallus-elegans":{"bits":"AAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAA/wAAAAAAAAAAAAA//AAAAAAAAAAAAAf/4AAAAAAAAAAAAP//AAAAAAAAAAAAH//4AAAAAAAAAAAH//+AAAAAAAAAAAP///wAAAAAAAAAAP///8AAAAAAAAAAf////AAAAAAAAAA/////4AAAAAAAAA/+A//+AAAAAAAAA/4AD//gAAAAAAAAfgAAP/4AAAAAAAAPAAAD//AAAAAAAADAAAAf/wAAAAAAAAAAAAH/8AAAAAAAAAAAAB//AAAAAAAAAAAAAf/4AAAAAAAAAAAAP/+AAAAAAAAAAAAD//wAAAAAAAAAAAA//+AAAAAAAAAAAAP//wAAAAAAAAAAAH///AAAAAAAAAAAB////AAAAAAAAAAAf///+AAAAAAAAAAH////8AAAAAAAAAD/////4AAAAAAAAA//////gAAAAAAAAP/////+AAADAAAAD//////wAAHwAAAA///////AAD8AAAAP//////4AD/AAAAD///////gD/wAAAA///////+D/4AAAAP/////////+AAAAB//////////AAAAAf/////////wAAAAH/////////4AAAAB/////////8AAAAAP/////////AAAAAD/////////wAAAAAf////////4AAAAAH////////+AAAAAA/////////AAAAAAP////////wAAAAAB////////4AAAAAAP///////+AAAAAAB////////AAAAAAAP///////gAAAAAAB///////wAAAAAAAP//////+AAAAAAAB///////gAAAAAAAP//////+AAAAAAAA///////wAAAAAAAH//////+AAAAAAAAf//////gAAAAAAAD//////8AAAAAAAAP//////AAAAAAAAA////j/wAAAAAAAAH///wAAAAAAAAAAA///gAAAAAAAAAAAD//wAAAAAAAAAAAAP4AAAAAAAAAAAAAB+AAAAAAAAAAAAAAfwAAAAAAAAAAAAAP8AAAAAAAAAAAAAH/AAAAAAAAAAAAADzgAAAAAAAAAAAAB44AAAAAAAAAAAAA8OAAAAAAAAAAAAAeDgAAAAAAAAAADwPB4AAAAAAAAAAB//geAAAAAAAAAAAD/+HAAAAAAAAAAP///9wAAAAAAAAAH//+dcAAAAAAAAABID+AHAAAAAAAAAAAB8ADwAAAAAAAAAAA8D//8AAAAAAAAAAIAv//AAAAAAAAAAAAH/gAAAAAAAAAAAB//wAAAAAAAAAAAB/84AAAAAAAAAAAA2A8AAAAAAAAAAAAAAeAAAAAAAAAAAAAAfAAAAAAAAAAAAAAHAAAAAAAAAAAAAADgAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":92},"rallus-limicola":{"bits":"AAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAD/gAAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAP///wAAAAAAACAAP////AAAAAAABwAH////8AAAAAAAfgD/////4AAAAAAP8B///////+AAAAD/g/wH//////AAAB/8PwAP//////AAAf/hwAA///////AAH/8AAAD//////+AD//AAAAf//////8A//4AAAD///////////AAAAf//////////wAAAD//////////8AAAAf//////////AAAAD//////////wAAAAf/////////8AAAAD//////////gAAAAf/////////8AAAAD//////////AAAAAP/////////4AAAAB/////////+AAAAAP/////////wAAAAB/////////8AAAAAH/////////gAAAAA/////////4AAAAAD/////////AAAAAAf////////8AAAAAB/////////wAAAAAP////////8AAAAAA////////+AAAAAAD////////4AAAAAAP////////gAAAAAA////////8AAAAAAD////////AAAAAAAP//////wAAAAAAAAf/////8AAAAAAAAB//////AAAAAAAAAD/////gAAAAAAAAAP////wAAAAAAAAAAP///8AAAAAAAAAAAP//+AAAAAAAAAAAAP/+AAAAAAAAAAAAAD/gAAAAAAAAAAAAD94AAAAAAAAAAAAB+eAAAAAAAAAAAD8/HgAAAAAAAAAAA//94AAAAAAAAAAAD//+AAAAAAAAAAAD/8fgAAAAAAAAAAA8fB4AAAAAAAAAAAMHg+AAAAAAAAAAAAAwf/AAAAAAAAAAAAH//oAAAAAAAAAAAA/+AAAAAAAAAAAAAD/gAAAAAAAAAAAAB+4AAAAAAAAAAAAA+OAAAAAAAAAAAAAHDgAAAAAAAAAAAABgcAAAAAAAAAAAAAACAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"recurvirostra-americana":{"bits":"AAB+AAAAAAAH+AAAAAAAf+AAAAAAB/+AAAAAAD/8AAAAAAH/8AAAAAAf/4AAAAAD//wAAAAAP//gAAAAB4P/AAAAAPAP8AAAAA4Af4AAAAHAB/wAAAAcAD/gAAAAwAP+AAAADAAf8AAAAMAB/wAAAAYAD/gAAAAgAP/AAAAAAAf+AAAAAAA/8AAAAAAB/8AAAAAAD/+AAAAAAH//AAAAAAP//AAAAAAf//wAAAAA///wAAAAB///4AAAAD///4AAAAH///4AAAAP///4AAAAf///4AAAAf///4AAAA////4AAAB////wAAAD////wAAAD////wAAAH////gAAAH////gAAAP////gAAAP////gAAAP////AAAAP////AAAAP///+AAAAP///+AAAAP////AAAAP////AAAAff///AAAAe/A/8AAAA48A/4AAAAx4AfgAAABhwAfAAAADBgAAAAAAGDAAAAAAAMGAAAAAAAMMAAAAAAAYYAAAAAAAwYAAAAAABgwAAAAAADBgAAAAAAHDAAAAAAAOHAAAAAAAcOAAAAAAA4cAAAAAABw4AAAAAADBgAAAAAAGDAAAAAAAMGAAAAAAAYMAAAAAAAwYAAAAAABgwAAAAAADBgAAAAAAGDAAAAAAAMGAAAAAAAYMAAAAAAAwYAAAAAABgwAAAAAADBAAAAAAAGCAAAAAAAMMAAAAAAA4YAAAAAABwwAAAAAADhgAAAAAAPjAAAAAAP+HAAAAAA/2eAAAAAAHH8AAAAAA494AAAAADjGYAAAAAEAYwAAAAAABgwAAAAAAGBgAAAAAAYBAAAA=","h":93,"w":53},"regulus-calendula":{"bits":"AAAAAAAAAAAAAB8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAD/+AAAAAAAAAAAAB//4AAAAAAAAAAAAf//AAAAAAAAAAAAH//4AAAAAAAAAAAB///AAAAAAAAAAAA///wAAAAAAAAAAAP//8AAAAAAAAAAAD//+AAAAAAAAAAAA///AAAAAAAAAAAP///wAAAAAAAAD/////8AAAAAAA///////+AAAAAAD////////gAAAB//////////wAAAB//////////8AAAA//////////+AAAAP//////////gAAAD//////////4AAAA//////////+AAAAP//////////wAAAD//////////8AAAA///////////gAAAH//////////4AAAB///////////8AAAP///////////+AAB////////////4AAf////////////AAD////////////wAAf///////////4AAD///////////4AAA///////////8AAAH///////////AAAB///////////gAAAf//////////4AAAH//////////+AAAA///////////wAAAEP/////////8AAAAB//////////gAAAAH/////////8AAAAA//////////AAAAAD/////////4AAAAAP////////+AAAAAA/////////wAAAAAH////////+AAAAAAf////////gAAAAAB////////4AAAAAAP///////+AAAAAAA////////gAAAAAAD///////8AAAAAAAP//////+AAAAAAAA///////wAAAAAAAB//////8AAAAAAAAH/////+AAAAAAAAAP/////gAAAAAAAAAf////gAAAAAAAAAH////4AAAAAAAAAB/f//+AAAAAAAAAAPwD+DhwAAAAAAAAD9AAA8/gAAAAAAAAfoAAP/sAAAAAAAAB/AAD/8gAAAAAAAAH4AA/wAAAAAAAAAA3AAf4AAAAAAAAAAHgAH8AAAAAAAAAAAcAB/gAAAAAAAAAAAAAP4AAAAAAAAAAAAABvIAAAAAAAAAAAAAD/AAAAAAAAAAAAAAf4AAAAAAAAAAAAADsAAAAAAAAAAAAAAYAAAAAAAAAAAAAADgAAAAAAAAAAAAAAPAAAAAAAAA=","h":76,"w":93},"regulus-satrapa":{"bits":"AAAAAAAAAAAAAB4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAP3AAAAAAAAAAAAAH//AAAAAAAAAAAAB//4AAP/AAAAAAAAf/+AAH/+AAAAAAAH//wAD//8AAAAAAD//4AB///4AAAAAA//+AAf///wAAAAAP//AAH////AAAAAD//wAB//////gAAD//4AAf//////95B//8AAH////////////AAA////////////gAAP///////////4AAP///////////8AAD////////////AAA////////////4AAAf//////////+AAAA///////////gAAAD//////////8AAAAP//////////AAAAB//////////4AAAAH/////////+AAAAAf//////////AAAAD///////////AAAAP///////////AAAB///////////8AAAP///////////AAAA///////////AAAAH/////////4AAAAA/////////4AAAAAD////////8AAAAAAf////////AAAAAAB////////4AAAAAAP///////+AAAAAAA////////wAAAAAAH///////8AAAAAAAf///////AAAAAAAB///////wAAAAAAAH//////+AAAAAAAAf//////gAAAAAAAB//////wAAAAAAAAD/////8AAAAAAAAAP/////AAAAAAAAAAf////wAAAAAAAAAAf///4AAAAAAAAAAP////AAAAAAAAAAH////wAAAAAAAAAB//4PAAAAAAAAAAAPwDHwAAAAAAAAAAB8AD8wAAAAAAAAAAHgA//gAAAAAAAAAA8Af/8AAAAAAAAAAH4H4GgAAAAAAAAAAYB/AAAAAAAAAAAABAPwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAD4AAAAAAAAAAAAAAfwAAAAAAAAAAAAADeAAAAAAAAAAAAAAOAAAAAAAAAA==","h":63,"w":93},"rhynchophanes-mccownii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAB///wAAAAAAAAAAA////AAAAAAAAAAAP///8AAAAAAAAAAAf///wAAAAAAAAAAA///+AAAAAAAAAAAH///4AAAAAAAAAAA////4AAAAAAAAAAH////4AAAAAAAAAAf////4AAAAAAAAAD/////wAAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAf/////8AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAD///////AAAAAAAAf//////+AAAAAAAD///////8AAAAAAAf///////wAAAAAAD////////gAAAAAAf////////AAAAAAD////////8AAAAAAP////////wAAAAAB/////////gAAAAAH////////+AAAAAA/////////4AAAAAD/////////wAAAAAf/////////gAAAAB//////////AAAAAH//////////AAAAAf//////////gAAAB///////////gAAAH///////////wAAAP///////////4AAA////////w///gAAB//////AAAf/4AAAD/////AAAAH/gAAAH////gAAAAD8AAAAP///wAAAAAAAAAAD///4AAAAAAAAAAH///4AAAAAAAAAAAv8H2AAAAAAAAAAAA8D4AAAAAAAAAAAAHD8AAAAAAAAAAAAB///AAAAAAAAAAAA//voAAAAAAAAAAAP/gAAAAAAAAAAAAADwAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":57,"w":93},"riparia-riparia":{"bits":"AAAAAAAAAAB/+AAAAAAAAAAAAP/+AAAAAAAAAAAB///AAAAAAAAAAAH///AAAAAAAAAAAf//+AAAAAAAAAAB///+AAAAAAAAAAD///+AAAAAAAAAAP////4AAAAAAAAA/////4AAAAAAAAB/////wAAAAAAAAH////gAAAAAAAAAP///+AAAAAAAAAA////4AAAAAAAAAD////wAAAAAAAAAP////gAAAAAAAAB/////AAAAAAAAAH////+AAAAAAAAAf////8AAAAAAAAD/////4AAAAAAAAP/////wAAAAAAAA//////gAAAAAAAD//////gAAAAAAAP//////AAAAAAAA//////+AAAAAAAD//////8AAAAAAAP//////4AAAAAAA///////gAAAAAAD///////AAAAAAAH//////+AAAAAAAf//////8AAAAAAB///////wAAAAAAH///////gAAAAAA////////AAAAAAD///////8AAAAAAP///////4AAAAAA////////gAAAAAD////////AAAAAAP///////8AAAAAA////////wAAAAAB////////AAAAAAH///////8AAAAAAf///////4AAAAAA////////gAAAAAH///////+AAAAAAf///////4AAAAAB////////gAAAAAP///////+AAAAAA////////wAAAAAD////////AAAAAAP///////8AAAAAA////////gAAAAAH///////+AAAAAAf///////wAAAAAD////////gAAAAAP////////AAAAAA////////+AAAAAD////////+AAAAAf////////8AAAAB/////////4AAAAH/////wAP/4AAAAf/////AA/3gAAAB+////4AA+HgAAADz////gAB4PAAAAAf/v/+AADg8AAAAB/8f/wAADh4AAAAH/h//AAAAPwAAAAf4D/8AAAAPAAAAB+AP/wAAAAEAAAABAA/+AAAAAAAAAAAAB/4AAAAAAAAAAAAH/gAAAAAAAAAAAAf/AAAAAAAAAAAAA/8AAAAAAAAAAAAD/4AAAAAAAAAAAAH/gAAAAAAAAAAAAf+AAAAAAAAAAAAB/8AAAAAAAAAAAAH/wAAAAAAAAAAAAP/gAAAAAAAAAAAA/+AAAAAAAAAAAAD/4AAAAAAAAAAAAH/wAAAAAAAAAAAAf/AAAAAAAAAAAAB5+AAAAAAAAAAAADj4AAAAAAAAAAAAOHgAAAAAAAAAAAAQfAAAAAAAAAAAAAA8AAAAAAAAAAAAAB4AAAAAAAAAAAAAHgAAAAAAAAAAAAAOAAAAAAAAAAAAAAcAAAAAAAAAAAAAAwAAAAAAAAAAAAA","h":93,"w":89},"rissa-tridactyla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAADgcAAAAAAAAAAAABwA4AAAAAAAAAAAAYABgAAAAAAAAAAACeAEAAAAAAAAAAAAzwAQAAAAAAAAAAAMcADAAAAAAAAAAAHcAAIAAAAAAAAAAD/gAAgAAAAAAAAAA/wAAGAAAAAAAAAAP/wAAQAAAAAAAAAB8DgABAAAAAAAAAAMAGAAMAAAAAAAAAAAAYAA4AAAAAAAAAAABgABgAAAAAAAAAAAEAAHAAAAAAAAAAAAwAAOAAAAAAAAAAACAAAcAAAAAAAAAAAYAAB4AAAAAAAAAABAAAH4AAAAAAAAAAMAAD/8AAAAAAAAAAgAD//4AAAAAAAAAEAAf//wAAAAAAAAAgAA///gAAAAAAAAEAAD///AAAAAAAAAgABf//8AAAAAAAAGAAP///4AAAAAAAAwAB////gAAAAAAAGAAP///+AAAAAAAAQAB////+AAAAAAACAAH////8AAAAAAAYAAf////8AAAAAABAAB/////wAAAAAAIAAH/////AAAAAABgAA/////+AAAAAAGAAD//////8AAAAAYAAf///////gAAABgAB///////8AAAAGAAP///////gAAAAYAA///////wAAAABgAAP/////+AAAAAHAAAB8H//+AAAAAAOAAAAAAB/4AAAAAAcAAAAD//8AAAAAAA8AAAD+B/AAAAAAAA+IBjwAAAAAAAAAAB/h/4AAAAAAAAAAAH/8AAAAAAAAAAAAAceAAAAAAAAAAAAADDgAAAAAAAAAAAAAYcAAAAAAAAAAAAADDAAAAAAAAAAAAAAYYAAAAAAAAAAAAAHDAAAAAAAAAAAAAA4YAAAAAAAAAAAAAHHAAAAAAAAAAAAAA44AAAAAAAAAAAAA//AAAAAAAAAAAAH//4AAAAAAAAAAAA///AAAAAAAAAAAAB//4AAAAAAAAAAAAOP+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAIEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":68,"w":93},"rynchops-niger":{"bits":"AAAB/AAAAAAAAAAAAAA//AAAAAAAAAAAAAf/+AAAAAAAAAAAAD//8AAAAAAAAAAAA/////wAAAAAAAAAP/////+AAAAAAAAH//////+AAAAAAAD////////gAAAAAB/////////wAAAAAf/////////gAAAAP/D////////gA/wH/gH//////////+B/gA///////////AfwAH//////////AH4AAf/////////AB8AAD/////////8AeAAAP//////////3AAAB///////////AAAAH//////////gAAAAP/////8A//4AAAAAf////wAAH4AAAAAA////4AAAAAAAAAAA///wAAAAAAAAAAAAH/wAAAAAAAAAAAAB/8AAAAAAAAAAAAAP/AAAAAAAAAAAAAB+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAHgAAAAAAAA==","h":30,"w":93},"salpinctes-obsoletus":{"bits":"AAAOAAAAAAAAAAAAAAf/gAAAAAAAAAAAAP//AAAAAAAAAAB/D//8AAAAAAAAAA/////4AAAAAAAAAH/////gAAAAAAAAAD////+AAAAAAAAAAB////wAAAAAAAAAAD////AAAAAAAAAAAf///8AAAAAAAAAAD////gAAAAAAAAAAf///+AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAH////8AAAAAAAAAA/////wAAAAAAAAAH/////AAAAAAAAAA/////8AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////wAAAAAAB////////AAAAAAAP///////8AAAAAAA////////gAAAAAAH///////+AAAAAAAf///////4AAAAAAD////////AAAAAAAP///////8AAAAAAB////////wAAAAAAH///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAP///////8AAAAAAA////////wAAAAAAD////////gAAAAAAP///////+AAAAAAA////////4AAAAAAB////////gAAAAAAH///////+AAAAAAAf///////wAAAAAAA///////+AAAAAAAA///////4AAAAAAAB///g///gAAAAAAAH//gA///AAAAAAAA/8AAAD/8AAAAAAAD/AAAAH/wAAAAAAAfwAAAAH/gAAAAAAD8AAAAAf+AAAAAAA/gAAAAA/8AAAAAAP4AAAAAD/wAAAAAB+AAAAAAP/AAAAAAfgAAAAAA/8AAAABz8PAAAAAB/wAAAAf//8AAAAAH/AAAAP///wAAAAAf4AAAH//hyAAAAAA/AAAB/eAAAAAAAABAAAAMjgAAAAAAAAAAAABA8AAAAAAAAAAAAAAPAAAAAAAAAAAAAPz8AAAAAAAAAAAAB///8AAAAAAAAAAAf///4AAAAAAAAAA//4f7AAAAAAAAAAf/8ACIAAAAAAAAAD/8AAAAAAAAAAAAAx4AAAAAAAAAAAAAAMAAAAAAAAAAAAAABAAAAAAAAAAAAAA=","h":85,"w":93},"sayornis-nigricans":{"bits":"AAAAAAAAAAAAAB8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/+AAAAAAAAAAAAH//wAD/wAAAAAAAB///AB//gAAAAAAA///wA//+AAAAAAAP//+AP//8AAAAAAH///wD///wAAAAAD///4H////AAAAAA///+D////8AAAAAf///A/////wAAAAH///gB/////+AAAD///wAA//////AAA///4AAD//////AA///4AAAP//////A///8AAAB//////////+AAAAH//////////AAAAA//////////gAAAAH/////////wAAAAAf////////8AAAAAD/////////gAAAAAf////////4AAAAAD////////+AAAAAAf////////gAAAAAD////////4AAAAAAf////////AAAAAAB////////wAAAAAAP///////8AAAAAAB////////wAAAAAAP///////+AAAAAAA////////wAAAAAAH////////gAAAAAAf///////+AAAAAAB////////8AAAAAAP////////4AAAAAA/////////gAAAAAD////////+AAAAAAP////////4AAAAAA//////gAPAAAAAAB/////wAAAAAAAAAD////8AAAAAAAAAAP////AAAAAAAAAAAP///gAAAAAAAAAAAH//8AAAAAAAAAAAAeffgAAAAAAAAAAAPAB4AAAAAAAAAAAHgAOAAAAAAAAAAAB/gDgAAAAAAAAAAB/+A4AAAAAAAAAAAfhQOAAAAAAAAAAAH4ADgAAAAAAAAAAA/AA4AAAAAAAAAAAB4AOMAAAAAAAAAAAPAD/wAAAAAAAAAAB8A/7AAAAAAAAAAAMAfAAAAAAAAAAAAAwD4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAD4AAAAAAAAAAAAAAPAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAZgAAAAAAAAAAAAABgAAAAAAAAAAAAAAMAAAAAAAAAA","h":66,"w":93},"sayornis-phoebe":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAH/+AAAAAAAAAAAAB//8AAAAAAAABwAAf//wAAAAAAAA/AAH///AAAAAAAAf/gB///8AAAAAAAP/8D////wAAAAAAH//h/////AAAAAAD//8P////8AAAAAB///AH////4AAAAA///gAP////4AAAAf//wAB/////4AAAH//4AAH/////wAAD//8AAA//////gAB//+AAAH//////gB///AAAAf//////////gAAAD//////////wAAAAP/////////4AAAAB/////////8AAAAAP/////////gAAAAB/////////4AAAAAP////////+AAAAAB/////////gAAAAAH////////4AAAAAA////////+AAAAAAH////////gAAAAAAf///////4AAAAAAD///////+AAAAAAAf///////wAAAAAAB////////gAAAAAAH///////+AAAAAAA////////8AAAAAAD////////wAAAAAAP///////+AAAAAAA//////wAAAAAAAAD/////8AAAAAAAAAH/////AAAAAAAAAAf////wAAAAAAAAAA////8AAAAAAAAAAB///+AAAAAAAAAAAD///gAAAAAAAAAAAD//wAAAAAAAAAAAAec+AAAAAAAAAAAAHAOAAAAAAAAAAAAB/jgAAAAAAAAAAAA/04AAAAAAAAAAAB/wOAAAAAAAAAAAAfwDvgAAAAAAAAAAB8A/gAAAAAAAAAAAfAf8AAAAAAAAAAAGQfwAAAAAAAAAAAAyH8AAAAAAAAAAAAAAfAAAAAAAAAAAAAAHwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAZAAAAAAAAAAAAAACMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":61,"w":93},"sayornis-saya":{"bits":"AAAAAD+AAAAAAAf/gAAAAAD//gAAAAAf//gAAAAB///wAAAAD///+AAAAP///+AAAA////4AAAB///+AAAAH///4AAAAP///gAAAA////AAAAB///+AAAAD///4AAAAP///wAAAAf///gAAAB///+AAAAH///+AAAAf///8AAAB////4AAAH////4AAAP////wAAA/////gAAD/////AAAP////+AAAf////8AAB/////8AAD/////4AAP/////wAAf/////gAB/////+AAD/////8AAP/////4AAf/////wAA//////gAD//////AAH/////8AAP/////4AA//////wAB//////AAD/////+AAP/////4AAf/////wAA//////AAB/////8AAD/////4AAH/////gAAf////+AAA/////8AAB/////wAAD/////AAAH////8AAAP////wAAAf////gAAA/////gAAB/////gAAH///9/AAAP///O+AAAf//+f8AAA///8fwAAB///wfAAADv//AMAAAPf/cAAAAAf/8AAAAAA7/4AAAAABn/wAAAAAAf/AAAAAAA/+AAAAAAB/8AAAAAAH/wAAAAAAP/gAAAAAAf/AAAAAAB/+AAAAAAD/4AAAAAAH/wAAAAAAf/gAAAAAA//AAAAAAB/8AAAAAAH/4AAAAAAP/wAAAAAAf/gAAAAAB/+AAAAAAD/8AAAAAAH/4AAAAAAP/wAAAAAA//AAAAAAB/+AAAAAAD/8AAAAAAP/wAAAAAAf/gAAAAAA//AAAAAAB/8AAAAAABwAAAAAAAAA=","h":93,"w":53},"scolopax-minor":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAH/4AAAAAAAAAAAAB//gAAAAAAAAAAAAf/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAH//+AAAAAAAAAAAA/////gAAAAAAAAAH/////4AAAAAAAAB//////4AAAAAAAA///////4AAAAAAAP///////wAAAAAAD////////gAAAAAA/f///////wAAAAAPw////////wAAAAH4H////////AAAAB+A/////////gAAAfAH////////+AAAHwA//////////wAD4AH/////////+AA+AA//////////wAPAAH/////////8ADwAA//////////+A8AAD//////////8OAAAf//////////hAAAB//////////8AAAAP//////////AAAAA////////+AAAAAAD///////8AAAAAAAP//////+AAAAAAAA///////gAAAAAAAD//////wAAAAAAAAH/////4AAAAAAAAAf////8AAAAAAAAAA////+AAAAAAAAAAA////AAAAAAAAAAAA///wAAAAAAAAAAAAP/wAAAAAAAAAAAAA/4AAAAAAAAAAAAAD+AAAAAAAAAAAAAAfwAAAAAAAAAAAAAD8AAAAAAAAAAAAAA7gAAAAAAAAAAAAAHYAAAAAAAAAAAAAB3AAAAAAAAAAAAAP+4AAAAAAAAAAAAD//AAAAAAAAAAAAB/7wAAAAAAAAAAAAO/+AAAAAAAAAAAAAF/+AAAAAAAAAAAAB//AAAAAAAAAAAAAPPAAAAAAAAAAAAAADgAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":58,"w":93},"seiurus-aurocapilla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAfgAAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/4AAAAAAAAB+AAAf/gAAAAAAAB/+AAB/+AAAAAAAB//4AAD/8AAAAAAA///wAAP/wAAAAAAP//+AAAf/gAAAAAH///4AAB/+AAAAAB////gAAD/8AAAAA////+AAAP/4AAAB/////8AAA//gAAB//////4AAD//AAB///////gAAP/+AA///////8AABv/8A///////gAAAH//////////4AAAAf/////////+AAAAB//////////gAAAAH/////////8AAAAA//////////gAAAAD/////////8AAAAAf/////////gAAAAB/////////8AAAAB//////////gAAAAP/////////8AAAAAD/////////gAAAAP/////////8AAAAP//////////gAAAD//////////8AAAAf//////////gAAAAD/////////4AAAAAB/////////AAAAAAB////////4AAAAAAH///////+AAAAAAAf///////wAAAAAAB///////8AAAAAAAH///////gAAAAAAAf//////4AAAAAAAB//////+AAAAAAAAH//////gAAAAAAAAP/////4AAAAAAAAA/////+AAAAAAAAAB/////AAAAAAAAAAD////gAAAAAAAAAAf///wAAAAAAAAAAD///wAAAAAAAAAAAfA//gAAAAAAAAAAB8GP/AAAAAAAAAAADx//4AAAAAAAAAAAPbwfgAAAAAAAAAAA8AB8AAAAAAAAAAADwAPAAAAAAAAAAAAPAA8AAAAAAAAAAAA8AHgAAAAAAAAAAADwAsAAAAAAAAAAAAPABgAAAAAAAAAAAA8GAAAAAAAAAAAACH/4AAAAAAAAAAAB//+4AAAAAAAAAAAN///wAAAAAAAAAAAAD/7AAAAAAAAAAAAAH8AAAAAAAAAAAAAAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":69,"w":93},"selasphorus-calliope":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAP/+AAAAAAAAAAAAH//4AAAAAAAAP/gD///gAAAAAAAP//////+AAAAAAAAf//////4AAAAAAAAAP/////gAAAAAAAAAD////8AAAAAAAAAAB////wAAAAAAAAAAH///+AAAAAAAAAAA////4AAAAAAAAAAD////AAAAAAAAAAAf///8AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAB////8AAAAAAAAAAP////4AAAAAAAAAB/////gAAAAAAAAAP/////AAAAAAAAAA/////8AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAD//////4AAAAAAAAf//////gAAAAAAAD//////+AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAP//////8AAAAAAAB///////gAAAAAAAH//////+AAAAAAAA///////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAB///////gAAAAAAAP//////+AAAAAAAA///////wAAAAAAAD///////gAAAAAAAP//////+AAAAAAAA///////4AAAAAAAB///////wAAAAAAAH///////AAAAAAAAP//////8AAAAAAAA///////wAAAAAAAB///////gAAAAAAAf//////+AAAAAAAD/3/v///wAAAAAAAP++A///+AAAAAAAB9/gB///4AAAAAAAHv4AD/+/gAAAAAAAA+AAP/48AAAAAAAAAAAAf/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAP8AAAAAAAAAAAAAAbgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":69,"w":93},"selasphorus-platycercus":{"bits":"AAAAAAfgAAAAAAAH/+AAA//gAAAAAAA///8B///AAAAAAAAH//////+AAAAAAAAAP/////4AAAAAAAAAH/////AAAAAAAAAAD////8AAAAAAAAAAD////gAAAAAAAAAAP///+AAAAAAAAAAA////wAAAAAAAAAAD////AAAAAAAAAAAP///4AAAAAAAAAAB////AAAAAAAAAAAP///4AAAAAAAAAAB////AAAAAAAAAAAP///4AAAAAAAAAAB////AAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAP///+AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAP////8AAAAAAAAAB/////wAAAAAAAAAP/////AAAAAAAAAB/////8AAAAAAAAAP/////wAAAAAAAAD//////AAAAAAAAAf/////8AAAAAAAAB//////gAAAAAAAAP/////+AAAAAAAAB//////4AAAAAAAAP//////gAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAH//////4AAAAAAAA///////gAAAAAAAH//////8AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAH//////8AAAAAAAA///////wAAAAAAAD//////+AAAAAAAAP//////wAAAAAAAA///////AAAAAAAAD//////4AAAAAAAAf//////gAAAAAAAB//////8AAAAAAAAH//////gAAAAAAAAP/////+AAAAAAAAA//////wAAAAAAAAP//////AAAAAAAAB//////4AAAAAAAANz/////AAAAAAAAB+f////8AAAAAAAAPz/////gAAAAAAAA//////+AAAAAAAADfx////wAAAAAAAABoH///+AAAAAAAAAAAf///4AAAAAAAAAAB////gAAAAAAAAAAD///+AAAAAAAAAAAP///4AAAAAAAAAAA////AAAAAAAAAAAD///8AAAAAAAAAAAP///wAAAAAAAAAAAf///gAAAAAAAAAAB///8AAAAAAAAAAAH///wAAAAAAAAAAAP///AAAAAAAAAAAAf//4AAAAAAAAAAAA//wAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAA//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAH+AAAAAAAAAAAAAAf4AAAAAAAAAAAAAB/AAAAAAAAAAAAAACQ=","h":91,"w":93},"selasphorus-rufus":{"bits":"AAAAAA/wAAAAAAAAAAAAB//wAAAAAAAAAAAA///AAAAAAAAP//j///8AAAAAAAf///////wAAAAAAH////////AAAAAAAAAB/////8AAAAAAAAAAP////gAAAAAAAAAAP///8AAAAAAAAAAA////wAAAAAAAAAAD///+AAAAAAAAAAAP///4AAAAAAAAAAB////AAAAAAAAAAAH///4AAAAAAAAAAA////gAAAAAAAAAAD///8AAAAAAAAAAAf///wAAAAAAAAAAD////AAAAAAAAAAAf///8AAAAAAAAAAD////wAAAAAAAAAAf////AAAAAAAAAAD////+AAAAAAAAAAP////4AAAAAAAAAB/////gAAAAAAAAAP////+AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAB/////+AAAAAAAAAP/////4AAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////wAAAAAAAAH//////AAAAAAAAA//////8AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAB//////4AAAAAAAAP//////AAAAAAAAB//////8AAAAAAAAH//////gAAAAAAAAf/////+AAAAAAAAD//////wAAAAAAAAP//////AAAAAAAAA//////4AAAAAAAAD//////AAAAAAAAAP/////8AAAAAAAAB//////gAAAAAAAAD/////+AAAAAAAAAf/////wAAAAAAAAA/////+AAAAAAAAAD/////4AAAAAAAAAP/////AAAAAAAAAAf////4AAAAAAAAAH/////gAAAAAAAAA7////+AAAAAAAAAH/////4AAAAAAAAA/7////gAAAAAAAAD/f///+AAAAAAAAAP+2///8AAAAAAAAAX8D///wAAAAAAAAAHAP///AAAAAAAAAAAA///8AAAAAAAAAAAB///wAAAAAAAAAAAH//+AAAAAAAAAAAAf//4AAAAAAAAAAAB//8AAAAAAAAAAAAH/3wAAAAAAAAAAAA/+eAAAAAAAAAAAAD/4wAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/gAAAAAAAAAAAAAH8AAAAAAAAAAAAAAfwAAAAAAAAAAAAAB+AAAAAAAAAAAAAABwAAAAAAAAAAAAAAGA","h":82,"w":93},"selasphorus-sasin":{"bits":"//gAAH/gAAAAAAAB//8AP//gAAAAAAAA//////+AAAAAAAAAH/////8AAAAAAAAAB/////wAAAAAAAAAB////+AAAAAAAAAAB////4AAAAAAAAAAH////gAAAAAAAAAAf///8AAAAAAAAAAB////gAAAAAAAAAAH///+AAAAAAAAAAA////wAAAAAAAAAAD///+AAAAAAAAAAAf///wAAAAAAAAAAD///+AAAAAAAAAAAf///wAAAAAAAAAAD////AAAAAAAAAAAf///4AAAAAAAAAAD////gAAAAAAAAAAf///8AAAAAAAAAAD////wAAAAAAAAAAf////AAAAAAAAAAD////8AAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAAf////+AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////wAAAAAAAAf//////AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAP//////8AAAAAAAA///////wAAAAAAAH//////+AAAAAAAAf//////4AAAAAAAD///////AAAAAAAAP//////8AAAAAAAB///////gAAAAAAAH//////8AAAAAAAAf//////wAAAAAAAB//////+AAAAAAAAH//////4AAAAAAAAf//////AAAAAAAAB//////4AAAAAAAAH//////gAAAAAAAAf/////8AAAAAAAAB//////gAAAAAAAAH/////+AAAAAAAAAP/////wAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////AAAAAAAAAH/////4AAAAAAAAA/z////AAAAAAAAAB/v///8AAAAAAAAAB/////gAAAAAAAAAD9///+AAAAAAAAAAIH///wAAAAAAAAAAAf//+AAAAAAAAAAAB///4AAAAAAAAAAAH///gAAAAAAAAAAAf//+AAAAAAAAAAAA///4AAAAAAAAAAAD///gAAAAAAAAAAAP//+AAAAAAAAAAAAf//4AAAAAAAAAAAA///gAAAAAAAAAAAB//+AAAAAAAAAAAAH/74AAAAAAAAAAAAf/HAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/gAAAAAAAAAAAAAB8AAAAAAAAAAAAAADg","h":89,"w":93},"setophaga-americana":{"bits":"AAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAf/AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///wAAAAAAAAAAAf///AAAAAAAAAAAP///8AAAAAAAAAAP////gAAAAAAADAB////+AAAAAAAD4AD////4AAAAAAB/AAH////gAAAAAA/7wA////+AAAAAAf//AD////8AAAAAH//8Af////+AAAAD///gD/////+AAAB///8AP/////8AAAf//+AB//////4AAP///AAH//////wAD///gAA///////wB///wAAH///////////wAAA///////////4AAAH//////////8AAAA//////////+AAAAH//////////AAAAA//////////wAAAAH/////////MAAAAA/////////zAAAAAD////////8wAAAAAf////////OAAAAAD////////7AAAAAAf////////4AAAAAB////////8AAAAAAP////////wAAAAAB/////////AAAAAAH////////+AAAAAAf////////8AAAAAD/////////4AAAAAP/////////gAAAAA/////n///+AAAAAD////wAOADgAAAAAP///8ADgAAAAAAAA////AA4AAAAAAAAD///wAOAAAAAAAAAH//+ADAAAAAAAAAAP//gB4AAAAAAAAAAf/8B8AAAAAAAAAAAf/8OAAAAAAAAAAAB//4gAAAAAAAAAAB+AB8AAAAAAAAAAA/QAfAAAAAAAAAAAf/wHgAAAAAAAAAAf/6B4AAAAAAAAAAH+AA8AAAAAAAAAAA/gAPAAAAAAAAAAAH4ADzwAAAAAAAAAAeAA//AAAAAAAAAADwB//oAAAAAAAAAAUA/wAAAAAAAAAAACwH+AAAAAAAAAAAAbAngAAAAAAAAAAABAB4AAAAAAAAAAAAAAfAAAAAAAAAAAAAADYAAAAAAAAAAAAAA6AAAAAAAAAAAAAAGYAAAAAAAAAAAAAAwAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"setophaga-caerulescens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/4AAAAAAAAAAAAB//wAAAAAAAAAAAA///gAAAAAAAAAAAP//+AAAAAAAAAAAD///8AAAAAAAAAAH////wAAAAAAAAAH/////AAAAAAAAAB/////8AAAAAAAAAD/////wAAAAAAAAAA/////AAAAAAAAAAD////+AAAAAAAAAAf////+AAAAAAAAAB/////8AAAAAAAAAP/////4AAAAAAAAA//////wAAAAAAAAH//////AAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAP//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////wAAAAAAAP///////AAAAAAAB///////8AAAAAAAP///////wAAAAAAA////////AAAAAAAH///////8AAAAAAA////////wAAAAAAD////////AAAAAAAf///////8AAAAAAB////////wAAAAAAP////////AAAAAAA////////4AAAAAAD////////gAAAAAAP///////+AAAAAAA/8X/////4AAAAAAD4AD/////gAAAAAAMAAH////+AAAAAAA4AAf////4AAAAAABwAB/////wAAAAAAHAAH/////AAAAAAAPAA////94AAAAAAAeAH/4f/zgAAAAAAAeB//wf/AAAAAAAAH////h/8AAAAAAAH///APn/wAAAAAAA///AAP//gAAAAAAP/74AAP/+AAAAAAH/wHAAAP/4AAAAAA/+BwAAAf/gAAAAAPzwAAAAA/+AAAAAB8OAAAAAD/8AAAAAPAwAAAAAP/wAAAAB4cAAAAAA//AAAAAHAAAAAAAD/8AAAAAYAAAAAAAP/wAAAADwAAAAAAA//AAAAAOAAAAAAAD/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAD+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":67,"w":93},"setophaga-castanea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAAAAAAAAAAH/+AAAAAAAAAAAAB//8AAAAAAAAAAAAf//wAAAAAAAAAAAH///AAAAAAAAAAAH///8AAAAAAAAAAH////wAAAAAAAAAB/////AAAAAAAAAAB////8AAAAAAAAAAD////wAAAAAAAAAAf////AAAAAAAAAAD/////AAAAAAAAAAf////+AAAAAAAAAD/////8AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAP//////AAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAB///////gAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAD////////AAAAAAAf///////8AAAAAAD////////wAAAAAAf////////AAAAAAD////////8AAAAAAf////////wAAAAAB/////////AAAAAAP////////8AAAAAB/////////gAAAAAH////////+AAAAAA/////////wAAAAAD////////+AAAAAAf////////8AAAAAB/////////wAAAAAP/////////AAAAAA/////////8AAAAAD/////////4AAAAAP/////////gAAAAA/////////+AAAAAD/////////4AAAAAP/////////gAAAAA/////////+AAAAAB/////////gAAAAAD/////7//+AAAAAAP////+D//8AAAAAAf////AB//4AAAAAAf///4AD//gAAAAAAP//+AAP//AAAAAAD7+HAAA//8AAAAAB8ABwAAB//4AAAAAeAAeAAAH//gAAAAP+ADgAAAf//AAAAD/4A4AAAA//8AAAA+HgOAAAAD//gAAAPwADwAAAAH/8AAAD8AAcAAAAAeAAAAAfgAHmAAAAAAAAAAG8AB/8AAAAAAAAAAdgA/3gAAAAAAAAABuAfwAAAAAAAAAAAOAH8AAAAAAAAAAABgA3gAAAAAAAAAAAMAF8AAAAAAAAAAAA4APgAAAAAAAAAAAAABsAAAAAAAAAAAAAAdgAAAAAAAAAAAAADmAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":77,"w":93},"setophaga-cerulea":{"bits":"AAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAH/wAAAAAAAAHgAAD//gAAAAAAAB8AAA///AAAAAAAA/2AAf//8AAAAAAAP/8AH///4AAAAAAD//gH////gAAAAAA//8P////+AAAAAAP//B/////wAAAAAD//wD/////AAAAAA//8AB////8AAAAAP/+AAP////4AAAAD//gAA/////8AAAA//4AAD/////8AAAP/8AAAP/////4AAH//AAAB//////wAB//wAAAH//////gA//4AAAA///////wf/+AAAAD//////////AAAAAf/////////wAAAAD/////////8AAAAAf/////////gAAAAD/////////4AAAAAf////////+AAAAAB/////////wAAAAAP////////8AAAAAB/////////AAAAAAP////////8AAAAAB/////////4AAAAAP/////////gAAAAA//////////AAAAAH/////////8AAAAAf/////////wAAAAD/////////gAAAAAP/////////AAAAAA/////////+AAAAAH/////////4AAAAAf/////////gAAAAB///////AB8AAAAAD//////wAAAAAAAAP/////8AAAAAAAAA//////AAAAAAAAAD/////gAAAAAAAAAH////4AAAAAAAAAAP///+AAAAAAAAAAAP///gAAAAAAAAAAAH//wAAAAAAAAAAAAfg7AAAAAAAAAAAAPwGwAAAAAAAAAAAD4A8AAAAAAAAAAAB8APAAAAAAAAAAAA+ADwAAAAAAAAAAAfPg8AAAAAAAAAAAH/+PAAAAAAAAAAAH/+TwAAAAAAAAAAB/AA8AAAAAAAAAAAf4APAAAAAAAAAAAD+ADzwAAAAAAAAAAfgB//AAAAAAAAAAD8B//sAAAAAAAAAAHAfwAAAAAAAAAAAA+H+AAAAAAAAAAAADBngAAAAAAAAAAAAON8AAAAAAAAAAAAAA/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAEwAAAAAAAAAAAAAAjgAAAAAAAAAAAAAGMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":73,"w":93},"setophaga-chrysoparia":{"bits":"AAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAH/gAAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAP//8AAAAAAAAAAAD///wAAAAAAAAAAB////AAAAAAAAAAH////4AAAAAAAAAB/////gAAAAAAAAAP////+AAAAAAAAAAH////4AAAAAAAAAAP////gAAAAAAAAAB////+AAAAAAAAAAH////8AAAAAAAAAAf////4AAAAAAAAAD/////wAAAAAAAAAP/////gAAAAAAAAB//////AAAAAAAAAP/////8AAAAAAAAA//////wAAAAAAAAP//////AAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////AAAAAAAAP//////8AAAAAAAB///////4AAAAAAAP///////gAAAAAAB///////+AAAAAAAH///////4AAAAAAA////////gAAAAAAH///////+AAAAAAA////////4AAAAAAD////////gAAAAAAf///////+AAAAAAB////////4AAAAAAP////////AAAAAAA////////8AAAAAAH////////4AAAAAAf////////gAAAAAA////////+AAAAAAH////////4AAAAAAf////////gAAAAAB/////////AAAAAAH////////+AAAAAAP////////8AAAAAA/////////4AAAAAB/////////wAAAAAH////+f///gAAAAAH///+AAB/+AAAAAAP///gAAH/8AAAAAA///AAAAP/4AAAAAPgPwAAAAf/gAAAAD4A+AAAAA/8AAAAB4AHgAAAAD/gAAAAeABwAAAAAH8AAAAPAAcAAAAAAEAAAADwAHAAAAAAAAAAAA/4A4AAAAAAAAAAB//gOAAAAAAAAAAAfw0DgAAAAAAAAAAD8AA4AAAAAAAAAAA/AAP+AAAAAAAAAAD4AH/4AAAAAAAAAAeAH8BAAAAAAAAAADYB/AAAAAAAAAAAAZALwAAAAAAAAAAABAA+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAB8AAAAAAAAAAAAAAIwAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"setophaga-citrina":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAD8AAAAAAAAAAAAAB/gAAAAAAAAAAAAAf/4AAAAAAAAAAAAP//gAAAAAAAAAAAD//8AAAAAAAAAAAA///AAA/4AAAAAAAf//wAAf/4AAAAAAH//8AAH//wAAAAAD//+AAD///AAAAAA///AAA///+AAAAAf//gAH////8AAAAH//wAB///////AAD//4AAH///////wH//8AAAB///////////AAAAH//////////gAAAAf/////////wAAAAD/////////8AAAAAP/////////gAAAAB/////////4AAAAAP////////+AAAAAA/////////gAAAAAD////////4AAAAAAf///////+AAAAAAD////////gAAAAAAP///////+AAAAAAB////////8AAAAAAP////////4AAAAAA/////////wAAAAAH/////////gAAAAA/////////+AAAAAD/////////gAAAAAf//////+AAAAAAAB///////AAAAAAAAH//////wAAAAAAAAf/////8AAAAAAAAB//////AAAAAAAAAD/////wAAAAAAAAAP////8AAAAAAAAAAP///+AAAAAAAAAAAf///AAAAAAAAAAAAf//8AAAAAAAAAAAfg4fgAAAAAAAAAAH/AD4AAAAAAAAAAB/8A8AAAAAAAAAAA/kgPAAAAAAAAAAAPwEDwAAAAAAAAAAB8AB4AAAAAAAAAAAPgAeAAAAAAAAAAAB/AH/AAAAAAAAAAAD4B/8AAAAAAAAAAAYA/+gAAAAAAAAAABwPwEAAAAAAAAAAAAD8AAAAAAAAAAAAAAXgAAAAAAAAAAAAAD2gAAAAAAAAAAAAAG8AAAAAAAAAAAAAAzAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"setophaga-coronata":{"bits":"AAB/AAAAAAAAAAAAAD//AAAAAAAAAAAAA//+AAAAAAAAAAAAf//4AAAAAAAAAAAH///wAAAAAAAAAB/////AAAAAAAAAA/////8AAAAAAAAAH/////wAAAAAAAAAH/////AAAAAAAAAAH////8AAAAAAAAAAf////gAAAAAAAAAD////8AAAAAAAAAAf////wAAAAAAAAAB/////AAAAAAAAAAP////+AAAAAAAAAB/////8AAAAAAAAAP/////wAAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD//////+AAAAAAAAf//////4AAAAAAAD///////gAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAP///////8AAAAAAB////////wAAAAAAH////////AAAAAAA////////8AAAAAAH////////gAAAAAAf///////+AAAAAAB////////4AAAAAAP////////gAAAAAA////////8AAAAAAD////////wAAAAAAP////////AAAAAAA////////4AAAAAAD////////gAAAAAAP///////8AAAAAAA////////gAAAAAAD///////+AAAAAAAH///////4AAAAAAAf///////gAAAAAAA///////8AAAAAAAB///////wAAAAAAAH///////AAAAAAAD///////8AAAAAAAf///////gAAAAAAD7//////+AAAAAAAcHP/j///4AAAAAAHA4/AH///AAAAAAA4DP4Af//oAAAAAAHx/+AA//+AAAAAAAcH8AAB//4AAAAAAAD8AAAD//gAAAAAAD+AAAAD/+AAAAAAB+AAAAAH/4AAAAAAf/AAAAAf/gAAAAAP/8AAAAB/+AAAAAB8HgAAAAH/4AAAAAfgcAAAAAf/gAAAAD4HAAAAAB/+AAAAAfAAAAAAAP/4AAAAD8AAAAAAA//gAAAA/gAAAAAAD/8AAAAGwAAAAAAAP/wAAAAzwAAAAAAA//AAAADMAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAAf/AAAAAAAAAAAAAB/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAAeAAAAAAAAAAAAAABgA=","h":84,"w":93},"setophaga-discolor":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAfngAAAAAAAAAAAAP/8AAAAAAAAAAAAD//gAAAAAAAAAAAA//8AAAAAAAAAAAAP//AAAAAAAAAAAAH//gAAAAAAAAAAAB//4AAAAAAAAAAAAf/+AAAH/gAAAAAAH//AAAH//gAAAAAB//wAAB///AAAAAAf/8AAA///8AAAAAH/+AAAP///4AAAAD//gAAD/////AAAB//wAAD//////+AA//8AAB////////h//+AAAP///////////gAAAH//////////4AAAAP//////////AAAAB//////////wAAAAH/////////+AAAAA//////////gAAAAD/////////4AAAAAP/////////AAAAAB/////////wAAAAAH////////8AAAAAA/////////wAAAAAH/////////gAAAAA//////////gAAAAH//////////AAAAAf/////////8AAAAD//////////gAAAAf////////4AAAAAB////////wAAAAAAP///////4AAAAAAA///////+AAAAAAAD///////wAAAAAAAf//////8AAAAAAAB///////AAAAAAAAH//////wAAAAAAAAf/////8AAAAAAAAA//////AAAAAAAAAD/////gAAAAAAAAAH////4AAAAAAAAAAH////AAAAAAAAAAAH///4AAAAAAAAAAAD/weAAAAAAAAAAAA8AHgAAAAAAAAAAAeAB4AAAAAAAAAAAP4AcAAAAAAAAAAAD/wHAAAAAAAAAAAA/+DwAAAAAAAAAAAPgQ8AAAAAAAAAAAD4APcAAAAAAAAAAAfAD/wAAAAAAAAAAD4A/7AAAAAAAAAAAPAfAQAAAAAAAAAABuH4AAAAAAAAAAAAMg/AAAAAAAAAAAAA4HwAAAAAAAAAAAADAfAAAAAAAAAAAAAADYAAAAAAAAAAAAAAbwAAAAAAAAAAAAADAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"setophaga-dominica":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//wAAAAAAAAAAAD///AAAAAAAAAAAA///+AAAAAAAAAAAP///8AAAAAAAAAAD/////AAAAAAAAAA/////8AAAAAAAAAH/////AAAAAAAAAD////4AAAAAAAAAD////+AAAAAAAAAB/////gAAAAAAAAA/////4AAAAAAAAAf/////AAAAAAAAAP/////wAAAAAAAAD/////+AAAAAAAAB//////gAAAAAAAAf/////4AAAAAAAAH//////AAAAAAAAB//////4AAAAAAAA///////AAAAAAAAf//////4AAAAAAAH//////+AAAAAAAB///////wAAAAAAAf////j/+AAAAAAAH////8f/wAAAAAAB////+B/+AAAAAAAf////wP/gAAAAAAH////8B/8AAAAAAB////+AP/gAAAAAAP////AA/4AAAAAAD////AAH/AAAAAAA////gAA/wAAAAAAD///wAAD+AAAAAAA///+AAAegAAAAAAP///wAADsAAAAAAD///+AAAbAAAAAAA////wAAAwAAAAAAf///+AAAMAAAAAAH////wAADAAAAAAD////8AAAwAAAAAA//B//AAAMAAAAAAP/wD/wAAPAAAAAAD38B/4AADgAAAAAAZ/D4/AADwAAAAAAAf38AYYD4AAAAAAAP/wADH//4AAAAAAD/8AAZjA/wAAAAAA//AAB8AD/gAAAAAP/wAADwB58AAAAAD/8AAAPAOHgAAAAA//AAAA8BA8AAAAAP/wAAAB4APAAAAAD/8AAAAHgB4AAAAA//AAAAAeAGAAAAAP/wAAAAB4BwAAAAD+8AAAAAH4AAAAAA/vAAAAAH/gAAAAAP7gAAAAB5+AAAAAB/4AAAAAMHwAAAAAHIAAAAAAAeAAAAAAAAAAAAAAHAAAAAAAAAAAAAAB4AAAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"setophaga-fusca":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAD///gAAAAAAAAAAB///+AAAAAAAAAAA////wAAAAAAAAAAP////AAAAAAAAAAD////4AAAAAAAAAAB////AAAAAAAAAAAH///8AAAAAAAAAAA////gAAAAAAAAAAP///8AAAAAAAAAAD////gAAAAAAAAAB////8AAAAAAAAAA/////gAAAAAAAAA/////8AAAAAAAAAP/////gAAAAAAAAH/////8AAAAAAAAB//////gAAAAAAAA//////8AAAAAAAAP//////gAAAAAAAD//////8AAAAAAAA///////gAAAAAAAP//////8AAAAAAAD///////gAAAAAAA///////8AAAAAAAf///////gAAAAAAP///////8AAAAAAD////////gAAAAAA////////8AAAAAAP////////gAAAAAD////////4AAAAAA/////////AAAAAAP////////4AAAAAD////////+AAAAAA/////////wAAAAAP////////+AAAAAD/////////gAAAAAf////////8AAAAAH/////////AAAAAA/////////wAAAAAP////////+AAAAAH/////////gAAAAB/////////4AAAAAf////////+AAAAAP/////////gAAAAD/////////4AAAAA/////////+AAAAAH/////////gAAAAAf////////wAAAAAP////////8AAAAAD////////+AAAAAA/////////AAAAAAP////////gAAAAAD///7////wAAAAAAZ//8H///wAAAAAAAf/+AB///gAAAAAAH/+AAH7A/AAAAAAD/+AAA/AB+AAAAAA//gAAA8AD8AAAAAP/4AAADwAH4AAAAD/+AAAAPgf//AAAA//gAAAAeD//8AAAP/4AAAAB43f/gAAD/+AAAAAHmAP8AAA//gAAAAAeAA/AAAP/4AAAAAB/8D8AAD/+AAAAAP//wdgAB//gAAAAD//+AuAAP/wAAAAAf5/gNwAD/8AAAAACAH8AEAA//AAAAAAAAPgBgAH/wAAAAAAAB+AAAB/8AAAAAAAAHwAAAP/AAAAAAAAAXAAAD/wAAAAAAAAG4AAAPYAAAAAAAAADAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":84,"w":93},"setophaga-magnolia":{"bits":"AAAAAAA/AAAAAAAAAf/4AAAAAAAD//8AAAAAAAP//8AAAAAAA///8AAAAAAD////AAAAAAP////8AAAAA/////8AAAAD/////4AAAAH////8AAAAAf////AAAAAA////8AAAAAD////wAAAAAH////gAAAAAf///+AAAAAA////8AAAAAD////4AAAAAP////wAAAAA/////gAAAAD////+AAAAAP////8AAAAA/////8AAAAD/////4AAAAP/////wAAAA//////gAAAD//////AAAAP/////+AAAAf/////8AAAB//////4AAAD//////wAAAP//////gAAAf//////AAAB//////+AAAD//////4AAAP//////wAAA///////gAAB//////+AAAD//////8AAAP//////4AAAf//////gAAB///////AAAD//////8AAAH//////4AAAf//////gAAA//////+AAAB//////8AAAH//////wAAAP//////AAAAf/////8AAAA//////wAAAD//////gAAAH//////gAAAP//////AAAAf//////AAAA//////+AAAB//////8AAAH//////wAAAP////z/AAAA/////H4AAAB////+DgAAAH7///8AAAAAP3///wAAAAAff///gAAAAA8///4AAAAADx//jwAAAAAHD/+AAAAAAAeH/4AAAAAAA4f/gAAAAAABg//AAAAAAADD/+AAAAAAAEH/4AAAAAAAAP/wAAAAAAAA//gAAAAAAAB/+AAAAAAAAH/8AAAAAAAAP/4AAAAAAAAf/gAAAAAAAB//AAAAAAAAD/+AAAAAAAAP/8AAAAAAAAf/wAAAAAAAA//gAAAAAAAD//AAAAAAAAH/+AAAAAAAAP/4AAAAAAAA//wAAAAAAAB//gAAAAAAAD/+AAAAAAAAP/8AAAAAAAAf/4AAAAAAAA//gAAAAAAAB+/AAAAAAAABwcAAAAAAAAA","h":93,"w":65},"setophaga-nigrescens":{"bits":"AAAAAAAAAAAAABAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAPwAAAAAAAAAAAAAD+AAAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//4AAAAAAAAAAAA//+AAAAAAAAAAAAH//wAAAAAAAAAAAB//8AAAAAAAAAAAAf//AAAAAAAAAAAAH//wAAAAAAAAAAAB//8AAAAAAAAAAAAP/+AAAAAAAAAAAAD//gAAAAAAAAAAAA//4AAAAAAAAAAAAP/+AAAAAAAAAAAAD//gAAAAAAAAAAAA//4AAAAAAAAAAAAH/+AAAAAAAAAAAAH//gAAAAAAAAAAAH//4AAAAAAAAAAAH//8AAAAAP/AAAAP///AAAAAP//AAAf///wAAAAH//8AAP///+AAAAB///4H/////gAAAAf/////////8AAAAH//////////AAAAB//////////4AAAB//////////+AAAB///////////wAAA///////////+AAAH///////////gAAAAf///////////AAAB///////////8AAAH///////////AAAAf//////////wAAAB//////////wAAAAH/////////4AAAAA/////////8AAAAAD////////+AAAAAAP////////gAAAAAB////////8AAAAAAH////////AAAAAAA////////4AAAAAAH////////AAAAAAAf///////wAAAAAAB///////8AAAAAAAP///////gAAAAAAA///////4AAAAAAAD///////AAAAAAAAf//////wAAAAAAAB//////8AAAAAAAAH//////AAAAAAAAAf/////wAAAAAAAAA/////+AAAAAAAAAD/////wAAAAAAAAAH/////AAAAAAAAAAH///HwAAAAAAAAAAH//AeAAAAAAAAAAAAPAHAAAAAAAAAAAABwAwAAAAAAAAAAAA8AOAAAAAAAAAAAAPADgAAAAAAAAAAAD/w4AAAAAAAAAAAA/+HAAAAAAAAAAAAH/ZwAAAAAAAAAAAB4Cc8AAAAAAAAAAAPAH/wAAAAAAAAAAD4A/2AAAAAAAAAAA+APgQAAAAAAAAAAHwB4AAAAAAAAAAAA/AfAAAAAAAAAAAAH6HwAAAAAAAAAAAAfw+AAAAAAAAAAAABsH4AAAAAAAAAAAAPAvQAAAAAAAAAAAAYH+AAAAAAAAAAAAAAdgAAAAAAAAAAAAAA8AAAAAAAAAAAAAADgAAAAAAA","h":82,"w":93},"setophaga-occidentalis":{"bits":"AAAAAAAAAAAB+AAAAAAAAAAAAAD/+AAAAAAAAAAAAB//8AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAD///8AAAAAAAAAAB////+AAAAAAAAAAP////+AAAAAAAAAD/////4AAAAAAAAB/////8AAAAAAAAAf////8AAAAAAAAAf////+AAAAAAAAAP/////gAAAAAAAAH/////8AAAAAAAAB//////AAAAAAAAA//////wAAAAAAAAP/////+AAAAAAAAH//////wAAAAAAAB//////8AAAAAAAAf//////gAAAAAAAH//////8AAAAAAAB///////gAAAAAAAf//////4AAAAAAAP///////AAAAAAAD///////4AAAAAAA////////AAAAAAAf///////4AAAAAAH///////+AAAAAAB////////wAAAAAAf///////+AAAAAAH////////gAAAAAB////////8AAAAAAP////////AAAAAAD////////4AAAAAAf///////+AAAAAAH////////gAAAAAA////////4AAAAAAf////////AAAAAAP////////wAAAAAD////////8AAAAAB/////////AAAAAAf////////gAAAAAH////////4AAAAAD////////+AAAAAA/////////AAAAAAP////////+AAAAAAD////////+AAAAAA///n///7/wAAAAAf/+AP//4/+AAAAAH/+AAP/wPzwAAAAB//AAB/AB2+AAAAAf/wAAH8AM/wAAAAP/8AAAD4B38AAAAD/+AAAAHwHOAAAAA//gAAAAfAPwAAAAP/4AAAAA+A4AAAAD/+AAAAAD8AAAAAA//gAAAAAH4AAAAAP/4AAAAAH/gAAAAD/+AAAAAD/8AAAAA//gAAAAA9vgAAAAH/4AAAAAHN8AAAAA/+AAAAAAj/gAAAAH/gAAAAAGf8AAAAA5wAAAAAAx+AAAAAAAAAAAAAATwAAAAAAAAAAAAAD8AAAAAAAAAAAAAAGAAAAAAA=","h":68,"w":93},"setophaga-palmarum":{"bits":"AAAAAAAfgAAAAAAAAAA//gAAAAAAAAAf//AAAAAAAAAH//+AAAAAAAAD///4AAAAAAAA////wAAAAAAAP////AAAAAAH/////8AAAAAH//////wAAAAA//////+AAAAAA//////4AAAAAAf/////gAAAAAA/////+AAAAAAD/////wAAAAAAf////+AAAAAAD/////4AAAAAAP/////AAAAAAB/////8AAAAAAP/////gAAAAAA/////8AAAAAAH/////wAAAAAAf////+AAAAAAD/////4AAAAAAf/////gAAAAAH/////8AAAAAD//////wAAAAA///////AAAAAP//////4AAAAB///////gAAAAf//////8AAAAH///////wAAAA///////+AAAAP///////wAAAB////////AAAAf///////4AAAD////////AAAA////////4AAAH////////AAAA////////4AAAP////////AAAD////////4AAAf////////AAAH////////wAAA////////+AAAP////////wAAB////////+AAAf////////wAAD////////8AAAf////////gAAH////////8AAA/////////AAAP////////4AAB////////+AAAP////////gAAB////////4AAAf///////+AAAD////////wAAAf///////8AAAD////////AAAA////////gAAAH///////wAAAA///////8AAAAH//////+AAAAA///////+AAAAP///////8AAAB////////wAAAP/////wP+AAAD/+f//ADv4AAA//w8AAAf/AAAP/8DgAAHf8AAD//AOAAA7/gAAf/4B4AAH/8AAH/+AHAAA/5gAB//gA8AAD4MAAf/8ADgAAPBgAH//AAOAAAAYAB//wABwAAAAAAP/+AAHAAAAAAD//gAA+AAAAAA//4AAD/AAAAAP//AAAf8AAAAB//wAAB/wAAAAf/8AAAP+AAAAH//AAAL+YAAAA/3wAAB/2AAAAH8AAAAPegAAAA8AAAAA/wAAAAAAAAAAH+AAAAAAAAAAA/gAAAAAAAAAAB8AAAAAAAAAAADAAAAAAAAAAAD4AAAAAAAAAAAOAAAAAA=","h":93,"w":75},"setophaga-pensylvanica":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAPgAAAAAAAAAAAAAD8AAAAAAAAAAAAAB/gAAAAAAAAAAAAAf/4AAD/gAAAAAAAH//gAD//AAAAAAAB//8AA//+AAAAAAA///gAf//4AAAAAAP//4AH///wAAAAAD//8AH////AAAAAA///AH////8AAAAAP//wB/////wAAAAD//4AD/////4AAAA//8AAB/////+AAAP//AAAP//////AAH//gAAAf/////+AD//wAAAD//////+P//8AAAAP/////////+AAAAB//////////gAAAAH/////////4AAAAA//////////AAAAAH/////////wAAAAAf////////8AAAAAD/////////gAAAAAf////////4AAAAAB////////+AAAAAAP////////8AAAAAB/////////8AAAAAH/////////wAAAAA//////////AAAAAH////////gQAAAAAf////////AAAAAAD////////8AAAAAAP////////8AAAAAB//n//////wAAAAAH/4f//////AAAAAAf8A//////8AAAAAB/AD///+ABAAAAAAHwAE///gAAAAAAAAcAAAf/4AAAAAAAABwAAAP+AAAAAAAAADgAAA/AAAAAAAAAAHAAADwAAAAAAAAAAPAAAcAAAAAAAAAAAPwH5gAAAAAAAAAAA///sAAAAAAAAAAAf4APAAAAAAAAAAAP/wDwAAAAAAAAAAD4eA4AAAAAAAAAAAfAQOAAAAAAAAAAADwADgAAAAAAAAAAAeAA4AAAAAAAAAAABwAOAAAAAAAAAAAAPADgAAAAAAAAAAAAwA78AAAAAAAAAAADAP/gAAAAAAAAAAAAP8WAAAAAAAAAAAAD8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAC8AAAAAAAAAAAAAAHAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPgAAAAAAAAAAAAABvAAAAAAAAAAAAAAEAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"setophaga-petechia":{"bits":"AAAAAAAAAAAAABwAAAAAAAAAAAAAA/wAAAAAAAAAAAAAP+AAAAAAAAAAAAAD//AAAAAAAAAAAAA//4AAAAAAAAAAAAP//AAAAAAAAAAAAD//wAAAAAAAAAAAA//+AAD/wAAAAAAAP//gAB//wAAAAAAD//4AA///gAAAAAA//8AAP///AAAAAAP//AAD///8AAAAAD//wAA////4AAAAA//8AB/////gAAAAP/+AB///////gAAH//gA////////4AP//4AH////////////8AAD////////////gAAB///////////4AAAH//////////+AAAA///////////wAAAD//////////8AAAAP//////////gAAAA//////////4AAAAH//////////AAAAAf/////////wAAAAB/////////+AAAAAP/////////gAAAAA/////////4AAAAAD/////////wAAAAAf/////////gAAAAD//////////gAAAAP//////////AAAAB//////////8AAAAH//////////gAAAA//////////4AAAAD////////wAAAAAAf///////4AAAAAAB///////+AAAAAAAH///////wAAAAAAAf//////8AAAAAAAB///////AAAAAAAAD//////wAAAAAAAAP/////+AAAAAAAAAf/////wAAAAAAAAA/////+AAAAAAAAAA////PgAAAAAAAAAA///DwAAAAAAAAAAP/kA8AAAAAAAAAAH/4APAAAAAAAAAAB/PADwAAAAAAAAAAfgYA8AAAAAAAAAAD8HAPAAAAAAAAAAAfkADwAAAAAAAAAAD/gA94AAAAAAAAAAP4AP/gAAAAAAAAAAwAD/8AAAAAAAAAAD4B+BgAAAAAAAAAAPAPwYAAAAAAAAAAAAD+AAAAAAAAAAAAAAb6AAAAAAAAAAAAAB/8AAAAAAAAAAAAAD/AAAAAAAAAAAAAAP4AAAAAAAAAAAAABgAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAcAAAAAAA=","h":68,"w":93},"setophaga-pinus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///gAAAAAAAAAAH////4AAAAAAAAAA/////gAAAAAAAAAf////wAAAAAAAAAH////gAAAAAAAAAH////8AAAAAAAAAD/////AAAAAAAAAB/////4AAAAAAAAAf/////AAAAAAAAAP/////wAAAAAAAAD/////+AAAAAAAAB//////wAAAAAAAAf/////8AAAAAAAAP//////gAAAAAAAD//////8AAAAAAAA///////gAAAAAAAP//////8AAAAAAAH///////gAAAAAAB///////8AAAAAAAf///////gAAAAAAH///////8AAAAAAD////////AAAAAAB////////4AAAAAA/////////AAAAAAf////////wAAAAAH////////+AAAAAD/////////gAAAAD/////////4AAAAD//v//////+AAAAB//j///////gAAAB//x///////4AAAA///f//////+AAAA//4H///////gAAAf/8D///////4AAAP/+A/4P////8AAAB//AH4Af////gAAAH/AA4AAf////AAAB/gAAAAAf///8AAAHwAAAAAD//8fgAAAgAAAAAAL8HB4AAAAAAAAAAAD4wOAAAAAAAAAAAAH0DwAAAAAAAAAAAAfgGAAAAAAAAAAAA//BwAAAAAAAAAAAPD8IAAAAAAAAAAABwPgAAAAAAAAAAAAMB0AAAAAAAAAAAAAguAAAAAAAAAAAAAAH4AAAAAAAAAAAAAAPAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":60,"w":93},"setophaga-pitiayumi":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//AAAAAAAAAAAAB//+AAAAAAAAAAAA///4AAAAAAAAAAAP///gAAAAAAAAAAD////gAAAAAAAAAAf////gAAAAAAAAAH////8AAAAAAAAAB////+AAAAAAAAAAP///8AAAAAAAAAAD////AAAAAAAAAAA////4AAAAAAAAAAf///+AAAAAAAAAAP////wAAAAAAAAAH////8AAAAAAAAAD/////gAAAAAAAAA/////4AAAAAAAAAf/////AAAAAAAAAH/////4AAAAAAAAD//////AAAAAAAAA//////4AAAAAAAAP//////AAAAAAAAD//////4AAAAAAAA///////AAAAAAAAP//////4AAAAAAAH//////+AAAAAAAB///////wAAAAAAAf//////+AAAAAAAH///////wAAAAAAB///////+AAAAAAAf///////gAAAAAAH///////8AAAAAAB////////AAAAAAAf///////4AAAAAAD///////+AAAAAAB////////wAAAAAA////////8AAAAAAP////////AAAAAAD////////wAAAAAA7///////8AAAAAAB////////AAAAAAAf///////wAAAAAAH///////8AAAAAAB////////AAAAAAA////////gAAAAAAP///////wAAAAAAD//+f///4AAAAAAB//4A///4AAAAAAAf/wAAP/8AAAAAAAP/4AAB/z8AAAAAAD/+AAAPgD4AAAAAA//gAAB+AHwAAAAAf/4AAAB8Dv0AAAAH/+AAAADw//4AAAB//gAAAAPt//gAAAf/4AAAAAeAH+AAAH/8AAAAAd/gOwAAA//AAAAAH/+AaAAAH/wAAAAAv/wCAAAB/8AAAAAEB/gAAAAP+AAAAAAAD8AAAAAbgAAAAAAAGgAAAAAAAAAAAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":67,"w":93},"setophaga-ruticilla":{"bits":"AAD8AAAAAAAAAAAAAD/+AAAAAAAAAAAAB//8AAAAAAAAAAAAf//wAAAAAAAAAAAH///AAAAAAAAAAAP///8AAAAAAAAAAf////4AAAAAAAAAH/////AAAAAAAAAAf////8AAAAAAAAAAP////wAAAAAAAAAAf////AAAAAAAAAAB////4AAAAAAAAAAP////gAAAAAAAAAB////+AAAAAAAAAAP////4AAAAAAAAAA/////wAAAAAAAAAH/////gAAAAAAAAA/////+AAAAAAAAAD/////8AAAAAAAAAf/////wAAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAf//////gAAAAAAAD///////AAAAAAAAf//////8AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////AAAAAAAP///////8AAAAAAB////////4AAAAAAP////////AAAAAAA////////8AAAAAAH////////wAAAAAA/////////AAAAAAD////////4AAAAAAP////////gAAAAAB////////+AAAAAAH////////4AAAAAA/////////gAAAAAD////////+AAAAAAP////////wAAAAAA/////////AAAAAAD////////4AAAAAAP////////AAAAAAA////////4AAAAAAD////////gAAAAAAH///////+AAAAAAAf///////4AAAAAAA////////wAAAAAAB////////AAAAAAB////////4AAAAAAf////////wAAAAAH/////////AAAAAA+D3//////8AAAAAHgOB/4P//ngAAAAA8DwA+A//+MAAAAAHgCAPwB//4AAAAAA8AAHwAD//AAAAAAHoAB4AAD/8AAAAAA/AA+AAAP/wAAAAADgAPAAAA//AAAAAAAAHwAAAD/8AAAAAAAD4AAAAP/wAAAAAAA/wAAAA//AAAAAAA//4AAAD/8AAAAAAH4/gAAAP/wAAAAAB+A8AAAB//AAAAAAPgGgAAAH/8AAAAAB8BwAAAAf/gAAAAAHgIAAAAB/+AAAAAA8AAAAAAH/4AAAAADgAAAAAAf/gAAAAAMAAAAAAB/8AAAAAB4AAAAAAH/wAAAAADAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAD3AAAAAAAAAAAAAAEA=","h":83,"w":93},"setophaga-striata":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAPwAAAAAAAAAAAAAD+AAAAAAAAAAAAAB/sAAAAAAAAAAAAA//8AAAAAAAAAAAAP//gAAAAAAAAAAAH//8AAAAAAAAAAAB///AAAAAAAAAAAA///gAAH8AAAAAAAf//wAAD/8AAAAAAH//4AAB//wAAAAAD//8AAAf//gAAAAA//+AAAH//+AAAAA///AAAB///8/gAAf//gAAD///////gf//wAAB///////////4AAAP//////////8AAAAP//////////AAAAAf/////////wAAAAB//////////wAAAAH//////////AAAAA//////////wAAAAD////////+AAAAAAf/////////wAAAAB//////////gAAAAP/////////8AAAAA/////////8AAAAAH////////4AAAAAA////////4AAAAAAH///////8AAAAAAAf///////AAAAAAAD///////wAAAAAAAP//////8AAAAAAAB///////gAAAAAAAH//////4AAAAAAAAf/////+AAAAAAAAB//////gAAAAAAAAH/////4AAAAAAAAAf////+AAAAAAAAAB/////gAAAAAAAAAD////wAAAAAAAAAAH////AAAAAAAAAAAH///wAAAAAAAAAAAD/weAAAAAAAAAAAB8AHgAAAAAAAAAAA/gBwAAAAAAAAAAA//AcAAAAAAAAAAAP/4HAAAAAAAAAAAB+BBwAAAAAAAAAAAPgAeAAAAAAAAAAAB8AHoAAAAAAAAAAAPgB/4AAAAAAAAAAB/D//AAAAAAAAAAAO4fwAAAAAAAAAAAAwH8AAAAAAAAAAAADA/gAAAAAAAAAAAAAB4AAAAAAAAAAAAAAfAAAAAAAAAAAAAAD8AAAAAAAAAAAAAAZ4AAAAAAAAAAAAADGAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"setophaga-tigrina":{"bits":"AAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAf+AAAAAAAAAAAAAP/8AAAAAAAAAAAAD//wAAAAAAAAAAAA///AAAAAAAAAAAAP//+AAAAAAAAAAAH///4AAAAAAAADgH/////8AAAAAAP+B//////+AAAAAf/gD///////wAAA//8AD///////8AB///4Af///////8H////gB/////////////8AH////////////+AAf///////////+AAD///////////4AAAP//////////gAAAB/////////+AAAAAH////////zwAAAAA////////w/gAAAAH/////////+AAAAAf////////jgAAAAD/////////AAAAAAf////////+AAAAAB/////////4AAAAAP////////+AAAAAA///////4AAAAAAAD//////8AAAAAAAAP//////AAAAAAAAB//////wAAAAAAAAH/////8AAAAAAAAAf/////AAAAAAAAAA/////wAAAAAAAAAB////4AAAAAAAAAAD///8AAAAAAAAAAAD///AAAAAAAAAAAAH/z4AAAAAAAAAAAA4x+AAAAAAAAAAAAHH+AAAAAAAAAAAAAw/AAAAAAAAAAAAADfgAAAAAAAAAAAAAPwAAAAAAAAAAAAAD/AAAAAAAAAAAAAAe8AAAAAAAAAAAAADrgAAAAAAAAAAAAAfMAAAAAAAAAAAAAD/AAAAAAAAAAAAAAOQAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":52,"w":93},"setophaga-townsendi":{"bits":"AAAAAAAAAAA//AAAAAAAAAAAAAf/+AAAAAAAAAAAAP//8AAAAAAAAAAAD///wAAAAAAAAAAA////gAAAAAAAAAAP////8AAAAAAAAAH/////4AAAAAAAAA//////AAAAAAAAAP/////gAAAAAAAAD/////AAAAAAAAAA/////AAAAAAAAAAf////4AAAAAAAAAf////+AAAAAAAAAP/////gAAAAAAAAD/////8AAAAAAAAB//////AAAAAAAAA//////4AAAAAAAAP/////+AAAAAAAAD//////wAAAAAAAA//////8AAAAAAAAf//////gAAAAAAAH//////4AAAAAAAB///////AAAAAAAA///////4AAAAAAAP///////AAAAAAAD///////4AAAAAAA///////+AAAAAAAP///////wAAAAAAD///////+AAAAAAA////////gAAAAAAP///////8AAAAAAD////////AAAAAAA////////4AAAAAAP///////+AAAAAAB////////wAAAAAAf///////8AAAAAAD////////AAAAAAA////////wAAAAAAP///////8AAAAAAH////////AAAAAAB////////wAAAAAA////////4AAAAAAP///////+AAAAAAD////////gAAAAAA////////wAAAAAAP///////4AAAAAAAP//n////wAAAAAAD//AP////wAAAAAB/+AAH///+AAAAAAf/gAA////4AAAAAH/4AAB//5/AAAAAB/+AAAAf+v4AAAAA//gAAAA/H+AAAAAP/4AAAAB+fwAAAAD/+AAAAAD88AAAAA//AAAAAP//AAAAAP/wAAAAD//gAAAAB/8AAAAAeH8AAAAAf/AAAAACFvgAAAAD/wAAAAAYt8AAAAAf8AAAAADH/AAAAAH/AAAAAAAfwAAAAA7wAAAAAAAeAAAAAAMAAAAAAAPgAAAAA","h":64,"w":93},"setophaga-virens":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAAAAAH4AAAP/AAAAAAAAD/AAAD//AAAAAAAA//8AB//8AAAAAAAf//gAf//wAAAAAAH//8AH///gAAAAAB///AB///+AAAAAA///wD////4AAAAAP//4B/////gAAAAH//8AP//////4AAB//+AAP//////++A///AAAP///////////gAAA///////////wAAAH//////////4AAAAf/////////+AAAAD//////////gAAAAf/////////YAAAAB/////////2AAAAAP////////4gAAAAA/////////4AAAAAH/////////8AAAAA//////////4AAAAD//////////gAAAAf/////////8AAAAD/////////4AAAAAf////////wAAAAAB////////4AAAAAAP///////+AAAAAAA////////gAAAAAAH///////4AAAAAAAf//////+AAAAAAAD///////gAAAAAAAP//////8AAAAAAAA///////AAAAAAAAD//////wAAAAAAAAP/////8AAAAAAAAA//////AAAAAAAAAB/////wAAAAAAAAAB////4AAAAAAAAAAB////AAAAAAAAAAAA//z4AAAAAAAAAAAfgAfAAAAAAAAAAAPwAHwAAAAAAAAAAP/wB4AAAAAAAAAAB+PAeAAAAAAAAAAAfgIHAAAAAAAAAAAD4ADwAAAAAAAAAAAPAA8AAAAAAAAAAAA8Af8AAAAAAAAAAAH4P/wAAAAAAAAAAAeD8PAAAAAAAAAAAAg/gYAAAAAAAAAAAAH4AAAAAAAAAAAAAAfAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAPAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAPwAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAA==","h":63,"w":93},"sialia-currucoides":{"bits":"AAAAAAAAAAAfwAAAAAAAAAAAAA//4AAAAAAAAAAAAf//wAAAAAAAAAAAH///AAAAAAAAAAAB///8AAAAAAAAAAA////wAAAAAAAAAAH////AAAAAAAAAAB////8AAAAAAAAAAf////wAAAAAAAAAH/////wAAAAAAAAA//////gAAAAAAAAP/////+AAAAAAAAD//////4AAAAAAAAf/////wAAAAAAAAH/////AAAAAAAAAB/////gAAAAAAAAAf////4AAAAAAAAAH////+AAAAAAAAAD/////gAAAAAAAAA/////8AAAAAAAAAP/////AAAAAAAAAH/////4AAAAAAAAB/////+AAAAAAAAAf/////wAAAAAAAAH/////+AAAAAAAAB//////wAAAAAAAAf/////+AAAAAAAAH//////wAAAAAAAB//////+AAAAAAAAf//////wAAAAAAAH//////+AAAAAAAA///////gAAAAAAAP//////8AAAAAAAD///////gAAAAAAA///////8AAAAAAAH///////gAAAAAAB///////8AAAAAAAf///////AAAAAAAD///////4AAAAAAA////////AAAAAAAP///////wAAAAAAD///////+AAAAAAAf///////gAAAAAAH///////8AAAAAAB////////AAAAAAAP///////wAAAAAAD///////+AAAAAAAf///////gAAAAAAD///////4AAAAAAA///////+AAAAAAAH///////gAAAAAAB///////8AAAAAAAP///////AAAAAAAB///////wAAAAAAAP//////8AAAAAAAB//////+AAAAAAAAf//////gAAAAAAAH//////4AAAAAAAA//////+AAAAAAAAP//////AAAAAAAAD//////wAAAAAAAA//////8AAAAAAAAP//////AAAAAAAAD//////wAAAAAAAAf/////+AAAAAAAAH////+/+AAAAAAAB///wb8D8AAAAAAAf//wAH4H4AAAAAAD//4AAPwPwAAAAAA//8AAAfj/gAAAAAP//gAAA///wAAAAB//4AAB////AAAAAL/+AAA//+P8AAAAA//gAAGwf4/wAAAAP/4AAAwD/D+AAAAB//AAAGAPIfAAAAAf/wAAAAB+D4AAAAH/8AAAAA/g/AAAAB//AAAAADMHYAAAAP/wAAAAAHAGAAAAD/+AAAAAAwAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAB/+AAAAAAAAAAAAAf/gAAAAAAAAAAAAH/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAHgAAAAAAAAAAAAAA","h":88,"w":93},"sialia-mexicana":{"bits":"AAAeAAAAAAAAAAAAAB//AAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAD///wAAAAAAAAAAA////AAAAAAAAAAAP///8AAAAAAAAAAD////wAAAAAAAAAA////+AAAAAAAAAA/////4AAAAAAAAAP/////gAAAAAAAAH/////8AAAAAAAAA//////wAAAAAAAAAP/////AAAAAAAAAAP////8AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAA//////AAAAAAAAAH/////+AAAAAAAAAf/////4AAAAAAAAD//////wAAAAAAAAP//////AAAAAAAAB//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAA///////8AAAAAAAH///////wAAAAAAA///////+AAAAAAAH///////4AAAAAAA////////AAAAAAAH///////8AAAAAAAf///////wAAAAAAD////////AAAAAAAf///////8AAAAAAD////////wAAAAAAP////////AAAAAAB////////4AAAAAAP////////gAAAAAA////////8AAAAAAH////////wAAAAAAf////////AAAAAAD////////4AAAAAAP////////gAAAAAA////////+AAAAAAD////////wAAAAAAP////////AAAAAAB////////4AAAAAAH////////AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAAP///////4AAAAAAA////////gAAAAAAD///////+AAAAAAAH///////4AAAAAAAP///////gAAAAAAA///////+AAAAAAAH///////4AAAAAAD////////AAAAAAAf///////8AAAAAAHwf//////wAAAAAA8A7+B//9/AAAAAAHgB/wD//z4AAAAAA4AP8AP/+HgAAAAAHAP8AA//4MAAAAAA4P8AAB//AAAAAAADH8AAAD/8AAAAAAAD8AAAAP/wAAAAAAB//AAAA/+AAAAAAAP/+AAAD/4AAAAAAD4DwAAAP/gAAAAAAfAKAAAB/8AAAAAADwAwAAAH/wAAAAAAeAGAAAAf/AAAAAAD4AAAAAB/8AAAAAAPAAAAAAP/gAAAAAAwAAAAAA/+AAAAAAHAAAAAAD/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/wAAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD4AAAAAAAAAAAAAABAA=","h":93,"w":93},"sialia-sialis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAP///AAAAAAAAAAAD///4AAAAAAAAAAD////gAAAAAAAAAB////+AAAAAAAAAAP////4AAAAAAAAAAf////gAAAAAAAAAAf///+AAAAAAAAAAD////8AAAAAAAAAAP////4AAAAAAAAAB/////4AAAAAAAAAP/////wAAAAAAAAB//////AAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAD//////gAAAAAAAAf//////AAAAAAAAD//////+AAAAAAAAf//////8AAAAAAAD///////wAAAAAAAf///////gAAAAAAB///////+AAAAAAAP///////4AAAAAAB////////gAAAAAAP////////AAAAAAB////////4AAAAAAH////////gAAAAAA////////+AAAAAAH////////8AAAAAAf////////wAAAAAD/////////gAAAAAP////////+AAAAAA/////////8AAAAAH/////////gAAAAAf////////4AAAAAB/////////gAAAAAH////////+AAAAAAf////////8AAAAAA/////////4AAAAAD/////////wAAAAAP/////AD//AAAAAAf////gAH/+AAAAAA////wAAP/8AAAAAA///4AAAf/4AAAAAA//8AAAA//gAAAAAD4/AAAAD//AAAAAB8D4AAAAH/8AAAAA+AeAAAAAP/gAAAAfAPgAAAAAf8AAAAP/jwAAAAAA/gAAAH/88AAAAAAA4AAAB/A+AAAAAAAAAAAAPwHgAAAAAAAAAAAB4B4AAAAAAAAAAAAPA/8AAAAAAAAAAABw//wAAAAAAAAAAAPP4aAAAAAAAAAAAAj+AAAAAAAAAAAAAGfwAAAAAAAAAAAAAB8AAAAAAAAAAAAAAPgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAZAAAAAAAAAAAAAABOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"sitta-canadensis":{"bits":"AAAP8AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//4AAAAAAAAAAAD///gAAAAAAAAAAA////AAAAAAAAAAAf///8AAAAAAAAAH/////gAAAAAAAAH//////AAAAAAAAA///////AAAAAAAAAf//////8AAAAAAAAH//////+AAAAAAAAf///////4AAADwAB////////+AAP/AAD////////+Af/8AAP////////////4AA/////////////AAD////////////wAAf///////////8AAB///////////8AAAP//////////wAAAB//////////4AAAAH/////////8AAAAA//////////wAAAAH//////////wAAAA//////////+AAAAD//////////gAAAAf////////gAAAAAB////////wAAAAAAP///////8AAAAAAA////////AAAAAAAH///////4AAAAAAAf//////+AAAAAAAB///////gAAAAAAAH//////4AAAAAAAAf/////+AAAAAAAAB//////gAAAAAAAAH/////8AAAAAAAAAP////+AAAAAAAAAAf////AAAAAAAAAAA////4AAAAAAAAAAH///+AAAAAAAAAAB//+9AAAAAAAAAAAfHAPAAAAAAAAAAADwYDwAAAAAAAAAAAeTA8AAAAAAAAAAAB+4fkAAAAAAAAAAAPgD/wAAAAAAAAAAA6A9+AAAAAAAAAAADwPhwAAAAAAAAAAAAD8MAAAAAAAAAAAAAfjAAAAAAAAAAAAAB8gAAAAAAAAAAAAAP8AAAAAAAAAAAAAAfAAAAAAAAAAAAAAB+AAAAAAAAAAAAAAHgAAAAAA","h":56,"w":93},"sitta-carolinensis":{"bits":"AAAAAAAABwAAAAAAAAAB+AAAAAAAAAA/4AAAAAAAAA//4AAAAAAAAf/+AAAAAAAAP//AAAAAAAAP//gAAAAAAAH//wAAAAAAAD//wAAAAAAAB//4AAAAAAAB//4AAAAAAAA//4AAAAAAAAf/8AAAAAAAAP/8AAAAAAAAH/8AAAAAAAAf/8AAAAAAAAf/+AAAAAAAAf/+AAAAAAAAe/+AAAAAAAAP//wAAAAAAAP//8AAAAAAAPv/8AAAAAAAP//+AAAAAAAP3//AAAAAAAH///gAAAAAAH7//wAAAAAAH7//wAAAAAAD9//4AAAAAAD9//8AAAAAAD///+AAAAAAD+//+AAAAAAD////AAAAAAD////gAAAAAB////wAAAAAB////4AAAAAB////8AAAAAA////+AAAAAA/////AAAAAA/////wAAAAAf////4AAAAAf////8AAAAAf////+AAAAAP/////AAAAAP/////gAAAAH/////wAAAAH/////4AAAAH/////8AAAAH/////+AAAAD//////AAAAD//////wAAAB//////4AAAB//////8AAAA//////+AAAA///////AAAAf//////gAAAP//////gAAAP//////wAAAf//////4AAAP//////8AAAP//////+AAAP///////AAAP///////AAAP///////AAAP///////wAAP///////4AAH///////8AAH///////+AAD///////+AAD///////+AAB///////8AAA///////8AAA///////+AAAf//////2AAAP//////jAAAH//////jnwAD//////h/4AB//////B/0AA//////A+CAAf////8A+AAAP/////AeAAAP///nzgfAAAP/gAHwwfgAAP8AAD4QPwAAPgAAD8AH4AAPgAAB+AG+AAPgAAA/AB/IAHgAAAfoA98AHAAAAO8AOcADAAAADAAHAAAAAAABgABgAAAAAAAcAAwAAAAAAAAAAcAAAAAAAAAAHAAA=","h":93,"w":67},"sitta-pusilla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAPwAAAAAAAAAAAAAB/AAAAAAAAAAAAAAP8AAAAAAAAAAAAB//x4AAAAAAAAAAA///HwAAAAAAAAAAP//8/AAAAAAAAAAB///z+AAAAAAAAAAH///P4AAAAAAAAAAf//8/wAAAAAAAAAB///z/gAAAAAAAAAH///v+AAAAAAAAAAP////8AAAAAAAAAA/////wAAAAAAAAAB/////gAAAAAAAAAH/////AAAAAAAAAAf////8AAAAAAAAAA/////wAAAAAAAAAD/////gAAAAAAAAAf////+AAAAAAAAAB/////4AAAAAAAAAH/////gAAAAAAAAA/////+AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAP/////4AAAAAAAAB//////wAAAAAAAAP//////AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAD///////gAAAAAAAf//////+AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAf///////wAAAAAAB////////gAAAAAAP///////+AAAAAAB////////4AAAAAAP////////gAAAAAB/////////AAAAAAH////////8AAAAAA/////////wAAAAAH/////////AAAAAAf////////4AAAAAD/////////gAAAAAP////////8AAAAAB/////////wAAAAAH////////+AAAAAAf////////wAAAAAH/////////AAAAAA/////////4AAAAAP/////////AAAAAB/////////4AAAAAH/////////AAAAAAH////////4AAAAAAf////////AAAAAAB////////4AAAAAAH////////AAAAAAAc///////4AAAAADjx///////gAAAAA/vD//////+AAAAAP/+D//////4AAAABv/+D/4AAAfgAAAAMA/4H4AAAB+AAAAAgD/g/gAAAHwAAAAAAP8H8AAAAPAAAAAAB/g/gAAAA8AAAAAAH8H4AAAABgAAAAAA/zuAAAAAEAAAAAAH2BwAAAAAAAAAAAA+QMAAAAAAAAAAAAH6HAAAAAAAAAAAACfAAAAAAAAAAAAAAf4AAAAAAAAAAAAAAjAAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":89,"w":93},"sitta-pygmaea":{"bits":"AAAD/AAAAAAAAAAAAAH//gAAAAAAAAAAAD///AAAAAAAAAAAB///+AAAAAAAAAAAf///4AAAAAAAAB/P////wAAAAAAAA///////AAAAAAAAD//////8AAAAAAAAH//////gAAAAAAAAH/////+AAAAAAAAAH/////4AAAAAAAAAf/////gAAAAAAAAA/////+AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAB//////AAAAAAAAAP/////8AAAAAAAAA//////4AAAAAAAAH//////wAAAAAAAA///////gAAAAAAAH//////+AAAAAAAAf//////4AAAAAAAD///////gAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////4AAAAAAD////////gAAAAAAf///////+AAAAAAB////////4AAAAAAP////////gAAAAAB////////+AAAAAAP////////4AAAAAA/////////gAAAAAH////////+AAAAAAf////////4AAAAAD/////////gAAAAAf////////8AAAAAB/////////wAAAAAH/////////AAAAAAf////////4AAAAAD/////////gAAAAAP////////8AAAAAA/////////wAAAAAH////////+AAAAAAf////////4AAAAAB/////////gAAAAAH////////+AAAAAAf////////4AAAAAB/////////gAAAAAD////////+AAAAAAP////////wAAAAAB/////////AAAAAA/////////8AAAAAH/////////wAAAAB/////////+AAAAAPB///////+AAAAAB4H///////wAAAAAP////+B//4AAAAAB//+/8AD//gAAAAAH//D+AAH/+AAAAAB//4AAAAP/4AAAAAH4/AAAAA//gAAAAA/B8AAAAD/8AAAAAHwDwAAAAP/wAAAAA+AeAAAAA//AAAAAD8AwAAAAD/8AAAAAfgGAAAAAf/gAAAAB/NgAAAAB/+AAAAAP/AAAAAAP/wAAAAA/4AAAAAA//AAAAAAAAAAAAAD/4AAAAAAAAAAAAAf6AAAAAAAAAAAAAB/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAAMAA=","h":77,"w":93},"somateria-spectabilis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+AAAAAAAAAAAAAf/8AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAf//8AAAAAAAAAAAD///wAAAAAAAAAAA////AAAAAAAAAAAH///8AAAAAAAAAAB////gAAAAAAAAAAf//h+AAAAAAAAAAH//+HwAAAAAAAAAB///4eAAAAAAAAAA////B4AAAAAAAAAf///8PAAAAAAAAAP////h4AAAAAAAAB////8PAAAAAAAAAf////h4AAAAAAAAB+AP/8PAAAAAAAAAAAAP/h4AAAAAAAAAAAB/+PAAAAAAAAAAAA///wAAAAAAAAAAA///+AAAAAAAAAAAcP///+AAAAAAAAAOA////+AAAAAAAADAA////+AAAAAAAAwAB/f//+AAAAAAAMAAAP///8AAAAAABAAAD////wAAAAAAYAAA/////gAAAAAGAAAf/////AAAAAAwAAH/////8AAAAAEAABf/////wAAAABgAAAf/////AAAAAMAAAD/////8AAAABgAAAP/////wAAAAMAAAB//////gAAABgAAAP//////AAAAMAAAA//////8AAABgAAAB//////wAAAMAAAAB//////AAABgAAAAD/////8AAAEAAAAAD/////wAAAwAAAAAP/////gAAGAAAAAAP/////gAAQAAAAAAH/////AADAAAAAAAP////8AAMAAAAAAAf////4AAgAAAAAAB////fgAGAAAAAAAD///4eAAYAAAAAAAP///gAABgAAAAAAA///+AAAGAAAAAAAD///4AAAcAAAAAAAf///wAAAwAAAAAAB////gAADgAAAAAAH///+AAAHAAAAAAA///+AAAAcAAAAAAH///8AAAA4AAAAAAf///4AAADwAAAAAH////gAAAHgAAAAB////8AAAAPAAAAAf////gAAAA+AAAAH//j/wAAAAf+APgD//ADgAAAAD/+f////wAAAAAAAf//////4AAAAAAAAP////8AAAAAAAAABx//z/AAAAAAAAAAEH/4BgAAAAAAAAAAgf8AAAAAAAAAAAAAD/AAAAAAAAAAAAAA/4AAAAAAAAAAAAAH+AAAAAAAAAAAAAAzwAAAAAAAAAAAAAEOAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"spatula-clypeata":{"bits":"AAAAfwAAAAAAAAAAAAH/wAAAAAAAAAAAB//wAAAAAAAAAAAP//gAAAAAAAAAAA///gAAAAAAAAAAH//+AAAAAAAAAAAf//8AAAAAAAAAAD///wAAAAAAAAAAP///gAAAAAAAAAB///+AAAAAAAAAAH///4AAAAAAAAAA////gAAAAAAAAAH///+AAAAAAAAAA////4AAAAAAAAAH////gAAAAAAAAA////+AAAAAAAAAP////4AAAAAAAAD//n//AAAAAAAAA//4P/8AAAAAAAAP/+B//gAAAAAAAB//wH/+AAAAAAAAf/8B//wAAAAAAAD//gP/+AAAAAAAAP/8D//4AAAAAAAA//gf///8AAAAAAD/4D////+AAAAAAGeAf/////gAAAAAAAB//////gAAAAAAAP//////AAAAAAAA///////AAAAAAAH//////+AAAAAAAf//////+AAAAAAB///////8AAAAAAP///////8AAAAAA////////8AAAAAD////////4AAAAAP////////wAAAAA/////////gAAAAD/////////gAAAAP/////////AAAAAf////////+AAAAB/////////8AAAAH/////////+AAAAP//////////AAAA//////////+AAAB//////////+AAAD//////////+AAAP/////////z8AAAf/////////AwAAA//////////AAAAB//////////AAAAB//////////gAAAD//////////gAAAD//////////AAAAD/////////4AAAAH////////+AAAAAH////////8AAAAAH////////4AAAAAP////////gAAAAA/////////AAAAAH/////AH/8AAAAAf////wAH/AAAAAB/8//gAAHgAAAAAH/x/8AAAAAAAAAAL/h/gAAAAAAAAAAPAB8AAAAAAAAAAAcAHwAAAAAAAAAABwAfAAAAAAAAAAADAA8AAAAAAAAAAAAADwAAAAAAAAAAAAAOAAAAAAAAAAAAAB4AAAAAAAAAAAAAHgAAAAAAAAAAAAAeAAAAAAAAAAAAAB4AAAAAAAAAAAAAHgAAAAAAAAAAAAA/AAAAAAAAAAADwD+AAAAAAAAAAAf//4AAAAAAAAAAAf/+AAAAAAAAAAAA//wAAAAAAAAAAAD//AAAAAAAAAAAAf/8AAAAAAAAAAAB//wAAAAAAAAAAAP/+AAAAAAAAAAAB//4AAAAAAAAAAAP//AAAAAAAAAAAAgf4AAAAAAAAAAAAA/gAAAAAAAAAAAAB8AAAAAAAAAAAAAHgAAAAAAAAAAAAAYAAAAAAAAAAAAABAAAAAAA","h":93,"w":88},"spatula-cyanoptera":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAH/4AAAAAAAAAAAAB//gAAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAB///gAAAAAAAAAAAP//+AAAAAAAAAAAB///wAAAAAAAAAAAf///AAAAAAAAAAAH///4AAAAAAAAAAB////AAAAAAAAAAAf///4AAAAAAAAAAP////AAAAAAAAAAH////4AAAAAAAAAD/////AAAAAAAAAB//n/////gAAAAAAP/Af/////gAAAAAB/gP//////gAAAAAAAH///////gAAAAAAB////////8AAAAAAf////////8AAAAAH/////////8AAAAB///////////gAAAP///////////gAAD///////////+AAAf//////////4AAAD////////////gAA/////////////AAH////////////wAA////////////8AAH////////////+AA/////////////4AH/////////////gA/////////////4AD////////////+AAf////////////gAB///////////wAAAP//////////4AAAA//////////8AAAAD/////////+AAAAAP/////////AAAAAA/////////wAAAAAB////////8AAAAAAD///////+AAAAAAAH///////AAAAAAAAH/////8AAAAAAAAAD////8AAAAAAAAAAD///+AAAAAAAAAAAB///gAAAAAAAAAAAP/DwAAAAAAAAAAAD/YeAAAAAAAAAAAA/5DwAAAAAAAAAAAP/AcAAAAAAAAAAAB/4DgAAAAAAAAAAAB/AcAAAAAAAAAAAAPYHgAAAAAAAAAAABwA8AAAAAAAAAAAAMAHwAAAAAAAAAAAAgB+AAAAAAAAAAAAA//wAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAD/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAP/wAAAAAAAAAAAAD/8AAAAAAAAAAAAAAfAAAAAAAAAAAAAABwAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":73,"w":93},"spatula-discors":{"bits":"AAAH4AAAAAAAAAAAAAH/4AAAAAAAAAAAAD//wAAAAAAAAAAAA///AAAAAAAAAAAAP//8AAAAAAAAAAAB///wAAAAAAAAAAAf///AAAAAAAAAAAD///4AAAAAAAAAAA////gAAAAAAAAAAH///8AAAAAAAAAAA////gAAAAAAAAAAH///+AAAAAAAAAAB////wAAAAAAAAAAf///+AAAAAAAAAAH////j//wAAAAAAB////////wAAAAAAf/////////AAAAAH//////////gAAAD/4P////////5AAB/8D//////////8Af+D///////////4H/h////////////A/wf///////////wHwH////////////wAB////////////+AAf////////////8AH/////////////4A//////////////AP/////////////4B/////////////+AP/////////////AB/////////////wAP////////////wAB////////////wAAP///////////8AAB////////////AAAP///////////wAAB///////////8AAAP///////////AAAA///////////gAAAH//////////4AAAAf/////////+AAAAD//////////gAAAAP/////////4AAAAA/////////8AAAAAD////////+AAAAAAH////////AAAAAAAf///////gAAAAAAA///////gAAAAAAAAf/////4AAAAAAAAAD////+AAAAAAAAAAD////AAAAAAAAAAAB///gAAAAAAAAAAAD8B4AAAAAAAAAAAAfgPAAAAAAAAAAAAf0B4AAAAAAAAAAB//AOAAAAAAAAAAA//4DwAAAAAAAAAAf//AcAAAAAAAAAAD//4DgAAAAAAAAAAD/+A8AAAAAAAAAAAP/wHgAAAAAAAAAAB/8B+AAAAAAAAAAAOBgfwAAAAAAAAAABh//4AAAAAAAAAAAAP//AAAAAAAAAAAAAf/wAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAH/+AAAAAAAAAAAAB//wAAAAAAAAAAAAf/8AAAAAAAAAAAADB/AAAAAAAAAAAAAADwAAAAAAAAAAAAAAMAAAAAAAAAAAAAABAAAAAAAAA=","h":76,"w":93},"spatula-querquedula":{"bits":"AAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAD/4AAAAAAAAAAAAA//gAAAAAAAAAAAAf//AAAAAAAAAAAAD8H8AAAAAAAAAAAA/+PwAAAAAAAAAAAH/+eAAAAAAAAAAAB//94AAAAAAAAAAAP//3AAAAAAAAAAAD//+8AAAAAAAAAAA///7gAAAAAAAAAAP///eAAAAAAAAAAH////wB+AAAAAAAH////+P//z/4fwAB////////////+AAP+H//////////AAB+AP/////////n4AAAB///////////AAAAP///////////8AAD////////////gAB////////////8AAf////////////AAH////////////wAA////////////8AAP////////////AAB////////////wAAf///////////8AAD///////////8AAAf//////////+AAAD///////////gAAAf//////////wAAAD//////////8AAAAf//////////AAAAD//////////wAAAAP/////////8AAAAB//////////gAAAAH/////////wAAAAA/////////8AAAAAD/////////AAAAAAP////////gAAAAAA////////wAAAAAAD///////wAAAAAAAH//////8AAAAAAAAP//////gAAAAAAAAP/////4AAAAAAAAAD////wAAAAAAAAAAP///4AAAAAAAAAAB/H/vAAAAAAAAAAAGT/4AAAAAAAAAAAAA/+AAAAAAAAAAAAAEPgAAAAAAAAAAAAAB4AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":56,"w":93},"sphyrapicus-nuchalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAB//AHwAAAAP//P/AAAAB////4AAAAP///+AAAAB////AAAAAH///wAAAAAf///AAAAAD///4AAAAAP///AAAAAA///8AAAAAD///gAAAAAf//+AAAAAB///4AAAAAH///AAAAAAf//8AAAAAD///wAAAAAf///AAAAAD///8AAAAAP///wAAAAB////gAAAAP///+AAAAB////4AAAAH////gAAAA////+AAAAH////4AAAAf////gAAAD////+AAAAP////4AAAB/////gAAAH////+AAAAf////4AAAD/////AAAAP////8AAAA/////wAAAH////+AAAAf////4AAAB/////AAAAP////8AAAA/////wAAAH////+AAAAf////wAAAB/////AAAAP/////gAAA//////gAAD//////AAAP/////8AAB//////gAAH////+GAAAf////wYAAB////3BAAAH///+4AAAAf////AAAAB////cAAAAH///5gAAAA////DgAAAD///4AAAAAf//4AAAAAB///gAAAAAP//8AAAAAA///wAAAAAH//+AAAAAAd//4AAAAADv3/AAAAAAO+f8AAAAAA3x/4AAAAACeH/gAAAAADwf+AAAAAAOB/4AAAAAAAH/gAAAAAAAf+AAAAAAAB/4AAAAAAAH/gAAAAAAAf+AAAAAAAB/4AAAAAAAH/gAAAAAAAf+AAAAAAAB/wAAAAAAAH+AAAAAAAAf4AAAAAAAB/AAAAAAAAH4AAAAAAAA+AAAAAAAAD4AAAAAAAAPgAAAAAAABsAAAAAAAAGwAAAAAAAASAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":58},"sphyrapicus-ruber":{"bits":"AAB/AAAAAAAHgP/4AAAAAA////+AAAAAA/////AAAAAAD////gAAAAAAf///wAAAAAAH///wAAAAAAD///4AAAAAAB///4AAAAAAA///8AAAAAAAf//8AAAAAAAf//8AAAAAAAP//+AAAAAAAP//+AAAAAAAP///AAAAAAAH///AAAAAAAH///gAAAAAAH///wAAAAAAH///8AAAAAAH///+AAAAAAH////AAAAAAH////gAAAAAP////wAAAAAP////4AAAAAP////4AAAAAP////8AAAAAP////+AAAAAH////+AAAAAH/////AAAAAH/////gAAAAH/////gAAAAH/////wAAAAD/////wAAAAD/////4AAAAD/////4AAAAB/////8AAAAB/////+AAAAA/////+AAAAA//////AAAAAf/////AAAAAP/////gAAAAP/////gAAAAH/////wAAAAD/////wAAAAB/////wAAAAA/////4AAAAAf////4AAAAAP////4AAAAAH////8AAAAAD////8AAAAAF////8AAAAAP////8AAAAAf////8AAAAAf////+AAAAAf////+AAAAAPf////AAAAAPP////AAAAAPP////gAAAAP/9///gAAAAH/s///wAAAAHnMf//wAAAAD88f//4AAAAAwAP//8AAAAAAAH//8AAAAAAAD/3+AAAAAAAD/z+AAAAAAAB/x7AAAAAAAB/w4AAAAAAAB/wcAAAAAAAB/wAAAAAAAAA/wAAAAAAAAA/wAAAAAAAAA/wAAAAAAAAA/wAAAAAAAAA/wAAAAAAAAA/4AAAAAAAAA/4AAAAAAAAA/4AAAAAAAAA/4AAAAAAAAAf4AAAAAAAAAf8AAAAAAAAAP8AAAAAAAAAP8AAAAAAAAAH8AAAAAAAAAH+AAAAAAAAAD+AAAAAAAAAB+AAAAAAAAAA+AAAAAAAAAAfAAAAAAAAAAfAAAAAAAAAAPAAAAAAAAAANAAAAAAAAAAEAA","h":93,"w":66},"sphyrapicus-thyroideus":{"bits":"AAAAP4AAAAAAAAAAAAH/+AAAAAAAAAAAAf//AAAAAAAAAAAD///AAAAAAAAAAAP///AAAAAAAAAAB////AAAAAAAAB//////AAAAAAAA///////AAAAAAAD//////+AAAAAAAB//////+AAAAAAAAB/////8AAAAAAAAAH////8AAAAAAAAAH////8AAAAAAAAAH////4AAAAAAAAAD////8AAAAAAAAAD////+AAAAAAAAAD/////AAAAAAAAAD/////gAAAAAAAAH/////gAAAAAAAAH/////wAAAAAAAAP/////wAAAAAAAAP/////wAAAAAAAAf/////4AAAAAAAA//////4AAAAAAAB//////4AAAAAAAD//////4AAAAAAAH//////wAAAAAAAH//////wAAAAAAAP//////wAAAAAAAf//////wAAAAAAA///////wAAAAAAB///////gAAAAAAB///////gAAAAAAD///////gAAAAAAD///////gAAAAAAH///////gAAAAAAP///////gAAAAAAP///////AAAAAAAf///////AAAAAAAf///////AAAAAAAf//////+AAAAAAA///////+AAAAAAA///////8AAAAAAA///////8AAAAAAA///////4AAAAAAB///////4AAAAAAB///////wAAAAAAB///////gAAAAAAA///////AAAAAAAA///////AAAAAAAA///////AAAAAAAD///////AAAAAAAP//////+AAAAAAA///////+AAAAAAB///////+AAAAAAH8H/////+AAAAAAMAD/////+AAAAAAYAB/////+AAAAAAAAD/////+AAAAAAAAD/f///+AAAAAAAAf+D///8AAAAAAAD/4D///cAAAAAAAfgAB///AAAAAAAB/gAB//fAAAAAA///gAB/+OAAAAAB///gAB/8AAAAAAD///wAB/4AAAAAAP/A/wAD/4AAAAAA/gAMwAH/wAAAAABgAABAAP/gAAAAACAAAAAAP/AAAAAAAAAAAAAf/AAAAAAAAAAAAA/+AAAAAAAAAAAAB/8AAAAAAAAAAAAD/8AAAAAAAAAAAAD/4AAAAAAAAAAAAH/wAAAAAAAAAAAAP/gAAAAAAAAAAAAP/gAAAAAAAAAAAAf/AAAAAAAAAAAAAf+AAAAAAAAAAAAA/8AAAAAAAAAAAAA/8AAAAAAAAAAAAB/4AAAAAAAAAAAAA/wAAAAAAAAAAAAA/wAAAAAAAAAAAAA/gAAAAAAAAAAAAA/gAAAAAAAAAAAAA/AAAAAAAAAAAAAAbAAAAAAAAAAAAAA4AAAAAAAAAAAAAAwAAAAAAAAAAAAAAw","h":93,"w":89},"sphyrapicus-varius":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAf/AAAAAAAAAAB/+//+AAAAAAAAAAH////4AAAAAAAAAAH////gAAAAAAAAAAP///+AAAAAAAAAAAf///4AAAAAAAAAAA////gAAAAAAAAAAH///8AAAAAAAAAAAf///wAAAAAAAAAAB///+AAAAAAAAAAAH///wAAAAAAAAAAAf///AAAAAAAAAAAB///8AAAAAAAAAAAP///wAAAAAAAAAAA////gAAAAAAAAAAH////gAAAAAAAAAAf////AAAAAAAAAAD////+AAAAAAAAAAf////8AAAAAAAAAD/////4AAAAAAAAAf/////gAAAAAAAAD//////AAAAAAAAAf/////8AAAAAAAAD//////wAAAAAAAAf//////AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAB///////AAAAAAAAP//////+AAAAAAAB///////4AAAAAAAH///////gAAAAAAA///////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAB///////+AAAAAAAP///////4AAAAAAA////////gAAAAAAD///////8AAAAAAAP///////wAAAAAAB////////AAAAAAAH///////4AAAAAAAf///////AAAAAAAA///////8AAAAAAAD///////wAAAAAAAP///////AAAAAAAAf//////8AAAAAAAB///////wAAAAAAAD///////AAAAAAAAH//////8AAAAAAB4H//////wAAAAAB/h//////fAAAAAAf////////8AAAAAH//h/////7wAAAAA///H/3///nAAAAAMAB+Pgf//+AAAAABAAD4AA///4AAAAAAAAHAAB///gAAAAAAAAYAAH/+cAAAAAAAADAAAP/4AAAAAAAAAYAAB//AAAAAAAAAAAAAH/8AAAAAAAAAAAAA//gAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//gAAAAAAAAAAAAH/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAH/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAA/4AAAAAAAAAAAAABzgAAAAAAAAAAAAAHMAAAAAAAAAAAAAAcgAAAAAAAAAAAAABwAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":83,"w":93},"spinus-lawrencei":{"bits":"AAP8AAAAAAAAAAAAAP/8AAAAAAAAAAAAD//4AAAAAAAAAAAB///gAAAAAAAAAAAf//+AAAAAAAAAAAH///8AAAAAAAAAAA////gAAAAAAAAAAf///+AAAAAAAAAAH////4AAAAAAAAAB/////AAAAAAAAAAf////8AAAAAAAAAH/////wAAAAAAAAAP////+AAAAAAAAAAP////4AAAAAAAAAAf////AAAAAAAAAAD////8AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAP////8AAAAAAAAAB/////4AAAAAAAAAH/////gAAAAAAAAA//////AAAAAAAAAH/////8AAAAAAAAA//////wAAAAAAAAP//////AAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////8AAAAAAAB///////wAAAAAAAP///////AAAAAAAB///////4AAAAAAAH///////gAAAAAAA////////AAAAAAAH///////8AAAAAAA////////wAAAAAAD////////AAAAAAAf///////8AAAAAAD////////wAAAAAAP///////+AAAAAAB////////4AAAAAAP////////gAAAAAA////////+AAAAAAH////////4AAAAAAf////////AAAAAAB////////8AAAAAAP////////gAAAAAA////////+AAAAAAD////////4AAAAAAP////////gAAAAAA////////+AAAAAAD////////4AAAAAAH////////gAAAAAAf///////8AAAAAAA////////wAAAAAAD////////AAAAAAAH///////8AAAAAAAP///////wAAAAAAA////////AAAAAAA////////8AAAAAAfwP//////wAAAAAf/wf/wP//+AAAAAP//h/AA//8AAAAAB/P+f4AB//4AAAAAfwDf+AAB//gAAAAD8B/5gAAD/+AAAAAfgD8AAAAD/4AAAAD8A+AAAAAH/gAAAAP8fjAAAAAf+AAAAByf//AAAAB/4AAAAHH//8AAAAH/wAAAAd/AegAAAAf/AAAAAP4AwAAAAB/8AAAABfAcAAAAAH/wAAAAPwAAAAAAAf/AAAAA/AAAAAAAB/8AAAAH4AAAAAAAH/wAAAA74AAAAAAAf/AAAAGGAAAAAAAB/4AAAA4AAAAAAAAH4AAAADgAAAAAAAAfgAAAAAAAAAAAAAB8AAAAAAAAAAAAAAHgAAAAAAAAAAAAAAMA=","h":84,"w":93},"spinus-pinus":{"bits":"AAAAAAAAAAAD/AAAAAAAAAAAAAD//AAAAAAAAAAAAB//+AAAAAAAAAAAA///4AAAAAAAAAAAP///gAAAAAAAAAAD///+AAAAAAAAAAA////4AAAAAAAAAAP////wAAAAAAAAAD/////gAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAB/////8AAAAAAAAAf////8AAAAAAAAAH////+AAAAAAAAAD/////wAAAAAAAAB/////8AAAAAAAAAf/////gAAAAAAAAP/////4AAAAAAAAH//////AAAAAAAAB//////wAAAAAAAAf/////+AAAAAAAAH//////wAAAAAAAD//////+AAAAAAAA///////wAAAAAAAH//////+AAAAAAAB///////wAAAAAAAf//////+AAAAAAAP///////wAAAAAAD///////+AAAAAAA////////wAAAAAAf///////8AAAAAAH////////gAAAAAB////////8AAAAAAP////////gAAAAAD////////4AAAAAA/////////AAAAAAP////////wAAAAAD////////+AAAAAA/////////gAAAAAH////////4AAAAAB/////////AAAAAAP////////wAAAAAD////////8AAAAAAf////////AAAAAAH////////wAAAAAB////////8AAAAAAP////////AAAAAAD////////wAAAAAB////////8AAAAAAf///////+AAAAAAH////////gAAAAAB////////4AAAAAAP///////8AAAAAAD///////8AAAAAAA////////wAAAAAAP////////gAAAAAD9//8Pf//+AAAAAAef//AD///8AAAAAAH//gAfH//gAAAAAB//wAAB//8AAAAAAf/wAAAf/3gAAAAAH/4AAADP2+AAAAAB/+AAAAZ73gAAAAAf/gAAABv38AAAAAH/8AAAAFjfAAAAAB//AAAAAOfwAAAAAf/wAAAAA9+AAAAAH/8AAAAAAfgAAAAB//AAAAAAD4AAAAAf/wAAAAAAAAAAAAD/+AAAAAAAAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAD/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAH/8AAAAAAAAAAAAA5/AAAAAAAAAAAAAAP4AAAAAAAAAAAAAB+AAAAAAAAAAAAAAPgAAAAAAAAAAAAAB4AAAAAAAAAAAAAAOAAAAAAAAAAAAAABgAAAAAAAAAAAAAA=","h":83,"w":93},"spinus-psaltria":{"bits":"AB/8AAAAAAAAAAAAA//4AAAAAAAAAAAAP//wAAAAAAAAAAAD///AAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAH////AAAAAAAAAAB////8AAAAAAAAAAf////gAAAAAAAAAH////+AAAAAAAAAA/////4AAAAAAAAAA/////AAAAAAAAAAB////8AAAAAAAAAAH////4AAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAAf/////AAAAAAAAAD/////8AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAD///////wAAAAAAAf///////gAAAAAAB///////+AAAAAAAP///////8AAAAAAB////////wAAAAAAP////////AAAAAAA////////8AAAAAAH////////wAAAAAA/////////AAAAAAD////////8AAAAAAf////////wAAAAAB/////////AAAAAAP////////8AAAAAA/////////wAAAAAD/////////AAAAAAP////////8AAAAAA/////////4AAAAAD/////////gAAAAAP////////+AAAAAAf////////8AAAAAB/////////gAAAAAH////////+AAAAAAH////////8AAAAAAP////////gAAAAAD////////+AAAAAA/////A///wAAAAAP////gAP//AAAAAD5//+AAAP/+AAAAA+B//wAAAD/8AAAADwB/+AAAAP/wAAAAegP/gAAAAf/gAAAB/A/AAAAAA//AAAAP4PgAAAAAD/8AAAA4H4AAAAAAP/wAAAH5//AAAAAAf/AAAAef/8AAAAAA/4AAAAH4GwAAAAAD8AAAAA/QGAAAAAAHwAAAADzgwAAAAAAeAAAAAP8AAAAAAAAwAAAAA/gAAAAAAAAAAAAAH8AAAAAAAAAAAAAAPAAAAAAAAAA=","h":68,"w":93},"spinus-tristis":{"bits":"AAAAAAAAfwAAAAAAAAAP/4AAAAAAAAD//4AAAAAAAAf//wAAAAAAAD///gAAAAAAAf///AAAAAAAD///8AAAAAAAf///8AAAAAAB////4AAAAAAP////wAAAAAA/////gAAAAAH/////AAAAAAf////8AAAAAD////4AAAAAAf///8AAAAAAD////wAAAAAAf////AAAAAAD////4AAAAAAf////gAAAAAD////+AAAAAAf////4AAAAAD/////gAAAAAf////+AAAAAD/////4AAAAAf/////wAAAAB//////AAAAAP/////8AAAAB//////wAAAAH//////AAAAA//////8AAAAD//////wAAAAf//////AAAAB//////4AAAAP//////gAAAA//////+AAAAH//////4AAAAf//////AAAAD//////8AAAAP//////gAAAB//////+AAAAH//////wAAAA///////AAAAD//////8AAAAP//////gAAAB//////8AAAAH//////wAAAAf/////+AAAAD//////4AAAAP//////AAAAB//////4AAAAH//////gAAAAf/////8AAAAB//////gAAAAP/////8AAAAA//////gAAAAB/////8AAAAAP/////uAAAAA//////+AAAAD//////+AAAAf////8/+AAAB//////f8AAAH////jx/4AAAf///4eDZgAAD///8B4NyAAAP//+AEAzAAAB///wAQDOAAAH//+AAAEcAAAf/+cAAAxwAAD//xwAAAHAAAP/+DAAAAEAAA//wMAAAAQAAB/+AwAAABAAAH/4DgAAAAAAA//AOAAAAAAAD/8OYAAAAAAAf/h/wAAAAAAB/+H/gAAAAAAP/wR/AAAAAAA//AB/AAAAAAH/8AD/AAAAAA//gAPeAAAAAD/+AA84AAAAAf/wAD4gAAAAB//AANgAAAAAP/4AA/AAAAAA//gADsAAAAAH/+AAG4AAAAAf/wAAZwAAAAD//AABnAAAAAP/4AAAEAAAAA//gAAAQAAAAD58AAABAAAAAODgAAAAAAAAAA==","h":93,"w":70},"spiza-americana":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAB//gAAAAAAAAAAAA///AAAAAAAAAAAAP//+AAAAAAAAAAAD///+AAAAAAAAAAA////4AAAAAAAAAAP////gAAAAAAAAAD////8AAAAAAAAAA////+AAAAAAAAAAH////AAAAAAAAAAB////gAAAAAAAAAAf///8AAAAAAAAAAD////AAAAAAAAAAB////4AAAAAAAAAAf///+AAAAAAAAAAP////wAAAAAAAAAH////8AAAAAAAAAD/////gAAAAAAAAB/////4AAAAAAAAAf/////AAAAAAAAAP/////wAAAAAAAAD/////+AAAAAAAAB//////wAAAAAAAAf/////+AAAAAAAAH//////wAAAAAAAB//////+AAAAAAAAf//////wAAAAAAAH//////8AAAAAAAB///////gAAAAAAA///////8AAAAAAAP///////AAAAAAAD///////4AAAAAAA////////AAAAAAAP///////wAAAAAAD///////+AAAAAAA////////gAAAAAAH///////4AAAAAAB////////AAAAAAAf///////wAAAAAAH//////j8AAAAAAA//////ADAAAAAAAP/////gAwAAAAAAB/////wAMAAAAAAAf////4ADAAAAAAAH////+ABwAAAAAAB/////gAcAAAAAAA/////4AOAAAAAAAP////+ADgAAAAAAD/////wBwAAAAAAA/////+M4AAAAAAAP/////zeAAAAAAABP////8/+AAAAAAAD////8P/wAAAAAAAf/54BDf+AAAAAAAH/+OAY/jwAAAAAAAD/nADNwHAAAAAAAA/5wAfOA4AAAAAAAP/4AD5gHAAAAAAAD/8AAP8AYAAAAAAA/+AAAfgDAAAAAAAP/AAAA+AQAAAAAAB/wAAAB+AAAAAAAAf8AAAAD4AAAAAAAH/AAAAAPwAAAAAAB/wAAAAAfgAAAAAAf8AAAAAH/AAAAAAH/AAAAAH/8AAAAAB/4AAAAA8PgAAAAAf+AAAAAPA8AAAAAH/gAAAABgDgAAAAA/4AAAAAOAcAAAAAP+AAAAAAwDgAAAAD/gAAAAAAAcAAAAA/4AAAAAAADgAAAAH+AAAAAAAAMAAAAB/wAAAAAAADAAAAAP8AAAAAAAAAAAAAAfAAAAAAAAAAAAAADwAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":84,"w":93},"spizella-atrogularis":{"bits":"AAf/gAAAAAAAAAAAAP//AAAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAf///wAAAAAAAAAAD////AAAAAAAAAAB////4AAAAAAAAAA/////gAAAAAAAAAP////+AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH/////8AAAAAAAAAP/////wAAAAAAAAAP////+AAAAAAAAAA/////8AAAAAAAAAH/////4AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////8AAAAAAAA///////wAAAAAAAD///////AAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAf///////4AAAAAAB////////gAAAAAAP///////8AAAAAAB////////wAAAAAAP////////AAAAAAB////////8AAAAAAP////////wAAAAAA/////////AAAAAAH////////8AAAAAA/////////wAAAAAD////////+AAAAAAf////////4AAAAAB/////////gAAAAAP////////8AAAAAB/////////wAAAAAH////////+AAAAAAf////////4AAAAAB/////////AAAAAAP////////8AAAAAA/////////gAAAAAD////////8AAAAAAP////////wAAAAAA////////+AAAAAAB////////4AAAAAAH////////gAAAAAAP///////8AAAAAAA////////wAAAAAAB///////+AAAAAAAD///////wAAAAAAAH//////2AAAAAAAH///////AAAAAAAB///////4AAAAAAAP//+AP//gAAAAAAB///wAf/8AAAAAAAf//+AA//wAAAAAAD//wAAA//AAAAAAAf/4AAAD/4AAAAAAH/4AAAAP/gAAAAAAf/AAAAB/+AAAAAAB//wAAAH/wAAAAAA///AAAA//AAAAAAH4D8AAAD/8AAAAAA+ABgAAAP/wAAAAADgAMAAAB//AAAAAAcABAAAAH/4AAAAADgAAAAAAf/gAAAAAcAAAAAAD/+AAAAADAAAAAAAP/wAAAAAcAAAAAAA//AAAAAB4AAAAAAH/8AAAAAAAAAAAAAf/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAA//gAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAH/4AAAAAAAAAAAAAf/gAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAA/4=","h":91,"w":93},"spizella-breweri":{"bits":"AA8AAAAAAAAAAAAAA/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//wAAAAAAAAAAAB///AAAAAAAAAAAAP//8AAAAAAAAAAAD///gAAAAAAAAAAA///+AAAAAAAAAAAf///wAAAAAAAAAAH////AAAAAAAAAAA////4AAAAAAAAAAA////gAAAAAAAAAAD///+AAAAAAAAAAAf///8AAAAAAAAAAD////4AAAAAAAAAAf////gAAAAAAAAAD/////AAAAAAAAAAf////8AAAAAAAAAD/////wAAAAAAAAAf/////gAAAAAAAAD/////+AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////8AAAAAAAAf//////wAAAAAAAD///////gAAAAAAAf//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAB///////+AAAAAAAH///////4AAAAAAA////////gAAAAAAD///////+AAAAAAAf///////4AAAAAAB////////AAAAAAAP///////8AAAAAAA////////wAAAAAAD////////gAAAAAAP///////+AAAAAAB////////4AAAAAAH////////AAAAAAAP///////4AAAAAAA////////4AAAAAAD////////wAAAAAAH////////gAAAAAAf///+f///gAAAAAA///+AB///AAAAAAB///AAAD/+AAAAAAB//gAAAH/8AAAAAAfPgAAAAP/4AAAAAHh8AAAAAf/4AAAADwPAAAAAA//wAAAB8DgAAAAAB//gAAA+E4AAAAAAB//AAP///AAAAAAAD/+AD//7wAAAAAAAH/4B/+A8AAAAAAAAP/Af/APAAAAAAAAAfwGHgBwAAAAAAAAAAAAwAcGAAAAAAAAAAAEf//4AAAAAAAAAAAH//4AAAAAAAAAAAAH+AAAAAAAAAAAAAP/gAAAAAAAAAAAAP94AAAAAAAAAAAAD88AAAAAAAAAAAAAQPAAAAAAAAAAAAAABgAAAAAAAAAAAAAAIAAAAAAAAAAAAA==","h":70,"w":93},"spizella-pallida":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAPAAAAAAAAAAB8AAP/gAAAAAAAAB/AAH//AAAAAAAAA//gB//8AAAAAAAAf/8Af//wAAAAAAAP//gH///AAAAAAAH//8D///8AAAAAAD///A////4AAAAAB///gP////+AAAAA///wA//////wAAAf//4AA//////wAAP//4AAD///////gH//4AAAf///////P//8AAAB//////////+AAAAP/////////+AAAAB//////////AAAAAH/////////gAAAAAf////////YAAAAAD////////2AAAAAAf///////5gAAAAAB///////8YAAAAAAP///////+AAAAAAB////////wAAAAAAH////////gAAAAAA////////+AAAAAAD////////wAAAAAAf///////gAAAAAAB///////AAAAAAAAH//////wAAAAAAAAf/////8AAAAAAAAB//////AAAAAAAAAH/////wAAAAAAAAAf////8AAAAAAAAAA/////AAAAAAAAAAB////wAAAAAAAAAAD///+AAAAAAAAAAAP///gAAAAAAAAAAD/gD4AAAAAAAAAAAe/B8AAAAAAAAAAADz4+AAAAAAAAAAAAePPgAAAAAAAAAAAB/PwAAAAAAAAAAAAHz4AAAAAAAAAAAAA4f+AAAAAAAAAAAAB/n4AAAAAAAAAAAAB8NAAAAAAAAAAAAAHlgAAAAAAAAAAAAAf4AAAAAAAAAAAAAD+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAA==","h":54,"w":93},"spizella-passerina":{"bits":"AAAAAAAAAAAD+AAAAAAAAAAAAAD/+AAAAAAAAAAAAB//8AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAB///8AAAAAAAAAAAf///wAAAAAAAAAAH///+AAAAAAAAAAB////4AAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAA/////+AAAAAAAAAP/////4AAAAAAAAB/////+AAAAAAAAAf////+AAAAAAAAAH/////AAAAAAAAAB/////4AAAAAAAAA//////AAAAAAAAAP/////4AAAAAAAAD//////AAAAAAAAB//////4AAAAAAAAf//////AAAAAAAAH//////4AAAAAAAB///////AAAAAAAAf//////4AAAAAAAH///////AAAAAAAB///////4AAAAAAAf///////AAAAAAAH///////4AAAAAAB////////AAAAAAAf///////4AAAAAAH////////AAAAAAB////////4AAAAAAf////////AAAAAAH////////4AAAAAB////////+AAAAAAP////////wAAAAAD////////+AAAAAA/////////gAAAAAP////////8AAAAAB/////////AAAAAAf////////4AAAAAH////////+AAAAAA/////////wAAAAAP////////8AAAAAB/////////AAAAAAf////////wAAAAAD////////+AAAAAA/////////gAAAAAH////////4AAAAAA////////+AAAAAAP////////gAAAAAD////////wAAAAAAf///////8AAAAAAH////////AAAAAAB////////gAAAAAAf///////4AAAAAAD////////gAAAAAAb///////+AAAAAAA////////wAAAAAAH//////98AAAAAAA//////+vgAAAAAAH//gP/H34AAAAAAB//wB/g7+AAAAAAAf/4AP/GPwAAAAAAD/+AAB+b8AAAAAAA//AAAD8PAAAAAAAP/AAAAPwAAAAAAAD/wAAAAfgAAAAAAA/8AAAAA+AAAAAAAP/gAAAA/+AAAAAAB/4AAAB//4AAAAAAf+AAAAP8/AAAAAAH/gAAAD5H4AAAAAB/4AAAAaI+AAAAAAf+AAAADB/gAAAAAH/wAAAAMv4AAAAAA/8AAAAAH/AAAAAAP/AAAAAAfwAAAAAD/wAAAAAB+AAAAAAf8AAAAAAHAAAAAAH/gAAAAAAAAAAAAB/4AAAAAAAAAAAAAf+AAAAAAAAAAAAAD/gAAAAAAAAAAAAA/4AAAAAAAAAAAAAP/AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP8AAAAAAAAAAAAAD/AAAAAAAAAAAAAAfwAAAAAAAAAAAAAHgAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAA=","h":93,"w":93},"spizella-pusilla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAA/AAAAfgAAAAAAAAP7wAAf/gAAAAAAAD//gAP//AAAAAAAA//8AD//+AAAAAAAP//gA///4AAAAAAD//8AP///gAAAAAB///AD///+AAAAAAf//wB////4AAAAAH//8Af////gAAAAB//+AP////+AAAAAf//gB/////wAAAAH//wAH/////+AAAB//8AAH//////gAAf//AAAf//////gAH//gAAH///////gH//4AAAf//////////8AAAD///////////AAAAf//////////wAAAB//////////4AAAAP//////////AAAAB//////////wAAAAH/////////+AAAAA//////////wAAAAH/////////8AAAAA//////////gAAAAH/////////4AAAAA//////////AAAAAD/////////wAAAAAf////////+AAAAAD/////////4AAAAAf/////////gAAAAB//////////AAAAAP/////////+AAAAA//////////4AAAAH//////////AAAAAf/////////4AAAAB////////wAAAAAAP///////4AAAAAAA////////AAAAAAAD///////wAAAAAAAP//////8AAAAAAAAf//////AAAAAAAAB//////wAAAAAAAAH/////8AAAAAAAAAP/////AAAAAAAAAAf////gAAAAAAAAAAf///8AAAAAAAAAAAf///gAAAAAAAAAAH//n4AAAAAAAAAAH/4B8AAAAAAAAAA///geAAAAAAAAAAP/9gHgAAAAAAAAAD/4AB4AAAAAAAAAAD+AAeAAAAAAAAAAA/AAHvgAAAAAAAAAO4AD/8AAAAAAAAABkAD/+AAAAAAAAAAYgH/gAAAAAAAAAABGA/8AAAAAAAAAAAAAM/AAAAAAAAAAAAAAfwAAAAAAAAAAAAAHsAAAAAAAAAAAAAB5gAAAAAAAAAAAAAOYAAAAAAAAAAAAADBgAAAAAAAAAAAAAYEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"spizelloides-arborea":{"bits":"AAAAAAAAAAAA/8AAAAAAAAAAAAAf/4AAAAAAAAAAAAP//wAAAAAAAAAAAD///AAAAAAAAAAAB///4AAAAAAAAAAAP///gAAAAAAAAAAD///+AAAAAAAAAAA////8AAAAAAAAAAP////wAAAAAAAAAD/////AAAAAAAAAAf////4AAAAAAAAAH////8AAAAAAAAAA////+AAAAAAAAAAP////wAAAAAAAAAD////+AAAAAAAAAB/////wAAAAAAAAA/////+AAAAAAAAAf/////wAAAAAAAAH/////8AAAAAAAAD//////gAAAAAAAA//////8AAAAAAAAP//////gAAAAAAAD//////8AAAAAAAA///////gAAAAAAAf//////8AAAAAAAH///////gAAAAAAB///////8AAAAAAA////////gAAAAAAf///////8AAAAAAH////////gAAAAAB////////8AAAAAAf////////AAAAAAH////////4AAAAAB/////////AAAAAAf////////wAAAAAH////////+AAAAAB/////////gAAAAAP////////8AAAAAD/////////AAAAAA/////////4AAAAAH////////+AAAAAD/////////gAAAAA/////////4AAAAAP////////+AAAAAD/////////gAAAAA/////////4AAAAAP////////+AAAAAB/////////gAAAAAH////////wAAAAAD////////8AAAAAA/////////AAAAAAf////////gAAAAAH//+H////wAAAAAD//4AP///wAAAAAA//AAAJ//wAAAAAAf/wAAAH//AAAAAAH/4AAAAf5//wAAAB/+AAAAAfz//wAAA//AAAAAA////AAAP/wAAAAAH/D/IAAD/4AAAAAA/+EIAAB/+AAAAAAEP/4AAAP/AAAAAAA///+AAD/wAAAAAAP+//4AA/8AAAAAABoAfxAAH+AAAAAAAIAAGAAA/gAAAAAAAAAAAAAHwAAAAAAAAAAAAAAA=","h":68,"w":93},"stelgidopteryx-serripennis":{"bits":"AAAAAAAAAAAH/4AAAAAAAAAAAAD//wAAAAAAAAAAAB///AAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAD////AAAAAAAAAAAf///+AAAAAAAAAAH/////AAAAAAAAAB/////4AAAAAAAAAf////4AAAAAAAAAD////8AAAAAAAAAA/////AAAAAAAAAAP////wAAAAAAAAAD////+AAAAAAAAAB/////gAAAAAAAAAf////8AAAAAAAAAH/////gAAAAAAAAD/////8AAAAAAAAA//////gAAAAAAAAP/////+AAAAAAAAD//////wAAAAAAAB//////+AAAAAAAAf//////wAAAAAAAH//////+AAAAAAAB///////wAAAAAAAf//////+AAAAAAAH///////wAAAAAAB///////8AAAAAAAf///////gAAAAAAD///////8AAAAAAA////////gAAAAAAP///////4AAAAAAH////////AAAAAAB////////wAAAAAAf///////+AAAAAAH////////gAAAAAB////////8AAAAAAP////////AAAAAAD////////wAAAAAA////////+AAAAAAP////////gAAAAAD////////4AAAAAAf///////+AAAAAAH////////gAAAAAD////////4AAAAAA////////+AAAAAAP////////gAAAAAH////////4AAAAAB////////8AAAAAA/////////AAAAAAP////////wAAAAAD////////4AAAAAB/////////4AAAAA//////////gAAAAP/////////8AAAAD//////////gAAAB//////////4AAAAf//////////AAAAH///////4//4AAAA7/////g4H//AAAAA/////wAD+fgAAAAf////4AA+B8AAAAH/5//+AAHAPgAAAD/8P//AAA+B8AAAA/4D//gAAGAOAAAAH4Af/4AAAABwAAAAwAH/+AAAAA8AAAAAAB//AAAAAHAAAAAAAP/gAAAAAAAAAAAAD/4AAAAAAAAAAAAA//AAAAAAAAAAAAAH/wAAAAAAAAAAAAB/8AAAAAAAAAAAAAf/gAAAAAAAAAAAAH/4AAAAAAAAAAAAB//AAAAAAAAAAAAAf/wAAAAAAAAAAAAD/+AAAAAAAAAAAAA//gAAAAAAAAAAAAP38AAAAAAAAAAAAD8/AAAAAAAAAAAAA+HwAAAAAAAAAAAAPgeAAAAAAAAAAAAB4HgAAAAAAAAAAAAeA8AAAAAAAAAAAAHAHAAAAAAAAAAAAA4B4AAAAAAAAAAAAEAOAAAAAAAAAAAAAADwAAAAAAAAAAAAAAcAAAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAA=","h":92,"w":93},"stercorarius-longicaudus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAA//AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//wAAAAAAAAAAAAf//AAAAAAAAAAAA///4AAAAAAAAAAAP///AAAAAAAAAAAB///8AAAAAAAAAAAOP//wAAAAAAAAAAAB///wAAAAAAAAAAAP///wAAAAAAAAAAB////gAAAAAAAAAAf////AAAAAAAAAAD////8AAAAAAAAAA/////wAAAAAAAAAH/////gAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////wAAAAAAAAH//////gAAAAAAAA///////AAAAAAAAH//////+AAAAAAAA///////wAAAAAAAD///////AAAAAAAAf//////8AAAAAAAB///////gAAAAAAAH///////AAAAAAAAf///////AAAAAAAD////////wAAAAAAH////////4AAAAAAf////////4AAHgAB/////////gD/wAAD////3//////AAAAH///4A////4AAAAAf//4AAeA/8AAAAABxfAAAAAAH+AAAAAMDgAAAAAAB/AAAABgYAAAAAAAAfAAAAMDAAAAAAAAAPAAABgYAAAAAAAAAAAAAIDAAAAAAAAAAAAATgYAAAAAAAAAAAAH+DAAAAAAAAAAAAB/A8AAAAAAAAAAAAbz/AAAAAAAAAAAAAY/wAAAAAAAAAAAAAH8AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":53,"w":93},"stercorarius-maccormicki":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//wAAAAAAAAAAAAf//AAAAAAAAAAAAH//8AAAAAAAAAAAA///wAAAAAAAAAAA////AAAAAAAAAAAf///4AAAAAAAAAAH////gAAAAAAAAAB////8AAAAAAAAAAP////gAAAAAAAAAB////+AAAAAAAAAAMH////AAAAAAAAAAgf/////wAAAAAAAAD//////4AAAAAAAA///////4AAAAAAAP///////4AAAAAAB////////wAAAAAAf////////gAAAAAD/////////AAAAAAf////////8AAAAAH/////////+AAAAA//////////8AAAAH//////////4AAAA///////////gAAAH//////////+AAAA///////////4AAAD///////////gAAAf//////////+AAAD///////////wAAAf///////////4AAD/////////////wAP/////////////gB/////////////8AH/////////////AA/////////////AAD////////////4AAP////////////wAA/////////////AAD////////////4AAP////////////AAA////////////gAAD/////////z/wAAAH////////wAYAAAAf//////+AAAAAAAA///////gAAAAAAAB//////4AAAAAAAAB/////+AAAAAAAAAA/////AAAAAAAAAAB///8AAAAAAAAAAAH4f/AAAAAAAAAAAA+D/wAAAAAAAAAAAPAP8AAAAAAAAAA//4A+AAAAAAAAAAP//AHAAAAAAAAAAAf/oA4AAAAAAAAAAD/8APAAAAAAAAAAA//eP4AAAAAAAAAAPP3/+AAAAAAAAAABgYP/wAAAAAAAAAAIDB/+AAAAAAAAAAAAAP/wAAAAAAAAAAAAD/+AAAAAAAAAAAAA//gAAAAAAAAAAAAEA8AAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"stercorarius-parasiticus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAAP//+AAAAAAAAAAAB///wAAAAAAAAAAA///+AAAAAAAAAAA////4AAAAAAAAAAP////AAAAAAAAAAB////4AAAAAAAAAAPP///gAAAAAAAAAAA///+AAAAAAAAAAAH///8AAAAAAAAAAAf///+AAAAAAAAAAH////+AAAAAAAAAA/////+AAAAAAAAAP/////8AAAAAAAAB//////8AAAAAAAAf//////4AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////+AAAAAAAf///////4AAADwAD////////gAAB+AAf////////AAB/4AD////////+AA//gAf/////////A//8AD/////////////gAf////////////8AD/////////////gAf////////////wAB////////////4AAP///////////8AAA///////////+AAAH///////////AAAAf//////////4AAAD///////////4AAAP///////////4AAA////////////8AAD////////////4AAf////////////gAA///////////B8AAD//////////+AAAAP//////////+AAAA///////////8AAAD///////////4AAAH///////Af//AAAAf//////gAAPwAAAA//////8AAAAAAAAB/////+AAAAAAAAAf/////AAAAAAAAAD/////wAAAAAAAAA/f///wAAAAAAAAAH4P//gAAAAAAAAAA/If/4AAAAAAAAAAHdAP/AAAAAAAAAAA/4A/4AAAAAAAAAAD+AD8AAAAAAAAAAAeAAHgAAAAAAAAAAD4AA8AAAAAAAAAAAOAAHgAAAAAAAAAAAAAAYAAAAAAAAAAAAAADAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAHAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAGAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAPgAAAAAAAAAAAAAB/AAAAAAAAAAAAAj/4AAAAAAAAAAAAf/wAAAAAAAAAAAAH/+AAAAAAAAAAAAAAfwAAAAAAAAAAAAAH+AAAAAAAAAAAAAD7wAAAAAAAAAAAAB8OAAAAAAAAAAAAAPBwAAAAAAAAAAAAHwOAAAAAAAAAAAAAwAwAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":92,"w":93},"stercorarius-pomarinus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAA//gAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAH//+AAAAAAAAAAAB///4AAAAAAAAAAAf///gAAAAAAAAAB////8AAAAAAAAAA/////wAAAAAAAAAP////+AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAB8D////AAAAAAAAAIAL///+AAAAAAAAAABv///+AAAAAAAAAAL////8AAAAAAAAADf////4AAAAAAAAAf/////wAAAAAAAAD//////gAAAAAAAA3//////AAAAAAAAG//////8AAAAAAAA34Af///4AAAAAAAG8AD////gAAAAAAA3AAf////AAAAAAAG4AH////8AAAAAAAwAA/////wAAAAAAGAAH////+AAAAAAAQAA/////4AAAAAADAAP/////gAAAAAAYAB/////+AAAAAABgAP/////4AAAAAAMAD//////gAAAAABwAf/////+AAAAAAGAH//////4AAAAAAQD///////gAAAAADA///////+AAAAAAP////////wAAAAAA/////////AAAAAAD////////8AAAAAAf////////wAAAAAB/////////gAAAAAH/////////gAAAAAf/////////AAAAAB/////////+AAAAAH/////////8AAAAAf/////////4AAAAA//////////wAAAAD//////////gAAAAH/////////8AAAAAP////////4AAAAAAf////////wAAAAAD/////////AAAAAAP///5//8H4AAAAAA/f/AB//4AAAAAAAD5/4AH//gAAAAAAAeP/AAf/+AAAAAAAHg/gAB//4AAACOAB4D4AAD//gAAAA+AeAPAAAP/4AAAAA8HgBwAAA//gAAAAA/8AeAAAD/+AAAAAH/4DgAAAH/wAAAAA//gcAAAAA+AAAAAO38HAAAAAAAAAAAB+//4AAAAAAAAAAAPz//gAAAAAAAAAAAWf/8AAAAAAAAAAAB7+/8AAAAAAAAAAAH1//4AAAAAAAAAAA8M//wAAAAAAAAAADwP//gAAAAAAAAAAMB//8AAAAAAAAAAAAP94AAAAAAAAAAAAA3jAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":80,"w":93},"sterna-forsteri":{"bits":"AAB/AAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//wAAAAAAAAAAAP///AAAAAAAAAAAP///8AAAAAAAAAAP////gAAAAAAAAAH////+AAAAAAAAAA8A///wAAAAAAAAAAAB///AAAAAAAAAAAAH//8AAAAAAAAAAAA////AAAAAAAAAAAH////wAAAAAAAAAA/////wAAAAAAAAAH/////gAAAAAAAAA//////AAAAAAgAAP/////+AAAAB8AAB///////+AAB/gAAP///////+AD/wAAA////////gH/4AAAH//////////8AAAA//////////+AAAAH//////////wAAAAf///////////wAAD////////////AAAP///////////gAAA/////////8AAAAAD/////////AAAAAAP////////+AAAAAA//////////+AAAAD//////4AP//4AAAH////+AAAAACAAAAP///+AAAAAAAAAAAP///AAAAAAAAAAAAH/+AAAAAAAAAAAAAH+AAAAAAAAAAAAAB+AAAAAAAAAAAAAAfwAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAB//AAAAAAAAAAAAAL+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAAwAAAAAAAAAAAAAACAAAAAAAAAA==","h":46,"w":93},"sterna-hirundo":{"bits":"AAf+AAAAAAAAAAAAAH/4AAAAAAAAAAAAB//gAAAAAAAAAAAD//+AAAAAAAAAAAH///4AAAAAAAAAAH////AAAAAAAAAAA////8AAAAAAAAAAAAf//gAAAAAAAAAAAA//8AAAAAAAAAAAAD//gAAAAAAAAAAAAP/+AAAAAAAAAAAAB//wAAAAAAAAAAAAf//wAAAAAAAAAAAD///wAAAAAAAAAAAf///gAAAAAAAAAAD////gAAAAAAAAAA/////AAAAAAAAAAH////8AAAAAAAAAA/////4AAAAAAAAAD/////gAAAAAAAAAf////+AAAAAAAAAD/////8AAAAAAAAAf/////wAAAAAAAAB//////AAAAAAAAAP/////+AAAAAAAAA//////8AAAAAAAAH//////8AAAAAAAAf//////wAAAAAAAB///////4AAAD4AAP////////////AAA////////////gAAD///////////gAAAP//////////gAAAAf////////+AAAAAB////////4AAAAAAB///////4AAAAAAAD//////8AAAAAAAAH///4AAAAAAAAAAAf//wAAAAAAAAAAAD8/gAAAAAAAAAAAAfAAAAAAAAAAAAAAf8AAAAAAAAAAAAAD/gAAAAAAAAAAAAH/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAeAAAAAAAAAAAA==","h":47,"w":93},"sterna-paradisaea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAB/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAB///wAAAAAAAAAAP////AAAAAAAAAAP/////AAAAAAAAAP/////+AAAAAAAAf//////4AAAAAAB//////8fh/4AAAH///////gED////////////8AAB///////////4gAAB//////////+EAAAA//////////wgAAAAP////////+EAAB///////////xgAP///////////8MAAAAA/////////jAAAAAAAHx/////4QAAAAAAAD5////+GAAAAAAAABw////hgAAAAAAAADg///w4AAAAAAAAAHh//4MAAAAAAAAAAOAPgHAAAAAAAAAAAcAAHgAAAAAAAAAAA/4PgAAAAAAAAAAAAP/AAAAAAAAAAAAAAf2AAAAAAAAAAAAAAf+AAAAAAAAAAAAAD/gAAAAAAAAAAAAAQeAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":38,"w":93},"sternula-antillarum":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//gAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAD////gAAAAAAAAAB/////AAAAAAAAAA///////gAAAAAAAP///////4AAAAAAAAD//////wAAAAAAAAP//////wAAAD/gAA/////////g//8AAH///////////4AAA////////////gAAH///////////4AAA///////////8AAAH//////////+AAAA///////////AAAAH//////////gHgAA////////////4AAH///////////gAAAf///////////8AAD////////////AAAf////////8AAAAAB////////4AAAAAAP///////8AAAAAAA///////+AAAAAAAD///////AAAAAAAAP//////gAAAAAAAAf/////wAAAAAAAAB/////8AAAAAAAAAD////+AAAAAAAAAAH////AAAAAAAAAAAB///AAAAAAAAAAAAAP/gAAAAAAAAAAAADx4AAAAAAAAAAAAB4HAAAAAAAAAAAAP/hwAAAAAAAAAAAD/8cAAAAAAAAAAAAD4HAAAAAAAAAAAAA//+AAAAAAAAAAAAP//wAAAAAAAAAAABmfgAAAAAAAAAAAAMX8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAY4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":52,"w":93},"streptopelia-decaocto":{"bits":"AAAAAAAAAAAAAfAAAAAAAAAAAAAAf+AAAAAAAAAAAAAH/4AAAAAAAAAAAAB//gAAAAAAAAAAAAf/8AAAAAAAAAAAAH//gAAAAAAAAAAAA//+AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAAP//+AAAAAAAAAAAD///4AAAAAAAAAAAf/+HAAAAAAAAAAAH//gAAAAAAAAAAAA//4AAAAAAAAAAAAP/+AAAAAAAAAAAAD//wAAAAAAAAAAAA//+AAAAAAAAAAAAP//wAAAAAAAAAAAD//+AAAAAAAAAAAB///4AAAAAAAAAAAf///AAAAAAAAAAAP///4AAAAAAAAAAH////AAAAAAAAAAD////4AAAAAAAAAB/////AAAAAAAAAA/////4AAAAAAAAAP/////AAAAAAAAAH/////4AAAAAAAAB//////AAAAAAAAAf/////4AAAAAAAAH//////AAAAAAAAB//////4AAAAAAAA///////AAAAAAAAP//////4AAAAAAAH///////AAAAAAAB///////4AAAAAAA///////+AAAAAAAP///////wAAAAAAD///////+AAAAAAB////////gAAAAAAP///////8AAAAAAH////////AAAAAAB////////4AAAAAAf///////+AAAAAAP////////gAAAAAH////////4AAAAAB////////+AAAAAAf////////gAAAAAH////////wAAAAAA////////8AAAAAAH///////+AAAAAAD////////AAAAAAB///////+AAAAAAA////////AAAAAAAf///////48AAAAAP//+AAD///4AAAAH//8AAAD///gAAAB//wAAAAH//EAAAA//wAAAAA//4AAAAf/4AAAAAP//gAAAP/8AAAAAAA//AAAD/8AAAAAAAB4oAAA/+AAAAAAAAHAAAAH+AAAAAAAAAMAAAAEAAAAAAAAABAAAAA","h":65,"w":93},"streptopelia-roseogrisea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAAf/+AAAAAAAAAAAAD//wAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAD///AAAAAAAAAAAA///4AAAAAAAAAAAP///gAAAAAAAAAABgf/8AAAAAAAAAAAAB//gAAAAAAAAAAAAP/8AAAAAAAAAAAAA//wAAAAAAAAAAAAH/+AAAAAAAAAAAAA//4AAAAAAAAAAAAH//gAAAAAAAAAAAA//8AAAAAAAAAAAAH//wAAAAAAAAAAAA///gAAAAAAAAAAAH//+AAAAAAAAAAAA///4AAAAAAAAAAAH///gAAAAAAAAAAA///+AAAAAAAAAAAH///4AAAAAAAAAAA////wAAAAAAAAAAH////gAAAAAAAAAA////+AAAAAAAAAAP////8AAAAAAAAAB/////wAAAAAAAAAP/////AAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAB//////4AAAAAAAAP//////gAAAAAAAA//////+AAAAAAAAH//////8AAAAAAAAf//////wAAAAAAAB///////AAAAAAAAP//////4AAAAAAAA///////gAAAAAAAD//////+AAAAAAAAP//////4AAAAAAAA///////AAAAAAAAD//////8AAAAAAAAP//////wAAAAAAAA///////AAAAAAAAB//////8AAAAAAAAH//////8AAAAAAAAf//////4AAAAAAAA///////gAAAAAAAB///////AAAAAAAAD//////8AAAAAAAAP//////wAAAAAAAH///////AAAAAAAD/+AO///4AAAAAAA/4AAB//+AAAAAAA//AAAD//gAAAAAAf48AAAH/+AAAAAAH//gAAAP/8AAAAAA9/0AAAAf/wAAAAAHn+AAAAB//AAAAAAMHAAAAAH/8AAAAABwAAAAAAP/4AAAAAHAAAAAAA//gAAAAAQAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":83,"w":93},"strix-occidentalis":{"bits":"AA//gAAAAAB///AAAAAB///8AAAAA////gAAAAf///8AAAAP////gAAAH////8AAAB/////gAAA/////4AAAP////+AAAH/////wAAB/////8AAAf/////gAAP/////4AAD/////+AAA//////gAAP/////8AAD//////AAA//////wAAP/////8AAD//////AAA//////wAAP/////8AAD//////gAAf/////8AAH//////gAB//////+AAf//////wAH//////+AB///////wA///////8AP///////gD///////8A////////AP///////4D////////A////////wH///////+B////////gf///////4H////////B////////wf///////8H////////g////////4P///////+D////////g////////8H////////B////////wf///////8D////////A////////wH///////8A////////gH///////4A///////+AH///////gB///////8AP///////AB///////wAP//////8AB///////AAP//////wAB//////8AAP//////AAB//////wAAP/////8AAB//////AAAP/////AAAH/////wAAD/////+AAB//////gAH//////4AD//////+AA///////gAf//////4AH4/////+AB+fw+///wAPH8Dn//8AA8+Ax///AACNgIf/7wAAAYAH/+cAAAAAB//gAAAAAAf/4AAAAAAH/+AAAAAAA//gAAAAAAP/4AAAAAAD/+AAAAAAA//gAAAAAAH/4AAAAAAA/+AAAAAAAB/A","h":93,"w":56},"strix-varia":{"bits":"AAAAAAAAAAAAAAAAAAAAf/8AAAAAA///gAAAAA///8AAAAA////AAAAA////wAAAA////8AAAAf///+AAAAf////gAAAP////wAAAP////8AAAH////+AAAD/////AAAD/////gAAB/////4AAA/////8AAAf////+AAAP/////AAAH/////gAAD/////wAAB/////8AAA/////+AAAP/////gAAH/////4AAD/////+AAB//////gAA//////4AAf//////AAP//////wAP//////4AH//////+AD///////gB///////wA///////8Af//////+AP///////AH///////wD///////4B///////8A////////Af///////gH///////wD///////4B///////8A////////Af///////gP///////4H///////8D///////+A////////gP///////wD///////4A///////4Af//////8AH//////+AD///////AA///////wAf//////4AH//////8AD//////+AA///////AAP//////gAH//////wAB//////4AA//////8AAf/////+AAP//////AAD//////AAB+/////AAAAP////gAAAAB///4AAAAAf//8AAAAAP//+AAAAAD///AAAAAB///gAAAAA///wAAAAAP//4AAAAAH//cAAAAAD//uAAAAAB//zAAAAAA//5AAAAAAP/8AAAAAAH/+AAAAAAD//AAAAAAA//gAAAAAAf/wAAAAAAP/4AAAAAAD/8AAAAAAA/8AAAAAAAA4AAAAAAAAAAAAAAAAAAAAA==","h":93,"w":55},"sturnella-magna":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//gAAAAAAAAAAAAf/+AAAAAAAAAAAAH//+AAAAAAAAAAAB///+AAAAAAAAAAAP///8AAAAAAAAAAD////gAAAAAAAAAAf//+AAAAAAAAAAAH//+AAAAAAAAAAAA///gAAAAAAAAAAAP//4AAAAAAAAAAAB///AAAAAAAAAAAAf//wAAAAAAAAAAAH//+AAAAAAAAAAAD///gAAAAAAAAAAB///8AAAAAAAAAAA////gAAAAAAAAAAf///8AAAAAAAAAAP////gAAAAAAAAAH////8AAAAAAAAAB/////wAAAAAAAAA/////+AAAAAAAAAP/////wAAAAAAAAH/////8AAAAAAAAD//////gAAAAAAAB//////8AAAAAAAAf//////gAAAAAAAP//////4AAAAAAAD///////AAAAAAAB///////wAAAAAAAf//////+AAAAAAAH///////gAAAAAAB///////8AAAAAAAf///////AAAAAAAH///////wAAAAAAD///////+AAAAAAB////////gAAAAAA////////4AAAAAAP///////+AAAAAAD////////gAAAAAAP///////4AAAAAAH///////8AAAAAAD////////AAAAAAB////////gAAAAAA////////wAAAAAAf/wAH///4AAAAAAP/8AAH//8AAAAAAH/+AAAf/8AAAAAAD//AAAD/f//4AAAA//gAAAfj///8AAAP/wAAADwH/n/wAAB/4AAAAeAAH/+AAAP8AAAAB4AB8PwAAA+AAAAAHgAIA/AAADAAAAAAcABADYAAAAAAAAABwAAAbAAAAAAAAAAHAAAAIAAAAAAAAAA8AAABAAAAAAAAAADgAAAAAAAAAAAAAAOAAAAAAAAAAAAAB44YAAAAAAAAAAAAP//wAAAAAAAAAAAAf//AAAAAAAAAAAAAB/+AAAAAAAAAAAAADx4AAAAAAAAAAAAAHgAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":71,"w":93},"sturnella-neglecta":{"bits":"AAA/4AAAAAAAAAAAAA//wAAAAAAAAAAAAf//gAAAAAAAAAAA///+AAAAAAAAAAD////4AAAAAAAAAD/////gAAAAAAAAA/////+AAAAAAAAAB/////4AAAAAAAAAA/////AAAAAAAAAAA////8AAAAAAAAAAB////gAAAAAAAAAAH///8AAAAAAAAAAA////wAAAAAAAAAAD///+AAAAAAAAAAAP///4AAAAAAAAAAB////AAAAAAAAAAAP///8AAAAAAAAAAA////gAAAAAAAAAAH///+AAAAAAAAAAA////8AAAAAAAAAAH////4AAAAAAAAAA/////wAAAAAAAAAH/////gAAAAAAAAA/////+AAAAAAAAAP/////8AAAAAAAAB//////wAAAAAAAAP//////AAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAD///////gAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAP///////4AAAAAAB////////gAAAAAAP///////+AAAAAAB////////4AAAAAAP////////gAAAAAB////////8AAAAAAH////////wAAAAAA/////////AAAAAAH////////8AAAAAAf////////gAAAAAD////////+AAAAAAP////////4AAAAAB/////////AAAAAAH////////8AAAAAAf////////wAAAAAD////////+AAAAAAP////////4AAAAAA/////////AAAAAAD////////8AAAAAAP////////gAAAAAA////////+AAAAAAD////////wAAAAAAH///////+AAAAAAAf///////4AAAAAAA////////gAAAAAAB///////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAH///////+AAAAAAB////////4AAAAAAf+AB/////gAAAAAH74Af/f/+8AAAAAB/HAf+B//wAAAAAAP44f+AH//AAAAAAB/jP+AAP/4AAAAAAP85/wAA//gAAAAAA/8f/gAH/+AAAAAAB/H48AAf/wAAAAAAPg/DwAD//AAAAAAA4H4GAAP/4AAAAAADg/gwAB//gAAAAAAPn+cAAH/+AAAAAAAAf/AAA//wAAAAAAAA/gAAD//AAAAAAAAHgAAAf/8AAAAAAAAPwAAB//wAAAAAAAA+AAAH/+AAAAAAAAAAAAA//4AAAAAAAAAAAAD//gAAAAAAAAAAAAf/8AAAAAAAAAAAAB//wAAAAAAAAAAAAP/+AAAAAAAAAAAAA//4AAAAAAAAAAAAD//AAAAAAAAAAAAAf/4AAAAAAAAAAAAB8OAAAAAAAAAAAAAHgA=","h":91,"w":93},"sturnus-vulgaris":{"bits":"AAAAAAAAAAf/gAAAAAAAAAAAAP//AAAAAAAAAAAAH//+AAAAAAAAAAAB///8AAAAAAAAAAAf////gAAAAAAAAAH/////4AAAAAAAAA//////wAAAAAAAAP//////AAAAAAAAD//////wAAAAAAAAf////8AAAAAAAAAD////wAAAAAAAAAA////8AAAAAAAAAAH////AAAAAAAAAAA////wAAAAAAAAAAH///+AAAAAAAAAAB////gAAAAAAAAAAP///8AAAAAAAAAAB////gAAAAAAAAAAf///4AAAAAAAAAAD////AAAAAAAAAAA////8AAAAAAAAAAf////gAAAAAAAAAH////8AAAAAAAAAD/////gAAAAAAAAA/////8AAAAAAAAAP/////wAAAAAAAAD/////+AAAAAAAAB//////wAAAAAAAAf//////AAAAAAAAH//////4AAAAAAAB///////AAAAAAAAf//////4AAAAAAAH///////AAAAAAAA///////4AAAAAAAP///////AAAAAAAD///////4AAAAAAA////////AAAAAAAP///////4AAAAAAB////////AAAAAAAf///////wAAAAAAH///////+AAAAAAA////////gAAAAAAf///////8AAAAAAD////////AAAAAAA////////4AAAAAAP///////+AAAAAAD////////wAAAAAA////////8AAAAAAH////////gAAAAAB////////4AAAAAAP////////AAAAAAD////////wAAAAAAf///////8AAAAAAH////////AAAAAAA////////wAAAAAAP///////+AAAAAAB////////gAAAAAAP///////4AAAAAAD///////+AAAAAAAf///////gAAAAAAH///////4AAAAAAB///////8AAAAAAAP///////AAAAAAAD///////wAAAAAAA///////8AAAAAAAH//////+AAAAAAAB///////AAAAAAAAf//////wAAAAAAAH//////4AAAAAAAB//////+AAAAAAAAf//////gAAAAAAAD//////4AAAAAAAA3//8A/+AAAAAAAAB//+AB/geAAAAAAAP//gAH4P4AAAAAAD//wAAf//+AAAAAA//8AAB///wAAAAAP/+AAAH//zAAAAAD/+AAB///wAAAAAA//wAAf///AAAAAAH/8AADeB/sAAAAAB//AAAQAH4D4AAAAf/wAAAAAPz/AAAAH/+AAAAAA///4AAA//gAAAAP////gAAH/4AAAAD////kAAA/+AAAAAb8f+AAAAH/gAAAACMAf8AAAA/8AAAAAAAA/wAAAD/AAAAAAAAAGAAAAPwAAAAAAAAAAAAAA=","h":91,"w":93},"sula-leucogaster":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAB//+AAAAAAAAAAAA///wAAAAAAAAAAAf///AAAAAAAAAAAf///4AAAAAAAAAAf////AAAAAAAAAAH////8AAAAAAAAAB/////gAAAAAAAAAPAAD/8AAAAAAAAAAAAAf/gAAAAAAAAAAAAH/8AAAAAAAAAAAAA//gAAAAAAAAAAAAP/4AAAAAAAAAAAAB//AAAAAAAAAAAAAf/4AAAAAAAAAAAAD//AAAAAAAAAAAAA//wAAAAAAAAAAAAH/+AAAAAAAAAAAAA//wAAAAAAAAAAAAP/+AAAAAAAAAAAAB//4AAAAAAAAAAAAP//wAAAAAAAAAAAB///gAAAAAAAAAAAP///wAAAAAAAAAAB////4AAAAAAAAAAP////8AAAAAAAAAA/////4AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH//////AAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA///////gAAAAAAAD///////AAAAAAAAf//////+AAAAAAABB//////8AAAAAAAMD//////wAAAAAAAwH//////4AAAAAADAf///////gAAAAAMB////////wAAAAAwH////////8AAAABgf////////8AAAAHB/////////gAAAAMD////////gAAAAAYH///////wAAAAAAwP//////gAAAAAAD4P//+P/gAAAAAAAHgf//AAAAAAAAAAA+BAHAAAAAAAAAAAHIP/AAAAAAAAAAAB5DAAAAAAAAAAAAAPH4AAAAAAAAAAB//5+AAAAAAAAAAAP///gAAAAAAAAAAA///wAAAAAAAAAAAP//8AAAAAAAAAAAD///gAAAAAAAAAAAAH/8AAAAAAAAAAAAA//gAAAAAAAAAAAA//4AAAAAAAAAAAAP/+AAAAAAAAAAAAAP/gAAAAAAAAAAAAAPwAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAA=","h":69,"w":93},"tachybaptus-dominicus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//4AAAAAAAAAAAB///gAAAAAAAAAAAf//+AAAAAAAAAAAD///wAAAAAAAAAAA////AAAAAAAAAAAP///4AAAAAAAAAAB////gAAAAAAAAAAP///+AAAAAAAAAAD////8AAAAAAAAAAf////8AAAAAAAAAD/////8AAAAAAAAAf/////4AAAAAAAAD///4D/gAAAAAAAAf//8AAAAAAAAAfgD//4AAAAAAAAH//8f/8AAAAAAAAH//////gAAAAAAAD//////+AAAAAAAB///////wAAAAAAB////////AAAAAAAf///////8AAAAAAP////////wAAAAAD/////////AAAAAA/////////4AAAAAf/////////gAAAAP/////////8AAABz//////////wAAAf//////////+AAAP///////////wAAA///////////+AAAP///////////4AAB////////////AAAH///////////wAAA///////////+AAAH///////////wAAAf//////////+AAAAf//////////wAAAD//////////8AAAAf//////////gAAAB//////////4AAAAH/////////+AAAAAf/////////wAAAAB/////////8AAAAAH/////////AAAAAAf////////wAAAAAB////////8AAAAAAD///////+AAAAAAAP//////+AAAAAAAAP/////+AAAAAAAAB//////8AAAAAAAAP4//v//8AAAAAAAB+AAD///4AAAAAAAP8AAbn//AAAAAAAAf4AAA/+AAAAAAAAA/4AAD/wAAAAAAAAB/wAAf+AAAAAAAAAB/gAB/4AAAAAAAAAf/4APfAAAAAAAAAH///Bw4AAAAAAAAA///8GBAAAAAAAAAAB/8AgIAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA8eAAAAAAAAAAAAAHAwAAAAAAAAAAAAA4GAAAAAAAAAAAAABAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":76,"w":93},"tachycineta-bicolor":{"bits":"AAAAAAAAD8AAAAAAAAAD/8AAAAAAAAB//wAAAAAAAAf//AAAAAAAAH//8AAAAAAAA///wAAAAAAAP///4AAAAAAD////AAAAAAAf///AAAAAAAD///gAAAAAAAf//8AAAAAAAH///gAAAAAAA///4AAAAAAAH///AAAAAAAB///4AAAAAAAf///AAAAAAAH///4AAAAAAB////gAAAAAAP///8AAAAAAD////gAAAAAA////+AAAAAAH////wAAAAAB////+AAAAAAf////wAAAAAH////8AAAAAB/////gAAAAAP////8AAAAAD/////gAAAAA/////8AAAAAH/////gAAAAB/////4AAAAAP/////AAAAAD/////4AAAAAf/////AAAAAH/////4AAAAA/////+AAAAAP/////wAAAAB/////8AAAAAf/////gAAAAD/////4AAAAA//////AAAAAH/////wAAAAB/////8AAAAAP/////gAAAAB/////4AAAAAf////+AAAAAD/////gAAAAA/////4AAAAAH/////AAAAAA/////wAAAAAP////8AAAAAB/////AAAAAAP////wAAAAAD////4AAAAAAf////AAAAAAD/////AAAAAAf////8AAAAAH/////gAAAAA/////8AAAAAP////3gAAAAB/////8AAAAAf//+/PAAAAAH/////wAAAAA///f88AAAAAH//h/AAAAAAB//4DgAAAAAAf//AAAAAAAAH//wAAAAAAAB//8AAAAAAAAf//AAAAAAAAH//wAAAAAAAB//8AAAAAAAAf//AAAAAAAAD//4AAAAAAAA///AAAAAAAAP//wAAAAAAAD//+AAAAAAAA///gAAAAAAAP//8AAAAAAAD///gAAAAAAAf//4AAAAAAAD///AAAAAAAA93/wAAAAAAAGeP+AAAAAAAADj3gAAAAAAAA4c8AAAAAAAAGDngAAAAAAAAgY4AAAAAAAAAAHAAAAAAAAAAA4AAAAAAAAAAGAAAAAAAAAABwAAAAAAAAAAEAAAAAAAAAA=","h":93,"w":69},"tachycineta-thalassina":{"bits":"AAAAAAAAAAAfAAAAAAAAAAAAD/4AAAAAAAAAAAP/+AAAAAAAAAAAf//AAAAAAAAAAA///AAAAAAAAAAB///gAAAAAAAAAD////AAAAAAAAAH////AAAAAAAAAH///4AAAAAAAAAP///gAAAAAAAAAP///AAAAAAAAAAf//+AAAAAAAAAA///+AAAAAAAAAD///8AAAAAAAAAP///8AAAAAAAAAf///8AAAAAAAAA////8AAAAAAAAD////8AAAAAAAAH////8AAAAAAAAP////8AAAAAAAAf////8AAAAAAAA/////8AAAAAAAB/////8AAAAAAAD/////8AAAAAAAP/////4AAAAAAA//////4AAAAAAB//////4AAAAAAD//////wAAAAAAH//////wAAAAAAP//////gAAAAAAf//////gAAAAAB///////AAAAAAB//////+AAAAAAD//////8AAAAAAP//////4AAAAAAf//////4AAAAAB///////gAAAAAD///////AAAAAAP//////+AAAAAAf//////8AAAAAB///////4AAAAAH///////8AAAAAP///////8AAAAA////////8AAAAD////////8AAAAH////////4AAAAf//////+/gAAAB///////9/gAAAD////////+AAAAH9////+5/wAAAAPj/+f/4AvgAAAAOP/4f/wA3gAAAAA//g//gAfAAAAAD/8A/+AAEAAAAAP/gB/8AAAAAAAAf8AB/4AAAAAAAA/gAD/4AAAAAAAA4AAD/4AAAAAAAAAAAH/wAAAAAAAAAAAH/gAAAAAAAAAAAP/gAAAAAAAAAAAf/AAAAAAAAAAAA//AAAAAAAAAAAB/+AAAAAAAAAAAD9+AAAAAAAAAAAH48AAAAAAAAAAAHg8AAAAAAAAAAAPB8AAAAAAAAAAAeB4AAAAAAAAAAA8B4AAAAAAAAAAB4BwAAAAAAAAAADwBwAAAAAAAAAAHgDgAAAAAAAAAAHADgAAAAAAAAAAOADgAAAAAAAAAAcAHAAAAAAAAAAA4AHAAAAAAAAAAAwAGAAAAAAAAAABwAOAAAAAAAAAADgAOAAAAAAAAAADAAMAAAAAAAAAAGAAcAAAAAAAAAAOAAYAAAAAAAAAAMAA4AAAAAAAAAAIAA4AAAAAAAAAAAABwAAAAAAAAAAAABwAAAAAAAAAAAADgAAAAAAAAAAAADAAAAAAAAAAAAAHAAAAAAAAAAAAAGAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":93,"w":84},"tadorna-ferruginea":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAB/+AAAAAAAAAAAAA//8AAAAAAAAAAAAP//wAAAAAAAAAAAB///AAAAAAAAAAAAf//4AAAAAAAAAAAD///gAAAAAAAAAAAf//+AAAAAAAAAAAH///wAAAAAAAAAAB///+AAAAAAAAAAAf///4AAAAAAAAAAH////AAAAAAAAAAD////4AAAAAAAAAB/////gAAAAAAAAAP8D//8AAAAAAAAAB8Af//gAAAAAAAAAAAD//8AAAAAAAAAAAAf//gAAAAAAAAAAAD//8AAAAAAAAAAAA///gAAAAAAAAAAAP/////AAAAAAAAAD//////gAAAAAAAA///////AAAAAAAAP//////+AAAAAAAD///////8AAAAAAA////////wAAAAAAH////////gAAAAAB/////////AAAAAAP/////////AAAAAB/////////+AAAAAP/////////8AAAAD//////////wAAAAf//////////AAAAD//////////8AAAAP//////////wAAAB///////////wAAAP///////////AAAB///////////+AAAH///////////8AAA////////////4AAD////////////gAAf///////////8AAB////////////wAAH////////////AAAP///////////AAAA////////////AAAB///////////+AAAB///////////4AAAD///////////gAAAP//////////8AAAAf///////8//AAAAA///////wAfgAAAAB//////4AAAAAAAAD/////4AAAAAAAAAD////8AAAAAAAAAAD///8AAAAAAAAAAAA/+AAAAAAAAAAAAP9/gAAAAAAAAAAAB//8AAAAAAAAAAAAP//gAAAAAAAAAAAH//8AAAAAAAAAAAB//3gAAAAAAAAAAAIf48AAAAAAAAAAAAA8HgAAAAAAAAAAAAEA8AAAAAAAAAAAAAePwAAAAAAAAAAAAD//AAAAAAAAAAAAAf/8AAAAAAAAAAAAf/8AAAAAAAAAAAAf//gAAAAAAAAAAAC//gAAAAAAAAAAAAA/4AAAAAAAAAAAAAH+AAAAAAAAAAAAAA/AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"thalasseus-elegans":{"bits":"AAAABGAAAAAAAAAAAAAA7gAAAAAAAAAAAAH/8gAAAAAAAAAAAH//4AAAAAAAAAAAD//+AAAAAAAAAAAA///4AAAAAAAAAAAP///AAAAAAAAAAAD///8AAAAAAAAAAD////wAAAAAAAAAD////8AAAAAAAAAB/////AAAAAAAAAA/////4AAAAAAAAAf/v///gAAAAAAAAH4AP//4AAAAAAAAAgAA///AAAAAAAAAAAAH//oAAAAAAAAAAAB//+AAAAAAAAAAAAP//8AAAAAAAAAAAD////AAAAAAAAAAAf////AAAAAAAAAAD/////AAAAAAAAAA/////+AAAAAAAAAH/////8AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAA///////wAAAAAAAH///////+AAAAAAA////////+AAAAAAH////////8AAPAAAf////////AB/4AAD///////////+AAAf///////////AAAB///////////AAAAH//////////gAAAA//////////AAAAAD/////////AAAAAAP/////////4AAAAA///////////gAAAH///////////4AAAf///////////AAAA//////AB/wAAAAAB/////AAB/wAAAAAB////gAAA/gAAAAAB///4AAAAfAAAAAAA//4AAAAAPAAAAAAD/AAAAAAAMAAAAAAbwAAAAAAAAAAAAADcAAAAAAAAAAAAAAbAAAAAAAAAAAAAHn4AAAAAAAAAAAAA//gAAAAAAAAAAAAD+eAAAAAAAAAAAAB//wAAAAAAAAAAAAd/8AAAAAAAAAAAACP/AAAAAAAAAAAAAB/wAAAAAAAAAAAAAP8AAAAAAAAAAAAABHAAAAAAAAAAAAAAAYAAAAAAAAAAAAAACAAAAAAAAAA=","h":60,"w":93},"thalasseus-maximus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAA//gAAAAAAAAAAAAP/+AAAAAAAAAAAAD//8AAAAAAAAAAAA///+AAAAAAAAAAAP///+AAAAAAAAAAB////8AAAAAAAAAAP////4AAAAAAAAB////B/gAAAAAAAH////gAAAAAAAAAH////4AAAAAAAAAH/////AAAAAAAAAD/////8AAAAAAAAB//////gAAAAAAH///////8AAAP4AD////////gAAD///////////8AAB////////////gAAH///////////0AAAP//////////8gAAAf//////////kAAAAf/////////BAAAAAf////////wIAAAP/////////8DAAAB//////////gwAAAAH////////4MAAAAAAH//////8DAAAAAAAAf/////AwAAAAAAAAf////gMAAAAAAAAAP///wDAAAAAAAAAA+H/4DgAAAAAAAAABgP/DwAAAAAAAAAADg//wAAAAAAAAAAAH//gAAAAAAAAAAAAAfwAAAAAAAAAAAAAA+AAAAAAAAAAAAAAD4AAAAAAAAAAAAAAfAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAP/AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//AAAAAAAAAAAAAA//AAAAAAAAAAAAAF/gAAAAAAAAAAAAAB/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":49,"w":93},"thryomanes-bewickii":{"bits":"BgAAAAAAAAAAAAAAfgAAAAAAAAAAAAAD+AAAAAAAAAAAAAAf4AAAAAAAAAAAAAf/gAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/wAAAAAAAAAAAAB//AAAAAAAAAAAAAP/8AAAAAAAAAAAAH//wAAAAAAAAAAAA///AAAAAAAAAAAAD//8AAAAAAAAAAAAf//gAAAAAAAAAAAH//+AAAAAAAAAAAA///4AAAAAAB/wAAD///gAAAAAB//gAAf//+AAAAAB///gAB///wAAAAA////H4H///AAAAAP/////wf//8AAAAH//////B///wAAAB//////gH///AAAA/////+AAP//4AAB/////+AAA///gAD//////gAAD//+AD//////4AAAP//4B//////+AAAA///5///////wAAAD//////////+AAAAP//////////gAAAAf/////////8AAAAD//////////gAAAAf/////////4AAAAD//////////AAAAAf/////////wAAAAB/////////+AAAAAP/////////wAAAAB/////////+AAAAAH/////////wAAAAA/////////8AAAAAH/////////gAAAAAf////////8AAAAAD/////////AAAAAAf////////4AAAAAH////////+AAAAAA/////////wAAAAAP////////8AAAAAB/////////AAAAAAH////////wAAAAAA////////+AAAAAAP////////gAAAAAD////////4AAAAAA////////+AAAAAAP////////gAAAAAB////////4AAAAAAf///////+AAAAAAD/4f/////+AAAAAAfgA//////4AAAAADAAD//////4AAAAAAAAH//////gAAAAAAAAP//3+P8AAAAAAAAB/+A+A/gAAAAAAAAP4APgH8AAAAAAAAB+ABgA/gAAAAAAAAP4AEAH4AAAAAAAAAfgAgC/AAAAAAAAAA+AAAf4AAAAAAAAAB4AAD/AAAAAAAAAAHwAAA4AAAAAAAAAAfAAAHAAAAAAAAAAA+AADwAAAAAAAAAAD4AAcAAAAAAAAAAAPgAAAAAAAAAAAAAA/AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//8AAAAAAAAAAAAP3/wAAAAAAAAAAABgD/AAAAAAAAAAAAMAf8AAAAAAAAAAAAgD5gAAAAAAAAAAAAAfsAAAAAAAAAAAAAB/AAAAAAAAAAAAAAfgAAAAAAAAAAAAAb8AAAAAAAAAAAAAD9wAAAAAAAAAAAAAP+AAAAAAAAAAAAAARwAAAAAAAAAAAAAAGAAAAAAAAAAAAAABgAAAAAAAAAAAAAA8AAAAAAAAAAAAAAHAAAAAAA","h":90,"w":93},"thryothorus-ludovicianus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAP8AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAA//8AAAAAAAAAAAAP//gAAAAAAAAAAAB//4AAAAAAAAAAAAf//AAAAAAAAAAAAH//wAAAAAAAAAAAA//8AAAAAAAAAAAAP//AAAAAAAAAAAAD//wAAAAAAAAAAAAf/8AAAAAAAAAAAAH//AAAAAAAAAAAAB//wAAAAAAAAAAAAP/8AAAAAfAAAAAAH//AAAAA//wAAAAB//wAAAAf//gAAAAf/8AAAAf///AAAAH//AAAP////+P/////4AAH////////////AAB////////////4AAB////////////AAAAf//////////wAAAB//////////+AAAAH//////////gAAAAP/////////8AAAAB//////////gAAAAH/////////8AAAAA//////////gAAAAD/////////4AAAAAf////////+AAAAAB/////////4AAAAAP/////////wAAAAA//////////gAAAAD/////////+AAAAAf/////////8AAAAD//////////gAAAAP/////////4AAAAB////////+AAAAAAH////////AAAAAAAf///////wAAAAAAD///////+AAAAAAAP///////gAAAAAAA///////4AAAAAAAD//////+AAAAAAAAP//////gAAAAAAAA//////4AAAAAAAAB/////+AAAAAAAAAH/////AAAAAAAAAAP////4AAAAAAAAAAP////AAAAAAAAAAAf///4AAAAAAAAAAH//h+AAAAAAAAAAB/4AeAAAAAAAAAAAf/gPgAAAAAAAAAAH4eD4AAAAAAAAAAA+Bg8AAAAAAAAAAAHwcfAAAAAAAAAAAA/AHwAAAAAAAAAAAD4D4AAAAAAAAAAAAf4f+AAAAAAAAAAADuP/4AAAAAAAAAAAOD/PgAAAAAAAAAAA8/AMAAAAAAAAAAAAH4DAAAAAAAAAAAABvAQAAAAAAAAAAAAN4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAD8AAAAAAAAAAAAAAfsAAAAAAAAAAAAADvAAAAAAAAAAAAAAMAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":82,"w":93},"toxostoma-curvirostre":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/4AAAAAAAAAAAAA//wAAAAAAAAAAB////AAAAAAAAAAA////+AAAAAAAAAAP////4AAAAAAAAABH////gAAAAAAAAAAB///8AAAAAAAAAAAP///wAAAAAAAAAAB////AAAAAAAAAAAP///+AAAAAAAAAAA////+AAAAAAAAAAH////8AAAAAAAAAAf////4AAAAAAAAAD/////gAAAAAAAAAf/////AAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAB////////AAAAAAAP///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////4AAAAAAD////////AAAAAAAf///////4AAAAAAD////////gAAAAAAP///////+AAAAAAB////////4AAAAAAH////////gAAAAAAf///////8AAAAAAD////////wAAAAAAP///////4AAAAAAA////////AAAAAAAD///////8AAAAAAAP///////wAAAAAAA///////+AAAAAAAD///////4AAAAAAAH///////gAAAAAAAf////v/+AAAAAAAA////wf/4AAAAAAAB///4Af/wAAAAAAAD//+AAP/AAAAAAAAD//AAA/8AAAAAAAAf/gAAD/wAAAAAAAP+AAAAP/AAAAAAAH/gAAAA/8AAAAAAD/4AAAAD/wAAAAAD//wAAAAP/AAAAAA///gAAAA/8AAAAAH/w8AAAAD/4AAAAB/8AgAAAAP/gAAAAPuAAAAAAAf+AAAAB3gAAAAAAB/4AAAAEYAAAAAAAH/gAAAADAAAAAAAAf8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAH/AAAAAAAAAAAAAAf8AAAAAAAAAAAAAA7gAAAAAAAAAAAAAD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":70,"w":93},"toxostoma-redivivum":{"bits":"AAAAAAAAAAAPwAAAAAAAAAAAAAP/wAAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAPAAAAAAAAB///+AH/wAAAAAAAf///wA//wAAAAAA/////wD//wAAAAB//////gf//wAAAB//////+D///gAAA//////P8P///gAAf/////gPw////gA//////wAeH///////////4AAYP///////////AABAH//////////wAAAAD/////////+AAAAAB/////////wAAAAAA////////8AAAAAAB////////gAAAAAAH///////4AAAAAAAf///////AAAAAAAD///////wAAAAAAAP//////+AAAAAAAA///////gAAAAAAAH//////4AAAAAAAAf/////+AAAAAAAAB//////gAAAAAAAAf/////4AAAAAAAAH/////+AAAAAAAAB//////gAAAAAAAAf/////4AAAAAAAAD8////8AAAAAAAAAcD////AAAAAAAAAAAP///gAAAAAAAAAAA///wAAAAAAAAAAAB//wAAAAAAAAAAAAH/8AAAAAAAAAAAAA/+AAAAAAAAAAAAAH/gAAAAAAAAAAAAA+eAAAAAAAAAAAAAHh4AAAAAAAAAAAAA4DwAAAAAAAAAAAADgHgAAAAAAAAAAAAOAfAAAAAAAAAAAABwE/AAAAAAAAAAAAHD//gAAAAAAAAAAAcX/+AAAAAAAAAAABwA/wAAAAAAAAAAAOADvAAAAAAAAAAAA4AO8AAAAAAAAAADzgAwAAAAAAAAAAAf/+GAAAAAAAAAAAA//wAAAAAAAAAAAAAH8AAAAAAAAAAAAAAf4AAAAAAAAAAAAAB3gAAAAAAAAAAAAAPEAAAAAAAAAAAAAAYAAAAAAAAAAAAAACAAAAAAAA=","h":61,"w":93},"toxostoma-rufum":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAAAAAAAAAAAP/4AAAAAAAAAAAAD//gAAAAAAAAAAAP//+AAAAAAAAAAAH///wAAAAAAAAAAB////AAAAAAAAAAAH///8AAAAAAAAADAH///wAAAAAAAAP4Af///AAAAAAAAf/gB///8AAAAAAAf/8AH////AAAAAAf//AAf////gAAAAf//wAD/////gAAAf//8AAP/////gAA///8AAB//////4A///8AAAP//////////8AAAA//////////4AAAAH/////////4AAAAA/////////wAAAAAH////////4AAAAAA////////sAAAAAAH///////7AAAAAAA///////+wAAAAAAH///////8AAAAAAAf///////gAAAAAAD////////AAAAAAAf///////8AAAAAAB////////gAAAAAAP//////wAAAAAAAA//////+AAAAAAAAD//////gAAAAAAAAP/////wAAAAAAAAB/////8AAAAAAAAAH/////gAAAAAAAAAP////4AAAAAAAAAA////+AAAAAAAAAAB////gAAAAAAAAAAD///wAAAAAAAAAAAH//8AAAAAAAAAAAAD/+AAAAAAAAAAAAAD3wAAAAAAAAAAAAAc+AAAAAAAAAAAAAHjgAAAAAAAAAAAAA44AAAAAAAAAAAAAOHAAAAAAAAAAAAADhwAAAAAAAAAAAAA4cAAAAAAAAAAAAAODgAAAAAAAAAAAADg4AAAAAAAAAAAAf/+AAAAAAAAAAAAH//wAAAAAAAAAAAD/wcIAAAAAAAAAAA/8H/gAAAAAAAAAAAO//wAAAAAAAAAAABP/AAAAAAAAAAAAAB/wAAAAAAAAAAAAA/8AAAAAAAAAAAAAPuAAAAAAAAAAAAABBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":63,"w":93},"tringa-flavipes":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAPAAAAAAAAAAAAADnwAAAAAAAAAAAAD798AAAAAAAAAAAD///gAAAAAAAA//////8AAAAAAAB///////gAAAAAAD///////wAAAAAAD///////4AAAAAAB///////8AAAAAAA///////+AAAAAAAf//////5gAAAAfgH//////wYAAAAH/B//////4MAAAAD/+P/////+DAAAAA/////////AwAAAAH////////wMAAAAB////////4DAAAAAP///////+AQAAAAB////////4GAAAAAP////////BgAAAAB////////4YAAAAAf////////OAAAAAH////////3AAAAAA/n///////gAAAAAPAP//////wAAAAADwA//////8AAAAAA8AD//////gAAAAAPAAP/////8AAAAADwAA//////wAAAAA8AAB//////gAAAAHAAAB////A/AAAABwAAAAAH/wB+AAAAcAAAAAAA+AD4AAAHAAAAAAABwAfAAABwAAAAAAAHAPwAAAMAAAAAAAA4H4AAABAAAAAAAADj8AAAAAAAAAAAAAf8AAAAAAAAAAAAAB+AAAAAAAAAAAAAA/AAAAAAAAAAAAAAf4AAAAAAAAAAAAAH3AAAAAAAAAAAAAA84AAAAAAAAAAAAAHnAAAAAAAAAAAAAB8wAAAAAAAAAAAAAPmAAAAAAAAAAAAAD4wAAAAAAAAAAAAAPuAAAAAAAAAAAAAB9wAAAAAAAAAAAAAH+AAAAAAAAAAAAAA7wAAAAAAAAAAAAAD+AAAAAAAAAAAAAABgAAAAAAAAAAAAAAMAAAAAAAAAAAAAABgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAAAcAAAAAAAAAAAAAADgAAAAAAAAAAAAAAcAAAAAAAAAAAAAPPwAAAAAAAAAAAAA//AAAAAAAAAAAAAA/cAAAAAAAAAAAAD/4AAAAAAAAAAAAB/mAAAAAAAAAAAAAeBwAAAAAAAAAAAAAAcAAAAAAAAAAAAAAHAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":74,"w":93},"tringa-melanoleuca":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+AAAAAAAAAAAAAA/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAD/+AAAAAAAAAAAAA//wAAAAAAAAAAAAH//AAAAAAAAAAAAB//4AAAAAAAAAAAAP//gAAAAAAAAAAAD///AAAAAAAAAAAA///8AAAAAAAAAf////PwAAAAAAAH/////AfgAAAAAAP/////4A+AAAAAAf/////+AB8AAAAAf//////wADwAAAB///////+AAPgDg/////////wAAeA//////////+AAA4H//////////wAADh//////////8AAAAH//////////gAAAB//////////4AAAAH///////7/+AAAAAf//////+f/gAAAAAB8/////j/4AAAAAAA8H///wP+AAAAAAAAcA//4A/gAAAAAAAAwA/4ADwAAAAAAAABwAAAAcAAAAAAAAADgAAAHAAAAAAAAAAHAAADgAAAAAAAAAAOAAHwAAAAAAAAAAA/gHwAAAAAAAAAAAP2BgAAAAAAAAAAAHwYQAAAAAAAAAAAD4BmAAAAAAAAAAAA8AFgAAAAAAAAAAAH4A4AAAAAAAAAAAAf4HAAAAAAAAAAAAAfw4AAAAAAAAAAAAAf2AAAAAAAAAAAAAAfwAAAAAAAAAAAAAAPwAAAAAAAAAAAAAB/wAAAAAAAAAAAAAPfgAAAAAAAAAAAABweAAAAAAAAAAAAAHDwAAAAAAAAAAAAA4fAAAAAAAAAAAAADG4AAAAAAAAAAAAAc3AAAAAAAAAAAAADi4AAAAAAAAAAAAAMHAAAAAAAAAAAAABhwAAAAAAAAAAAAAOeAAAAAAAAAAAAAAxgAAAAAAAAAAAAAGIAAAAAAAAAAAAAA4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAHgAAAAAAAAAAAAAB/eAAAAAAAAAAAAAN/wAAAAAAAAAAAAAPwAAAAAAAAAAAAAB/wAAAAAAAAAAAAAGPgAAAAAAAAAAAAAYEAAAAAAAAAAAAABgAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":72,"w":93},"tringa-semipalmata":{"bits":"AAAH/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAH//AAAAAAAAAAAAB//8AAAAAAAAAAAAP//gAAAAAAAAAAAD//8AAAAAAAAAAAAf//gAAAAAAAAAAAP//+AAAAAAAAAAAH///wAAAAAAAAAAD////AAAAAAAAAAB////4AAAAAAAAAA/4P//AAAAAAAAAAf4A//+AAAAAAAAAP4AH///wAAAAAAAD8AB////8AAAAAAA8AAP////8AAAAAAGAAB/////8AAAAAAAAAP/////4AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAD///////AAAAAAAAf//////+AAAAAAAD///////4AAAAAAAf///////wAAAAAAD////////AAAAAAAf///////+AAAAAAB////////4AAAAAAP////////wAAAAAA/////////AAAAAAH////////+AAAAAAf////////8AAAAAD/////////4AAAAAP/////////wAAAAA//////////AAAAAD/////////+AAAAAP/////////+AAAAA//////////+AAAAD//////////4AAAAP//////////AAAAAf/////////AAAAAB/////////8AAAAAD/////////wAAAAAH////////+AAAAAAP/////AAPAAAAAAAP////AAAAAAAAAAB////AAAAAAAAAAAH///AAAAAAAAAAAAf/wAAAAAAAAAAAAB38AAAAAAAAAAAAAO/gAAAAAAAAAAAAB58AAAAAAAAAAAAAHHgAAAAAAAAAAAAA4cAAAAAAAAAAAAAHjwAAAAAAAAAAAAA8OAAAAAAAAAAAAAHh4AAAAAAAAAAAAA4HAAAAAAAAAAAAAHA8AAAAAAAAAAAAA4PAAAAAAAAAAAAAOA4AAAAAAAAAAAABwHAAAAAAAAAAAAAOA4AAAAAAAAAAAABwHAAAAAAAAAAAAAMA4AAAAAAAAAAAADgHAAAAAAAAAAAAAcA4AAAAAAAAAAAADgHAAAAAAAAAAAAAYAwAAAAAAAAAAAAHAGAAAAAAAAAAAAA4AwAAAAAAAAAAAAHAOAAAAAAAAAAAAB4BwAAAAAAAAAABw/gOAAAAAAAAAAAf/+BwAAAAAAAAAAB/+wOAAAAAAAAAAAB/yBwAAAAAAAAAAD/cAPgAAAAAAAAAB/jgH+AAAAAAAAAAfg7//wAAAAAAAAAGAe//yAAAAAAAAAAAHgD+AAAAAAAAAAAAwB/gAAAAAAAAAAAEB+cAAAAAAAAAAAAB/nAAAAAAAAAAAAA/h4AAAAAAAAAAAAHgOAAAAAAAAAAAAAADgAAAAAAAAAAAAAA4AAAAAAAAAAAAAAOAAAAAAAAAAAAAABAAAAAAAA=","h":91,"w":93},"tringa-solitaria":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf4AAAAAAAAAAAAAH/gAAAAAAAAAAAAB/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAD//AAAAAAAAAAAAA//8AAAAAAAAAAAAH//gAAAAAAAAAAAD////wAAAAAAAAAB//////AAAAAAAAA///////4AAAAAAAf5//////8AAAAAAPwD//////+AAAAAHwAP//////+AAAAB4AB///////+AAP8AAAP///////////AAAB///////////8AAAH///////////gAAA///////////gAAAH//////////4AAAA//////////AAAAAD/////////gAAAAAP////////gAAAAAB////////wAAAAAAH///////4AAAAAAAf//////+AAAAAAAB///////AAAAAAAAD//////wAAAAAAAAP/////wAAAAAAAAA/////4AAAAAAAAAB////8AAAAAAAAAAD///+AAAAAAAAAAAH//8AAAAAAAAAAAAH//AAAAAAAAAAAAAH/wAAAAAAAAAAAAAfnAAAAAAAAAAAAAB48AAAAAAAAAAAAAHfgAAAAAAAAAAAAAf4AAAAAAAAAAAAAP4AAAAAAAAAAAAAH8AAAAAAAAAAAAAD9wAAAAAAAAAAAAD8OAAAAAAAAAAAAA+BwAAAAAAAAAAAAPgOAAAAAAAAAAAAB8BwAAAAAAAAAAAAdgOAAAAAAAAAAAADsBwAAAAAAAAAAAAfAOAAAAAAAAAAAABoBwAAAAAAAAAAAAPAOAAAAAAAAAAAAA4BwAAAAAAAAAAAADAOAAAAAAAAAAAAAABwAAAAAAAAAAAAAAOAAAAAAAAAAAAAABgAAAAAAAAAAAAAcOAAAAAAAAAAAAAD/+AAAAAAAAAAAAD//4AAAAAAAAAAAA//AAAAAAAAAAAAAAHwAAAAAAAAAAAAAD4AAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"troglodytes-aedon":{"bits":"AYAAAAAAAAAAAAAAfgAAAAAAAAAAAAAD+AAAAAAAAAAAAAAfwAAAAAAAAAAAAAP/AAAAAAAAAAAAAB/8AAAAAAAAAAAAA//gAAAAAAAAAAAAD/+AAAAAAAAAAAAAf/4AAAAAAAAAAAAH//AAAAAAAAAAAAA//8AAAAAAAAAAAAD//wAAAAAAAAAAAAf/+AAAAAAAAAAAAB//4AAAAAAAAAAAAH//AAAAAAAAAAAAA//8AAAAAAAAAAAAD//wAAAAAAP/4AAAP/+AAAAAAP//wAAA//4AAAAAH///gAAD//gAAAAD////AAAf/+AAAAA////8AAB//4AAAAf/////wAH//gAAP///////wAf/+AA/////////AD//8D/////////wAf///////////wAAD///////////8AAAf///////////AAAB///////////wAAAP//////////+AAAB///////////gAAAP//////////8AAAA///////////AAAAH//////////wAAAA//////////+AAAAD//////////gAAAAf/////////8AAAAD//////////AAAAAf/////////4AAAAB/////////+AAAAAH/////////wAAAAA/////////8AAAAAP/////////gAAAAH/////////8AAAAB//////////AAAAAf/////////4AAAAH/////////+AAAAB//////////gAAAAf/////////4AAAAB/////////+AAAAAAA////////wAAAAAAD///////8AAAAAAAP//////+AAAAAAAAf//////gAAAAAAAD//////4AAAAAAAAP/////8AAAAAAAAAf/////AAAAAAAAAAf////gAAAAAAAAAH////gAAAAAAAAAA/////gAAAAAAAAAH////+AAAAAAAAAAfgP//wAAAAAAAAAA+B+H/AAAAAAAAAAB4IAe8AAAAAAAAAAHgAB4gAAAAAAAAAAeAAHEAAAAAAAAAAB4ABwAAAAAAAAAAAHgAAAAAAAAAAAAA+PAAAAAAAAAAAAAH//8AAAAAAAAAAAAn//wAAAAAAAAAAAAAf6AAAAAAAAAAAAAB/4AAAAAAAAAAAAAHvgAAAAAAAAAAAAAOeAAAAAAAAAAAAABwQAAAAAAAAAAAAAeAAAAAAAAAAAAAADgAAAAAAAA==","h":78,"w":93},"troglodytes-hiemalis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAPgAAAAAAAAAAAAAH8AAAAAAAAAAAAAD/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAH/8AAAAAAAAAAAAB//gAAAAAAAAAAAAP/4AAAAAAAAAAAAD//AAAAAAAAAAAAA//8AAAAAAAAAAAAH//gAAAAAAAAAAAB//8AAAAAAAAAAAAP//AAAAAAAAAAAAD//wAAAAAAAAAAAAf/8AAAAAAAAAAAAD//gAAAAAAAAAAAA//4AAAAP+AAAAAAH/+AAAAf/+AAAAAD//gAAAP//+AAAAAf/4AAAD///8AAAAH//AAAB////wAAAB//wAAAf//////g///8AAAH///////////AAA////////////4AA/////////////AAP////////////4AB/////////////AAAB///////////4AAAH///////////AAAAf//////////wAAAD//////////+AAAAf//////////wAAAB//////////8AAAAP//////////gAAAA//////////8AAAAH//////////AAAAA///////////AAAAD//////////+AAAAP8P////////4AAAB+A/////////gAAAPgH////////8AAAA8B////////wAAAAHAP///////gAAAAA4D///////8AAAAADgf///////AAAAAAcD///////4AAAAABw///////+AAAAAAPH///////wAAAAAA4///////8AAAAAADv///////AAAAAAAP///////4AAAAAAA///////+AAAAAAAD///////wAAAAAAAP//////+AAAAAAAA///////AAAAAAAAB//////4AAAAAAAAH//////AAAAAAAAAP/////wAAAAAAAAAf////8AAAAAAAAAP////+AAAAAAAAAB////8AAAAAAAAAAPxYB+AAAAAAAAAAB8BA/AAAAAAAAAAAPgAfgAAAAAAAAAAB+wH/8AAAAAAAAAAH8D//wAAAAAAAAAAcA/AGAAAAAAAAAAB4H4AAAAAAAAAAAAAA/AAAAAAAAAAAAAAH4AAAAAAAAAAAAAAP0AAAAAAAAAAAAAB/gAAAAAAAAAAAAAOQAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":79,"w":93},"troglodytes-pacificus":{"bits":"AGAAAAAAAAAAAAAHwAAAAAAAAAAAAB8AAAAAAAAAAAAB/gAAAAAAAAAAAAf4AAAAAAAAAAAAH/AAAAAAAAAAAAB/wAAAAAAAAAAAB/8AAAAAAAAAAAAf/gAAAAAAAAAAAH/4AAAAAAAAAAAB/+AAAAAAAAAAAAf/gAAAAAAAAAAAP/8AAAAAAAAAAAH//AAAAAAAAAAAB//wAAAAAAAAAAAP/8AAAAAAAAAAAD//gAAAAAAAAAAA//4AAAAAAAAAAAP/+AAAAAAAAAAAB//gAAAAAAAAAAAf/8AAAAAAAAAAAH//AAAAAAAAAAAA//wAAAAAAeAAAAP/8AAAAAD//AAAD//gAAAAD//8AAA//4AAAAD///gAAH/+AAAAD///+AAB//wAAAD////wAAP/8AAAB//////wD//AAAB///////A//4AA////////wH//AH///////+AD//4f///////wAA///////////wAAP//////////8AAD//////////+AAB///////////gAAf//////////wAAH//////////8AAB//////////+AAAf//////////gAAH//////////wAAB//////////8AAAf/////////+AAAH//////////gAAA//////////4AAAP/////////+AAAD//////////AAAA//////////wAAAH/////////8AAAB/////////+AAAAf/////////gAAAH/////////wAAAB/////////8AAAB/////////+AAAA//////////gAAAf/////////wAAAP/////////4AAAH/////////+AAAD//////////AAAA//////////gAAAGAP///////wAAAAAB///////4AAAAAAP//////8AAAAAAB//////8AAAAAAAP/////+AAAAAAAB/////+AAAAAAAAH////+AAAAAAAAAP///+AAAAAAAAAD/////4AAAAAAAA//////AAAAAAAAP//9//wAAAAAAAB/Af///AAAAAAAAD4H8H3wAAAAAAAAfDMAeGAAAAAAAAD4wADxgAAAAAAAAPAAAcQAAAAAAAAB4AAHAAAAAAAAAAPAADgAAAAAAAAAB4AAAAAAAAAAAAAPAAAAAAAAAAAAHh8AAAAAAAAAAAD///wAAAAAAAAAB///8AAAAAAAAAAZh//AAAAAAAAAAEAD/4AAAAAAAAAAAAe/AAAAAAAAAAAABz4AAAAAAAAAAAAeGAAAAAAAAAAAADhAAAAAAAAAAAAA4AAAAAAAAAAAAA+AAAAAAAAAAAAAHAAAAAAAA==","h":93,"w":86},"turdus-migratorius":{"bits":"AAAAAAAAAAA/gAAAAAAAAAAAAH/8AAAAAAAAAAAAf//AAAAAAAAAAAA///gAAAAAAAAAAB////4AAAAAAAAAD////+AAAAAAAAAH/////AAAAAAAAAP////+AAAAAAAAAP////wAAAAAAAAAf////AAAAAAAAAA////8AAAAAAAAAA////8AAAAAAAAAB////4AAAAAAAAAB////4AAAAAAAAAD////wAAAAAAAAAD////gAAAAAAAAAH////AAAAAAAAAAH////AAAAAAAAAAP////AAAAAAAAAAf///+AAAAAAAAAA////+AAAAAAAAAD////+AAAAAAAAAH/////AAAAAAAAAP/////AAAAAAAAA//////AAAAAAAAB//////AAAAAAAAD//////gAAAAAAAH//////gAAAAAAAP//////gAAAAAAAf//////gAAAAAAA///////wAAAAAAB///////wAAAAAAB///////wAAAAAAD///////wAAAAAAH///////wAAAAAAH///////wAAAAAAP///////wAAAAAAf///////gAAAAAA////////gAAAAAB////////gAAAAAD////////gAAAAAD////////AAAAAAH////////AAAAAAP////////AAAAAAP///////+AAAAAAf///////+AAAAAAf///////8AAAAAA////////8AAAAAA////////8AAAAAB////////4AAAAAB////////wAAAAAD////////wAAAAAD////////gAAAAAD////////AAAAAAD///////+AAAAAAD///////8AAAAAAH///////4AAAAAAP///////wAAAAAAf///////gAAAAAA////////AAAAAAB///////+AAAAAAD///////4AAAAAAD///////wAAAAAAH///////AAAAAAAP//////4AAAAAAAf///////wAAAAAAf//8f/j/+AAAAAAf//4fgAD/gAAAAAD//gH4AB/wAAAAAH/+AB+AP/4AAAAAP/+AAfAfH4AAAAAf/8AAPweX4AAAAA//4AAD4Q34AAAAA//4AAB+Y/wAAAAB//wAAD/B/gAAAAD//gAAP/h/gAAAAH//AAAPfw+AAAAAP//AAAefwAAAAAAP/+AAAafgAAAAAAf/8AAAL+AAAAAAA//8AAAP+AAAAAAB//4AAAH8AAAAAAD//wAAADgAAAAAAD//wAAAAAAAAAAAH//gAAAAAAAAAAAP//AAAAAAAAAAAAP//AAAAAAAAAAAAf/+AAAAAAAAAAAA//8AAAAAAAAAAAA//4AAAAAAAAAAAA//4AAAAAAAAAAAA//gAAAAAAAAAAAAP+AAAAAAAAAAAAAA","h":93,"w":90},"tympanuchus-cupido":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//gAAAAAAAAAAAAH/+AAAAAAAAAAAAB//4AAAAAAAAAAAAP//AAAAAAAAAAAAH//8AAAAAAAAAAAA///wAAAAAAAAAAAP//+AAAAAAAAAAeB///4AAAAAAAAAH8I///gAAAAAAAAD/gH//+AAAAAAAAA/8A///8f/wAAAAAP/gP//////wAAAAD/8B///////gAAAB//gP///////AAAAf/8B///////+AAAH//gP///////+AAD//8B////////8AA///AP////////4AP//4A/////////gH///AH/////////D///wAf////////////+AAf////////////gAAf///////////8AAD////////////AAAP///////////wAAB///////////4AAAP//////////8AAAA//////////+AAAAH//////////gAAAAf/////////8AAAAD//////////AAAAAP/////////wAAAAA/////////+AAAAAD/////////gAAAAAP////////4AAAAAA////////8AAAAAAD////////gAAAAAAf///////4AAAAAAA///////8AAAAAAAD///////gAAAAAAAP//////8AAAAAAAA///////wAAAAAAAB///////AAAAAAAAH//////4AAAAAAAAP//////gAAAAAAAAP/////8AAAAAAAAAf/////gAAAAAAAAA///3/4AAAAAAAAAD//4H+AAAAAAAAAAP/8AAAAAAAAAAAAA//AAAAAAAAAAAAAD/AAAAAAAAAAAAAAf4AAAAAAAAAAAAAD+AAAAAAAAAAAAAA/wAAAAAAAAAAAAAH8AAAAAAAAAAAAAB/AAAAAAAAAAAAAAe4AAAAAAAAAAAAcHuAAAAAAAAAAAAH//0AAAAAAAAAAAAP//gAAAAAAAAAAAH/z4AAAAAAAAAAAD988AAAAAAAAAAAA8eHAAAAAAAAAAAAAH//wAAAAAAAAAAAAP/6AAAAAAAAAAAAf/wAAAAAAAAAAAAH48AAAAAAAAAAAABgeAAAAAAAAAAAAAAHgAAAAAAAAAAAAABwAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":78,"w":93},"tympanuchus-pallidicinctus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAB4AAAAAAAAAAAAAHwAAAAAAAAAAAAAPgAAAAAAAAAAAAA+AAAAAAAAAAAAAD8AAAAAAAAAAAAAPwAAAAAAAAAAAAA/AAAAAAAAAAAAAD8AAAAAAAAAAAAAPwAAAAAAAAAAAAB/AAAAAAAAAAAAAH+AAAAAAAAAAAAAf4AAAAAAAAAAAAD/gAAAAAAAAAAAAf+AAAAAAAAAAAAH/8AAAAAAAAAAAA//wAAAAAAAAAAAD//gAAAAAAAAHAAf//AAAAAAAAA8AB//8AAAAAAAAH8AP//4AAAAAAAA/wB///gAAAAAAAH/wP///AAAAAAAA//A///+AAAAAAAH/8CP//8AAAAAAA//4A///4AAAAAAH//gH///wAAAAAAf/+Af///8AAAAAD//8B//////wAAAf//wH//////8AAD///Af//////+AAf//8A///////+AB///wD///////8AP//+AH///////8D///8AD////////////gAP////////////AA////////////4AD////////////gAP///////////+AA////////////4AD////////////AAH///////////4AAf//////////+AAB///////////wAAH//////////+AAAf//////////wAAA///////////AAAD//////////4AAAH//////////gAAAf/////////8AAAA//////////wAAAD/////////+AAAAH/////////wAAAAf////////8AAAAA/////////gAAAAB/////////AAAAAD////////+AAAAAH////////8AAAAAf////////wAAAAAf////////AAAAAA////////+AAAAAB////////4AAAAAB///////8AAAAAAB/////+AAAAAAAAD/////wAAAAAAAAD////8AAAAAAAAAB////gAAAAAAAAAB///8AAAAAAAAAAD///AAAAAAAAAAAH//AAAAAAAAAAAAf/8AAAAAAAAAAAH4/wAAAAAAAAAAA+B8AAAAAAAAAAAH8PAAAAAAAAAADx/w4AAAAAAAAAAf/+HgAAAAAAAAAA//8fgAAAAAAAAAP/yz8AAAAAAAAAB88AeYAAAAAAAAAGHgD/wAAAAAAAAAAYf/8AAAAAAAAAABB/8AAAAAAAAAAAAB/wAAAAAAAAAAAAf+AAAAAAAAAAAAH5wAAAAAAAAAAAA+OAAAAAAAAAAAADA4AAAAAAAAAAAAACAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":88},"tyrannus-couchii":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAAAAAAAAAAAf/gAAAAAAAAAAAAP//AAAAAAAAAAAAf//8AAAAAAAAAAAP///gAAAAAAAAAAB///+AAAAAAAAAAAB///4AAAAAAAAAAAH///AAAAAAAAAAAAf//4AAAAAAAAAAAB///gAAAAAAAAAAAP//8AAAAAAAAAAAA///gAAAAAAAAAAAH//+AAAAAAAAAAAAf//wAAAAAAAAAAAD///gAAAAAAAAAAAf//+AAAAAAAAAAAD///4AAAAAAAAAAAf///wAAAAAAAAAAH////AAAAAAAAAAA////8AAAAAAAAAAH////wAAAAAAAAAAf////AAAAAAAAAAD////8AAAAAAAAAAf////wAAAAAAAAAD/////gAAAAAAAAAf////+AAAAAAAAAB/////8AAAAAAAAAP/////wAAAAAAAAA//////AAAAAAAAAH/////+AAAAAAAAAf/////4AAAAAAAAD//////4AAAAAAAAP//////wAAAAAAAA///////gAAAAAAAD///////gAAAAAAAP///////AAAAAAAAf///////gAAAAAAB////////gAAAAAAD////4///wAAAAAAP////g///4AAAAAAf///+B///8AAAAAD////8D///8AAAAAff////4///+AAAAD4Z/7+AAf//8AAAAbv4gH4AAP//gAAADvwAAPgAAH/4AAAAP4AAAcAAAD/gAAAB8AAAAgAAAA8AAAAPwAAAAAAAAAAAAAD3AAAAAAAAAAAAAAO8AAAAAAAAAAAAAB3AAAAAAAAAAAAAAGgAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":58,"w":93},"tyrannus-forficatus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAAAAAAAAAAAAf/wAAAAAAAAAAAAP//gAAAAAAAAAAA///+AAAAAAAAAAAP///4AAAAAAAAAAA////AAAAAAAAAAAAf//8AAAAAAAAAAAD///gAAAAAAAAAAAP//+AAAAAAAAAAAB///4AAAAAAAAAAAH///gAAAAAAAAAAA///+AAAAAAAAAAAH///8AAAAAAAAAAA////4AAAAAAAAAAH////wAAAAAAAAAA/////AAAAAAAAAAH////+AAAAAAAAAA/////4AAAAAAAAAH/////gAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAAf/////4AAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAP//////gAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAAf//////AAAAAAAAB//////8AAAAAAAAH//////wAAAAAAAAf/////+AAAAAAAAA//////4AAAAAAAAD//////gAAAAAAAAP/////+AAAAAAAAAf/////4AAAAAAAAB//////wAAAAAAAAP//////AAAAAAAAB//////8AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP8Pz///8AAAAAAABzgYD//9gAAAAAAAPsAAH/7wAAAAAAAA/AAAP/gAAAAAAAABwAAAf+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/gAAAAAAAAAAAAAP+AAAAAAAAAAAAAA/4AAAAAAAAAAAAAD/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/+AAAAAAAAAAAAAD/4AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf/AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/wAAAAAAAAAAAAA//AAAAAAAAAAAAAD/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAB/+AAAAAAAAAAAAAH/4AAAAAAAAAAAAAfvgAAAAAAAAAAAAB+cAAAAAAAAAAAAAHwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":88,"w":93},"tyrannus-tyrannus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAAAAAAAAAH//AAAAAAAAAAAA///AAAAAAAAAAAH//+AAAAAAAAAAB///8AAAAAAAAAAP///4AAAAAAAAAf////wAAAAAAAAH/////AAAAAAAAA/////+AAAAAAAAD/////4AAAAAAAAAP////wAAAAAAAAAf////gAAAAAAAAA////+AAAAAAAAAB////4AAAAAAAAAH////wAAAAAAAAAP////AAAAAAAAAA////+AAAAAAAAAD////8AAAAAAAAAP////8AAAAAAAAA/////4AAAAAAAAD/////wAAAAAAAAf/////gAAAAAAAB//////AAAAAAAAH/////+AAAAAAAA//////8AAAAAAAD//////4AAAAAAAP//////wAAAAAAA///////AAAAAAAD//////+AAAAAAAP//////8AAAAAAA///////wAAAAAAD///////gAAAAAAH///////AAAAAAAf//////+AAAAAAB///////8AAAAAAD///////4AAAAAAN///////gAAAAAA3///////AAAAAABv//////+AAAAAAGf//////4AAAAAAM///////wAAAAAAb///////AAAAAABv//////8AAAAAADf//////4AAAAAAH///////wAAAAAAP///////AAAAAAAf//////+AAAAAAB///////4AAAAAAD///////gAAAAAAH//////+AAAAAAAP//////4AAAAAAAf//////wAAAAAAAf//////AAAAAAAA//////+AAAAAAAA//////8AAAAAAAB//////4AAAAAAAA//////wAAAAAAAB//////gAAAAAAAff/////AAAAAAAHwPv///8AAAAAAB/z4d///4AAAAAAf/+AD//7wAAAAAD4P/wD//zAAAAAAfh+NAH//gAAAAAB8PwAAP/+AAAAAAHw/AAAP/8AAAAAAfj8AAA//4AAAAAAfjwAAB//wAAAAABgPwAAH//AAAAAADw2AAAP/+AAAAAAGB4AAAf/8AAAAAAADAAAB//4AAAAAAAAAAAD//wAAAAAAAAAAAH//AAAAAAAAAAAAf/+AAAAAAAAAAAA//8AAAAAAAAAAAB//4AAAAAAAAAAAH//wAAAAAAAAAAAP//AAAAAAAAAAAA//+AAAAAAAAAAAB//8AAAAAAAAAAAD//4AAAAAAAAAAAP//gAAAAAAAAAAAf//AAAAAAAAAAAA//8AAAAAAAAAAAB//wAAAAAAAAAAAD//AAAAAAAAAAAAH/8AAAAAAAAAAAAP3gAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":93,"w":88},"tyrannus-verticalis":{"bits":"AAAAAAAAAAPwAAAAAAAAAAAA//gAAAAAAAAAAB//4AAAAAAAAAAB///AAAAAAAAAAD///wAAAAAAAAAB///8AAAAAAAAAB///+AAAAAAAAAB////4AAAAAAAAB/////gAAAAAAAA/////4AAAAAAAA/////+AAAAAAAA/////8AAAAAAAAf////AAAAAAAAAf////AAAAAAAAAP////AAAAAAAAAP////AAAAAAAAAP////AAAAAAAAAP////AAAAAAAAAf////gAAAAAAAAf////gAAAAAAAAf////wAAAAAAAAf////4AAAAAAAAf////8AAAAAAAAf/////AAAAAAAAf/////gAAAAAAAf/////wAAAAAAAf/////4AAAAAAAP/////8AAAAAAAP/////+AAAAAAAP/////+AAAAAAAH//////AAAAAAAH//////gAAAAAAH//////wAAAAAAD//////4AAAAAAD//////4AAAAAAD//////8AAAAAAD//////+AAAAAAB//////+AAAAAAB//////+AAAAAAA///////AAAAAAA///////AAAAAAA///////gAAAAAAf//////gAAAAAAf//////wAAAAAAP//////wAAAAAAP//////wAAAAAAH//////4AAAAAAH//////4AAAAAAD//////4AAAAAAD//////4AAAAAAB//////4AAAAAAA//////4AAAAAAA///////gAAAAAAf//////4AAAAAAP//////8AAAAAAP/////++AAAAAAP/////8fAAAAAAH/////YPAAAAAAH////8AfgAAAAAH////+B/gAAAAAD////P4YAAAAAAD///sP+AAAAAAAD///gf/AAAAAAAB///gffgAAAAAAA3//gP/gAAAAAAAz//AGfgAAAAAAAT//AA/wAAAAAAAD//AAfwAAAAAAAD//AAHwAAAAAAAB//gAAwAAAAAAAB//gAAAAAAAAAAB//gAAAAAAAAAAB//wAAAAAAAAAAA//wAAAAAAAAAAA//wAAAAAAAAAAA//4AAAAAAAAAAAf/4AAAAAAAAAAAf/8AAAAAAAAAAAf/8AAAAAAAAAAAP/8AAAAAAAAAAAP/+AAAAAAAAAAAP/+AAAAAAAAAAAP//AAAAAAAAAAAH//AAAAAAAAAAAH//AAAAAAAAAAAH//gAAAAAAAAAAD//gAAAAAAAAAAD//wAAAAAAAAAAB//wAAAAAAAAAAB//wAAAAAAAAAAA//wAAAAAAAAAAAP/4AAAAAAAAAAAADwAAAAAAAAAAAAA=","h":93,"w":85},"tyrannus-vociferans":{"bits":"AAB+AAAAAAAAAAP/8AAAAAAAAAP//gAAAAAAAAf//4AAAAAAAA///+AAAAAAAH////gAAAAAAP////4AAAAAAP////+AAAAAAP/////AAAAAAAP////wAAAAAAA////4AAAAAAAP///+AAAAAAAH////AAAAAAAB////wAAAAAAA////4AAAAAAAf///+AAAAAAAP////gAAAAAAH////4AAAAAAH////+AAAAAAD/////gAAAAAB/////4AAAAAB//////AAAAAA//////gAAAAAf/////4AAAAAP/////+AAAAAH//////gAAAAD//////4AAAAB//////8AAAAA///////AAAAAf//////wAAAAP//////4AAAAH//////+AAAAD///////AAAAA///////wAAAAf//////8AAAAP//////+AAAAD///////gAAAB///////4AAAA///////8AAAAP///////AAAAD///////gAAAB///////4AAAAf//////8AAAAP//////+AAAAD///////gAAAA///////wAAAAP//////8AAAAD//////+AAAAA///////AAAAAP//////wAAAAD//////4AAAAA//////4AAAAAP/////+AAAAAP//////AAAAAHv/////wAAAADz/v///4AAAAB/L3///+AAAAA/B/f///gAAAAHA/n///wAAAAB4Hw///8AAAAAAAgP/+/AAAAAAAAD//vgAAAAAAAAf/z4AAAAAAAAH/48AAAAAAAAD/+HAAAAAAAAB//BgAAAAAAAAf/wAAAAAAAAAP/4AAAAAAAAAD/+AAAAAAAAAB//AAAAAAAAAA//wAAAAAAAAAP/4AAAAAAAAAH/+AAAAAAAAAB//AAAAAAAAAA//wAAAAAAAAAf/4AAAAAAAAAH/+AAAAAAAAAD//AAAAAAAAAB//wAAAAAAAAAf/4AAAAAAAAAP/+AAAAAAAAAD//AAAAAAAAAB//wAAAAAAAAA//4AAAAAAAAAP/+AAAAAAAAAH//AAAAAAAAAB//wAAAAAAAAA//4AAAAAAAAAP/+AAAAAAAAAD//AAAAAAAAAB//gAAAAAAAAAf/gAAAAAAAAAAHg","h":93,"w":73},"tyto-alba":{"bits":"AA//gAAAAAAD//8AAAAAAP///AAAAAA////gAAAAB////4AAAAD////4AAAAH////8AAAAH////+AAAAP////+AAAAP/////AAAAP/////AAAAf/////AAAAf/////AAAAf/////AAAAf/////gAAA//////gAAA//////gAAA//////gAAA//////gAAA//////wAAA//////wAAA//////wAAA//////wAAA//////4AAA//////4AAA//////8AAAf/////8AAAf//////AAAf//////gAAf//////wAA///////4AA///////8AA///////+AA////////AA////////AA////////gAf///////wAf///////wAf///////4Af///////4Af///////8Af///////8Af///////8Af///////+AP///////+AP///////+AP////////AP////////AP////////AH////////gH////////gH////////gD////////gB////////AAf///////gAP///////gAP///////gAH///////gAD///////wAB///////wAA///////wAAf//////wAAP//////wAAP//////wAAH//////wAAD//////wAAD//////wAAB//////wAAA//////wAAAf/////wAAAP/////wAAAf/////wAAA//////gAAB//////AAA///////AAA///////AAB///////AAB/f/////gAB+/5////wAAozw////4AAMTg////4AAEDA////8AAADAD///+AAABgB///+AAAAAB////AAAAAB////AAAAAB////AAAAAA///+AAAAAA///+AAAAAA///+AAAAAAP/gAAAAAAAB/gAAAAAAAA/AAA=","h":93,"w":60},"urile-penicillatus":{"bits":"AAD/AAAAAAAA//gAAAAAAP//gAAAAf////AAAAD////8AAAAP////4AAAAgP///wAAAAAD///AAAAAAD//8AAAAAAD//wAAAAAAH//gAAAAAAD/+AAAAAAAH/4AAAAAAB//wAAAAAAf/+wAAAAAH//5gAAAAA//+QAAAAAH//5AAAAAAf//gAAAAAD//+AAAAAAP//EAAAAAB//+QAAAAAH//8AAAAAAf//4AAAAAB///4AAAAAH///gAAAAAf///AAAAAB////AAAAAD///+AAAAAP///8AAAAAf///4AAAAB////gAAAAH////AAAAAP///+AAAAA////8AAAAD////4AAAAP////gAAAA/////AAAAD////8AAAAH////4AAAAf////gAAAB/////AAAAH////8AAAAP////wAAAA/////gAAAB////+AAAAH////4AAAAP////wAAAA/////AAAAB////8AAAAH////wAAAAP////gAAAA////+AAAAB////4AAAAD////gAAAAP///+AAAAAf///4AAAAA////wAAAAD////AAAAAH///8AAAAAf///wAAAAB////AAAAAD///8AAAAAP///wAAAAA////AAAAAB///8AAAAAH///wAAAAAf///AAAAAH///8AAAAM////wAAAA9///+AAAB/////8AAAH//+B/wAAAP//gH/gAAB//wAf/AAAP/AAB/8AAAgAAAH/4AAAAAAAf/gAAAAAAA//AAAAAAAD/+AAAAAAAP/4AAAAAAA//wAAAAAAB//AAAAAAAH/+AAAAAAAf/4AAAAAAA//gAAAAAAB/+AAAAAAAD/8AAAAAAAH/wAAAAAAAP/AAAAAAAAP4AAAAAAAAPgAAAAAAAAGA","h":93,"w":58},"vermivora-chrysoptera":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAH/8AAAAAAAAAAAAD//wAAAAAAAAAAAA///AAAAAAAAAAAAP//8AAAAAAAAAAAf///4AAAAAAAAAAP////AAAAAAAAAAA////8AAAAAAAAAAAf///+AAAAAAAAAAB/////AAAAAAAAAAP/////AAAAAAAAAA/////+AAAAAAAAAH/////8AAAAAAAAAf/////4AAAAAAAAD//////wAAAAAAAAf//////gAAAAAAAB///////gAAAAAAAP///////AAAAAAAB///////8AAAAAAAP///////4AAAAAAA////////+AAAAAAH////////////4AA/////////////AAD////////////4AAf////////////gAB////////////4AAP///////zgAAAAAA////////gAAAAAAD////////AAAAAAAP///////8AAAAAAA//////8PgAAAAAAD/////+AAAAAAAAAP/////gAAAAAAAAAf////wAAAAAAAAAB////4AAAAAAAAAAD///+AAAAAAAAAAAD///AAAAAAAAAAAAH//AAAAAAAAAAABn4PwAAAAAAAAAAA///wAAAAAAAAAAAH+/4AAAAAAAAAAAB/B8AAAAAAAAAAAAJ//AAAAAAAAAAAAAP//gAAAAAAAAAAAB/w+AAAAAAAAAAAAe4AwAAAAAAAAAAACOAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":52,"w":93},"vermivora-cyanoptera":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAAAD//AAAAAAAAAAAAB//+AAAAAAAAAAAP///4AAAAAAAAAAP////gAAAAAAAAAB/////AAAAAAAAAAA////4AAAAAAAAAAA////gAAAAAAAAAAH///+AAAAAAAAAAAf///+AAAAAAAAAAB////8AAAAAAAAAAH////wAAAAAAAAAA/////gAAAAAAAAAD/////AAAAAAAAAAf////8AAAAAAAAAB/////4AAAAAAAAAP/////gAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////wAAAAAAAAD//////gAAAAAAAAf/////+AAAAAAAAD//////4AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////8AAAAAAAA///////wAAAAAAAH///////AAAAAAAAf//////8AAAAAAAD///////wAAAAAAAP//////+AAAAAAAA///////8AAAAAAAD///////wAAAAAAAP///////AAAAAAAA///////+AAAAAAAD///////4AAAAAAAH///////gAAAAAAAf//////+AAAAAAAA///////wAAAAAAAB//////+AAAAAAAAA//////8AAAAAAAA///////4AAAAAAA////4f//gAAAAAAH//9gAH//AAAAAAD/wAAAAP/+AAAAAAf/AAAAAf/4AAAAAD/cAAAAB//wAAAAAf7gAAAAD//AAAAAD//AAAAAP/+AAAAAHfwAAAAAf/4AAAAAf+AAAAAB//gAAAAB4AAAAAAD/8AAAAAAAAAAAAAP8AAAAAAAAAAAAAAfgAAAAAAAAAAAAAA8AAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":60,"w":93},"vireo-atricapilla":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//AAAAAAAAAAAAD//+AAAAAAAAAAAP///4AAAAAAAAAAP////gAAAAAAAAAB////+AAAAAAAAAAD////4AAAAAAAAAAD////AAAAAAAAAAAP///8AAAAAAAAAAA////wAAAAAAAAAAH///+AAAAAAAAAAA////4AAAAAAAAAAD////AAAAAAAAAAAf///+AAAAAAAAAAD////8AAAAAAAAAAP////4AAAAAAAAAB/////wAAAAAAAAAH/////gAAAAAAAAA//////AAAAAAAAAD/////8AAAAAAAAAf/////wAAAAAAAAD//////AAAAAAAAAf/////8AAAAAAAAD//////4AAAAAAAAP//////wAAAAAAAB///////AAAAAAAAP//////+AAAAAAAB///////4AAAAAAAP///////gAAAAAAA///////8AAAAAAAH///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAP///////wAAAAAAB///////+AAAAAAAH///////wAAAAAAAf///////gAAAAAAB///////+AAAAAAAH///////4AAAAAAAf///////gAAAAAAB///////+AAAAAAAH///////8AAAAAAAP///////wAAAAAAAf//////+AAAAAAAA///////wAAAAAAAA//////8AAAAAAAAf//////wAAAAAAAP///////AAAAAAAB////A//+AAAAAAAP///wAP/4AAAAAAB/4AcAA//gAAAAAAH/AAAAD//AAAAAAA/4AAAAP/8AAAAAAD/gAAAA//wAAAAAAf7AAAAD//gAAAAAB/wAAAAH/+AAAAAAHcAAAAAf/4AAAAAAPAAAAAB//wAAAAAAAAAAAAH//AAAAAAAAAAAAAf/8AAAAAAAAAAAAB//gAAAAAAAAAAAAD/8AAAAAAAAAAAAAP/gAAAAAAAAAAAAA/4AAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":69,"w":93},"vireo-bellii":{"bits":"AAH/gAAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAf////AAAAAAAAAAP////8AAAAAAAAAH/////wAAAAAAAAA/////+AAAAAAAAAB/////4AAAAAAAAAA/////gAAAAAAAAAH////+AAAAAAAAAAP////8AAAAAAAAAB/////4AAAAAAAAAH/////wAAAAAAAAA//////gAAAAAAAAD//////AAAAAAAAAf/////8AAAAAAAAD//////4AAAAAAAAP//////gAAAAAAAB//////+AAAAAAAAP//////4AAAAAAAB///////gAAAAAAAH//////+AAAAAAAA///////4AAAAAAAH///////gAAAAAAA////////AAAAAAAH///////8AAAAAAAf///////wAAAAAAD////////AAAAAAAf///////8AAAAAAB////////gAAAAAAP///////+AAAAAAB////////4AAAAAAH////////gAAAAAA////////8AAAAAAD////////wAAAAAAP///////+AAAAAAA////////4AAAAAAH////////AAAAAAAf///////4AAAAAAB////////gAAAAAAH///////+AAAAAAAP///////4AAAAAAA////////gAAAAAAD///////+AAAAAAAH///////4AAAAAAAf///////gAAAAAAA///////+AAAAAAAB///////4AAAAAAAH//////nAAAAAAAH//////+AAAAAAAD/B//A//wAAAAAAB/AAfgD//AAAAAAAP/wD8AH/8AAAAAAD//B+AAP/wAAAAAAeD8fAAAf+AAAAAAD4BnwAAB/4AAAAAA+Ab4AAAP/gAAAAAPwA+AAAA/+AAAAAB+APgAAAD/4AAAAAP4HwAAAAP/gAAAAB/B/8AAAA/+AAAAAP4f/wAAAH/wAAAAA/D//AAAAf/AAAAAD+eD4AAAB/8AAAAAN3wDAAAAH/wAAAAB4+AYAAAA//AAAAAHvwCAAAAD/4AAAAAB+AAAAAAP/gAAAAAP4AAAAAA/+AAAAAB/AAAAAAD/4AAAAAP4AAAAAAf/gAAAAB/wAAAAAB/8AAAAADuAAAAAAH/wAAAAAcAAAAAAAf+AAAAADgAAAAAAB/4AAAAAPAAAAAAAP/AAAAAA4AAAAAAA/4AAAAAAAAAAAAAB/","h":80,"w":93},"vireo-cassinii":{"bits":"AAAAAAAAAAAB/AAAAAAAAAAAAAB//AAAAAAAAAAAAA//8AAAAAAAAAAAAf//4AAAAAAAAAAAH///gAAAAAAAAAAB///+AAAAAAAAAAAf///4AAAAAAAAAAH////wAAAAAAAAAB/////wAAAAAAAAAf/////AAAAAAAAAH/////4AAAAAAAAD/////gAAAAAAAAB/////4AAAAAAAAA/////+AAAAAAAAAf/////wAAAAAAAAP/////8AAAAAAAAD//////gAAAAAAAA//////8AAAAAAAAf//////AAAAAAAAH//////4AAAAAAAH///////AAAAAAAB///////wAAAAAAA///////+AAAAAAAP///////wAAAAAAD///////+AAAAAAB////////gAAAAAAf///////8AAAAAAH////////gAAAAAB////////8AAAAAAf////////AAAAAAH////////4AAAAAB////////+AAAAAA/////////wAAAAAP////////8AAAAAH/////////AAAAAB/////////wAAAAAe////////8AAAAAAP////////AAAAAAH////////wAAAAAB////////8AAAAAAf////////AAAAAAH////////gAAAAAD////////4AAAAAB////////8AAAAAAf//AP////wAAAAAP/4AAf////gAAAAH/8AAAP///+AAAAB/+AAAA/4f/4AAAA//gAAAD/DwfAAAAf/wAAAAA+QD4AAAH/8AAAAAB/A+AAAB/+AAAAAAD43gAAAf/AAAAAAAPj8AAAH/wAAAAAAAfJgAAA/4AAAAAAB/84AAAH+AAAAAAAf/+AAAAfAAAAAAADwfAAAAAAAAAAAAAQD8AAAAAAAAAAAADAPgAAAAAAAAAAAAYD4AAAAAAAAAAAAAA/AAAAAAAAAAAAAA/gAAAAAAAAAAAAAD8AAAAAAAAAAAAAABgAAAAAAAAAAAAAAYAAAAAAAAAAAAAAGAAAAAA","h":66,"w":93},"vireo-flavifrons":{"bits":"AAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//AAAAAAAAAAAAB//8AAAAAAAAAAAAf//wAAAAAAAAOAAP///AAAAAAAAH4Af///8AAAAAAAH+AP////wAAAAAAD//h/////AAAAAAA//8D////8AAAAAAf//gB////+AAAAAP//8AH/////AAAAH//+AA//////AAAD///AAD//////AAB///gAAP/////+AAf//wAAB///////B///wAAAH//////////4AAAA//////////4AAAAH/////////8AAAAAf/////////AAAAAD////////+wAAAAAf////////MAAAAAD////////xAAAAAAP///////84AAAAAB////////MAAAAAAP////////gAAAAAA/////////AAAAAAH////////8AAAAAAf////////gAAAAAD////////AAAAAAAP/8P////+AAAAAAA/+Af////8AAAAAAH/wAB////wAAAAAAf8AAA////AAAAAAB/AAAAH//8AAAAAAH4AAAAOA/gAAAAAAOAAAADgAEAAAAAAA4AAAA4AAAAAAAAAB4AAAOAAAAAAAAAAB4AAPAAAAAAAAAAAD+ABgAAAAAAAAAAAB/+MAAAAAAAAAAAAfAdgAAAAAAAAAAAPgD4AAAAAAAAAAAD/g8AAAAAAAAAAAD/8PAAAAAAAAAAAD/yjwAAAAAAAAAAA/wA8AAAAAAAAAAAH4APMAAAAAAAAAAA/AD/4AAAAAAAAAADwH/5AAAAAAAAAAAXD/wAAAAAAAAAAACA/wAAAAAAAAAAAAYH8AAAAAAAAAAAAAA/AAAAAAAAAAAAAAOwAAAAAAAAAAAAADEAAAAAAAAAAAAAAYwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":61,"w":93},"vireo-gilvus":{"bits":"AAAAAAAAAAfwAAAAAAAAAAAA//gAAAAAAAAAAB//+AAAAAAAAAAA///wAAAAAAAAAAf//+AAAAAAAAAAP///wAAAAAAAAAP////gAAAAAAAAD/////wAAAAAAAB/////+AAAAAAAA//////wAAAAAAAf/////gAAAAAAAH////+AAAAAAAAD/////AAAAAAAAB/////gAAAAAAAAf////wAAAAAAAAP////8AAAAAAAAH/////AAAAAAAAH/////gAAAAAAAD/////4AAAAAAAD/////+AAAAAAAB//////AAAAAAAA//////wAAAAAAAf/////8AAAAAAAP//////AAAAAAAH//////wAAAAAAD//////8AAAAAAB///////AAAAAAAf//////wAAAAAAP//////8AAAAAAH///////AAAAAAB///////wAAAAAA///////8AAAAAAf///////AAAAAAP///////wAAAAAH///////4AAAAAD///////+AAAAAB////////AAAAAAf///////wAAAAAP///////4AAAAAD///////+AAAAAB////////AAAAAA////////wAAAAAf///////4AAAAAH///////+AAAAAD////////AAAAAA////////gAAAAAP///////wAAAAAH///////4AAAAAB///////+AAAAAAf///////AAAAAAP///////gAAAAAD///////wAAAAAB///////+AAAAAA////////wAAAAAP///////+AAAAAH////////gAAAAD///////7wAAAAB//////988AAAAAf/////8ffAAAAAP/////8H/gAAAAA/////4A/4AAAAAf//8/+AHOAAAAAP//+BP4APAAAAAD///AA/gDgAAAAB7//AAD+AAAAAAAc//gAAP8AAAAAAAf/gAAA/AAAAAAAP/4AAAP8AAAAAAD/8AAAH/gAAAAAB//AAAH34AAAAAA//gAAH58AAAAAAP/wAAB+eAAAAAAH/8AAAf/gAAAAAD/+AAAD/wAAAAAA//gAAAf8AAAAAAf/wAAAA+AAAAAAP/8AAAAfAAAAAAD/+AAAABAAAAAAB//AAAAAAAAAAAAf/wAAAAAAAAAAAP/4AAAAAAAAAAAD/+AAAAAAAAAAAB//AAAAAAAAAAAA//wAAAAAAAAAAAP/4AAAAAAAAAAAD/+AAAAAAAAAAAB//AAAAAAAAAAAAf/wAAAAAAAAAAAH/4AAAAAAAAAAAB/8AAAAAAAAAAAA/+AAAAAAAAAAAAP3AAAAAAAAAAAABwAAAAAAAAAAAAAA==","h":93,"w":86},"vireo-griseus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAB//wAAAAAAAAAAAAf//gAAAAAAAAAAAH//+AAAAAAAAAAAB///8AAAAAAAAAAAf///wAAAAAAAAAAD////AAAAAAAAAAA/////AAAAAAAAAB/////+AAAAAAAAA//////8AAAAAAAAP//////4AAAAAAAB/9/////wAAAAAAAAGD/////AAAAAAAAAwP////+AAAAAAAADA/////4AAAAAAAAMD/////gAAAAAAAAgA////+AAAAAAAAGAH////4AAAAAAAAQA/////wAAAAAAACAH/////AAAAAAAAYA/////8AAAAAAADAH/////wAAAAAAAIA//////AAAAAAABAH/////8AAAAAAAIB//////wAAAAAABgP/////+AAAAAAAEB//////8AAAAAAAwP//////4AAAAAACB///////wAAAAAAYH///////gAAAAABgf///////gAAAAAGB////////gAAAAAQD////////gAAAABgP////////AAAAAGA/////////AAAAAYB/////////AAAABwH////eAf/8AAAAHA////AAA//4AAAAOB///gAAA//gAAAA+H//wAAAB/8AAAAf///4AAAAB/AAAAH//j8AAAAAAAAAAA/8P8AAAAAAAAAAAH/gAAAAAAAAAAAAA/fAAAAAAAAAAAAAHw8AAAAAAAAAAAAA8DgAAAAAAAAAAAAD4cAAAAAAAAAAAAAeXAAAAAAAAAAAAAA8wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":54,"w":93},"vireo-huttoni":{"bits":"AA/8AAAAAAAAAAAAA//8AAAAAAAAAAAHf//wAAAAAAAAAAH////AAAAAAAAAAA////+AAAAAAAAAAB////4AAAAAAAAAAD////AAAAAAAAAAAP///8AAAAAAAAAAB////wAAAAAAAAAAP////AAAAAAAAAAB////8AAAAAAAAAAP////wAAAAAAAAAB/////gAAAAAAAAAH/////gAAAAAAAAA//////AAAAAAAAAH/////+AAAAAAAAA//////8AAAAAAAAH//////wAAAAAAAA///////gAAAAAAAH///////AAAAAAAA///////+AAAAAAAH///////8AAAAAAA////////wAAAAAAH////////AAAAAAA////////+AAAAAAH////////4AAAAAA/////////gAAAAAH/////////wAAAAA//////////wAAAAH//////////8AAAAf///////////wAAD////////////8AAf/////////////AB/////////////+AP/////////////wB//////////////AH/////////////4A//////////gP//AD/////////AAB/4AP////////4AAAAAA/////////gAAAAAD////////+AAAAAAP////////wAAAAAA///////B/AAAAAAD//////wB4AAAAAAP/////4AAAAAAAAAP////+AAAAAAAAAD/////gAAAAAAAAAf////wAAAAAAAAAD4///8AAAAAAAAAA+A//+AAAAAAAAAAD0AD8AAAAAAAAAAAPwB+AAAAAAAAAAAB+A/AAAAAAAAAAAAHwP/wAAAAAAAAAAAcD//gAAAAAAAAAAAA/B8AAAAAAAAAAAAH4CgAAAAAAAAAAAA+YEAAAAAAAAAAAAD/AAAAAAAAAAAAAAP4AAAAAAAAAAAAAA9gAAAAAAAAAAAAAD4AAAAAAAAAA==","h":63,"w":93},"vireo-olivaceus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/gAAAAAAAAAAAAH//gAAAAAAAAAAAB//+AAAAAAAAPAAAf//8AAAAAAAH4AAH///wAAAAAAD//AB////AAAAAAB//8Af///+AAAAAAf//gH////wAAAAAP//8D/////AAAAAD///B/////8AAAAB///gP//////AAAAf//wAf//////gAAP//8AAf//////gAD//+AAD///////gD///AAAP///////////gAAB///////////wAAAH//////////4AAAA//////////8AAAAH//////////AAAAAf/////////wAAAAD/////////8AAAAAf/////////gAAAAD/////////4AAAAAf////////+AAAAAD/////////gAAAAAP////////4AAAAAB/////////AAAAAAP////////8AAAAAB/////////4AAAAAH/////////wAAAAA//////////gAAAAD//////////AAAAAf/////////8AAAAB//////////gAAAAP///////gAAAAAAA///////4AAAAAAAD//////+AAAAAAAAP//////wAAAAAAAA//////8AAAAAAAAD//////AAAAAAAAAH/////wAAAAAAAAAf////4AAAAAAAAAA////+AAAAAAAAAAA////wAAAAAAAAAAA//++AAAAAAAAAAAB/+HgAAAAAAAAAAA8ABwAAAAAAAAAAAfcAcAAAAAAAAAAAH/wHgAAAAAAAAAA//yB4AAAAAAAAAAP/gAOAAAAAAAAAAB/wADjgAAAAAAAAAH8AA/+AAAAAAAAAB3AAf+AAAAAAAAAAOgB/+AAAAAAAAAADGAf8AAAAAAAAAAAYwCfgAAAAAAAAAABAAP4AAAAAAAAAAAAAD+AAAAAAAAAAAAAA7gAAAAAAAAAAAAAOYAAAAAAAAAAAAABjAAAAAAAAAAAAAAIIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":67,"w":93},"vireo-philadelphicus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAPgAAAAAAAAAAAAAD8AAAAAAAAAAAAAB//AAAAAAAAAAAAAf/8AAB+AAAAAAAAH//gAB/+AAAAAAAB//8AA//8AAAAAAAf//AAP//4AAAAAAH//gAD///gAAAAAD//4AA///+AAAAAA//+AB////4AAAAAP//AB/////wAAAAD//wAP/////wAAAA//4AAP/////+AAAP/+AAAP//////AAH//AAAA///////AH//wAAAD//////////4AAAAf/////////+AAAAB//////////AAAAAP/////////4AAAAA/////////+AAAAAH/////////wAAAAAf////////8AAAAAD/////////AAAAAAP////////4AAAAAB////////+AAAAAAP////////gAAAAAA////////8AAAAAAH////////AAAAAAA////////8AAAAAAD////////gAAAAAAf///////+AAAAAAD////////4AAAAAAP////////wAAAAAB/////////gAAAAAH/////////AAAAAAf////////8AAAAAB/////////gAAAAAH//////gAMAAAAAAf/////4AAAAAAAAB/////+AAAAAAAAAD/////wAAAAAAAAAP////4AAAAAAAAAAf///8AAAAAAAAAAAf///gAAAAAAAAAAAf/98AAAAAAAAAAAfgAfAAAAAAAAAAAHwAHgAAAAAAAAAAD/wB4AAAAAAAAAAB//AeAAAAAAAAAAAfgsHgAAAAAAAAAAD8AB4AAAAAAAAAAAfAAeAAAAAAAAAAAD8AP/gAAAAAAAAAAPoH/+AAAAAAAAAAA/B/DwAAAAAAAAAADgPwAAAAAAAAAAAAMB+AAAAAAAAAAAAAADwAAAAAAAAAAAAAAeAAAAAAAAAAAAAAD+AAAAAAAAAAAAAAPAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAA","h":66,"w":93},"vireo-plumbeus":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAADwAAAAAAAAAAAAAB+AAAD8AAAAAAAAA//AAD/8AAAAAAAAP/8AA//4AAAAAAAH//gAf//wAAAAAAB//8AH///AAAAAAAf//AH///8AAAAAAP//wH////wAAAAAD//8B/////AAAAAA//+AP////+AAAAAf//gAD/////wAAAH//wAAP/////4AAD//4AAB//////8AB//8AAAH//////8D//+AAAAf//////////gAAAD//////////wAAAAP/////////4AAAAB/////////+AAAAAH/////////wAAAAA/////////8AAAAAH/////////AAAAAA/////////4AAAAAH/////////wAAAAAf/////////AAAAAD/////////8AAAAAf/////////gAAAAD////////4AAAAAAf////////AAAAAAB////////4AAAAAAP////////gAAAAAB////////+AAAAAAH////////8AAAAAAf////////wAAAAAD///+f////gAAAAAP///gB///+AAAAAA///4AAP//4AAAAAD//+AAAcD/gAAAAAP//wAADAAAAAAAAB//wAAAwAAAAAAAAD/4AAAMAAAAAAAAAPmAAADAAAAAAAAAAYAAABwAAAAAAAAAB4AAAcAAAAAAAAAAB4AADAAAAAAAAAAAB/D+YAAAAAAAAAAAf/+/AAAAAAAAAAAP8AOAAAAAAAAAAAD/wHgAAAAAAAAAAD/CB4AAAAAAAAAAA/AAcAAAAAAAAAAAHwAPeAAAAAAAAAAA+AD/4AAAAAAAAAAB8B/BAAAAAAAAAAAPAfAAAAAAAAAAAABwH4AAAAAAAAAAAADA/AAAAAAAAAAAAAAB4AAAAAAAAAAAAAAPAAAAAAAAAAAAAABuAAAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","h":65,"w":93},"vireo-solitarius":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAAAAAAAAAAH/+AAAAAAAAAAAAD//8AAAAAAAAAAAA///wAAAAAAAAAAAP///AAAAAAAAAAAP///8AAAAAAAAAAP////wAAAAAAAAAB/////AAAAAAAAAAD////4AAAAAAAAAADf///gAAAAAAAAAAd///+AAAAAAAAAABj///8AAAAAAAAAAGP///4AAAAAAAAAAw////wAAAAAAAAACD////gAAAAAAAAAYf////AAAAAAAAADB////8AAAAAAAAAYP////4AAAAAAAABg/////gAAAAAAAAMBP////AAAAAAAAAgB////8AAAAAAAAEAP////4AAAAAAAAgA/////wAAAAAAAEAH/////AAAAAAAAwAf////8AAAAAAAGAD/////wAAAAAAAQAP/////AAAAAAADAB/////+AAAAAAAIAH/////4AAAAAABgAf/////gAAAAAAGAB/////8AAAAAAAwAD/////wAAAAAADAAH////+AAAAAAAMAAH////4AAAAAAAgAAH////wAAAAAACAAAH////AAAAAAAMAAAP///8AAAAAAAwAAAP///4AAAAAADgAAAf///gAAAAAAGAAAD///+AAAAAAYcAAAf///wAAAAABg8AAH///+AAAAAAHA8EA//5/8AAAAAAMA/4f+H3/wAAAAAAYf//+AD//gAAAAAB/wHMAAB/+AAAAAAPwAZgAAB/8AAAAAH/wD8AAAH/wAAAOB//A+AAAAP/gAAAYfh8fAAAAA/+AAAB34AngAAAAB/8AAAD+AD4AAAAAH/wAAAPwA8AAAAAAP/AAAAfAfEAAAAAA/8AAAB4P/4AAAAAB/gAAAMH//gAAAAAD4AAAAw/A0AAAAAAEAAAAAH4BgAAAAAAAAAAAA+AGAAAAAAAAAAAADwAYAAAAAAAAAAAAeAAwAAAAAAAAAAAD4ADAAAAAAAAAAAAPgAAAAAAAAAAAAAA+AAAAAAAAAAAAAAAcAAAAAAAAA=","h":67,"w":93},"xanthocephalus-xanthocephalus":{"bits":"AAAAAD/AAAAAAAH/4AAAAAAP//AAAAAAP//8AAAAAP///wAAAAP///+AAAAH////gAAAH////AAAAD///8AAAAD///4AAAAB///8AAAAA///8AAAAA///+AAAAAf///AAAAAP///gAAAAH///wAAAAH///4AAAAH///+AAAAH////AAAAH////wAAAD////4AAAD////8AAAD/////AAAD/////gAAD/////wAAB/////4AAB/////8AAB/////+AAA//////AAA//////gAAf/////gAAf/////wAAP/////4AAP/////8AAP/////8AAH/////+AAH/////+AAD//////AAD//////AAB//////AAB//////gAA//////gAA//////gAAf/////wAAP/////wAAP/////4AAH/////4AAD/////4AAD/////4AAB/////4AAA/////4AAAf////4AAAP////wAAAH////wAAAH////4AAAD////wAAAB////+AQAB/////8/AA///3///wA9//w///+Acf/z4Af/gOf/7wA8AAOP/5wB8AAGP/8wA4AADH/8YA8AAAD/+PAYAAAA/+DgGAAAA/+AADwAAAf/AAAAAAAP/gAAAAAAH/wAAAAAAH/4AAAAAAD/8AAAAAAB/8AAAAAAA/+AAAAAAA//AAAAAAAf/gAAAAAAP/wAAAAAAP/4AAAAAAH/8AAAAAAD/+AAAAAAB//AAAAAAB//AAAAAAA//gAAAAAAf/wAAAAAAP/4AAAAAAH/8AAAAAAD/+AAAAAAB//AAAAAAAf/AAAAAAAP/gAAAAAAA/gAAAAAAANAAAAAAAAA==","h":93,"w":55},"xema-sabini":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//wAAAAAAAAAAAAP/+AAAAAAAAAAAAD//4AAAAAAAAAAAA///gAAAAAAAAAAAf//8AAAAAAAAAAAf///gAAAAAAAAAAH///8AAAAAAAAAAB////gAAAAAAAAAAPg//+AAAAAAAAAAAAD/+wAAAAAAAAAAAAP/2AAAAAAAAAAAAB/8wAAAAAAAAAAAAP/mAAAAAAAAAAAAD//wAAAAAAAACAAAf/+AAAAAAAAD4AAD/////4AAAAD+AAA/////////AB/gAAH/////////D/4AAA///////////+AAAP///////////AAAB///////////wAAAIf///////////gABB////////////gAIH///////////8ABAf/////////+AAAIA//////////AAABAB////////gAAAAIAH///////gAAAABgAf//////wAAAAAMAD//////4AAAAAAgAf/////8AAAAAAEAD//////AAAAAAAwAf/////gAAAAAACAB/////4AAAAAAAYAP////+AAAAAAABwB/////AAAAAAAAHgP////gAAAAAAAAP5///8AAAAAAAAAAH///vgAAAAAAAAAAB8AAOAAAAAAAAAAAfgADgAAAAAAAAAAD8AA4AAAAAAAAAAA/gAeAAAAAAAAAAAH+AHgAAAAAAAAAAA+QDwAAAAAAAAAAAAwAfAAAAAAAAAAAACAD4AAAAAAAAAAAAAA+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAB+AAAAAAAAAAAAAAPwAAAAAAAAAAAAAAfAAAAAAAAAAAAAADYAAAAAAAAAAAAAAZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","h":60,"w":93},"zenaida-asiatica":{"bits":"AAAAAAAAAfAAAAAAAAAAH/wAAAAAAAAAf/wAAAAAAAAB//wAAAAAAAAH//gAAAAAAAAP//AAAAAAAAA//+AAAAAAAAB//+AAAAAAAAD//+AAAAAAAAH///AAAAAAAAf///AAAAAAAA//++AAAAAAAB//wOAAAAAAAD//AEAAAAAAAH/+AAAAAAAAAP/8AAAAAAAAA//4AAAAAAAAB//4AAAAAAAAH//4AAAAAAAAP//wAAAAAAAA///gAAAAAAAD///gAAAAAAAP///AAAAAAAA////AAAAAAAD///+AAAAAAAP///8AAAAAAA////4AAAAAAD////4AAAAAAP////wAAAAAB/////gAAAAAH/////AAAAAAf////+AAAAAB/////8AAAAAH/////4AAAAAf/////wAAAAB//////gAAAAD//////AAAAAP/////+AAAAA//////8AAAAD//////wAAAAH//////gAAAAf//////AAAAB//////8AAAAD//////4AAAAP//////gAAAA///////AAAAB//////8AAAAH//////wAAAAf//////AAAAA//////8AAAAD//////wAAAAH//////AAAAAf/////8AAAAA//////wAAAAD//////AAAAAH/////4AAAAAP/////gAAAAA/////8AAAAAB/////wAAAAAD////+AAAAAAP////4AAAAAAP////vgAAAAA//////+AAAAD///////wAAAP////v//wAAA///5x//ygAAD//+AH4f4AAAP//gAIABwAAA//+AAAAAgAAD//4AAAAAAAAH//gAAAAAAAAf//AAAAAAAAA//4AAAAAAAAB//gAAAAAAAAAf+AAAAAAAAAA/4AAAAAAAAAD/AAAAAAAAAAH8AAAAAAAAAAf4AAAAAAAAAB/gAAAAAAAAAD/AAAAAAAAAAP8AAAAAAAAAAfwAAAAAAAAAB/AAAAAAAAAAD+AAAAAAAAAAP4AAAAAAAAAAfgAAAAAAAAAB+AAAAAAAAAAD8AAAAAAAAAAPwAAAAAAAAAA/AAAAAAAAAAB8AAAAAAAAAADAAAAAAAAAAAAA==","h":93,"w":71},"zenaida-macroura":{"bits":"AH8AAAAAAAAAAAAAD/4AAAAAAAAAAAAA//gAAAAAAAAAAAAP/+AAAAAAAAAAAAB//4AAAAAAAAAAAAP//AAAAAAAAAAAAB//4AAAAAAAAAAAAf//gAAAAAAAAAAAH//8AAAAAAAAAAAB///gAAAAAAAAAAAf//+AAAAAAAAAAAHx//wAAAAAAAAAAA4H/+AAAAAAAAAAAEAf/4AAAAAAAAAAAAD//AAAAAAAAAAAAAf/8AAAAAAAAAAAAB//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//8AAAAAAAAAAAAf//4AAAAAAAAAAAD///wAAAAAAAAAAAf///AAAAAAAAAAAD///+AAAAAAAAAAA////8AAAAAAAAAAH////4AAAAAAAAAA/////wAAAAAAAAAH/////AAAAAAAAAA/////+AAAAAAAAAH/////4AAAAAAAAA//////gAAAAAAAAH/////+AAAAAAAAA//////4AAAAAAAAH//////gAAAAAAAA//////+AAAAAAAAH//////4AAAAAAAA///////gAAAAAAAH//////+AAAAAAAA///////4AAAAAAAH///////gAAAAAAA///////8AAAAAAAD///////wAAAAAAAf///////AAAAAAAD///////8AAAAAAAP///////wAAAAAAB////////AAAAAAAH///////4AAAAAAAf///////gAAAAAAD///////+AAAAAAAP///////4AAAAAAA////////AAAAAAAD///////8AAAAAAAP///////gAAAAAAAf//////+AAAAAAAB///////wAAAAAAAD///////AAAAAAAAP//////8AAAAAAAAf//////gAAAAAAAA//////+AAAAAAAAD//////8AAAAAAAB///////wAAAAAAA////////AAAAAAAH///////+AAAAAAA/++/////4AAAAAAH74AAP///AAAAAAA/3gAAP//8AAAAAAD9cAAA///gAAAAAAP4gAAB//wAAAAAAA/gAAAH//AAAAAAAA8AAAAP/8AAAAAAAAAAAAAf/wAAAAAAAAAAAAA//AAAAAAAAAAAAAB/8AAAAAAAAAAAAAH/wAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf+AAAAAAAAAAAAAB/4AAAAAAAAAAAAAH/gAAAAAAAAAAAAAf8AAAAAAAAAAAAAB/wAAAAAAAAAAAAAH/AAAAAAAAAAAAAAP8AAAAAAAAAAAAAA/wAAAAAAAAAAAAAD+AAAAAAAAAAAAAAP4AAAAAAAAAAAAAA/gAAAAAAAAAAAAAD+AAAAAAAAAAAAAAHwAAAAAAAAAAAAAAfAAAAAAAAAAAAAAB4=","h":91,"w":93},"zonotrichia-albicollis":{"bits":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wAAAAAAAAAAAAA//gAAAAAAAAAAAAf//AAAAAAAAAAAAH//+AAAAAAAAAAAA///4AAAAAAAAAAAP///8AAAAAAAAAAB////+AAAAAAAAAAP////+AAAAAAAAAD/////+AAAAAAAAA//////8AAAAAAAAP//////4AAAAAAAB///////wAAAAAAAB///////gAAAAAAAP///////AAAAAAAA////////AAAAAAAH///////+AAAAAAA////////+AAAAAAD////////////4AAP////////////+AB/////////////4AP/////////////gA/////////////4AH///////4OAAAAAA/////////AAAAAAD////////gAAAAAAP///////8AAAAAAB///////5AAAAAAAH//////8AAAAAAAAf/////+AAAAAAAAB//////AAAAAAAAAH/////4AAAAAAAAAf////8AAAAAAAAAA/////AAAAAAAAAAB////wAAAAAAAAAAD///4AAAAAAAAAAAH//+AAAAAAAAAAAAH//AAAAAAAAAAAAAB8AAAAAAAAAAAAAAfAAAAAAAAAAAAAA//AAAAAAAAAAAAAP98AAAAAAAAAAAAD+BgAAAAAAAAAAAH/4MAAAAAAAAAAAB//5AAAAAAAAAAAA/+dAAAAAAAAAAAAP84AAAAAAAAAAAADcDAAAAAAAAAAAAATAYAAAAAAAAAAAAAIDAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","h":54,"w":93},"zonotrichia-atricapilla":{"bits":"AAAAAAAAAAD/AAAAAAAAAAAAH/8AAAAAAAAAAAH//wAAAAAAAAAAD///AAAAAAAAAAB///4AAAAAAAAAA////AAAAAAAAAAf///4AAAAAAAAAP////gAAAAAAAAH////+AAAAAAAAD/////wAAAAAAAB/////8AAAAAAAAf////4AAAAAAAAP////wAAAAAAAAD////4AAAAAAAAB////+AAAAAAAAA/////gAAAAAAAAf////wAAAAAAAAP////8AAAAAAAAP/////AAAAAAAAH/////gAAAAAAAH/////4AAAAAAAD/////+AAAAAAAB//////gAAAAAAA//////wAAAAAAAf/////8AAAAAAAP//////AAAAAAAH//////wAAAAAAD//////8AAAAAAB///////AAAAAAA///////wAAAAAAf//////8AAAAAAP///////AAAAAAH///////wAAAAAD///////4AAAAAB///////+AAAAAA////////gAAAAAf///////wAAAAAH///////8AAAAAD///////+AAAAAB////////gAAAAA////////wAAAAAP///////4AAAAAH///////+AAAAAB////////AAAAAA////////gAAAAAP///////wAAAAAH///////4AAAAAB///////8AAAAAAf//////+AAAAAAP///////AAAAAAH///////gAAAAAB///////gAAAAAA///////gAAAAAAf//////wAAAAAAP//////wAAAAAAD//////+AAAAAAB///////gAAAAAAf///////gAAAAAB///9///8AAAAAA///APA//gAAAAAP//gHgH/4AAAAAAf/wBgD4fAAAAAAP/wAeD4HwAAAAAD/4ADh8A8AAAAAB/8AAAeAOAAAAAAf8AAAHAHgAAAAAP8AAABgBwAAAAAH/AAAAeA4AAAAAB/gAAABA8AAAAAA/wAAAAAEAAAAAAf8AAAAAAAAAAAAH+AAAAAAAAAAAAD/AAAAAAAAAAAAB/wAAAAAAAAAAAAf4AAAAAAAAAAAAP+AAAAAAAAAAAAD/AAAAAAAAAAAAB/gAAAAAAAAAAAA/4AAAAAAAAAAAAP8AAAAAAAAAAAAH/AAAAAAAAAAAAD/gAAAAAAAAAAAA/4AAAAAAAAAAAAf8AAAAAAAAAAAAH+AAAAAAAAAAAAD/gAAAAAAAAAAAA/wAAAAAAAAAAAAf8AAAAAAAAAAAAP+AAAAAAAAAAAAD/AAAAAAAAAAAAA/wAAAAAAAAAAAAH4AAAAAAAAAAAAB8AAAAAAAAAAAAAA==","h":93,"w":86},"zonotrichia-leucophrys":{"bits":"AAAAAAAAAH8AAAAAAAAAAB//AAAAAAAAAAH//AAAAAAAAAA///AAAAAAAAAD///gAAAAAAAAP///AAAAAAAAA////gAAAAAAAD////wAAAAAAAH////wAAAAAAAf////wAAAAAAB////+AAAAAAAD////wAAAAAAAP///+AAAAAAAAf///8AAAAAAAB////4AAAAAAAH////wAAAAAAA/////AAAAAAAH////+AAAAAAAf////8AAAAAAB/////4AAAAAAH/////gAAAAAA//////AAAAAAD/////+AAAAAAP/////+AAAAAA//////8AAAAAD//////4AAAAAP//////wAAAAAf//////gAAAAB//////+AAAAAH//////8AAAAAf//////4AAAAB///////wAAAAH///////AAAAAP//////+AAAAA///////8AAAAD///////wAAAAH///////gAAAAf//////+AAAAB///////4AAAAD///////wAAAAP///////AAAAAf//////8AAAAB///////wAAAAD///////AAAAAP//////+AAAAAf//////4AAAAA///////gAAAAD//////8AAAAAH//////wAAAAAf//////AAAAAA//////8AAAAAD//////gAAAAAP/////+AAAAAA//////wAAAAAD7/////wAAAAAHv/////wAAAAAc//////gAAAAAz//////AAAAAAH//hw//AAAAAAf/+AH/8AAAAAA//4AP/4AAAAAAf/gA//gAAAAAA/+ABv/AAAAAAD/wABn8AAAAAAH/AAD3wAAAAAAf8AABAAAAAAAA/wAAAAAAAAAAD/gAAAAAAAAAAP+AAAAAAAAAAAf8AAAAAAAAAAB/wAAAAAAAAAAD/gAAAAAAAAAAP+AAAAAAAAAAAf8AAAAAAAAAAB/wAAAAAAAAAAD/gAAAAAAAAAAP+AAAAAAAAAAAf8AAAAAAAAAAB/wAAAAAAAAAAD/gAAAAAAAAAAP+AAAAAAAAAAAf8AAAAAAAAAAB/wAAAAAAAAAAD/gAAAAAAAAAAP+AAAAAAAAAAAf8AAAAAAAAAAB/wAAAAAAAAAAD/gAAAAAAAAAAP+AAAAAAAAAAAf8AAAAAAAAAAAvwAAAAAAAAAAAbAAAAAAAAAAAAgAAAAAAAAAAAAA=","h":93,"w":77},"zonotrichia-querula":{"bits":"AA/wAAAAAAAAAAAAA//wAAAAAAAAAAAAP//AAAAAAAAAAAAD//+AAAAAAAAADAA///4AAAAAAAAD4AP///gAAAAAAAB/AH///+AAAAAAAA/4B////wAAAAAAAf/+f////AAAAAAAP///////+AAAAAAH/////////wAAAAD///4f/////4AAAB///+B//////wAAA////AP//////4AAf///gB///////+Af///gAH////////////gAA////////////gAAH///////////wAAA///////////wAAAH//////////4AAAA//////////4AAAAH/////////+AAAAA/////////9gAAAAH/////////YAAAAA/////////2AAAAAD/////////gAAAAAf/////////gAAAAD/////////+AAAAAP/////////4AAAAB//////////gAAAAH/////////4AAAAA////////wAAAAAAD///////8AAAAAAAP///////AAAAAAAA///////wAAAAAAAD//////+AAAAAAAAP//////AAAAAAAAAf/////4AAAAAAAAB/////+AAAAAAAAAD/////AAAAAAAAAAH////wAAAAAAAAAAH///4AAAAAAAAAAA///8AAAAAAAAAAAfgD/AAAAAAAAAAAH/wH4AAAAAAAAAAD//A+AAAAAAAAAAB/zIHgAAAAAAAAAAfwAB4AAAAAAAAAAD+AAeAAAAAAAAAAAXgAHgAAAAAAAAAAC8AB4AAAAAAAAAAAPgAeAAAAAAAAAAAB/AHgAAAAAAAAAAAG4B54AAAAAAAAAAA4Af/gAAAAAAAAAADAH/sAAAAAAAAAAAAD+AAAAAAAAAAAAAA/gAAAAAAAAAAAAAP8AAAAAAAAAAAAABfAAAAAAAAAAAAAAL4AAAAAAAAAAAAAA7gAAAAAAAAAAAAAHcAAAAAAAAAAAAAAx4AAAAAAAAAAAAAGAAAAAAAAAAAAAAAwAAAAAAAAAAAAAACAAAAAAAAAAA=","h":67,"w":93}};

  // Tunables - Galliformes-poster-inspired. Raster-mask nesting.
  //
  // Layout discipline: tile areas are NORMALISED against a viewport
  // budget (sum of areas ≈ packingBudgetFrac × vpArea) rather than
  // each tile being clamped to a per-tile maxArea. The old per-tile
  // cap made every loud bird look identical (Anna n=398, Crow n=31
  // and Phoebe n=26 all hit ceiling and rendered the same size) AND
  // it allowed total area to overflow narrow viewports so birds got
  // dropped off-screen. Normalising fixes both - relative size
  // tracks the relative call ratio, and total area can never exceed
  // what the iterative shrink loop is willing to scale into the
  // viewport.
  function tuning(n, W, H) {
    var mobileCompact = W <= 700 && H > W;
    var roomyCanvas = W >= 900 && H >= 420 && W >= H;
    var roomyAreaScale = roomyCanvas ? 1.40 * 1.40 : 1;
    var mobileLinearScale = mobileCompact ? (n <= 6 ? 1.25 : n <= 12 ? 1.33 : 1.47) : 1;
    var mobileAreaScale = mobileLinearScale * mobileLinearScale;
    var packingBudgetFrac = mobileCompact && n <= 6 ? 0.34 :
                            mobileCompact && n <= 12 ? 0.36 :
                            n <= 4  ? 0.46 :
                            n <= 12 ? 0.40 :
                            n <= 24 ? 0.34 :
                                      0.28;
    var minTileAreaFrac = n <= 8 ? 0.0100 :
                          n <= 20 ? 0.0075 :
                                    0.0055;
    return {
      // Soft area budget the whole cluster aims to fill, as a
      // fraction of viewport area. Lower = sparser collage with more
      // breathing room (and more headroom for packing efficiency).
      // Steps down as species count grows so a busy plate doesn't
      // try to claim the entire viewport.
      packingBudgetFrac: packingBudgetFrac * roomyAreaScale * mobileAreaScale,
      // Count -> visible-area exponent. The per-window cap prevents
      // runaway common species, so the capped call count can map
      // directly to visual area.
      countExp: 1,
      // Floor: every species in the dataset must be visible, even
      // n=1. Tracks species count so a tiny rare bird stays
      // recognisable on a crowded plate.
      // Roomy landscape canvases get a 40% linear-size boost; area
      // fractions scale by 1.40 * 1.40 so rendered birds grow by 1.40.
      // Phone portrait also grows modestly, then uses a vertical oval
      // as species count rises so it can spend height instead of width.
      minTileAreaFrac: minTileAreaFrac * roomyAreaScale * mobileAreaScale,
      // Wider clusters for desktop/landscape. Phone collages start as
      // a circular clump, then become vertical as the species count grows.
      ellipseAspectBias: mobileCompact ? (n <= 8 ? 1.08 : n <= 14 ? 0.98 : 0.88) : 2.1,
      mobileCompact: mobileCompact,
      roomyCanvas: roomyCanvas,
    };
  }
  var GRID_STRIDE = 4; // viewport px per occupancy cell; smaller = slower
  var COLLAGE_RECT_GAP = 4; // rendered-px guard for replaced/stale masks

  // Decode and cache each mask once. Sparse cell-list form (only "on"
  // cells) makes collision tests linear in opaque area, not total area.
  var maskCache = {};
  function loadMask(slug) {
    if (maskCache[slug]) return maskCache[slug];
    var rec = MASKS[slug];
    if (!rec) {
      // New local bird art can arrive before masks.json/apt.js metadata is
      // regenerated. Keep the bird visible with a conservative rectangular
      // mask instead of dropping it from the collage entirely.
      var d = DIMS[slug] || [93, 66];
      var ar = d[0] / Math.max(1, d[1]);
      var w = ar >= 1 ? 93 : Math.max(1, Math.round(93 * ar));
      var h = ar >= 1 ? Math.max(1, Math.round(93 / ar)) : 93;
      var cells = [];
      for (var yy = 0; yy < h; yy++) {
        for (var xx = 0; xx < w; xx++) cells.push([xx, yy]);
      }
      return (maskCache[slug] = { w: w, h: h, cells: cells });
    }
    var bytes = atob(rec.bits);
    var w = rec.w, h = rec.h;
    var cells = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var b = bytes.charCodeAt(i >> 3);
        if ((b >> (7 - (i & 7))) & 1) cells.push([x, y]);
      }
    }
    return (maskCache[slug] = { w: w, h: h, cells: cells });
  }

  function slugify(sci) {
    return sci.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  var COLLAGE_POSES = {
    'buteo-lineatus': 2,
    'pandion-haliaetus': 2
  };
  // Cutout transparency varies a lot by pose: compact perched birds
  // can be ~40% opaque while flight silhouettes and long-tailed birds
  // can be far lower. Normalize by mask density so visible bird area,
  // not transparent rectangle area, tracks the capped call count.
  var COLLAGE_MASK_DENSITY_REF = 0.394;
  var COLLAGE_MASK_AREA_SCALE_MIN = 0.55;
  var COLLAGE_MASK_AREA_SCALE_MAX = 3.2;
  var COLLAGE_AREA_SCALE = {};
  function collagePose(sci) {
    return COLLAGE_POSES[slugify(sci)] || 1;
  }
  function collageAssetKey(sci) {
    var slug = slugify(sci);
    var pose = COLLAGE_POSES[slug] || 1;
    return pose > 1 ? slug + '-' + pose : slug;
  }
  function aspectForKey(key) {
    var d = DIMS[key];
    return d ? d[0] / d[1] : 1.4;
  }
  function maskDensityForKey(key) {
    var mask = loadMask(key);
    return mask ? mask.cells.length / (mask.w * mask.h) : 0;
  }
  function areaScaleForKey(key) {
    var density = maskDensityForKey(key);
    var densityScale = density ? COLLAGE_MASK_DENSITY_REF / density : 1;
    densityScale = Math.max(COLLAGE_MASK_AREA_SCALE_MIN, Math.min(COLLAGE_MASK_AREA_SCALE_MAX, densityScale));
    return densityScale * (COLLAGE_AREA_SCALE[key] || 1);
  }

  // Mask-aware nester. tiles: { fullW, fullH, mask, data }. Returns the
  // same tiles with .x, .y assigned (top-left in viewport coords).
  function maskPack(tiles, W, H, ellipseBias) {
    var GW = Math.ceil(W / GRID_STRIDE) + 2;
    var GH = Math.ceil(H / GRID_STRIDE) + 2;
    var grid = new Uint8Array(GW * GH);

    function cellRange(tile, tx, ty, c) {
      // For mask cell (c[0], c[1]), return [gx0, gy0, gx1, gy1] (inclusive)
      // in grid coords, clamped to the grid.
      var sx = tile.fullW / tile.mask.w;
      var sy = tile.fullH / tile.mask.h;
      var x0 = (tx + c[0] * sx) / GRID_STRIDE | 0;
      var y0 = (ty + c[1] * sy) / GRID_STRIDE | 0;
      var x1 = (tx + (c[0] + 1) * sx) / GRID_STRIDE | 0;
      var y1 = (ty + (c[1] + 1) * sy) / GRID_STRIDE | 0;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      if (x1 >= GW) x1 = GW - 1; if (y1 >= GH) y1 = GH - 1;
      return [x0, y0, x1, y1];
    }
    function collides(tile, tx, ty) {
      var cells = tile.mask.cells;
      for (var i = 0; i < cells.length; i++) {
        var r = cellRange(tile, tx, ty, cells[i]);
        for (var gy = r[1]; gy <= r[3]; gy++) {
          var off = gy * GW;
          for (var gx = r[0]; gx <= r[2]; gx++) {
            if (grid[off + gx]) return true;
          }
        }
      }
      return false;
    }
    function stamp(tile, tx, ty) {
      var cells = tile.mask.cells;
      for (var i = 0; i < cells.length; i++) {
        var r = cellRange(tile, tx, ty, cells[i]);
        for (var gy = r[1]; gy <= r[3]; gy++) {
          var off = gy * GW;
          for (var gx = r[0]; gx <= r[2]; gx++) grid[off + gx] = 1;
        }
      }
    }
    function offGrid(tile, tx, ty) {
      // True if the rendered tile bbox extends past the viewport.
      return tx < 0 || ty < 0 || tx + tile.fullW > W || ty + tile.fullH > H;
    }
    function rectCollides(tile, tx, ty) {
      // Backstop for locally replaced bird art: if the precomputed mask
      // is stale or too optimistic, never allow rendered image boxes to
      // overlap. The shrink/repack loop below will make room instead.
      var gap = COLLAGE_RECT_GAP;
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];
        if (p.x < -1000) continue;
        if (tx + tile.fullW + gap <= p.x) continue;
        if (tx >= p.x + p.fullW + gap) continue;
        if (ty + tile.fullH + gap <= p.y) continue;
        if (ty >= p.y + p.fullH + gap) continue;
        return true;
      }
      return false;
    }

    var cx = W / 2, cy = H / 2;
    // Largest first so the cluster grows around the anchor.
    tiles.sort(function (a, b) {
      var areaDiff = (b.fullW * b.fullH) - (a.fullW * a.fullH);
      if (Math.abs(areaDiff) > 1) return areaDiff;
      if (a.nightProtected !== b.nightProtected) return a.nightProtected ? -1 : 1;
      if (ellipseBias <= 1.25 && tiles.length <= 8) {
        return Math.abs(a.ar - 1.1) - Math.abs(b.ar - 1.1);
      }
      return areaDiff;
    });
    var placed = [];
    // Seeded PRNG keeps the layout stable across resizes.
    var seed = 0x9E3779B9;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var tx, ty;
      if (i === 0) {
        tx = cx - t.fullW / 2;
        ty = cy - t.fullH / 2;
        t.x = tx; t.y = ty;
        stamp(t, tx, ty);
        placed.push(t);
        continue;
      }
      // Spiral outward. Stop the first ring that yields any non-colliding
      // position - that ring is the tightest possible distance from
      // centre. Within the ring, pick the position closest to the centre
      // of mass of already-placed tiles (so cluster grows organically,
      // not in fixed directions).
      var comX = 0, comY = 0, comW = 0;
      placed.forEach(function (p) {
        var a = p.fullW * p.fullH;
        comX += (p.x + p.fullW / 2) * a;
        comY += (p.y + p.fullH / 2) * a;
        comW += a;
      });
      comX /= comW; comY /= comW;

      var best = null, bestCost = Infinity;
      var step = Math.max(GRID_STRIDE, Math.min(t.fullW, t.fullH) * 0.05);
      var maxR = Math.max(W, H);
      var foundRing = -1;
      var phase = rand() * Math.PI * 2;
      for (var r = 0; r <= maxR; r += step) {
        if (foundRing >= 0 && r > foundRing + step * 2) break;
        var samples = Math.max(36, Math.floor(r / 1.6));
        for (var k = 0; k < samples; k++) {
          var theta = phase + (k / samples) * Math.PI * 2;
          // Elliptical ring - x stretched.
          var px = cx + r * ellipseBias * Math.cos(theta) - t.fullW / 2;
          var py = cy + r * Math.sin(theta) - t.fullH / 2;
          if (offGrid(t, px, py)) continue;
          if (rectCollides(t, px, py)) continue;
          if (collides(t, px, py)) continue;
          // Distance to existing cluster centre of mass + small noise.
          var dxx = (px + t.fullW / 2 - comX);
          var dyy = (py + t.fullH / 2 - comY);
          var cost = Math.hypot(dxx / ellipseBias, dyy) + rand() * step * 0.5;
          if (cost < bestCost) { bestCost = cost; best = { x: px, y: py }; }
        }
        if (best && foundRing < 0) foundRing = r;
      }
      if (best) {
        t.x = best.x; t.y = best.y;
        stamp(t, best.x, best.y);
        placed.push(t);
      } else {
        // Couldn't fit anywhere - hide off-screen rather than overlap.
        t.x = -99999; t.y = -99999;
        placed.push(t);
      }
    }
    return placed;
  }

  function renderCollage(items) {
    collage.innerHTML = '';
    var fadeIn = collageFadeNext;
    collageFadeNext = false;
    if (fadeIn) collage.setAttribute('data-entering', 'true');
    else collage.removeAttribute('data-entering');
    if (!items.length) {
      collage.removeAttribute('data-entering');
      collage.innerHTML = nightCollageOn ? renderNightMoonEmpty() : '<p class="empty">no birds heard in this window.</p>';
      return;
    }
    var W = collage.clientWidth, H = collage.clientHeight;
    if (!W || !H) { setTimeout(function () { renderCollage(items); }, 80); return; }

    // Tuning depends on bird count - same viewport, very different
    // pack densities for 6 vs 48 birds.
    var T = tuning(items.length, W, H);
    var vpArea = W * H;
    var budget  = vpArea * T.packingBudgetFrac;
    var minArea = vpArea * T.minTileAreaFrac;

    // Step 1: build tiles + assign each a count-weighted SCORE (not a
    // final area yet). The displayed data stays exact; only the collage
    // sizing count is capped so a hyperactive common species cannot
    // dominate the plate.
    var tiles = items.map(function (s) {
      var assetKey = collageAssetKey(s.sci);
      var mask = loadMask(assetKey);
      if (!mask) return null;
      var n = +s.n; if (!n || isNaN(n)) n = 1;
      var sizeN = collageSizingCount(n);
      var areaScale = areaScaleForKey(assetKey);
      return {
        mask: mask, data: s,
        ar: aspectForKey(assetKey),
        minArea: minArea * areaScale,
        score: Math.pow(sizeN, T.countExp) * areaScale,
        nightProtected: !!s._nightProtected,
      };
    }).filter(Boolean);

    // Step 2: normalise so sum(area) ≈ budget. Then floor each tile
    // at minArea so even a 1-call bird stays legible.
    var sumScore = tiles.reduce(function (a, t) { return a + t.score; }, 0) || 1;
    tiles.forEach(function (t) {
      t.area = Math.max(t.minArea, budget * t.score / sumScore);
    });
    // After flooring, total may exceed budget; squeeze the over-budget
    // remainder out of the LARGER tiles (the ones above minArea) so
    // the floor on rare birds stays intact.
    var sumA = tiles.reduce(function (a, t) { return a + t.area; }, 0);
    if (sumA > budget) {
      var fixedSum = tiles.filter(function (t) { return t.area <= t.minArea + 1e-9; })
        .reduce(function (a, t) { return a + t.area; }, 0);
      var flexSum  = sumA - fixedSum;
      var flexBudget = Math.max(0, budget - fixedSum);
      var shrink = flexSum > 0 ? Math.min(1, flexBudget / flexSum) : 1;
      tiles.forEach(function (t) {
        if (t.area > t.minArea + 1e-9) t.area *= shrink;
      });
    }
    // Step 3: derive width/height from area + per-species aspect.
    tiles.forEach(function (t) {
      t.fullW = Math.sqrt(t.area * t.ar);
      t.fullH = t.fullW / t.ar;
    });

    var placed = maskPack(tiles, W, H, T.ellipseAspectBias);

    // Scale-to-fit: iterate shrink + repack until every tile lands on
    // screen. The old single-pass version dropped birds when one pass
    // wasn't enough (narrow viewports + many species). Capped at 10
    // iterations - by then the linear scale is ~0.5 of original, more
    // than enough headroom for any viewport.
    function clusterBounds(arr) {
      var L = Infinity, R = -Infinity, T2 = Infinity, B = -Infinity;
      arr.forEach(function (t) {
        if (t.x < -1000) return;
        if (t.x < L) L = t.x;
        if (t.x + t.fullW > R) R = t.x + t.fullW;
        if (t.y < T2) T2 = t.y;
        if (t.y + t.fullH > B) B = t.y + t.fullH;
      });
      return { L: L, R: R, T: T2, B: B };
    }
    var fitMarginX = T.mobileCompact ? W * 0.002 : 0;
    var fitMarginY = T.mobileCompact ? H * 0.04 : 0;
    var fitW = Math.max(1, W - fitMarginX * 2);
    var fitH = Math.max(1, H - fitMarginY * 2);
    var b = clusterBounds(placed);
    for (var iter = 0; iter < 10; iter++) {
      var missing  = placed.some(function (t) { return t.x < -1000; });
      var clW = b.R - b.L, clH = b.B - b.T;
      var overflow = b.L < 0 || b.T < 0 || b.R > W || b.B > H || clW > fitW || clH > fitH;
      if (!missing && !overflow) break;
      // Base 0.93 linear shrink (≈ 0.86 area). If overflow, take the
      // tighter of cluster-to-viewport ratios so we converge fast.
      var scale = 0.93;
      if (overflow) {
        var sx = (fitW * 0.98) / Math.max(clW, fitW * 0.98);
        var sy = (fitH * 0.98) / Math.max(clH, fitH * 0.98);
        scale = Math.min(scale, sx, sy);
      }
      tiles.forEach(function (t) { t.fullW *= scale; t.fullH *= scale; });
      placed = maskPack(tiles, W, H, T.ellipseAspectBias);
      b = clusterBounds(placed);
    }

    // Re-centre the cluster in the viewport so a small cluster doesn't
    // drift to one side from the spiral's center-of-mass bias. Anchor the
    // horizontal shift on the largest bird, not only the cluster bounds,
    // so the most-heard species reads as the centerpiece of the collage.
    var targetY = T.mobileCompact ? H * 0.47 : H / 2;
    var anchor = null;
    placed.forEach(function (t) {
      if (t.x < -1000) return;
      if (!anchor || t.fullW * t.fullH > anchor.fullW * anchor.fullH) anchor = t;
    });
    var dx = anchor ? (W / 2 - (anchor.x + anchor.fullW / 2)) : (W / 2 - (b.L + b.R) / 2);
    var dy = targetY - (b.T + b.B) / 2;
    var marginX = fitMarginX;
    var marginY = fitMarginY;
    dx = Math.max(marginX - b.L, Math.min(W - marginX - b.R, dx));
    dy = Math.max(marginY - b.T, Math.min(H - marginY - b.B, dy));
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      placed.forEach(function (t) { if (t.x > -1000) { t.x += dx; t.y += dy; } });
      b = clusterBounds(placed);
    }

    placed.forEach(function (r) {
      var s = r.data;
      // com flows through so the worker's JIT Gemini job uses the right
      // common name in its prompt for a freshly-detected species.
      // &v=IMG_VERSION busts CF edge cache when we re-render any species.
      var pose = collagePose(s.sci);
      var img = apiUrl('cutout.php?sci=' + encodeURIComponent(s.sci)) +
        (s.com ? '&com=' + encodeURIComponent(s.com) : '') +
        (pose > 1 ? '&pose=' + pose : '') +
        '&v=' + IMG_VERSION;
      var btn = document.createElement('button');
      btn.className = 'gtile';
      btn.type = 'button';
      btn.setAttribute('data-sci', s.sci);
      btn.setAttribute('aria-label', s.com);
      // Fallback for keyboard / screen-reader users - the visible hover
      // pill below is the primary affordance for sighted mouse users.
      // "calls" (not "heard") because one bird can rack up dozens of
      // detections in a session; "heard" implies distinct individuals.
      var titleN = +s.n || 0;
      btn.title = (s.com || s.sci) + ' · ' + fmtN(titleN) + ' ' +
        (titleN === 1 ? 'call' : 'calls') + ' ' + windowLabel(currentHours);
      btn.style.left   = r.x + 'px';
      btn.style.top    = r.y + 'px';
      btn.style.width  = r.fullW + 'px';
      btn.style.height = r.fullH + 'px';
      var rarity = rarityInfoForSci(s.sci, s.n);
      var badge = (rarity.key === 'epic' || rarity.key === 'rare')
        ? '<span class="collage-rarity-badge" data-rarity="' + rarity.key + '">' + rarity.label + rarityLegendHtml() + '</span>'
        : '';
      var seasonBadge = isSeasonFirstInWindow(s.sci) ? seasonFirstBadgeHtml(true) : '';
      var visualBadge = visualBadgeHtml(visualSeenFor(s.sci, s.com));
      btn.innerHTML = '<img loading="lazy" decoding="async" src="' + img + '" alt="' + s.com + '">' + badge + seasonBadge + visualBadge;
      r.el = btn;
      collage.appendChild(btn);
    });
    // Hover pill - created once per render so collage.innerHTML='' at
    // the top of this function doesn't strand a stale node. mousemove
    // populates its text from hit.data so the count is whatever the
    // current window's data says.
    var tip = document.createElement('div');
    tip.id = 'collageTip';
    tip.className = 'collage-tip';
    tip.setAttribute('aria-hidden', 'true');
    collage.appendChild(tip);
    // Stash the placed tiles so the alpha-mask hit-tester (below) can
    // resolve which silhouette the cursor is actually over.
    collagePlaced = placed.filter(function (t) { return t.x > -1000; });
    if (fadeIn) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          collage.removeAttribute('data-entering');
        });
      });
    }
  }

  // ---- Alpha-mask hover/click hit-testing ----
  // The .gtile buttons are rectangles and their bounding boxes overlap
  // (tight nesting). A plain :hover would light up whichever rectangle
  // is on top - often not the bird under the cursor. So we hit-test
  // the cursor against each tile's binary alpha mask and only the
  // genuinely-hit silhouette gets .is-hover / receives the click.
  var collagePlaced = [];
  var collageHovered = null;
  function maskHitTest(clientX, clientY) {
    var box = collage.getBoundingClientRect();
    var px = clientX - box.left, py = clientY - box.top;
    // Iterate topmost-first (later in DOM = painted on top).
    for (var i = collagePlaced.length - 1; i >= 0; i--) {
      var t = collagePlaced[i];
      if (px < t.x || py < t.y || px > t.x + t.fullW || py > t.y + t.fullH) continue;
      var mx = ((px - t.x) / t.fullW * t.mask.w) | 0;
      var my = ((py - t.y) / t.fullH * t.mask.h) | 0;
      // Build a fast lookup set once per mask.
      if (!t.mask._set) {
        var set = {};
        var cells = t.mask.cells;
        for (var c = 0; c < cells.length; c++) set[cells[c][0] + '|' + cells[c][1]] = 1;
        t.mask._set = set;
      }
      if (t.mask._set[mx + '|' + my]) return t;
    }
    return null;
  }
  collage.addEventListener('mousemove', function (ev) {
    var hit = maskHitTest(ev.clientX, ev.clientY);
    if (hit === collageHovered) return;
    if (collageHovered && collageHovered.el) collageHovered.el.classList.remove('is-hover');
    collageHovered = hit;
    if (hit && hit.el) hit.el.classList.add('is-hover');
    collage.style.cursor = hit ? 'pointer' : 'default';
    var tip = document.getElementById('collageTip');
    if (tip) {
      if (hit) {
        var s = hit.data;
        var n = +s.n || 0;
        var noun = (n === 1) ? 'call' : 'calls';
        tip.innerHTML = '<span class="ct-name">' + (s.com || s.sci) + '</span>'
          + '<span class="ct-w"> - </span>'
          + '<span class="ct-n">' + fmtN(n) + '</span>'
          + '<span class="ct-w"> ' + noun + ' ' + windowLabel(currentHours) + '</span>';
        tip.setAttribute('aria-hidden', 'false');
      } else {
        tip.setAttribute('aria-hidden', 'true');
      }
    }
  });
  collage.addEventListener('mouseleave', function () {
    if (collageHovered && collageHovered.el) collageHovered.el.classList.remove('is-hover');
    collageHovered = null;
    var tip = document.getElementById('collageTip');
    if (tip) tip.setAttribute('aria-hidden', 'true');
  });
  collage.addEventListener('click', function (ev) {
    var hit = maskHitTest(ev.clientX, ev.clientY);
    if (!hit) return;
    location.hash = '#sci=' + encodeURIComponent(hit.data.sci);
    go(2);
  });

  // Debug hook - call __layout({ slugs, weights, n }) from devtools to
  // re-render the collage with a custom item set. Lets us prove the
  // nester handles 6/12/24/48 birds and varied size hierarchies without
  // touching the source.
  window.__layout = function (opts) {
    opts = opts || {};
    var allSlugs = Object.keys(DIMS);
    var slugs = opts.slugs || allSlugs.slice(0, opts.n || 12);
    var weights = opts.weights;
    var items = slugs.map(function (slug, i) {
      // Recover a sci name from the slug - capitalize first segment.
      var parts = slug.split('-');
      var sci = parts.slice(0, 2).map(function (p, j) { return j === 0 ? p[0].toUpperCase() + p.slice(1) : p; }).join(' ');
      var n;
      if (weights === 'uniform') n = 10;
      else if (weights === 'extreme') n = i === 0 ? 500 : 1;
      else if (Array.isArray(weights)) n = weights[i] || 1;
      else n = Math.pow(0.55, i) * 100; // default hierarchy
      return { sci: sci, com: sci, n: n };
    });
    renderCollage(items);
    return { rendered: items.length, mode: weights || 'hierarchy' };
  };

  function moonPhaseInfo(date) {
    var synodic = 29.530588853;
    var knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
    var now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    var days = (now - knownNewMoon) / 86400000;
    var age = ((days % synodic) + synodic) % synodic;
    var phase = age / synodic;
    var illum = (1 - Math.cos(phase * Math.PI * 2)) / 2;
    var names = [
      [0.03, 'New Moon'],
      [0.22, 'Waxing Crescent'],
      [0.28, 'First Quarter'],
      [0.47, 'Waxing Gibbous'],
      [0.53, 'Full Moon'],
      [0.72, 'Waning Gibbous'],
      [0.78, 'Last Quarter'],
      [0.97, 'Waning Crescent'],
      [1.00, 'New Moon']
    ];
    var name = names[names.length - 1][1];
    for (var i = 0; i < names.length; i++) {
      if (phase <= names[i][0]) { name = names[i][1]; break; }
    }
    return { phase: phase, illumination: illum, waxing: phase < 0.5, name: name };
  }

  function renderMoonSvg(info) {
    var lit = Math.max(0.02, Math.min(0.98, info.illumination));
    var rx = Math.max(3, Math.round(44 * Math.abs(1 - lit * 2)));
    var shadowSide = info.waxing ? 1 : -1;
    var shadowX = 60 + shadowSide * Math.round((1 - lit) * 18);
    var darkOpacity = lit > 0.96 ? 0 : (lit < 0.04 ? 1 : 0.76);
    return ''
      + '<svg class="night-moon-face" viewBox="0 0 120 120" role="img" aria-label="' + info.name + '">'
      +   '<defs>'
      +     '<radialGradient id="moonGlow" cx="45%" cy="38%" r="62%">'
      +       '<stop offset="0%" stop-color="#fffdf0"/>'
      +       '<stop offset="70%" stop-color="#f3eedb"/>'
      +       '<stop offset="100%" stop-color="#cfc7aa"/>'
      +     '</radialGradient>'
      +     '<clipPath id="moonClip"><circle cx="60" cy="60" r="44"/></clipPath>'
      +   '</defs>'
      +   '<circle class="night-moon-halo" cx="60" cy="60" r="54"/>'
      +   '<circle cx="60" cy="60" r="44" fill="url(#moonGlow)"/>'
      +   '<g clip-path="url(#moonClip)">'
      +     '<ellipse cx="' + shadowX + '" cy="60" rx="' + rx + '" ry="47" fill="#10131b" opacity="' + darkOpacity.toFixed(2) + '"/>'
      +     '<circle cx="44" cy="44" r="3.6" fill="rgba(86,78,66,0.13)"/>'
      +     '<circle cx="68" cy="34" r="2.4" fill="rgba(86,78,66,0.11)"/>'
      +     '<circle cx="78" cy="70" r="4.8" fill="rgba(86,78,66,0.10)"/>'
      +     '<circle cx="49" cy="78" r="2.8" fill="rgba(86,78,66,0.10)"/>'
      +   '</g>'
      +   '<circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>'
      + '</svg>';
  }

  function renderNightMoonEmpty() {
    var info = moonPhaseInfo(new Date());
    var pct = Math.round(info.illumination * 100);
    return ''
      + '<div class="night-moon-empty" role="status" aria-live="polite">'
      +   renderMoonSvg(info)
      +   '<strong>' + info.name + '</strong>'
      +   '<span>' + pct + '% illuminated</span>'
      +   '<small>No night detections in ' + windowLabel(currentHours) + '.</small>'
      + '</div>';
  }

  // Collage renders whatever is in DATA.recent.species. When the picker
  // changes, refreshRecent() refetches and re-renders. Empty state shows
  // a "no detections in this window" message.
  function nightCollageItems() {
    var night = (DATA.nightCollage && DATA.nightCollage.species) || (DATA.overnight && DATA.overnight.species) || [];
    var recent = (DATA.recent && DATA.recent.species) || [];
    if (!night.length || !recent.length) return [];
    var inRecent = {};
    recent.forEach(function (s) { if (s && s.sci) inRecent[s.sci] = true; });
    return night.filter(function (s) { return s && inRecent[s.sci]; });
  }
  function mainCollageItems() {
    var recent = (DATA.recent && DATA.recent.species) || [];
    var nightSet = {};
    nightCollageItems().forEach(function (s) { if (s && s.sci) nightSet[s.sci] = true; });
    return recent.map(function (s) {
      if (!nightSet[s.sci]) return s;
      var copy = {};
      Object.keys(s).forEach(function (k) { copy[k] = s[k]; });
      copy._nightProtected = true;
      return copy;
    });
  }
  function syncNightToggle() {
    if (!nightToggle) return;
    nightToggle.setAttribute('data-visible', 'true');
    nightToggle.setAttribute('aria-pressed', nightCollageOn ? 'true' : 'false');
    nightToggle.setAttribute('aria-label', nightCollageOn ? 'Show recent birds' : 'Show night visitors');
    document.body.setAttribute('data-night-collage', nightCollageOn ? 'true' : 'false');
  }
  function setNightCollage(on) {
    var next = !!on;
    if (nightSwapTimer) {
      clearTimeout(nightSwapTimer);
      nightSwapTimer = null;
    }
    nightCollageOn = next;
    syncNightToggle();
    nightSwapTimer = setTimeout(function () {
      nightSwapTimer = null;
      collageFadeNext = true;
      renderCollageFromData();
    }, next ? 760 : 180);
  }
  function renderCollageFromData() {
    syncNightToggle();
    var items = nightCollageOn ? nightCollageItems() : mainCollageItems();
    renderCollage(items);
  }
  if (nightToggle) {
    nightToggle.addEventListener('click', function () {
      setNightCollage(!nightCollageOn);
    });
  }
  var rTimer;
  window.addEventListener('resize', function () {
    clearTimeout(rTimer);
    rTimer = setTimeout(function () {
      renderCollageFromData();
      drawHistograms();
    }, 120);
  });

  // ---- Stats / Atlas data ----
  function setRow(id, label, val) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<span>' + label + '</span><span>' + (val == null || val === '' ? '-' : val) + '</span>';
  }
  function liRow(yr, label, ct, sci) {
    var attr = sci ? ' data-sci="' + sci.replace(/"/g, '&quot;') + '"' : '';
    return '<li' + attr + '><span class="yr">' + yr + '</span><span>' + label + '</span><span class="ct">' + (ct == null ? '-' : ct) + '</span></li>';
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtN(n) {
    if (n == null) return '-';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString();
  }
  // Human label for the current time-window picker selection - replaces
  // a bare "window" with the span it actually covers. Thresholds match
  // the winPick buttons (1H / 12H / 24H / 7D / ALL).
  function windowLabel(h) {
    if (h <= 1) return 'this hour';
    if (h <= 12) return 'past 12h';
    if (h <= 24) return 'today';
    if (h <= 168) return 'this week';
    return 'all time';
  }
  function windowTotalLabel(h) {
    if (h <= 1) return '1h';
    if (h <= 12) return '12h';
    if (h <= 24) return '24h';
    if (h <= 168) return '7d';
    return 'all-time';
  }

  // ---- Live Pi data layer ----
  // All views read from this DATA object. Populated by fetchAll() on page
  // load and by refreshRecent() when the window picker changes.
  var STATS_DAYS = 30;
  var DATA = {
    stats: null,        // ./avian/api/birdnet-api.php?action=stats (totals/today/week/last_hour/started)
    lifelist: null,     // ./avian/api/birdnet-api.php?action=lifelist (every species ever detected)
    timeseries: null,   // ./avian/api/birdnet-api.php?action=timeseries (daily + hourly aggregates)
    seasonality: null,  // ./avian/api/birdnet-api.php?action=seasonality (weekly migration calendar)
    firstseen: null,    // ./avian/api/birdnet-api.php?action=firstseen (newest lifelist additions)
    seasonfirst: null,  // ./avian/api/birdnet-api.php?action=seasonfirst (first detections since Jan 1)
    recent: null,       // ./avian/api/birdnet-api.php?action=recent&hours=N (refetched on picker change)
    ebirdNearby: null,  // ./avian/api/birdnet-api.php?action=ebird_nearby (recent eBird reports near the Pi)
    visual: null,       // ./avian/api/birdfy-api.php?action=visual_summary&hours=N (camera detections)
    overnight: null,    // configured night-hours species summary for the active stats window
    nightCollage: null, // configured night-hours species summary for the moon reveal, fixed at the last 7 days
  };

  function seasonStartLabel() {
    var start = DATA.seasonfirst && DATA.seasonfirst.season_start;
    if (!start) return 'Jan 1';
    var p = start.split('-');
    if (p.length < 3) return 'Jan 1';
    var d = new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function seasonFirstLookup() {
    var out = {};
    ((DATA.seasonfirst && DATA.seasonfirst.species) || []).forEach(function (s) {
      if (s && s.sci) out[s.sci] = s;
    });
    return out;
  }
  function seasonFirstForSci(sci) {
    return seasonFirstLookup()[sci] || null;
  }
  function isSeasonFirstInWindow(sci) {
    var row = seasonFirstForSci(sci);
    if (!row || !row.first_seen) return false;
    if (currentHours >= 1000000) return false;
    var t = parseSiteTs(row.first_seen);
    if (isNaN(t)) return false;
    return (Date.now() - t) <= currentHours * 3600000;
  }
  function seasonFirstBadgeHtml(compact) {
    return '<span class="' + (compact ? 'season-first-dot' : 'season-first-badge') + '" title="First detection this season" aria-label="First detection this season">'
      + '<span class="ribbon-num">1</span>'
      + '<span class="ribbon-label">season first</span>'
      + '</span>';
  }

  function birdNameKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function visualSeenFor(sci, com) {
    var rows = (DATA.visual && DATA.visual.species) || [];
    var sciKey = String(sci || '');
    var comKey = birdNameKey(com);
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].sci && rows[i].sci === sciKey) return rows[i];
      if (comKey && birdNameKey(rows[i].com) === comKey) return rows[i];
    }
    return null;
  }
  function visualBadgeHtml(info) {
    if (!info) return '';
    var count = +info.n || 1;
    var title = 'Seen by Birdfy camera' + (count > 1 ? ' · ' + count + ' sightings' : '');
    return '<span class="collage-visual-badge" title="' + attrEsc(title) + '" aria-label="' + attrEsc(title) + '">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.5-5.8 9.2-5.8S21.2 12 21.2 12 17.7 17.8 12 17.8 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>'
      + '</span>';
  }

  // Derived chart arrays, backfilled so 30 buckets always exist.
  var STATS = {
    detPerDay:  new Array(STATS_DAYS).fill(0), // [day] total detections
    specPerDay: new Array(STATS_DAYS).fill(0), // [day] unique species
    byHour:     new Array(24).fill(0),         // [hour-of-day] detections
  };

  // Map sci -> all-time detection count, populated from lifelist for atlas.
  var speciesTotals = {};
  function speciesTotal(s) {
    return +(s && (s.total != null ? s.total : s.n)) || 0;
  }

  function ebirdNearbyFor(sci) {
    var nearby = DATA.ebirdNearby;
    return nearby && nearby.species ? nearby.species[sci] : null;
  }
  function ebirdNearbyLabel(info) {
    if (!info) return '';
    var days = info.days_ago;
    if (days === 0) return 'reported today';
    if (days === 1) return 'reported yesterday';
    if (days != null && days <= 30) return 'reported ' + days + 'd ago';
    return 'reported nearby';
  }
  function renderEbirdCardBadge(sci) {
    var nearby = DATA.ebirdNearby;
    if (!nearby || nearby.configured === false) return '';
    var info = ebirdNearbyFor(sci);
    if (!info) return '<div class="ebird-nearby-badge" data-state="quiet">no recent eBird report</div>';
    return '<div class="ebird-nearby-badge" data-state="seen">nearby now · ' + ebirdNearbyLabel(info) + '</div>';
  }
  function refreshOpenModalEbirdNearby() {
    var modal = document.getElementById('detail-modal');
    if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;
    var sci = (document.getElementById('modalSci').textContent || '').trim();
    if (sci) renderEbirdNearby(ebirdNearbyFor(sci));
  }

  function renderEbirdNearby(info) {
    var box = document.getElementById('modalEbirdNearby');
    var label = document.getElementById('modalEbirdNearbyLabel');
    var detail = document.getElementById('modalEbirdNearbyDetail');
    if (!box || !label || !detail) return;
    var nearby = DATA.ebirdNearby;
    box.removeAttribute('data-state');
    if (!nearby) {
      label.textContent = 'Checking eBird...';
      detail.textContent = 'Recent reports near your BirdNET location.';
      return;
    }
    if (nearby.configured === false) {
      box.setAttribute('data-state', 'empty');
      label.textContent = 'eBird not configured';
      detail.textContent = nearby.message || 'Set EBIRD_API_KEY on the Pi to enable nearby reports.';
      return;
    }
    if (!info) {
      box.setAttribute('data-state', 'quiet');
      label.textContent = 'No recent nearby report';
      detail.textContent = 'No eBird reports within ' + (nearby.dist_km || 25) + ' km in the last ' + (nearby.back_days || 14) + ' days.';
      return;
    }
    box.setAttribute('data-state', 'seen');
    label.textContent = 'Reported nearby';
    var bits = [ebirdNearbyLabel(info)];
    if (info.location) bits.push(info.location);
    if (+info.reports > 1) bits.push(fmtN(+info.reports) + ' reports');
    detail.textContent = bits.join(' · ');
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
  }

  var SLOW_DATA_TTL_MS = 5 * 60 * 1000;
  var EBIRD_NEARBY_TTL_MS = 60 * 60 * 1000;
  var slowDataFetchedAt = {};
  function fetchCachedData(key, url, ttlMs) {
    var cached = DATA[key];
    var fetchedAt = slowDataFetchedAt[key] || 0;
    if (cached && (Date.now() - fetchedAt) < ttlMs) {
      return Promise.resolve(cached);
    }
    return fetchJson(url).then(function (j) {
      slowDataFetchedAt[key] = Date.now();
      return j;
    });
  }

  function backfillDaily(daily, days) {
    // Build a continuous array of (days) length, ending today.
    var byDate = {};
    (daily || []).forEach(function (row) { byDate[row.date] = row; });
    var out = new Array(days).fill(null).map(function () { return { detections: 0, species: 0 }; });
    var today = new Date();
    for (var i = 0; i < days; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() - (days - 1 - i));
      var key = d.toISOString().slice(0, 10);
      if (byDate[key]) {
        out[i].detections = +byDate[key].detections || 0;
        out[i].species    = +byDate[key].species    || 0;
      }
    }
    return out;
  }

  function recomputeDerived() {
    var ts = DATA.timeseries || { daily: [], by_hour: [] };
    var ll = DATA.lifelist || { species: [] };
    var rows = backfillDaily(ts.daily, STATS_DAYS);
    STATS.detPerDay  = rows.map(function (r) { return r.detections; });
    STATS.specPerDay = rows.map(function (r) { return r.species; });
    var byHour = new Array(24).fill(0);
    (ts.by_hour || []).forEach(function (r) { byHour[+r.hour] = +r.detections; });
    STATS.byHour = byHour;
    speciesTotals = {};
    (ll.species || []).forEach(function (s) { speciesTotals[s.sci] = speciesTotal(s); });
  }

  // ---- Chart palette ----
  // Monochromatic ink, matching the title text (--ink). Bars positioned
  // toward the "recent" end of the gradient render in deeper ink; older
  // bars fade to a warm light grey. Same hue family throughout.
  function barColor(t) {
    // t = 0 (outer / newest) -> 1 (inner / oldest).
    // Monochromatic ink palette: same warm hue as the title text
    // (--ink: #1a1612 ≈ HSL 25, 14%, 9%). Newest hours render in deep
    // ink so the outer perimeter reads bold; older hours fade to a
    // warm light grey, the chart looks like a hand-pulled engraving.
    var hue = 25;                    // warm-grey hue, matches --ink family
    var sat = 12 - t * 8;             // 12% -> 4%
    var light = 14 + t * 50;          // 14% (near-black) -> 64% (light grey)
    return 'hsl(' + hue + ', ' + sat.toFixed(0) + '%, ' + light.toFixed(0) + '%)';
  }

  function callLabel(n) {
    return (+n === 1) ? 'call' : 'calls';
  }
  function fmtStatsDateTime(value) {
    if (!value) return '';
    var ms = parseSiteTs(value);
    if (isNaN(ms)) return value;
    return fmtSiteDate(ms) + ' · ' + fmtSiteTime(ms) + ' ' + SITE_TIME_LABEL;
  }
  var overnightSeq = 0;
  function refreshOvernightStats() {
    var forHours = currentHours;
    var seq = ++overnightSeq;
    return fetchJson(nightApiUrl(forHours, 6))
      .then(function (j) {
        if (seq !== overnightSeq || forHours !== currentHours) return null;
        applyNightWindowFromResponse(j);
        DATA.overnight = j;
        renderStatsLists();
        return j;
      })
      .catch(function (e) {
        if (seq !== overnightSeq || forHours !== currentHours) return null;
        console.warn('night visitors fetch failed', e);
        DATA.overnight = { species: [], hours: forHours, as_of: Date.now(), error: true };
        renderStatsLists();
        return DATA.overnight;
      });
  }

  function renderNightVisitorsPanel() {
    var night = DATA.overnight;
    var rows = (night && night.species) || [];
    var sub = nightWindowLabel() + ', ' + windowLabel(currentHours);
    if (!night) {
      return ''
        + '<section class="stats-overnight" data-empty="true">'
        +   '<div class="stats-recent-head stats-overnight-head">'
        +     '<h3>Night Visitors</h3>'
        +     '<small>' + sub + '</small>'
        +   '</div>'
        +   '<div class="stats-overnight-empty">checking late and early calls...</div>'
        + '</section>';
    }
    if (!rows.length) {
      return ''
        + '<section class="stats-overnight" data-empty="true">'
        +   '<div class="stats-recent-head stats-overnight-head">'
        +     '<h3>Night Visitors</h3>'
        +     '<small>' + sub + '</small>'
        +   '</div>'
        +   '<div class="stats-overnight-empty">No calls in the night window.</div>'
        + '</section>';
    }
    return ''
      + '<section class="stats-overnight">'
      +   '<div class="stats-recent-head stats-overnight-head">'
      +     '<h3>Night Visitors</h3>'
      +     '<small>' + sub + '</small>'
      +   '</div>'
      +   '<div class="stats-overnight-list">'
      +     rows.map(function (s) {
              var n = +s.n || 0;
              var conf = Math.round((+s.best_conf || 0) * 100);
              var meta = fmtStatsDateTime(s.last_seen);
              if (conf) meta += (meta ? ' · ' : '') + conf + '% best';
              return ''
                + '<div class="stats-overnight-row" data-sci="' + s.sci + '">'
                +   '<div class="stats-overnight-name">'
                +     '<span class="com">' + (s.com || s.sci) + '</span>'
                +     '<span class="time">' + meta + '</span>'
                +   '</div>'
                +   '<div class="stats-overnight-count">'
                +     '<span class="n">' + fmtN(n) + '</span>'
                +     '<span class="lbl">' + callLabel(n) + '</span>'
                +   '</div>'
                + '</div>';
            }).join('')
      +   '</div>'
      + '</section>';
  }

  function statsRecentLimit() {
    if (window.matchMedia && window.matchMedia('(max-width: 700px)').matches) return 5;
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    if (h && h <= 820) return 10;
    if (h && h <= 950) return 12;
    return 13;
  }

  function statsActivityProfile() {
    var counts = (STATS.byHour || []).slice(0, 24).map(function (n) { return +n || 0; });
    while (counts.length < 24) counts.push(0);
    var total = counts.reduce(function (sum, n) { return sum + n; }, 0);
    var peakHour = 0;
    for (var i = 1; i < 24; i += 1) {
      if (counts[i] > counts[peakHour]) peakHour = i;
    }
    return { counts: counts, total: total, peakHour: total ? peakHour : null };
  }

  function renderStatsActivityClock() {
    var p = statsActivityProfile();
    if (!p.total) {
      return ''
        + '<section class="stats-clock-panel" data-empty="true">'
        +   '<div class="stats-clock-copy">'
        +     '<h3>Activity Clock</h3>'
        +     '<small>any bird, last 30 days</small>'
        +     '<strong>No hourly detections yet</strong>'
        +     '<span class="stats-clock-detail">the clock will fill in as BirdNET logs calls</span>'
        +   '</div>'
        + '</section>';
    }
    return ''
      + '<section class="stats-clock-panel" role="button" tabindex="0" aria-label="Open large activity clock">'
      +   '<div class="stats-clock-copy">'
      +     '<h3>Activity Clock</h3>'
      +     '<small>any bird, last 30 days</small>'
      +     '<strong>' + fmtHourRange(p.peakHour) + '</strong>'
      +     '<span class="stats-clock-detail">' + fmtN(p.total) + ' detections &middot; peak hour has ' + fmtN(p.counts[p.peakHour]) + '</span>'
      +   '</div>'
      +   '<div class="stats-hour-clock" aria-hidden="true">' + renderBestTimeClock(p.counts, p.peakHour) + '</div>'
      + '</section>';
  }

  function weekOfYearIndex(d) {
    var start = new Date(d.getFullYear(), 0, 1);
    var day = Math.floor((d - start) / 86400000);
    return Math.max(0, Math.min(51, Math.floor(day / 7)));
  }
  function monthWeekPct(monthIndex) {
    var d = new Date(new Date().getFullYear(), monthIndex, 1);
    return (weekOfYearIndex(d) / 52) * 100;
  }
  function seasonWeekLabel(idx) {
    var d = new Date(new Date().getFullYear(), 0, 1 + idx * 7);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function renderSeasonalityCalendar() {
    var data = DATA.seasonality;
    var rows = (data && data.species) || [];
    if (!data) {
      return '<div class="stats-season-empty">loading migration calendar...</div>';
    }
    if (!rows.length) {
      return '<div class="stats-season-empty">no seasonality data yet</div>';
    }
    var maxPeak = rows.reduce(function (m, s) { return Math.max(m, +s.peak_count || 0); }, 1);
    var totalSpecies = rows.length;
    var totalCalls = +(data.total_detections || 0);
    var todayPct = ((weekOfYearIndex(new Date()) + 0.5) / 52) * 100;
    var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    var monthHtml = months.map(function (m, i) {
      return '<span class="stats-season-month" style="left:' + monthWeekPct(i).toFixed(2) + '%">' + m + '</span>';
    }).join('');
    var rowHtml = rows.slice(0, 42).map(function (s) {
      var weeks = (s.weeks || []).slice(0, 52);
      while (weeks.length < 52) weeks.push(0);
      var peak = Math.max(1, +s.peak_count || 1);
      var cells = weeks.map(function (n) {
        var level = n <= 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((+n / peak) * 5)));
        return '<i class="stats-season-cell" data-v="' + level + '" title="' + fmtN(+n || 0) + ' detections"></i>';
      }).join('');
      var arrival = s.arrival_week == null ? '' : '<i class="stats-season-arrival" title="arrival around ' + seasonWeekLabel(+s.arrival_week) + '" style="left:' + (((+s.arrival_week + 0.5) / 52) * 100).toFixed(2) + '%"></i>';
      var departure = s.departure_week == null ? '' : '<i class="stats-season-departure" title="departure around ' + seasonWeekLabel(+s.departure_week) + '" style="left:' + (((+s.departure_week + 0.5) / 52) * 100).toFixed(2) + '%"></i>';
      var img = apiUrl('cutout.php?sci=' + encodeURIComponent(s.sci)) + (s.com ? '&com=' + encodeURIComponent(s.com) : '') + '&v=' + IMG_VERSION;
      return ''
        + '<div class="stats-season-row" data-sci="' + s.sci + '">'
        +   '<div class="stats-season-bird">'
        +     '<img loading="lazy" decoding="async" src="' + img + '" alt="">'
        +     '<span><strong>' + (s.com || s.sci) + '</strong><em>' + s.sci + '</em></span>'
        +   '</div>'
        +   '<div class="stats-season-heat">'
        +     cells + arrival + departure
        +     '<i class="stats-season-current" style="left:' + todayPct.toFixed(2) + '%"></i>'
        +   '</div>'
        +   '<div class="stats-season-count"><strong>' + fmtN(+s.total || 0) + '</strong><span>calls</span></div>'
        + '</div>';
    }).join('');
    var cap = rows.length > 42 ? '<span>' + fmtN(42) + ' shown of ' + fmtN(rows.length) + '</span>' : '<span>' + fmtN(totalSpecies) + ' species</span>';
    var topHtml = ''
      + '<div class="stats-season-top">'
      +   '<div>'
      +     '<h3>Migration Calendar</h3>'
      +     '<small>weekly local detections across the calendar year</small>'
      +   '</div>'
      +   '<div class="stats-season-summary">'
      +     '<strong>' + fmtN(totalSpecies) + '</strong><span>species</span>'
      +     '<strong>' + fmtN(totalCalls) + '</strong><span>calls</span>'
      +   '</div>'
      + '</div>';
    var cardHtml = ''
      + '<div class="stats-season-card">'
      +   '<div class="stats-season-head">'
      +     '<div>species</div>'
      +     '<div class="stats-season-axis">' + monthHtml + '</div>'
      +     '<div>total</div>'
      +   '</div>'
      +   '<div class="stats-season-scroll">' + rowHtml + '</div>'
      + '</div>';
    var legendHtml = ''
      + '<div class="stats-season-legend">'
      +   '<span><i class="arr"></i>arrival window</span>'
      +   '<span><i class="dep"></i>departure window</span>'
      +   '<span><i class="now"></i>today</span>'
      +   '<span><i class="heat"></i>weekly density</span>'
      +   cap
      + '</div>';
    return ''
      + '<section class="stats-season-panel">'
      +   '<div class="stats-season-inline">'
      +     topHtml
      +     cardHtml
      +     legendHtml
      +   '</div>'
      + '</section>';
  }

  function ensureStatsClockZoomModal() {
    var existing = document.getElementById('stats-clock-zoom-modal');
    if (existing) return existing;
    var modal = document.createElement('div');
    modal.id = 'stats-clock-zoom-modal';
    modal.className = 'clock-zoom-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'statsClockZoomTitle');
    modal.innerHTML = ''
      + '<div class="modal-backdrop" data-clock-close="1"></div>'
      + '<article class="clock-zoom-card">'
      +   '<button class="modal-close" type="button" aria-label="Close" data-clock-close="1">×</button>'
      +   '<div class="clock-zoom-copy">'
      +     '<h2 id="statsClockZoomTitle">Activity Clock</h2>'
      +     '<small id="statsClockZoomSub">any bird, last 30 days</small>'
      +     '<strong id="statsClockZoomPeak">-</strong>'
      +     '<span id="statsClockZoomDetail">-</span>'
      +   '</div>'
      +   '<div class="clock-zoom-face" id="statsClockZoomFace"></div>'
      + '</article>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (ev) {
      if (ev.target.dataset && ev.target.dataset.clockClose === '1') closeStatsClockZoom();
    });
    return modal;
  }

  function openStatsClockZoom() {
    var p = statsActivityProfile();
    if (!p.total) return;
    var modal = ensureStatsClockZoomModal();
    document.getElementById('statsClockZoomPeak').textContent = fmtHourRange(p.peakHour);
    document.getElementById('statsClockZoomDetail').textContent = fmtN(p.total) + ' detections · peak hour has ' + fmtN(p.counts[p.peakHour]);
    document.getElementById('statsClockZoomFace').innerHTML = renderBestTimeClock(p.counts, p.peakHour);
    modal.setAttribute('aria-hidden', 'false');
    var close = modal.querySelector('.modal-close');
    if (close) close.focus();
  }

  function closeStatsClockZoom() {
    var modal = document.getElementById('stats-clock-zoom-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  }

  function renderStatsRecentPanel(tl, rows) {
    tl.classList.remove('is-mobile');
    tl.classList.remove('is-recent-list');
    tl.classList.add('is-recent-list');
    tl.innerHTML = renderSeasonalityCalendar();
  }

  // Editorial detection timeline. One column per species; the black
  // square's height up the column encodes detection count (y axis),
  // columns run left->right oldest->newest detection (x axis). A
  // rotated species label sits just above each square. Y-axis count
  // ticks on the left, X-axis time labels on the bottom. Always fits
  // the viewport - column widths flex, square size steps down as the
  // species count climbs.
  function handleStatsClockActivate(ev) {
    var panel = ev.target && ev.target.closest ? ev.target.closest('.stats-clock-panel') : null;
    if (!panel || panel.getAttribute('data-empty') === 'true') return;
    if (ev.type === 'keydown') {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
    }
    openStatsClockZoom();
  }

  function drawHistograms() {
    var tl = document.getElementById('statsTimeline');
    if (!tl) return;
    var all = ((DATA.recent && DATA.recent.species) || []).slice();

    var now = Date.now();
    tl.classList.remove('is-mobile');

    // Cap species count so labels don't pile up. Same rule as before -
    // ~28 px per visible mark - but applied to the count of marks, not
    // the column layout (which is now time-positioned).
    var plotW = Math.max(140, (tl.clientWidth || window.innerWidth || 800) - 40);
    var narrowStats = plotW < 520;
    var mobileStats = narrowStats && window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    renderStatsRecentPanel(tl, all);
    return;
    var cap = Math.max(narrowStats ? 3 : 4, Math.floor(plotW / (narrowStats ? 74 : 28)));
    var trimmed = all.length > cap;
    var species = all.slice();
    if (trimmed) {
      species.sort(function (a, b) { return (+b.n || 0) - (+a.n || 0); });
      species = species.slice(0, cap);
    }

    var maxN = species.reduce(function (m, s) { return Math.max(m, +s.n || 0); }, 1);
    var C = species.length;
    var tier = C <= 5 ? 24 : C <= 12 ? 18 : C <= 24 ? 13 : 9;
    var sq = Math.max(7, Math.min(tier, Math.round((plotW / C) * 0.62)));
    var LABEL_GAP = 7;
    // Use most of the chart height for ordinary low counts. Only start
    // compressing the y scale when higher counts arrive and labels need
    // more headroom above the plot.
    var countSpan = Math.max(0.52, 0.78 - Math.max(0, maxN - 4) * 0.025);
    var SPAN = mobileStats ? 0.34 : countSpan; // mobile uses row timeline below.

    // Y-axis: 0..maxN with maxN pinned on the top tick. Same as before.
    var ticks = [];
    if (maxN <= 8) {
      for (var v = 0; v <= maxN; v++) ticks.push(v);
    } else {
      var divs = 4;
      for (var i = 0; i <= divs; i++) ticks.push(Math.round(maxN * i / divs));
      ticks[ticks.length - 1] = maxN;
    }
    var yaxis = ticks.map(function (v) {
      var pct = (v / maxN) * SPAN * 100;
      return '<span class="stats-tl-ytick" style="bottom:' + pct.toFixed(1) + '%">' + v + '</span>';
    }).join('');

    function parseTs(s) {
      if (!s) return NaN;
      return parseSiteTs(s);
    }

    function timelineDomain(rows) {
      var vals = rows.map(function (s) { return parseTs(s.last_seen); })
        .filter(function (t) { return !isNaN(t); });
      if (!vals.length) return { start: now - 6 * 3600000, end: now, normal: false };
      var minTs = Math.min.apply(null, vals);
      var maxTs = Math.max.apply(null, vals);
      var key = siteDateKey(maxTs);
      var normalStart = siteWallMs(key, 5, 30);
      var normalEnd = siteWallMs(key, 20, 30);
      var pad = 45 * 60000;
      var start, end, normal = false;
      if (maxTs < normalStart || minTs > normalEnd) {
        start = floorSiteHour(minTs - pad);
        end = ceilSiteHour(maxTs + pad);
      } else {
        start = minTs < normalStart ? floorSiteHour(minTs - pad) : normalStart;
        end = maxTs > normalEnd ? ceilSiteHour(maxTs + pad) : normalEnd;
        normal = start === normalStart && end === normalEnd;
      }
      if (end <= start) end = start + 3600000;
      return { start: start, end: end, normal: normal, dateKey: key };
    }

    function pickStepMs(span) {
      var h = span / 3600000;
      if (h <= 1.2) return 15 * 60000;
      if (h <= 6) return 60 * 60000;
      if (h <= 18) return 3 * 3600000;
      if (h <= 36) return 6 * 3600000;
      if (h <= 9 * 24) return 24 * 3600000;
      if (h <= 75 * 24) return 7 * 24 * 3600000;
      return 30 * 24 * 3600000;
    }

    function fmtTick(ms, span) {
      if (span <= 36 * 3600000) {
        return fmtSiteTime(ms);
      }
      if (span <= 75 * 86400000) {
        return new Date(ms).toLocaleDateString('en-US', {
          timeZone: SITE_TIME_ZONE,
          month: 'numeric',
          day: 'numeric'
        });
      }
      return fmtSiteDate(ms);
    }

    function timelineTicks(domain, span) {
      var ticks = [];
      if (domain.normal) {
        (narrowStats ? [6, 12, 18, 20] : [6, 9, 12, 15, 18, 20]).forEach(function (h) {
          var t = siteWallMs(domain.dateKey, h, 0);
          if (t >= domain.start && t <= domain.end) ticks.push(t);
        });
        return ticks;
      }
      var stepMs = pickStepMs(span);
      for (var t = domain.start; t <= domain.end + 1; t += stepMs) ticks.push(t);
      return ticks;
    }

    var domain = timelineDomain(species);
    var windowStart = domain.start;
    var windowEnd = domain.end;
    var windowSpan = Math.max(1, windowEnd - windowStart);

    // Marks - each species placed by its actual last_seen time on the
    // x-axis. Do not spread clustered birds horizontally; that makes the
    // chart lie about when the calls happened.
    var points = species.map(function (s) {
      var ts = parseTs(s.last_seen);
      var leftPct;
      if (isNaN(ts)) {
        leftPct = 50;
      } else {
        var clamped = Math.max(windowStart, Math.min(windowEnd, ts));
        leftPct = ((clamped - windowStart) / windowSpan) * 100;
      }
      return { s: s, leftPct: leftPct, ts: ts };
    }).sort(function (a, b) { return a.leftPct - b.leftPct; });

    tl.classList.toggle('is-mobile', mobileStats);

    if (mobileStats) {
      function fmtMobileTick(ms) {
        return fmtTick(ms, windowSpan).replace(':00 ', ' ');
      }
      var tickVals = timelineTicks(domain, windowSpan).map(function (t) {
        var pct = ((t - windowStart) / windowSpan) * 100;
        return { pct: pct, text: fmtMobileTick(t) };
      });
      var mobileGrid = tickVals.map(function (t) {
        return '<i class="stats-tl-mobile-gridline" style="left:' + t.pct.toFixed(2) + '%"></i>';
      }).join('');
      var mobileTicks = tickVals.map(function (t) {
        return '<span class="stats-tl-mobile-tick" style="left:' + t.pct.toFixed(2) + '%">' + t.text + '</span>';
      }).join('');
      var mobileRows = points.slice().sort(function (a, b) {
        var an = +a.s.n || 0;
        var bn = +b.s.n || 0;
        if (bn !== an) return bn - an;
        return (b.ts || 0) - (a.ts || 0);
      }).map(function (pt) {
        var s = pt.s;
        var n = +s.n || 0;
        var leftPct = Math.max(0, Math.min(100, pt.leftPct));
        var timeLine = isNaN(pt.ts) ? '' : '<span class="time">' + fmtSiteTime(pt.ts) + ' ' + SITE_TIME_LABEL + '</span>';
        return ''
          + '<div class="stats-tl-mobile-row" data-sci="' + s.sci + '" data-left-pct="' + leftPct.toFixed(2) + '">'
          +   '<div class="stats-tl-mobile-name">'
          +     '<span class="com">' + (s.com || s.sci) + '</span>'
          +     timeLine
          +   '</div>'
          +   '<div class="stats-tl-mobile-track">'
          +     mobileGrid
          +     '<i class="stats-tl-mobile-mark" style="left:' + leftPct.toFixed(2) + '%"></i>'
          +   '</div>'
          +   '<div class="stats-tl-mobile-count">' + fmtN(n) + '</div>'
          + '</div>';
      }).join('');
      var noteMobile = trimmed
        ? '<div class="stats-tl-cap">' + C + ' most-heard of ' + all.length + '</div>'
        : '';
      tl.innerHTML =
        '<div class="stats-tl-mobile">'
        + mobileRows
        + '<div class="stats-tl-mobile-axis"><div></div><div class="stats-tl-mobile-track-axis">' + mobileTicks + '</div><div></div></div>'
        + '</div>'
        + noteMobile;
      return;
    }

    var labelGapPx = mobileStats ? 84 : (narrowStats ? 90 : 54);
    var labelGapPct = Math.min(mobileStats ? 26 : 8, labelGapPx / plotW * 100);
    var laneLast = [];
    points.forEach(function (pt) {
      var lane = 0;
      while (laneLast[lane] != null && pt.leftPct - laneLast[lane] < labelGapPct) lane++;
      pt.labelLane = lane;
      laneLast[lane] = pt.leftPct;
    });
    var cols = points.map(function (pt) {
      var s = pt.s;
      var leftPct = Math.max(0, Math.min(100, pt.leftPct));
      var n = +s.n || 0;
      var bottomPct = (n / maxN) * SPAN * 100;
      var edgeClass = leftPct < 10 ? ' edge-left' : leftPct > 90 ? ' edge-right' : '';
      var timeLine = isNaN(pt.ts) ? '' : '<span class="time">' + fmtSiteTime(pt.ts) + ' ' + SITE_TIME_LABEL + '</span>';
      var labelLift = (pt.labelLane || 0) * (narrowStats ? 30 : 38);
      var lane = pt.labelLane || 0;
      var labelShift = lane ? ((lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * (narrowStats ? 38 : 46)) : 0;
      if (leftPct > 88 && labelShift > 0) labelShift = -labelShift;
      if (leftPct < 12 && labelShift < 0) labelShift = -labelShift;
      return ''
        + '<div class="stats-tl-col' + edgeClass + '" data-sci="' + s.sci + '" data-left-pct="' + leftPct.toFixed(2) + '" style="left:' + leftPct.toFixed(2) + '%">'
        +   '<div class="stats-tl-square" style="bottom:' + bottomPct.toFixed(1) + '%;width:' + sq + 'px;height:' + sq + 'px"></div>'
        +   '<div class="stats-tl-label" style="left:calc(50% + ' + labelShift + 'px);bottom:calc(' + bottomPct.toFixed(1) + '% + ' + (sq + LABEL_GAP + labelLift) + 'px)">'
        +     '<span class="com">' + (s.com || s.sci) + '</span>'
        +     '<span class="sci">' + s.sci + '</span>'
        +     timeLine
        +   '</div>'
        + '</div>';
    }).join('');

    // X-axis ticks + gridlines use the same dynamic domain as the marks.
    var xaxis = '', gridlines = '';
    timelineTicks(domain, windowSpan).forEach(function (t) {
      var pct = ((t - windowStart) / windowSpan) * 100;
      xaxis += '<span class="stats-tl-xtick" style="left:' + pct.toFixed(2) + '%">' + fmtTick(t, windowSpan) + '</span>';
      gridlines += '<i class="stats-tl-gridline" style="left:' + pct.toFixed(2) + '%"></i>';
    });

    var note = trimmed
      ? '<div class="stats-tl-cap">' + C + ' most-heard of ' + all.length + '</div>'
      : '';
    tl.innerHTML =
      '<div class="stats-tl-yaxis">' + yaxis + '</div>'
      + '<div class="stats-tl-plot">' + gridlines + cols + xaxis + '</div>'
      + note;
  }

  // Cross-highlight between the timeline squares and the right-side
  // species lists. Delegated off the stats view so it survives the
  // periodic re-render of both halves.
  (function wireStatsHighlight() {
    var v1 = document.getElementById('v1');
    if (!v1) return;
    function setHi(sci, on) {
      if (!sci) return;
      var esc = sci.replace(/"/g, '\"');
      v1.querySelectorAll('.stats-tl-col[data-sci="' + esc + '"], .stats-tl-mobile-row[data-sci="' + esc + '"], .stats-recent-row[data-sci="' + esc + '"], .stats-overnight-row[data-sci="' + esc + '"], .stats-season-row[data-sci="' + esc + '"], .stats-side li[data-sci="' + esc + '"]')
        .forEach(function (el) { el.classList.toggle('sync-hi', on); });
    }
    v1.addEventListener('mouseover', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-sci]');
      if (el) setHi(el.getAttribute('data-sci'), true);
    });
    v1.addEventListener('mouseout', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-sci]');
      if (el) {
        // Only clear if we're actually leaving the element (not moving
        // to a child).
        var to = ev.relatedTarget;
        if (to && el.contains(to)) return;
        setHi(el.getAttribute('data-sci'), false);
      }
    });
  })();

  // ---- Side text lists (real Pi data) ----
  function renderStatsLists() {
    var stats = DATA.stats || {};
    var recent = DATA.recent || { species: [] };
    var firstseen = DATA.firstseen || { species: [] };
    var seasonfirst = DATA.seasonfirst || { species: [] };

    // By Period - pulled directly from ./avian/api/birdnet-api.php?action=stats so the numbers
    // are authoritative (BirdNET-Pi's own counts).
    var last_hour = (stats.last_hour && stats.last_hour.detections) || 0;
    var today_det = (stats.today && stats.today.detections) || 0;
    var week_det = (stats.week && stats.week.detections) || 0;
    var all_det = (stats.totals && stats.totals.detections) || 0;
    document.getElementById('statsByPeriod').innerHTML =
        liRow('NOW',   'last hour',   fmtN(last_hour))
      + liRow('TODAY', 'today',       fmtN(today_det))
      + liRow('WEEK',  'last 7 days', fmtN(week_det))
      + liRow('ALL',   'all time',    fmtN(all_det));

    // Top Species - top 5 species in the current window. ./avian/api/birdnet-api.php?action=recent
    // already returns species sorted by last_seen DESC; re-sort by count.
    var ranked = (recent.species || [])
      .slice()
      .sort(function (a, b) { return (+b.n) - (+a.n); })
      .slice(0, 5);
    document.getElementById('statsTopSpec').innerHTML = ranked.length
      ? ranked.map(function (s, i) { return liRow(pad(i + 1), s.com, fmtN(+s.n), s.sci); }).join('')
      : liRow('-', 'no detections in window', '');
    document.getElementById('statsTopSpecCap').textContent =
      'most-heard, ' + windowLabel(currentHours);

    // First Detections - newest additions to the life list, with a
    // "Xd ago" label computed from first_seen.
    var fs = (firstseen.species || []).slice(0, 5);
    var now = Date.now();
    document.getElementById('statsFirstSeen').innerHTML = fs.length
      ? fs.map(function (s) {
          var t = parseSiteTs(s.first_seen);
          var label = '-';
          if (!isNaN(t)) {
            var daysAgo = Math.floor((now - t) / 86400000);
            label = daysAgo === 0 ? 'today' : daysAgo + 'd ago';
          }
          return liRow(label, s.com, '', s.sci);
        }).join('')
      : liRow('-', 'no detections yet', '');

    var sf = (seasonfirst.species || []).slice(0, 6);
    var sfEl = document.getElementById('statsSeasonFirst');
    var sfCap = document.getElementById('statsSeasonFirstCap');
    if (sfCap) sfCap.textContent = 'first heard since ' + seasonStartLabel();
    if (sfEl) {
      sfEl.innerHTML = sf.length
        ? sf.map(function (s) {
            var t = parseSiteTs(s.first_seen);
            var label = '-';
            if (!isNaN(t)) {
              var daysAgo = Math.floor((now - t) / 86400000);
              label = daysAgo === 0 ? 'today' : daysAgo + 'd ago';
            }
            return liRow(label, s.com, fmtN(+s.season_total || 0), s.sci);
          }).join('')
        : liRow('-', 'no season detections yet', '');
    }
  }

  // ---- Atlas: field-guide card grid ----
  // eBird species codes for placeholder birds. eBird's URL scheme is
  // https://ebird.org/species/<code>/, where <code> is a stable 6-char
  // taxonomy code. Hardcoded here for the local-California demo set;
  // a real implementation can look these up via the eBird taxon API.
  var EBIRD_CODES = {
    'Calypte anna':           'annhum',
    'Passer domesticus':      'houspa',
    'Haemorhous mexicanus':   'houfin',
    'Turdus migratorius':     'amerob',
    'Zenaida macroura':       'moudov',
    'Spinus psaltria':        'lesgol',
    'Zonotrichia leucophrys': 'whcspa',
    'Aphelocoma californica': 'cascj1',
    'Mimus polyglottos':      'normoc',
    'Sayornis nigricans':     'blkpho',
    'Larus occidentalis':     'wegull',
    'Corvus brachyrhynchos':  'amecro'
  };

  function wikiUrl(sci) {
    return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(sci.replace(/ /g, '_'));
  }
  function ebirdUrl(sci) {
    var code = EBIRD_CODES[sci];
    return code ? 'https://ebird.org/species/' + code : 'https://ebird.org/explore';
  }

  // Tiny inline icons - monochrome, ink-only, match the page palette.
  var ICON_PLAY = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3 2 L10 6 L3 10 Z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="2" width="2.5" height="8"/><rect x="6.5" y="2" width="2.5" height="8"/></svg>';
  var ICON_TRASH = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10"/><path d="M6.3 4.5V3.2h3.4v1.3"/><path d="M5 6.2l.4 6.1h5.2l.4-6.1"/><path d="M7.1 7.4v3.5"/><path d="M8.9 7.4v3.5"/></svg>';

  function renderAtlas() {
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;

    var lifelist = (DATA.lifelist && DATA.lifelist.species) || [];
    var recent = (DATA.recent && DATA.recent.species) || [];
    // Window count lookup: sci -> count in current window.
    var winBySci = {};
    recent.forEach(function (s) { winBySci[s.sci] = +s.n; });

    if (!lifelist.length) {
      grid.innerHTML = '<div class="atlas-empty">' +
        '<p>No birds detected yet.</p>' +
        '<p class="hint">The atlas fills up as BirdNET-Pi identifies new species.</p>' +
        '</div>';
      return;
    }

    // Time-window filter: when a windowed view is selected, only show
    // species heard in that window. ALL preserves the full lifelist.
    var isAllWindow = currentHours >= 1000000;
    var filtered = isAllWindow
      ? lifelist
      : lifelist.filter(function (s) { return (winBySci[s.sci] || 0) > 0; });
    if (!filtered.length) {
      grid.innerHTML = '<div class="atlas-empty">' +
        '<p>No detections in this window.</p>' +
        '<p class="hint">Try a longer time window - the lifelist is still here under ALL.</p>' +
        '</div>';
      return;
    }

    // Sort by the atlas-sort segmented control (defaults to "count" =
    // most-heard all time).
    var sortMode = (window.__atlasSort) || 'count';
    var species = filtered.slice();
    if (sortMode === 'count') {
      species.sort(function (a, b) { return speciesTotal(b) - speciesTotal(a); });
    } else if (sortMode === 'recent') {
      species.sort(function (a, b) {
        return (b.last_seen || '').localeCompare(a.last_seen || '');
      });
    } else if (sortMode === 'alpha') {
      species.sort(function (a, b) {
        return (a.com || a.sci || '').localeCompare(b.com || b.sci || '');
      });
    }

    grid.innerHTML = species.map(function (s) {
      var total = speciesTotal(s);
      var win = winBySci[s.sci] || 0;
      var publicAudio = publicMirror && s.public_audio;
      var audioVersion = publicAudio ? encodeURIComponent(publicAudio.key || publicAudio.last_seen || s.last_seen || '') : '';
      var lastSeen = (publicAudio && publicAudio.last_seen) || s.last_seen || '';
      var lastParts = lastSeen.split(' ');
      var lastHeard = lastSeen
        ? '<div class="last-heard">last heard ' + fmtDateLine(lastParts[0], lastParts[1]) + '</div>'
        : '';
      var sketchSrc = apiUrl('cutout.php?sci=' + encodeURIComponent(s.sci)) +
        (s.com ? '&com=' + encodeURIComponent(s.com) : '') +
        '&v=' + SKETCH_VERSION;
      var audioSrc = publicMirror
        ? (publicAudio ? apiUrl('recording.php?sci=' + encodeURIComponent(s.sci) + '&v=' + audioVersion) : '')
        : apiUrl('recording.php?sci=' + encodeURIComponent(s.sci));
      var spectroSrc = publicMirror ? '' : apiUrl('spectrogram.php?sci=' + encodeURIComponent(s.sci));
      var playChip = audioSrc ?
        '<button type="button" class="chip play" data-action="play" aria-label="play recording">'
          + ICON_PLAY + '<span>play</span>'
        + '</button>' : '';
      var ebirdBadge = renderEbirdCardBadge(s.sci);
      var rarity = rarityInfoForTotal(total);
      var rarityBadge = '<div class="atlas-rarity-badge" data-rarity="' + rarity.key + '" tabindex="0" title="' + rarityExplainer(rarity, total).replace(/"/g, '&quot;') + '">' + rarity.label + rarityLegendHtml() + '</div>';
      var seasonBadge = isSeasonFirstInWindow(s.sci) ? seasonFirstBadgeHtml(false) : '';
      // The "all time" window makes the windowed count identical to the
      // all-time count - collapse to a single stat rather than print the
      // same number twice. Otherwise label the count with its span.
      var statRows = currentHours >= 1000000
        ? '<div><span class="n">' + fmtN(total) + '</span><span class="lbl-inline">all time</span></div>'
        : '<div><span class="n">' + fmtN(win) + '</span><span class="lbl-inline">' + windowLabel(currentHours) + '</span></div>'
          + '<div><span class="n">' + fmtN(total) + '</span><span class="lbl-inline">all time</span></div>';
      return ''
        + '<article class="bird-card" data-sci="' + s.sci + '" data-audio="' + audioSrc + '" data-spectro="' + spectroSrc + '">'
        +   '<div class="stat">' + statRows + '</div>'
        +   '<div class="img-wrap">'
        +     '<img loading="lazy" decoding="async" src="' + sketchSrc + '" alt="' + s.com + '">'
        +   '</div>'
        +   '<div class="spectro-wrap" aria-hidden="true"></div>'
        +   '<div class="card-badge-row">' + rarityBadge + '</div>'
        +   '<div class="card-title-row"><div class="card-title-main">' + seasonBadge + '<h3>' + s.com + '</h3></div></div>'
        +   '<div class="sci">' + s.sci + '</div>'
        +   ebirdBadge
        +   lastHeard
        +   '<div class="actions">'
        +     playChip
        +     '<a class="chip ext" href="' + wikiUrl(s.sci) + '" target="_blank" rel="noopener" aria-label="Wikipedia">wiki</a>'
        +     '<a class="chip ext" href="' + ebirdUrl(s.sci) + '" target="_blank" rel="noopener" aria-label="eBird">ebird</a>'
        +   '</div>'
        + '</article>';
    }).join('');

    // Wire audio playback + spectrogram load.
    // - Only one card plays at a time. Clicking play on a different card
    //   stops the current one first.
    // - The spectrogram is lazily fetched on first play (saves a Pi hit
    //   for every card visible on initial render).
    // - If the recording endpoint 404s (no detection yet for this
    //   species), the button reverts and shows "no audio".
    var currentAudio = null;
    var currentBtn = null;
    function setBtnState(btn, state) {
      btn.setAttribute('data-state', state);
      if (state === 'playing') {
        btn.setAttribute('data-active', 'true');
        btn.innerHTML = ICON_PAUSE + '<span>stop</span>';
      } else if (state === 'loading') {
        btn.setAttribute('data-active', 'true');
        btn.innerHTML = ICON_PLAY + '<span>...</span>';
      } else if (state === 'missing') {
        btn.setAttribute('data-active', 'false');
        btn.innerHTML = ICON_PLAY + '<span>no audio</span>';
        setTimeout(function () {
          if (btn.getAttribute('data-state') === 'missing') {
            btn.innerHTML = ICON_PLAY + '<span>play</span>';
            btn.setAttribute('data-state', 'idle');
          }
        }, 2200);
      } else {
        btn.setAttribute('data-active', 'false');
        btn.innerHTML = ICON_PLAY + '<span>play</span>';
      }
    }
    function clearProgressOn(card) {
      if (!card) return;
      var sw = card.querySelector('.spectro-wrap');
      if (sw) sw.style.setProperty('--prog', '0%');
      card.removeAttribute('data-playing');
    }
    function stopCurrent() {
      if (currentAudio) {
        try { currentAudio.pause(); } catch (e) {}
        currentAudio = null;
      }
      if (currentBtn) {
        var card = currentBtn.closest('.bird-card');
        clearProgressOn(card);
        setBtnState(currentBtn, 'idle');
        currentBtn = null;
      }
    }
    grid.querySelectorAll('[data-action="play"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.bird-card');
        if (btn === currentBtn) { stopCurrent(); return; }
        stopCurrent();
        setBtnState(btn, 'loading');
        currentBtn = btn;
        // Kick off spectrogram load in parallel (it's a separate request).
        var spectroWrap = card.querySelector('.spectro-wrap');
        if (spectroWrap && card.dataset.spectro && !spectroWrap.firstChild) {
          var img = document.createElement('img');
          img.loading = 'lazy';
          img.alt = '';
          img.src = card.dataset.spectro;
          img.addEventListener('error', function () { spectroWrap.removeChild(img); });
          spectroWrap.appendChild(img);
        }
        if (!card.dataset.audio) {
          setBtnState(btn, 'missing');
          currentAudio = null; currentBtn = null;
          return;
        }
        // Start audio.
        var audio = new Audio(card.dataset.audio);
        audio.addEventListener('canplay', function () {
          if (currentBtn !== btn) return; // user clicked away
          setBtnState(btn, 'playing');
          card.setAttribute('data-playing', 'true');
          audio.play();
        });
        // Progress bar on the spectrogram strip.
        audio.addEventListener('timeupdate', function () {
          if (currentBtn !== btn) return;
          var pct = audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
          if (spectroWrap) spectroWrap.style.setProperty('--prog', pct.toFixed(1) + '%');
        });
        audio.addEventListener('ended', function () {
          if (currentBtn === btn) stopCurrent();
        });
        audio.addEventListener('error', function () {
          if (currentBtn === btn) {
            setBtnState(btn, 'missing');
            clearProgressOn(card);
            currentAudio = null; currentBtn = null;
          }
        });
        currentAudio = audio;
        audio.load();
      });
    });

    // Spectrogram click = scrub to that position (if playing) or restart.
    grid.addEventListener('click', function (ev) {
      var sw = ev.target.closest && ev.target.closest('.spectro-wrap');
      if (!sw || !sw.firstChild) return;
      var card = sw.closest('.bird-card');
      var btn = card.querySelector('[data-action="play"]');
      if (!btn) return;
      // If this card is the active one, scrub.
      if (currentBtn === btn && currentAudio && currentAudio.duration) {
        var rect = sw.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        currentAudio.currentTime = pct * currentAudio.duration;
      } else {
        // Otherwise start playback from the top.
        btn.click();
      }
    });
  }

  function renderWindowDependent() {
    // Things that change with the time-window picker. drawHistograms is
    // here too now that its X-axis spans the selected window (was only
    // re-drawn on full refreshAll before).
    renderCollageFromData();
    drawHistograms();
    renderStatsLists();
    renderAtlas();
  }
  function renderTimeIndependent() {
    // Stats charts + atlas/stats lists that derive from non-window data
    // (totals, lifelist, timeseries).
    drawHistograms();
    renderStatsLists();
    renderAtlas();
  }

  function refreshRecent() {
    // Capture the window this fetch was issued for. If the user
    // changes the picker again before it resolves - or a slower poll
    // lands later - we discard the stale response so the collage
    // never reverts to a different window.
    var forHours = currentHours;
    var nightCollageHours = 168;
    return Promise.all([
      fetchJson(apiUrl('birdnet-api.php?action=recent&hours=' + forHours)).catch(function () { return null; }),
      fetchJson(nightApiUrl(forHours, 6)).catch(function () { return null; }),
      fetchJson(nightApiUrl(nightCollageHours, 6)).catch(function () { return null; }),
      fetchJson(apiUrl('birdfy-api.php?action=visual_summary&hours=' + forHours)).catch(function () { return null; }),
    ]).then(function (parts) {
        if (forHours !== currentHours) return; // window changed mid-flight
        if (parts[0]) DATA.recent = parts[0];
        applyNightWindowFromResponse(parts[1] || parts[2]);
        DATA.overnight = parts[1] || { species: [], hours: forHours, as_of: Date.now(), error: true };
        DATA.nightCollage = parts[2] || DATA.overnight;
        DATA.visual = parts[3] || DATA.visual;
        renderWindowDependent();
      })
      .catch(function (e) { console.warn('recent fetch failed', e); });
  }
  function refreshEbirdNearby() {
    return fetchCachedData('ebirdNearby', apiUrl('birdnet-api.php?action=ebird_nearby&dist=25&back=14'), EBIRD_NEARBY_TTL_MS)
      .then(function (j) {
        DATA.ebirdNearby = j;
        renderAtlas();
        refreshOpenModalEbirdNearby();
        return j;
      })
      .catch(function (e) { console.warn('eBird nearby fetch failed', e); return null; });
  }

  function refreshAll() {
    var forHours = currentHours;
    var nightCollageHours = 168;
    return Promise.all([
      fetchJson(apiUrl('birdnet-api.php?action=stats')).catch(function () { return null; }),
      fetchCachedData('lifelist', apiUrl('birdnet-api.php?action=lifelist'), SLOW_DATA_TTL_MS).catch(function () { return null; }),
      fetchCachedData('timeseries', apiUrl('birdnet-api.php?action=timeseries&days=30'), SLOW_DATA_TTL_MS).catch(function () { return null; }),
      fetchCachedData('seasonality', apiUrl('birdnet-api.php?action=seasonality&limit=80'), SLOW_DATA_TTL_MS).catch(function () { return null; }),
      fetchCachedData('firstseen', apiUrl('birdnet-api.php?action=firstseen&limit=10'), SLOW_DATA_TTL_MS).catch(function () { return null; }),
      fetchCachedData('seasonfirst', apiUrl('birdnet-api.php?action=seasonfirst&limit=100'), SLOW_DATA_TTL_MS).catch(function () { return null; }),
      fetchJson(apiUrl('birdnet-api.php?action=recent&hours=' + forHours)).catch(function () { return null; }),
      fetchJson(nightApiUrl(forHours, 6)).catch(function () { return null; }),
      fetchJson(nightApiUrl(nightCollageHours, 6)).catch(function () { return null; }),
      fetchJson(apiUrl('birdfy-api.php?action=visual_summary&hours=' + forHours)).catch(function () { return null; }),
    ]).then(function (parts) {
      DATA.stats = parts[0];
      DATA.lifelist = parts[1];
      DATA.timeseries = parts[2];
      DATA.seasonality = parts[3];
      DATA.firstseen = parts[4];
      DATA.seasonfirst = parts[5];
      // Only accept the recent slice if the window hasn't changed
      // since this poll started - otherwise keep what's there.
      if (forHours === currentHours && parts[6]) DATA.recent = parts[6];
      applyNightWindowFromResponse(parts[7] || parts[8]);
      if (forHours === currentHours) DATA.overnight = parts[7] || { species: [], hours: forHours, as_of: Date.now(), error: true };
      DATA.nightCollage = parts[8] || DATA.overnight;
      if (forHours === currentHours) DATA.visual = parts[9] || DATA.visual;
      recomputeDerived();
      renderTimeIndependent();
      renderCollageFromData();
      refreshEbirdNearby();
    });
  }

  // Kick off the initial fetch. Renders pull from DATA as soon as it
  // populates; until then the page sits with empty histograms + lists.
  refreshAll();

  function setDisplayRefreshSeconds(seconds) {
    var n = Math.max(5, Math.min(300, Math.round(+seconds || 30)));
    pollMs = n * 1000;
    if (pollTimer && !document.hidden) startPolling();
  }

  function loadDisplayRefreshSetting() {
    fetch(apiUrl('config.php'), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (cfg) {
        var v = cfg.values || {};
        setDisplayRefreshSeconds(v.AV_DISPLAY_REFRESH_SECONDS || 30);
      })
      .catch(function () {});
  }

  // Hook into the window picker so the data refetches on change.
  winBtns.forEach(function (b) {
    b.addEventListener('click', function () { refreshRecent(); });
  });

  // ---- Realtime polling ----
  // Every pollMs the page refetches the live data set so the collage,
  // stats, and atlas reflect new detections without a manual reload.
  // We use refreshAll() (cheap: 5 small JSON fetches) so the dependent
  // text/charts update too. Polling pauses when the tab is hidden and
  // resumes (with an immediate fetch) when it becomes visible again.
  var pollMs = 30 * 1000;
  var pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      refreshAll();
    }, pollMs);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopPolling();
    } else {
      // Force an immediate refresh on return so the user sees fresh
      // data right away, then resume normal polling cadence.
      refreshAll();
      startPolling();
    }
  });
  loadDisplayRefreshSetting();
  startPolling();

  // ---- Menu dropdown ----
  var dd = document.getElementById('menu-dd');
  var menuBtn = document.getElementById('menuBtn');
  var locked  = document.getElementById('dd-locked');
  var items   = document.getElementById('dd-items');
  var lockHint= document.getElementById('lockHint');
  function openDd()  { dd.classList.add('open'); dd.setAttribute('aria-hidden','false'); setTimeout(function () { document.getElementById('lockPass').focus(); }, 100); }
  function closeDd() { dd.classList.remove('open'); dd.setAttribute('aria-hidden','true'); }
  function toggleDd(){ dd.classList.contains('open') ? closeDd() : openDd(); }
  if (!publicMirror && dd && menuBtn) {
    menuBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleDd(); });
    document.addEventListener('click', function (e) { if (!dd.contains(e.target) && e.target !== menuBtn) closeDd(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDd(); });
  }

  // Probe menu.php with no Authorization header. On a LAN deploy
  // (AV_REQUIRE_AUTH=0) it returns 200 immediately so the drawer
  // renders directly. On a forwarded deploy with Caddy basic_auth in
  // front, Caddy will already have validated credentials before this
  // request reaches PHP - so a 200 here means we're authed, a 401
  // means Caddy rejected and we need the lock-screen flow.
  function tryAutoUnlock() {
    if (publicMirror || !dd || !items) return;
    fetch(apiUrl('menu.php'), { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 200) {
        return r.json().then(function (j) { renderMenu(j.items || []); });
      }
    }).catch(function () {});
  }
  tryAutoUnlock();

  var unlockForm = document.getElementById('unlockForm');
  if (unlockForm) unlockForm.addEventListener('submit', function (e) {
    e.preventDefault();
    // BirdNET-Pi's upstream Caddyfile basicauth user is `birdnet`.
    // If your install changed it (custom Caddyfile), set window.AV_AUTH_USER
    // before this script loads - e.g. an inline <script> in index.html.
    var u = (window.AV_AUTH_USER || 'birdnet');
    var p = document.getElementById('lockPass').value;
    var hdr = 'Basic ' + btoa(u + ':' + p);
    // POST to menu.php with the header so the browser caches the basic
    // creds for every subsequent request. If Caddy basic_auth accepts
    // them we get a 200 and the drawer renders; 401 means wrong password.
    fetch(apiUrl('menu.php'), {
      method: 'POST',
      headers: { 'Authorization': hdr },
      credentials: 'same-origin',
    }).then(function (r) {
      if (r.status === 200) {
        return r.json().then(function (j) { renderMenu(j.items || []); });
      } else if (r.status === 401) {
        lockHint.textContent = 'wrong password.';
        lockHint.classList.add('lock-err');
      } else {
        lockHint.textContent = 'auth unavailable.';
        lockHint.classList.add('lock-err');
      }
    }).catch(function () {
      lockHint.textContent = 'network error.';
      lockHint.classList.add('lock-err');
    });
  });

  // Render the unlocked drawer:
  //   - inline LIVE AUDIO player (streams icecast through the worker tunnel)
  //   - collapsible SETTINGS section (closed by default to avoid mis-clicks)
  //   - small ADVANCED TOOLS grid for the rest of BirdNET-Pi (still
  //     opens externally; rebuilding all of these in our design is on
  //     the follow-up list)
  function renderMenu(menu) {
    locked.style.display = 'none';
    items.classList.add('show');
    var liveAudioIcon = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3 2 L10 6 L3 10 Z"/></svg>';
    var stopIcon = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="3" width="6" height="6"/></svg>';
    var specOnIcon = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 9 L4 5 L6 8 L8 3 L10 7"/></svg>';
    // Build the diagnostic shortcuts (system / logs / tools). With
    // native:true they navigate in-page; otherwise they keep the old
    // open-in-new-tab behavior for the legacy BirdNET-Pi screens.
    var linksHtml = menu.map(function (it) {
      var label = (it.label || '');
      var attrs = it.native ? '' : ' target="_blank" rel="noopener"';
      var cls = it.native ? '' : ' class="ext"';
      return '<a' + cls + ' href="' + it.href + '"' + attrs + '><span>' + label + '</span></a>';
    }).join('');
    items.innerHTML =
      '<div class="live-audio" id="liveAudio" data-on="false">'
      + '  <div class="pulse"></div>'
      + '  <div class="label">Live audio<span class="hint">stream from the mic</span></div>'
      + '  <button type="button" id="liveAudioBtn">'
      +     liveAudioIcon + '<span>listen</span>'
      + '  </button>'
      + '</div>'
      // Spectrogram canvas is always present; it stays a dark inert
      // strip until the stream is on, then the FFT loop paints it in
      // real time. No separate toggle.
      + '<canvas class="live-spectro" id="liveSpectro" width="600" height="120" aria-label="live spectrogram"></canvas>'
      + '<div class="live-status" id="liveStatus"></div>'
      + '<div class="menu-links">' + linksHtml + '</div>';

    // Live audio + realtime spectrogram. The audio element and the
    // FFT analyser share one AudioContext; once .play() is called the
    // analyser starts painting the canvas via rAF. No timeout - we
    // surface the natural error event or success ("playing") only.
    var liveBox = document.getElementById('liveAudio');
    var liveBtn = document.getElementById('liveAudioBtn');
    var spectroEl = document.getElementById('liveSpectro');
    var statusEl = document.getElementById('liveStatus');
    var liveEl = null, audioCtx = null, srcNode = null, analyser = null;
    var specRaf = null;

    function setStatus(msg, isErr) {
      statusEl.textContent = msg || '';
      statusEl.className = 'live-status' + (isErr ? ' err' : '');
    }
    function startAudio() {
      // Create the Audio element and resolve on the first "playing"
      // event (success). The browser will hang the network request
      // open for an icecast stream - that's normal - and "playing"
      // fires as soon as the first audio frame is decoded. We don't
      // race a timeout because icecast can take 1-10s to warm up
      // depending on tunnel + bitrate.
      return new Promise(function (resolve, reject) {
        liveEl = new Audio('/stream?t=' + Date.now());
        // No crossOrigin - the stream is same-origin via the worker
        // and crossOrigin='anonymous' would require CORS headers
        // icecast doesn't send.
        var settled = false;
        liveEl.addEventListener('playing', function () {
          if (settled) return;
          settled = true; resolve();
        });
        liveEl.addEventListener('error', function () {
          if (settled) return;
          settled = true;
          reject(new Error('stream error - check /#admin=system'));
        });
        liveEl.play().catch(function (e) {
          if (settled) return;
          settled = true; reject(e);
        });
      });
    }
    function stopAudio() {
      if (specRaf) { cancelAnimationFrame(specRaf); specRaf = null; }
      if (liveEl) { try { liveEl.pause(); } catch (e) {} liveEl.src = ''; liveEl = null; }
      if (srcNode) { try { srcNode.disconnect(); } catch (e) {} srcNode = null; }
      if (analyser) { try { analyser.disconnect(); } catch (e) {} analyser = null; }
      liveBox.setAttribute('data-on', 'false');
      liveBtn.innerHTML = liveAudioIcon + '<span>listen</span>';
      // Clear the spectrogram canvas so it returns to its quiet state.
      var ctx = spectroEl.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--paper-2').trim() || '#efe8d8';
      ctx.fillRect(0, 0, spectroEl.width, spectroEl.height);
    }
    function attachSpectrogram() {
      if (!liveEl) return;
      if (!audioCtx) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      try {
        srcNode = audioCtx.createMediaElementSource(liveEl);
      } catch (e) {
        // MediaElementSource throws if the Audio is already wired up
        // (e.g. user toggled listen off then on). Best effort - let
        // the audio still play, just skip the spectrogram.
        return;
      }
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      srcNode.connect(analyser);
      analyser.connect(audioCtx.destination);
      drawSpectrogram();
    }
    function drawSpectrogram() {
      var ctx = spectroEl.getContext('2d');
      var W = spectroEl.width, H = spectroEl.height;
      // Read palette tokens for ink + paper so the live spectrogram
      // visually matches the recording-row spectrograms.
      var cs = getComputedStyle(document.documentElement);
      var paper = cs.getPropertyValue('--paper-2').trim() || '#efe8d8';
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, W, H);
      var bins = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        if (!analyser) return;
        var img = ctx.getImageData(1, 0, W - 1, H);
        ctx.putImageData(img, 0, 0);
        ctx.clearRect(W - 1, 0, 1, H);
        analyser.getByteFrequencyData(bins);
        var n = bins.length;
        var lo = Math.floor(n * 250 / 24000);
        var hi = Math.floor(n * 12000 / 24000);
        for (var y = 0; y < H; y++) {
          var t = 1 - y / H;
          var idx = Math.round(lo + (hi - lo) * Math.pow(t, 1.6));
          var v = (bins[idx] || 0) / 255;
          var e = v * v * (3 - 2 * v);
          // Paper (245,240,230) -> ink (26,22,18) ramp.
          var r = 245 + Math.round((26 - 245) * e);
          var g = 240 + Math.round((22 - 240) * e);
          var b = 230 + Math.round((18 - 230) * e);
          ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
          ctx.fillRect(W - 1, y, 1, 1);
        }
        specRaf = requestAnimationFrame(tick);
      }
      tick();
    }

    // Paint the spectrogram in its quiet/initial state.
    (function () {
      var ctx = spectroEl.getContext('2d');
      var paper = getComputedStyle(document.documentElement)
        .getPropertyValue('--paper-2').trim() || '#efe8d8';
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, spectroEl.width, spectroEl.height);
    })();

    liveBtn.addEventListener('click', function (ev) {
      // Important: stop the click from propagating up to the
      // document-level "click outside drawer" handler, which would
      // close the dropdown.
      ev.stopPropagation();
      var on = liveBox.getAttribute('data-on') === 'true';
      if (on) { setStatus(''); stopAudio(); return; }
      liveBox.setAttribute('data-on', 'true');
      liveBtn.innerHTML = stopIcon + '<span>stop</span>';
      setStatus('connecting...');
      startAudio()
        .then(function () { setStatus('streaming from pi'); attachSpectrogram(); })
        .catch(function (err) {
          stopAudio();
          var msg = (err && err.message) || 'stream unavailable';
          if (msg.indexOf('NotAllowed') !== -1 || msg.indexOf('user') !== -1) {
            setStatus('browser blocked autoplay - tap listen again', true);
          } else {
            setStatus(msg, true);
          }
        });
    });
  }

  // Pending changes (key -> value), saved on click of the Save button.
  var pending = {};

  function setSaveState(msg, cls) {
    var el = document.getElementById('saveState');
    if (el) { el.textContent = msg || ''; el.className = 'save-state' + (cls ? ' ' + cls : ''); }
    var btn = document.getElementById('saveBtn');
    if (btn) btn.disabled = Object.keys(pending).length === 0;
  }

  function loadSettings() {
    fetch(apiUrl('config.php'), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (cfg) {
        var v = cfg.values || {};
        var preserve = cfg.preserve;
        setNightHours(v.AV_NIGHT_START, v.AV_NIGHT_END);
        var html = ''
          + settingsToggle('preserve', 'Preserve all recordings', "don't auto-delete", preserve)
          + settingsSlider('CONFIDENCE',  'Confidence threshold', 'min score to log a detection', v.CONFIDENCE,  0.1, 0.95, 0.05, 2)
          + settingsSlider('SENSITIVITY', 'Sensitivity',          'analyzer sensitivity',          v.SENSITIVITY, 0.5, 1.5,  0.05, 2)
          + settingsSlider('OVERLAP',     'Chunk overlap',        'seconds analyzed per pass',     v.OVERLAP,     0,   2.5,  0.1,  1)
          + settingsToggle('AV_AUDIO_FILTER', 'Bird audio filter', 'band-pass mic audio before analysis', +v.AV_AUDIO_FILTER === 1, 'experimental')
          + settingsSlider('AV_FILTER_HIGHPASS', 'High-pass cutoff', 'reduces HVAC and low rumble, Hz', v.AV_FILTER_HIGHPASS, 20, 3000, 20, 0)
          + settingsSlider('AV_FILTER_LOWPASS',  'Low-pass cutoff',  'reduces high hiss, Hz',           v.AV_FILTER_LOWPASS, 1000, 20000, 100, 0)
          + settingsToggle('BIRDFY_ENABLED', 'Birdfy camera import', 'mark camera-seen birds on the collage', +v.BIRDFY_ENABLED === 1, 'experimental')
          + settingsSecret('BIRDFY_EMAIL', 'Birdfy email', 'stored locally; never shown after save', v.BIRDFY_EMAIL)
          + settingsSecret('BIRDFY_PASSWORD', 'Birdfy password', 'stored locally; never shown after save', v.BIRDFY_PASSWORD)
          + settingsSlider('BIRDFY_IMPORT_WINDOW_HOURS', 'Birdfy import window', 'hours of camera detections to check', v.BIRDFY_IMPORT_WINDOW_HOURS || 24, 1, 168, 1, 0)
          + settingsSlider('AV_DISPLAY_REFRESH_SECONDS', 'Display refresh', 'seconds between automatic UI updates', v.AV_DISPLAY_REFRESH_SECONDS || 30, 5, 300, 5, 0)
          + settingsHourSelect('AV_NIGHT_START', 'Night starts', 'used by moon reveal and Night Visitors', v.AV_NIGHT_START)
          + settingsHourSelect('AV_NIGHT_END',   'Night ends',   'calls before this hour count as night', v.AV_NIGHT_END)
          + settingsSegmented('FULL_DISK', 'When disk fills', '', v.FULL_DISK, [
              { v: 'keep',  label: 'keep' },
              { v: 'purge', label: 'purge' },
            ])
          + settingsSecret('EBIRD_API_KEY', 'eBird API key', 'used for nearby reports; never shown after save', v.EBIRD_API_KEY)
          + '<div class="menu-save-row">'
          + '  <span class="save-state" id="saveState"></span>'
          + '  <button type="button" id="saveBtn" disabled>save</button>'
          + '</div>';
        var body = document.getElementById('settingsBody');
        if (body) body.innerHTML = html;
        wireSettingsControls();
        var saveBtn = document.getElementById('saveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveSettings);
      })
      .catch(function (err) {
        var body = document.getElementById('settingsBody');
        if (body) body.innerHTML =
          '<div class="menu-row"><span class="label">Failed to load <small class="hint">' + err + '</small></span></div>';
      });
  }

  function settingsToggle(key, label, hint, on, tag) {
    var rowClass = key === 'AV_AUDIO_FILTER' ? ' menu-row-compact' : '';
    return ''
      + '<div class="menu-row' + rowClass + '">'
      + '  <div><span class="label">' + label + '</span>'
      +     (tag ? '<span class="setting-tag">' + tag + '</span>' : '')
      +     (hint ? '<span class="hint">' + hint + '</span>' : '')
      + '  </div>'
      + '  <button type="button" class="switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" data-key="' + key + '"></button>'
      + '</div>';
  }
  function settingsSlider(key, label, hint, val, min, max, step, digits) {
    return ''
      + '<div class="slider-row">'
      + '  <div class="head">'
      + '    <div class="label-block">'
      + '      <span class="label">' + label + '</span>'
      +       (hint ? '<span class="hint">' + hint + '</span>' : '')
      + '    </div>'
      + '    <span class="value" data-value-for="' + key + '">' + (+val).toFixed(digits) + '</span>'
      + '  </div>'
      + '  <div class="slider-track">'
      + '    <input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" data-key="' + key + '" data-digits="' + digits + '">'
      + '  </div>'
      + '</div>';
  }
  function settingsSecret(key, label, hint, state) {
    state = state || {};
    var configured = !!state.configured;
    var masked = state.masked || '';
    var emptyPlaceholder = key === 'EBIRD_API_KEY' ? 'paste eBird API key' : 'enter value';
    return ''
      + '<div class="secret-row" data-secret-key="' + key + '">'
      + '  <div class="head">'
      + '    <div class="label-block"><span class="label">' + label + '</span>'
      +       (hint ? '<span class="hint">' + hint + '</span>' : '')
      + '    </div>'
      + '    <span class="secret-state" data-secret-state="' + (configured ? 'set' : 'empty') + '">' + (configured ? ('configured ' + masked) : 'not set') + '</span>'
      + '  </div>'
      + '  <div class="secret-control">'
      + '    <input type="password" autocomplete="off" spellcheck="false" placeholder="' + (configured ? 'enter a new value to replace' : emptyPlaceholder) + '" data-key="' + key + '">'
      + '    <button type="button" data-secret-clear="' + key + '">clear</button>'
      + '  </div>'
      + '</div>';
  }

  function settingsHourSelect(key, label, hint, val) {
    val = clampHour(val, key === 'AV_NIGHT_START' ? 21 : 5);
    var opts = [];
    for (var h = 0; h < 24; h += 1) {
      opts.push('<option value="' + h + '"' + (h === val ? ' selected' : '') + '>' + hourLabel(h) + '</option>');
    }
    return ''
      + '<div class="menu-row hour-row">'
      + '  <div><span class="label">' + label + '</span>'
      +     (hint ? '<span class="hint">' + hint + '</span>' : '')
      + '  </div>'
      + '  <select class="hour-select" data-key="' + key + '">' + opts.join('') + '</select>'
      + '</div>';
  }

  function settingsSegmented(key, label, hint, val, opts) {
    var btns = opts.map(function (o) {
      return '<button type="button" data-v="' + o.v + '" aria-current="' + (o.v === val ? 'true' : 'false') + '">' + o.label + '</button>';
    }).join('');
    return ''
      + '<div class="menu-row">'
      + '  <div><span class="label">' + label + '</span>'
      +     (hint ? '<span class="hint">' + hint + '</span>' : '')
      + '  </div>'
      + '  <div class="seg" data-key="' + key + '">' + btns + '</div>'
      + '</div>';
  }
  function wireSettingsControls(scope) {
    scope = scope || document;
    scope.querySelectorAll('.switch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        var on = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
        pending[sw.dataset.key] = on;
        setSaveState('change pending');
      });
    });
    scope.querySelectorAll('input[type="range"]').forEach(function (sl) {
      sl.addEventListener('input', function () {
        var v = +sl.value;
        var digits = +sl.dataset.digits || 2;
        var label = scope.querySelector('[data-value-for="' + sl.dataset.key + '"]');
        if (label) label.textContent = v.toFixed(digits);
        pending[sl.dataset.key] = v;
        setSaveState('change pending');
      });
    });
    scope.querySelectorAll('.secret-control input').forEach(function (input) {
      input.addEventListener('input', function () {
        var v = input.value.trim();
        if (v) {
          pending[input.dataset.key] = v;
          setSaveState('change pending');
        } else if (pending[input.dataset.key] !== '') {
          delete pending[input.dataset.key];
          setSaveState(Object.keys(pending).length ? 'change pending' : '');
        }
      });
    });
    scope.querySelectorAll('[data-secret-clear]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.secretClear;
        var row = btn.closest('.secret-row');
        var input = row ? row.querySelector('input') : null;
        if (input) input.value = '';
        pending[key] = '';
        setSaveState('change pending');
      });
    });
    scope.querySelectorAll('select.hour-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        pending[sel.dataset.key] = clampHour(sel.value, sel.dataset.key === 'AV_NIGHT_START' ? 21 : 5);
        setSaveState('change pending');
      });
    });
    scope.querySelectorAll('.seg').forEach(function (seg) {
      seg.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
          pending[seg.dataset.key] = b.dataset.v;
          setSaveState('change pending');
        });
      });
    });
  }

  function saveSettings() {
    if (Object.keys(pending).length === 0) return;
    var nightChanged = Object.prototype.hasOwnProperty.call(pending, 'AV_NIGHT_START') || Object.prototype.hasOwnProperty.call(pending, 'AV_NIGHT_END');
    var refreshChanged = Object.prototype.hasOwnProperty.call(pending, 'AV_DISPLAY_REFRESH_SECONDS');
    var nextNightStart = Object.prototype.hasOwnProperty.call(pending, 'AV_NIGHT_START') ? pending.AV_NIGHT_START : nightStartHour;
    var nextNightEnd = Object.prototype.hasOwnProperty.call(pending, 'AV_NIGHT_END') ? pending.AV_NIGHT_END : nightEndHour;
    var nextRefreshSeconds = refreshChanged ? pending.AV_DISPLAY_REFRESH_SECONDS : null;
    var body = JSON.stringify(pending);
    setSaveState('saving...');
    fetch(apiUrl('config.php'), {
      method: 'POST', body: body,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) {
          if (nightChanged) {
            setNightHours(nextNightStart, nextNightEnd);
            DATA.overnight = null;
            DATA.nightCollage = null;
            refreshRecent();
          }
          if (refreshChanged) setDisplayRefreshSeconds(nextRefreshSeconds);
          pending = {};
          setSaveState('saved ✓', 'ok');
          if (document.body.classList.contains('admin-on') && adminSect === 'settings') {
            setTimeout(renderAdminSettings, 400);
          } else {
            setTimeout(loadSettings, 400);
          }
          setTimeout(function () { setSaveState(''); }, 1800);
        } else {
          setSaveState('save failed', 'err');
        }
      })
      .catch(function () { setSaveState('network error', 'err'); });
  }

  // ---- Hash routing + atlas detail modal ----
  // When a collage tile or stats row is clicked it sets
  // location.hash = '#sci=<name>'. On arrival we switch to the atlas
  // view, highlight the matching card, AND open the detail modal with
  // expanded info (Wikipedia summary, taxonomy, all past recordings).
  function readHash() {
    var m = location.hash.match(/^#sci=([^&]+)/);
    if (!m) return null;
    return decodeURIComponent(m[1]);
  }
  function highlightAtlas(sci) {
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;
    grid.querySelectorAll('.bird-card[data-active="true"]').forEach(function (c) {
      c.removeAttribute('data-active');
    });
    if (!sci) return;
    var attempts = 0;
    (function find() {
      var card = grid.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]');
      if (!card) {
        if (attempts++ < 10) return setTimeout(find, 80);
        return;
      }
      card.setAttribute('data-active', 'true');
      card.setAttribute('data-pulse', 'true');
      setTimeout(function () { card.removeAttribute('data-pulse'); }, 520);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    })();
  }

  // ---- Detail modal ----
  // Caches per-sci species info so opening the same modal twice doesn't
  // re-fetch. Wikipedia + per-species endpoints are slow over the
  // tunnel; one fetch per session is plenty.
  var SPECIES_CACHE = {};
  var WIKI_CACHE = {};
  var modalAudio = null;
  var modalRecBtn = null;
  function fmtRecTime(d, t) {
    // d="2026-05-15", t="20:25:29"
    if (!d) return '-';
    var ms = parseSiteTs((d || '') + ' ' + (t || '00:00:00'));
    if (isNaN(ms)) return d + ' ' + (t || '');
    return fmtSiteTime(ms, { second: '2-digit' });
  }
  function fmtDateLine(d, t, opts) {
    if (!d) return '';
    try {
      var ms = parseSiteTs(d + ' ' + (t || '00:00:00'));
      var timeOpts = opts && opts.seconds ? { second: '2-digit' } : null;
      return fmtSiteDate(ms) + ' · ' + fmtSiteTime(ms, timeOpts) + ' ' + SITE_TIME_LABEL;
    } catch (e) { return d + ' ' + (t || ''); }
  }
  function totalDetectionCount() {
    return +((DATA.stats && DATA.stats.totals && DATA.stats.totals.detections) || 0);
  }
  function rarityInfoForTotal(total) {
    total = +total || 0;
    if (!total) return { key: 'unknown', label: '-', share: 0 };
    var all = Math.max(1, totalDetectionCount());
    var share = total / all;
    if (total <= 1 || share < 0.001) return { key: 'epic', label: 'Epic', share: share };
    if (total <= 3 || share < 0.005) return { key: 'rare', label: 'Rare', share: share };
    if (share < 0.02) return { key: 'uncommon', label: 'Uncommon', share: share };
    return { key: 'pedestrian', label: 'Pedestrian', share: share };
  }
  function rarityInfoForSci(sci, fallbackTotal) {
    var total = speciesTotals[sci];
    if (total == null) total = +fallbackTotal || 0;
    return rarityInfoForTotal(total);
  }
  function rarityExplainer(info, total) {
    if (!info || info.key === 'unknown') return 'No detections yet.';
    var pct = Math.max(0.01, info.share * 100).toFixed(info.share < 0.01 ? 2 : 1);
    return fmtN(total) + ' all-time calls · ' + pct + '% of your detections';
  }
  function rarityLegendHtml() {
    return '<span class="rarity-legend" role="tooltip" aria-hidden="true">'
      + '<span class="legend-title">rarity guide</span>'
      + '<span class="legend-row" data-rarity="epic"><b>Epic</b><em>1 call or under 0.1%</em></span>'
      + '<span class="legend-row" data-rarity="rare"><b>Rare</b><em>2-3 calls or under 0.5%</em></span>'
      + '<span class="legend-row" data-rarity="uncommon"><b>Uncommon</b><em>under 2%</em></span>'
      + '<span class="legend-row" data-rarity="pedestrian"><b>Pedestrian</b><em>frequent visitor</em></span>'
      + '</span>';
  }
  function localIsoDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function backfillSpeciesDays(profile, dets) {
    var days = Math.max(1, Math.min(60, +(profile && profile.days) || 30));
    var byDate = {};
    ((profile && profile.dates) || []).forEach(function (r) { byDate[r.date] = +r.n || 0; });
    if (!Object.keys(byDate).length) {
      (dets || []).forEach(function (d) {
        if (!d.d) return;
        byDate[d.d] = (byDate[d.d] || 0) + 1;
      });
    }
    var out = [];
    var today = new Date();
    for (var i = days - 1; i >= 0; i -= 1) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      var key = localIsoDate(d);
      out.push({ date: key, n: byDate[key] || 0 });
    }
    return out;
  }
  function renderDetectionCalendar(profile, dets) {
    var box = document.getElementById('modalDetectionCalendar');
    if (!box) return;
    var rows = backfillSpeciesDays(profile, dets || []);
    var maxN = rows.reduce(function (m, r) { return Math.max(m, r.n); }, 0);
    var active = rows.filter(function (r) { return r.n > 0; }).length;
    if (!maxN) {
      box.setAttribute('data-empty', 'true');
      box.innerHTML = '<div class="detect-calendar-copy"><span class="k">detection calendar</span><strong>No recent calls</strong><span class="v">No detections in the last ' + rows.length + ' days.</span></div>';
      return;
    }
    box.removeAttribute('data-empty');
    var bars = rows.map(function (r) {
      var lvl = r.n > 0 ? Math.max(1, Math.ceil((r.n / maxN) * 5)) : 0;
      return '<i data-level="' + lvl + '" title="' + r.date + ': ' + fmtN(r.n) + ' calls"></i>';
    }).join('');
    box.innerHTML = ''
      + '<div class="detect-calendar-copy"><span class="k">detection calendar</span><strong>' + active + ' of ' + rows.length + ' days</strong><span class="v">last 30 days · darkest bars are busiest</span></div>'
      + '<div class="detect-calendar-bars" aria-hidden="true">' + bars + '</div>';
  }

  // rAF-driven cursor smoothing. timeupdate fires ~4Hz which feels
  // janky; we sample audio.currentTime every animation frame and
  // interpolate to a 60Hz update so the playback knob glides.
  var modalCursorRaf = null;
  function startCursorLoop() {
    if (modalCursorRaf) return;
    var tick = function () {
      if (!modalAudio || !modalRecBtn) { modalCursorRaf = null; return; }
      var row = modalRecBtn.closest('.rec-row');
      if (row && modalAudio.duration) {
        var strip = row.querySelector('.rec-spectro');
        var played = strip && strip.querySelector('.rec-spectro-played');
        var cursor = strip && strip.querySelector('.rec-spectro-cursor');
        var pct = (modalAudio.currentTime / modalAudio.duration) * 100;
        if (played) played.style.width = pct.toFixed(3) + '%';
        if (cursor) cursor.style.left = pct.toFixed(3) + '%';
      }
      modalCursorRaf = requestAnimationFrame(tick);
    };
    modalCursorRaf = requestAnimationFrame(tick);
  }
  function stopCursorLoop() {
    if (modalCursorRaf) { cancelAnimationFrame(modalCursorRaf); modalCursorRaf = null; }
  }

  // Pause the currently-playing modal recording but KEEP the audio
  // element alive so the user can scrub (audio.currentTime is still
  // mutable on a paused element) and then resume from the same spot.
  // The cursor stays visible at its last position.
  function pauseModalAudio() {
    stopCursorLoop();
    if (modalAudio) { try { modalAudio.pause(); } catch (e) {} }
    if (modalRecBtn) {
      modalRecBtn.removeAttribute('data-active');
      modalRecBtn.innerHTML = ICON_PLAY;
    }
  }
  // Hard-stop: pause + tear down the audio + clear cursor. Used when
  // switching rows or closing the modal.
  function stopModalAudio() {
    stopCursorLoop();
    if (modalAudio) { try { modalAudio.pause(); } catch (e) {} modalAudio = null; }
    if (modalRecBtn) {
      var prevRow = modalRecBtn.closest('.rec-row');
      if (prevRow) {
        var strip = prevRow.querySelector('.rec-spectro');
        if (strip) {
          strip.classList.remove('armed');
          var played = strip.querySelector('.rec-spectro-played');
          var cur = strip.querySelector('.rec-spectro-cursor');
          if (played) played.style.width = '0%';
          if (cur) cur.style.left = '0%';
        }
      }
      modalRecBtn.removeAttribute('data-active');
      modalRecBtn.innerHTML = ICON_PLAY;
      modalRecBtn = null;
    }
  }

  function sketchSrc(sci, pose) {
    // Look up the common name from the lifelist so the worker's JIT
    // Gemini prompt is right for a never-pre-rendered species.
    var sp = ((DATA.lifelist && DATA.lifelist.species) || [])
      .find(function (s) { return s.sci === sci; });
    var com = sp ? (sp.com || '') : '';
    var base = apiUrl('cutout.php?sci=' + encodeURIComponent(sci)) +
      (com ? '&com=' + encodeURIComponent(com) : '') +
      '&v=' + SKETCH_VERSION;
    var n = +pose || 1;
    return n > 1 ? base + '&pose=' + n : base;
  }
  function openDetailModal(sci) {
    if (!sci) return;
    var modal = document.getElementById('detail-modal');
    var img = document.getElementById('modalImg');
    var poseToggle = document.getElementById('modalPoseToggle');
    var poseBtns = [].slice.call(poseToggle.querySelectorAll('button'));

    // Reset the toggle: assume nothing's available, set pose 1 (perched
    // cutout - every species has it) as the optimistic default. HEAD
    // probes below toggle each button on/off and pick the best default.
    poseToggle.removeAttribute('data-unavailable');
    poseBtns.forEach(function (b) {
      b.setAttribute('data-unavailable', 'true');
      b.setAttribute('aria-current', 'false');
    });
    var p1 = poseToggle.querySelector('button[data-pose="1"]');
    if (p1) {
      p1.removeAttribute('data-unavailable');
      p1.setAttribute('aria-current', 'true');
    }
    img.src = sketchSrc(sci, 1);
    img.alt = sci;

    // Probe each pose's image with HEAD. Build a list of available
    // poses, then pick the highest-numbered as the default (in-flight
    // > perched, etc.). When only one pose remains, hide the toggle
    // entirely - no choice means no UI.
    var probes = poseBtns.map(function (b) {
      var pose = +b.dataset.pose;
      return fetch(sketchSrc(sci, pose), { method: 'HEAD', cache: 'no-store' })
        .then(function (r) { return { pose: pose, btn: b, ok: r.ok }; })
        .catch(function () { return { pose: pose, btn: b, ok: false }; });
    });
    Promise.all(probes).then(function (results) {
      var available = results.filter(function (r) { return r.ok; });
      available.forEach(function (r) { r.btn.removeAttribute('data-unavailable'); });
      results.filter(function (r) { return !r.ok; }).forEach(function (r) {
        r.btn.setAttribute('data-unavailable', 'true');
      });
      // Default to the highest-numbered available pose (in-flight if
      // present, else fall back to perched).
      var pick = available.sort(function (a, b) { return b.pose - a.pose; })[0];
      if (pick) {
        poseBtns.forEach(function (b) {
          b.setAttribute('aria-current', b === pick.btn ? 'true' : 'false');
        });
        img.src = sketchSrc(sci, pick.pose);
      }
      // Single-option => hide the chrome.
      if (available.length <= 1) {
        poseToggle.setAttribute('data-unavailable', 'true');
      }
      // Slide the white pill to the active button.
      syncPill(poseToggle);
    });
    document.getElementById('modalSci').textContent = sci;
    document.getElementById('modalGenus').textContent = (sci.split(' ')[0] || '-');
    document.getElementById('modalCommon').textContent = '-';
    document.getElementById('modalAllTime').textContent = '-';
    document.getElementById('modalWindow').textContent = '-';
    // Window stat label tracks the picker; the whole stat is hidden for
    // the "all time" window since it would just echo the all-time count.
    var modalWinStat = document.getElementById('modalWindowStat');
    if (currentHours >= 1000000) {
      modalWinStat.style.display = 'none';
    } else {
      modalWinStat.style.display = '';
      document.getElementById('modalWindowLbl').textContent = windowLabel(currentHours);
    }
    document.getElementById('modalFirstSeen').textContent = '-';
    renderBestTime(null, []);
    renderDetectionCalendar(null, []);
    renderEbirdNearby(null);
    document.getElementById('modalRarity').textContent = '-';
    document.getElementById('modalRarityDetail').textContent = 'Based on your detections.';
    document.getElementById('modalRarityPanel').removeAttribute('data-rarity');
    document.getElementById('modalRarityPanel').removeAttribute('title');
    document.getElementById('modalRarityPanel').removeAttribute('tabindex');
    document.getElementById('modalRarity').classList.remove('epic', 'rare', 'uncommon', 'pedestrian');
    document.getElementById('modalDesc').textContent = 'Loading description...';
    document.getElementById('modalDesc').classList.add('placeholder');
    document.getElementById('modalRecordings').innerHTML = '<li class="rec-empty">Loading recordings...</li>';
    document.getElementById('modalRecCount').textContent = '';
    document.getElementById('modalWiki').href = wikiUrl(sci);
    document.getElementById('modalEbird').href = ebirdUrl(sci);
    // FLIP-style morph: scale + translate the modal-card from the
    // clicked atlas card's position to its natural centered size, so
    // the card *expands* into the detail view instead of just fading
    // in. The outer modal MUST become visible (aria-hidden=false)
    // before we apply the initial transform - the browser skips
    // layout for opacity-0 trees, which would freeze the morph at the
    // starting frame.
    var sourceCard = atlasGridEl
      ? atlasGridEl.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]')
      : null;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    morphModalOpen(modal.querySelector('.modal-card'), sourceCard);

    // Species detail (lifelist row + every detection).
    var loadSpecies = SPECIES_CACHE[sci]
      ? Promise.resolve(SPECIES_CACHE[sci])
      : fetchJson(apiUrl('birdnet-api.php?action=species&sci=' + encodeURIComponent(sci))).then(function (j) {
          SPECIES_CACHE[sci] = j;
          return j;
        });
    loadSpecies.then(function (j) {
      var s = j.summary || {};
      document.getElementById('modalCommon').textContent = s.com || sci;
      document.getElementById('modalAllTime').textContent = fmtN(speciesTotal(s));
      var winRow = ((DATA.recent && DATA.recent.species) || []).filter(function (x) { return x.sci === sci; })[0];
      document.getElementById('modalWindow').textContent = fmtN(winRow ? +winRow.n : 0);
      document.getElementById('modalFirstSeen').textContent = s.first_seen ? fmtDateLine(s.first_seen.split(' ')[0], s.first_seen.split(' ')[1]) : '-';
      var total = speciesTotal(s);
      var rar = rarityInfoForTotal(total);
      var rarEl = document.getElementById('modalRarity');
      var rarPanel = document.getElementById('modalRarityPanel');
      var rarExplainer = rarityExplainer(rar, total);
      rarEl.textContent = rar.label;
      rarEl.classList.remove('epic', 'rare', 'uncommon', 'pedestrian');
      rarEl.classList.add(rar.key);
      document.getElementById('modalRarityDetail').textContent = rarExplainer;
      rarPanel.setAttribute('data-rarity', rar.key);
      rarPanel.setAttribute('tabindex', '0');
      rarPanel.title = rarExplainer;
      if (!rarPanel.querySelector('.rarity-legend')) rarPanel.insertAdjacentHTML('beforeend', rarityLegendHtml());
      var dets = j.detections || [];
      renderBestTime(j.time_profile, dets);
      renderDetectionCalendar(j.daily_profile, dets);
      renderEbirdNearby(ebirdNearbyFor(sci));
      if (j.audio_private) {
        document.getElementById('modalRecCount').textContent = 'private';
        document.getElementById('modalRecordings').innerHTML = '<li class="rec-empty">Audio clips stay private on the local BirdNET-Pi.</li>';
        return;
      }
      document.getElementById('modalRecCount').textContent = dets.length + ' captured';
      document.getElementById('modalRecordings').innerHTML = dets.length
        ? dets.map(function (d) {
            return '<li class="rec-row" data-file="' + attrEsc(d.file || '') + '" data-date="' + attrEsc(d.d || '') + '" data-time="' + attrEsc(d.t || '') + '">'
              + '<button class="play" type="button" aria-label="play">' + ICON_PLAY + '</button>'
              + '<span class="when">' + fmtRecTime(d.d, d.t) + '<small>' + fmtDateLine(d.d, d.t, { seconds: true }) + '</small></span>'
              + '<span class="conf">' + ((+d.conf || 0) * 100).toFixed(0) + '%</span>'
              + '<button class="rec-delete" type="button" aria-label="delete recording" title="Delete this recording">' + ICON_TRASH + '</button>'
              + '<div class="rec-spectro" aria-hidden="true">'
              +   '<div class="rec-spectro-loading">loading spectrogram...</div>'
              +   '<div class="rec-spectro-played"></div>'
              +   '<div class="rec-spectro-cursor"></div>'
              +   '<div class="rec-spectro-scrub" role="slider" aria-label="scrub" tabindex="0"></div>'
              + '</div>'
              + '</li>';
          }).join('')
        : '<li class="rec-empty">No recordings yet.</li>';
    }).catch(function () {
      document.getElementById('modalRecordings').innerHTML = '<li class="rec-empty">Failed to load recordings.</li>';
    });

    // Wikipedia summary (description + genus / family).
    var loadWiki = WIKI_CACHE[sci]
      ? Promise.resolve(WIKI_CACHE[sci])
      : fetchJson(apiUrl('wiki.php?sci=' + encodeURIComponent(sci))).then(function (j) {
          WIKI_CACHE[sci] = j; return j;
        });
    loadWiki.then(function (j) {
      var desc = document.getElementById('modalDesc');
      desc.textContent = j.extract || 'No description available.';
      desc.classList.toggle('placeholder', !j.extract);
    }).catch(function () {
      var desc = document.getElementById('modalDesc');
      desc.textContent = 'No description available.';
      desc.classList.add('placeholder');
    });
  }
  function closeDetailModal() {
    var modal = document.getElementById('detail-modal');
    stopModalAudio();
    // Reverse-morph back into the source atlas card so the modal
    // appears to *retract* to where it came from. Look the card up
    // fresh - the user may have switched the time window or sort
    // since opening the modal, so the source card may have moved.
    var sci = (document.getElementById('modalSci').textContent || '').trim();
    var sourceCard = sci && atlasGridEl
      ? atlasGridEl.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]')
      : null;
    morphModalClose(modal.querySelector('.modal-card'), sourceCard, function () {
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    });
  }

  // FLIP morph helpers. We never resize/reposition the modal-card
  // permanently - we apply an inline transform that places it at the
  // source-card's position+scale, then clear it next frame so the
  // browser interpolates to the natural state. The same trick runs in
  // reverse on close.
  var atlasGridEl = document.getElementById('atlasGrid');
  function morphFromRect(cardEl) {
    if (!cardEl) return null;
    var r = cardEl.getBoundingClientRect();
    var winCx = window.innerWidth / 2;
    var winCy = window.innerHeight / 2;
    var dx = (r.left + r.width / 2) - winCx;
    var dy = (r.top + r.height / 2) - winCy;
    // Scale relative to the natural max width of the modal (~920px).
    var ratio = Math.max(0.18, Math.min(0.95, r.width / 920));
    return { dx: dx, dy: dy, ratio: ratio };
  }
  function morphModalOpen(modalCard, sourceCard) {
    if (!modalCard) return;
    modalCard.classList.remove('is-morphing');
    var from = morphFromRect(sourceCard);
    if (from) {
      modalCard.style.transformOrigin = '50% 50%';
      modalCard.style.transform =
        'translate3d(' + from.dx + 'px, ' + from.dy + 'px, 0) scale(' + from.ratio + ')';
      modalCard.style.opacity = '0';
    } else {
      modalCard.style.transform = 'translate3d(0, 8px, 0) scale(.96)';
      modalCard.style.opacity = '0';
    }
    // Force a layout flush so the starting state is committed, then
    // schedule the destination on the next tick. setTimeout(0) is
    // more reliable than rAF in some embedded/headless contexts.
    void modalCard.offsetWidth;
    setTimeout(function () {
      modalCard.classList.add('is-morphing');
      // Explicit identity matrix - browsers won't interpolate
      // between a matrix() and the keyword "none".
      modalCard.style.transform = 'translate3d(0px, 0px, 0px) scale(1)';
      modalCard.style.opacity = '1';
      setTimeout(function () {
        modalCard.classList.remove('is-morphing');
        modalCard.style.transform = '';
        modalCard.style.opacity = '';
      }, 420);
    }, 0);
  }
  function morphModalClose(modalCard, sourceCard, done) {
    if (!modalCard) { if (done) done(); return; }
    var from = morphFromRect(sourceCard);
    modalCard.classList.add('is-morphing');
    if (from) {
      modalCard.style.transform =
        'translate3d(' + from.dx + 'px, ' + from.dy + 'px, 0) scale(' + from.ratio + ')';
    } else {
      modalCard.style.transform = 'translate3d(0, 8px, 0) scale(.96)';
    }
    modalCard.style.opacity = '0';
    // After the transition, reset state for next open.
    var settle = function () {
      modalCard.classList.remove('is-morphing');
      modalCard.style.transform = '';
      modalCard.style.opacity = '';
      if (done) done();
    };
    setTimeout(settle, 380);
  }

  // Pose toggle inside the modal - swaps the sketch between perched
  // (default) and in-flight alt pose. A short opacity transition makes
  // the swap feel intentional rather than a hard cut.
  document.getElementById('modalPoseToggle').addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('button');
    if (!btn || btn.getAttribute('data-unavailable') === 'true') return;
    var pose = +btn.dataset.pose;
    var toggle = document.getElementById('modalPoseToggle');
    [].slice.call(toggle.querySelectorAll('button')).forEach(function (b) {
      b.setAttribute('aria-current', b === btn ? 'true' : 'false');
    });
    syncPill(toggle);
    var img = document.getElementById('modalImg');
    var sci = document.getElementById('modalSci').textContent;
    img.classList.add('swapping');
    setTimeout(function () {
      img.src = sketchSrc(sci, pose);
      img.addEventListener('load', function once() {
        img.classList.remove('swapping');
        img.removeEventListener('load', once);
      });
    }, 180);
  });

  // Expose for debugging during dev - also lets the modal be opened
  // from outside the IIFE if needed.
  window.__openDetailModal = openDetailModal;
  window.__closeDetailModal = closeDetailModal;

  // ===== Admin overlay (settings / system / logs / tools) =====
  // Lives in the same shell as the rest of the app - the menu button
  // and return-to-atlas pill stay put. The slider hides; this overlay
  // takes over the body. Navigation is via the drawer menu, NOT
  // internal tabs (the drawer is the canonical nav surface).
  var adminEl = document.getElementById('adminScreen');
  var adminBody = document.getElementById('adminBody');
  var adminTitle = document.getElementById('adminTitle');
  var adminPollT = null;
  var adminSect = null;
  var ADMIN_TITLES = {
    settings: 'Settings',
    system: 'System',
    logs: 'Logs',
    tools: 'Tools',
  };
  function adminEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function attrEsc(s) {
    return adminEsc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function adminFmtBytes(n) {
    if (!n) return '0 B';
    var u = ['B','KB','MB','GB','TB'];
    var i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
  }
  function adminFmtAge(s) {
    if (s == null) return '-';
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }
  // Admin endpoints rely on the session cookie set by /api/auth/login -
  // no Authorization header needed (and nothing sensitive in JS-readable
  // storage). credentials: 'same-origin' is the default but spelled out
  // for clarity.
  function adminApi(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  }
  function openAdmin(section) {
    document.body.classList.add('admin-on');
    adminEl.setAttribute('aria-hidden', 'false');
    adminTitle.textContent = ADMIN_TITLES[section] || section;
    if (adminPollT) { clearInterval(adminPollT); adminPollT = null; }
    adminSect = section;
    if (section === 'settings') renderAdminSettings();
    else if (section === 'system') renderAdminSystem();
    else if (section === 'logs') renderAdminLogs();
    else if (section === 'tools') renderAdminTools();
  }
  function closeAdmin() {
    document.body.classList.remove('admin-on');
    adminEl.setAttribute('aria-hidden', 'true');
    if (adminPollT) { clearInterval(adminPollT); adminPollT = null; }
    adminSect = null;
  }

  function adminCard(title, value, sub, cls) {
    return '<div class="admin-card ' + (cls || '') + '">'
      + '<h3>' + adminEsc(title) + '</h3>'
      + '<div class="v">' + adminEsc(value) + '</div>'
      + (sub ? '<div class="sub">' + adminEsc(sub) + '</div>' : '')
      + '</div>';
  }
  function adminUnreachableHtml(reason) {
    return '<div class="admin-unreachable">Pi unreachable - ' + adminEsc(reason || 'no data') + '</div>';
  }

  function renderAdminSettings() {
    adminBody.innerHTML = '<p style="font:11px ui-monospace,monospace;color:var(--ink-soft);text-align:center">loading settings...</p>';
    fetch(apiUrl('config.php'), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (cfg) {
        var v = cfg.values || {};
        var preserve = cfg.preserve;
        setNightHours(v.AV_NIGHT_START, v.AV_NIGHT_END);
        adminBody.innerHTML =
          '<div class="admin-settings">'
          + settingsToggle('preserve', 'Preserve all recordings', "don't auto-delete", preserve)
          + settingsSlider('CONFIDENCE',  'Confidence threshold', 'min score to log a detection', v.CONFIDENCE,  0.1, 0.95, 0.05, 2)
          + settingsSlider('SENSITIVITY', 'Sensitivity',          'analyzer sensitivity',          v.SENSITIVITY, 0.5, 1.5,  0.05, 2)
          + settingsSlider('OVERLAP',     'Chunk overlap',        'seconds analyzed per pass',     v.OVERLAP,     0,   2.5,  0.1,  1)
          + settingsToggle('AV_AUDIO_FILTER', 'Bird audio filter', 'band-pass mic audio before analysis', +v.AV_AUDIO_FILTER === 1, 'experimental')
          + settingsSlider('AV_FILTER_HIGHPASS', 'High-pass cutoff', 'reduces HVAC and low rumble, Hz', v.AV_FILTER_HIGHPASS, 20, 3000, 20, 0)
          + settingsSlider('AV_FILTER_LOWPASS',  'Low-pass cutoff',  'reduces high hiss, Hz',           v.AV_FILTER_LOWPASS, 1000, 20000, 100, 0)
          + settingsToggle('BIRDFY_ENABLED', 'Birdfy camera import', 'mark camera-seen birds on the collage', +v.BIRDFY_ENABLED === 1, 'experimental')
          + settingsSecret('BIRDFY_EMAIL', 'Birdfy email', 'stored locally; never shown after save', v.BIRDFY_EMAIL)
          + settingsSecret('BIRDFY_PASSWORD', 'Birdfy password', 'stored locally; never shown after save', v.BIRDFY_PASSWORD)
          + settingsSlider('BIRDFY_IMPORT_WINDOW_HOURS', 'Birdfy import window', 'hours of camera detections to check', v.BIRDFY_IMPORT_WINDOW_HOURS || 24, 1, 168, 1, 0)
          + settingsSlider('AV_DISPLAY_REFRESH_SECONDS', 'Display refresh', 'seconds between automatic UI updates', v.AV_DISPLAY_REFRESH_SECONDS || 30, 5, 300, 5, 0)
          + settingsHourSelect('AV_NIGHT_START', 'Night starts', 'used by moon reveal and Night Visitors', v.AV_NIGHT_START)
          + settingsHourSelect('AV_NIGHT_END',   'Night ends',   'calls before this hour count as night', v.AV_NIGHT_END)
          + settingsSegmented('FULL_DISK', 'When disk fills', '', v.FULL_DISK, [
              { v: 'keep',  label: 'keep' },
              { v: 'purge', label: 'purge' },
            ])
          + settingsSecret('EBIRD_API_KEY', 'eBird API key', 'used for nearby reports; never shown after save', v.EBIRD_API_KEY)
          + '<div class="menu-save-row">'
          + '  <span class="save-state" id="saveState"></span>'
          + '  <button type="button" id="saveBtn" disabled>save</button>'
          + '</div>'
          + '</div>';
        wireSettingsControls(adminBody);
        var saveBtn = document.getElementById('saveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveSettings);
      })
      .catch(function (err) {
        adminBody.innerHTML = adminUnreachableHtml('settings load failed (' + err + ')');
      });
  }

  function renderAdminSystem() {
    adminBody.innerHTML = '<p style="font:11px ui-monospace,monospace;color:var(--ink-soft);text-align:center">loading...</p>';
    function tick() {
      adminApi(apiUrl('birdnet-status.php?action=diag'))
        .then(function (r) { return r.text().then(function (raw) { return { status: r.status, raw: raw }; }); })
        .then(function (res) {
          var j = null;
          try { j = JSON.parse(res.raw); } catch (e) {}
          if (res.status !== 200 || !j) {
            adminBody.innerHTML = adminUnreachableHtml(
              !j ? 'birdnet-status.php not installed on the pi' : (j.error || 'HTTP ' + res.status)
            );
            return;
          }
          adminBody.innerHTML = adminSystemMarkup(j);
          wireAdminRestarts();
        })
        .catch(function (e) { adminBody.innerHTML = adminUnreachableHtml(e.message); });
    }
    tick();
    adminPollT = setInterval(tick, 6000);
  }
  function adminSystemMarkup(j) {
    var sys = j.system || {}, svc = j.services || {}, recLogs = j.recent_logs || {};
    var stream = sys.stream_data || {}, db = sys.birds_db || {};
    var streamAlert = !stream.exists || stream.newest_age_s == null || stream.newest_age_s > 600;
    var dbAlert = db.exists && db.modified_s > 3600;
    var keySvcs = ['birdnet_recording', 'birdnet_analysis', 'birdnet_log'];
    var dead = keySvcs.filter(function (n) { return svc[n] && svc[n].active !== 'active'; });
    var html = '<div class="admin-grid">';
    html += adminCard('recording pipeline', dead.length === 0 ? 'live' : (dead.length + ' down'),
      dead.length === 0 ? 'all services active' : dead.join(', '),
      dead.length === 0 ? '' : 'alert');
    html += adminCard('newest live audio',
      stream.newest_age_s == null ? 'no chunks' : adminFmtAge(stream.newest_age_s) + ' ago',
      stream.newest_name || '',
      streamAlert ? 'alert' : '');
    html += adminCard('birds.db updated',
      db.exists ? adminFmtAge(db.modified_s) + ' ago' : 'missing',
      db.mtime || '',
      dbAlert ? 'warn' : '');
    html += adminCard('uptime', (sys.uptime || {}).pretty || '-',
      'load ' + ((sys.uptime || {}).load || []).map(function (n) { return n.toFixed(2); }).join(' / '));
    html += adminCard('cpu temp',
      sys.temp_c != null ? sys.temp_c.toFixed(1) + '°C' : '-',
      sys.hostname + ' · ' + sys.kernel,
      sys.temp_c != null && sys.temp_c > 75 ? 'warn' : '');
    html += adminCard('memory used', sys.mem ? sys.mem.used_pct + '%' : '-',
      sys.mem ? adminFmtBytes(sys.mem.used_bytes) + ' / ' + adminFmtBytes(sys.mem.total_bytes) : '',
      sys.mem && sys.mem.used_pct > 92 ? 'warn' : '');
    html += adminCard('disk (birdsongs)', sys.disk_birds ? sys.disk_birds.used_pct + '%' : '-',
      sys.disk_birds ? adminFmtBytes(sys.disk_birds.total_bytes - sys.disk_birds.free_bytes) + ' / ' + adminFmtBytes(sys.disk_birds.total_bytes) : '',
      sys.disk_birds && sys.disk_birds.used_pct > 92 ? 'warn' : '');
    var audio = sys.audio || {}, cards = audio.arecord_l || [];
    var mic = cards.find ? cards.find(function (c) { return /usb-audio|microphone|mic/i.test(c); }) : null;
    // Without a USB mic, /proc/asound/cards only lists the Pi's HDMI
    // audio outputs - which aren't an input source. Flag that clearly
    // rather than showing "audio device: vc4hdmi0" as if it were a mic.
    html += adminCard('audio device',
      mic || (cards.length ? 'no microphone attached' : 'no audio devices'),
      mic ? '' : (cards[0] || ''),
      mic ? '' : 'warn');
    html += '</div>';

    html += '<h2 class="admin-section-head">services</h2>';
    html += '<table class="admin-tbl"><thead><tr><th>unit</th><th>state</th><th>enabled</th><th>since</th><th></th></tr></thead><tbody>';
    Object.keys(svc).forEach(function (name) {
      var s = svc[name];
      var pill = (s.active === 'active') ? 'active' : (s.active === 'failed' ? 'failed' : 'inactive');
      html += '<tr>'
        + '<td>' + adminEsc(name) + '</td>'
        + '<td><span class="pill ' + pill + '">' + adminEsc(s.active) + '</span></td>'
        + '<td>' + adminEsc(s.enabled) + '</td>'
        + '<td>' + adminEsc(s.since || '-') + '</td>'
        + '<td><button class="restart" data-unit="' + adminEsc(name) + '">restart</button></td>'
        + '</tr>';
    });
    html += '</tbody></table>';

    var conf = (sys.conf || {}).values || {};
    var rows = Object.keys(conf).map(function (k) {
      return '<tr><td>' + adminEsc(k) + '</td><td>' + adminEsc(conf[k]) + '</td></tr>';
    }).join('');
    if (rows) {
      html += '<h2 class="admin-section-head">birdnet.conf</h2>';
      html += '<table class="admin-tbl"><tbody>' + rows + '</tbody></table>';
    }
    if (Object.keys(recLogs).length) {
      html += '<h2 class="admin-section-head">recent journal</h2>';
      Object.keys(recLogs).forEach(function (u) {
        html += '<h3 style="font:9.5px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);margin:12px 0 6px">' + adminEsc(u) + '</h3>';
        html += '<div class="admin-logs-pane">' + adminEsc(recLogs[u] || '(empty)') + '</div>';
      });
    }
    return html;
  }
  function wireAdminRestarts() {
    adminBody.querySelectorAll('button.restart').forEach(function (b) {
      b.addEventListener('click', function () {
        var unit = b.dataset.unit;
        if (!confirm('Restart ' + unit + '?')) return;
        b.disabled = true; var old = b.textContent; b.textContent = '...';
        fetch(apiUrl('birdnet-status.php?action=restart&unit=' + encodeURIComponent(unit)), {
          method: 'POST', credentials: 'same-origin',
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            b.textContent = j.ok ? 'ok' : 'fail';
            setTimeout(function () { b.disabled = false; b.textContent = old; renderAdminSystem(); }, 1200);
          })
          .catch(function () { b.textContent = 'err'; b.disabled = false; setTimeout(function () { b.textContent = old; }, 1500); });
      });
    });
  }

  function renderAdminLogs() {
    var unit = 'birdnet_recording', lines = 120, autoScroll = true;
    adminBody.innerHTML =
      '<div class="admin-logs-toolbar">'
      + '  <label>unit</label><select id="adminLogsUnit">'
      // php-fpm unit name differs per Debian version (8.2 on Bookworm,
      // 8.4 on Trixie). List all three so the dropdown has the right one
      // regardless of host - birdnet-status.php's ALLOWED_UNITS already
      // skips ones systemd doesn't know about.
      + ['birdnet_recording','birdnet_analysis','birdnet_log','birdnet_stats','spectrogram_viewer','livestream','icecast2','caddy','php8.4-fpm','php8.3-fpm','php8.2-fpm']
          .map(function (u) { return '<option value="' + u + '">' + u + '</option>'; }).join('')
      + '  </select>'
      + '  <label>lines</label><input id="adminLogsLines" type="number" value="120" min="20" max="500" step="20">'
      + '</div>'
      + '<div class="admin-logs-pane" id="adminLogsOut">loading...</div>';
    var pane = document.getElementById('adminLogsOut');
    var sel = document.getElementById('adminLogsUnit');
    var linesIn = document.getElementById('adminLogsLines');
    sel.addEventListener('change', function () { unit = sel.value; tick(); });
    linesIn.addEventListener('change', function () { lines = +linesIn.value || 120; tick(); });
    pane.addEventListener('scroll', function () {
      autoScroll = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 20;
    });
    function tick() {
      adminApi(apiUrl('birdnet-status.php?action=logs&unit=' + encodeURIComponent(unit) + '&lines=' + lines))
        .then(function (r) { return r.text().then(function (raw) { return { status: r.status, raw: raw }; }); })
        .then(function (res) {
          var j = null;
          try { j = JSON.parse(res.raw); } catch (e) {}
          if (res.status !== 200 || !j) {
            pane.textContent = 'pi unreachable - ' + (j && j.error ? j.error : 'no data');
            return;
          }
          pane.textContent = j.text || '(empty)';
          if (autoScroll) pane.scrollTop = pane.scrollHeight;
        });
    }
    tick();
    adminPollT = setInterval(tick, 4000);
  }

  function purgeWindowLabel(hours) {
    hours = +hours || 24;
    if (hours >= 1000000) return 'all time';
    if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's');
    var days = Math.round(hours / 24);
    return days + ' day' + (days === 1 ? '' : 's');
  }

  function purgeFmtDate(s) {
    if (!s) return '-';
    return String(s).replace(' ', ' · ');
  }

  function renderPurgeSummary(summary, hours) {
    summary = summary || {};
    return ''
      + '<div class="purge-summary" data-empty="' + ((+summary.detections || 0) === 0 ? 'true' : 'false') + '">'
      + '  <div><strong>' + adminEsc(summary.detections || 0) + '</strong><span>detections</span></div>'
      + '  <div><strong>' + adminEsc(summary.species || 0) + '</strong><span>species</span></div>'
      + '  <div><strong>' + adminEsc(purgeWindowLabel(hours)) + '</strong><span>range</span></div>'
      + '</div>'
      + '<div class="purge-window-note">'
      + '  <span>oldest ' + adminEsc(purgeFmtDate(summary.oldest)) + '</span>'
      + '  <span>newest ' + adminEsc(purgeFmtDate(summary.newest)) + '</span>'
      + '</div>';
  }

  function wirePurgeTool() {
    var card = document.getElementById('purgeTool');
    if (!card) return;
    var range = card.querySelector('#purgeRange');
    var confirmInput = card.querySelector('#purgeConfirm');
    var btn = card.querySelector('#purgeDelete');
    var preview = card.querySelector('#purgePreview');
    var out = card.querySelector('#purgeOut');
    var currentSummary = null;
    var loading = false;

    function setOut(msg, cls) {
      if (!out) return;
      out.textContent = msg || '';
      out.className = 'out purge-out' + (cls ? ' ' + cls : '');
    }

    function updateButton() {
      var count = currentSummary ? (+currentSummary.detections || 0) : 0;
      btn.disabled = loading || count === 0 || !confirmInput || confirmInput.value.trim() !== 'DELETE';
    }

    function loadPreview() {
      var hours = +(range.value || 24);
      loading = true;
      currentSummary = null;
      if (preview) preview.innerHTML = '<div class="purge-loading">checking selected range...</div>';
      setOut('');
      updateButton();
      fetch(apiUrl('bulk-delete-recordings.php?action=preview&hours=' + encodeURIComponent(hours)), {
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j.ok) throw new Error(res.j.error || 'preview failed');
          currentSummary = res.j.summary || {};
          if (preview) preview.innerHTML = renderPurgeSummary(currentSummary, hours);
          if ((+currentSummary.detections || 0) === 0) setOut('nothing to delete for this range');
        })
        .catch(function (e) {
          if (preview) preview.innerHTML = '<div class="purge-loading">preview unavailable</div>';
          setOut(e.message || 'preview failed', 'err');
        })
        .finally(function () {
          loading = false;
          updateButton();
        });
    }

    range.addEventListener('change', function () {
      if (confirmInput) confirmInput.value = '';
      loadPreview();
    });
    if (confirmInput) confirmInput.addEventListener('input', updateButton);
    btn.addEventListener('click', function () {
      var hours = +(range.value || 24);
      var count = currentSummary ? (+currentSummary.detections || 0) : 0;
      if (!count || confirmInput.value.trim() !== 'DELETE') return;
      if (!confirm('Permanently delete ' + count + ' detections from ' + purgeWindowLabel(hours) + '?')) return;
      loading = true;
      btn.disabled = true;
      btn.textContent = 'deleting...';
      setOut('deleting selected recordings...');
      fetch(apiUrl('bulk-delete-recordings.php'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: hours, confirm: 'DELETE' }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j.ok) throw new Error(res.j.error || 'delete failed');
          var d = res.j.deleted || {};
          setOut('deleted ' + (d.detections || 0) + ' detections and ' + (d.files || 0) + ' recordings', 'ok');
          DATA.stats = DATA.recent = DATA.lifelist = DATA.timeseries = DATA.firstseen = DATA.seasonfirst = null;
          DATA.ebirdNearby = DATA.visual = DATA.overnight = DATA.nightCollage = null;
          SPECIES_CACHE = {};
          if (confirmInput) confirmInput.value = '';
          refreshRecent();
          loadPreview();
        })
        .catch(function (e) {
          setOut(e.message || 'delete failed', 'err');
        })
        .finally(function () {
          loading = false;
          btn.textContent = 'delete selected';
          updateButton();
        });
    });
    loadPreview();
  }

  function evalPct(v) {
    return v == null || !isFinite(+v) ? '-' : Math.round(+v * 100) + '%';
  }

  function evalConf(v) {
    return v == null || !isFinite(+v) ? '-' : (+v * 100).toFixed(1) + '%';
  }

  function evalDelta(v, pct) {
    if (v == null || !isFinite(+v)) return '<span class="eval-delta">-</span>';
    var n = +v;
    var cls = n > 0 ? 'up' : (n < 0 ? 'down' : 'flat');
    var sign = n > 0 ? '+' : '';
    var text = pct ? (sign + Math.round(n * 100) + ' pts') : (sign + (n * 100).toFixed(1) + '%');
    return '<span class="eval-delta ' + cls + '">' + adminEsc(text) + '</span>';
  }

  function evalSpeciesList(rows) {
    rows = rows || [];
    if (!rows.length) return '<span class="eval-empty">none</span>';
    return rows.slice(0, 5).map(function (s) {
      return '<span>' + adminEsc(s.com || s.sci || 'unknown') + '</span>';
    }).join('');
  }

  function renderFilterEval(j) {
    var before = j.before || {}, after = j.after || {}, delta = j.delta || {};
    var verdict = j.verdict || { label: 'unknown', tone: 'neutral', explain: '' };
    var settings = j.settings || {};
    return ''
      + '<div class="eval-verdict ' + adminEsc(verdict.tone || 'neutral') + '">'
      + '  <strong>' + adminEsc(verdict.label || 'unknown') + '</strong>'
      + '  <span>' + adminEsc(verdict.explain || '') + '</span>'
      + '</div>'
      + '<div class="eval-settings">'
      + '  <span>filter ' + (settings.filter_enabled ? 'on' : 'off') + '</span>'
      + '  <span>high-pass ' + adminEsc(settings.highpass || '-') + ' hz</span>'
      + '  <span>low-pass ' + adminEsc(settings.lowpass || '-') + ' hz</span>'
      + '</div>'
      + '<div class="eval-metrics">'
      + evalMetric('avg confidence', evalConf(before.avg_conf), evalConf(after.avg_conf), evalDelta(delta.avg_conf, false))
      + evalMetric('high-confidence rate', evalPct(before.high_rate), evalPct(after.high_rate), evalDelta(delta.high_rate, true))
      + evalMetric('low-confidence pressure', evalPct(before.low_rate), evalPct(after.low_rate), evalDelta(delta.low_rate, true))
      + evalMetric('species retained', adminEsc(before.species || 0), adminEsc(after.species || 0), '<span class="eval-delta">' + evalPct(delta.species_retention) + '</span>')
      + '</div>'
      + '<div class="eval-counts">'
      + '  <div><strong>' + adminEsc(before.detections || 0) + '</strong><span>previous detections</span></div>'
      + '  <div><strong>' + adminEsc(after.detections || 0) + '</strong><span>recent detections</span></div>'
      + '  <div><strong>' + adminEsc((delta.score == null ? '-' : delta.score)) + '</strong><span>score</span></div>'
      + '</div>'
      + '<div class="eval-species">'
      + '  <div><h5>new in recent window</h5>' + evalSpeciesList((j.species || {}).gained) + '</div>'
      + '  <div><h5>missing from recent window</h5>' + evalSpeciesList((j.species || {}).lost) + '</div>'
      + '</div>';
  }

  function defaultMicEvalChangedAt() {
    var d = new Date(Date.now() - 24 * 3600000);
    d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function evalRate(v) {
    return v == null || !isFinite(+v) ? '-' : (+v).toFixed(+v >= 10 ? 1 : 2) + '/hr';
  }

  function evalRateDelta(v) {
    if (v == null || !isFinite(+v)) return '<span class="eval-delta">-</span>';
    var n = +v;
    var cls = n > 0 ? 'up' : (n < 0 ? 'down' : 'flat');
    var sign = n > 0 ? '+' : '';
    return '<span class="eval-delta ' + cls + '">' + adminEsc(sign + evalRate(n)) + '</span>';
  }

  function renderMicEval(j) {
    var before = j.before || {}, after = j.after || {}, delta = j.delta || {};
    var verdict = j.verdict || { label: 'unknown', tone: 'neutral', explain: '' };
    var windows = j.windows || {};
    var beforeWindow = windows.before || {};
    var afterWindow = windows.after || {};
    return ''
      + '<div class="eval-verdict ' + adminEsc(verdict.tone || 'neutral') + '">'
      + '  <strong>' + adminEsc(verdict.label || 'unknown') + '</strong>'
      + '  <span>' + adminEsc(verdict.explain || '') + '</span>'
      + '</div>'
      + '<div class="eval-settings">'
      + (j.label ? '  <span>upgrade ' + adminEsc(j.label) + '</span>' : '')
      + '  <span>changed ' + adminEsc((j.changed_at || '').replace('T', ' ') || '-') + '</span>'
      + '  <span>before ' + adminEsc(beforeWindow.start || '-') + ' to ' + adminEsc(beforeWindow.end || '-') + '</span>'
      + '  <span>after ' + adminEsc(afterWindow.start || '-') + ' to ' + adminEsc(afterWindow.end || '-') + '</span>'
      + '</div>'
      + '<div class="eval-metrics">'
      + evalMetric('detections / hour', evalRate(before.detections_per_hour), evalRate(after.detections_per_hour), evalRateDelta(delta.detections_per_hour))
      + evalMetric('avg confidence', evalConf(before.avg_conf), evalConf(after.avg_conf), evalDelta(delta.avg_conf, false))
      + evalMetric('high-confidence rate', evalPct(before.high_rate), evalPct(after.high_rate), evalDelta(delta.high_rate, true))
      + evalMetric('species count', adminEsc(before.species || 0), adminEsc(after.species || 0), '<span class="eval-delta ' + ((delta.species || 0) > 0 ? 'up' : ((delta.species || 0) < 0 ? 'down' : 'flat')) + '">' + adminEsc(((delta.species || 0) > 0 ? '+' : '') + (delta.species || 0)) + '</span>')
      + '</div>'
      + '<div class="eval-counts">'
      + '  <div><strong>' + adminEsc(before.detections || 0) + '</strong><span>baseline detections</span></div>'
      + '  <div><strong>' + adminEsc(after.detections || 0) + '</strong><span>upgrade detections</span></div>'
      + '  <div><strong>' + adminEsc((delta.score == null ? '-' : delta.score)) + '</strong><span>score</span></div>'
      + '</div>'
      + '<div class="eval-species">'
      + '  <div><h5>new after upgrade</h5>' + evalSpeciesList((j.species || {}).gained) + '</div>'
      + '  <div><h5>missing after upgrade</h5>' + evalSpeciesList((j.species || {}).lost) + '</div>'
      + '</div>';
  }

  function evalMetric(label, before, after, deltaHtml) {
    return '<div class="eval-metric">'
      + '<span>' + adminEsc(label) + '</span>'
      + '<strong>' + adminEsc(after) + '</strong>'
      + '<small>was ' + adminEsc(before) + ' ' + deltaHtml + '</small>'
      + '</div>';
  }

  function wireFilterEvalTool() {
    var card = document.getElementById('filterEvalTool');
    if (!card) return;
    var range = card.querySelector('#filterEvalRange');
    var btn = card.querySelector('#filterEvalRefresh');
    var out = card.querySelector('#filterEvalOut');
    function loadEval() {
      var hours = +(range && range.value) || 24;
      out.innerHTML = '<div class="purge-loading">evaluating comparable windows...</div>';
      if (btn) btn.disabled = true;
      fetch(apiUrl('birdnet-api.php?action=filter_eval&hours=' + encodeURIComponent(hours)), {
        credentials: 'same-origin', cache: 'no-store',
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { out.innerHTML = renderFilterEval(j); })
        .catch(function (e) { out.innerHTML = '<div class="out err">' + adminEsc(e.message || 'evaluation failed') + '</div>'; })
        .finally(function () { if (btn) btn.disabled = false; });
    }
    if (range) range.addEventListener('change', loadEval);
    if (btn) btn.addEventListener('click', loadEval);
    loadEval();
  }

  function wireMicEvalTool() {
    var card = document.getElementById('micEvalTool');
    if (!card) return;
    var label = card.querySelector('#micEvalLabel');
    var changed = card.querySelector('#micEvalChangedAt');
    var range = card.querySelector('#micEvalRange');
    var btn = card.querySelector('#micEvalRefresh');
    var out = card.querySelector('#micEvalOut');
    if (changed && !changed.value) changed.value = defaultMicEvalChangedAt();
    function loadEval() {
      var hours = +(range && range.value) || 24;
      var changedAt = changed && changed.value ? changed.value : defaultMicEvalChangedAt();
      var labelText = label && label.value ? label.value : '';
      out.innerHTML = '<div class="purge-loading">evaluating hardware change...</div>';
      if (btn) btn.disabled = true;
      fetch(apiUrl('birdnet-api.php?action=mic_eval&hours=' + encodeURIComponent(hours) + '&changed_at=' + encodeURIComponent(changedAt) + '&label=' + encodeURIComponent(labelText)), {
        credentials: 'same-origin', cache: 'no-store',
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { out.innerHTML = renderMicEval(j); })
        .catch(function (e) { out.innerHTML = '<div class="out err">' + adminEsc(e.message || 'evaluation failed') + '</div>'; })
        .finally(function () { if (btn) btn.disabled = false; });
    }
    if (label) label.addEventListener('change', loadEval);
    if (changed) changed.addEventListener('change', loadEval);
    if (range) range.addEventListener('change', loadEval);
    if (btn) btn.addEventListener('click', loadEval);
    loadEval();
  }

  function renderBirdfyStatus(j) {
    if (!j) return '<div class="purge-loading">loading Birdfy status...</div>';
    var state = j.enabled ? 'enabled' : 'disabled';
    var configured = j.configured ? 'configured' : 'not configured';
    var localCount = j.local_count == null ? '-' : j.local_count;
    var lastSeen = j.last_seen || '-';
    var message = j.message || j.error || '';
    return ''
      + '<div class="birdfy-status">'
      + '  <div><strong>' + adminEsc(state) + '</strong><span>import</span></div>'
      + '  <div><strong>' + adminEsc(configured) + '</strong><span>login</span></div>'
      + '  <div><strong>' + adminEsc(localCount) + '</strong><span>camera rows</span></div>'
      + '</div>'
      + '<div class="birdfy-note">last seen ' + adminEsc(lastSeen) + '</div>'
      + (message ? '<div class="birdfy-note">' + adminEsc(message) + '</div>' : '');
  }

  function wireBirdfyTool() {
    var card = document.getElementById('birdfyTool');
    if (!card) return;
    var out = card.querySelector('#birdfyOut');
    var refresh = card.querySelector('#birdfyRefresh');
    var sync = card.querySelector('#birdfySync');
    function loadStatus() {
      if (out) out.innerHTML = '<div class="purge-loading">loading Birdfy status...</div>';
      if (refresh) refresh.disabled = true;
      fetch(apiUrl('birdfy-api.php?action=status'), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { if (out) out.innerHTML = renderBirdfyStatus(j); })
        .catch(function (e) { if (out) out.innerHTML = '<div class="out err">' + adminEsc(e.message || 'Birdfy status failed') + '</div>'; })
        .finally(function () { if (refresh) refresh.disabled = false; });
    }
    function runSync() {
      if (out) out.innerHTML = '<div class="purge-loading">probing Birdfy...</div>';
      if (sync) sync.disabled = true;
      fetch(apiUrl('birdfy-api.php?action=sync'), { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          var j = res.j || {};
          if (!res.ok || !j.ok) {
            if (out) out.innerHTML = '<div class="out err">' + adminEsc(j.error || 'Birdfy sync failed') + '</div>';
            return;
          }
          if (out) out.innerHTML = renderBirdfyStatus(j)
            + '<div class="out ok">imported ' + adminEsc(j.imported || 0) + ' events</div>';
          DATA.visual = null;
          refreshRecent();
        })
        .catch(function (e) { if (out) out.innerHTML = '<div class="out err">' + adminEsc(e.message || 'Birdfy sync failed') + '</div>'; })
        .finally(function () { if (sync) sync.disabled = false; });
    }
    if (refresh) refresh.addEventListener('click', loadStatus);
    if (sync) sync.addEventListener('click', runSync);
    loadStatus();
  }

  function fmtDb(v) {
    return v == null || !isFinite(+v) ? '-' : (+v).toFixed(1) + ' dBFS';
  }

  function renderMicHealth(j) {
    if (!j) return '<div class="purge-loading">checking mic health...</div>';
    if (!j.ok) {
      return '<div class="out err">' + adminEsc(j.error || 'mic health unavailable') + '</div>'
        + (j.message ? '<div class="birdfy-note">' + adminEsc(j.message) + '</div>' : '');
    }
    var verdict = j.verdict || { tone: 'neutral', label: 'unknown', explain: '' };
    var gain = j.gain || {};
    var gainPct = gain.ok ? (+gain.percent || 0) : 0;
    var agc = gain.hardware_agc && gain.hardware_agc.ok ? ('hardware agc ' + (gain.hardware_agc.enabled ? 'on' : 'off')) : 'hardware agc unavailable';
    var gainHtml = gain.ok
      ? '<div class="mic-gain-control">'
        + '  <div class="head"><span class="label">capture gain</span><span class="value" id="micGainValue">' + adminEsc(gainPct + '%') + '</span></div>'
        + '  <input id="micGainRange" type="range" min="0" max="100" step="1" value="' + adminEsc(gainPct) + '">'
        + '  <div class="mic-gain-actions">'
        + '    <button id="micGainApply" type="button">apply gain</button>'
        + '    <button id="micGainAuto" type="button">auto</button>'
        + '  </div>'
        + '  <div class="birdfy-note" id="micGainNote">' + adminEsc(agc + ' · ' + (gainPct >= 100 ? 'capture gain is already at maximum' : 'adjust, then apply')) + '</div>'
        + '</div>'
      : '<div class="out err">' + adminEsc(gain.error || 'capture gain unavailable') + '</div>';
    return ''
      + '<div class="eval-verdict ' + adminEsc(verdict.tone || 'neutral') + '">'
      + '  <strong>' + adminEsc(verdict.label || 'unknown') + '</strong>'
      + '  <span>' + adminEsc(verdict.explain || '') + '</span>'
      + '</div>'
      + '<div class="mic-health-grid">'
      + '  <div><strong>' + adminEsc(fmtDb(j.peak_dbfs)) + '</strong><span>peak</span></div>'
      + '  <div><strong>' + adminEsc(fmtDb(j.rms_dbfs)) + '</strong><span>average</span></div>'
      + '  <div><strong>' + adminEsc(fmtDb(j.noise_floor_dbfs)) + '</strong><span>noise floor</span></div>'
      + '  <div><strong>' + adminEsc((+j.clipping_pct || 0).toFixed(3) + '%') + '</strong><span>clipping</span></div>'
      + '</div>'
      + '<div class="eval-settings">'
      + '  <span>' + adminEsc(j.duration_s || '-') + 's sample</span>'
      + '  <span>' + adminEsc(j.sample_rate || '-') + ' hz</span>'
      + '  <span>' + adminEsc(j.channels || '-') + ' channels</span>'
      + '  <span>' + adminEsc(j.file || '-') + '</span>'
      + '  <span>' + adminEsc(j.age_s == null ? '-' : Math.round(+j.age_s) + 's old') + '</span>'
      + '</div>'
      + gainHtml
      + (j.message ? '<div class="birdfy-note">' + adminEsc(j.message) + '</div>' : '');
  }

  function wireMicHealthTool() {
    var card = document.getElementById('micHealthTool');
    if (!card) return;
    var btn = card.querySelector('#micHealthRefresh');
    var out = card.querySelector('#micHealthOut');
    function wireGainControls() {
      var range = card.querySelector('#micGainRange');
      var value = card.querySelector('#micGainValue');
      var apply = card.querySelector('#micGainApply');
      var auto = card.querySelector('#micGainAuto');
      var note = card.querySelector('#micGainNote');
      if (range && value) {
        range.addEventListener('input', function () {
          value.textContent = range.value + '%';
          if (note) note.textContent = 'change pending';
        });
      }
      if (apply && range) {
        apply.addEventListener('click', function () {
          apply.disabled = true;
          if (note) note.textContent = 'applying gain...';
          fetch(apiUrl('birdnet-status.php?action=mic_gain'), {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ percent: +range.value }),
          })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (res) {
              if (!res.ok || !res.j.set_ok) throw new Error(res.j.error || 'gain update failed');
              if (note) note.textContent = 'gain set to ' + (res.j.percent == null ? range.value : res.j.percent) + '%';
              setTimeout(loadMicHealth, 900);
            })
            .catch(function (e) { if (note) note.textContent = e.message || 'gain update failed'; })
            .finally(function () { apply.disabled = false; });
        });
      }
      if (auto) {
        auto.addEventListener('click', function () {
          auto.disabled = true;
          if (note) note.textContent = 'checking auto gain...';
          fetch(apiUrl('birdnet-status.php?action=mic_auto_gain'), {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
          })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (res) {
              if (!res.ok || !res.j.ok) throw new Error(res.j.error || 'auto gain failed');
              if (note) note.textContent = res.j.reason || 'auto gain checked';
              setTimeout(loadMicHealth, 900);
            })
            .catch(function (e) { if (note) note.textContent = e.message || 'auto gain failed'; })
            .finally(function () { auto.disabled = false; });
        });
      }
    }
    function loadMicHealth() {
      if (out) out.innerHTML = '<div class="purge-loading">checking latest recording segment...</div>';
      if (btn) btn.disabled = true;
      fetch(apiUrl('birdnet-status.php?action=mic_health'), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { if (out) out.innerHTML = renderMicHealth(j); wireGainControls(); })
        .catch(function (e) { if (out) out.innerHTML = '<div class="out err">' + adminEsc(e.message || 'mic health failed') + '</div>'; })
        .finally(function () { if (btn) btn.disabled = false; });
    }
    if (btn) btn.addEventListener('click', loadMicHealth);
    loadMicHealth();
  }

  function renderAdminTools() {
    var actions = [
      ['restart birdnet_recording', 'picks up live audio from the mic. restart this first if detections stall.', 'birdnet_recording'],
      ['restart birdnet_analysis',  'runs the neural net on recorded chunks. restart if detections are stuck.', 'birdnet_analysis'],
      ['restart birdnet_log',       'writes the sqlite db. restart if api/stats stops updating.', 'birdnet_log'],
      ['restart spectrogram_viewer','live fft view (legacy) - used by /birdnet/spectrogram.', 'spectrogram_viewer'],
      ['restart livestream',        'icecast feed for the drawer live-audio button.', 'livestream'],
      ['restart icecast2',          'web audio streaming server (fronts livestream).', 'icecast2'],
    ];
    var html = '<div class="admin-actions-grid">';
    actions.forEach(function (a) {
      html += '<div class="admin-action">'
        + '<h4>' + adminEsc(a[0]) + '</h4>'
        + '<p>' + adminEsc(a[1]) + '</p>'
        + '<button class="run" type="button" data-unit="' + adminEsc(a[2]) + '">run</button>'
        + '<div class="out" data-out="' + adminEsc(a[2]) + '"></div>'
        + '</div>';
    });
    html += '</div>';
    html += '<h2 class="admin-section-head">recordings</h2>';
    html += '<div class="admin-actions-grid">';
    html += '<div class="admin-action purge" id="purgeTool">'
      + '<h4>delete recordings</h4>'
      + '<p>Preview and permanently erase detections from a recent window. Type DELETE to unlock the button.</p>'
      + '<div class="purge-controls">'
      + '  <label for="purgeRange">range</label>'
      + '  <select id="purgeRange">'
      + '    <option value="1">1 hour</option>'
      + '    <option value="12">12 hours</option>'
      + '    <option value="24" selected>24 hours</option>'
      + '    <option value="168">7 days</option>'
      + '    <option value="720">30 days</option>'
      + '    <option value="2160">90 days</option>'
      + '    <option value="1000000">all time</option>'
      + '  </select>'
      + '</div>'
      + '<div id="purgePreview" class="purge-preview"><div class="purge-loading">checking selected range...</div></div>'
      + '<div class="purge-confirm">'
      + '  <input id="purgeConfirm" type="text" autocomplete="off" spellcheck="false" placeholder="type DELETE">'
      + '  <button id="purgeDelete" class="danger" type="button" disabled>delete selected</button>'
      + '</div>'
      + '<div class="out purge-out" id="purgeOut"></div>'
      + '</div>';
    html += '</div>';
    html += '<h2 class="admin-section-head">experiments</h2>';
    html += '<div class="admin-actions-grid">';
    html += '<div class="admin-action mic-health" id="micHealthTool">'
      + '<h4>mic health</h4>'
      + '<p>Analyzes the newest BirdNET recording segment for input level, clipping, and background noise.</p>'
      + '<div class="purge-controls eval-controls">'
      + '  <label>audio</label>'
      + '  <button id="micHealthRefresh" type="button">refresh</button>'
      + '</div>'
      + '<div id="micHealthOut" class="eval-out"><div class="purge-loading">checking mic health...</div></div>'
      + '</div>';
    html += '<div class="admin-action mic-eval" id="micEvalTool">'
      + '<h4>mic upgrade evaluation</h4>'
      + '<p>Compares detections before and after a microphone, sound-card, gain, or dish change.</p>'
      + '<div class="purge-controls eval-controls eval-controls-wide">'
      + '  <label for="micEvalLabel">upgrade</label>'
      + '  <input id="micEvalLabel" type="text" maxlength="80" autocomplete="off" spellcheck="true" placeholder="Andrea USB-SA + parabolic dish">'
      + '  <button id="micEvalRefresh" type="button">refresh</button>'
      + '</div>'
      + '<div class="purge-controls eval-controls eval-controls-wide">'
      + '  <label for="micEvalChangedAt">changed</label>'
      + '  <input id="micEvalChangedAt" type="datetime-local">'
      + '  <span></span>'
      + '</div>'
      + '<div class="purge-controls eval-controls">'
      + '  <label for="micEvalRange">range</label>'
      + '  <select id="micEvalRange">'
      + '    <option value="6">6 hours</option>'
      + '    <option value="12">12 hours</option>'
      + '    <option value="24" selected>24 hours</option>'
      + '    <option value="48">48 hours</option>'
      + '    <option value="168">7 days</option>'
      + '    <option value="720">30 days</option>'
      + '  </select>'
      + '</div>'
      + '<div id="micEvalOut" class="eval-out"><div class="purge-loading">loading evaluation...</div></div>'
      + '</div>';
    html += '<div class="admin-action filter-eval" id="filterEvalTool">'
      + '<h4>audio filter evaluation</h4>'
      + '<p>Compares the recent window to the previous equal window using BirdNET confidence. Best used after changing filter settings.</p>'
      + '<div class="purge-controls eval-controls">'
      + '  <label for="filterEvalRange">range</label>'
      + '  <select id="filterEvalRange">'
      + '    <option value="6">6 hours</option>'
      + '    <option value="12">12 hours</option>'
      + '    <option value="24" selected>24 hours</option>'
      + '    <option value="48">48 hours</option>'
      + '    <option value="168">7 days</option>'
      + '  </select>'
      + '  <button id="filterEvalRefresh" type="button">refresh</button>'
      + '</div>'
      + '<div id="filterEvalOut" class="eval-out"><div class="purge-loading">loading evaluation...</div></div>'
      + '</div>';
    html += '<div class="admin-action birdfy-tool" id="birdfyTool">'
      + '<h4>Birdfy camera sync</h4>'
      + '<p>Checks the local camera-sighting table and probes Birdfy login/device access. Camera-seen birds get an eye badge on the collage.</p>'
      + '<div class="purge-controls eval-controls">'
      + '  <label>birdfy</label>'
      + '  <button id="birdfyRefresh" type="button">status</button>'
      + '  <button id="birdfySync" type="button">sync</button>'
      + '</div>'
      + '<div id="birdfyOut" class="eval-out"><div class="purge-loading">loading Birdfy status...</div></div>'
      + '</div>';
    html += '</div>';
    html += '<h2 class="admin-section-head">heal / update</h2>';
    html += '<div class="admin-actions-grid">';
    function deployCard(title, desc, lines) {
      return '<div class="admin-action deploy">'
        + '<h4>' + adminEsc(title) + '</h4>'
        + '<p>' + adminEsc(desc) + '</p>'
        + '<pre>' + adminEsc(lines.join('\n')) + '</pre>'
        + '<button class="copy" type="button">copy</button>'
        + '</div>';
    }
    html += deployCard('pull latest from github',
      'fetches the newest AvianVisitors + BirdNET-Pi changes; the symlinks already in /BirdSongs/Extracted/ pick up new code on the next request.',
      [
        'cd ~/BirdNET-Pi && git pull',
        '# substitute the right php-fpm unit if your debian ships a different version:',
        'sudo systemctl reload caddy "$(systemctl list-unit-files \'php*-fpm.service\' --no-legend | awk \'{print $1; exit}\')"',
      ]);
    html += deployCard('rerun install_services.sh',
      'refreshes every symlink + service file. safe to run anytime; only takes ~10 seconds.',
      [
        'cd ~/BirdNET-Pi && ./scripts/install_services.sh',
      ]);
    html += '</div>';
    adminBody.innerHTML = html;
    wirePurgeTool();
    wireMicHealthTool();
    wireMicEvalTool();
    wireFilterEvalTool();
    wireBirdfyTool();
    // Wire restart buttons + copy buttons.
    adminBody.querySelectorAll('.admin-action button.run').forEach(function (b) {
      b.addEventListener('click', function () {
        var unit = b.dataset.unit;
        if (!confirm('restart ' + unit + '?')) return;
        b.disabled = true; var old = b.textContent; b.textContent = '...';
        var out = adminBody.querySelector('.out[data-out="' + unit.replace(/[^a-z0-9_.-]/gi,'_') + '"]');
        fetch(apiUrl('birdnet-status.php?action=restart&unit=' + encodeURIComponent(unit)), {
          method: 'POST', credentials: 'same-origin',
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            b.textContent = j.ok ? 'restarted' : 'failed';
            if (out) out.textContent = (j.ok ? 'ok' : 'rc=' + j.rc) + (j.out ? '\n' + j.out : '');
            setTimeout(function () { b.disabled = false; b.textContent = old; }, 2000);
          })
          .catch(function (e) {
            b.textContent = 'error'; b.disabled = false;
            if (out) out.textContent = e.message || 'request failed';
            setTimeout(function () { b.textContent = old; }, 2000);
          });
      });
    });
    adminBody.querySelectorAll('.admin-action button.copy').forEach(function (b) {
      b.addEventListener('click', function () {
        var pre = b.previousElementSibling;
        if (!pre) return;
        navigator.clipboard.writeText(pre.textContent).then(function () {
          var old = b.textContent; b.textContent = 'copied ✓';
          setTimeout(function () { b.textContent = old; }, 1400);
        });
      });
    });
  }

  // Initial load: if URL has a sci hash, jump to atlas, highlight, and
  // open the modal.
  if (readHash()) { go(2); highlightAtlas(readHash()); openDetailModal(readHash()); }
  // Admin overlay routing: #admin=system|logs|tools opens the admin
  // screen with that sub-tab. Clearing the hash closes it.
  function readAdminHash() {
    var m = location.hash.match(/^#admin=([a-z]+)/);
    return m ? m[1] : null;
  }
  // #about - brief explainer popup; reached via /about (302 -> /#about)
  // or the masthead eyebrow. aria-hidden drives the CSS fade/slide.
  function openAbout()  { document.getElementById('about-modal').setAttribute('aria-hidden', 'false'); }
  function closeAbout() { document.getElementById('about-modal').setAttribute('aria-hidden', 'true'); }
  function syncRouter() {
    window.__lastHashchange = Date.now();
    var sci = readHash();
    var adm = readAdminHash();
    if (location.hash === '#about') openAbout(); else closeAbout();
    if (adm) { openAdmin(adm); return; }
    closeAdmin();
    if (sci) { go(2); highlightAtlas(sci); openDetailModal(sci); }
    else     { highlightAtlas(null); closeDetailModal(); }
  }
  if (readAdminHash()) openAdmin(readAdminHash());
  if (location.hash === '#about') openAbout();
  window.addEventListener('hashchange', syncRouter);

  // Modal interactions: backdrop / close button -> clear the hash.
  document.getElementById('detail-modal').addEventListener('click', function (ev) {
    if (ev.target.dataset && ev.target.dataset.close === '1') {
      if (location.hash) { location.hash = ''; } else { closeDetailModal(); }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' &&
        document.getElementById('detail-modal').getAttribute('aria-hidden') === 'false') {
      if (location.hash) { location.hash = ''; } else { closeDetailModal(); }
    }
  });

  // About popup: backdrop / close / explore button all carry data-close,
  // which clears the hash and routes through syncRouter -> closeAbout.
  // The masthead eyebrow opens it; Escape dismisses it.
  var statsTimelineEl = document.getElementById('statsTimeline');
  if (statsTimelineEl) {
    statsTimelineEl.addEventListener('click', handleStatsClockActivate);
    statsTimelineEl.addEventListener('keydown', handleStatsClockActivate);
  }

  document.getElementById('about-modal').addEventListener('click', function (ev) {
    if (ev.target.dataset && ev.target.dataset.close === '1') {
      if (location.hash) { location.hash = ''; } else { closeAbout(); }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' &&
        document.getElementById('stats-clock-zoom-modal') &&
        document.getElementById('stats-clock-zoom-modal').getAttribute('aria-hidden') === 'false') {
      closeStatsClockZoom();
      return;
    }
    if (ev.key === 'Escape' &&
        document.getElementById('about-modal').getAttribute('aria-hidden') === 'false') {
      if (location.hash) { location.hash = ''; } else { closeAbout(); }
    }
  });
  document.getElementById('aboutLink').addEventListener('click', function () {
    location.hash = '#about';
  });

  // Shared decode context for spectrogram generation. Lives once for
  // the page; lazily created on first expand to avoid bootstrapping
  // WebAudio if no one ever opens a row.
  var _specAudioCtx = null;
  function getSpecCtx() {
    if (!_specAudioCtx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) _specAudioCtx = new C();
    }
    return _specAudioCtx;
  }

  // Cache decoded AudioBuffers per file so repeated expand/collapse on
  // the same row doesn't re-fetch + re-decode the mp3.
  var _decodedCache = {};

  // Minimal in-place Cooley-Tukey radix-2 FFT (n must be a power of 2).
  // Operates on parallel real/imag Float32Array buffers. ~30 lines and
  // fast enough for our ~1024-sample windows of 3-second clips.
  function _fft(real, imag) {
    var n = real.length;
    var j = 0;
    for (var i = 0; i < n - 1; i++) {
      if (i < j) {
        var tr = real[i]; real[i] = real[j]; real[j] = tr;
        var ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      var k = n >> 1;
      while (k <= j) { j -= k; k >>= 1; }
      j += k;
    }
    for (var stage = 2; stage <= n; stage *= 2) {
      var half = stage >> 1;
      var ang = -2 * Math.PI / stage;
      var wR = Math.cos(ang), wI = Math.sin(ang);
      for (var sBase = 0; sBase < n; sBase += stage) {
        var cR = 1, cI = 0;
        for (var sb = 0; sb < half; sb++) {
          var a = sBase + sb;
          var b = a + half;
          var trA = real[b] * cR - imag[b] * cI;
          var tiA = real[b] * cI + imag[b] * cR;
          real[b] = real[a] - trA;
          imag[b] = imag[a] - tiA;
          real[a] = real[a] + trA;
          imag[a] = imag[a] + tiA;
          var nR = cR * wR - cI * wI;
          cI = cR * wI + cI * wR;
          cR = nR;
        }
      }
    }
  }

  // Paint an STFT spectrogram onto the strip's canvas. y-axis is the
  // bird audible band (~200 Hz - ~10 kHz) on a mildly compressed log
  // scale; x-axis is time across the whole clip; colour is dB
  // magnitude mapped to our warm ink palette over the dark paper-ink
  // ground.
  function paintSpectrogram(canvas, audioBuffer) {
    // Defer to the next animation frame so the canvas has been laid out
    // (the parent strip may still be mid-transition expanding from 0).
    // Without this, subsequent expansions paint onto a zero-sized canvas.
    requestAnimationFrame(function () {
      _paintSpectrogramNow(canvas, audioBuffer);
    });
  }
  function _paintSpectrogramNow(canvas, audioBuffer) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    // Read parent strip's box, not the canvas (canvas might be 0-sized
    // briefly during expansion). The strip's expanded height is 88px;
    // width is the row width.
    var strip = canvas.parentElement;
    var cssW = strip ? strip.clientWidth : (canvas.clientWidth || 600);
    var cssH = strip ? strip.clientHeight : (canvas.clientHeight || 88);
    if (cssW < 32 || cssH < 32) {
      // Strip still collapsing in. Retry a frame later.
      requestAnimationFrame(function () { _paintSpectrogramNow(canvas, audioBuffer); });
      return;
    }
    var W = Math.max(1, Math.floor(cssW * dpr));
    var H = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = W; canvas.height = H;

    var ctx = canvas.getContext('2d');
    var samples = audioBuffer.getChannelData(0);
    var sr = audioBuffer.sampleRate;
    var FFT_SIZE = 1024;
    var bins = FFT_SIZE >> 1;
    var nyquist = sr / 2;

    // Frequency-band mapping (Hz -> bin) for the bird-relevant band.
    // Most North American songbirds + corvids range 250 Hz - 8 kHz, but
    // hummingbirds, kinglets, and warblers reach 12 kHz. Push the cap
    // up so we don't miss the high-frequency tail.
    var fLo = 200, fHi = Math.min(12000, nyquist);
    var binLo = Math.max(1, Math.floor(fLo / nyquist * bins));
    var binHi = Math.min(bins - 1, Math.ceil(fHi / nyquist * bins));

    // Hann window
    var win = new Float32Array(FFT_SIZE);
    for (var i = 0; i < FFT_SIZE; i++) {
      win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
    }

    // Choose a hop that lays exactly W columns over the whole clip.
    var hop = Math.max(1, Math.floor((samples.length - FFT_SIZE) / Math.max(1, W - 1)));
    var real = new Float32Array(FFT_SIZE);
    var imag = new Float32Array(FFT_SIZE);

    var imgData = ctx.createImageData(W, H);
    var data = imgData.data;

    // Page-paper ground; ink intensifies where there's audio energy.
    // Matches the sketch palette (paper #f5f0e6 background, ink
    // #1a1612 strokes).
    var BG_R = 245, BG_G = 240, BG_B = 230;
    var FG_R = 26,  FG_G = 22,  FG_B = 18;
    for (var p = 0; p < data.length; p += 4) {
      data[p] = BG_R; data[p + 1] = BG_G; data[p + 2] = BG_B; data[p + 3] = 255;
    }

    // Precompute row -> bin map (log-ish so low freqs get more space).
    var rowToBin = new Int32Array(H);
    for (var row = 0; row < H; row++) {
      var t = 1 - row / (H - 1); // 1 at top, 0 at bottom
      var bin = Math.round(binLo + (binHi - binLo) * Math.pow(t, 1.55));
      rowToBin[row] = Math.max(binLo, Math.min(binHi, bin));
    }

    for (var col = 0; col < W; col++) {
      var start = col * hop;
      if (start + FFT_SIZE > samples.length) break;
      for (var s = 0; s < FFT_SIZE; s++) {
        real[s] = samples[start + s] * win[s];
        imag[s] = 0;
      }
      _fft(real, imag);
      for (var row2 = 0; row2 < H; row2++) {
        var bin2 = rowToBin[row2];
        var re = real[bin2], im = imag[bin2];
        var mag = Math.sqrt(re * re + im * im);
        // log compress; -75 .. -10 dB -> 0 .. 1
        var db = 20 * Math.log10(mag + 1e-9);
        var v = (db + 75) / 65;
        if (v < 0) v = 0; else if (v > 1) v = 1;
        // Ink-on-paper palette: low energy -> paper, high energy -> ink.
        // Smoothstep for a softer falloff between the two extremes.
        var e = v * v * (3 - 2 * v);
        var r = BG_R + Math.round((FG_R - BG_R) * e);
        var g = BG_G + Math.round((FG_G - BG_G) * e);
        var b = BG_B + Math.round((FG_B - BG_B) * e);
        var px = (row2 * W + col) * 4;
        data[px] = r; data[px + 1] = g; data[px + 2] = b; data[px + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    canvas.classList.add('ready');
  }

  // Lazy-add + paint the canvas-based spectrogram for a row's strip.
  // Decoded buffers are cached per file so re-expanding is instant.
  function ensureSpectroImage(row) {
    var file = row && row.dataset.file;
    if (!file) return;
    var strip = row.querySelector('.rec-spectro');
    if (!strip) return;
    var loadingEl = strip.querySelector('.rec-spectro-loading');
    var canvas = strip.querySelector('canvas');
    if (canvas && canvas.classList.contains('ready')) {
      if (loadingEl) loadingEl.style.display = 'none';
      return;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      var played = strip.querySelector('.rec-spectro-played');
      strip.insertBefore(canvas, played);
    }
    if (loadingEl) {
      loadingEl.style.display = '';
      loadingEl.textContent = 'rendering spectrogram...';
    }

    function done() {
      if (loadingEl) loadingEl.style.display = 'none';
    }
    function fail(reason) {
      if (loadingEl) {
        loadingEl.style.display = '';
        loadingEl.textContent = reason || 'spectrogram unavailable';
      }
    }

    if (_decodedCache[file]) {
      paintSpectrogram(canvas, _decodedCache[file]);
      done();
      return;
    }
    var ctx = getSpecCtx();
    if (!ctx) { fail('WebAudio not available'); return; }
    fetch(apiUrl('recording.php?file=' + encodeURIComponent(file)))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) { return ctx.decodeAudioData(buf); })
      .then(function (audioBuffer) {
        _decodedCache[file] = audioBuffer;
        paintSpectrogram(canvas, audioBuffer);
        done();
      })
      .catch(function (e) {
        fail('spectrogram failed: ' + (e && e.message ? e.message : ''));
      });
  }

  // Per-recording row interactions in the modal:
  //   - Clicking anywhere on the row toggles the spectrogram strip
  //     (independent of playback). Click again to collapse.
  //   - Clicking the play button toggles audio playback. Playback shows
  //     the moving cursor on whatever strip is already expanded; if the
  //     strip is collapsed, playing also expands it.
  //   - Clicking on the spectrogram itself scrubs (handled in the
  //     mousedown/touchstart wiring further down).
  document.getElementById('modalRecordings').addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    // Scrub-region clicks are handled by the mousedown wiring below.
    if (ev.target.closest('.rec-spectro-scrub')) return;

    var deleteBtn = ev.target.closest('.rec-delete');
    if (deleteBtn) {
      var drow = deleteBtn.closest('.rec-row');
      var dfile = drow && drow.dataset.file;
      var dsci = (document.getElementById('modalSci').textContent || '').trim();
      if (!drow || !dfile || drow.dataset.deleting === 'true') return;
      var when = drow.querySelector('.when');
      var label = when ? when.textContent.replace(/\s+/g, ' ').trim() : dfile;
      if (!window.confirm('Delete this detection recording?\n\n' + label)) return;
      if (modalRecBtn && modalRecBtn.closest('.rec-row') === drow) stopModalAudio();
      drow.dataset.deleting = 'true';
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '<span class="rec-delete-busy">...</span>';
      fetch(apiUrl('delete-recording.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: dfile,
          sci: dsci,
          date: drow.dataset.date || '',
          time: drow.dataset.time || ''
        })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
            return j;
          });
        })
        .then(function () {
          delete SPECIES_CACHE[dsci];
          drow.remove();
          refreshRecent();
          openDetailModal(dsci);
        })
        .catch(function (e) {
          drow.removeAttribute('data-deleting');
          deleteBtn.disabled = false;
          deleteBtn.innerHTML = ICON_TRASH;
          window.alert('Could not delete recording: ' + (e && e.message ? e.message : 'unknown error'));
        });
      return;
    }

    var playBtn = ev.target.closest('.play');
    if (playBtn) {
      // Play / pause toggle. Three cases:
      //   (a) clicking the playing row's button -> pause (KEEP audio
      //       alive so the user can scrub then resume).
      //   (b) clicking a paused row's button (it's still modalRecBtn,
      //       audio still alive, just paused) -> resume from cursor.
      //   (c) clicking a different row's button -> stop the old, start
      //       the new.
      var prow = playBtn.closest('.rec-row');
      var pfile = prow && prow.dataset.file;
      if (!pfile) return;

      if (modalRecBtn === playBtn && modalAudio) {
        // Same row's button - toggle pause/resume.
        if (modalAudio.paused) {
          playBtn.setAttribute('data-active', 'true');
          playBtn.innerHTML = ICON_PAUSE;
          modalAudio.play().catch(function () {});
        } else {
          pauseModalAudio();
        }
        return;
      }

      // Different row (or no current playback) - stop any current,
      // start fresh.
      stopModalAudio();
      playBtn.setAttribute('data-active', 'true');
      playBtn.innerHTML = ICON_PAUSE;
      modalRecBtn = playBtn;
      prow.classList.add('expanded');
      ensureSpectroImage(prow);
      var strip = prow.querySelector('.rec-spectro');
      var audio = new Audio(apiUrl('recording.php?file=' + encodeURIComponent(pfile)));
      modalAudio = audio;
      audio.addEventListener('loadedmetadata', function () {
        strip.classList.add('armed');
      });
      audio.addEventListener('playing', startCursorLoop);
      audio.addEventListener('pause', stopCursorLoop);
      audio.addEventListener('ended', function () {
        // Natural end: rewind cursor + keep audio so user can replay.
        stopCursorLoop();
        var p = strip.querySelector('.rec-spectro-played');
        var c = strip.querySelector('.rec-spectro-cursor');
        if (p) p.style.width = '0%';
        if (c) c.style.left = '0%';
        if (modalAudio) modalAudio.currentTime = 0;
        if (modalRecBtn) {
          modalRecBtn.removeAttribute('data-active');
          modalRecBtn.innerHTML = ICON_PLAY;
        }
      });
      audio.addEventListener('error', function () {
        stopModalAudio();
        playBtn.innerHTML = '<span style="font-size:8px">!</span>';
        setTimeout(function () { playBtn.innerHTML = ICON_PLAY; }, 1500);
      });
      audio.play().catch(function () { stopModalAudio(); });
      return;
    }

    // Row click anywhere else -> toggle strip open/closed.
    var row = ev.target.closest('.rec-row');
    if (!row) return;
    var willExpand = !row.classList.contains('expanded');
    if (willExpand) {
      row.classList.add('expanded');
      ensureSpectroImage(row);
    } else {
      // Collapsing the row where playback is happening also stops audio
      // (the cursor would just be hidden otherwise).
      if (modalRecBtn && modalRecBtn.closest('.rec-row') === row) stopModalAudio();
      row.classList.remove('expanded');
    }
  });

  // Scrub by clicking / dragging on the spectrogram strip.
  (function () {
    var dragRow = null;
    function seekFromEvent(row, clientX) {
      if (!modalAudio || !modalAudio.duration) return;
      var rowBtn = row.querySelector('.play');
      if (rowBtn !== modalRecBtn) return;
      var strip = row.querySelector('.rec-spectro');
      var rect = strip.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      modalAudio.currentTime = pct * modalAudio.duration;
      // Repaint cursor + played immediately so the user sees the scrub
      // even when audio is paused (rAF loop isn't running then).
      var pctStr = (pct * 100).toFixed(2) + '%';
      var played = strip.querySelector('.rec-spectro-played');
      var cur = strip.querySelector('.rec-spectro-cursor');
      if (played) played.style.width = pctStr;
      if (cur) cur.style.left = pctStr;
    }
    document.getElementById('modalRecordings').addEventListener('mousedown', function (ev) {
      var s = ev.target.closest && ev.target.closest('.rec-spectro-scrub');
      if (!s) return;
      var row = s.closest('.rec-row');
      if (!row || !row.classList.contains('expanded')) return;
      dragRow = row;
      seekFromEvent(row, ev.clientX);
      ev.preventDefault();
    });
    document.addEventListener('mousemove', function (ev) {
      if (!dragRow) return;
      seekFromEvent(dragRow, ev.clientX);
    });
    document.addEventListener('mouseup', function () { dragRow = null; });
    // Touch.
    document.getElementById('modalRecordings').addEventListener('touchstart', function (ev) {
      var s = ev.target.closest && ev.target.closest('.rec-spectro-scrub');
      if (!s) return;
      var row = s.closest('.rec-row');
      if (!row || !row.classList.contains('expanded')) return;
      dragRow = row;
      seekFromEvent(row, ev.touches[0].clientX);
      ev.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (ev) {
      if (!dragRow) return;
      seekFromEvent(dragRow, ev.touches[0].clientX);
    });
    document.addEventListener('touchend', function () { dragRow = null; });
  })();

  // Any element with data-sci is a "jump to that bird's atlas card"
  // affordance: atlas cards themselves, stats list rows (top species /
  // first detections), and any future surface that wants to point at a
  // bird. Action chips inside cards stop propagation themselves.
  function jumpToSci(sci) {
    if (!sci) return;
    if (location.hash !== '#sci=' + encodeURIComponent(sci)) {
      location.hash = '#sci=' + encodeURIComponent(sci);
    } else {
      // Same hash -> still re-highlight (the user clicked it again).
      go(2); highlightAtlas(sci);
    }
  }
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    var card = ev.target.closest('.bird-card');
    if (card) {
      if (ev.target.closest('.actions, .spectro-wrap')) return;
      return jumpToSci(card.dataset.sci);
    }
    var row = ev.target.closest('li[data-sci]');
    if (row) return jumpToSci(row.dataset.sci);
  });

  // After the atlas re-renders (window change, fresh fetch), re-apply
  // any active hash so the highlight survives a rebuild.
  var _origRenderAtlas = renderAtlas;
  renderAtlas = function () {
    _origRenderAtlas();
    var s = readHash();
    if (s) highlightAtlas(s);
  };
})();
