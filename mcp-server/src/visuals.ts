// Avatar/environment catalog helpers. The catalog is the public Promethist asset
// bundle (the same one the backoffice fetches). The backend persists the bare `ref`
// in visualProperties; the backoffice UI shows the avatar from a compound `visualRef`
// of the form  avatar-<ref>-<ver>:environment-<ref>-<ver>  (versions: dots -> underscores).

const VISUALS_BUNDLE =
  process.env.PROMETHIST_BUNDLE_URL ||
  "https://repository.promethist.ai/public/arc/bundles/default/index.json";

export const CAMERA_PRESETS = ["Dynamic", "Smooth", "Static"] as const;

type BundleItem = { ref?: string; name?: string; gender?: string; versions?: string[]; public?: boolean };
type Bundle = { avatar?: BundleItem[]; environment?: BundleItem[] };

let bundleCache: Bundle | null = null;

export async function fetchVisualsBundle(): Promise<Bundle> {
  if (bundleCache) return bundleCache;
  const res = await fetch(VISUALS_BUNDLE, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Visuals bundle returned HTTP ${res.status}`);
  bundleCache = (await res.json()) as Bundle;
  return bundleCache;
}

function latestVersion(item: BundleItem | undefined): string | null {
  const vs = item?.versions;
  if (!Array.isArray(vs) || vs.length === 0) return null;
  return String(vs[vs.length - 1]).replace(/\./g, "_");
}

/**
 * Build the backoffice-parity compound visualRef from bare refs:
 *   avatar-<avatarRef>-<ver>[:environment-<environmentRef>-<ver>]
 * Returns null if the avatar ref isn't found in the bundle (so callers keep the existing visualRef).
 */
export async function buildCompoundVisualRef(
  avatarRef: string | null | undefined,
  environmentRef: string | null | undefined,
): Promise<string | null> {
  if (!avatarRef) return null;
  let bundle: Bundle;
  try {
    bundle = await fetchVisualsBundle();
  } catch {
    return null;
  }
  const aItem = (bundle.avatar ?? []).find((x) => x.ref === avatarRef);
  const aVer = latestVersion(aItem);
  if (!aVer) return null;
  let compound = `avatar-${avatarRef}-${aVer}`;
  if (environmentRef) {
    const eItem = (bundle.environment ?? []).find((x) => x.ref === environmentRef);
    const eVer = latestVersion(eItem);
    if (eVer) compound += `:environment-${environmentRef}-${eVer}`;
  }
  return compound;
}

/** Catalog projection for the get_visuals tool — surfaces the exact ref to pass to edit_agent. */
export function projectCatalog(bundle: Bundle, kind?: "avatar" | "environment") {
  const proj = (arr: BundleItem[] | undefined, key: "avatarRef" | "environmentRef") =>
    (arr ?? [])
      .filter((v) => v && v.public === true)
      .map((v) => ({
        [key]: v.ref,
        name: v.name,
        gender: v.gender,
        latestVersion: Array.isArray(v.versions) ? v.versions[v.versions.length - 1] : null,
      }));
  if (kind === "avatar") return { avatar: proj(bundle.avatar, "avatarRef") };
  if (kind === "environment") return { environment: proj(bundle.environment, "environmentRef") };
  return { avatar: proj(bundle.avatar, "avatarRef"), environment: proj(bundle.environment, "environmentRef") };
}
