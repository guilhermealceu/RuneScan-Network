import type { ScanResult } from "../types";

export const INVENTORY_CACHE_VERSION = 2;
export const LEGACY_STORAGE_KEY = "runescan:last-result";
const FALLBACK_STORAGE_KEY = "runescan:inventory-cache:v2";
const DB_NAME = "runescan-network";
const STORE_NAME = "inventories";
const DB_VERSION = 1;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HISTORY = 25;

export interface InventoryCacheRecord {
  id: string;
  schemaVersion: number;
  savedAt: string;
  expiresAt: string;
  result: ScanResult;
}

export function createInventoryCacheRecord(result: ScanResult, now = new Date()): InventoryCacheRecord {
  const savedAt = now.toISOString();
  return {
    id: `${savedAt}:${result.target}`,
    schemaVersion: INVENTORY_CACHE_VERSION,
    savedAt,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    result,
  };
}

export function parseInventoryCacheRecord(value: unknown, now = new Date()): InventoryCacheRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<InventoryCacheRecord>;
  if (record.schemaVersion !== INVENTORY_CACHE_VERSION || !isScanResult(record.result)) return null;
  if (!record.id || !record.savedAt || !record.expiresAt) return null;
  if (!Number.isFinite(Date.parse(record.savedAt)) || Date.parse(record.expiresAt) <= now.getTime()) return null;
  return record as InventoryCacheRecord;
}

export function parseLegacyInventory(raw: string | null): ScanResult | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isScanResult(value) ? value : null;
  } catch {
    return null;
  }
}

export async function loadLatestInventory(): Promise<ScanResult | null> {
  try {
    const database = await openDatabase();
    const records = await readAllRecords(database);
    const latest = records
      .map((record) => parseInventoryCacheRecord(record))
      .filter((record): record is InventoryCacheRecord => Boolean(record))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
    if (latest) return latest.result;
  } catch {
    // Fall through to the local fallback and legacy migration.
  }

  const fallback = parseFallbackRecord();
  if (fallback) return fallback.result;

  const legacy = parseLegacyInventory(window.localStorage.getItem(LEGACY_STORAGE_KEY));
  if (!legacy) return null;
  await saveInventory(legacy);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  return legacy;
}

export async function saveInventory(result: ScanResult): Promise<void> {
  const record = createInventoryCacheRecord(result);
  try {
    const database = await openDatabase();
    await putRecord(database, record);
    await pruneHistory(database);
    window.localStorage.removeItem(FALLBACK_STORAGE_KEY);
  } catch {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(record));
  }
}

export async function clearInventoryCache(): Promise<void> {
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  window.localStorage.removeItem(FALLBACK_STORAGE_KEY);
  try {
    const database = await openDatabase();
    await requestAsPromise(database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear());
  } catch {
    // The in-memory dashboard can still be cleared when browser storage is unavailable.
  }
}

function parseFallbackRecord() {
  try {
    return parseInventoryCacheRecord(JSON.parse(window.localStorage.getItem(FALLBACK_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

function isScanResult(value: unknown): value is ScanResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ScanResult>;
  return typeof result.target === "string"
    && typeof result.timestamp === "string"
    && Array.isArray(result.devices)
    && Array.isArray(result.collectors)
    && Boolean(result.summary && typeof result.summary.total === "number");
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB indisponivel"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB"));
  });
}

function readAllRecords(database: IDBDatabase): Promise<unknown[]> {
  return requestAsPromise(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll());
}

function putRecord(database: IDBDatabase, record: InventoryCacheRecord): Promise<IDBValidKey> {
  return requestAsPromise(database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record));
}

async function pruneHistory(database: IDBDatabase) {
  const records = (await readAllRecords(database))
    .filter((record): record is InventoryCacheRecord => Boolean(record && typeof record === "object" && "id" in record && "savedAt" in record))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const expiredOrExtra = records.filter((record, index) => Date.parse(record.expiresAt) <= Date.now() || index >= MAX_HISTORY);
  if (expiredOrExtra.length === 0) return;
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  await Promise.all(expiredOrExtra.map((record) => requestAsPromise(store.delete(record.id))));
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha no IndexedDB"));
  });
}
