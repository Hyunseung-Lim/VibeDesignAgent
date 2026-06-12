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

export function injectHeightReporter(html: string, artboardId: string): string {
  const script = `<style>
/* Prevent viewport-relative heights from creating feedback loop with iframe resize */
html, body { min-height: 0 !important; height: auto !important; }
.h-screen, .h-dvh, .h-svh, .h-lvh,
.min-h-screen, .min-h-dvh, .min-h-svh, .min-h-lvh {
  height: auto !important;
  min-height: 0 !important;
}
</style>
<script>
(function(){
  var lastHeight = 0;
  var reportCount = 0;
  var MAX_REPORTS = 6;
  var initialVh = window.innerHeight || 900;
  var initialVw = window.innerWidth || 1512;
  /* Freeze window.innerHeight/innerWidth so that resize handlers triggered by
     parent iframe resizing cannot update --vh / --vw CSS custom properties,
     which would cause a feedback loop where the artboard grows on every report. */
  try {
    Object.defineProperty(window, 'innerHeight', { get: function(){ return initialVh; }, configurable: true });
    Object.defineProperty(window, 'innerWidth',  { get: function(){ return initialVw; }, configurable: true });
  } catch(e) {}
  function freezeVhUnits() {
    var unitRe = /(\d*\.?\d+)(svh|dvh|lvh|vh)/g;
    function replaceVh(s) { return s.replace(unitRe, function(_, n) { return (parseFloat(n) * initialVh / 100).toFixed(1) + 'px'; }); }
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
  freezeVhUnits();
  function measure(){
    if (reportCount >= MAX_REPORTS) return;
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
  window.addEventListener('load', measure);
  setTimeout(measure, 0);
  setTimeout(measure, 500);
  setTimeout(measure, 1500);
  setTimeout(measure, 3000);
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
    document.querySelectorAll('[data-vda-selected]').forEach(function(el) {
      el.removeAttribute('data-vda-selected');
    });
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
