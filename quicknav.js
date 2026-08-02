// ヘッダー内リンク（スマホ:クイックタブ／PC:通常ナビ）のアクティブ状態を
// スクロール位置に応じて自動で切り替える
document.addEventListener("DOMContentLoaded", () => {
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

  // 初期表示では「次の試合」をアクティブに
  setActive("next-match");

  // ハンバーガーメニュー内のリンクをクリックしたらメニューを閉じる（スマホ用）
  document.querySelectorAll("header nav a").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelector("header")?.classList.remove("nav-open");
    });
  });
});
