import { writable } from 'svelte/store';
import type { FeedVO, FeedLabels } from '$lib/types/feed';

interface SelectedFeedData {
    id: string;
    title: string;
    tags: string;
    summaryHtmlSnippet: string;
    link: string;
}

interface QueryResponse {
    summary: string;
    feeds: FeedVO[];
    count: number;
}

export const selectedFeedStore = writable<SelectedFeedData | null>(null);

export const queryFeedsStore = writable<QueryResponse | null>(null);

