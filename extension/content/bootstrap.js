// Manifest content scripts are classic scripts. Firefox loads the modules from
// extension URLs; module resources are declared in web_accessible_resources.
(() => {
  if (window.top !== window || !globalThis.browser?.runtime) return;
  const runtime = browser.runtime;
  Promise.all([
    import(runtime.getURL('content/adapter.js')),
    import(runtime.getURL('content/session.js'))
  ]).then(([{createAdapter, isSupportedRoute}, {createSession}]) => {
    if (window.top !== window) return;
    createSession({runtime, window, document,
      adapter: createAdapter({window, document}),
      routeGuard: () => isSupportedRoute(window, document)});
  }).catch(() => {
    // No page exception or personal data is logged. A failed load is visible as
    // an unavailable content connection in the sidebar.
  });
})();
