document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector("header");

  // --- 固定ヘッダーの実際の高さを測ってCSS変数に反映する ---
  // （画像読み込み・フォント・画面幅・メニュー開閉で高さが変わっても、常にズレなく本文を下げる）
  if (header) {
    let lastHeaderHeight = -1;
    const syncHeaderHeight = () => {
      const height = header.offsetHeight;
      if (height === lastHeaderHeight) return; // 変わっていなければ何もしない(無駄な再計算を避ける)
      lastHeaderHeight = height;
      document.documentElement.style.setProperty("--header-h", `${height}px`);
    };

    syncHeaderHeight();
    window.addEventListener("resize", syncHeaderHeight);
    window.addEventListener("orientationchange", syncHeaderHeight);

    header.querySelectorAll("img").forEach((img) => {
      if (!img.complete) {
        img.addEventListener("load", syncHeaderHeight, { once: true });
      }
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncHeaderHeight);
    }

    if ("ResizeObserver" in window) {
      new ResizeObserver(syncHeaderHeight).observe(header);
    }
  }

  // --- ヘッダー内リンク（スマホ:クイックタブ／PC:通常ナビ）のアクティブ状態を
  //     スクロール位置に応じて自動で切り替える ---
  const headerLinks = Array.from(
    document.querySelectorAll(".quick-nav a, header nav a")
  ).filter((link) => link.getAttribute("href")?.startsWith("#"));

  if (headerLinks.length === 0) return;

  const idToLinks = new Map();
  headerLinks.forEach((link) => {
    const id = link.getAttribute("href").slice(1);
    if (!idToLinks.has(id)) idToLinks.set(id, []);
    idToLinks.get(id).push(link);
  });

  const targets = Array.from(idToLinks.keys())
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const setActive = (id) => {
    headerLinks.forEach((link) => link.classList.remove("active"));
    (idToLinks.get(id) || []).forEach((link) => link.classList.add("active"));
  };

  // --- クイックタブ／ナビのジャンプを「常に一定時間（0.45秒）」で行う ---
  // （ブラウザ標準のscroll-behavior:smoothは距離が長いと1秒を超えることがあるため）
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const smoothScrollTo = (targetY, duration = 280) => {
    const startY = window.scrollY;
    const diff = targetY - startY;
    if (Math.abs(diff) < 1) return;

    if (prefersReducedMotion) {
      window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
      return;
    }

    let startTime = null;
    const step = (timestamp) => {
      if (startTime === null) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      window.scrollTo({
        top: startY + diff * easeInOutQuad(progress),
        left: 0,
        behavior: "instant",
      });
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  headerLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href").slice(1);
      const target = document.getElementById(id);
      if (!target) return;

      e.preventDefault();
      const headerOffset = (header ? header.offsetHeight : 0) + 12;
      const targetY =
        target.getBoundingClientRect().top + window.scrollY - headerOffset;

      smoothScrollTo(targetY, 280);
      history.pushState(null, "", `#${id}`);
    });
  });

  setActive("next-match"); // 初期表示

  if (!("IntersectionObserver" in window) || targets.length === 0) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      // 画面内に見えているセクションのうち、最も上にあるものをアクティブにする
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

      if (visible.length > 0) {
        setActive(visible[0].target.id);
      }
    },
    {
      // 固定ヘッダーの高さぶんを考慮した判定エリア
      rootMargin: "-150px 0px -60% 0px",
      threshold: 0,
    }
  );

  targets.forEach((target) => observer.observe(target));
});

// --- ハンバーガーメニュー: メニューのリンク以外(上のバナー、クイックタブ、本文など)を押したら閉じる ---
// (開閉ボタンそのものは script.js が処理するので、ここでは触らない)
document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector("header");
  if (!header) return;

  document.addEventListener("click", (event) => {
    if (!header.classList.contains("nav-open")) return;
    if (event.target.closest(".menu-toggle")) return;                       // 開閉ボタン
    if (event.target.closest("header nav") && !event.target.closest("a")) return; // メニューの余白は閉じない
    header.classList.remove("nav-open");                                    // メニューのリンク・それ以外 → 閉じる
  });
});
