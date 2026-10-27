
if (typeof pdfjsLib !== 'undefined') pdfjsLib.GlobalWorkerOptions.workerSrc = './assets/vendor/pdf.worker.min.js';

var BOOK = JSON.parse(document.getElementById('book-data').textContent);
// Keep source photos untouched; add a physical blank before the back cover
// only when an odd photo count would leave it in an open spread.
var photoPresentation = function photoPresentation(e){let t=e||{},n=(e,t,n,r)=>Number.isFinite(e)?Math.max(n,Math.min(r,e)):t;return{mode:[`contain`,`cover`,`spread`].includes(t.mode)?t.mode:`contain`,x:n(t.x,.5,0,1),y:n(t.y,.5,0,1),zoom:n(t.zoom,1,1,3)}};
var photoGeometry = function photoGeometry(e,t,n,r){let i=(e.rotation||0)%180!=0,a=i?e.height:e.width,o=i?e.width:e.height,s=r.mode!==`contain`,c=(s?Math.max(t/a,n/o):Math.min(t/a,n/o))*(s?r.zoom:1);return{width:e.width*c,height:e.height*c,x:t/2+(s?(t-a*c)*(r.x-.5):0),y:n/2+(s?(n-o*c)*(r.y-.5):0)}};
var arrangePhotos = function arrangePhotos(e,t){let n=[];return e.forEach((r,i)=>{let a=r.presentation?.mode===`spread`&&i>0&&i<e.length-1;a&&!t?(n.length%2==0&&n.push({blank:!0,sourceIndex:i}),n.push({...r,sourceIndex:i,half:`left`},{...r,sourceIndex:i,half:`right`})):n.push({...r,sourceIndex:i,wholePanorama:a,presentation:r.presentation?.mode===`spread`?{...r.presentation,mode:`contain`}:r.presentation})}),n.length>1&&n.length%2==1&&n.splice(n.length-1,0,{blank:!0,sourceIndex:e.length-1}),n};
var photoPages = BOOK.type === 'photos' ? arrangePhotos(BOOK.pages, false) : [];
var photoSingleLayout = false;
var rebuildingPhotos = false;
var PREVIEW = false;
var flipbookEl = null;
var pdfDoc = null;
var aspectRatio = 1;
var currentLayout = { width: 0, height: 0, isSinglePage: false };
var startPage = 0;
var pageFlip = null;
var rendered = {};
var renderErrors = {};
var pdfElements = {};
var rendering = {};
var generation = 0;
var renderQueue = [];
var activeRenders = 0;
var pdfTurnQueue = [];
var pdfFlipNow = null;
var wantedPages = {};
var imageUrls = {};
var photoElements = {};
var photoCenter = 1;
var photoDirection = 1;
var preloadPhotoOriginals = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
var nativeFullscreen = false;
var dpr = window.devicePixelRatio || 1;
var zoom = 1;
var pinch = { active: false, startDist: 0, startZoom: 1, ratio: 1 };
var bookTouch = null;
var turnSoundPlayer = null;

function syncViewport() {
  var workspace = document.getElementById('workspace');
  if (!workspace) return null;
  // Folded pages and shadows briefly extend past the viewport. Scrollbars at
  // fitted size would change its dimensions and make the whole stage jump.
  workspace.style.overflow = zoom > 1 ? 'auto' : 'hidden';
  var vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  if (!vw || !vh) return null;
  workspace.style.width = vw + 'px';
  workspace.style.height = vh + 'px';
  workspace.style.left = (window.visualViewport ? window.visualViewport.offsetLeft : 0) + 'px';
  workspace.style.top = (window.visualViewport ? window.visualViewport.offsetTop : 0) + 'px';
  return { width: workspace.clientWidth, height: workspace.clientHeight };
}

