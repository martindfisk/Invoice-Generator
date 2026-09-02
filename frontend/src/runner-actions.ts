import { availableCountries } from "./onboarding";
import { initialRunnerUi, saveCollectionId } from "./runner";
import { store } from "./store";
import { ApiError, getCollection, getCollections, type CollectionSummary } from "./uapi-client";

export const NO_COLLECTIONS_API =
  "The backend is not serving /api/collections yet, so there is nothing to run. Once the " +
  "backend milestone lands, the published fiskaly Postman collections (IT, BE, DE) appear here.";

export const COUNTRY_LOCKED_WHILE_RUNNING =
  "Stop the run first — the step results describe the collection that is running.";

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return NO_COLLECTIONS_API;
  return error instanceof Error ? error.message : String(error);
}

function defaultCollectionId(collections: CollectionSummary[]): string | null {
  const preferred = availableCountries(collections, [])[0];
  if (preferred && collections.some((entry) => entry.id === preferred.code.toLowerCase())) {
    return preferred.code.toLowerCase();
  }
  return collections[0]?.id ?? null;
}

export async function loadCollections(): Promise<void> {
  store.patchRunner({ loading: true, collectionsError: null });
  try {
    const collections = await getCollections();
    store.patchRunner({ collections, loading: false });
  } catch (error) {
    store.patchRunner({ collections: null, collectionsError: errorText(error), loading: false });
  }
}

// The tree's country and the runner's collection are one choice: the collection id *is* the
// country in lowercase, so selecting either control lands here and there is no second piece
// of state to keep in step. A switch while a run is in progress is refused outright — the
// results map is keyed by step index into the loaded collection, and rebinding it mid-run
// would describe a different collection's steps.
export async function selectCollection(id: string): Promise<boolean> {
  const state = store.getState().runner;
  if (state.running) return false;
  if (state.collectionId === id && state.collection?.id === id) return true;
  saveCollectionId(id);
  store.patchRunner({
    ...initialRunnerUi(id),
    collections: state.collections,
  });
  const known = state.collections?.some((entry) => entry.id === id) ?? false;
  if (!known) return true;
  store.patchRunner({ loading: true });
  try {
    const collection = await getCollection(id);
    if (store.getState().runner.collectionId === id) {
      store.patchRunner({ collection, loading: false });
    }
  } catch (error) {
    if (store.getState().runner.collectionId === id) {
      store.patchRunner({ collectionError: errorText(error), loading: false });
    }
  }
  return true;
}

export function selectCountry(code: string): Promise<boolean> {
  return selectCollection(code.toLowerCase());
}

export async function ensureRunnerLoaded(): Promise<void> {
  const before = store.getState().runner;
  if (!before.collections && !before.loading) await loadCollections();
  const state = store.getState().runner;
  if (!state.collections) return;
  // A persisted id the backend no longer serves (the France case) falls back to the default
  // instead of surviving as a phantom selection.
  const served = state.collections.some((entry) => entry.id === state.collectionId);
  const wanted = served ? state.collectionId : defaultCollectionId(state.collections);
  if (wanted && state.collection?.id !== wanted) await selectCollection(wanted);
}
