// Define shared types here
export interface FeedLabels {
    [key: string]: string;
}

export interface FeedVO {
    id?: string | number; // Support both string and number IDs
    labels: FeedLabels;
    time: string;
    // Add other potential fields if necessary
} 