function computeLayout() {
  var viewport = syncViewport();
  if (!viewport) return null;
  // Use the actual CSS padding, including the device's safe areas.
  var style = getComputedStyle(document.getElementById('stage'));
  var availW = Math.max(20, viewport.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  var availH = Math.max(20, viewport.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  var isPortrait = availH >= availW;
  var basePageHeight = 1000;
  var basePageWidth = basePageHeight * aspectRatio;
  var bookW = isPortrait ? basePageWidth : basePageWidth * 2;
  var scale = Math.min(availW / bookW, availH / basePageHeight);
  return { width: Math.floor(bookW * scale), height: Math.floor(basePageHeight * scale), isSinglePage: isPortrait };
}

async function renderPage(pageNum) {
  if (rendered[pageNum] || rendering[pageNum] || renderErrors[pageNum]) return;
  var record = { generation: generation, task: null, cancelled: false };
  rendering[pageNum] = record;
  var stagingCanvas = null;
  try {
    if (BOOK.type === 'photos') {
      if (photoPages[pageNum - 1].blank) { rendered[pageNum] = 'blank'; setStatus(''); return; }
      await renderPhoto(pageNum, record);
      return;
    }
    var page = await pdfDoc.getPage(pageNum);
    if (record.generation !== generation || record.cancelled || !wantedPages[pageNum]) return;
    var canvas = pdfElements[pageNum];
    if (!canvas || !canvas.isConnected) return;
    var layout = currentLayout;
    var cssPageWidth = (layout.isSinglePage ? layout.width : layout.width / 2) * zoom;
    var vp1 = page.getViewport({ scale: 1 });
    // The bitmap dimensions are rounded to integers. Containing that rounded
    // ratio adds a hairline of paper even when the original PDF fits the sheet.
    // Exports of the same paper format can differ slightly in their PDF boxes.
    // Fit these sheets edge to edge; retain letterboxing for other page formats.
    canvas.style.objectFit = Math.abs((vp1.width / vp1.height) / aspectRatio - 1) < 0.002 ? 'fill' : 'contain';
    var scale = cssPageWidth > 0 ? (cssPageWidth * dpr) / vp1.width : dpr * 2;
    scale = Math.min(Math.max(scale, 1), 5);
    // Bound each bitmap and concurrency for mobile canvas/memory limits.
    scale = Math.min(scale, Math.sqrt(2000000 / (vp1.width * vp1.height)), 4096 / Math.max(vp1.width, vp1.height));
    var viewport = page.getViewport({ scale: scale });
    // PDF.js paints progressively. Publish only the completed bitmap so a turn
    // never reveals its temporarily black/unfinished canvas.
    stagingCanvas = document.createElement('canvas');
    stagingCanvas.width = Math.round(viewport.width);
    stagingCanvas.height = Math.round(viewport.height);
    var ctx = stagingCanvas.getContext('2d', { alpha: false });
    record.task = page.render({ canvasContext: ctx, viewport: viewport, intent: 'display' });
    await record.task.promise;
    if (record.generation === generation && wantedPages[pageNum] && canvas.isConnected) {
      copyPdfBitmap(stagingCanvas, canvas);
      var temporaryPage = pageFlip.getPage(pageNum - 1).getTemporaryCopy();
      if (temporaryPage) copyPdfBitmap(stagingCanvas, temporaryPage.getElement().querySelector('canvas'));
      rendered[pageNum] = true;
      setStatus('');
    }
  } catch (err) {
    if (record.generation === generation && (!err || err.name !== 'RenderingCancelledException')) {
      renderErrors[pageNum] = true;
      console.error(err);
      setStatus('Impossibile disegnare la pagina. Riduci lo zoom o riapri il file.');
    }
  } finally {
    if (stagingCanvas) { stagingCanvas.width = 0; stagingCanvas.height = 0; }
    if (record.generation === generation && !wantedPages[pageNum]) {
      var unusedCanvas = pdfElements[pageNum];
      if (unusedCanvas) { unusedCanvas.width = 0; unusedCanvas.height = 0; }
      releasePhoto(pageNum);
    }
    if (rendering[pageNum] === record) delete rendering[pageNum];
    if (record.generation === generation && record.cancelled && wantedPages[pageNum]) {
      renderQueue.push(pageNum);
    }
  }
}

function copyPdfBitmap(source, target) {
  if (!source || !target || !source.width || !source.height) return;
  target.width = source.width;
  target.height = source.height;
  target.getContext('2d', { alpha: false }).drawImage(source, 0, 0);
}

function releasePhoto(n) {
  var image = photoElements[n];
  // Keep the small preview on every sheet: PageFlip clones sheets during
  // portrait turns and can reveal a page outside the original render window.
  if (image) image.src = photoPreviewUrl(n);
  if (imageUrls[n]) delete imageUrls[n];
}

function photoPreviewUrl(n) {
  var photo = photoPages[n - 1];
  return 'data:' + (photo.thumbnail ? 'image/jpeg' : photo.mime) + ';base64,' + (photo.thumbnail || photo.base64);
}

function sizePhoto(image, n, stationaryWidth) {
  var photo = photoPages[n - 1];
  var angle = photo.rotation || 0;
  var swapped = angle % 180 !== 0;
  var pageW = stationaryWidth === undefined ? (currentLayout.isSinglePage ? currentLayout.width : currentLayout.width / 2) * zoom : stationaryWidth;
  var pageH = currentLayout.height * zoom;
  var presentation = photoPresentation(photo.presentation);
  if (presentation.mode !== 'contain') {
    var totalW = pageW;
    var halfOffset = 0;
    if (photo.half) {
      // Derive both halves from one spread coordinate system, including the
      // rounded stationary widths, rather than fitting two independent photos.
      var bounds = pageFlip ? pageFlip.getBoundsRect() : null;
      var baseW = bounds ? bounds.pageWidth : pageW;
      var leftW = baseW;
      totalW = baseW * 2;
      if (stationaryWidth !== undefined && bounds) {
        var origin = pageFlip.getUI().getDistElement().getBoundingClientRect().left;
        var start = Math.round(origin + bounds.left), middle = Math.round(origin + bounds.left + baseW);
        totalW = Math.round(origin + bounds.left + baseW * 2) - start;
        leftW = middle - start;
      }
      halfOffset = photo.half === 'right' ? leftW : 0;
    }
    var geometry = photoGeometry(photo, totalW, pageH, presentation);
    image.style.left = (geometry.x - halfOffset) + 'px';
    image.style.top = geometry.y + 'px';
    image.style.width = geometry.width + 'px';
    image.style.height = geometry.height + 'px';
    image.style.transform = 'translate(-50%, -50%) rotate(' + angle + 'deg)';
    return;
  }
  image.style.left = '50%'; image.style.top = '50%';
  var scale = Math.min(pageW / (swapped ? photo.height : photo.width), pageH / (swapped ? photo.width : photo.height));
  // One physical pixel of image bleed prevents its antialiased edge from
  // exposing paper, while the sheet itself remains clipped at the shared spine.
  var visualWidth = swapped ? photo.height : photo.width;
  if (stationaryWidth !== undefined && Math.abs(visualWidth * scale - pageW) < 1) {
    scale = (pageW + 2 / (window.devicePixelRatio || 1)) / visualWidth;
  }
  image.style.width = (photo.width * scale) + 'px';
  image.style.height = (photo.height * scale) + 'px';
  image.style.transform = 'translate(-50%, -50%) rotate(' + angle + 'deg)';
}

function photoQuality(n) {
  if (photoPages[n - 1].blank) return 'blank';
  if (photoPages[n - 1].display) {
    var visible = n === photoCenter || (!currentLayout.isSinglePage && n === photoCenter + 1);
    return zoom > 1 && visible ? 'original' : 'display';
  }
  if (preloadPhotoOriginals) return 'original';
  return n === photoCenter || (!currentLayout.isSinglePage && n === photoCenter + 1) ? 'original' : 'thumbnail';
}

async function renderPhoto(n, record) {
  var photo = photoPages[n - 1];
  var image = photoElements[n];
  if (!image || !image.isConnected || record.generation !== generation) return;
  var quality = photoQuality(n);
  record.quality = quality;
  var data = quality === 'display' ? photo.display : quality === 'thumbnail' && photo.thumbnail ? photo.thumbnail : photo.base64;
  var mime = quality === 'display' ? photo.displayMime : quality === 'thumbnail' && photo.thumbnail ? 'image/jpeg' : photo.mime;
  // Embedded data URLs also work in WebKit's offline mode. Decode only the
  // visible originals instead of allocating an extra byte buffer per image.
  var url = 'data:' + mime + ';base64,' + data;
  var loader = new Image();
  sizePhoto(image, n);
  await new Promise(function (resolve, reject) {
    record.task = { cancel: function () {
      loader.onload = null; loader.onerror = null; loader.removeAttribute('src');
      var error = new Error('Rendering annullato'); error.name = 'RenderingCancelledException'; reject(error);
    } };
    loader.onload = function () { loader.decode().then(resolve, reject); };
    loader.onerror = function () { reject(new Error('Foto non leggibile: ' + photo.name)); };
    loader.src = url;
  });
  loader.onload = null; loader.onerror = null;
  if (record.generation === generation && !record.cancelled && wantedPages[n]) {
    image.src = url;
    imageUrls[n] = url;
    rendered[n] = quality;
    setStatus('');
  }
}

function pdfPagesReady(indices) {
  return indices.every(function (index) {
    var n = index + 1, canvas = pdfElements[n];
    return rendered[n] && canvas && canvas.width > 0 && canvas.height > 0;
  });
}

function pdfTurnReady(direction) {
  var collection = pageFlip.getPageCollection();
  var spreads = collection.getSpread(), current = collection.getCurrentSpreadIndex();
  var target = current + (direction === 1 ? -1 : 1);
  return target >= 0 && target < spreads.length && pdfPagesReady(spreads[current].concat(spreads[target]));
}

function setStatus(message) {
  if (!message && BOOK.type === 'pdf' && pageFlip) {
    var collection = pageFlip.getPageCollection();
    var ready = pdfPagesReady(collection.getSpread()[collection.getCurrentSpreadIndex()] || []);
    flipbookEl.style.visibility = ready ? 'visible' : 'hidden';
    if (!ready) message = 'Caricamento pagine…';
    if (Object.keys(renderErrors).some(function (n) { return wantedPages[n]; })) message = 'Impossibile disegnare la pagina. Riduci lo zoom o riapri il file.';
  }
  var status = document.getElementById('status');
  if (status) status.textContent = message;
}

function pumpRenderQueue() {
  while (activeRenders < 2 && renderQueue.length) {
    var pageNum = renderQueue.shift();
    if (!wantedPages[pageNum] || rendered[pageNum] || rendering[pageNum] || renderErrors[pageNum]) continue;
    activeRenders++;
    renderPage(pageNum).finally(function () {
      activeRenders--;
      pumpRenderQueue();
      pumpPdfTurns();
    });
  }
}

function pumpPdfTurns() {
  if (!pdfFlipNow || !pdfTurnQueue.length || !pageFlip || (pageFlip.getState() === 'flipping' || pageFlip.getState() === 'user_fold')) return;
  var collection = pageFlip.getPageCollection();
  var spreads = collection.getSpread();
  var current = collection.getCurrentSpreadIndex();
  var turn = pdfTurnQueue[0];
  var target = current + (turn.direction === 1 ? -1 : 1);
  if (target < 0 || target >= spreads.length) {
    pdfTurnQueue.shift();
    pumpPdfTurns();
    return;
  }
  if (spreads[current].concat(spreads[target]).some(function (index) { return renderErrors[index + 1]; })) {
    pdfTurnQueue = [];
    setStatus('Impossibile disegnare la pagina. Riduci lo zoom o riapri il file.');
    return;
  }
  if (!pdfTurnReady(turn.direction)) { preload(pageFlip.getCurrentPageIndex() + 1); return; }
  pdfTurnQueue.shift();
  var rect = pageFlip.getBoundsRect();
  pdfFlipNow({
    x: turn.direction === 1 ? 10 : rect.left + rect.pageWidth * 2 - 10,
    y: turn.corner === 'top' ? 1 : rect.height - 2
  });
}

function preload(center) {
  if (!pdfDoc) return;
  wantedPages = {};
  if (center !== photoCenter) photoDirection = center > photoCenter ? 1 : -1;
  photoCenter = center;
  renderQueue = [];
  // Visible pages first; keep a small neighborhood in memory.
  var neighbors = [center, center + 1, center - 1, center + 2];
  if (BOOK.type === 'pdf' && currentLayout.isSinglePage) {
    // Keep recently read sheets ready when rapid back-swipes finish a turn
    // early. Otherwise those canvases can be exposed before PDF.js redraws them.
    neighbors.push(center - 2, center - 3);
  }
  // In a spread the next and previous turns each expose two additional pages.
  if (BOOK.type === 'pdf' && !currentLayout.isSinglePage) {
    neighbors = [center, center + 1, center + 2, center + 3, center - 1, center - 2];
  }
  if (BOOK.type === 'photos' && preloadPhotoOriginals && !currentLayout.isSinglePage) {
    neighbors = photoDirection > 0 ? [center, center + 1, center + 2, center + 3] : [center, center + 1, center - 1, center - 2];
  }
  neighbors.forEach(function (n) {
    if (n >= 1 && n <= pdfDoc.numPages) {
      wantedPages[n] = true;
      renderQueue.push(n);
    }
  });
  Object.keys(rendering).forEach(function (n) {
    if (!wantedPages[n] || (BOOK.type === 'photos' && rendering[n].quality && rendering[n].quality !== photoQuality(+n))) {
      rendering[n].cancelled = true;
      if (rendering[n].task) rendering[n].task.cancel();
    }
  });
  Object.keys(rendered).forEach(function (n) {
    if (BOOK.type === 'photos' && rendered[n] !== photoQuality(+n)) {
      delete rendered[n];
    }
    if (!wantedPages[n]) {
      var canvas = pdfElements[n];
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      delete rendered[n];
      releasePhoto(n);
    }
  });
  pumpRenderQueue();
  // Further zooms reuse already decoded photos. No render completes in that
  // case, so clear the rebuild's loading message here instead of waiting for it.
  if (BOOK.type === 'pdf' || Object.keys(wantedPages).every(function (n) { return !!rendered[n]; })) {
    setStatus('');
  }
}

function cancelRenders(keepPhotos) {
  generation++;
  renderErrors = {};
  pdfTurnQueue = [];
  renderQueue = [];
  Object.keys(rendering).forEach(function (n) {
    if (rendering[n].task) rendering[n].task.cancel();
  });
  if (flipbookEl) {
    flipbookEl.querySelectorAll('canvas').forEach(function (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    });
  }
  if (!keepPhotos) {
    Object.keys(imageUrls).forEach(releasePhoto);
    rendered = {};
  }
  rendering = {};
}

function createPageNodes() {
  var frag = document.createDocumentFragment();
  for (var n = 1; n <= pdfDoc.numPages; n++) {
    var w = document.createElement('div');
    w.className = 'page-wrapper';
    if (BOOK.type === 'photos' && photoPages[n - 1].half) w.setAttribute('data-panorama', photoPages[n - 1].half);
    w.setAttribute('data-density', 'soft');
    var c = document.createElement('div');
    c.className = 'page-content';
    if (BOOK.type === 'photos' && photoPages[n - 1].blank) {
      w.setAttribute('data-blank', 'true');
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'Pagina bianca');
      w.appendChild(c);
      frag.appendChild(w);
      continue;
    }
    var cv = document.createElement(BOOK.type === 'photos' ? 'img' : 'canvas');
    cv.width = 0;
    cv.height = 0;
    cv.className = BOOK.type === 'photos' ? 'photo-image' : 'pdf-canvas';
    cv.id = (BOOK.type === 'photos' ? 'photo-page-' : 'pdf-page-') + n;
    if (BOOK.type === 'pdf') pdfElements[n] = cv;
    if (BOOK.type === 'photos') {
      cv.alt = 'Foto ' + n;
      cv.src = photoPreviewUrl(n);
      photoElements[n] = cv;
      sizePhoto(cv, n);
    }
    c.appendChild(cv);
    w.appendChild(c);
    frag.appendChild(w);
  }
  return frag;
}

function prepareSheets() {
  // showCover centers single covers but forces them hard during spread creation.
  // Restore both covers to soft after loading, including their drawing classes.
  var softCoverIndices = pdfDoc.numPages > 1 ? [0, pdfDoc.numPages - 1] : [0];
  for (var coverIndex = 0; coverIndex < softCoverIndices.length; coverIndex++) {
    var coverPage = pageFlip.getPage(softCoverIndices[coverIndex]);
    coverPage.setDensity('soft');
    coverPage.setDrawingDensity('soft');
  }
  if (BOOK.type === 'pdf') {
    // cloneNode copies canvas dimensions, never pixels. Copy the completed PDF
    // bitmap when PageFlip creates its temporary portrait turning sheet.
    pageFlip.getPageCollection().getPages().forEach(function (pdfPage) {
      var createCopy = pdfPage.newTemporaryCopy;
      pdfPage.newTemporaryCopy = function () {
        var existingCopy = this.getTemporaryCopy();
        var copy = createCopy.call(this);
        if (copy !== this && !existingCopy) {
          copyPdfBitmap(this.getElement().querySelector('canvas'), copy.getElement().querySelector('canvas'));
        }
        return copy;
      };
    });
  }
  // Adjacent stationary sheets must share the same raster boundary.
  // Independent fractional CSS rounding otherwise exposes white at the spine.
  pageFlip.getPageCollection().getPages().forEach(function (sheet) {
    var drawStationary = sheet.simpleDraw;
    sheet.simpleDraw = function (orientation) {
      drawStationary.call(this, orientation);
      if (pageFlip.getOrientation() !== 'landscape') return;
      var rect = pageFlip.getBoundsRect();
      var origin = pageFlip.getUI().getDistElement().getBoundingClientRect().left;
      // Use whole CSS pixels at normal/high DPI: fractional sheet widths can
      // still be rasterized separately even when their device-pixel edges meet.
      var dpr = Math.min(1, window.devicePixelRatio || 1);
      var left = Math.round((origin + rect.left + (orientation === 1 ? rect.pageWidth : 0)) * dpr) / dpr;
      var right = Math.round((origin + rect.left + (orientation === 1 ? rect.pageWidth * 2 : rect.pageWidth)) * dpr) / dpr;
      var element = this.getElement();
      element.style.left = (left - origin) + 'px';
      element.style.width = (right - left) + 'px';
      if (BOOK.type === 'photos') {
        var image = element.querySelector('.photo-image');
        if (image) sizePhoto(image, Number(image.id.slice('photo-page-'.length)), right - left);
      }
    };
    if (BOOK.type === 'photos') {
      var drawMoving = sheet.draw;
      sheet.draw = function (density) {
        var image = this.getElement().querySelector('.photo-image');
        if (image) sizePhoto(image, Number(image.id.slice('photo-page-'.length)));
        drawMoving.call(this, density);
      };
    }
  });
}

function buildBook() {
  if (!pdfDoc || !currentLayout || currentLayout.width <= 0 || currentLayout.height <= 0) return;
  if (pageFlip && flipbookEl.classList.contains('portrait-back-fold')) pageFlip.getRender().finishAnimation();
  var remapPhotos = BOOK.type === 'photos' && BOOK.pages.some(function (p, i) {
    return i > 0 && i < BOOK.pages.length - 1 && p.presentation && p.presentation.mode === 'spread';
  }) && photoSingleLayout !== currentLayout.isSinglePage;
  var sourcePhoto = BOOK.type === 'photos' && photoPages[startPage] ? photoPages[startPage].sourceIndex : 0;
  cancelRenders(BOOK.type === 'photos' && !!pageFlip && !remapPhotos);
  if (remapPhotos) {
    photoSingleLayout = currentLayout.isSinglePage;
    photoPages = arrangePhotos(BOOK.pages, photoSingleLayout);
    pdfDoc.numPages = photoPages.length;
    startPage = Math.max(0, photoPages.findIndex(function (p) { return !p.blank && p.sourceIndex === sourcePhoto; }));
    photoElements = {}; imageUrls = {}; rendered = {};
  }
  // Keep one instance: destroy() detaches the root and the library's frame loop
  // survives destruction. Resize the existing book instead of accumulating loops.
  if (!pageFlip) {
    var stage = document.getElementById('stage');
    stage.innerHTML = '';
    flipbookEl = document.createElement('div');
    flipbookEl.id = 'flipbook';
    stage.appendChild(flipbookEl);
  }
  if (BOOK.type === 'pdf') flipbookEl.style.visibility = 'hidden';
  setStatus('Caricamento pagine…');
  var layout = currentLayout;
  if (BOOK.type === 'photos') Object.keys(photoElements).forEach(function (n) { sizePhoto(photoElements[n], +n); });
  flipbookEl.classList.toggle('single-page', layout.isSinglePage);
  flipbookEl.style.width = (layout.width * zoom) + 'px';
  flipbookEl.style.height = (layout.height * zoom) + 'px';
  flipbookEl.style.touchAction = zoom > 1 ? 'pan-x pan-y' : 'none';
  var basePageWidth = 800;
  var basePageHeight = basePageWidth / aspectRatio;
  var minWidth = layout.isSinglePage ? Math.max(10, Math.floor(layout.width * zoom) - 2) : 10;
  flipbookEl.style.minWidth = (layout.isSinglePage ? minWidth : minWidth * 2) + 'px';
  if (zoom === 1) {
    var workspace = document.getElementById('workspace');
    workspace.scrollLeft = 0;
    workspace.scrollTop = 0;
  }

  if (pageFlip) {
    var savedPage = startPage;
    pageFlip.getSettings().minWidth = minWidth;
    pageFlip.getSettings().usePortrait = layout.isSinglePage;
    if (remapPhotos) {
      rebuildingPhotos = true;
      pageFlip.turnToPage(0);
      var replacement = createPageNodes();
      pageFlip.updateFromHtml(Array.from(replacement.children));
      prepareSheets();
      rebuildingPhotos = false;
    }
    pageFlip.update();
    pageFlip.turnToPage(savedPage);
    startPage = pageFlip.getCurrentPageIndex();
    preload(startPage + 1);
    syncBookPosition(false);
    return;
  }

  var frag = createPageNodes();
  flipbookEl.appendChild(frag);

  pageFlip = new St.PageFlip(flipbookEl, {
    width: basePageWidth,
    height: basePageHeight,
    size: 'stretch',
    autoSize: false,
    minWidth: minWidth,
    minHeight: 10,
    maxWidth: 5000,
    maxHeight: 5000,
    drawShadow: true,
    showCover: true,
    usePortrait: layout.isSinglePage,
    startPage: startPage,
    maxShadowOpacity: 0.68,
    mobileScrollSupport: true,
    // Give fingers more time to follow the turn; keep reduced motion shorter.
    flippingTime: window.matchMedia('(pointer: coarse)').matches
      ? (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 700 : 1100)
      : (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 250 : 700)
  });

  var wrappers = flipbookEl.querySelectorAll('.page-wrapper');
  pageFlip.loadFromHTML(wrappers);
  if (window.matchMedia('(pointer: coarse)').matches) {
    // PageFlip scales time down with page width: a phone's full turn used only
    // part of flippingTime. Use the complete duration for touch page turns.
    var flipController = pageFlip.getFlipController();
    var animationDuration = flipController.getAnimationDuration;
    flipController.getAnimationDuration = function (size) {
      return this.getState() === 'flipping' ? pageFlip.getSettings().flippingTime : animationDuration.call(this, size);
    };
    var startFlip = flipController.start;
    flipController.start = function (pos) {
      flipbookEl.classList.remove('portrait-back-fold');
      var started = startFlip.call(this, pos);
      var calculation = this.getCalculation();
      if (started && pageFlip.getOrientation() === 'portrait' && calculation.getDirection() === 1) {
        // Fold the current sheet away to the right, revealing the previous one.
        // The library's portrait BACK path only slides the previous sheet in.
        var index = pageFlip.getCurrentPageIndex();
        this.flippingPage = pageFlip.getPage(index).newTemporaryCopy();
        this.bottomPage = pageFlip.getPage(index - 1);
        calculation.direction = 0;
        // Use forward fold geometry, mirrored visually; commit a backward turn.
        calculation.getDirection = function () { return 1; };
        this.render.setDirection(0);
        flipbookEl.classList.add('portrait-back-fold');
      }
      return started;
    };
  }
  if (BOOK.type === 'pdf') {
    var pdfController = pageFlip.getFlipController();
    var startPdfFold = pdfController.start;
    // Guard mouse drags and corner previews too, not just taps and keyboard turns.
    pdfController.start = function (pos) {
      var point = this.render.convertToBook(pos);
      if (!pdfTurnReady(this.getDirectionByPoint(point))) {
        preload(pageFlip.getCurrentPageIndex() + 1);
        return false;
      }
      return startPdfFold.call(this, pos);
    };
    pdfFlipNow = pdfController.flip.bind(pdfController);
    pdfController.flip = function (pos) {
      var point = this.render.convertToBook(pos);
      // Keep the latest pending intent rather than running a long backlog after release.
      pdfTurnQueue = [{ direction: this.getDirectionByPoint(point),
        corner: point.y >= this.render.getRect().height / 2 ? 'bottom' : 'top' }];
      pumpPdfTurns();
    };
  }
  prepareSheets();
  // Keep PageFlip's clipping and geometry, but shade the curved paper with a
  // broad soft band and a restrained highlight, like the supplied reference.
  var foldRender = pageFlip.getRender();
  var drawFoldShadow = foldRender.drawInnerShadow;
  foldRender.drawInnerShadow = function () {
    drawFoldShadow.call(this);
    if (!this.shadow || !this.innerShadow) return;
    var direction = this.getDirection() === 0 ? 'to left' : 'to right';
    var opacity = this.shadow.opacity;
    this.innerShadow.style.background = 'linear-gradient(' + direction + ', rgba(0,0,0,' + opacity * 0.15 + ') 0%, rgba(255,255,255,0.18) 14%, rgba(0,0,0,' + opacity * 0.85 + ') 48%, rgba(0,0,0,' + opacity * 0.3 + ') 78%, transparent 100%)';
  };
  pageFlip.on('flip', function (e) {
    if (rebuildingPhotos) return;
    startPage = e.data;
    preload(e.data + 1);
    updateCounter();
    syncBookPosition(true);
  });
  pageFlip.on('changeState', function (e) {
    if (turnSoundPlayer) turnSoundPlayer.onState(e.data);
    syncBookPosition(true, e.data);
    if (e.data === 'read' && pdfTurnQueue.length) setTimeout(pumpPdfTurns, 0);
  });
  startPage = pageFlip.getCurrentPageIndex();
  preload(startPage + 1);
  updateCounter();
  syncBookPosition(false);
}

function syncBookPosition(animate, state) {
  if (!pageFlip || !flipbookEl) return;
  var block = pageFlip.getUI().getDistElement();
  // Pointer coordinates are measured against this block. Moving it while a
  // corner is held makes the page escape the pointer and hover oscillate.
  // Let the fold extend outside the closed cover, but center only at rest.
  if ((state || pageFlip.getState()) !== 'read') {
    var heldTransform = window.getComputedStyle(block).transform;
    block.style.transition = 'none';
    block.style.transform = heldTransform;
    flipbookEl.classList.remove('closed-book');
    return;
  }
  if (flipbookEl.classList.contains('portrait-back-fold')) {
    // Remove the mirrored fold atomically: interpolating -1 to +1 would make
    // the settled page rotate/squeeze after the actual turn has already ended.
    block.style.transition = 'none';
    block.style.transform = 'translateX(0px)';
    flipbookEl.classList.remove('portrait-back-fold');
    animate = false;
  }
  var index = pageFlip.getCurrentPageIndex();
  // Snap the composited book itself, not only its child block. A half-pixel
  // parent origin can otherwise produce a bright seam despite touching pages.
  var bookOrigin = flipbookEl.getBoundingClientRect().left - (parseFloat(flipbookEl.style.left) || 0);
  var bookDpr = window.devicePixelRatio || 1;
  flipbookEl.style.left = pageFlip.getOrientation() === 'landscape'
    ? (Math.round(bookOrigin * bookDpr) / bookDpr - bookOrigin) + 'px'
    : '0px';
  var closed = pageFlip.getOrientation() === 'landscape' && (index === 0 || index === pdfDoc.numPages - 1);
  var offset = 0;
  if (closed) {
    var page = pageFlip.getPage(index).getElement();
    offset = pageFlip.getBoundsRect().pageWidth / 2 * (page.classList.contains('--left') ? 1 : -1);
  }
  flipbookEl.classList.toggle('closed-book', closed);
  block.style.transition = animate ? 'transform 350ms ease' : 'none';
  block.style.transform = 'translateX(' + offset + 'px)';
}

async function init() {
  try {
    if (BOOK.type === 'photos') {
      if (!BOOK.pages || !BOOK.pages.length) throw new Error('Nessuna foto');
      pdfDoc = { numPages: photoPages.length };
      var first = BOOK.pages[0];
      aspectRatio = (first.rotation || 0) % 180 ? first.height / first.width : first.width / first.height;
      currentLayout = computeLayout();
      if (currentLayout) buildBook();
      return;
    }
    var loadingTask = pdfjsLib.getDocument({ url: BOOK.url, isEvalSupported: false });
    loadingTask.onPassword = function (updatePassword) {
      var password = window.prompt('Questo PDF è protetto. Inserisci la password:');
      if (password === null) { loadingTask.destroy(); setStatus('Apertura del PDF annullata.'); }
      else updatePassword(password);
    };
    pdfDoc = await loadingTask.promise;
    var page1 = await pdfDoc.getPage(1);
    var vp = page1.getViewport({ scale: 1 });
    aspectRatio = vp.width / vp.height;
    currentLayout = computeLayout();
    if (currentLayout) buildBook();
  } catch (err) {
    console.error('Error loading PDF', err);
    setStatus('Impossibile aprire il libro. Ricarica la pagina oppure apri il PDF dal menu.');
  }
}

var resizeTimer = null;
function onResize() {
  if (!pdfDoc || pinch.active) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    if (pinch.active) return;
    var nl = computeLayout();
    if (!nl) return;
    var changed = !currentLayout || Math.abs(nl.width - currentLayout.width) > 2 || Math.abs(nl.height - currentLayout.height) > 2 || nl.isSinglePage !== currentLayout.isSinglePage;
    if (changed) {
      currentLayout = nl;
      buildBook();
    }
  }, 250);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onResize);
  window.visualViewport.addEventListener('scroll', syncViewport);
}

