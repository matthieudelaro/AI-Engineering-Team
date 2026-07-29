/**
 * UI feature flags.
 * Light mode: VITE_UI_LIGHT=1 or URL ?light=1 (query wins when present).
 * Disables live map stream + diagnostic panels that poll/paint heavily.
 */

export function resolveUiLightMode(search: string, envValue: string | undefined): boolean {
  const params = new URLSearchParams(search);
  if (params.has("light")) {
    const value = params.get("light");
    return value !== "0" && value !== "false";
  }
  return envValue === "1" || envValue === "true";
}

export function resolveUiFeatures(
  search: string,
  envValue: string | undefined,
): {
  mapStream: boolean;
  ratePanel: boolean;
  claimQueuePanel: boolean;
  apiConsole: boolean;
} {
  const light = resolveUiLightMode(search, envValue);
  return {
    mapStream: !light,
    ratePanel: !light,
    claimQueuePanel: !light,
    apiConsole: !light,
  };
}

export function isUiLightMode(): boolean {
  return resolveUiLightMode(
    typeof window !== "undefined" ? window.location.search : "",
    import.meta.env.VITE_UI_LIGHT as string | undefined,
  );
}

export const UI_FEATURES = resolveUiFeatures(
  typeof window !== "undefined" ? window.location.search : "",
  import.meta.env.VITE_UI_LIGHT as string | undefined,
);
