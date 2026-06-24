// Script/style injection for mockup artboard iframes: disables navigation,
// reports content height to the parent canvas, and relays selection/zoom
// gestures via postMessage.

export function injectNoNavigation(html: string): string {
  const script = `<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target && (e.target.closest ? e.target.closest('a[href]') : null);
    if(a){ e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('submit', function(e){ e.preventDefault(); }, true);
})();
</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx !== -1
    ? html.slice(0, idx) + script + html.slice(idx)
    : html + script;
}

export function injectHeightReporter(
  html: string,
  artboardId: string,
  viewport: { width: number; height: number },
): string {
  const viewportWidth = Math.max(1, Math.round(viewport.width));
  const viewportHeight = Math.max(1, Math.round(viewport.height));
  const script = `<style>
/* Keep viewport utilities tied to the design device while the outer iframe
   grows to reveal document overflow. Using auto here changes the authored
   layout and can stretch full-screen image grids into very tall columns. */
.h-screen, .h-dvh, .h-svh, .h-lvh {
  height: ${viewportHeight}px !important;
}
.min-h-screen, .min-h-dvh, .min-h-svh, .min-h-lvh {
  min-height: ${viewportHeight}px !important;
}
</style>
<script>
(function(){
  var lastHeight = 0;
  var reportCount = 0;
  var MAX_REPORTS = 6;
  var started = false;
  var initialVh = ${viewportHeight};
  var initialVw = ${viewportWidth};
  /* Freeze window.innerHeight/innerWidth so that resize handlers triggered by
     parent iframe resizing cannot update --vh / --vw CSS custom properties,
     which would cause a feedback loop where the artboard grows on every report. */
  try {
    Object.defineProperty(window, 'innerHeight', { get: function(){ return initialVh; }, configurable: true });
    Object.defineProperty(window, 'innerWidth',  { get: function(){ return initialVw; }, configurable: true });
  } catch(e) {}
  function replaceVh(s) {
    var unitRe = /(\d*\.?\d+)(svh|dvh|lvh|vh)/g;
    return s.replace(unitRe, function(_, n) { return (parseFloat(n) * initialVh / 100).toFixed(1) + 'px'; });
  }
  /* Rewrite vh in already-parsed stylesheet rules. Runtime CSS frameworks (e.g.
     the Tailwind Play CDN) insert rules via CSSOM insertRule, so they never
     appear in any <style> textContent and escape the textContent pass below.
     This also catches arbitrary values like h-[80vh] that the .h-screen class
     override does not. Cross-origin sheets throw on cssRules access -> skip. */
  function freezeSheetRules(rules) {
    if (!rules) return;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.style && rule.style.cssText && /vh/.test(rule.style.cssText)) {
        try { rule.style.cssText = replaceVh(rule.style.cssText); } catch (e) {}
      }
      if (rule.cssRules) freezeSheetRules(rule.cssRules);
    }
  }
  function freezeVhUnits() {
    var sheets = document.styleSheets;
    for (var k = 0; k < sheets.length; k++) {
      var rules;
      try { rules = sheets[k].cssRules; } catch (e) { continue; }
      freezeSheetRules(rules);
    }
    var els = document.querySelectorAll('*[style]');
    for (var i = 0; i < els.length; i++) {
      var s = els[i].getAttribute('style');
      if (s && /vh/.test(s)) els[i].setAttribute('style', replaceVh(s));
    }
    var tags = document.querySelectorAll('style');
    for (var j = 0; j < tags.length; j++) {
      var c = tags[j].textContent;
      if (c && /vh/.test(c)) tags[j].textContent = replaceVh(c);
    }
  }

  /* --- Box pinning -------------------------------------------------------
     The parent canvas grows this iframe to the full document height so the
     whole design is visible. Some Stitch layouts size hero containers and
     full-bleed images against the viewport (vh, e.g. the arbitrary value
     h-[80vh]) or a root-percentage chain. Once the iframe grows, those boxes
     track the new viewport height: images stretch into tall slivers and vh
     containers inflate, which in turn re-grows the document in a feedback loop
     (observed 3258 -> 5045 -> 6475 ...). The Final Design preview never sees
     this because it keeps the iframe at the device height.

     Runtime CSS (e.g. the Tailwind Play CDN) regenerates its own stylesheet,
     so rewriting its vh rules does not stick. Instead we pin the affected
     elements' boxes with INLINE px values: an inline declaration outranks any
     class rule by specificity, so it survives stylesheet regeneration. We do
     this while the iframe is still at the device height (before reporting any
     taller height), so the boxes match the Final Design render. */
  var pinned = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
  function isPinned(el) { return pinned ? pinned.has(el) : el.hasAttribute('data-vda-pinned'); }
  function setBox(el, w, h) {
    if (w != null) el.style.setProperty('width', w + 'px', 'important');
    el.style.setProperty('height', h + 'px', 'important');
    if (pinned) pinned.add(el); else el.setAttribute('data-vda-pinned', '');
  }
  /* Pin every image that already has a laid-out box at the device viewport. */
  function pinBoxedImages() {
    var imgs = document.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (isPinned(img)) continue;
      var r = img.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox(img, Math.round(r.width), Math.round(r.height));
    }
  }
  /* Pin elements whose height is viewport-derived (class or inline style names
     a vh unit, e.g. h-[80vh] / min-h-[60vh] / style="height:70vh"). Freezing
     their computed height to px keeps them from inflating with the iframe and
     breaks the height feedback loop. Only height is frozen so widths stay
     responsive to the (fixed) iframe width. */
  function pinVhElements() {
    var els = document.querySelectorAll('[class*="vh"], [style*="vh"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (isPinned(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.height > 0) setBox(el, null, Math.round(r.height));
    }
  }
  /* Images that finish loading after the iframe has grown can no longer be
     measured at the device height. Their width is still trustworthy (it tracks
     the iframe width, which never changes), so derive the height from the
     natural aspect ratio instead. */
  function pinImageByAspect(img) {
    if (isPinned(img)) return;
    var r = img.getBoundingClientRect();
    var w = Math.round(r.width);
    if (w > 0 && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setBox(img, w, Math.round(w * img.naturalHeight / img.naturalWidth));
    }
  }
  function watchPendingImages() {
    var imgs = document.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) {
      (function(img){
        if (isPinned(img) || img.complete) return;
        img.addEventListener('load', function(){ pinImageByAspect(img); }, { once: true });
      })(imgs[i]);
    }
  }

  function measure(){
    if (reportCount >= MAX_REPORTS) return;
    /* Tailwind CDN and other runtime styles may arrive after parsing. Freeze
       newly inserted viewport units before each scheduled measurement too. */
    freezeVhUnits();
    var body = document.body;
    var root = document.documentElement;
    var height = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0
    );
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    reportCount++;
    window.parent.postMessage({
      type: 'vda-artboard-height',
      artboardId: '${artboardId}',
      height: height
    }, '*');
  }

  /* Lock viewport units and image boxes while the iframe is still at the device
     height, THEN start reporting taller heights. Reporting earlier (as a bare
     setTimeout(0) would) lets the iframe grow before images are pinned and
     stretches full-bleed images into slivers. */
  function start(){
    if (started) return;
    started = true;
    freezeVhUnits();
    pinVhElements();
    pinBoxedImages();
    watchPendingImages();
    measure();
    setTimeout(measure, 300);
    setTimeout(measure, 1000);
    setTimeout(measure, 2500);
  }

  if (document.documentElement) document.documentElement.style.overflow = 'hidden';
  if (document.body) document.body.style.overflow = 'hidden';
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-artboard-context-menu',
      artboardId: '${artboardId}',
      clientX: e.clientX,
      clientY: e.clientY
    }, '*');
  }, { capture: true });

  function startAfterPaint(){
    /* Two frames after load lets the Tailwind CDN stylesheet apply so images
       have their final device-height boxes before we pin them. */
    requestAnimationFrame(function(){ requestAnimationFrame(start); });
  }
  if (document.readyState === 'complete') startAfterPaint();
  else window.addEventListener('load', startAfterPaint);
  /* Fallback in case an external resource (Tailwind CDN, a slow image) never
     fires load and the iframe would otherwise stay at the device height. */
  setTimeout(start, 3000);
})();
</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx !== -1
    ? html.slice(0, idx) + script + html.slice(idx)
    : html + script;
}