function getPinchDist(t) {
  return Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
}
function clampZoom(z) { return Math.min(3, Math.max(1, z)); }
function applyPinchTransform() {
  if (!flipbookEl) return;
  if (pinch.active) {
    flipbookEl.style.transform = 'scale(' + pinch.ratio + ')';
    flipbookEl.style.transformOrigin = 'center center';
  } else {
    flipbookEl.style.transform = '';
    flipbookEl.style.transformOrigin = '';
  }
}

function cancelBookTouch() {
  bookTouch = null;
  if (!pageFlip) return;
  // PageFlip has no touchcancel handler. Its delayed touchstart would otherwise
  // revive a cancelled finger (also when a second finger begins a pinch).
  pageFlip.getUI().touchPoint = null;
  pageFlip.userStop({ x: 0, y: 0 }, true);
  if (pageFlip.getState() === 'user_fold' || pageFlip.getState() === 'fold_corner') {
    pageFlip.getFlipController().stopMove();
  }
}

function finishBookTouch(e) {
  var gesture = bookTouch;
  if (!gesture || !pageFlip) return;
  bookTouch = null;
  var touch = Array.from(e.changedTouches).find(function (t) { return t.identifier === gesture.id; });
  var dx = (touch ? touch.clientX : gesture.lastX) - gesture.x;
  var dy = (touch ? touch.clientY : gesture.lastY) - gesture.y;
  // Own fitted-size touch navigation: PageFlip's slow-drag path chooses its
  // direction from finger position instead of movement, especially in portrait.
  if (Math.abs(dx) >= 30 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    var corner = gesture.y < window.innerHeight / 2 ? 'top' : 'bottom';
    if (dx > 0) pageFlip.flipPrev(corner);
    else pageFlip.flipNext(corner);
  } else if (gesture.distance < 10 && Math.hypot(dx, dy) < 10) {
    // Keep the existing tap behavior, with one turn and no synthetic mouse turn.
    var rect = pageFlip.getUI().getDistElement().getBoundingClientRect();
    var pos = { x: gesture.x - rect.left, y: gesture.y - rect.top };
    pageFlip.startUserTouch(pos);
    pageFlip.userStop(pos);
  }
  e.preventDefault();
  e.stopPropagation();
}

