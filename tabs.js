const TAB_NAMES = ["quotes", "shares", "design"];

function setTab(name) {
  if (!TAB_NAMES.includes(name)) name = "quotes";
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + name));
  const targetHash = name === "quotes" ? "" : "#" + name;
  if (location.hash !== targetHash) {
    history.replaceState(null, "", location.pathname + targetHash);
  }
}

function currentTabFromHash() {
  const h = location.hash.replace(/^#/, "");
  return TAB_NAMES.includes(h) ? h : "quotes";
}

document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => setTab(t.dataset.tab));
});

setTab(currentTabFromHash());
window.addEventListener("hashchange", () => setTab(currentTabFromHash()));
