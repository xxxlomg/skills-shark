/* SkillsShark 官网动效
   1) 入场：IntersectionObserver fade+translate，尊重 prefers-reduced-motion。
   2) 使用手册页：从 #docs 构建目录（章节 + 小节），滚动高亮当前节。
   不用 scroll 监听做入场；目录高亮用 rAF 节流的 scroll 监听。 */
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. 入场动画 ---------- */
  var els = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("in"); });
  } else {
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
  }

  /* ---------- 2. 使用手册目录 ---------- */
  var docs = document.getElementById("docs");
  var toc = document.getElementById("toc");
  if (docs && toc) {
    // 收集章节(h1)与小节(h2)，h2 需带 id
    var entries = [];
    Array.prototype.forEach.call(docs.querySelectorAll("section"), function (sec) {
      var h1 = sec.querySelector("h1");
      if (!h1) return;
      var id = sec.id;
      if (id) {
        entries.push({ id: id, title: h1.textContent, level: 1, el: sec });
      }
      Array.prototype.forEach.call(sec.querySelectorAll("h2[id]"), function (h2) {
        entries.push({ id: h2.id, title: h2.textContent, level: 2, el: h2 });
      });
    });

    // 构建目录
    entries.forEach(function (e) {
      var a = document.createElement("a");
      a.href = "#" + e.id;
      a.textContent = e.title;
      if (e.level === 2) a.className = "lv2";
      toc.appendChild(a);
    });

    // 滚动高亮
    var active = null;
    function setActive(id) {
      if (active === id) return;
      active = id;
      Array.prototype.forEach.call(toc.querySelectorAll("a"), function (a) {
        a.classList.toggle("on", a.getAttribute("href") === "#" + id);
      });
    }
    function compute() {
      var cap = 0;
      var docTop = docs.getBoundingClientRect().top;
      if (reduce) cap = 0; else cap = 96;
      var current = entries.length ? entries[0].id : "";
      for (var i = 0; i < entries.length; i++) {
        var r = entries[i].el.getBoundingClientRect();
        if (r.top <= cap) current = entries[i].id;
      }
      setActive(current);
    }
    var raf = 0;
    window.addEventListener("scroll", function () {
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; compute(); });
    }, { passive: true });
    compute();
  }
})();