document.addEventListener('touchstart', function (e) {
  if (e.target.closest('#reader-menu')) return;
  if (e.touches.length === 2 && pageFlip) {
    cancelBookTouch();
    clearTimeout(resizeTimer);
    pinch.active = true;
    pinch.startDist = Math.max(1, getPinchDist(e.touches));
    pinch.startZoom = zoom;
    pinch.ratio = 1;
    applyPinchTransform();
    e.preventDefault();
    e.stopPropagation();
  }
  if (zoom > 1 && e.touches.length === 1) e.stopPropagation();
  if (zoom === 1 && !pinch.active && e.touches.length === 1 && pageFlip && flipbookEl.contains(e.target)) {
    var touch = e.touches[0];
    bookTouch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastX: touch.clientX, lastY: touch.clientY, distance: 0 };
    e.stopPropagation();
  }
}, { capture: true, passive: false });

document.addEventListener('touchmove', function (e) {
  if (e.target.closest('#reader-menu')) return;
  if (zoom > 1 && e.touches.length === 1 && !pinch.active) e.stopPropagation();
  if (bookTouch && !pinch.active && e.touches.length === 1) {
    var touch = e.touches[0];
    bookTouch.lastX = touch.clientX;
    bookTouch.lastY = touch.clientY;
    bookTouch.distance = Math.max(bookTouch.distance, Math.hypot(touch.clientX - bookTouch.x, touch.clientY - bookTouch.y));
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!pinch.active || e.touches.length !== 2) return;
  var scale = getPinchDist(e.touches) / pinch.startDist;
  var ratio = clampZoom(pinch.startZoom * scale) / pinch.startZoom;
  pinch.ratio = ratio;
  applyPinchTransform();
  e.preventDefault();
  e.stopPropagation();
}, { capture: true, passive: false });

