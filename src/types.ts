export interface TrackMetadata {
  artist: string;
  title: string;
  raw: string;
  artworkUrl?: string;
  timestamp: string;
}

export interface StreamPreset {
  name: string;
  url: string;
  genre: string;
  description: string;
}

export interface PlayerState {
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  bufferStatus: "idle" | "connecting" | "playing" | "error";
  streamUrl: string;
}
