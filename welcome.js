document.getElementById("open-library").addEventListener("click", e => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});
