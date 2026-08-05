/* 官网动效：IntersectionObserver 入场（fade + translate），
   尊重 prefers-reduced-motion。不用 scroll 监听。 */
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var els = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("in"); });
    return;
  }

  els.forEach(function (el) {
    var delay = el.getAttribute("data-delay");
    if (delay) el.style.transitionDelay = delay + "ms";
  });

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );

  els.forEach(function (el) { io.observe(el); });
})();
