/*
 * Chirpy initializes Mermaid from the bundled post script with only a theme.
 * Merge in site-wide flowchart defaults before that happens, so Chinese and
 * mixed ASCII labels have more room and do not get clipped by narrow nodes.
 */
(function () {
  if (typeof mermaid === 'undefined' || typeof mermaid.initialize !== 'function') return;

  var originalInitialize = mermaid.initialize.bind(mermaid);
  var siteConfig = {
    securityLevel: 'loose',
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      wrappingWidth: 180,
      padding: 18,
      nodeSpacing: 56,
      rankSpacing: 64
    }
  };

  function mergeConfig(base) {
    base = base || {};
    return {
      ...siteConfig,
      ...base,
      flowchart: {
        ...siteConfig.flowchart,
        ...(base.flowchart || {})
      }
    };
  }

  mermaid.initialize = function (config) {
    return originalInitialize(mergeConfig(config));
  };
})();
