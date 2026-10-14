// =============================================================================
// REMARKT GRADING APP - BOOTSTRAP
// =============================================================================
async function initApp() {
  // Independent reads start together; the static model database is versioned
  // and browser-cached, while the account directory retains live auth checks.
  await Promise.all([loadMonitorPortDatabase(), liveSessionToken() ? restoreServerSession() : refreshSharedUsers()]);
  if(STATE.sharedStorageError) {
    await loadDurableBackup();
    const backup=readLocalDemoStateBackup();
    if(backup?.storageFormat===3 && backup.workspaceId) {
      STATE.serverAuth=true;STATE.storageFormat=3;STATE.sharedWorkspaceId=backup.workspaceId;
      STATE.localRecoveryAvailable=true;
      STATE.loginDirectoryUnavailable=false;
    }
  }
  if (STATE.serverAuth && !liveSessionToken()) {
    if (await restoreOfflineTabSession()) { render(); return; }
    clearSessionUser(); STATE.currentUser = null; STATE.currentScreen = 'login'; render(); return;
  }
  // A valid token may have outlived the local directory cache. Identity comes
  // from the verified session response, never from decoding an unsigned token.
  if (STATE.serverAuth && !STATE.currentUser) { STATE.currentScreen = 'login'; render(); return; }
  if (STATE.currentUser?.mustChangePassword) { STATE.currentScreen = 'password_change'; render(); return; }
  const loaded = await loadSharedDemoState();
  if (STATE.serverAuth && STATE.currentUser && (!loaded || (STATE.sharedStorageError && !canWorkLocally()))) {
    // An authenticated account is not permission to show built-in example
    // inventory when an operational load is corrupt or unsafe to recover.
    STATE.loginLoadPending = true; STATE.currentScreen = 'login'; render(); return;
  }
  // loadSharedDemoState records the stamp of the state it actually read.
  // A second stamp request could acknowledge an unseen colleague's change.
  rebuildLaptopIndex();
  rebuildMonitorIndex();
  rebuildHistoryIndexes();
  rebuildLabelPrintIndexes();
  rebuildMonitorLabelPrintIndexes();
  render();
}

// Voorkom dat een automatische (achtergrond) herlaad het scherm opnieuw
// opbouwt terwijl iemand een formulier invult. De ingevulde waarden (merk,
// model, poortcorrecties op "Monitor handmatig invoeren") staan alleen in de
// DOM en nog niet in STATE, dus een render() zou ze wissen. STATE wordt wel
// bijgewerkt; de view herbouwt vanzelf zodra de gebruiker verdergaat.
function liveRenderWouldDisruptInput() {
  if (typeof STATE !== 'undefined' && STATE && ['monitor_manual', 'missing_specs'].includes(STATE.currentScreen)) return true;
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function installSharedStateRefresh() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  let refreshInFlight = false;
  const refresh = async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      // Goedkope check: herlaad alleen volledig als de serverdata wijzigde.
      const applied = await syncSharedStateIfChanged({ loadFull: true });
      if (applied && !liveRenderWouldDisruptInput()) render();
    } finally {
      refreshInFlight = false;
    }
  };

  window.addEventListener('focus', refresh);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });
  }
}

function installLiveUserSync() {
  if (typeof window === 'undefined' || typeof setInterval !== 'function') return;

  const SYNC_INTERVAL_MS = 5 * 60 * 1000; // statuscontrole: klein en zuinig

  let syncInFlight = false;
  const sync = async () => {
    // Pauzeer wanneer het tabblad niet zichtbaar is: geen database-verkeer op
    // de achtergrond. Dit bespaart de meeste commando's.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (STATE.sharedStorageError && !STATE.offlineWork) return;
    if(typeof appRetryAfter!=='undefined' && appRetryAfter>Date.now())return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      if(STATE.offlineWork) {
        await loadSharedDemoState();
        if(!liveRenderWouldDisruptInput())render();
        return;
      }
      if (typeof STATE !== 'undefined' && STATE.sharedSyncPending && typeof saveSharedDemoState === 'function') {
        await saveSharedDemoState();
      }
      // Lichte meta-check zonder de volledige dataset te downloaden.
      const changed = await syncSharedStateIfChanged();
      if (changed && !liveRenderWouldDisruptInput()) render();
      else if (typeof refreshAnalyticsServerStats === 'function' && document.getElementById('manager-live-stats')) {
        await refreshAnalyticsServerStats();
      }
    } finally {
      syncInFlight = false;
    }
  };

  setInterval(sync, SYNC_INTERVAL_MS);
}

installWorkspaceDisplay();
initApp();
installSharedStateRefresh();
installLiveUserSync();
