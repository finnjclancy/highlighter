(() => {
  const exportBtn = document.getElementById("settings-export");
  const exportStatus = document.getElementById("settings-status-export");

  const fileInput = document.getElementById("settings-import-file");
  const triggerBtn = document.getElementById("settings-import-trigger");
  const statusSpan = document.getElementById("settings-import-status");
  const actionsDiv = document.getElementById("settings-import-actions");
  const mergeBtn = document.getElementById("settings-import-merge");
  const replaceBtn = document.getElementById("settings-import-replace");
  const importStatus = document.getElementById("settings-status-import");

  let parsedBackup = null;

  // ---------- export ----------
  exportBtn.addEventListener("click", async () => {
    try {
      const localData = await chrome.storage.local.get(null);
      const syncData = await chrome.storage.sync.get("palette");

      const backup = {
        version: 1,
        highlighter_backup: true,
        timestamp: Date.now(),
        local: localData,
        sync: syncData
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `highlighter-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      exportStatus.style.display = "inline";
      setTimeout(() => { exportStatus.style.display = "none"; }, 3000);
    } catch (err) {
      alert("Failed to export backup: " + err.message);
    }
  });

  // ---------- import triggers ----------
  triggerBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) {
      statusSpan.textContent = "No file chosen";
      actionsDiv.style.display = "none";
      parsedBackup = null;
      return;
    }
    statusSpan.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!data || data.highlighter_backup !== true) {
          throw new Error("Missing highlighter_backup validation flag");
        }
        parsedBackup = data;
        actionsDiv.style.display = "flex";
      } catch (err) {
        alert("Error parsing backup file: " + err.message);
        fileInput.value = "";
        statusSpan.textContent = "Invalid backup file";
        actionsDiv.style.display = "none";
        parsedBackup = null;
      }
    };
    reader.readAsText(file);
  });

  // ---------- restore logic ----------
  async function performMerge() {
    if (!parsedBackup) return;

    try {
      // 1) Sync palette merge
      if (parsedBackup.sync && parsedBackup.sync.palette) {
        const { palette: currentPalette = [] } = await chrome.storage.sync.get("palette");
        const mergedPalette = [...currentPalette];
        const backupPalette = parsedBackup.sync.palette || [];
        backupPalette.forEach(bSwatch => {
          if (!mergedPalette.some(cSwatch => cSwatch.bg.toLowerCase() === bSwatch.bg.toLowerCase())) {
            mergedPalette.push(bSwatch);
          }
        });
        await chrome.storage.sync.set({ palette: mergedPalette });
      }

      // 2) Local data merge
      if (parsedBackup.local) {
        for (const [key, value] of Object.entries(parsedBackup.local)) {
          if (key.startsWith("hl_page_") && Array.isArray(value)) {
            // Highlights merge
            const currentHighlights = (await chrome.storage.local.get(key))[key] || [];
            const mergedHighlights = [...currentHighlights];
            value.forEach(bHl => {
              const idx = mergedHighlights.findIndex(cHl => cHl.id === bHl.id);
              if (idx >= 0) {
                mergedHighlights[idx] = bHl; // Overwrite older with backup
              } else {
                mergedHighlights.push(bHl);
              }
            });
            await chrome.storage.local.set({ [key]: mergedHighlights });
          } else if (key.startsWith("hl_draw_") && Array.isArray(value)) {
            // Drawings merge
            const currentStrokes = (await chrome.storage.local.get(key))[key] || [];
            const mergedStrokes = [...currentStrokes];
            value.forEach(bSt => {
              const idx = mergedStrokes.findIndex(cSt => cSt.id === bSt.id);
              if (idx >= 0) {
                mergedStrokes[idx] = bSt;
              } else {
                mergedStrokes.push(bSt);
              }
            });
            await chrome.storage.local.set({ [key]: mergedStrokes });
          } else if (key === "hl_shares" && Array.isArray(value)) {
            // Shares merge
            const { hl_shares: currentShares = [] } = await chrome.storage.local.get("hl_shares");
            const mergedShares = [...currentShares];
            value.forEach(bSh => {
              if (!mergedShares.some(cSh => cSh.id === bSh.id)) {
                mergedShares.push(bSh);
              }
            });
            mergedShares.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            await chrome.storage.local.set({ hl_shares: mergedShares });
          } else if (key === "hl_panel_pos" || key === "hl_draw_toolbar_pos") {
            // Positional layouts (overwrite if not present, or simple overwrite)
            await chrome.storage.local.set({ [key]: value });
          }
        }
      }

      showSuccess();
    } catch (err) {
      alert("Failed to merge backup data: " + err.message);
    }
  }

  async function performReplace() {
    if (!parsedBackup) return;

    try {
      await chrome.storage.local.clear();
      if (parsedBackup.sync && parsedBackup.sync.palette) {
        await chrome.storage.sync.set({ palette: parsedBackup.sync.palette });
      }
      if (parsedBackup.local) {
        await chrome.storage.local.set(parsedBackup.local);
      }
      showSuccess();
    } catch (err) {
      alert("Failed to replace data: " + err.message);
    }
  }

  function showSuccess() {
    importStatus.style.display = "inline";
    // Clean up input values
    fileInput.value = "";
    statusSpan.textContent = "No file chosen";
    actionsDiv.style.display = "none";
    parsedBackup = null;

    setTimeout(() => {
      importStatus.style.display = "none";
      // Reload page to re-render all views with new data
      location.reload();
    }, 1500);
  }

  // ---------- event listeners ----------
  mergeBtn.addEventListener("click", performMerge);

  replaceBtn.addEventListener("click", () => {
    if (typeof openConfirm === "function") {
      openConfirm({
        title: "Replace all data?",
        body: `<div class="cf-lead" style="color:var(--danger);">Warning: This will permanently delete all your current highlights, drawings, and custom palettes.</div>
               <div style="font-size:12px;color:var(--text-3);margin-top:8px;line-height:1.4;">Only highlights contained in the backup file will remain. This action cannot be undone.</div>`,
        confirmText: "Replace Data",
        onConfirm: performReplace
      });
    } else {
      if (confirm("WARNING: This will overwrite all your current highlights, drawings, and options. Are you sure you want to replace all data?")) {
        performReplace();
      }
    }
  });
})();