function endPinch(e) {
  if (e.target.closest('#reader-menu')) return;
  if (zoom > 1 && !pinch.active) e.stopPropagation();
  if (!pinch.active) { finishBookTouch(e); return; }
  if (e.touches.length < 2) {
    var newZoom = clampZoom(+((pinch.startZoom * pinch.ratio).toFixed(2)));
    pinch.active = false;
    applyPinchTransform();
    if (newZoom !== zoom) {
      zoom = newZoom;
      currentLayout = computeLayout() || currentLayout;
      buildBook();
    }
    onResize();
    e.preventDefault();
    e.stopPropagation();
  }
}
document.addEventListener('touchend', endPinch, { capture: true, passive: false });
document.addEventListener('mousedown', function (e) {
  if (zoom > 1 && !e.target.closest('#reader-menu')) e.stopPropagation();
}, { capture: true });
document.addEventListener('touchcancel', function () {
  cancelBookTouch();
  if (pinch.active) {
    pinch.active = false;
    applyPinchTransform();
    onResize();
  }
}, { capture: true, passive: false });

function updateCounter() {
  var counter = document.getElementById('page-counter');
  if (counter && pdfDoc) counter.textContent = (startPage + 1) + ' / ' + pdfDoc.numPages;
}

function updateFullscreenButton() {
  var button = document.getElementById('fullscreen-action');
  if (button) button.textContent = document.fullscreenElement || document.webkitFullscreenElement || nativeFullscreen ? 'Esci da tutto schermo' : 'Tutto schermo';
  onResize();
}

