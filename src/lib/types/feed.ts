// Define shared types here
export interface FeedLabels {
    [key: string]: string;
}

export interface FeedVO {
    id?: number; // Optional numeric ID from backend
    labels: FeedLabels;
    time: string;
    // Add other potential fields if necessary
} 