function setTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + name));
  const target = name === "quotes" ? location.pathname : "#" + name;
  if (location.hash !== "#" + name && (name === "design" || location.hash === "#design")) {
    history.replaceState(null, "", target);
  }
}
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => setTab(t.dataset.tab));
});
if (location.hash === "#design") setTab("design");
window.addEventListener("hashchange", () => {
  setTab(location.hash === "#design" ? "design" : "quotes");
});