async function toggleFullscreen() {
  document.getElementById('reader-menu').open = false;
  if (PREVIEW && window.parent !== window) {
    window.parent.postMessage({ type: 'reader-fullscreen' }, '*');
    return;
  }
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
    } else {
      var enter = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      var enabled = document.documentElement.requestFullscreen ? document.fullscreenEnabled : document.webkitFullscreenEnabled;
      if (!enter || enabled === false) {
        setStatus('Questo browser non consente il tutto schermo. Il libro usa già tutta l’area disponibile.');
        return;
      }
      await enter.call(document.documentElement);
    }
    updateFullscreenButton();
  } catch (error) {
    setStatus('Il browser non ha consentito il tutto schermo. Puoi continuare a leggere qui.');
    console.warn(error);
  }
}

function changeZoom(value) {
  zoom = clampZoom(value);
  currentLayout = computeLayout() || currentLayout;
  buildBook();
}

function setupTurnSound() {
  var context = null;
  var buffer = null;
  var loading = null;
  var source = null;
  var previousState = 'read';
  var pending = false;
  var fallback = null;
  function isTurning(state) { return state === 'flipping' || state === 'user_fold'; }
  function stop() {
    pending = false;
    if (source) { try { source.stop(); } catch (error) {} source = null; }
    if (fallback) { fallback.pause(); fallback.currentTime = 0; }
  }
  function play() {
    if (context && (context.state !== 'running' || !buffer)) {
      pending = !!loading || !!buffer;
      return;
    }
    pending = false;
    if (context && buffer && context.state === 'running') {
      if (source) { try { source.stop(); } catch (error) {} }
      source = context.createBufferSource();
      var gain = context.createGain();
      gain.gain.value = 1;
      source.buffer = buffer;
      source.connect(gain); gain.connect(context.destination);
      var activeSource = source;
      source.onended = function () { activeSource.disconnect(); gain.disconnect(); if (source === activeSource) source = null; };
      source.start();
    } else if (loading) pending = true;
    else if (fallback) {
      fallback.currentTime = 0;
      fallback.play().catch(function () {});
    }
  }
  function unlock(e) {
    if (!e.isTrusted) return;
    if (e.type === 'keydown') {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' || /INPUT|BUTTON|SUMMARY/.test(e.target.tagName)) return;
    } else if (!e.target.closest('#workspace')) return;
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!context && !fallback) {
      if (Context) {
        try { context = new Context(); } catch (error) {}
      }
      if (context) {
        loading = fetch('./assets/page-turn.mp3').then(function (response) {
          if (!response.ok) throw new Error('Audio non disponibile');
          return response.arrayBuffer();
        }).then(function (bytes) { return context.decodeAudioData(bytes); }).then(function (decoded) {
          buffer = decoded; loading = null;
          if (pending && pageFlip && isTurning(pageFlip.getState())) play();
        }).catch(function () { loading = null; pending = false; });
      } else {
        fallback = new Audio('./assets/page-turn.mp3');
        fallback.volume = 1;
      }
    }
    if (context && context.state !== 'running') context.resume().then(function () {
      if (pending && buffer && pageFlip && isTurning(pageFlip.getState())) play();
    }).catch(function () {});
  }
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(function (event) { document.addEventListener(event, unlock, { capture: true, passive: true }); });
  turnSoundPlayer = { onState: function (state) {
    if (isTurning(state) && !isTurning(previousState)) play();
    if (state === 'read') pending = false;
    previousState = state;
  } };
  window.addEventListener('pagehide', stop);
  var back = document.getElementById('back-action');
  if (back) back.addEventListener('click', function () { stop(); if (context) context.close().catch(function () {}); });
}

