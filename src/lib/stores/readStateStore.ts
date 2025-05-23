import { writable, derived } from 'svelte/store';
import { calculateTodayReadCount } from '$lib/utils/dateUtils';
import type { ReadItemsMap } from '$lib/utils/dateUtils'; // Import type if needed elsewhere
import { getTargetApiUrl, getApiRequestOptions } from '$lib/utils/apiUtils';
import { getFeedItemId } from '$lib/utils/feedUtils';
import type { FeedVO } from '$lib/types/feed';

const READ_ITEMS_STORAGE_KEY = 'zenfeed_read_feeds';
const SYNC_TIMESTAMP_KEY = 'zenfeed_read_sync_timestamp';
const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes in milliseconds

async function getFeedReadStatus(itemId: string) {
    const response = await fetch(
        getTargetApiUrl(`/feed/${itemId}`),
        getApiRequestOptions('GET')
    );
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.read_status;  // 'read', 'unread' 或 'deleted'
}

async function updateFeedReadStatus(itemId: string, newStatus: 'read' | 'unread' | 'deleted') {
    const response = await fetch(
        getTargetApiUrl(`/feed/${itemId}`),
        getApiRequestOptions('POST', {
            read_status: newStatus
        })
    );

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.read_status;
}

// Function to initialize the store and load data
function createReadItemsStore() {
    const initialMap: ReadItemsMap = new Map();
    const { subscribe, set, update } = writable<ReadItemsMap>(initialMap);
    let syncQueue: Set<string> = new Set(); // Queue for items that need syncing

    // Load from localStorage on initialization
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            const storedData = localStorage.getItem(READ_ITEMS_STORAGE_KEY);
            if (storedData) {
                const parsedArray = JSON.parse(storedData);
                if (Array.isArray(parsedArray) && parsedArray.every(pair => Array.isArray(pair) && pair.length === 2)) {
                    set(new Map(parsedArray));
                } else {
                    console.warn('Invalid read items format in localStorage. Clearing.');
                    localStorage.removeItem(READ_ITEMS_STORAGE_KEY);
                }
            }
        } catch (e) {
            console.error('Failed to load/parse read items from localStorage:', e);
            localStorage.removeItem(READ_ITEMS_STORAGE_KEY);
        }
    }

    const saveToLocalStorage = (map: ReadItemsMap) => {
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
            try {
                const storableArray = Array.from(map.entries());
                localStorage.setItem(READ_ITEMS_STORAGE_KEY, JSON.stringify(storableArray));
            } catch (e) {
                console.error('Failed to save read items to localStorage:', e);
            }
        }
    };

    const updateLocalState = (itemId: string, isRead: boolean) => {
        update(currentMap => {
            const newMap = new Map(currentMap);
            if (isRead && !newMap.has(itemId)) {
                newMap.set(itemId, Date.now());
            } else if (!isRead && newMap.has(itemId)) {
                newMap.delete(itemId);
            }
            saveToLocalStorage(newMap);
            return newMap;
        });
    };

    const shouldSync = () => {
        if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
            return false;
        }
        const lastSync = localStorage.getItem(SYNC_TIMESTAMP_KEY);
        if (!lastSync) {
            return true;
        }
        return Date.now() - Number(lastSync) > SYNC_INTERVAL;
    };

    const updateSyncTimestamp = () => {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SYNC_TIMESTAMP_KEY, Date.now().toString());
        }
    };

    // Function to sync with backend
    const syncWithBackend = async (itemId: string) => {
        try {
            // Only sync if enough time has passed since last sync
            if (!shouldSync()) {
                return;
            }

            const status = await getFeedReadStatus(itemId);
            if (status === 'read') {
                updateLocalState(itemId, true);
            } else if (status === 'unread') {
                updateLocalState(itemId, false);
            }
            updateSyncTimestamp();
        } catch (error) {
            console.error('Failed to sync read status with backend:', error);
            // Add to sync queue for retry
            syncQueue.add(itemId);
        }
    };

    // Function to process sync queue
    const processSyncQueue = async () => {
        const itemsToSync = Array.from(syncQueue);
        syncQueue.clear();

        for (const itemId of itemsToSync) {
            try {
                await syncWithBackend(itemId);
            } catch (error) {
                // If sync fails, add back to queue
                syncQueue.add(itemId);
            }
        }
    };

    // Set up periodic sync if in browser environment
    if (typeof window !== 'undefined') {
        setInterval(processSyncQueue, SYNC_INTERVAL);
    }

    return {
        subscribe,
        // Function to mark an item as read
        markRead: async (itemIdOrFeed: string | FeedVO) => {
            const itemId = typeof itemIdOrFeed === 'string' ? itemIdOrFeed : getFeedItemId(itemIdOrFeed);
            
            // Update local state immediately
            updateLocalState(itemId, true);
            
            try {
                // Try to sync with backend
                const status = await updateFeedReadStatus(itemId, 'read');
                if (status !== 'read') {
                    // Revert local state if backend sync fails
                    updateLocalState(itemId, false);
                }
            } catch (error) {
                console.error('Failed to mark item as read in backend:', error);
                syncQueue.add(itemId); // Add to sync queue for retry
            }
        },
        // Function to mark an item as unread
        markUnread: async (itemIdOrFeed: string | FeedVO) => {
            const itemId = typeof itemIdOrFeed === 'string' ? itemIdOrFeed : getFeedItemId(itemIdOrFeed);
            
            // Update local state immediately
            updateLocalState(itemId, false);
            
            try {
                // Try to sync with backend
                const status = await updateFeedReadStatus(itemId, 'unread');
                if (status !== 'unread') {
                    // Revert local state if backend sync fails
                    updateLocalState(itemId, true);
                }
            } catch (error) {
                console.error('Failed to mark item as unread in backend:', error);
                syncQueue.add(itemId); // Add to sync queue for retry
            }
        },
        // Function to sync with backend
        sync: async (itemId: string) => {
            await syncWithBackend(itemId);
        },
        // Utility function to check read status
        isRead: (itemIdOrFeed: string | FeedVO, currentMap: ReadItemsMap): boolean => {
            const itemId = typeof itemIdOrFeed === 'string' ? itemIdOrFeed : getFeedItemId(itemIdOrFeed);
            return currentMap.has(itemId);
        },
        // Function to reset the store
        reset: async () => {
            set(new Map());
            if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
                localStorage.removeItem(READ_ITEMS_STORAGE_KEY);
                localStorage.removeItem(SYNC_TIMESTAMP_KEY);
            }
            syncQueue.clear();
        },
        // Force sync all items in queue
        syncAll: async () => {
            await processSyncQueue();
        }
    };
}

// Create the store instance
export const readItemsStore = createReadItemsStore();

// Derived store that calculates the count of items read today
export const todayReadCountStore = derived(
    readItemsStore,
    ($readItems) => calculateTodayReadCount($readItems)
);

// Derived store helper for reactive read status checking in components
export const isReadStore = derived(
    readItemsStore,
    ($readItems) => (itemId: string) => $readItems.has(itemId)
); 