export function injectSelectionScript(html: string, artboardId: string): string {
  const script = `
<style>
  [data-vda-selected] { outline: 2px solid #6366f1 !important; outline-offset: 2px; }
</style>
<script>
  function clearVdaSelection() {
    document.querySelectorAll('[data-vda-selected]').forEach(function(el) {
      el.removeAttribute('data-vda-selected');
    });
  }
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'vda-clear-selection') return;
    if (e.data.artboardId && e.data.artboardId !== '${artboardId}') return;
    clearVdaSelection();
  });
  document.addEventListener('wheel', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-canvas-wheel',
      artboardId: '${artboardId}',
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      clientX: e.clientX,
      clientY: e.clientY
    }, '*');
  }, { capture: true, passive: false });
  document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-canvas-gesture-start',
      artboardId: '${artboardId}'
    }, '*');
  }, { capture: true, passive: false });
  document.addEventListener('gesturechange', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'vda-canvas-gesture-change',
      artboardId: '${artboardId}',
      scale: e.scale,
      clientX: e.clientX,
      clientY: e.clientY
    }, '*');
  }, { capture: true, passive: false });
  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    clearVdaSelection();
    var el = e.target;
    el.setAttribute('data-vda-selected', 'true');

    var selector = el.tagName.toLowerCase();
    if (el.id) selector += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\\s+/)[0];
      if (cls) selector += '.' + cls;
    }

    window.parent.postMessage({
      type: 'vda-element-selected',
      artboardId: '${artboardId}',
      selector: selector,
      outerHTML: el.outerHTML,
    }, '*');
  }, true);
</script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", script + "\n</body>");
  }
  return html + script;
}