function setupReader() {
  setupTurnSound();
  document.getElementById('fullscreen-action').addEventListener('click', toggleFullscreen);
  document.getElementById('zoom-in').addEventListener('click', function () { changeZoom(zoom + 0.25); });
  document.getElementById('zoom-out').addEventListener('click', function () { changeZoom(zoom - 0.25); });
  document.getElementById('fit-action').addEventListener('click', function () { changeZoom(1); document.getElementById('reader-menu').open = false; });
  document.getElementById('page-action').addEventListener('click', function () {
    if (!pageFlip || !pdfDoc) return;
    var value = window.prompt('Vai alla pagina (1–' + pdfDoc.numPages + '):');
    var n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= pdfDoc.numPages) { pageFlip.turnToPage(n - 1); document.getElementById('reader-menu').open = false; }
  });
  var back = document.getElementById('back-action');
  if (back) back.addEventListener('click', function () { window.parent.postMessage({ type: 'reader-back' }, '*'); });
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  window.addEventListener('message', function (e) {
    if (PREVIEW && e.source === window.parent && e.data && e.data.type === 'reader-fullscreen-state') {
      nativeFullscreen = !!e.data.active; updateFullscreenButton();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.getElementById('reader-menu').open = false;
      if (nativeFullscreen && PREVIEW) window.parent.postMessage({ type: 'reader-exit-fullscreen' }, '*');
    }
    if (!pageFlip || /INPUT|BUTTON|SUMMARY/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); pageFlip.flipNext(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); pageFlip.flipPrev(); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#reader-menu')) document.getElementById('reader-menu').open = false; });
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupReader);
} else {
  setupReader();
}
