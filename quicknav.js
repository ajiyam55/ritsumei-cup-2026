document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector("header");

  // --- 固定ヘッダーの実際の高さを測ってCSS変数に反映する ---
  // （画像読み込み・フォント・画面幅・メニュー開閉で高さが変わっても、常にズレなく本文を下げる）
  if (header) {
    const syncHeaderHeight = () => {
      document.documentElement.style.setProperty(
        "--header-h",
        `${header.offsetHeight}px`
      );
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
